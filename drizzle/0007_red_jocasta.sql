CREATE TABLE `ml_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`mlCategoryId` varchar(32) NOT NULL,
	`name` varchar(512) NOT NULL,
	`parentId` varchar(32),
	`pathFromRoot` text,
	`pathIds` text,
	`totalItems` int DEFAULT 0,
	`hasChildren` int NOT NULL DEFAULT 0,
	`isLeaf` int NOT NULL DEFAULT 0,
	`level` int NOT NULL DEFAULT 0,
	`picture` varchar(1024),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ml_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `ml_categories_mlCategoryId_unique` UNIQUE(`mlCategoryId`)
);
