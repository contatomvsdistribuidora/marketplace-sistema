export type ThumbStyle =
  | "mercadao"
  | "premium"
  | "kit-familia"
  | "profissional"
  | "atacado"
  | "relampago"
  | "eco"
  | "sazonal";

export type ThumbBadge =
  | "oferta"
  | "mais-vendido"
  | "nf-emitida"
  | "garantia"
  | "envio-24h"
  | "atacado"
  | "pronta-entrega"
  | "frete-gratis";

export type ThumbColor =
  | "vermelho"
  | "laranja"
  | "amarelo"
  | "verde"
  | "azul"
  | "roxo"
  | "preto"
  | "branco";

export const THUMB_STYLES: Record<ThumbStyle, { label: string; icon: string; description: string }> = {
  "mercadao": { label: "Mercadão", icon: "🛒", description: "Vermelho/amarelo, vários selos, ofertas agressivas" },
  "premium": { label: "Premium", icon: "⭐", description: "Preto/dourado, elegante, sem poluição" },
  "kit-familia": { label: "Kit Família", icon: "👨‍👩‍👧", description: "Laranja/azul, 'Para Toda Família', uso doméstico" },
  "profissional": { label: "Profissional", icon: "🔧", description: "Azul/cinza, sério, B2B, alta resistência" },
  "atacado": { label: "Atacado/Econômico", icon: "💰", description: "Verde/laranja, destaque quantidade, melhor custo-benefício" },
  "relampago": { label: "Oferta Relâmpago", icon: "⚡", description: "Vermelho/preto/amarelo, urgência, 'últimas unidades'" },
  "eco": { label: "Eco/Natural", icon: "🌿", description: "Verde sage/marrom, clean, biodegradável" },
  "sazonal": { label: "Sazonal/Presente", icon: "🎁", description: "Cores festivas, ideal para datas comemorativas" },
};

export const THUMB_BADGES: Record<ThumbBadge, { label: string; promptText: string }> = {
  "oferta": { label: "OFERTA", promptText: "selo OFERTA chamativo em vermelho/amarelo" },
  "mais-vendido": { label: "MAIS VENDIDO", promptText: "selo MAIS VENDIDO com troféu ou estrelas" },
  "nf-emitida": { label: "NF EMITIDA", promptText: "selo discreto NF EMITIDA em cinza" },
  "garantia": { label: "GARANTIA", promptText: "selo GARANTIA com escudo" },
  "envio-24h": { label: "ENVIO 24H", promptText: "selo ENVIO 24H com relógio" },
  "atacado": { label: "ATACADO", promptText: "selo ATACADO destacando quantidade" },
  "pronta-entrega": { label: "PRONTA ENTREGA", promptText: "selo PRONTA ENTREGA chamativo" },
  "frete-gratis": { label: "FRETE GRÁTIS", promptText: "selo FRETE GRÁTIS verde" },
};

export const THUMB_COLORS: Record<ThumbColor, { label: string; hex: string; promptText: string }> = {
  "vermelho": { label: "Vermelho", hex: "#dc2626", promptText: "paleta predominantemente vermelha" },
  "laranja": { label: "Laranja", hex: "#ea580c", promptText: "paleta predominantemente laranja" },
  "amarelo": { label: "Amarelo", hex: "#eab308", promptText: "paleta predominantemente amarela" },
  "verde": { label: "Verde", hex: "#16a34a", promptText: "paleta predominantemente verde" },
  "azul": { label: "Azul", hex: "#2563eb", promptText: "paleta predominantemente azul marinho" },
  "roxo": { label: "Roxo", hex: "#9333ea", promptText: "paleta predominantemente roxo" },
  "preto": { label: "Preto", hex: "#171717", promptText: "paleta predominantemente preta com detalhes dourados" },
  "branco": { label: "Branco", hex: "#f5f5f5", promptText: "fundo branco minimalista com detalhes neutros" },
};

export const MAX_THUMB_BADGES = 4;

export function buildStylePromptSection(
  style: ThumbStyle | undefined,
  badges: ThumbBadge[],
  color: ThumbColor | undefined,
): string {
  const styleTemplates: Record<ThumbStyle, string> = {
    "mercadao": `ESTILO MERCADÃO (Shopee/Magazine Luiza popular):
- Cores: vermelho fogo, amarelo, branco, alto contraste
- Header: GIGANTE, negrito, fundo vermelho, fonte sans-serif bold tipo Bebas Neue
- Visual agressivo e chamativo, estilo "feirão de promoção"
- Selos berrantes, fitas decorativas
- Composição cheia, mas organizada`,
    "premium": `ESTILO PREMIUM (Apple/marcas top):
- Cores: preto profundo, dourado/grafite, branco
- Header: fonte ELEGANTE fina (estilo Playfair Display ou Inter Light), letras espaçadas
- MUITO espaço em branco, minimalismo
- Sem selos berrantes — máximo 1 selo "PREMIUM" discreto em dourado
- Composição limpa, alta sofisticação, fundo escuro`,
    "kit-familia": `ESTILO KIT FAMÍLIA:
- Cores: laranja quente, azul céu, branco
- Header: "PARA TODA FAMÍLIA" ou "USO DOMÉSTICO"
- Produtos dispostos como se estivessem em uso (cozinha/banheiro contexto)
- Visual amigável e acolhedor
- Selos: "PRÁTICO", "ECONÔMICO"`,
    "profissional": `ESTILO PROFISSIONAL/INDUSTRIAL:
- Cores: azul marinho, cinza grafite, branco
- Header: "USO PROFISSIONAL" ou "ALTA RESISTÊNCIA"
- Layout SÉRIO, técnico, sem firulas decorativas
- Sem cores berrantes ou elementos infantis
- Selos: "ATACADO CNPJ", "CERTIFICADO", "RESISTÊNCIA"`,
    "atacado": `ESTILO ATACADO/ECONÔMICO:
- Cores: verde forte, laranja, branco
- Header: DESTACAR QUANTIDADE em fonte gigante (ex: "100 UNIDADES")
- Mensagem de economia ("ECONOMIA DE 40%", "MELHOR CUSTO-BENEFÍCIO")
- Visual de "muito por pouco"`,
    "relampago": `ESTILO OFERTA RELÂMPAGO:
- Cores: vermelho fogo, preto, amarelo elétrico
- Header: "ÚLTIMAS UNIDADES" ou "OFERTA RELÂMPAGO"
- Elementos de URGÊNCIA: raios, relógio, "AGORA"
- Visual frenético mas profissional, alto contraste`,
    "eco": `ESTILO ECO/NATURAL:
- Cores: verde sage, marrom terra, bege, branco off-white
- Header: fonte SERIF clean, "BIODEGRADÁVEL" ou "ECOFRIENDLY"
- Fundo natural/orgânico, sem cores berrantes
- Selos com folhas, símbolos de reciclagem
- Atmosfera consciente e tranquila`,
    "sazonal": `ESTILO SAZONAL/PRESENTE:
- Cores festivas (vermelho+dourado+verde para Natal, ou cores específicas da data)
- Header: "PRESENTE PERFEITO" ou "ESPECIAL DE [DATA]"
- Elementos decorativos: fitas, laços, glitter
- Visual festivo e celebrativo`,
  };

  const colorOverride = color
    ? `\n\nSOBRESCRITA DE COR: ${THUMB_COLORS[color].promptText}.`
    : "";

  const badgesSection = badges.length > 0
    ? `\n\nSELOS OBRIGATÓRIOS (adicione visualmente):
${badges.map((b) => `- ${THUMB_BADGES[b].promptText}`).join("\n")}`
    : "";

  const styleSection = style
    ? `\n\n${styleTemplates[style]}`
    : `\n\nESTILO PADRÃO Shopee popular (laranja/vermelho/branco, layout numerado).`;

  return `${styleSection}${colorOverride}${badgesSection}`;
}
