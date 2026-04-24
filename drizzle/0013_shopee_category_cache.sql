-- `shopee_category_attributes` intentionally omitted here: it lives in schema.ts
-- but was manually created in prod before drizzle migrations tracked it. The
-- generator wants to recreate it because it's missing from earlier snapshots,
-- but that would fail on the live DB. Leaving it untouched.

CREATE TABLE IF NOT EXISTS `shopee_category_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`region` varchar(10) NOT NULL DEFAULT 'BR',
	`categoryTree` json,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shopee_category_cache_id` PRIMARY KEY(`id`),
	CONSTRAINT `shopee_category_cache_region_unique` UNIQUE(`region`)
);
