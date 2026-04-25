-- Idempotent column add: works on fresh DBs (drizzle-kit migrate) AND on
-- prod where someone may have manually added the column already. MySQL 8
-- does not support `ADD COLUMN IF NOT EXISTS`, so we use a stored procedure
-- pattern that inspects information_schema (same as 0015).

DROP PROCEDURE IF EXISTS add_shopee_origin_ai_flags;
--> statement-breakpoint
CREATE PROCEDURE add_shopee_origin_ai_flags()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'shopee_products'
      AND column_name = 'createdBySystem'
  ) THEN
    ALTER TABLE `shopee_products` ADD COLUMN `createdBySystem` TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'shopee_products'
      AND column_name = 'titleAiGenerated'
  ) THEN
    ALTER TABLE `shopee_products` ADD COLUMN `titleAiGenerated` TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'shopee_products'
      AND column_name = 'descriptionAiGenerated'
  ) THEN
    ALTER TABLE `shopee_products` ADD COLUMN `descriptionAiGenerated` TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END;
--> statement-breakpoint
CALL add_shopee_origin_ai_flags();
--> statement-breakpoint
DROP PROCEDURE IF EXISTS add_shopee_origin_ai_flags;

-- Recommended indexes if filter combinations get slow on large shops:
--   CREATE INDEX idx_shopee_products_account_status   ON shopee_products(shopeeAccountId, itemStatus);
--   CREATE INDEX idx_shopee_products_account_created  ON shopee_products(shopeeAccountId, createdAt);
--   CREATE INDEX idx_shopee_products_account_origin   ON shopee_products(shopeeAccountId, createdBySystem);
-- Not creating them now — list size + per-account scoping keeps queries cheap.
