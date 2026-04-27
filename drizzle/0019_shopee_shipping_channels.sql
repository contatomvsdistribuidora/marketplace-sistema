-- Idempotent migration for the manually-curated Shopee shipping channels
-- table. One row per (shopeeAccountId, channelName) — the unique constraint
-- prevents accidental duplicates from the future cadastro UI (Phase C).
--
-- Same `CREATE TABLE IF NOT EXISTS` pattern as 0017/0018 so re-running the
-- script is safe.

CREATE TABLE IF NOT EXISTS `shopee_shipping_channels` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `shopee_account_id` BIGINT NOT NULL,
  `channel_name` VARCHAR(128) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `is_active` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `shopee_shipping_channels_pk` PRIMARY KEY (`id`),
  CONSTRAINT `uk_shopee_shipping_channels_account_name` UNIQUE (`shopee_account_id`, `channel_name`),
  INDEX `idx_shopee_shipping_channels_account` (`shopee_account_id`)
);
