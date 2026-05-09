-- Adiciona coluna brand em shopee_products. JSON nullable preserva
-- { brand_id, original_brand_name } pra publish futuro.
-- (As demais alteracoes que o drizzle-kit detectou na geracao desta migration
-- ja existem no banco — journal _journal.json estava desincronizado. Ver
-- scripts/apply-0018-manually.ts pra contexto da pratica de aplicar manual.)
ALTER TABLE `shopee_products` ADD COLUMN `brand` json NULL;
