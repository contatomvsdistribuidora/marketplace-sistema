ALTER TABLE `background_jobs` MODIFY COLUMN `bg_job_type` enum('export_ml','generate_titles','generate_descriptions','generate_images','shopee_sync') NOT NULL;--> statement-breakpoint
ALTER TABLE `shopee_accounts` ADD `refreshTokenExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `shopee_accounts` ADD `tokenStatus` varchar(32) DEFAULT 'active' NOT NULL;