-- Idempotent column add para cachear vídeos do BaseLinker no product_cache.
--   videoUrl     — arquivo apto Shopee (extra_field_101404, objeto {url,title})
--   videoTitle   — nome do arquivo (do mesmo extra_field_101404.title)
--   videoLinkUrl — URL externa não-apta Shopee (extra_field_97122)
--
-- Padrão idêntico a 0015/0016: stored procedure que inspeciona
-- information_schema. MySQL 9.x community NÃO suporta ADD COLUMN IF NOT EXISTS
-- (recurso só do MariaDB). Statements separados por `--> statement-breakpoint`
-- pra evitar conflito com `;` dentro do BEGIN…END.

DROP PROCEDURE IF EXISTS add_product_cache_video_cols_0023;
--> statement-breakpoint
CREATE PROCEDURE add_product_cache_video_cols_0023()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'videoUrl'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `videoUrl` VARCHAR(1024) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'videoTitle'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `videoTitle` VARCHAR(256) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'videoLinkUrl'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `videoLinkUrl` VARCHAR(1024) NULL;
  END IF;
END;
--> statement-breakpoint
CALL add_product_cache_video_cols_0023();
--> statement-breakpoint
DROP PROCEDURE IF EXISTS add_product_cache_video_cols_0023;
