import { invokeLLM, type InvokeResult } from "./_core/llm";
import { loadAiProviderFromDb } from "./lib/ai-provider";
import { db as sharedDb } from "./db";
import { eq } from "drizzle-orm";
import {
  multiProductListings,
  multiProductListingItems,
  productCache,
  shopeeProducts,
} from "../drizzle/schema";

type ResolvedItem = {
  source: "baselinker" | "shopee";
  sourceId: number;
  name: string;
  sku: string;
  price: string;
  weight?: string;
  dimensions?: string;
  brand?: string;
  category?: string;
};

/**
 * Extracts plain text from an InvokeResult. Mirrors the pattern in
 * shopee-optimizer.ts (extractJsonFromResponse) but without the JSON match —
 * the multi-product AI prompts return free-form text (title or description),
 * not JSON.
 */
function extractTextFromResponse(response: InvokeResult): string {
  const raw = response.choices[0]?.message?.content;
  if (Array.isArray(raw)) {
    return raw
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return raw ?? "";
}

async function resolveListingContext(listingId: number, userId: number) {
  const [listing] = await sharedDb
    .select()
    .from(multiProductListings)
    .where(eq(multiProductListings.id, listingId))
    .limit(1);
  if (!listing || listing.userId !== userId) {
    throw new Error("Anúncio combinado não encontrado.");
  }

  const items = await sharedDb
    .select()
    .from(multiProductListingItems)
    .where(eq(multiProductListingItems.listingId, listingId));

  if (items.length === 0) {
    throw new Error("Anúncio combinado não tem produtos.");
  }

  const resolved: ResolvedItem[] = [];
  let category: string | undefined;
  let brand: string | undefined;

  for (const item of items) {
    if (item.source === "baselinker") {
      const [p] = await sharedDb
        .select()
        .from(productCache)
        .where(eq(productCache.productId, Number(item.sourceId)))
        .limit(1);
      if (p) {
        resolved.push({
          source: "baselinker",
          sourceId: Number(item.sourceId),
          name: p.name ?? "",
          sku: item.customSku ?? p.sku ?? "",
          price: item.customPrice ?? String(p.mainPrice ?? "0"),
          weight: p.weight ? String(p.weight) : undefined,
        });
      }
    } else {
      const [p] = await sharedDb
        .select()
        .from(shopeeProducts)
        .where(eq(shopeeProducts.itemId, Number(item.sourceId)))
        .limit(1);
      if (p) {
        const dims =
          p.dimensionLength && p.dimensionWidth && p.dimensionHeight
            ? `${p.dimensionLength}x${p.dimensionWidth}x${p.dimensionHeight}cm`
            : undefined;
        resolved.push({
          source: "shopee",
          sourceId: Number(item.sourceId),
          name: p.itemName ?? "",
          sku: item.customSku ?? p.itemSku ?? "",
          price: item.customPrice ?? String(p.price ?? "0"),
          weight: p.weight ? String(p.weight) : undefined,
          dimensions: dims,
          category: p.categoryName ?? undefined,
          brand: undefined,
        });
      }
    }
  }

  const principal = resolved.find(
    (r) =>
      r.source === listing.mainProductSource &&
      r.sourceId === Number(listing.mainProductSourceId),
  );
  if (!principal) {
    throw new Error("Produto principal do anúncio não encontrado.");
  }

  // Category/brand vêm do produto principal
  if (principal.category) category = principal.category;
  if (principal.brand) brand = principal.brand;

  return { listing, items, resolved, principal, category, brand };
}

export async function generateMultiProductTitle(
  listingId: number,
  userId: number,
): Promise<string> {
  await loadAiProviderFromDb();
  const { resolved, principal, category, brand } = await resolveListingContext(
    listingId,
    userId,
  );

  const variationsText = resolved
    .map((r) => `- ${r.name} (R$ ${r.price})`)
    .join("\n");

  const systemPrompt = `Atue como Especialista em SEO para Shopee Brasil focado em ALTA CONVERSÃO.

CONTEXTO: Você está criando o título de um ANÚNCIO COMBINADO que reúne múltiplos produtos como variações dentro de UMA listagem Shopee.

REGRAS OBRIGATÓRIAS:
- Título deve ter ENTRE 70 e 100 caracteres. NUNCA menos, NUNCA mais. Conte com cuidado.
- Resumir as variações de forma compacta (ex: 30L,50L,100L | P/M/G | 10,20,50un).
- Priorizar palavras-chave que compradores realmente buscam na Shopee Brasil.
- Estrutura sugerida (adapte conforme o produto):
  [Produto Principal] [Característica Forte] [Variações Resumidas] [Benefício Curto]
- Incluir marca SOMENTE se foi fornecida no input.
- Incluir "Pronta Entrega" SOMENTE se faz sentido pro produto e couber sem cortar info útil.
- Sem emojis.
- Sem palavras vagas ("incrível", "o melhor", "imperdível").
- Separadores aceitáveis: " | " ou " - " (com espaços).
- Sem quebras de linha. Sem aspas. Sem markdown.

SAÍDA:
Apenas o título em uma linha. Nada mais. Sem aspas envolvendo. Sem prefixo "Título:".`;

  const userPrompt = `Produto Principal: ${principal.name}
${category ? `Categoria Shopee: ${category}` : ""}
${brand ? `Marca: ${brand}` : ""}

Variações (${resolved.length} produtos):
${variationsText}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 200,
  });

  const title = extractTextFromResponse(response)
    .trim()
    .replace(/^["']|["']$/g, "")
    .split("\n")[0]
    .trim();
  if (!title) throw new Error("IA não retornou título.");
  return title;
}

export async function generateMultiProductDescription(
  listingId: number,
  userId: number,
): Promise<string> {
  await loadAiProviderFromDb();
  const { listing, resolved, principal, category, brand } =
    await resolveListingContext(listingId, userId);

  const variationsText = resolved
    .map((r) => {
      const parts = [`- ${r.name}`, `R$ ${r.price}`];
      if (r.dimensions) parts.push(r.dimensions);
      if (r.weight) parts.push(`${r.weight}kg`);
      return parts.join(" | ");
    })
    .join("\n");

  const systemPrompt = `Atue como Copywriter Sênior especialista em Shopee Brasil.

CONTEXTO: Você está criando a descrição de um ANÚNCIO COMBINADO que reúne múltiplos produtos como variações dentro de UMA listagem Shopee. O comprador escolhe a variação no momento da compra.

ESTRUTURA OBRIGATÓRIA (use exatamente esta ordem, em texto puro sem markdown):

🔥 [HEADLINE]
Uma frase forte de 1 linha focada em benefício/dor do cliente.

📦 SOBRE O PRODUTO
2-3 parágrafos curtos explicando o que é, para que serve, e o diferencial principal.

✅ PRINCIPAIS BENEFÍCIOS
- Bullet 1
- Bullet 2
- Bullet 3
- Bullet 4
(4 a 6 bullets, foco em: economia, praticidade, resistência, uso diário)

🎯 VARIAÇÕES DISPONÍVEIS
Lista organizada de TODAS as variações fornecidas no input.
Deixe claro que o cliente escolhe a variação desejada antes de finalizar a compra.

📋 FICHA TÉCNICA
- Material:
- Medidas:
- Capacidade/Volume:
- Peso:
- Indicação de uso:
(Use APENAS dados que vieram no input. Se faltar info, omita a linha — NÃO invente.)

📦 O QUE VEM NO PACOTE
Lista clara do que o comprador recebe.

🚚 ENVIO
- Produto bem embalado
- Envio realizado a partir da confirmação do pagamento
(NÃO prometa prazos específicos como "24h" — deixe genérico para não criar expectativa quebrada.)

❓ PERGUNTAS FREQUENTES
3 a 5 pares pergunta-resposta sobre: como escolher variação, qualidade do produto, embalagem, estoque.

🔍 PALAVRAS-CHAVE
15 tags relevantes separadas por vírgula, focadas em busca Shopee Brasil.

REGRAS GERAIS:
- Use emojis APENAS no início de cada seção (1 emoji por seção, igual o exemplo). Sem emojis no meio do texto.
- Texto puro, sem markdown (sem **negrito**, sem # heading, sem listas markdown).
- Linguagem direta, profissional, focada em conversão.
- Limite total: 2500-3000 caracteres (Shopee aceita ~3000, deixe margem).
- NÃO invente especificações técnicas, materiais, certificações, garantias.
- Se não tiver informação suficiente pra uma seção, faça-a curta — não preencha com lorem ipsum disfarçado.

SAÍDA:
A descrição completa pronta para colar na Shopee. Nada mais.`;

  const userPrompt = `Produto Principal: ${principal.name}
${category ? `Categoria Shopee: ${category}` : ""}
${brand ? `Marca: ${brand}` : ""}
${listing.title ? `Título do anúncio: ${listing.title}` : ""}

Variações (${resolved.length} produtos):
${variationsText}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 2500,
  });

  const description = extractTextFromResponse(response).trim();
  if (!description) throw new Error("IA não retornou descrição.");
  return description;
}
