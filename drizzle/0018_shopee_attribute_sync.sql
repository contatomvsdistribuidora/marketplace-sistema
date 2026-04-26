-- Idempotent migration for the lazy + bulk attribute-sync infrastructure.
-- Mirrors 0017 (brand sync) — same CREATE TABLE IF NOT EXISTS pattern.
--
-- Tables:
--   shopee_category_attribute_cache         — one row per (region, categoryId,
--                                              language) holding the full
--                                              attribute_tree JSON returned by
--                                              /api/v2/product/get_attribute_tree.
--   shopee_category_attribute_sync_progress — per (accountId, categoryId,
--                                              language) state machine driving
--                                              lazy reads + bulk syncs.

CREATE TABLE IF NOT EXISTS `shopee_category_attribute_cache` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `region` VARCHAR(8) NOT NULL DEFAULT 'BR',
  `category_id` BIGINT NOT NULL,
  `language` VARCHAR(8) NOT NULL DEFAULT 'pt-BR',
  `attribute_tree` JSON NOT NULL,
  `attribute_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `shopee_category_attribute_cache_pk` PRIMARY KEY (`id`),
  CONSTRAINT `uk_shopee_attr_cache_region_cat_lang` UNIQUE (`region`, `category_id`, `language`),
  INDEX `idx_shopee_attr_cache_updated_at` (`updated_at`)
);

CREATE TABLE IF NOT EXISTS `shopee_category_attribute_sync_progress` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `shopee_account_id` BIGINT NOT NULL,
  `category_id` BIGINT NOT NULL,
  `language` VARCHAR(8) NOT NULL DEFAULT 'pt-BR',
  `status` ENUM('pending','in_progress','done','error') NOT NULL DEFAULT 'pending',
  `attribute_count` INT NOT NULL DEFAULT 0,
  `last_synced_at` DATETIME NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `shopee_category_attribute_sync_progress_pk` PRIMARY KEY (`id`),
  CONSTRAINT `uk_shopee_attr_sync_account_cat_lang` UNIQUE (`shopee_account_id`, `category_id`, `language`),
  INDEX `idx_shopee_attr_sync_status` (`status`)
);
