CREATE TABLE `cache_sync` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`inventoryId` int NOT NULL,
	`totalProducts` int NOT NULL DEFAULT 0,
	`lastProductId` bigint NOT NULL DEFAULT 0,
	`isComplete` int NOT NULL DEFAULT 0,
	`lastSyncAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cache_sync_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`inventoryId` int NOT NULL,
	`productId` bigint NOT NULL,
	`name` varchar(1024) NOT NULL DEFAULT '',
	`sku` varchar(256) NOT NULL DEFAULT '',
	`ean` varchar(128) NOT NULL DEFAULT '',
	`categoryId` int NOT NULL DEFAULT 0,
	`manufacturerId` int NOT NULL DEFAULT 0,
	`mainPrice` varchar(32) NOT NULL DEFAULT '0',
	`totalStock` int NOT NULL DEFAULT 0,
	`weight` varchar(32) NOT NULL DEFAULT '0',
	`tags` json,
	`description` text,
	`imageUrl` varchar(1024),
	`cachedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_cache_id` PRIMARY KEY(`id`)
);
