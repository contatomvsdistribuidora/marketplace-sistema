import { invokeLLM, type InvokeResult } from "./_core/llm";
import { loadAiProviderFromDb } from "./lib/ai-provider";
import { generateImage } from "./_core/imageGeneration";
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

export async function generateMultiProductThumbPromptSuggestion(
  listingId: number,
  userId: number,
): Promise<{ prompt: string }> {
  await loadAiProviderFromDb();
  const ctx = await resolveListingContext(listingId, userId);
  const { listing, principal, category, resolved, variation2Type, variation2Options } = ctx;

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

  const systemPrompt = `Você é especialista em criar thumbnails de alta conversão (CTR) para o marketplace Shopee Brasil. Conhece TUDO sobre:
- Layout que funciona em mobile (Shopee é 90% mobile)
- Cores oficiais Shopee: laranja #ee4d2d, vermelho, amarelo, branco
- Vocabulário comercial PT-BR correto (zero typos, sempre com acentos)
- Selos que vendem: OFERTA, MAIS VENDIDO, FRETE GRÁTIS, GARANTIA, PRONTA ENTREGA, NF EMITIDA
- Tipografia bold sans-serif gigante (Inter Black, Bebas Neue, Anton)
- Como destacar VARIAÇÕES de um anúncio (numeração, capacidades, kits)
- Layout testado de top sellers brasileiros

Sua tarefa: gerar um PROMPT EM PORTUGUÊS BRASILEIRO detalhado (300-500 palavras) pra IA de geração de imagem (gpt-image-1) criar uma thumb campeã de vendas Shopee.

REGRAS DO PROMPT QUE VOCÊ VAI GERAR:
1. Mencione EXPLICITAMENTE cada variação do anúncio (nome, capacidade, qty)
2. Inclua a cor oficial Shopee #ee4d2d
3. Especifique tipografia bold extra-pesada
4. Liste selos visuais relevantes pra categoria do produto
5. Destaque que é mobile-first (textos GRANDES)
6. Vocabulário PT-BR correto (sem errar acentos: RESISTÊNCIA, ECONÔMICAS, PRÁTICAS, VERSÁTEIS, TAMANHOS, ENTREGA)
7. Solicite alimentos/contexto de uso real se for produto de cozinha/armazenamento
8. Inclua chamadas: "ESCOLHA SUA VARIAÇÃO", "MAIS VENDIDO", "TODOS OS TAMANHOS"
9. Especifique layout numerado (1, 2, 3...) se houver múltiplas variações
10. Fundo limpo branco/cinza claro
11. Especifique preservação das embalagens reais (não desfocar logos/textos)

NÃO inclua explicações, blocos markdown, nem prefixo "Aqui está o prompt:". Retorne SÓ o prompt direto pra IA de imagem.`;

  const userPrompt = `Crie o prompt profissional pra IA de imagem gerar a thumb desse anúncio Shopee:

TÍTULO DO ANÚNCIO: ${listing.title || "(sem título)"}

PRODUTO PRINCIPAL: ${principal.name}
CATEGORIA: ${category || "Geral"}

VARIAÇÕES (${resolved.length} total):
${variacoesResumo}${variacao2Block}

DESCRIÇÃO RESUMIDA: ${(listing.description || "").slice(0, 800)}

Agora, gere o prompt detalhado pra IA de imagem criar a thumb Shopee de alta conversão.`;

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
): Promise<{ thumbUrl: string; promptUsed: string }> {
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

  const prompt = customPrompt && customPrompt.trim().length > 0
    ? customPrompt.trim()
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

  const result = await generateImage({
    prompt,
    originalImages: referenceImages,
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

  return { thumbUrl: result.url, promptUsed: prompt };
}
