import OpenAI from "openai";
import { invokeLLM, type InvokeResult } from "./_core/llm";
import { loadAiProviderFromDb } from "./lib/ai-provider";
import { generateImage } from "./_core/imageGeneration";
import { ENV } from "./_core/env";
import { db as sharedDb } from "./db";
import { and, eq } from "drizzle-orm";
import {
  multiProductListings,
  multiProductListingItems,
  productCache,
  shopeeProducts,
} from "../drizzle/schema";
import {
  buildStylePromptSection,
  type ThumbStyle,
  type ThumbBadge,
  type ThumbColor,
} from "../shared/thumb-styles";
import {
  buildNarrativePromptSection,
  type ThumbPromptBase,
  type ThumbToggleComposicao,
  type ThumbToggleContexto,
  type ThumbToggleEnfase,
} from "../shared/thumb-prompts";

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

  // ── Variação 2 (matriz N×M criada no CombinedWizard) ──
  let variation2Type: string | null = null;
  let variation2Options: string[] = [];
  let optionDetailsMatrix: any[][] = [];

  if (listing.variation2Type) {
    variation2Type = listing.variation2Type;
  }

  if (listing.variation2OptionsJson) {
    try {
      const parsed = JSON.parse(listing.variation2OptionsJson);
      if (Array.isArray(parsed)) {
        variation2Options = parsed
          .map((o: any) => (typeof o === "string" ? o : o?.label ?? ""))
          .filter(Boolean);
      }
    } catch {}
  }

  if (listing.wizardStateJson) {
    try {
      const ws = JSON.parse(listing.wizardStateJson);
      if (Array.isArray(ws.optionDetailsMatrix)) optionDetailsMatrix = ws.optionDetailsMatrix;
      if (variation2Options.length === 0 && Array.isArray(optionDetailsMatrix[0])) {
        variation2Options = optionDetailsMatrix[0]
          .map((o: any) => o?.label ?? "")
          .filter(Boolean);
      }
      if (!variation2Type && typeof ws.selectedType === "string") {
        variation2Type = ws.selectedType;
      }
    } catch {}
  }

  return {
    listing,
    items,
    resolved,
    principal,
    category,
    brand,
    variation2Type,
    variation2Options,
    optionDetailsMatrix,
  };
}

export async function generateMultiProductTitle(
  listingId: number,
  userId: number,
): Promise<string> {
  await loadAiProviderFromDb();
  const { resolved, principal, category, brand, variation2Type, variation2Options } =
    await resolveListingContext(listingId, userId);

  const variationsText = resolved
    .map((r) => `- ${r.name} (R$ ${r.price})`)
    .join("\n");

  const v2Text = variation2Options.length > 0
    ? `\n\nVariação 2 (${variation2Type ?? "personalizada"}): ${variation2Options.join(", ")}`
    : "";

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

Produtos do anúncio (${resolved.length}):
${variationsText}${v2Text}`;

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

async function analyzePhotosWithVision(
  photoUrls: string[],
): Promise<string> {
  if (!photoUrls || photoUrls.length === 0) {
    return "";
  }

  const photosToAnalyze = photoUrls.slice(0, 4);

  try {
    if (!ENV.openaiApiKey) {
      console.warn("[analyzePhotosWithVision] OPENAI_API_KEY não configurada — pulando análise");
      return "";
    }
    const client = new OpenAI({ apiKey: ENV.openaiApiKey });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Descreva em até 150 palavras o que você vê nas imagens deste produto: tipo, cor, formato, material, embalagem, contexto de uso típico. Foque em características VISUAIS que ajudem a recriar uma imagem similar. Não invente nada que não esteja claramente visível. Responda em português brasileiro.",
            },
            ...photosToAnalyze.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "";
    if (!text || text.trim().length < 20) {
      console.warn("[analyzePhotosWithVision] Resposta vazia ou muito curta");
      return "";
    }

    return text.trim();
  } catch (e: any) {
    console.error("[analyzePhotosWithVision] Erro:", e?.message);
    return "";
  }
}

async function translatePromptToEnglish(
  promptPtBr: string,
): Promise<string> {
  if (!promptPtBr || promptPtBr.trim().length < 10) {
    return promptPtBr;
  }

  try {
    if (!ENV.openaiApiKey) {
      console.warn("[translatePrompt] OPENAI_API_KEY não configurada — usando PT-BR original");
      return promptPtBr;
    }
    const client = new OpenAI({ apiKey: ENV.openaiApiKey });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are an expert at converting Portuguese product image prompts into ENGLISH prompts optimized for gpt-image-1 (image generation AI).

YOUR JOB: take the Portuguese prompt and rewrite it as a professional ENGLISH image generation prompt focused on COMMERCIAL e-commerce thumbnails for Brazilian marketplaces (Shopee).

OUTPUT REQUIREMENTS:
1. Output ONLY the English prompt — no preamble, no explanation, no "Here's the prompt:"
2. Keep ALL product specifications (sizes, quantities, kits, variations) EXACTLY as in the original
3. Keep brand names and product names UNCHANGED (don't translate "Embafreezer" or specific brands)
4. PRESERVE Portuguese text that should appear ON the image (e.g., "OFERTA", "MAIS VENDIDO", "FRETE GRÁTIS", "KIT 1 UNIDADE", "ESCOLHA SUA VARIAÇÃO") — quote them in the prompt so gpt-image-1 renders them in Portuguese
5. Use professional commercial photography vocabulary in English (hero shot, studio lighting, mobile-first composition, high contrast, etc)
6. Be specific about Shopee brand colors when mentioned (orange #ee4d2d)
7. Mention "Brazilian Portuguese text" so the AI knows to render text accents correctly
8. Length: 300-600 words

EXAMPLE:
Portuguese input: "Crie thumb profissional Shopee mostrando 3 variações de sacos plásticos para alimentos com kits de 1, 2 e 3 unidades"

English output: "Create a professional Shopee e-commerce thumbnail in Brazilian marketplace style, mobile-first 1024x1024 square composition. Hero shot displaying 3 product variations of transparent plastic food storage bags arranged horizontally. Each variation labeled with Brazilian Portuguese text 'KIT 1 UNIDADE', 'KIT 2 UNIDADES', 'KIT 3 UNIDADES' in bold sans-serif typography. Shopee orange #ee4d2d as accent color for badges and call-to-action elements. Clean white background, studio lighting, ultra-realistic product photography, high contrast for mobile readability. Include promotional badges with text 'OFERTA', 'MAIS VENDIDO', 'ESCOLHA SUA VARIAÇÃO'. Premium typography, sharp packaging details, commercial campaign quality. All Portuguese text must render with correct accents and spelling."`,
        },
        {
          role: "user",
          content: `Translate this Portuguese prompt into an optimized English image generation prompt:\n\n${promptPtBr}`,
        },
      ],
    });

    const translated = response.choices[0]?.message?.content?.trim() ?? "";

    if (!translated || translated.length < 50) {
      console.warn("[translatePrompt] Tradução vazia — usando PT-BR original");
      return promptPtBr;
    }

    console.log("[AUDIT-TRANSLATE] ============================");
    console.log("[AUDIT-TRANSLATE] PT-BR prévia (200 chars):", promptPtBr.slice(0, 200).replace(/\n/g, " "));
    console.log("[AUDIT-TRANSLATE] PT-BR length:", promptPtBr.length);
    console.log("[AUDIT-TRANSLATE] EN prévia (200 chars):", translated.slice(0, 200).replace(/\n/g, " "));
    console.log("[AUDIT-TRANSLATE] EN length:", translated.length);
    return translated;
  } catch (e: any) {
    console.error("[translatePrompt] Erro:", e?.message);
    return promptPtBr;
  }
}

export async function generateMultiProductThumbPromptSuggestion(
  listingId: number,
  userId: number,
  photoUrls?: string[],
): Promise<{ prompt: string }> {
  await loadAiProviderFromDb();
  const ctx = await resolveListingContext(listingId, userId);
  const { listing, principal, category, resolved, variation2Type, variation2Options } = ctx;

  const visualAnalysis = photoUrls && photoUrls.length > 0
    ? await analyzePhotosWithVision(photoUrls)
    : "";

  console.log(
    `[generateThumbPrompt] visualAnalysis: ${visualAnalysis ? visualAnalysis.slice(0, 80) + "..." : "(sem fotos)"}`,
  );

  const variacoesResumo = resolved
    .slice(0, 8)
    .map((r, i) => {
      const partes = [r.name];
      if (r.price) partes.push(`(R$ ${r.price})`);
      if (r.weight) partes.push(`peso ${r.weight}kg`);
      if (r.dimensions) partes.push(`dim ${r.dimensions}cm`);
      return `${i + 1}. ${partes.join(" ")}`;
    })
    .join("\n");

  const variacao2Block = variation2Type && variation2Options && variation2Options.length > 0
    ? `\n\nVariação secundária (${variation2Type}): ${variation2Options.join(", ")}`
    : "";

  const systemPrompt = `Você é especialista em criar thumbnails de alta conversão (CTR) para o marketplace Shopee Brasil. Seu trabalho é gerar PROMPTS DETALHADOS pra IA de geração de imagem (gpt-image-1) criar thumbs CAMPEÃS DE VENDAS.

═══════════════════════════════════════
EXEMPLO DE PROMPT PROFISSIONAL (siga ESSE estilo):
═══════════════════════════════════════

Criar imagem publicitária profissional para e-commerce Shopee, estilo premium e alta conversão, fundo clean branco com detalhes em azul e verde transmitindo limpeza e conservação de alimentos.

Mostrar sacos plásticos transparentes para armazenamento de alimentos, embalagens freezer bags premium, com aparência realista, alta definição, iluminação de estúdio, sombras suaves.

Exibir claramente as variações do anúncio em destaque visual:
KIT 1 UNIDADE
KIT 2 UNIDADES
KIT 3 UNIDADES

Mostrar também as capacidades disponíveis:
2 Litros
3 Litros
5 Litros

CRÍTICO: Inserir alimentos REAIS dentro das embalagens como frutas, legumes, carnes e vegetais frescos para demonstrar uso REAL do produto (não mostrar só embalagens vazias).

Adicionar selos visuais de venda:
✓ Ideal para Freezer
✓ Conserva por Mais Tempo
✓ Reutilizável
✓ Proteção Contra Odor
✓ Organização da Cozinha

Layout marketplace brasileiro, estilo Shopee, elementos grandes, leitura rápida no mobile, foco total em conversão, design moderno, composição equilibrada.

Inserir destaque promocional em cores fortes:
ESCOLHA SUA VARIAÇÃO
2L • 3L • 5L
KITS COM 1, 2 OU 3 UNIDADES

Footer com aplicações ("PERFEITO PARA: CARNES, FRUTAS, LEGUMES, PEIXES, PÃES, FREEZER" — adaptar à categoria do produto)

Fotografia de produto ultra realista, qualidade comercial, estilo anúncio campeão de vendas Shopee mobile.

═══════════════════════════════════════
REGRAS OBRIGATÓRIAS DO PROMPT QUE VOCÊ VAI GERAR:
═══════════════════════════════════════

1. SIGA O ESTILO DO EXEMPLO ACIMA — formato, estrutura, tom
2. MOSTRE O PRODUTO SENDO USADO (com conteúdo real dentro, em contexto de aplicação)
3. DESTAQUE AS VARIAÇÕES com kits visuais (KIT 1 UNIDADE / 2 UNIDADES / 3 UNIDADES — quantidades replicadas)
4. DESTAQUE CAPACIDADES/TAMANHOS se houver (2L, 3L, 5L, 30L, etc)
5. EMBALAGENS SÓ COMO MINI-THUMBS DECORATIVAS (NÃO devem dominar a imagem)
6. FOOTER OBRIGATÓRIO com "PERFEITO PARA:" + 4-6 categorias de aplicação adaptadas ao produto
7. SELOS DE BENEFÍCIO específicos por categoria:
   - Produto alimentar/freezer: "IDEAL FREEZER", "CONSERVA POR MAIS TEMPO", "REUTILIZÁVEL", "PROTEÇÃO CONTRA ODOR"
   - Saco de lixo: "ALTA RESISTÊNCIA", "ANTI-VAZAMENTO", "REFORÇADO", "DIVERSOS TAMANHOS"
   - Cosmético: "DERMATOLOGICAMENTE TESTADO", "HIPOALERGÊNICO", "USO PROFISSIONAL"
   - Limpeza: "ALTA PERFORMANCE", "MULTIUSO", "RENDIMENTO"
   - Adapte conforme categoria identificada
8. CHAMADA "ESCOLHA SUA VARIAÇÃO" ou "ESCOLHA SEU KIT" obrigatória
9. Fundo limpo branco/cinza claro, paleta limpa
10. Português brasileiro COM ACENTOS perfeitos (RESISTÊNCIA, ECONÔMICAS, PRÁTICAS, VERSÁTEIS, TAMANHOS)
11. Mobile-first (textos grandes, leitura rápida)
12. Cor Shopee laranja #ee4d2d em algum elemento de destaque

FORMATO DA RESPOSTA:
- Retorne SÓ o prompt direto pra IA de imagem
- SEM markdown
- SEM "Aqui está o prompt:"
- SEM explicações
- Apenas o prompt completo (300-500 palavras) seguindo o estilo do EXEMPLO`;

  const userPrompt = `Crie um prompt profissional pra IA de imagem gerar a thumb desse anúncio Shopee específico:

═══════════════════════════════════════
DADOS DO ANÚNCIO:
═══════════════════════════════════════

TÍTULO: ${listing.title || "(sem título)"}

PRODUTO PRINCIPAL: ${principal.name}
CATEGORIA: ${category || "Geral"}

VARIAÇÕES (${resolved.length} total):
${variacoesResumo}${variacao2Block}

DESCRIÇÃO RESUMIDA: ${(listing.description || "").slice(0, 800)}
${visualAnalysis ? `\n═══════════════════════════════════════\nANÁLISE VISUAL DAS FOTOS DO PRODUTO (IA Vision):\n═══════════════════════════════════════\n${visualAnalysis}\n` : ""}
═══════════════════════════════════════

TAREFA: gere o prompt COMPLETO seguindo EXATAMENTE o estilo do EXEMPLO no system message, adaptado pra ESSE produto específico. ${visualAnalysis ? "Use a análise visual acima pra descrever o produto com precisão (cor real, formato real, material real)." : ""} Mencione cada variação por nome, especifique as capacidades/quantidades, identifique aplicações reais (o que pode ser guardado/usado), e adapte os selos à categoria. Embalagens fictícias são OK — não precisa replicar a real (foco visual é o produto SENDO USADO com alimentos/aplicações reais dentro).`;

  const llmResponse = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 1500,
  });

  const text = extractTextFromResponse(llmResponse);

  if (!text || text.trim().length < 50) {
    throw new Error("Falha ao gerar prompt — resposta vazia ou muito curta da IA");
  }

  return { prompt: text.trim() };
}

export async function generateMultiProductDescription(
  listingId: number,
  userId: number,
): Promise<string> {
  await loadAiProviderFromDb();
  const { listing, resolved, principal, category, brand, variation2Type, variation2Options, optionDetailsMatrix } =
    await resolveListingContext(listingId, userId);

  const variationsText = resolved
    .map((r) => {
      const parts = [`- ${r.name}`, `R$ ${r.price}`];
      if (r.dimensions) parts.push(r.dimensions);
      if (r.weight) parts.push(`${r.weight}kg`);
      return parts.join(" | ");
    })
    .join("\n");

  // Matriz produto × variação 2 (preço/peso/dim por combinação)
  let matrixText = "";
  if (optionDetailsMatrix.length > 0 && variation2Options.length > 0) {
    const lines: string[] = [];
    optionDetailsMatrix.forEach((row, productIdx) => {
      const product = resolved[productIdx];
      if (!product || !Array.isArray(row)) return;
      lines.push(`\n${product.name}:`);
      row.forEach((cell: any) => {
        if (!cell?.label) return;
        const parts = [`  - ${cell.label}`];
        if (cell.price) parts.push(`R$ ${cell.price}`);
        if (cell.weight) parts.push(`${cell.weight}kg`);
        if (cell.length && cell.width && cell.height) parts.push(`${cell.length}x${cell.width}x${cell.height}cm`);
        lines.push(parts.join(" | "));
      });
    });
    matrixText = `\n\nCombinações Produto × ${variation2Type ?? "Variação 2"}:${lines.join("\n")}`;
  } else if (variation2Options.length > 0) {
    matrixText = `\n\nVariação 2 (${variation2Type ?? "personalizada"}): ${variation2Options.join(", ")}`;
  }

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

Produtos do anúncio (${resolved.length}):
${variationsText}${matrixText}`;

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

/**
 * Gera a thumb (imagem de capa) do anúncio combinado via IA.
 *
 * Usa até 4 imagens dos produtos do listing como referência visual:
 * o principal primeiro, depois os 3 primeiros não-principais. A IA
 * gera uma imagem 1:1 estilo Shopee Brasil (vibrante, vermelho/laranja/
 * amarelo) e o resultado é salvo via storagePut, retornando URL pública.
 *
 * Auto-aplica em multi_product_listings.thumbUrl + thumbStatus='generated'.
 */
export async function generateMultiProductThumb(
  listingId: number,
  userId: number,
  extraPrompt?: string,
  selectedImageUrls?: string[],
  headerText?: string,
  style?: ThumbStyle,
  badges?: ThumbBadge[],
  color?: ThumbColor,
  promptBase?: ThumbPromptBase,
  composicao?: ThumbToggleComposicao[],
  contexto?: ThumbToggleContexto[],
  enfase?: ThumbToggleEnfase[],
  customPrompt?: string,
  creativeMode?: boolean,
): Promise<{ thumbUrl: string; promptUsed: string; promptEnUsed: string }> {
  const { resolved, principal, category } = await resolveListingContext(listingId, userId);

  let referenceImages: Array<{ url: string }> = [];

  if (selectedImageUrls && selectedImageUrls.length > 0) {
    // Modo manual: usa as URLs escolhidas pelo usuário no modal (até 16)
    referenceImages = selectedImageUrls.slice(0, 16).map((url) => ({ url }));
  } else {
    // Modo auto (backward compat): principal primeiro + até 3 outros, foto principal de cada
    const others = resolved
      .filter((r) => !(r.source === principal.source && r.sourceId === principal.sourceId))
      .slice(0, 3);
    const refItems = [principal, ...others];
    for (const item of refItems) {
      if (item.source === "baselinker") {
        const [p] = await sharedDb
          .select({ imageUrl: productCache.imageUrl })
          .from(productCache)
          .where(eq(productCache.productId, item.sourceId))
          .limit(1);
        if (p?.imageUrl) referenceImages.push({ url: p.imageUrl });
      } else {
        const [p] = await sharedDb
          .select({ imageUrl: shopeeProducts.imageUrl })
          .from(shopeeProducts)
          .where(eq(shopeeProducts.itemId, item.sourceId))
          .limit(1);
        if (p?.imageUrl) referenceImages.push({ url: p.imageUrl });
      }
    }
  }

  const productCount = resolved.length;
  const refsCount = referenceImages.length;
  const autoHeader = `${productCount} TIPOS DE ${(category ?? "PRODUTOS").toUpperCase()}`;
  const headerLine = (headerText?.trim() ? headerText.trim() : autoHeader);
  const principalName = principal.name;
  const extraInstructions = extraPrompt
    ? `\n\nINSTRUÇÕES EXTRAS DO USUÁRIO:\n${extraPrompt.trim()}`
    : "";

  const styleSection = buildStylePromptSection(style, badges ?? [], color);
  const narrativeSection = buildNarrativePromptSection(
    promptBase,
    composicao ?? [],
    contexto ?? [],
    enfase ?? [],
  );

  const hasCustomPrompt = customPrompt && customPrompt.trim().length > 0;
  if (hasCustomPrompt) {
    console.log(
      `[generateThumb] Modo customPrompt — usando ${customPrompt!.trim().length} chars de prompt manual (ignorando style/badges/color/promptBase/toggles)`,
    );
  }
  const prompt = hasCustomPrompt
    ? customPrompt!.trim()
    : `Crie uma thumbnail para anúncio combinado no estilo Shopee/Mercado Livre.

LAYOUT OBRIGATÓRIO:
- Imagem quadrada 1:1 (1024×1024)
- Header no topo: texto grande, negrito, conteúdo "${headerLine}"
- Sub-header logo abaixo com 2-3 benefícios curtos (adapte ao tipo de produto)
- Corpo central: os ${refsCount} produtos enfileirados horizontalmente em ordem, cada um com um círculo numerado (1, 2, 3...) acima, e label curto abaixo (máx 3 palavras: ex. "PIA E BANHEIRO", "100 LITROS", "30 LITROS PRETO")
- Footer com 3 ou 4 selos de benefício adequados ao produto

ORTOGRAFIA CRÍTICA — PORTUGUÊS DO BRASIL:

Todo texto da imagem DEVE estar em português brasileiro CORRETO. Erros ortográficos arruínam a venda. ATENÇÃO ESPECIAL a estas palavras (use EXATAMENTE como escritas, com acentos):

- RESISTÊNCIA (com Ê, com S antes de T, com Ê de novo) — não "RESISIERCIA" nem "RESISTENCIA"
- PRÁTICAS (com Á acentuado) — não "PRATICAS"
- VERSÁTEIS (com Á acentuado, S no fim) — não "VERSATEIS"
- ECONÔMICAS (com Ô acentuado, com C, não com S) — não "SBONOMICAS" nem "ECONOMICAS"
- TAMANHOS (com NH) — não "TAMATHOS"
- QUALIDADE (Q-U-A-L-I-D-A-D-E)
- EMBALAGENS (E-M-B-A-L-A-G-E-N-S)
- DIVERSOS (D-I-V-E-R-S-O-S)
- ALTA (A-L-T-A, simples)
- ENTREGA (E-N-T-R-E-G-A)
- GARANTIA (G-A-R-A-N-T-I-A)
- PRODUTOS (P-R-O-D-U-T-O-S)
- OFERTA (O-F-E-R-T-A)
- TIPOS (T-I-P-O-S)
- LITROS (L-I-T-R-O-S)
- PARA (P-A-R-A) — não "PORA" nem "PRA"

REGRAS:
1. Se for desenhar uma palavra, faça letra por letra como listado acima
2. Use APENAS palavras curtas (até 10 letras quando possível)
3. Se uma palavra é difícil, prefira sinônimo simples ou abreviação
4. NÃO invente palavras nem misture letras parecidas (T↔N, M↔N, S↔B, R↔F)
5. Texto em CAIXA ALTA é mais fácil de acertar — prefira CAIXA ALTA

VOCABULÁRIO PERMITIDO (use só desta lista):
KIT • COMBO • OFERTA • NOVO • TIPOS • PRODUTOS • LITROS • UNIDADES • RESISTENTE • PRÁTICO • VERSÁTIL • ALTA RESISTÊNCIA • DIVERSOS TAMANHOS • QUALIDADE • EMBALAGENS • ECONÔMICAS • GARANTIA • PRONTA ENTREGA • MAIS VENDIDO • NF EMITIDA • FRETE GRÁTIS • ENVIO RÁPIDO

USO DAS IMAGENS DE REFERÊNCIA (CRÍTICO):
- Use as ${refsCount} imagens fornecidas como referência VISUAL FIEL dos produtos
- Cada produto na thumb DEVE ser visualmente idêntico ao da referência (cor, formato, embalagem, logo)
- NÃO invente produtos, NÃO substitua por genéricos
- Mantenha a ORDEM das imagens de referência (1ª imagem = produto 1 na thumb, 2ª = produto 2, etc.)

PRESERVAÇÃO DAS EMBALAGENS (CRÍTICO):
- As imagens de referência mostram embalagens com TEXTO e LOGOS reais (marca, nome do produto)
- NÃO re-desenhe esse texto da embalagem — copie como adesivo/sticker EXATO da foto
- Se a embalagem tem "Emba Lixo" escrito, mantenha "Emba Lixo" idêntico (mesma fonte, cor, espaçamento)
- NUNCA renderize a embalagem desfocada — mantenha NÍTIDA como na foto original
- Se não conseguir renderizar nítido, deixe APENAS o produto/objeto sem texto da embalagem
- Texto da embalagem deve ficar LEGÍVEL e idêntico à foto, nada de "blur" ou "smudge"

REGRAS GERAIS DE ESTILO:
- Tipografia: sans-serif bold (Montserrat ou similar), salvo override do estilo abaixo
- Composição limpa, alto contraste
- Sem texto pequeno ilegível, sem mockups 3D abstratos
- Foto realística dos produtos (não cartoon, não ilustração)
${styleSection}${narrativeSection}

CONTEXTO:
Produto Principal: ${principalName}${extraInstructions}`;

  console.log("[AUDIT-THUMB-START] ============================");
  console.log("[AUDIT-THUMB-START] listingId:", listingId, "userId:", userId);
  console.log("[AUDIT-THUMB-START] creativeMode:", creativeMode);
  console.log("[AUDIT-THUMB-START] referenceImages count:", referenceImages.length);
  console.log("[AUDIT-THUMB-START] referenceImages será enviado?:", creativeMode ? "NÃO (modo criativo)" : "SIM");

  console.log("[generateThumb] Traduzindo prompt PT-BR → EN...");
  const promptEn = await translatePromptToEnglish(prompt);

  const result = await generateImage({
    prompt: promptEn,
    originalImages: creativeMode ? [] : referenceImages,
  });

  if (!result.url) {
    throw new Error("Geração de thumb falhou — IA não retornou URL.");
  }

  await sharedDb
    .update(multiProductListings)
    .set({ thumbUrl: result.url, thumbStatus: "generated" })
    .where(and(
      eq(multiProductListings.id, listingId),
      eq(multiProductListings.userId, userId),
    ));

  return { thumbUrl: result.url, promptUsed: prompt, promptEnUsed: promptEn };
}

export async function generateMultiProductThumbBatch(
  count: number,
  listingId: number,
  userId: number,
  selectedImageUrls?: string[],
  extraPrompt?: string,
  headerText?: string,
  style?: ThumbStyle,
  badges?: ThumbBadge[],
  color?: ThumbColor,
  promptBase?: ThumbPromptBase,
  composicao?: ThumbToggleComposicao[],
  contexto?: ThumbToggleContexto[],
  enfase?: ThumbToggleEnfase[],
  customPrompt?: string,
  creativeMode?: boolean,
): Promise<{
  results: Array<{ thumbUrl: string; promptUsed: string; promptEnUsed: string; variantIndex: number }>;
  errors: Array<{ variantIndex: number; error: string }>;
}> {
  const safeCount = Math.max(1, Math.min(4, Math.floor(count || 1)));

  console.log(`[generateThumbBatch] Gerando ${safeCount} variações em paralelo...`);

  const variationTwists = [
    "",
    "\n\nVARIATION B: emphasize promotional badges and discount tags more prominently. Use vibrant warm colors (orange #ee4d2d, red, yellow).",
    "\n\nVARIATION C: emphasize lifestyle context — show the product being USED in real-world settings (kitchen, freezer, home). Soft natural lighting.",
    "\n\nVARIATION D: emphasize brand authority and premium quality. Cleaner minimalist composition, more whitespace, premium typography, sophisticated palette.",
  ];

  const variantPrompts = Array.from({ length: safeCount }, (_, i) => {
    const baseCustom = customPrompt || "";
    return baseCustom + (variationTwists[i] || "");
  });

  const promises = variantPrompts.map((variantPrompt, idx) =>
    generateMultiProductThumb(
      listingId,
      userId,
      extraPrompt,
      selectedImageUrls,
      headerText,
      style,
      badges,
      color,
      promptBase,
      composicao,
      contexto,
      enfase,
      variantPrompt || customPrompt,
      creativeMode,
    ).then((result) => ({ ...result, variantIndex: idx }))
      .catch((err) => {
        console.error(`[generateThumbBatch] Erro variante ${idx}:`, err?.message);
        throw { variantIndex: idx, error: err?.message ?? String(err) };
      })
  );

  const settled = await Promise.allSettled(promises);

  const results: Array<{ thumbUrl: string; promptUsed: string; promptEnUsed: string; variantIndex: number }> = [];
  const errors: Array<{ variantIndex: number; error: string }> = [];

  for (const r of settled) {
    if (r.status === "fulfilled") {
      results.push(r.value);
    } else {
      const reason = r.reason as any;
      errors.push({
        variantIndex: reason?.variantIndex ?? -1,
        error: reason?.error ?? reason?.message ?? "Erro desconhecido",
      });
    }
  }

  console.log(`[generateThumbBatch] Concluído: ${results.length} sucesso, ${errors.length} falhas`);

  if (results.length === 0) {
    throw new Error(
      `Todas as ${safeCount} gerações falharam. Primeiro erro: ${errors[0]?.error ?? "desconhecido"}`,
    );
  }

  return { results, errors };
}
