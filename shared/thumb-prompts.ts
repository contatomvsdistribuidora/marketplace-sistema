export type ThumbPromptBase =
  | "especialista-shopee"
  | "top-vendedor" | "premium" | "atacado" | "kit-familia"
  | "oferta-urgencia" | "foco-beneficio" | "eco" | "sazonal"
  | "detalhe-tecnico" | "comparativo";

export type ThumbToggleComposicao =
  | "vitrine-ordenada" | "grade-2x2" | "central" | "empilhamento" | "numeracao";

export type ThumbToggleContexto =
  | "em-uso" | "casa" | "loja" | "fundo-neutro" | "lifestyle-premium";

export type ThumbToggleEnfase =
  | "quantidade" | "variedade" | "qualidade-tecnica" | "economia" | "comparativo-visual";

export const THUMB_PROMPT_BASES: Record<ThumbPromptBase, {
  label: string;
  icon: string;
  description: string;
  basePrompt: string;
  defaultToggles: {
    composicao: ThumbToggleComposicao[];
    contexto: ThumbToggleContexto[];
    enfase: ThumbToggleEnfase[];
  };
}> = {
  "especialista-shopee": {
    label: "Especialista Shopee 🏆",
    icon: "🏆",
    description: "Master vendedor Shopee BR: layout testado, cores oficiais, máximo CTR",
    basePrompt: "Thumb estilo ESPECIALISTA SHOPEE BRASIL (top vendedor): use a cor laranja oficial Shopee #ee4d2d em destaque, layout testado de top sellers Shopee (header gigante no topo + numeração circular laranja 1-N centralizada + selos no rodapé com fundo laranja/amarelo), tipografia bold sans-serif extra-pesada (estilo Inter Black, Bebas Neue, Anton), alta saturação de cores quentes (laranja+vermelho+amarelo+branco), composição agressiva mas legível em tela de celular (Shopee é mobile-first). PRIORIZE legibilidade absoluta sobre estética: textos grandes, contraste máximo, sem detalhes pequenos. Inclua selos visuais nativos Shopee (símbolo de frete grátis, mais vendido)",
    defaultToggles: {
      composicao: ["vitrine-ordenada", "numeracao"],
      contexto: ["fundo-neutro"],
      enfase: ["variedade", "quantidade"],
    },
  },
  "top-vendedor": {
    label: "Top Vendedor Shopee",
    icon: "🛒",
    description: "Padrão Shopee popular, multi-produto numerado",
    basePrompt: "Thumb estilo TOP SELLER Shopee Brasil: layout padrão de vendedor experiente, paleta laranja+vermelho+amarelo+branco, alta saturação, vendabilidade máxima",
    defaultToggles: { composicao: ["vitrine-ordenada", "numeracao"], contexto: ["fundo-neutro"], enfase: ["variedade", "quantidade"] },
  },
  "premium": {
    label: "Premium Apple-style",
    icon: "⭐",
    description: "Elegante, minimalista, foco em qualidade",
    basePrompt: "Thumb estilo PREMIUM: composição minimalista, muito espaço em branco, paleta preto+dourado+branco, fontes elegantes, atmosfera sofisticada de produto de boutique",
    defaultToggles: { composicao: ["central"], contexto: ["fundo-neutro"], enfase: ["qualidade-tecnica"] },
  },
  "atacado": {
    label: "Atacado/Revenda",
    icon: "💰",
    description: "Quantidade gigante, foco em economia e revenda",
    basePrompt: "Thumb estilo ATACADO: destaque gigante na quantidade total, paleta verde+laranja, mensagem de economia clara, mensagem PARA REVENDA ou CNPJ",
    defaultToggles: { composicao: ["empilhamento"], contexto: ["loja", "fundo-neutro"], enfase: ["quantidade", "economia"] },
  },
  "kit-familia": {
    label: "Kit Família",
    icon: "📦",
    description: "Acolhedor, uso doméstico, para toda família",
    basePrompt: "Thumb estilo KIT FAMÍLIA: visual acolhedor e amigável, paleta laranja quente+azul céu, mensagem PARA TODA FAMÍLIA ou USO DOMÉSTICO",
    defaultToggles: { composicao: ["grade-2x2"], contexto: ["casa"], enfase: ["variedade"] },
  },
  "oferta-urgencia": {
    label: "Oferta Urgência",
    icon: "⚡",
    description: "Vermelho fogo, últimas unidades, urgência",
    basePrompt: "Thumb estilo OFERTA URGÊNCIA: paleta vermelho fogo+preto+amarelo elétrico, elementos de urgência (raios, relógio), mensagem ÚLTIMAS UNIDADES ou OFERTA RELÂMPAGO",
    defaultToggles: { composicao: ["central"], contexto: ["fundo-neutro"], enfase: ["economia"] },
  },
  "foco-beneficio": {
    label: "Foco em Benefício",
    icon: "🎯",
    description: "Destaque gigante em 1 benefício técnico",
    basePrompt: "Thumb estilo FOCO ÚNICO: destaque gigante em 1 benefício técnico (ex RESISTÊNCIA TRIPLA, ANTI-VAZAMENTO), foco em UMA dor que o produto resolve",
    defaultToggles: { composicao: ["central"], contexto: ["fundo-neutro"], enfase: ["qualidade-tecnica"] },
  },
  "eco": {
    label: "Eco/Natural",
    icon: "🌿",
    description: "Sustentável, biodegradável",
    basePrompt: "Thumb estilo ECO/NATURAL: paleta verde sage+marrom terra+bege+branco off-white, fontes serif clean, mensagem BIODEGRADÁVEL ou SUSTENTÁVEL, símbolos de folhas/reciclagem",
    defaultToggles: { composicao: ["central"], contexto: ["fundo-neutro"], enfase: ["qualidade-tecnica"] },
  },
  "sazonal": {
    label: "Sazonal/Presente",
    icon: "🎁",
    description: "Festivo, datas comemorativas",
    basePrompt: "Thumb estilo SAZONAL: cores festivas (vermelho+dourado+verde Natal, rosa+dourado Mães), elementos decorativos (fitas, laços), mensagem PRESENTE PERFEITO",
    defaultToggles: { composicao: ["central"], contexto: ["lifestyle-premium"], enfase: ["variedade"] },
  },
  "detalhe-tecnico": {
    label: "Detalhe Técnico",
    icon: "🔍",
    description: "Zoom em qualidade, textura, espessura",
    basePrompt: "Thumb estilo DETALHE TÉCNICO: foco em macro/zoom do produto, mostrar textura/costura/espessura, mensagem técnica com números (mm, kg)",
    defaultToggles: { composicao: ["central"], contexto: ["fundo-neutro"], enfase: ["qualidade-tecnica"] },
  },
  "comparativo": {
    label: "Comparativo",
    icon: "⚔️",
    description: "Seu produto vs concorrente, antes/depois",
    basePrompt: "Thumb estilo COMPARATIVO: layout dividido em 2 lados — VOCÊ (seu produto, vencedor) vs CONCORRENTE (genérico, perdedor), ou ANTES (problema) vs DEPOIS (solução)",
    defaultToggles: { composicao: ["grade-2x2"], contexto: ["fundo-neutro"], enfase: ["comparativo-visual", "qualidade-tecnica"] },
  },
};

export const THUMB_TOGGLES_COMPOSICAO: Record<ThumbToggleComposicao, { label: string; promptText: string }> = {
  "vitrine-ordenada": { label: "Vitrine ordenada", promptText: "Produtos enfileirados horizontalmente em linha clara, ordem visível" },
  "grade-2x2": { label: "Grade 2×2 ou 2×3", promptText: "Produtos organizados em grade quadrada, espaçamento uniforme" },
  "central": { label: "Hierarquia central", promptText: "Produto principal grande no centro, outros menores ao redor" },
  "empilhamento": { label: "Empilhamento", promptText: "Produtos empilhados, sugerindo quantidade abundante" },
  "numeracao": { label: "Numeração 1-N", promptText: "Cada produto com círculo numerado acima, label curto abaixo" },
};

export const THUMB_TOGGLES_CONTEXTO: Record<ThumbToggleContexto, { label: string; promptText: string }> = {
  "em-uso": { label: "Em uso real", promptText: "Produtos sendo USADOS (não vazios) — saco com lixo dentro, embalagem com produto" },
  "casa": { label: "Ambiente doméstico", promptText: "Cena em cozinha, banheiro ou área de serviço de uma casa" },
  "loja": { label: "Ambiente comercial", promptText: "Cena em loja, mercado ou restaurante" },
  "fundo-neutro": { label: "Fundo neutro", promptText: "Sem cenário, fundo branco/cinza claro, foco total no produto" },
  "lifestyle-premium": { label: "Lifestyle premium", promptText: "Ambiente sofisticado, mood elegante de boutique" },
};

export const THUMB_TOGGLES_ENFASE: Record<ThumbToggleEnfase, { label: string; promptText: string }> = {
  "quantidade": { label: "Foco em quantidade", promptText: "Destaque visual gigante na QUANTIDADE total (VEJA QUANTOS!, 100 UNIDADES)" },
  "variedade": { label: "Foco em variedade", promptText: "Destaque na VARIEDADE de tipos diferentes (TODOS OS TAMANHOS, N TIPOS DE)" },
  "qualidade-tecnica": { label: "Foco em qualidade", promptText: "Zoom em detalhe técnico (textura, costura, espessura), números técnicos" },
  "economia": { label: "Foco em economia", promptText: "Destaque em preço/custo-benefício (ECONOMIA DE 40%, MELHOR PREÇO)" },
  "comparativo-visual": { label: "Comparativo visual", promptText: "Mostrar ANTES vs DEPOIS, ou VOCÊ vs CONCORRENTE em lados opostos" },
};

export function buildNarrativePromptSection(
  promptBase: ThumbPromptBase | undefined,
  composicao: ThumbToggleComposicao[],
  contexto: ThumbToggleContexto[],
  enfase: ThumbToggleEnfase[],
): string {
  if (!promptBase) return "";
  const base = THUMB_PROMPT_BASES[promptBase];
  const parts: string[] = [`\n\nESTRATÉGIA NARRATIVA: ${base.basePrompt}`];
  const allToggleTexts: string[] = [];
  for (const t of composicao) allToggleTexts.push(`- ${THUMB_TOGGLES_COMPOSICAO[t].promptText}`);
  for (const t of contexto) allToggleTexts.push(`- ${THUMB_TOGGLES_CONTEXTO[t].promptText}`);
  for (const t of enfase) allToggleTexts.push(`- ${THUMB_TOGGLES_ENFASE[t].promptText}`);
  if (allToggleTexts.length > 0) {
    parts.push(`\nELEMENTOS NARRATIVOS OBRIGATÓRIOS:\n${allToggleTexts.join("\n")}`);
  }
  return parts.join("\n");
}
