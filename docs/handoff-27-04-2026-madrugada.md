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

## 🔬 SESSÃO ESTENDIDA — 27/04 madrugada (continuação)

Após o handoff inicial, dev novo continuou a sessão (~01:00 a ~02:00).

### Bug 4 — RESOLVIDO

Bug 4 do handoff (dimensões com .0 na descrição IA): resolvido pelo commit `27890a4`.
Helper `dim()` em ShopeeCriador.tsx normaliza dimensões para inteiro string (string ou number → "16" em vez de "16.0").
Aplicado em `handleGenerateAll` e `generateAdSection`. Não toca peso (decimais legítimos).
Validado com pnpm check (zero erros novos).

### Feature nova investigada e bloqueada — INTEGRAÇÃO TAXAS DE ENVIO

Dev solicitou implementar busca automática das taxas de envio dos canais Shopee, usando o maior valor como base de cálculo de preço.

Investigação completa em `docs/feature-shipping-api-investigation.md`. Resumo:
- Endpoint oficial `v2.logistics.get_channel_list` não retorna preço pra canais `SIZE_INPUT` (que é o caso da loja 1311085163)
- Endpoint sugerido por chatbot Shopee (`getlogisticprice`) não foi encontrado em docs oficiais
- Os preços do Seller Center vêm de endpoint interno não documentado

Feature **bloqueada por decisão de produto**. 5 opções listadas no doc, dev original precisa decidir antes de implementar.

Bug latente identificado: modo "margem" no cálculo de preço subestima custo quando `shippingCost = 0` (silenciosamente).

---

### Achado — Connection leak no background worker (não corrigido)

Durante investigação de erros recorrentes nos logs Railway, descoberta a causa raiz do "Too many connections" da sessão anterior: getDbInstance() em server/background-worker.ts:22 cria nova pool mysql2 a cada chamada, sem reuso. Polling a cada 30s + 8 call sites tRPC + refresh de tokens horário acumulam conexões vazadas.

Detalhes técnicos completos em docs/incident-2026-04-26-db-connection-leak.md (estratégia de fix, todas as 11 call sites, comparação com pool canônica, opções consideradas).

Decisão: NÃO aplicar fix de madrugada. Bug é pré-existente desde 6c9bb18 (17/03/2026), não introduzido nesta sessão. Dev original implementa de manhã com calma.

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

---

## 🚦 ESTADO FINAL DA SESSÃO ESTENDIDA — encerrada ~03:00

Commit final: 84412ea (Fase A da feature de canais de envio).

### Trabalho commitado e pronto para uso

- 3db91c0, 4982f2b, 94628f4 — fix Shopee attribute_info bug
- 4969d0b — limpeza de logs temp
- 27890a4 — fix dimensões inteiras na IA
- 16a7572 — docs investigação shipping API
- 0ed2a48 — docs connection leak no background worker
- 84412ea — Fase A canais de envio (schema + SQL + script)

### Pendências MAIS IMPORTANTES para o dev original

🔴 **Aplicar migration 0019** — script `scripts/apply-0019-manually.ts` está pronto mas NÃO foi executado em produção. Tabela `shopee_shipping_channels` ainda NÃO existe no MySQL. Para aplicar:

```bash
# Com DATABASE_URL do Railway no .env (mesma usada nos scripts apply-0017/0018):
pnpm tsx scripts/apply-0019-manually.ts
```

O script é idempotente (`CREATE TABLE IF NOT EXISTS`) — re-executar é seguro. Confirma criação via `SHOW TABLES LIKE 'shopee_shipping_channels'` no final. Sem isso aplicado, qualquer Fase B/C/D vai falhar com "table doesn't exist".

🔴 **Connection leak no background worker** — investigado e documentado em `docs/incident-2026-04-26-db-connection-leak.md`. NÃO corrigido nesta sessão (madrugada + infra crítica). Estratégia recomendada (pool dedicada, limit=5) + 11 call sites + ajuste de mock dos testes detalhados no doc. Provável causa raiz do "Too many connections" da sessão anterior.

🔴 **Reset da senha MySQL** — continua pendente da sessão original 26/04. Senha exposta em prints.

🔴 **Bugs novos não consertados (1, 2, 3)** — listados na seção "BUGS NOVOS DESCOBERTOS" no topo deste handoff. Bug 4 já resolvido (commit 27890a4).

### Próximas fases da feature de canais de envio

Fase A (DDL) commitada e pronta. Fases pendentes:

- **Fase B** — CRUD: helpers em `server/db.ts` (listShippingChannels, createShippingChannel, updateShippingChannel, deleteShippingChannel) + endpoints tRPC em `server/routers.ts`. Lógica de `MAX(price)` ativa por conta como helper isolado, reusável.
- **Fase C** — UI de cadastro: tela nova (sugestão: `/shopee-shipping-channels` ou aba dentro da tela da conta Shopee). Listar canais, criar, editar, ativar/desativar. Padrão visual das outras páginas Shopee.
- **Fase D** — Integração no wizard: substituir o `shippingCost = 0` atual no cálculo de preço pelo `MAX(price)` dos canais ativos da conta selecionada. Cuidado com o bug latente identificado no doc shipping API: modo "margem" subestima custo quando shippingCost = 0 — esta feature resolve isso quando há canais cadastrados, mas o fallback 0 mantém o bug latente para contas sem canais.

### Decisões registradas

- Tarifa fixa por canal (1 valor), múltiplos canais por conta (sem regras de peso, sem CEP). Cadastro 100% manual.
- Fallback 0 mantido (não breaking change para contas sem canais).
- Padrão de schema novo (snake_case no DB, camelCase no export) — alinhado com migrations 0017/0018.
- FK lógica (sem `references()`) — alinhado com o padrão do projeto (zero FKs físicas).
- Migration aplicada manualmente via script tsx — alinhado com 0017/0018, evita conflito do `_journal.json` desincronizado.

---

## Sessão estendida — feature multi-produto completa (27/04)

Entrega: feature de anúncio combinado (multi-produto) na Shopee, do início ao fim.

### Commits (12 total no main)

| Fase | Commit | Entrega |
|------|--------|---------|
| A | a87660e | DDL: 3 tabelas (multi_product_listings, multi_product_listing_items, video_bank) |
| B | 71d07a5 | 14 endpoints tRPC (multiProduct.* e videoBank.*) |
| C | 3049c19 | Tela /multi-product (seleção misturada BL+Shopee) |
| D | 0c1b9cd | Wizard /multi-product-wizard?id=N (4 steps) |
| E | 6a14d53 | IA gera título + descrição (prompts dedicados Shopee BR) |
| F | 1d69570 | IA gera thumb estilo Shopee BR (Forge interno + storagePut) |
| G.1 | b6ca9ec | DDL cache vídeos no productCache |
| G.fix | 5fe9ef0 | Splitter de migration 0023 |
| G.2 | 51e4ee9 | Sync BL extrai extra_field_101404 e 97122 |
| G.3 | 87e4378 | Step C lista vídeos do BL |
| H1.1 | 1507473 | Função publishMultiProductListing + imagem por variação |
| H1.2 | 1d65f7e | Endpoint publishToShopee + UI Step D |

### Decisões registradas

1. Publicação exige principal=Shopee (BL bloqueado, Estratégia A)
2. Brand: sempre "No Brand" (brand_id: 0)
3. SKU por variação: ${listingId}-V${i+1}
4. Imagem por variação: option_list[i].image (não model[i].image)
5. Vídeo: Fase H2 futura (doc Shopee só cobre Shopee Video TikTok, não item video)
6. Stock por variação: do produto-fonte (productCache.totalStock ou shopeeProducts.stock)

### Pendências críticas pra produção

1. Forçar sync completo em /products (sem isso, Step C mostra lista vazia)
2. Testar fluxo end-to-end (criar listing real, gerar IA, publicar)

### Pendências antigas — não tocadas

- Connection leak em background-worker
- Shipping API SIZE_INPUT bloqueado
- Reset MySQL password
- Bugs do screenshot inicial

### Migration 0023

Aplicada em produção (Railway MySQL 9.4.0). 3 colunas em product_cache:
videoUrl, videoTitle, videoLinkUrl. 148k produtos precisam de re-sync pra popular.
