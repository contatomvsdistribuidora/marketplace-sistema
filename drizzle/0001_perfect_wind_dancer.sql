CREATE TABLE `attribute_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`marketplaceId` int NOT NULL,
	`categoryId` varchar(256) NOT NULL,
	`attributeName` varchar(256) NOT NULL,
	`attributeId` varchar(256),
	`defaultValue` text,
	`aiPromptHint` text,
	`required` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `attribute_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `category_mappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`marketplaceId` int NOT NULL,
	`sourceCategory` varchar(512) NOT NULL,
	`targetCategoryId` varchar(256) NOT NULL,
	`targetCategoryName` varchar(512) NOT NULL,
	`targetCategoryPath` text,
	`confidence` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `category_mappings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`marketplaceId` int NOT NULL,
	`status` enum('pending','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
	`totalProducts` int NOT NULL DEFAULT 0,
	`processedProducts` int NOT NULL DEFAULT 0,
	`successCount` int NOT NULL DEFAULT 0,
	`errorCount` int NOT NULL DEFAULT 0,
	`tagFilter` varchar(256),
	`config` json,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `export_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `export_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobId` int NOT NULL,
	`userId` int NOT NULL,
	`productId` varchar(128) NOT NULL,
	`productName` varchar(512),
	`marketplaceId` int NOT NULL,
	`status` enum('success','error','skipped','pending') NOT NULL DEFAULT 'pending',
	`mappedCategory` varchar(512),
	`mappedAttributes` json,
	`errorMessage` text,
	`errorDetails` json,
	`baselinkerResponse` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `export_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketplaces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`icon` varchar(512),
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketplaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `marketplaces_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`settingKey` varchar(128) NOT NULL,
	`settingValue` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
