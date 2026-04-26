-- Idempotent migration for the lazy + bulk brand-sync infrastructure.
-- Same stored-procedure pattern as 0015/0016 (MySQL 8 has no
-- CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS combo
-- that doesn't error noisily on re-runs).

CREATE TABLE IF NOT EXISTS `shopee_brand_sync_progress` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `shopee_account_id` BIGINT NOT NULL,
  `category_id` BIGINT NOT NULL,
  `status` ENUM('pending','in_progress','done','error') NOT NULL DEFAULT 'pending',
  `total_brands` INT NOT NULL DEFAULT 0,
  `synced_pages` INT NOT NULL DEFAULT 0,
  `last_synced_at` DATETIME NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `shopee_brand_sync_progress_pk` PRIMARY KEY (`id`),
  CONSTRAINT `uk_shopee_brand_sync_account_category` UNIQUE (`shopee_account_id`, `category_id`),
  INDEX `idx_shopee_brand_sync_status` (`status`)
);
