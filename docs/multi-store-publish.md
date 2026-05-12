# Multi-Store Publish — Spec

Publicar 1 listing multi-produto em N contas Shopee simultaneamente, cada conta
com seu próprio multiplicador de preço, título, descrição, thumb e vídeo.

## Visão geral

Hoje o `multi_product_listings` aponta pra UMA conta (`shopee_account_id`) e
gera UM `shopee_item_id`. A nova feature mantém o listing como "fonte canônica"
e adiciona uma tabela-filho `shopee_listing_publications` onde cada linha é
uma publicação em uma conta específica.

**Antes:**
```
multi_product_listings (1) ──→ Bella     → shopeeItemId X
```

**Depois:**
```
multi_product_listings (1) ─┬→ Bella     → shopeeItemId X (custom title/thumb/multiplier)
                            ├→ Bidushop  → shopeeItemId Y (custom title/thumb/multiplier)
                            └→ Higipack  → shopeeItemId Z (custom title/thumb/multiplier)
```

## Fluxo do operador (5 passos)

1. **Step A — Seleção de contas:** marca quais contas Shopee receberão este
   anúncio. Pode ser 1 (compat com fluxo atual) ou N.
2. **Step B — Configuração por conta:** pra cada conta marcada, define
   multiplicador, título, descrição, thumb e vídeo customizados.
   Defaults herdam do listing-pai (preenchem campos vazios automaticamente).
3. **Step C — Preview consolidado:** revisa a publicação por conta (preço
   final = preço-base × multiplicador, título efetivo, etc.).
4. **Step D — Publicar:** dispara N chamadas `init_tier_variation` em paralelo
   (uma por conta). Status individual por conta (pending/publishing/published/failed).
5. **Step E — Pós-publicação:** mostra resultado consolidado. Se uma conta
   falhou, permite retry só dela (sem republicar as outras).

## Schema novo

### Tabela `shopee_listing_publications`

| Coluna | Tipo | Nullable | Descrição |
|---|---|---|---|
| `id` | INT PK auto | — | |
| `listing_id` | BIGINT | NOT NULL | FK lógica → `multi_product_listings.id` |
| `shopee_account_id` | BIGINT | NOT NULL | FK lógica → `shopee_accounts.id` |
| `price_multiplier` | DECIMAL(8,4) | NULL | Multiplicador de preço. NULL = herda do anúncio |
| `min_margin_pct` | DECIMAL(5,2) | NULL | Piso de margem % por conta. NULL = herda do anúncio |
| `custom_title` | VARCHAR(120) | NULL | Título por conta. NULL = herda do listing |
| `custom_description` | TEXT | NULL | Descrição por conta. NULL = herda do listing |
| `custom_thumb_url` | VARCHAR(500) | NULL | Thumb por conta. NULL = herda do listing |
| `custom_video_id` | BIGINT | NULL | FK lógica → `video_bank.id`. NULL = herda |
| `shopee_item_id` | BIGINT | NULL | Preenchido após publicação bem-sucedida |
| `publish_status` | ENUM | NOT NULL DEFAULT 'pending' | pending / publishing / published / failed |
| `publish_error` | TEXT | NULL | Mensagem do erro se `publish_status='failed'` |
| `published_at` | TIMESTAMP | NULL | Quando foi publicado com sucesso |
| `created_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE | |

**Índices:**
- `UNIQUE (listing_id, shopee_account_id)` — 1 publicação por listing/conta.
- `INDEX (listing_id)` — listar todas publicações deste listing (UI).
- `INDEX (shopee_account_id, publish_status)` — dashboard "anúncios pendentes/falhos por conta".

**Sem FK formal** — alinha com o padrão do projeto (nenhuma tabela atual usa
`references()` no Drizzle). Integridade referencial garantida na camada de aplicação.

### Tabelas que NÃO mudam

- `multi_product_listings` permanece intacto. Continua tendo `shopee_account_id` e
  `shopee_item_id` na fase atual (compat). Quando todos os listings forem migrados
  pra usar a tabela nova, esses dois campos viram "conta default / item legado".

## Arquitetura técnica

### Leitura

- **Listar listings:** continua só lendo `multi_product_listings`.
- **Detalhe de listing:** JOIN com `shopee_listing_publications` pra mostrar
  status por conta.

### Escrita (publish)

Fase atual (1 conta):
```
publishMultiProductListing(listingId)
  └─→ initTierVariation(...)
      └─→ UPDATE multi_product_listings SET shopee_item_id = X
```

Fase nova (N contas):
```
publishMultiProductListing(listingId)
  ├─→ SELECT FROM shopee_listing_publications WHERE listing_id = ?
  ├─→ Para cada row (em paralelo, com semáforo):
  │     ├─→ Resolver overrides (multiplier, title, etc) com fallback
  │     ├─→ initTierVariation(... conta_i)
  │     └─→ UPDATE shopee_listing_publications SET shopee_item_id, status, published_at
  └─→ Status consolidado: tudo ok / parcial / tudo falhou
```

### UI

- **CombinedWizard:** novo step "Contas" antes da revisão. Lista checkbox de
  contas Shopee ativas do usuário. Pra cada conta marcada, painel expandível
  com multiplicador, título, descrição, thumb, vídeo.
- **Wizard state:** salva `accountConfigs: Record<accountId, {priceMultiplier, customTitle, ...}>`
  no `wizardStateJson`.
- **Persistência:** ao avançar do step "Contas", upsert em `shopee_listing_publications`
  (1 row por conta marcada). Desmarcar conta → soft delete (ou hard delete se
  status='pending').

## Plano de fases

| Fase | Escopo | Status |
|---|---|---|
| **1** | Documentação + schema tabela | concluída |
| **2** | Step "Contas" — UI seleção checkbox | concluída |
| **3** | Step "Contas" — UI override de pricing por conta (price_multiplier + min_margin_pct) | concluída |
| **4** | Step "Contas" — UI override de conteúdo por conta (title + description + IA com voice hint) | concluída |
| 4 | Persistência: upsert em `shopee_listing_publications` no autosave | pendente |
| 5 | Preview consolidado por conta (Step C) | pendente |
| 6 | Backend: `publishMultiProductListing` itera publications | pendente |
| 7 | Retry seletivo por conta + dashboard status | pendente |

## Edge cases

- **Conta única:** se o operador marcar só 1 conta, comporta-se idêntico ao
  fluxo atual. Cria 1 row em `shopee_listing_publications`.
- **Conta desconectada (token expirado):** UI bloqueia seleção; se conta cair
  entre seleção e publish, marca essa publication como `failed` com erro
  específico e prossegue com as outras.
- **Sucesso parcial:** se 2 de 3 contas publicarem ok, o listing fica
  `status='partial'` (novo enum value). UI mostra qual falhou + botão retry.
- **Retry duplicado:** se publication já tem `shopee_item_id`, retry chama
  `update_item` em vez de `add_item`.
- **Desmarcar conta com publication 'published':** UI bloqueia (não dá pra
  "deletar" anúncio Shopee através desse fluxo — exige delete explícito).
- **Multiplier sem custom_title:** título herda do listing; preço usa
  `listing.basePrice × multiplier`. Permitido.
- **SKU collision entre contas:** cada conta tem seu próprio namespace de SKU,
  mas o auto-suffix `${listing.id}-${suffix}-...` precisa incluir
  `${publicationId}` ou `${accountId}` no SKU pra evitar colisão se 2 contas
  do mesmo seller compartilharem stock.

## O que NÃO está nesta spec (fora de escopo)

- Sincronização de stock entre contas pós-publicação.
- Atualização propagada (editar listing → reflete em todas as publications).
- Multi-marketplace (esta feature é só Shopee; ML/Amazon viriam separados).
