CREATE TABLE `agent_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobId` int,
	`queueItemId` int,
	`action_type` enum('navigate','click','type','select','screenshot','wait','success','error','info') NOT NULL DEFAULT 'info',
	`description` text NOT NULL,
	`screenshotUrl` varchar(1024),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_queue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`jobId` int NOT NULL,
	`productId` varchar(128) NOT NULL,
	`productName` varchar(512),
	`sku` varchar(256),
	`ean` varchar(128),
	`price` varchar(32),
	`stock` int DEFAULT 0,
	`imageUrl` varchar(1024),
	`description` text,
	`mappedCategory` varchar(512),
	`mappedAttributes` json,
	`marketplaceType` varchar(64) NOT NULL,
	`accountId` varchar(128) NOT NULL,
	`accountName` varchar(256),
	`inventoryId` int NOT NULL,
	`queue_status` enum('waiting','processing','completed','failed','skipped') NOT NULL DEFAULT 'waiting',
	`errorMessage` text,
	`screenshotUrl` varchar(1024),
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_queue_id` PRIMARY KEY(`id`)
);
