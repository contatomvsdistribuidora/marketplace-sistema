-- Banco de vídeos GLOBAL (sem userId / shopeeAccountId — todos os
-- usuários veem o mesmo banco). Suporta upload, URL externa e Baselinker.
CREATE TABLE IF NOT EXISTS `video_bank` (
  `id` BIGINT AUTO_INCREMENT NOT NULL,
  `title` VARCHAR(256) NOT NULL,
  `url` VARCHAR(1024) NOT NULL,
  `source` ENUM('external_url', 'manual_upload', 'baselinker') NOT NULL,
  `duration_seconds` INT NULL,
  `thumbnail_url` VARCHAR(1024) NULL,
  `is_active` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `video_bank_pk` PRIMARY KEY (`id`),
  INDEX `idx_video_bank_active` (`is_active`)
);
