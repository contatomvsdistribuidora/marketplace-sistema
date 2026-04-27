# HANDOFF — Marketplace MVS Distribuidora — Madrugada 27/04/2026

> Continuação da sessão noturna de 26/04. Dev novo (substituto temporário) trabalhou de ~23h a ~01h.
> Última atualização: 27/04/2026 ~01:20

---

## ✅ ESTADO ATUAL — bug do "attribute info is invalid" RESOLVIDO

A publicação de produtos novos via "Publicar como Novo Produto" está **funcionando**. Validado em produção com produto Suporte Para Copo Descartável (ID Shopee: 23199446997).

### Commits da sessão (todos em produção)

| Hash | Descrição |
|------|-----------|
| `3db91c0` | fix(criador): título dinâmico do modal conforme createNewMode |
| `0bb3e55` | chore(shopee-publish): log temporário request/response (REVERTIDO em 4969d0b) |
| `4982f2b` | fix(criador): default value_unit ao primeiro item de attribute_unit_list quando format_type=2 |
| `94628f4` | fix(criador): paridade Bloco 2 (Revisão) com Bloco 1 — branch format_type=2 |
| `4969d0b` | chore(shopee-publish): remover logs TEMP DEBUG após validação |

### Diagnóstico final do bug

O fix `d94baaa` (sessão anterior) corrigiu apenas 1 dos 3 caminhos que precisavam tratar `format_type=2`:

1. **Bloco 1 de render** (`ShopeeCriador.tsx:2740-2860`, etapa Detalhes) — corrigido por `d94baaa` ✅
2. **autoFillAttributes** (IA preenchendo via "Gerar com IA") — não corrigido por `d94baaa`. Resolvido indiretamente por `4982f2b` (default no submit).
3. **Bloco 2 de render** (`ShopeeCriador.tsx:3334-3447`, etapa Revisão) — não corrigido por `d94baaa`. Resolvido por `94628f4`.

A causa raiz real do erro reportado era o **caminho da IA + Bloco 2** preenchendo `originalValue` sem `valueUnit`. O usuário usou o botão "Gerar tudo com IA" e os campos "Tamanho do Pacote" e "Peso do Produto" (atributos `format_type=2`) saíram sem unidade no payload.

---

## 🐛 BUGS NOVOS DESCOBERTOS — não consertados

Levantados pelo dev no teste de validação pós-fix:

🔴 **Bug 1 — "Ver na Shopee" abre o produto antigo, não o novo recém-criado**
- Após publicar novo produto, o link "Ver na Shopee" do registro local continua apontando pro `itemId` antigo (do produto-fonte).
- Hipótese: o registro local não está atualizando `itemId` após `publishAsNewProduct`. Olhar o `redirect pós-publicação` (commit `16f6065` da sessão anterior) e o callback de sucesso da mutation.

🔴 **Bug 2 — Atributos não aparecem na tela do produto local após publicação**
- Tela `/shopee-criador?productId=...` mostra "Nenhum atributo disponível. Verifique a categoria do..." mesmo quando o produto na Shopee tem 7/12 atributos preenchidos.
- Hipótese: desincronização entre DB local e Shopee pós-publicação. Pode precisar disparar re-import do produto após publicação bem-sucedida.

🔴 **Bug 3 — Marca custom não aparece no BrandPicker**
- Marca "JSN" não aparece no autocomplete de busca.
- Hipótese: BrandPicker não permite marca custom (que a Shopee aceita). Precisa investigar se o componente tem flag pra "criar nova marca" ou se filtra só marcas pre-cadastradas.

🟡 **Bug 4 — Dimensões com casas decimais (16.0×25.0×25.0)**
- Já listado no handoff anterior. `Math.round()` ou validação no input.

---

## 📝 PENDÊNCIAS ANTIGAS — continuam abertas

🔴 **CRÍTICO — Reset da senha MySQL** — ainda não foi feito. Senha continua exposta em prints da sessão original do dia 26/04.

🔴 **Investigar saturação do MySQL Railway** — durante a sessão de 26/04 o DB retornou `Too many connections` por ~25min. Causa raiz desconhecida. Verificar:
- Métricas/logs do MySQL no Railway
- Connection pool do app (vazamento? mal dimensionado?)
- Queries longas

🟡 **Bug B do handoff anterior** — `original_value_name` em PT-BR ("Brasil") em vez de EN ("Brazil") quando a Shopee diverge. Continua pendente.

🟡 **Validação anti-duplicata** — erro `code 242 - product is duplicated` apareceu no produto 3847 nos testes. Precisa validar antes de tentar publicar.

🟡 **Validação peso/dimensão Shopee Xpress CPF** — handoff anterior já listava.

🟡 **Banner avisando produto em promoção** — handoff anterior já listava.

🟢 **Fix da raiz do `value_unit` na IA** — opção 5 do diagnóstico. Atualmente a IA não recebe `format_type` nem `attribute_unit_list` e não retorna `value_unit` separado. Solução paliativa (default no submit) está em produção. Solução definitiva é estender schema da IA. Issue separada.

🟢 **Próximas APIs vivas não integradas** — `category_recommend`, `get_item_limit`, `get_recommend_attribute`, `link_ssp` (handoff anterior).

---

## 🎯 OBJETIVO FUTURO — atingir 100% Qualidade do Anúncio

Levantado pelo dev. Para atingir Qualidade 100% no "Diagnóstico do Conteúdo" da Shopee, precisamos:
- Atributos preenchidos (Bug 2 acima é bloqueador)
- Descrição e Título — já resolvido via geração por IA
- **Geração de thumb por IA** — não implementado
- **Inserção de vídeo** — não implementado
- 5+ fotos no produto

Ordem sugerida: resolver Bug 2 (atributos) primeiro, depois trabalhar nos itens de mídia.

---

## 🔬 INVESTIGAÇÃO TÉCNICA REALIZADA NESTA SESSÃO

Para futura referência, mapeamento dos componentes do fluxo de publicação:

- **Frontend** (`client/src/pages/ShopeeCriador.tsx`):
  - Bloco 1 render: linhas 2740-2860 (etapa C "Detalhes")
  - Bloco 2 render: linhas 3334-3447 (etapa D "Revisão")
  - Submit (`handlePublishToShopee`): linhas 2156-2191
  - `autoFillAttributes`: linhas 2274-2336
  - useQuery `getCategoryAttributesV2`: linhas 490 e 1618
- **Backend tRPC** (`server/routers.ts`):
  - `getCategoryAttributesV2`: linhas 2325-2365
  - `ensureBrandAttribute`: linhas 30-54
  - Schema de attributes na publish mutation: linhas 465-472
- **Sync de cache** (`server/shopee/attribute-sync.ts`):
  - `syncAttributesForCategory`: linhas 146-197 (idempotente, state machine)
  - `getAttributesForCategory`: linhas 204-245
  - `upsertAttributeCache`: linhas 98-134
  - TTL: 24h (`TTL_MS`)
- **Parser** (`server/shopee/attribute-tree.ts`):
  - `parseAttribute`: linhas 265-362
  - Lê `attribute_info.format_type ?? api.format_type` (suporta os 2 shapes)
- **Backend publish** (`server/shopee-publish.ts`):
  - `shopeePost` (centraliza): linhas 74-92
  - `createProduct`: linha 482, body montado em 522-531
  - `updateProduct`: linha 642, body montado em 663-672
- **IA mapper** (`server/ai-mapper.ts`):
  - `fillProductAttributes`: linhas 132-235
  - Output schema (`value: string` apenas, sem `value_unit`): 204-218

Dados verificados em produção:
- Cache de atributos da categoria 101208: 13 atributos completos com `format_type`, `attribute_info`, `multi_lang` pt-BR
- Atributos `format_type=2`: 100095 (Peso, units g/kg) e 101029 (Tamanho do Pacote, units ML/L/MG/G/GR/KG/CM/M/Dozen/Piece/Pack/Set/Box)

---

## 💡 PROCESSO DA SESSÃO

- Duração: ~3h (23:00–02:00 madrugada)
- Dev novo entrou após 7h+ do dev original
- 4 fixes em produção sem regressão
- Testes manuais validados antes de cada commit
- Logs TEMP DEBUG adicionados, usados, e removidos no mesmo dia (boa prática)
- Decisão consciente de parar antes de atacar Bugs 1-4 novos (madrugada + dev novo + pendências críticas em aberto)

### Padrão que funcionou
1. Diagnóstico antes de codar
2. Diff revisado antes de aplicar
3. Typecheck pós-mudança
4. Commits pequenos e separados
5. Validação manual no site após push
6. Logs em código removidos antes de fechar a sessão
