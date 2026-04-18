/**
 * Shopee Product Quality Optimizer Module
 * Uses AI to analyze and optimize product listings for maximum Shopee ranking.
 *
 * Criteria based on Shopee's 2026 algorithm:
 * - Title: 80-120 chars, [Brand] + [Product Type] + [Key Features] + [Benefit]
 * - Description: 300+ words, structured, keyword-rich
 * - Images: 5+ high-quality images (1024x1024+)
 * - Video: Product video present
 * - Attributes: All mandatory + 80%+ optional filled
 * - Category: Correct and most specific
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { shopeeProducts, shopeeAccounts } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

// ============ QUALITY SCORE CALCULATION ============

export interface QualityDiagnostic {
  overallScore: number; // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  categories: {
    title: { score: number; maxScore: number; issues: string[]; suggestions: string[] };
    description: { score: number; maxScore: number; issues: string[]; suggestions: string[] };
    images: { score: number; maxScore: number; issues: string[]; suggestions: string[] };
    video: { score: number; maxScore: number; issues: string[]; suggestions: string[] };
    attributes: { score: number; maxScore: number; issues: string[]; suggestions: string[] };
    dimensions: { score: number; maxScore: number; issues: string[]; suggestions: string[] };
  };
}

/**
 * Calculate quality score for a single product based on Shopee's criteria.
 */
export function calculateQualityScore(product: any): QualityDiagnostic {
  const categories: QualityDiagnostic["categories"] = {
    title: { score: 0, maxScore: 25, issues: [], suggestions: [] },
    description: { score: 0, maxScore: 25, issues: [], suggestions: [] },
    images: { score: 0, maxScore: 20, issues: [], suggestions: [] },
    video: { score: 0, maxScore: 10, issues: [], suggestions: [] },
    attributes: { score: 0, maxScore: 15, issues: [], suggestions: [] },
    dimensions: { score: 0, maxScore: 5, issues: [], suggestions: [] },
  };

  // === TITLE (25 pts) ===
  const title = product.itemName || "";
  const titleLen = title.length;

  if (titleLen >= 80 && titleLen <= 120) {
    categories.title.score += 10;
  } else if (titleLen >= 60 && titleLen <= 140) {
    categories.title.score += 6;
    if (titleLen < 80) categories.title.issues.push(`Título curto (${titleLen} chars). Ideal: 80-120 caracteres.`);
    else categories.title.issues.push(`Título longo (${titleLen} chars). Ideal: 80-120 caracteres.`);
  } else if (titleLen >= 30) {
    categories.title.score += 3;
    categories.title.issues.push(`Título muito ${titleLen < 60 ? "curto" : "longo"} (${titleLen} chars). Ideal: 80-120 caracteres.`);
  } else {
    categories.title.issues.push(`Título muito curto (${titleLen} chars). Mínimo recomendado: 60 caracteres.`);
  }

  // Check for brand in title
  const hasBrandIndicator = /^[A-Z][a-zA-Z0-9]+\s/.test(title);
  if (hasBrandIndicator) {
    categories.title.score += 5;
  } else {
    categories.title.issues.push("Título não começa com marca/brand.");
    categories.title.suggestions.push("Adicione a marca no início do título: [Marca] + [Tipo] + [Características]");
  }

  // Check for keyword stuffing (repeated words)
  const words = title.toLowerCase().split(/\s+/);
  const wordCounts = new Map<string, number>();
  for (const w of words) {
    if (w.length > 3) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
  }
  const hasStuffing = Array.from(wordCounts.values()).some(c => c > 2);
  if (!hasStuffing) {
    categories.title.score += 5;
  } else {
    categories.title.issues.push("Possível keyword stuffing detectado (palavras repetidas).");
    categories.title.suggestions.push("Use cada palavra-chave apenas uma vez no título.");
  }

  // Power words check
  const powerWords = ["premium", "original", "autêntico", "novo", "profissional", "kit", "conjunto", "promoção"];
  const hasPowerWord = powerWords.some(pw => title.toLowerCase().includes(pw));
  if (hasPowerWord) {
    categories.title.score += 5;
  } else {
    categories.title.suggestions.push("Adicione palavras de impacto: Premium, Original, Kit, Profissional, etc.");
  }

  // === DESCRIPTION (25 pts) ===
  const desc = product.description || "";
  const descLen = desc.length;
  const descWordCount = desc.split(/\s+/).filter((w: string) => w.length > 0).length;

  if (descWordCount >= 300) {
    categories.description.score += 10;
  } else if (descWordCount >= 150) {
    categories.description.score += 6;
    categories.description.issues.push(`Descrição com ${descWordCount} palavras. Ideal: 300+ palavras.`);
  } else if (descWordCount >= 50) {
    categories.description.score += 3;
    categories.description.issues.push(`Descrição curta (${descWordCount} palavras). Ideal: 300+ palavras.`);
  } else {
    categories.description.issues.push(`Descrição muito curta ou vazia (${descWordCount} palavras). Mínimo: 150 palavras.`);
  }

  // Check for structured content (bullet points, sections)
  const hasStructure = desc.includes("•") || desc.includes("-") || desc.includes("✅") || desc.includes("★") || desc.includes("\n\n");
  if (hasStructure) {
    categories.description.score += 5;
  } else {
    categories.description.suggestions.push("Estruture a descrição com bullet points (•), seções e emojis para melhor leitura.");
  }

  // Check for keywords/features mention
  const hasSpecs = /\d+\s*(cm|mm|ml|g|kg|w|v|mah|gb|mb)/i.test(desc);
  if (hasSpecs) {
    categories.description.score += 5;
  } else {
    categories.description.suggestions.push("Inclua especificações técnicas (medidas, peso, capacidade) na descrição.");
  }

  // Check for call-to-action or benefits
  const hasCTA = /(compre|garanta|aproveite|adicione|confira|não perca|frete|entrega)/i.test(desc);
  if (hasCTA) {
    categories.description.score += 5;
  } else {
    categories.description.suggestions.push("Adicione call-to-action: 'Compre agora', 'Aproveite', 'Frete grátis', etc.");
  }

  // === IMAGES (20 pts) ===
  const images = Array.isArray(product.images) ? product.images : [];
  const imageCount = images.length;

  if (imageCount >= 8) {
    categories.images.score += 15;
  } else if (imageCount >= 5) {
    categories.images.score += 10;
    categories.images.suggestions.push(`${imageCount} imagens. Ideal: 8-9 imagens para máxima conversão.`);
  } else if (imageCount >= 3) {
    categories.images.score += 5;
    categories.images.issues.push(`Apenas ${imageCount} imagens. Mínimo recomendado: 5 imagens.`);
  } else {
    categories.images.issues.push(`Poucas imagens (${imageCount}). Mínimo: 5, ideal: 8-9.`);
  }

  // Main image check
  if (product.imageUrl) {
    categories.images.score += 5;
  } else {
    categories.images.issues.push("Sem imagem principal definida.");
  }

  categories.images.suggestions.push(
    "Sequência ideal: 1) Produto fundo branco, 2) Produto em uso, 3) Features destacadas, 4) Tabela de medidas, 5) Embalagem"
  );

  // === VIDEO (10 pts) ===
  if (product.hasVideo) {
    categories.video.score = 10;
  } else {
    categories.video.issues.push("Produto sem vídeo. Vídeos aumentam significativamente o ranking.");
    categories.video.suggestions.push("Adicione um vídeo de 30-60 segundos mostrando o produto em uso.");
  }

  // === ATTRIBUTES (15 pts) ===
  const attrsFilled = product.attributesFilled || 0;
  const attrsTotal = product.attributesTotal || 0;

  if (attrsTotal > 0) {
    const attrPercent = (attrsFilled / attrsTotal) * 100;
    if (attrPercent === 100) {
      categories.attributes.score = 15;
    } else if (attrPercent >= 80) {
      categories.attributes.score = 10;
      categories.attributes.issues.push(`${attrsFilled}/${attrsTotal} atributos preenchidos (${Math.round(attrPercent)}%).`);
    } else if (attrPercent >= 50) {
      categories.attributes.score = 5;
      categories.attributes.issues.push(`Apenas ${attrsFilled}/${attrsTotal} atributos preenchidos.`);
    } else {
      categories.attributes.issues.push(`Poucos atributos preenchidos: ${attrsFilled}/${attrsTotal}.`);
    }
    categories.attributes.suggestions.push("Preencha 100% dos atributos obrigatórios e opcionais para melhor ranking.");
  } else {
    categories.attributes.issues.push("Nenhum atributo disponível. Verifique a categoria do produto.");
  }

  // === DIMENSIONS (5 pts) ===
  const hasWeight = product.weight && parseFloat(product.weight) > 0;
  const hasLength = product.dimensionLength && parseFloat(product.dimensionLength) > 0;
  const hasWidth = product.dimensionWidth && parseFloat(product.dimensionWidth) > 0;
  const hasHeight = product.dimensionHeight && parseFloat(product.dimensionHeight) > 0;

  let dimScore = 0;
  if (hasWeight) dimScore += 2;
  else categories.dimensions.issues.push("Peso não informado.");
  if (hasLength && hasWidth && hasHeight) dimScore += 3;
  else categories.dimensions.issues.push("Dimensões (C x L x A) incompletas.");
  categories.dimensions.score = dimScore;

  // Calculate overall
  const totalScore =
    categories.title.score +
    categories.description.score +
    categories.images.score +
    categories.video.score +
    categories.attributes.score +
    categories.dimensions.score;

  let grade: QualityDiagnostic["grade"];
  if (totalScore >= 85) grade = "A";
  else if (totalScore >= 70) grade = "B";
  else if (totalScore >= 50) grade = "C";
  else if (totalScore >= 30) grade = "D";
  else grade = "F";

  return {
    overallScore: totalScore,
    grade,
    categories,
  };
}

// ============ AI OPTIMIZATION ============

/**
 * Generate an optimized title using AI based on Shopee SEO best practices.
 */
export async function optimizeTitle(
  currentTitle: string,
  description: string,
  category?: string
): Promise<{ optimizedTitle: string; keywords: string[]; explanation: string }> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em SEO para Shopee Brasil. Sua tarefa é otimizar títulos de produtos para maximizar o ranking na busca da Shopee.

REGRAS OBRIGATÓRIAS:
1. Formato: [Marca] + [Tipo de Produto] + [Características Principais] + [Benefício/Diferencial]
2. Comprimento: 80-120 caracteres (NUNCA menos de 60 ou mais de 140)
3. Coloque as palavras-chave mais importantes nos primeiros 50 caracteres
4. Use palavras de impacto: Premium, Original, Profissional, Kit, etc.
5. NÃO repita palavras-chave (keyword stuffing)
6. NÃO use caracteres especiais desnecessários
7. Inclua variações de busca relevantes (ex: "Capa Case" ao invés de só "Capa")
8. Mantenha o título em português brasileiro natural

Responda APENAS em JSON com o formato:
{
  "optimizedTitle": "título otimizado aqui",
  "keywords": ["palavra1", "palavra2", "palavra3"],
  "explanation": "explicação breve das mudanças"
}`
      },
      {
        role: "user",
        content: `Título atual: "${currentTitle}"
${description ? `Descrição do produto: "${description.substring(0, 500)}"` : ""}
${category ? `Categoria: "${category}"` : ""}

Otimize este título seguindo as regras de SEO da Shopee Brasil.`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "optimized_title",
        strict: true,
        schema: {
          type: "object",
          properties: {
            optimizedTitle: { type: "string", description: "Título otimizado para SEO Shopee" },
            keywords: { type: "array", items: { type: "string" }, description: "Palavras-chave principais" },
            explanation: { type: "string", description: "Explicação das mudanças feitas" },
          },
          required: ["optimizedTitle", "keywords", "explanation"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("AI response was empty");
  }
  return JSON.parse(content);
}

/**
 * Generate an optimized description using AI.
 */
export async function optimizeDescription(
  currentTitle: string,
  currentDescription: string,
  category?: string
): Promise<{ optimizedDescription: string; wordCount: number; explanation: string }> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em copywriting para Shopee Brasil. Sua tarefa é criar descrições de produtos otimizadas para SEO e conversão.

ESTRUTURA OBRIGATÓRIA:
1. ABERTURA (primeiras 100 palavras): Reafirme o produto, destaque o diferencial principal, use a palavra-chave principal
2. CARACTERÍSTICAS (200-300 palavras): Liste as especificações técnicas com bullet points (•), inclua medidas, materiais, capacidade
3. BENEFÍCIOS (100 palavras): Explique como o produto resolve problemas, inclua call-to-action

REGRAS:
- Mínimo 300 palavras, máximo 500
- Use emojis estrategicamente (✅ ★ 📦 🔥) para destacar pontos
- Inclua especificações técnicas (cm, kg, ml, etc.)
- Use bullet points (•) para organizar
- Inclua palavras-chave naturalmente (2-3% de densidade)
- Termine com call-to-action (Compre agora, Adicione ao carrinho, etc.)
- Português brasileiro natural e persuasivo
- NÃO invente especificações que não existem no produto original

Responda APENAS em JSON:
{
  "optimizedDescription": "descrição completa aqui",
  "wordCount": 350,
  "explanation": "explicação das mudanças"
}`
      },
      {
        role: "user",
        content: `Título: "${currentTitle}"
Descrição atual: "${currentDescription || "Sem descrição"}"
${category ? `Categoria: "${category}"` : ""}

Crie uma descrição otimizada para este produto na Shopee Brasil.`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "optimized_description",
        strict: true,
        schema: {
          type: "object",
          properties: {
            optimizedDescription: { type: "string", description: "Descrição otimizada completa" },
            wordCount: { type: "integer", description: "Contagem de palavras" },
            explanation: { type: "string", description: "Explicação das mudanças" },
          },
          required: ["optimizedDescription", "wordCount", "explanation"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("AI response was empty");
  }
  return JSON.parse(content);
}

/**
 * Get comprehensive optimization suggestions for a product.
 */
export async function getOptimizationSuggestions(product: any): Promise<{
  priority: "alta" | "média" | "baixa";
  quickWins: string[];
  detailedSuggestions: Array<{
    area: string;
    currentStatus: string;
    recommendation: string;
    impact: "alto" | "médio" | "baixo";
  }>;
}> {
  const diagnostic = calculateQualityScore(product);

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um consultor especialista em otimização de produtos na Shopee Brasil. Analise o diagnóstico de qualidade do produto e forneça recomendações práticas e priorizadas.

Responda em JSON:
{
  "priority": "alta|média|baixa",
  "quickWins": ["ação rápida 1", "ação rápida 2"],
  "detailedSuggestions": [
    {
      "area": "Título|Descrição|Imagens|Vídeo|Atributos|Dimensões",
      "currentStatus": "status atual",
      "recommendation": "o que fazer",
      "impact": "alto|médio|baixo"
    }
  ]
}`
      },
      {
        role: "user",
        content: `Produto: "${product.itemName}"
Score: ${diagnostic.overallScore}/100 (${diagnostic.grade})
Título: ${product.itemName?.length || 0} chars
Descrição: ${product.description?.split(/\s+/).length || 0} palavras
Imagens: ${Array.isArray(product.images) ? product.images.length : 0}
Vídeo: ${product.hasVideo ? "Sim" : "Não"}
Atributos: ${product.attributesFilled}/${product.attributesTotal}
Peso: ${product.weight || "N/A"}
Dimensões: ${product.dimensionLength || "N/A"} x ${product.dimensionWidth || "N/A"} x ${product.dimensionHeight || "N/A"}

Problemas encontrados:
${Object.entries(diagnostic.categories)
  .flatMap(([cat, data]) => data.issues.map((i: string) => `- [${cat}] ${i}`))
  .join("\n")}

Forneça recomendações priorizadas para melhorar o ranking deste produto na Shopee.`
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "optimization_suggestions",
        strict: true,
        schema: {
          type: "object",
          properties: {
            priority: { type: "string", enum: ["alta", "média", "baixa"] },
            quickWins: { type: "array", items: { type: "string" } },
            detailedSuggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  currentStatus: { type: "string" },
                  recommendation: { type: "string" },
                  impact: { type: "string", enum: ["alto", "médio", "baixo"] },
                },
                required: ["area", "currentStatus", "recommendation", "impact"],
                additionalProperties: false,
              },
            },
          },
          required: ["priority", "quickWins", "detailedSuggestions"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("AI response was empty");
  }
  return JSON.parse(content);
}

// ============ BATCH OPERATIONS ============

/**
 * Get quality diagnostics for all products of an account.
 */
export async function getBatchDiagnostics(accountId: number) {
  const db = getDb();
  const products = await db
    .select()
    .from(shopeeProducts)
    .where(eq(shopeeProducts.shopeeAccountId, accountId))
    .orderBy(desc(shopeeProducts.sold));

  const diagnostics = products.map((p) => {
    const diag = calculateQualityScore(p);
    return {
      productId: p.id,
      itemId: p.itemId,
      itemName: p.itemName,
      imageUrl: p.imageUrl,
      price: p.price,
      sold: p.sold,
      overallScore: diag.overallScore,
      grade: diag.grade,
      categories: diag.categories,
    };
  });

  // Calculate summary stats
  const total = diagnostics.length;
  const avgScore = total > 0 ? Math.round(diagnostics.reduce((sum, d) => sum + d.overallScore, 0) / total) : 0;
  const gradeDistribution = {
    A: diagnostics.filter(d => d.grade === "A").length,
    B: diagnostics.filter(d => d.grade === "B").length,
    C: diagnostics.filter(d => d.grade === "C").length,
    D: diagnostics.filter(d => d.grade === "D").length,
    F: diagnostics.filter(d => d.grade === "F").length,
  };

  // Most common issues
  const issueCount = new Map<string, number>();
  for (const d of diagnostics) {
    for (const [, catData] of Object.entries(d.categories)) {
      for (const issue of catData.issues) {
        issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
      }
    }
  }
  const topIssues = Array.from(issueCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([issue, count]) => ({ issue, count, percent: Math.round((count / total) * 100) }));

  return {
    total,
    avgScore,
    gradeDistribution,
    topIssues,
    products: diagnostics,
  };
}

/**
 * Update quality score in database after calculation.
 */
export async function updateProductQualityScore(productId: number, score: number, grade: string) {
  const db = getDb();
  await db
    .update(shopeeProducts)
    .set({ qualityScore: `${score}-${grade}` })
    .where(eq(shopeeProducts.id, productId));
}

// ============ SHOPEE PRODUCT URL ============

/**
 * Build the direct Shopee product URL for a given item.
 * Shopee Brasil URL format: https://shopee.com.br/product/{shopId}/{itemId}
 */
export function getShopeeProductUrl(shopId: number, itemId: number, region: string = "BR"): string {
  const domains: Record<string, string> = {
    BR: "shopee.com.br",
    SG: "shopee.sg",
    MY: "shopee.com.my",
    TH: "shopee.co.th",
    ID: "shopee.co.id",
    VN: "shopee.vn",
    PH: "shopee.ph",
    TW: "shopee.tw",
    CO: "shopee.com.co",
    CL: "shopee.cl",
    MX: "shopee.com.mx",
  };
  const domain = domains[region] || "shopee.com.br";
  return `https://${domain}/product/${shopId}/${itemId}`;
}

/**
 * Build the Shopee Seller Center edit URL for a product.
 */
export function getSellerCenterUrl(shopId: number, itemId: number, region: string = "BR"): string {
  const domains: Record<string, string> = {
    BR: "seller.shopee.com.br",
    SG: "seller.shopee.sg",
    MY: "seller.shopee.com.my",
    TH: "seller.shopee.co.th",
    ID: "seller.shopee.co.id",
    VN: "seller.shopee.vn",
    PH: "seller.shopee.ph",
    TW: "seller.shopee.tw",
  };
  const domain = domains[region] || "seller.shopee.com.br";
  return `https://${domain}/portal/product/${itemId}`;
}

// ============ PERFECT LISTING CHECKLIST ============

export interface ChecklistItem {
  id: string;
  category: string;
  label: string;
  status: "done" | "missing" | "partial";
  impact: "critical" | "high" | "medium" | "low";
  currentValue: string;
  targetValue: string;
  actionRequired: string;
}

/**
 * Generate a "Perfect Listing" checklist showing exactly what's needed for score 100.
 */
export function generatePerfectChecklist(product: any): {
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
  completionPercent: number;
} {
  const items: ChecklistItem[] = [];
  const title = product.itemName || "";
  const desc = product.description || "";
  const images = Array.isArray(product.images) ? product.images : [];
  const descWordCount = desc.split(/\s+/).filter((w: string) => w.length > 0).length;

  // === TITLE CHECKLIST ===
  items.push({
    id: "title_length",
    category: "Título",
    label: "Título entre 80-120 caracteres",
    status: title.length >= 80 && title.length <= 120 ? "done" : title.length >= 60 ? "partial" : "missing",
    impact: "critical",
    currentValue: `${title.length} caracteres`,
    targetValue: "80-120 caracteres",
    actionRequired: title.length < 80 ? `Adicione mais ${80 - title.length} caracteres ao título` : title.length > 120 ? `Reduza ${title.length - 120} caracteres do título` : "OK",
  });

  items.push({
    id: "title_brand",
    category: "Título",
    label: "Título começa com a marca",
    status: /^[A-Z][a-zA-Z0-9]+\s/.test(title) ? "done" : "missing",
    impact: "high",
    currentValue: title.split(" ")[0] || "Vazio",
    targetValue: "[Marca] no início",
    actionRequired: "Coloque o nome da marca como primeira palavra do título",
  });

  const words = title.toLowerCase().split(/\s+/);
  const wordCounts = new Map<string, number>();
  for (const w of words) { if (w.length > 3) wordCounts.set(w, (wordCounts.get(w) || 0) + 1); }
  const hasStuffing = Array.from(wordCounts.values()).some(c => c > 2);
  items.push({
    id: "title_no_stuffing",
    category: "Título",
    label: "Sem repetição de palavras-chave",
    status: !hasStuffing ? "done" : "missing",
    impact: "high",
    currentValue: hasStuffing ? "Palavras repetidas detectadas" : "OK",
    targetValue: "Cada palavra-chave usada no máximo 2x",
    actionRequired: hasStuffing ? "Remova palavras repetidas do título" : "OK",
  });

  const powerWords = ["premium", "original", "autêntico", "novo", "profissional", "kit", "conjunto", "promoção"];
  const hasPowerWord = powerWords.some(pw => title.toLowerCase().includes(pw));
  items.push({
    id: "title_power_words",
    category: "Título",
    label: "Contém palavras de impacto",
    status: hasPowerWord ? "done" : "missing",
    impact: "medium",
    currentValue: hasPowerWord ? "Contém" : "Não contém",
    targetValue: "Premium, Original, Kit, Profissional, etc.",
    actionRequired: "Adicione uma palavra de impacto ao título",
  });

  // === DESCRIPTION CHECKLIST ===
  items.push({
    id: "desc_length",
    category: "Descrição",
    label: "Descrição com 300+ palavras",
    status: descWordCount >= 300 ? "done" : descWordCount >= 150 ? "partial" : "missing",
    impact: "critical",
    currentValue: `${descWordCount} palavras`,
    targetValue: "300+ palavras",
    actionRequired: descWordCount < 300 ? `Adicione mais ${300 - descWordCount} palavras à descrição` : "OK",
  });

  const hasStructure = desc.includes("•") || desc.includes("-") || desc.includes("✅") || desc.includes("★") || desc.includes("\n\n");
  items.push({
    id: "desc_structure",
    category: "Descrição",
    label: "Descrição estruturada (bullet points, seções)",
    status: hasStructure ? "done" : "missing",
    impact: "high",
    currentValue: hasStructure ? "Estruturada" : "Texto corrido",
    targetValue: "Bullet points (•), seções, emojis",
    actionRequired: "Estruture com bullet points e seções separadas",
  });

  const hasSpecs = /\d+\s*(cm|mm|ml|g|kg|w|v|mah|gb|mb)/i.test(desc);
  items.push({
    id: "desc_specs",
    category: "Descrição",
    label: "Contém especificações técnicas",
    status: hasSpecs ? "done" : "missing",
    impact: "high",
    currentValue: hasSpecs ? "Contém" : "Não contém",
    targetValue: "Medidas, peso, capacidade, material",
    actionRequired: "Inclua especificações técnicas (cm, kg, ml, etc.)",
  });

  const hasCTA = /(compre|garanta|aproveite|adicione|confira|não perca|frete|entrega)/i.test(desc);
  items.push({
    id: "desc_cta",
    category: "Descrição",
    label: "Contém call-to-action",
    status: hasCTA ? "done" : "missing",
    impact: "medium",
    currentValue: hasCTA ? "Contém" : "Não contém",
    targetValue: "Compre agora, Aproveite, Frete grátis",
    actionRequired: "Adicione um call-to-action no final da descrição",
  });

  // === IMAGES CHECKLIST ===
  items.push({
    id: "images_count",
    category: "Imagens",
    label: "8+ imagens do produto",
    status: images.length >= 8 ? "done" : images.length >= 5 ? "partial" : "missing",
    impact: "critical",
    currentValue: `${images.length} imagens`,
    targetValue: "8-9 imagens",
    actionRequired: images.length < 8 ? `Adicione mais ${8 - images.length} imagens` : "OK",
  });

  items.push({
    id: "images_main",
    category: "Imagens",
    label: "Imagem principal definida",
    status: product.imageUrl ? "done" : "missing",
    impact: "critical",
    currentValue: product.imageUrl ? "Definida" : "Não definida",
    targetValue: "Foto principal em fundo branco",
    actionRequired: "Defina uma imagem principal de alta qualidade",
  });

  // === VIDEO CHECKLIST ===
  items.push({
    id: "video_present",
    category: "Vídeo",
    label: "Vídeo do produto adicionado",
    status: product.hasVideo ? "done" : "missing",
    impact: "critical",
    currentValue: product.hasVideo ? "Sim" : "Não",
    targetValue: "Vídeo de 30-60 segundos",
    actionRequired: "Grave e adicione um vídeo mostrando o produto em uso",
  });

  // === ATTRIBUTES CHECKLIST ===
  const attrsFilled = product.attributesFilled || 0;
  const attrsTotal = product.attributesTotal || 0;
  items.push({
    id: "attrs_complete",
    category: "Atributos",
    label: "100% dos atributos preenchidos",
    status: attrsTotal > 0 && attrsFilled === attrsTotal ? "done" : attrsFilled > 0 ? "partial" : "missing",
    impact: "high",
    currentValue: attrsTotal > 0 ? `${attrsFilled}/${attrsTotal} (${Math.round((attrsFilled / attrsTotal) * 100)}%)` : "N/A",
    targetValue: "100% preenchidos",
    actionRequired: attrsTotal > attrsFilled ? `Preencha os ${attrsTotal - attrsFilled} atributos restantes` : "OK",
  });

  // === DIMENSIONS CHECKLIST ===
  const hasWeight = product.weight && parseFloat(product.weight) > 0;
  items.push({
    id: "dim_weight",
    category: "Dimensões",
    label: "Peso do produto informado",
    status: hasWeight ? "done" : "missing",
    impact: "medium",
    currentValue: hasWeight ? `${product.weight} kg` : "Não informado",
    targetValue: "Peso em kg",
    actionRequired: "Informe o peso do produto",
  });

  const hasAllDims = product.dimensionLength && product.dimensionWidth && product.dimensionHeight &&
    parseFloat(product.dimensionLength) > 0 && parseFloat(product.dimensionWidth) > 0 && parseFloat(product.dimensionHeight) > 0;
  items.push({
    id: "dim_size",
    category: "Dimensões",
    label: "Dimensões completas (C x L x A)",
    status: hasAllDims ? "done" : "missing",
    impact: "medium",
    currentValue: hasAllDims ? `${product.dimensionLength} x ${product.dimensionWidth} x ${product.dimensionHeight} cm` : "Incompletas",
    targetValue: "Comprimento x Largura x Altura em cm",
    actionRequired: "Preencha todas as dimensões do produto",
  });

  const completedCount = items.filter(i => i.status === "done").length;
  const totalCount = items.length;
  const completionPercent = Math.round((completedCount / totalCount) * 100);

  return { items, completedCount, totalCount, completionPercent };
}

// ============ BATCH AI OPTIMIZATION ============

/**
 * Batch optimize titles for multiple products using AI.
 * Processes in chunks of 3 to avoid overloading the LLM.
 */
export async function batchOptimizeTitles(
  productIds: number[]
): Promise<Array<{ productId: number; itemName: string; result?: { optimizedTitle: string; keywords: string[]; explanation: string }; error?: string }>> {
  const db = getDb();
  const results: Array<{ productId: number; itemName: string; result?: any; error?: string }> = [];

  // Fetch all products
  const products = [];
  for (const id of productIds) {
    const [p] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, id)).limit(1);
    if (p) products.push(p);
  }

  // Process in chunks of 3
  const chunkSize = 3;
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (p) => {
        const result = await optimizeTitle(
          p.itemName || "",
          p.description || "",
          p.categoryName || undefined
        );
        return { productId: p.id, itemName: p.itemName || "", result };
      })
    );
    for (const r of chunkResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        results.push({ productId: 0, itemName: "", error: r.reason?.message || "Unknown error" });
      }
    }
  }

  return results;
}

/**
 * Batch optimize descriptions for multiple products using AI.
 */
export async function batchOptimizeDescriptions(
  productIds: number[]
): Promise<Array<{ productId: number; itemName: string; result?: { optimizedDescription: string; wordCount: number; explanation: string }; error?: string }>> {
  const db = getDb();
  const results: Array<{ productId: number; itemName: string; result?: any; error?: string }> = [];

  const products = [];
  for (const id of productIds) {
    const [p] = await db.select().from(shopeeProducts).where(eq(shopeeProducts.id, id)).limit(1);
    if (p) products.push(p);
  }

  const chunkSize = 3;
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    const chunkResults = await Promise.allSettled(
      chunk.map(async (p) => {
        const result = await optimizeDescription(
          p.itemName || "",
          p.description || "",
          p.categoryName || undefined
        );
        return { productId: p.id, itemName: p.itemName || "", result };
      })
    );
    for (const r of chunkResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        results.push({ productId: 0, itemName: "", error: r.reason?.message || "Unknown error" });
      }
    }
  }

  return results;
}
