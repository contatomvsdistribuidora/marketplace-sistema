# Shopee Open Platform API Reference (Product)

Referência oficial da Shopee Open Platform para o módulo Product, organizada
a partir das páginas copiadas pelo usuário em https://open.shopee.com/documents
em 2026-04-26. Foco principal: endpoints relevantes ao fluxo de criação e
sincronização de anúncios em uso pelo MVS Distribuidora.

---

## Visão Geral

- **Versão da API:** V2.0
- **URL Brasil:** `https://openplatform.shopee.com.br/api/v2/...`
- **URL Sandbox/Test (BR):** `https://openplatform.test-stable.shopee.com.br/api/v2/...`
- **Autenticação:** combinação de `partner_id` + `timestamp` + `access_token`
  + `sign` + `shop_id` na query string.
- **Token de acesso (`access_token`):** validade de **4 horas**. Após expirar,
  é necessário usar `refresh_token` (validade ~30 dias).
- **Assinatura (`sign`):** HMAC-SHA256 sobre a base string
  `partner_id + api_path + timestamp + access_token + shop_id`, usando o
  `partner_key` como chave. Resultado em hex lowercase.
- **Rate limit padrão:** 1000 requests/min por shop (varia por endpoint).
- **Idiomas suportados:** `pt-BR` é o canônico para Brasil. Alguns endpoints
  aceitam variações como `pt-br`, `pt`, `en`.

---

## Status dos Endpoints na Conta Atual (`shop_id=1311085163`)

Status apurado pela auditoria executada em **2026-04-26** via
`scripts/test-shopee-apis-audit.ts` (Fase 4) somada ao uso confirmado em
produção.

| Endpoint | Método | Status Conhecido | Origem |
|---|---|---|---|
| `add_item` | POST | Não testado | — |
| `update_item` | POST | Não testado | — |
| `delete_item` | POST | Não testado | — |
| `get_item_base_info` | GET | Não testado | — |
| `get_item_extra_info` | GET | Não testado | — |
| `get_item_list` | GET | Não testado | — |
| `get_model_list` | GET | Não testado | — |
| `update_price` | POST | Não testado | — |
| `update_stock` | POST | Não testado | — |
| `unlist_item` | POST | Não testado | — |
| `boost_item` | POST | Não testado | — |
| `get_boosted_list` | GET | Não testado | — |
| `update_size_chart` | POST | Não testado | — |
| `init_tier_variation` | POST | Não testado | — |
| `add_model` | POST | Não testado | — |
| `update_model` | POST | Não testado | — |
| `delete_model` | POST | Não testado | — |
| `update_tier_variation` | POST | Não testado | — |
| `support_size_chart` | GET | Não testado | — |
| `get_size_chart_detail` | GET | Não testado | — |
| `get_size_chart_list` | GET | Não testado | — |
| `get_brand_list` | GET | **Vivo** | Auditoria 2026-04-26 + uso confirmado |
| `get_category` | GET | **Vivo** (retorna 2038 categorias BR) | Auditoria 2026-04-26 |
| `category_recommend` | POST | **Vivo** | Auditoria 2026-04-26 |
| `get_recommend_attribute` | GET | **Vivo** (retornou objeto vazio para os IDs testados) | Auditoria 2026-04-26 |
| `get_item_limit` | GET | **Vivo** | Auditoria 2026-04-26 |
| `get_dts_limit` | GET | **Suspenso** (`api_suspended`) | Auditoria 2026-04-26 |
| `get_attribute_tree` ⭐ | GET | **NÃO TESTADO** — próxima prioridade | — |
| `get_attributes` 🔴 | — | **NÃO EXISTE** na doc oficial — nome errado em uso pelo código atual | — |
| `search_attribute_value_list` | GET | Erro inesperado (HTTP 404 não-JSON) | Auditoria 2026-04-26 |
| `register_brand` | POST | Não testado | — |
| `category_recommend_v2` | POST | Não testado | — |
| `get_item_content_diagnosis_result` | GET | Não testado | — |
| `get_item_violation_info` | GET | Não testado | — |
| `get_item_promotion` | GET | Não testado | — |
| `get_item_list_by_status` | GET | Não testado | — |
| `add_ssp_item` | POST | Não testado | — |
| `link_ssp` | POST | Não testado | — |
| `unlink_ssp` | POST | Não testado | — |
| `get_ssp_list` | GET | Não testado | — |
| `get_ssp_info` | GET | Não testado | — |
| `update_sip_item_price` | POST | Não testado | — |
| `search_item` | GET | Não testado | — |
| `get_item_count_by_classification` | GET | Não testado | — |

🔴 **Descoberta crítica da auditoria:** o nome `get_attributes`, usado em
nosso código de produção, **não existe** na documentação oficial da
Shopee Open Platform. O endpoint real chama-se `get_attribute_tree`.
Esta é a causa provável do `api_suspended` recorrente observado no fluxo
de criação de anúncio.

---

## Endpoints Documentados em Detalhe

### 4.1 `get_category` (GET)

Retorna a árvore de categorias disponíveis para o vendedor.

**Path / URLs**

- API path: `/api/v2/product/get_category`
- URL produção (BR): `https://openplatform.shopee.com.br/api/v2/product/get_category`
- URL test (BR): `https://openplatform.test-stable.shopee.com.br/api/v2/product/get_category`

**Request params (query string)**

| Param | Tipo | Required | Sample | Description |
|---|---|---|---|---|
| `partner_id` | int | Yes | `1000000` | ID do app/parceiro |
| `timestamp` | int | Yes | `1611311532` | Unix epoch (segundos) |
| `access_token` | string | Yes | `xxx` | Token de acesso da loja (4h) |
| `shop_id` | int | Yes | `1311085163` | ID da loja |
| `sign` | string | Yes | `xxx` | HMAC-SHA256 da base string |
| `language` | string | No | `pt-BR` | Idioma do retorno (default = idioma principal da loja) |

**Response shape**

```jsonc
{
  "request_id": "abcd1234",
  "error": "",
  "message": "",
  "response": {
    "category_list": [
      {
        "category_id": 100629,
        "parent_category_id": 100628,
        "original_category_name": "Womenswear",
        "display_category_name": "Roupas Femininas",
        "has_children": true
      }
    ]
  }
}
```

**Request example (cURL)**

```bash
curl -X GET "https://openplatform.shopee.com.br/api/v2/product/get_category?partner_id=1000000&timestamp=1611311532&access_token=xxx&shop_id=1311085163&sign=xxx&language=pt-BR"
```

**Response example**

```json
{
  "request_id": "5b3c08f8-...",
  "error": "",
  "message": "",
  "response": {
    "category_list": [
      { "category_id": 100629, "parent_category_id": 100628,
        "original_category_name": "Womenswear",
        "display_category_name": "Roupas Femininas", "has_children": true },
      { "category_id": 100630, "parent_category_id": 100629,
        "original_category_name": "Dresses",
        "display_category_name": "Vestidos", "has_children": false }
    ]
  }
}
```

**Error codes (mais comuns)**

- `error_param`: parâmetro obrigatório ausente.
- `error_auth`: assinatura ou token inválidos.
- `error_permission`: app sem permissão Product.
- `error_server`: erro interno Shopee.

**API permissions**: ERP System, Seller In House System, Product Management,
Customized APP, Swam ERP.

**Update log**: Created 2018-08-01, last update 2024-11-19.

**Notas de uso no projeto**

- Já consumido em `getCategoryBreadcrumb` em `server/routers/shopee.ts`.
- Para shop BR atual retorna **2038 categorias** (auditoria 2026-04-26).
- Resultado é cacheado/persistido na tabela `shopee_categories` via
  migrations 0010+ do drizzle.

---

### 4.2 `get_attribute_tree` (GET) ⭐ PRIORITÁRIO

Retorna a árvore de **atributos** suportada por uma ou mais categorias.
Substitui em definitivo o uso indevido de "get_attributes" no código.

**Path / URLs**

- API path: `/api/v2/product/get_attribute_tree`
- URL produção (BR): `https://openplatform.shopee.com.br/api/v2/product/get_attribute_tree`
- URL test (BR): `https://openplatform.test-stable.shopee.com.br/api/v2/product/get_attribute_tree`

**Request params (query string)**

| Param | Tipo | Required | Sample | Description |
|---|---|---|---|---|
| `partner_id` | int | Yes | `1000000` | ID do app |
| `timestamp` | int | Yes | `1611311532` | Unix epoch |
| `access_token` | string | Yes | `xxx` | Token da loja |
| `shop_id` | int | Yes | `1311085163` | ID da loja |
| `sign` | string | Yes | `xxx` | Assinatura HMAC-SHA256 |
| `category_id_list` | int[] | Yes | `[100629,100630]` | Lista de até **20 categorias** |
| `language` | string | No | `pt-BR` | Para BR, usar `pt-BR` |

**Response shape (completo)**

```jsonc
{
  "request_id": "...",
  "error": "",
  "message": "",
  "response": {
    "list": [
      {
        "category_id": 100629,
        "attribute_tree": [
          {
            "attribute_id": 12345,
            "original_attribute_name": "Brand",
            "display_attribute_name": "Marca",
            "is_mandatory": true,
            "input_validation_type": 0,
            "format_type": 1,
            "input_type": 1,
            "max_input_value_number": 1,
            "introduction": "Informe a marca do produto",
            "attribute_unit_list": [],
            "support_search_value": true,
            "is_oem": false,
            "attribute_value_list": [
              {
                "value_id": 91234,
                "original_value_name": "Nike",
                "display_value_name": "Nike",
                "value_unit": "",
                "child_attribute_list": [],
                "multi_lang": [
                  { "language": "pt-BR", "name": "Nike" }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**Campos-chave**

- `list[]`: um item por `category_id` enviado.
  - `category_id`: id da categoria.
  - `attribute_tree[]`: lista de atributos da categoria.
- `attribute_tree[].attribute_id`: identificador do atributo.
- `attribute_tree[].is_mandatory`: se o atributo é obrigatório no anúncio.
- `attribute_tree[].original_attribute_name` / `display_attribute_name`:
  nomes EN-US e localizado.
- `attribute_tree[].input_type`:
  - `1` = SINGLE_DROP_DOWN (selecionar 1 da lista)
  - `2` = SINGLE_COMBO_BOX (selecionar 1 ou digitar livre)
  - `3` = FREE_TEXT_FIELD (texto livre)
  - `4` = MULTI_DROP_DOWN (selecionar N da lista)
  - `5` = MULTI_COMBO_BOX (selecionar N ou digitar)
- `attribute_tree[].input_validation_type`:
  - `0` = sem validação
  - `1` = INT
  - `2` = FLOAT
  - `3` = DATE
  - `4` = STRING_TYPE_NUMERIC (string contendo números)
- `attribute_tree[].format_type`:
  - `1` = NORMAL
  - `2` = QUANTITATIVE_WITH_UNIT (valor numérico + unidade)
- `attribute_tree[].attribute_unit_list[]`: unidades válidas quando
  `format_type = 2` (ex.: `g`, `kg`, `cm`, `ml`).
- `attribute_tree[].max_input_value_number` (a.k.a. `max_value_count`):
  máximo de valores que o vendedor pode informar.
- `attribute_tree[].support_search_value`: se `true`, a lista de valores é
  grande demais para vir inline — usar `search_attribute_value_list`
  paginado.
- `attribute_tree[].is_oem`: indica atributo OEM (Original Equipment
  Manufacturer), usado em peças automotivas etc.
- `attribute_value_list[]`:
  - `value_id`: id do valor.
  - `original_value_name`/`display_value_name`: nome EN-US e localizado.
  - `value_unit`: unidade pré-fixada (quando aplicável).
  - `child_attribute_list[]`: atributos filhos condicionais ao valor.
  - `multi_lang[]`: variações por idioma.

**Request example (cURL)**

```bash
curl -X GET "https://openplatform.shopee.com.br/api/v2/product/get_attribute_tree?partner_id=1000000&timestamp=1611311532&access_token=xxx&shop_id=1311085163&sign=xxx&category_id_list=[100629]&language=pt-BR"
```

**Response example (resumido)**

```json
{
  "request_id": "f12...",
  "error": "",
  "message": "",
  "response": {
    "list": [{
      "category_id": 100629,
      "attribute_tree": [{
        "attribute_id": 100002,
        "display_attribute_name": "Marca",
        "is_mandatory": true,
        "input_type": 1,
        "input_validation_type": 0,
        "format_type": 1,
        "support_search_value": true,
        "max_input_value_number": 1,
        "attribute_value_list": []
      }]
    }]
  }
}
```

**Error codes**

- `error_param`: `category_id_list` ausente, vazio ou > 20 itens.
- `error_auth`: assinatura/token inválidos.
- `error_permission`: app sem permissão de Product.
- `category.invalid`: alguma categoria não existe na loja BR.

**API permissions**: ERP System, Seller In House System, Product Management,
Customized APP, Swam ERP.

**Update log**: Created 2023-07-24, last update 2025-01-13.

🔴 **NOTA CRÍTICA**: nosso código atual chama este endpoint como
`get_attributes` — **nome errado**. Por isso a Shopee responde
`api_suspended`/erro de path. **Renomear no código deve resolver o
problema da Fase 4.** Aguardando teste de bancada (próxima ação).

---

### 4.3 `get_ssp_list` (GET)

Lista os **SSP (Shopee Standard Products)** disponíveis para a loja. SSP é
a biblioteca central de produtos pré-cadastrados pela Shopee, com atributos
e mídia padronizados por trás de um `ssp_id`.

**Path / URLs**

- API path: `/api/v2/product/get_ssp_list`
- URL produção (BR): `https://openplatform.shopee.com.br/api/v2/product/get_ssp_list`
- URL test (BR): `https://openplatform.test-stable.shopee.com.br/api/v2/product/get_ssp_list`

**Request params**

| Param | Tipo | Required | Sample | Description |
|---|---|---|---|---|
| `partner_id` | int | Yes | `1000000` | — |
| `timestamp` | int | Yes | `1611311532` | — |
| `access_token` | string | Yes | `xxx` | — |
| `shop_id` | int | Yes | `1311085163` | — |
| `sign` | string | Yes | `xxx` | — |
| `category_id` | int | No | `100629` | Filtra SSPs de uma categoria |
| `keyword` | string | No | `iphone` | Busca textual |
| `page_no` | int | No | `1` | 1-based |
| `page_size` | int | No | `20` | Máx 100 |

**Response shape**

```jsonc
{
  "request_id": "...",
  "error": "",
  "message": "",
  "response": {
    "total_count": 1234,
    "ssp_list": [
      {
        "ssp_id": 9988776655,
        "title": "iPhone 15 Pro Max 256GB",
        "main_image_url": "https://cf.shopee.com.br/file/...",
        "category_id": 100629,
        "brand": { "brand_id": 12345, "original_brand_name": "Apple" },
        "is_used": false
      }
    ]
  }
}
```

**Request example**

```bash
curl -X GET "https://openplatform.shopee.com.br/api/v2/product/get_ssp_list?partner_id=1000000&timestamp=1611311532&access_token=xxx&shop_id=1311085163&sign=xxx&category_id=100629&keyword=iphone&page_no=1&page_size=20"
```

**Error codes**: `error_param`, `error_auth`, `error_permission`,
`error_server`.

**Notas**

- SSP = **Shopee Standard Product**. É a "ficha mãe" mantida pela Shopee
  com título, atributos, imagens e descrição padronizados.
- 🔴 **1 SSP só pode ser usado em 1 produto da loja.** Tentar reusar gera
  `error_already_link`.
- Útil para acelerar criação de anúncio: usar `link_ssp` em vez de
  preencher atributos um a um.

---

### 4.4 `link_ssp` (POST)

Vincula um produto existente da loja a um SSP, **substituindo** suas
informações pelas informações canônicas do SSP.

**Path / URLs**

- API path: `/api/v2/product/link_ssp`
- URL produção (BR): `https://openplatform.shopee.com.br/api/v2/product/link_ssp`
- URL test (BR): `https://openplatform.test-stable.shopee.com.br/api/v2/product/link_ssp`

**Request params (query string)**: `partner_id`, `timestamp`, `access_token`,
`shop_id`, `sign`.

**Request body (JSON)**

```jsonc
{
  "item_id": 123456789,
  "ssp_id": 9988776655,
  "tax_info": {
    // Campos fiscais brasileiros — ver seção abaixo
    "ncm": "85171231",
    "cfop": "5102",
    "icms_origin": "0",
    "icms_csosn": "102",
    "pis_cst": "49",
    "cofins_cst": "49",
    "diff_state_cfop": "6102",
    "fci": "",
    "ex_tipi": ""
  }
}
```

**Campos fiscais brasileiros (tax_info)**

⚠️ A Shopee Brasil exige um bloco `tax_info` obrigatório quando o produto
movimenta estoque/emissão de nota. Não detalhamos aqui no documento por
serem específicos do compliance fiscal brasileiro. Os principais campos são:

- `ncm` — Nomenclatura Comum do Mercosul.
- `cfop` — Código Fiscal de Operação.
- `icms_origin` — origem da mercadoria (0 a 8).
- `icms_csosn` — Código Situação Operação Simples Nacional.
- `pis_cst` — CST do PIS.
- `cofins_cst` — CST do COFINS.
- `diff_state_cfop` — CFOP para operação interestadual.
- `fci`, `ex_tipi` — quando aplicáveis.

Spec completa fica responsabilidade do módulo fiscal — referência rápida
está na doc oficial em `Product › link_ssp` na Open Platform.

**Response shape**

```jsonc
{
  "request_id": "...",
  "error": "",
  "message": "",
  "response": {
    "item_id": 123456789,
    "ssp_id": 9988776655,
    "linked_at": 1714147200,
    "warning": []
  }
}
```

**Request example (cURL)**

```bash
curl -X POST "https://openplatform.shopee.com.br/api/v2/product/link_ssp?partner_id=1000000&timestamp=1611311532&access_token=xxx&shop_id=1311085163&sign=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "item_id": 123456789,
    "ssp_id": 9988776655,
    "tax_info": { "ncm":"85171231","cfop":"5102","icms_origin":"0","icms_csosn":"102","pis_cst":"49","cofins_cst":"49","diff_state_cfop":"6102","fci":"","ex_tipi":"" }
  }'
```

**Error codes**: `error_param`, `error_auth`, `error_permission`,
`error_already_link` (SSP já vinculado a outro produto da loja),
`error_ssp_invalid`, `error_tax_info` (faltam campos fiscais BR).

**Notas**

- Substitui em bloco título, atributos, descrição, imagens e brand_id do
  produto pelos do SSP — "*replacing its info for the ones from the SSP*".
- Útil para preencher atributos automaticamente em lote (sem chamar
  `get_attribute_tree` + montar UI).
- Após `link_ssp`, alterações via `update_item` ficam restritas: alguns
  campos passam a ser somente-leitura (vêm do SSP).

---

## Tabela de Conteúdos Completa (todos os módulos)

Lista (sem detalhe) de todos os módulos da Shopee Open Platform e seus
endpoints, conforme a tabela de conteúdos copiada da doc oficial.

### AMS (Affiliate Marketing Solution)
- `get_offer_list`, `get_offer_detail`, `add_offer`, `update_offer`,
  `delete_offer`, `get_aff_link`.

### Video
- `init_video_upload`, `upload_video_part`, `complete_video_upload`,
  `cancel_video_upload`, `get_video_upload_result`.

### Product (detalhado nas seções 4.x acima — lista completa)
- `add_item`, `update_item`, `delete_item`,
  `get_item_base_info`, `get_item_extra_info`, `get_item_list`,
  `get_item_list_by_status`, `search_item`,
  `get_model_list`, `add_model`, `update_model`, `delete_model`,
  `init_tier_variation`, `update_tier_variation`,
  `update_price`, `update_stock`, `unlist_item`,
  `boost_item`, `get_boosted_list`,
  `update_size_chart`, `support_size_chart`, `get_size_chart_detail`,
  `get_size_chart_list`,
  `get_brand_list`, `register_brand`,
  `get_category`,
  `get_attribute_tree` ⭐, `get_recommend_attribute`,
  `category_recommend`, `category_recommend_v2`,
  `search_attribute_value_list`,
  `get_item_limit`, `get_dts_limit`,
  `get_item_content_diagnosis_result`, `get_item_violation_info`,
  `get_item_promotion`, `get_item_count_by_classification`,
  `add_ssp_item`, `link_ssp`, `unlink_ssp`,
  `get_ssp_list`, `get_ssp_info`,
  `update_sip_item_price`.

### GlobalProduct
- `add_global_item`, `update_global_item`, `delete_global_item`,
  `get_global_item_info`, `get_global_item_list`,
  `add_global_model`, `update_global_model`, `delete_global_model`,
  `init_global_tier_variation`, `update_global_tier_variation`,
  `update_global_price`, `update_global_stock`,
  `get_global_category`, `get_global_attribute_tree`,
  `get_global_brand_list`, `category_recommend_global`,
  `create_publish_task`, `get_publishable_shop`,
  `get_publish_task_result`.

### MediaSpace / Media
- `init_video_upload`, `upload_video_part`, `complete_video_upload`,
  `cancel_video_upload`, `get_video_upload_result`,
  `upload_image`, `upload_medical_image`.

### Shop / Merchant
- Shop: `get_shop_info`, `get_profile`, `update_profile`,
  `get_warehouse_detail`, `get_shop_notification`,
  `auth_partner`, `cancel_auth_partner`, `get_authed_shop`.
- Merchant: `get_merchant_info`, `get_merchant_warehouse_list`,
  `get_merchant_warehouse_location_list`, `get_shop_list_by_merchant`.

### Order
- `get_order_list`, `get_order_detail`,
  `split_order`, `unsplit_order`,
  `cancel_order`, `accept_buyer_cancellation`,
  `handle_buyer_cancellation`, `get_buyer_invoice_info`,
  `set_note`, `get_pending_buyer_invoice_order_list`,
  `upload_invoice_doc`, `download_invoice_doc`,
  `get_booking_list`, `get_booking_detail`,
  `get_shipment_list`.

### Logistics
- `get_shipping_parameter`, `get_tracking_number`,
  `ship_order`, `update_shipping_order`,
  `create_shipping_document`, `download_shipping_document`,
  `get_shipping_document_parameter`, `get_shipping_document_result`,
  `get_shipping_document_info`, `get_address_list`,
  `set_address_config`, `delete_address`,
  `get_channel_list`, `update_channel_list`,
  `mass_ship_order`, `get_mass_shipping_parameter`,
  `get_mass_tracking_number`,
  `batch_ship_order`.

### FirstMile
- `bind_first_mile_tracking_number`, `unbind_first_mile_tracking_number`,
  `generate_first_mile_tracking_number`,
  `get_unbind_order_list`, `get_detail`,
  `get_tracking_number_list`, `get_channel_list`,
  `get_waybill`.

### Payment
- `get_escrow_detail`, `get_escrow_list`,
  `get_payment_method_list`, `get_wallet_transaction_list`,
  `get_billing_transaction_info`, `get_payout_detail`.

### Discount
- `add_discount`, `add_discount_item`,
  `delete_discount`, `delete_discount_item`,
  `get_discount`, `get_discount_list`,
  `update_discount`, `update_discount_item`, `end_discount`.

### Bundle Deal
- `add_bundle_deal`, `update_bundle_deal`,
  `add_bundle_deal_item`, `update_bundle_deal_item`,
  `delete_bundle_deal_item`, `end_bundle_deal`,
  `get_bundle_deal`, `get_bundle_deal_item`,
  `get_bundle_deal_list`.

### Add-On Deal
- `add_add_on_deal`, `update_add_on_deal`,
  `add_add_on_deal_main_item`, `update_add_on_deal_main_item`,
  `delete_add_on_deal_main_item`,
  `add_add_on_deal_sub_item`, `update_add_on_deal_sub_item`,
  `delete_add_on_deal_sub_item`,
  `end_add_on_deal`,
  `get_add_on_deal`, `get_add_on_deal_main_item`,
  `get_add_on_deal_sub_item`, `get_add_on_deal_list`.

### Voucher
- `add_voucher`, `update_voucher`,
  `end_voucher`, `delete_voucher`,
  `get_voucher`, `get_voucher_list`.

### ShopFlashSale
- `create_shop_flash_sale`, `update_shop_flash_sale`,
  `delete_shop_flash_sale`, `delete_shop_flash_sale_items`,
  `add_shop_flash_sale_items`, `update_shop_flash_sale_items`,
  `get_shop_flash_sale`, `get_shop_flash_sale_list`,
  `get_shop_flash_sale_item_criteria`, `get_shop_flash_sale_items`.

### Follow Prize
- `add_follow_prize`, `update_follow_prize`,
  `end_follow_prize`, `delete_follow_prize`,
  `get_follow_prize_detail`, `get_follow_prize_list`.

### TopPicks
- `add_top_picks`, `update_top_picks`,
  `delete_top_picks`, `get_top_picks_list`.

### ShopCategory
- `add_shop_category`, `update_shop_category`,
  `delete_shop_category`, `get_shop_category_list`,
  `add_item_list`, `update_item_list_status`,
  `delete_item_list`, `get_item_list`.

### Returns
- `get_return_list`, `get_return_detail`,
  `confirm`, `dispute`, `accept_offer`, `convert_image`,
  `offer`, `cancel_dispute`, `get_available_solutions`,
  `upload_proof`.

### AccountHealth
- `get_shop_performance`, `get_metric_source_detail`,
  `get_penalty_point_history`, `get_punishment_history`,
  `get_listing_with_personal_data`.

### Ads
- Shopee Ads APIs (CPC/CPAS/CPSE) — endpoints variam por região.

### Public
- `get_shops_by_partner`, `get_merchants_by_partner`,
  `get_token_by_resend_code`, `get_refresh_token_by_upgrade_code`,
  `get_token_by_resend_code`,
  `get_shopee_ip_ranges`,
  `health_check`.

### Push
- `get_push_config`, `set_push_config`,
  `confirm_consumed_shop_push_message`,
  `get_lost_push_message`.

### SBS (Shopee Brand Standard)
- Endpoints relacionados à validação e padronização de marcas
  registradas. Coberto por `register_brand` no módulo Product.

### FBS (Fulfillment by Shopee)
- `get_inbound_list`, `get_inbound_detail`,
  `get_inventory_list`, `get_inventory_summary`,
  `get_outbound_list`, `get_outbound_detail`,
  `get_replenishment_list`,
  `get_returnable_inbound_list`.

### Livestream
- `create_session`, `start_session`, `end_session`,
  `update_session`, `get_session_detail`, `get_session_list`,
  `get_session_metric`, `get_session_item_metric`,
  `add_item_list`, `update_item_list`, `delete_item_list`,
  `get_item_list`, `get_item_count`,
  `add_show_item`, `update_show_item`, `delete_show_item`,
  `apply_item_set`, `post_comment`, `get_latest_comment_list`,
  `ban_user_comment`, `unban_user_comment`,
  `upload_image`.

---

## Próximas Investigações Recomendadas

1. ⭐ **Testar `get_attribute_tree`** — próxima ação imediata.
   Renomear no código (de `get_attributes` para `get_attribute_tree`),
   ajustar `category_id_list` como array (`[id]`), e validar response.
   Esperado: 200 + atributos com `is_mandatory`, `input_type`,
   `attribute_value_list`.
2. Buscar doc oficial de `get_item_content_diagnosis_result` —
   diagnóstico oficial Shopee de qualidade do anúncio. Pode substituir
   nossa heurística de `qualityScore`.
3. Buscar doc de `add_item` e `update_item` — validar formato do
   `brand_id` (int? string? object?), validar campo `attribute_list`
   (formato esperado pelo backend Shopee).
4. Buscar doc de `get_ssp_info`, `add_ssp_item`, `unlink_ssp` —
   completar a família SSP (criação do anúncio a partir de SSP, leitura
   de SSP individual, desvinculação).
5. Investigar `search_attribute_value_list` (HTTP 404 não-JSON na
   auditoria) — pode ter sido renomeado ou só estar disponível em
   regiões/categorias específicas.
6. `get_dts_limit` — confirmar com Shopee se o `api_suspended` é
   permanente para o partner ou temporário.

---

## Histórico de Atualizações deste Documento

- **2026-04-26**: Criação inicial. Cobre `get_category`,
  `get_attribute_tree`, `get_ssp_list`, `link_ssp` em detalhe + tabela
  de status com 40+ endpoints + tabela de conteúdos completa de todos
  os módulos da Open Platform. Marca descoberta crítica: nosso código
  usa `get_attributes` (inexistente) em vez de `get_attribute_tree`.
