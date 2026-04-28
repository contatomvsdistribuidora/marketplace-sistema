-- Idempotent column add para variação 2 (matriz N×M) em multi_product_listings.
--   variation_2_type         — tipo escolhido (quantidade/tamanho/cor/material/personalizado)
--   variation_2_options_json — JSON array de strings com as opções, ex: ["50un","100un","200un"]
--   variation_2_cells_json   — JSON array das células da matriz com {itemId,optionIndex,price,stock,sku,ean,...}
--
-- Padrão idêntico a 0015/0016/0023: stored procedure que inspeciona
-- information_schema. MySQL 9.x community NÃO suporta ADD COLUMN IF NOT EXISTS
-- (recurso só do MariaDB). Statements separados por `--> statement-breakpoint`
-- pra evitar conflito com `;` dentro do BEGIN…END.

DROP PROCEDURE IF EXISTS add_multi_product_variation_cols_0024;
--> statement-breakpoint
CREATE PROCEDURE add_multi_product_variation_cols_0024()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'multi_product_listings'
      AND column_name = 'variation_2_type'
  ) THEN
    ALTER TABLE `multi_product_listings`
      ADD COLUMN `variation_2_type` VARCHAR(32) NULL AFTER `video_bank_id`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'multi_product_listings'
      AND column_name = 'variation_2_options_json'
  ) THEN
    ALTER TABLE `multi_product_listings`
      ADD COLUMN `variation_2_options_json` TEXT NULL AFTER `variation_2_type`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'multi_product_listings'
      AND column_name = 'variation_2_cells_json'
  ) THEN
    ALTER TABLE `multi_product_listings`
      ADD COLUMN `variation_2_cells_json` TEXT NULL AFTER `variation_2_options_json`;
  END IF;
END;
--> statement-breakpoint
CALL add_multi_product_variation_cols_0024();
--> statement-breakpoint
DROP PROCEDURE IF EXISTS add_multi_product_variation_cols_0024;
