-- Idempotent column add para snapshot do wizard combinado em multi_product_listings.
--   wizard_state_json — JSON serializado do state do wizard
--     { categoryId, pricingMode, pricingPerProduct, perRowBaseQty,
--       attributeValues, optionDetailsMatrix, ... }
--
-- Padrão idêntico a 0024: stored procedure que inspeciona information_schema.
-- MySQL 9.x community NÃO suporta ADD COLUMN IF NOT EXISTS (recurso só do MariaDB).
-- Statements separados por `--> statement-breakpoint`.

DROP PROCEDURE IF EXISTS add_wizard_state_col_0025;
--> statement-breakpoint
CREATE PROCEDURE add_wizard_state_col_0025()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'multi_product_listings'
      AND column_name = 'wizard_state_json'
  ) THEN
    ALTER TABLE `multi_product_listings`
      ADD COLUMN `wizard_state_json` TEXT NULL AFTER `variation_2_cells_json`;
  END IF;
END;
--> statement-breakpoint
CALL add_wizard_state_col_0025();
--> statement-breakpoint
DROP PROCEDURE IF EXISTS add_wizard_state_col_0025;
