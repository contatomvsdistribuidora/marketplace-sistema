-- Itens (variações) de cada multiProductListing. Cada linha é uma
-- variação herdando do produto de origem (productCache ou shopeeProducts).
CREATE TABLE IF NOT EXISTS `multi_product_listing_items` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `listing_id` BIGINT NOT NULL,
  `source` ENUM('baselinker', 'shopee') NOT NULL,
  `source_id` BIGINT NOT NULL,
  `position` INT NOT NULL DEFAULT 0,
  `custom_price` DECIMAL(10, 2) NULL,
  `custom_sku` VARCHAR(256) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `multi_product_listing_items_pk` PRIMARY KEY (`id`),
  CONSTRAINT `uk_multi_product_listing_items_listing_source` UNIQUE (`listing_id`, `source`, `source_id`),
  INDEX `idx_multi_product_listing_items_listing` (`listing_id`),
  INDEX `idx_multi_product_listing_items_position` (`listing_id`, `position`)
);
