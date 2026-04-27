# Investigação — Integração API Shopee para taxas de envio

> Investigação realizada em 27/04/2026 madrugada. Resultado: feature não viável via Open API atual sem decisões de produto.

## O pedido original

Buscar automaticamente os preços de envio cadastrados na Shopee por canal e usar o maior valor como base no campo "Custo de envio estimado" do wizard de Publicar como Novo Produto.

Atualmente esse campo está fixo em 0.00 e o label diz "integração API Shopee em breve".

Exemplo concreto: produto Suporte Para Copo (item 23199446997). No Seller Center mostra:
- Shopee Xpress CPF: R$ 10,83 (max 30kg)
- Retirada pelo Comprador: R$ 8,66 (max 30kg)

A feature deveria pegar R$ 10,83 (maior).

## Endpoints investigados

### v2.logistics.get_channel_list — não retorna preço pra esta shop

Endpoint oficial documentado. Retorna canais com campo fee_type que pode ser:
- SIZE_SELECTION → size_list[] com default_price por tamanho (tem preço)
- SIZE_INPUT → vendedor digita dimensões, Shopee calcula no checkout (sem preço pré-pedido)
- FIXED_DEFAULT_PRICE (tem preço)
- CUSTOM_PRICE (vendedor define manualmente)

Resultado da chamada real na shop 1311085163:
- Canal "Shopee Xpress CPF" (id 90016): fee_type=SIZE_INPUT, size_list=[], enabled=true
- Canal "Retirada pelo Comprador" (id 90023): fee_type=SIZE_INPUT, size_list=[], enabled=true

Ambos canais ativos retornam SIZE_INPUT com size_list vazio. Open API NÃO fornece os R$ 10,83 / R$ 8,66 que aparecem no Seller Center.

### v2.logistics.get_shipping_parameter — exige order_sn

Endpoint oficial. Aceita order_sn (pedido já existente) e retorna info de pickup/dropoff. Não tem campo de preço. Não serve pro caso (publicação é antes de pedido existir).

### getlogisticprice — não confirmado

Mencionado por chatbot/IA do site Shopee em formato de prosa, sem URL completa, sem schema, sem método HTTP. Não confirmado nas docs oficiais. Provavelmente alucinação do chatbot.

## Por que aparece no Seller Center?

Os preços R$ 10,83 / R$ 8,66 vêm de endpoint interno não documentado, calculado dinamicamente no painel web baseado em peso/dimensões/CEP origem-destino. Não é parte da Open API.

## Opções consideradas

1. Confirmar com suporte Shopee se há endpoint pré-pedido — risco de dias de espera com retorno incerto
2. Cálculo local com tabela de tarifas — recriar lógica Shopee (peso × distância × canal). Tabelas mudam, alta manutenção
3. Scraper do Seller Center — frágil, viola TOS, não recomendado
4. Manter campo manual + atualizar label — remover "API Shopee em breve", vendedor preenche manualmente. Honesto, simples
5. Heurística por categoria — média histórica de fretes. Precisa volume de pedidos no DB

## Bug latente identificado

Atualmente shippingCost=0 (default). Afeta:
- Modo multiplicador no cálculo de preço — não afetado (ignora frete)
- Modo margem/profit — SUBESTIMA o custo porque assume frete zero (silenciosamente)

Independente da decisão de integração, modo margem deveria ter validação/aviso quando shippingCost=0.

## Recomendação para próxima sessão

1. Decisão pelo dono do produto: qual opção (2, 4, 5) seguir
2. Se Opção 4 (caminho mais barato): ajustar label, ~5 min de fix
3. Se Opção 2: começar pela tabela de tarifas oficial. Implementação 1-2 dias
4. Se Opção 5: investigar schema da tabela orders existente
5. Bug latente do modo margem: corrigir independente de qualquer decisão

## Arquivos consultados

- server/_core/sdk.ts — wrapper de chamadas autenticadas Shopee
- scripts/get-and-test.ts — padrão de script ad-hoc
- client/src/pages/ShopeeCriador.tsx — onde está o campo "Custo de envio estimado"
- scripts/inspect-channels.ts — script de diagnóstico (deletado após investigação)
