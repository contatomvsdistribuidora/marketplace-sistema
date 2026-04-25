-- Idempotent column add: works on fresh DBs (drizzle-kit migrate) AND on
-- prod where someone may have manually added the column already. MySQL 8
-- does not support `ADD COLUMN IF NOT EXISTS`, so we use a stored procedure
-- pattern that inspects information_schema.

DROP PROCEDURE IF EXISTS add_shopee_item_id_legacy;
--> statement-breakpoint
CREATE PROCEDURE add_shopee_item_id_legacy()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'shopee_products'
      AND column_name = 'shopeeItemIdLegacy'
  ) THEN
    ALTER TABLE `shopee_products` ADD COLUMN `shopeeItemIdLegacy` BIGINT NULL;
  END IF;
END;
--> statement-breakpoint
CALL add_shopee_item_id_legacy();
--> statement-breakpoint
DROP PROCEDURE IF EXISTS add_shopee_item_id_legacy;
