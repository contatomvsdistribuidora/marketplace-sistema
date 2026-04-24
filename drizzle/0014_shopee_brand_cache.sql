CREATE TABLE IF NOT EXISTS `shopee_brand_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`region` varchar(10) NOT NULL DEFAULT 'BR',
	`categoryId` bigint NOT NULL,
	`brandList` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shopee_brand_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `shopee_brand_cache_region_category_unique` UNIQUE(`region`, `categoryId`)
);
