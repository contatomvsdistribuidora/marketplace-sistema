/**
 * AI Mapper Module
 * Uses LLM to map product categories and fill technical specifications
 */
import { invokeLLM } from "./_core/llm";

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  confidence: number;
  reasoning: string;
}

export interface AttributeSuggestion {
  attributeName: string;
  attributeId: string;
  value: string;
  confidence: number;
  source: string; // "extracted" | "inferred" | "default"
}

export interface ProductAnalysis {
  suggestedCategories: CategorySuggestion[];
  suggestedAttributes: AttributeSuggestion[];
  productSummary: string;
}

/**
 * Map a product to the best category in a marketplace
 */
export async function mapProductCategory(
  product: {
    name: string;
    description: string;
    features: Record<string, string>;
    category: string;
    ean?: string;
    sku?: string;
  },
  marketplace: string,
  availableCategories: { id: string; name: string; path?: string }[]
): Promise<CategorySuggestion[]> {
  // Build a compact category list for the prompt (limit to avoid token overflow)
  const categoryList = availableCategories
    .slice(0, 500)
    .map(c => `${c.id}: ${c.path || c.name}`)
    .join("\n");

  const featuresText = Object.entries(product.features || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em categorização de produtos para marketplaces brasileiros. 
Analise o produto fornecido e sugira as 3 melhores categorias do marketplace ${marketplace}.
Responda APENAS em JSON válido, sem markdown.`,
      },
      {
        role: "user",
        content: `Produto:
Nome: ${product.name}
Descrição: ${(product.description || "").substring(0, 1000)}
Categoria atual: ${product.category || "N/A"}
Características: ${featuresText || "N/A"}
EAN: ${product.ean || "N/A"}

Categorias disponíveis no marketplace ${marketplace}:
${categoryList}

Retorne um JSON com a seguinte estrutura:
{
  "suggestions": [
    {
      "categoryId": "ID da categoria",
      "categoryName": "Nome da categoria",
      "categoryPath": "Caminho completo",
      "confidence": 95,
      "reasoning": "Motivo da escolha"
    }
  ]
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "category_mapping",
        strict: true,
        schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  categoryId: { type: "string" },
                  categoryName: { type: "string" },
                  categoryPath: { type: "string" },
                  confidence: { type: "integer" },
                  reasoning: { type: "string" },
                },
                required: ["categoryId", "categoryName", "categoryPath", "confidence", "reasoning"],
                additionalProperties: false,
              },
            },
          },
          required: ["suggestions"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return [];
    const parsed = JSON.parse(content);
    return parsed.suggestions || [];
  } catch {
    return [];
  }
}

/**
 * Extract and fill technical attributes for a product
 */
export async function fillProductAttributes(
  product: {
    name: string;
    description: string;
    features: Record<string, string>;
    category: string;
  },
  requiredAttributes: { name: string; id: string; required: boolean; options?: string[] }[],
  marketplace: string
): Promise<AttributeSuggestion[]> {
  const featuresText = Object.entries(product.features || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const attributesList = requiredAttributes
    .map(a => {
      let desc = `- ${a.name} (ID: ${a.id}, ${a.required ? "OBRIGATÓRIO" : "opcional"})`;
      if (a.options && a.options.length > 0) {
        desc += ` [Opções: ${a.options.slice(0, 20).join(", ")}]`;
      }
      return desc;
    })
    .join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em fichas técnicas de produtos para marketplaces brasileiros.
Analise o produto e preencha os atributos solicitados extraindo informações do nome, descrição e características.
Se não conseguir extrair um valor, tente inferir com base no tipo de produto.
Responda APENAS em JSON válido, sem markdown.`,
      },
      {
        role: "user",
        content: `Produto:
Nome: ${product.name}
Descrição: ${(product.description || "").substring(0, 2000)}
Categoria: ${product.category || "N/A"}
Características existentes:
${featuresText || "Nenhuma"}

Atributos a preencher para o marketplace ${marketplace}:
${attributesList}

Retorne um JSON com a seguinte estrutura:
{
  "attributes": [
    {
      "attributeName": "Nome do atributo",
      "attributeId": "ID do atributo",
      "value": "Valor sugerido",
      "confidence": 90,
      "source": "extracted"
    }
  ]
}

Onde source pode ser:
- "extracted": valor encontrado diretamente no texto
- "inferred": valor deduzido pelo contexto
- "default": valor padrão genérico`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "attribute_fill",
        strict: true,
        schema: {
          type: "object",
          properties: {
            attributes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  attributeName: { type: "string" },
                  attributeId: { type: "string" },
                  value: { type: "string" },
                  confidence: { type: "integer" },
                  source: { type: "string" },
                },
                required: ["attributeName", "attributeId", "value", "confidence", "source"],
                additionalProperties: false,
              },
            },
          },
          required: ["attributes"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return [];
    const parsed = JSON.parse(content);
    return parsed.attributes || [];
  } catch {
    return [];
  }
}

/**
 * Analyze a product and provide complete mapping suggestions
 */
export async function analyzeProduct(
  product: {
    name: string;
    description: string;
    features: Record<string, string>;
    category: string;
  },
  marketplace: string
): Promise<{ summary: string; keywords: string[]; suggestedCategory: string }> {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em análise de produtos para e-commerce brasileiro.
Analise o produto e forneça um resumo, palavras-chave e sugestão de categoria genérica.
Responda APENAS em JSON válido.`,
      },
      {
        role: "user",
        content: `Produto:
Nome: ${product.name}
Descrição: ${(product.description || "").substring(0, 1500)}
Categoria atual: ${product.category || "N/A"}

Retorne:
{
  "summary": "Resumo do produto em 1-2 frases",
  "keywords": ["palavra1", "palavra2"],
  "suggestedCategory": "Categoria genérica sugerida"
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "product_analysis",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
            suggestedCategory: { type: "string" },
          },
          required: ["summary", "keywords", "suggestedCategory"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return { summary: "", keywords: [], suggestedCategory: "" };
    return JSON.parse(content);
  } catch {
    return { summary: "", keywords: [], suggestedCategory: "" };
  }
}

/**
 * Generate an optimized title for marketplace listing
 * Creates a title that is similar but not identical to the original,
 * optimized for marketplace SEO and following best practices
 */
export async function generateOptimizedTitle(
  product: {
    name: string;
    description: string;
    features: Record<string, string>;
    category: string;
    ean?: string;
  },
  marketplace: string
): Promise<{ title: string; reasoning: string }> {
  const featuresText = Object.entries(product.features || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Você é um especialista em SEO para marketplaces brasileiros, especialmente ${marketplace}.
Crie um título otimizado para o anúncio do produto seguindo estas regras:
- Máximo 60 caracteres para Mercado Livre
- Inclua marca, modelo e características principais
- NÃO use caixa alta completa (ALL CAPS)
- NÃO use caracteres especiais desnecessários
- Use palavras-chave relevantes para busca
- O título deve ser DIFERENTE do original mas descrever o mesmo produto
- Priorize: Marca + Produto + Modelo + Característica principal
Responda APENAS em JSON válido.`,
      },
      {
        role: "user",
        content: `Produto:
Nome original: ${product.name}
Descrição: ${(product.description || "").substring(0, 1000)}
Categoria: ${product.category || "N/A"}
Características: ${featuresText || "N/A"}
EAN: ${product.ean || "N/A"}

Retorne:
{
  "title": "Título otimizado para o marketplace",
  "reasoning": "Explicação das mudanças feitas"
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "optimized_title",
        strict: true,
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["title", "reasoning"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const content = response.choices?.[0]?.message?.content as string | undefined;
    if (!content) return { title: product.name, reasoning: "Falha ao gerar título" };
    return JSON.parse(content);
  } catch {
    return { title: product.name, reasoning: "Falha ao gerar título" };
  }
}
