-- Fase 7.B — cache local de dim/custo BaseLinker + timestamps last-write-wins.
--
-- Adiciona em product_cache:
--   • dimension_length / dimension_width / dimension_height (VARCHAR pra
--     manter consistência com weight existente; BL retorna numérico mas
--     mantemos string pra evitar perda de precisão).
--   • average_cost / average_landed_cost (custo unitário BL — Fase 7.A
--     decisão #1 aprovou incluir custo neste cache).
--   • weight_updated_local_at / weight_updated_bl_at —
--     timestamps last-write-wins pro grupo PESO.
--   • dim_updated_local_at / dim_updated_bl_at —
--     idem pro grupo DIM (3 dimensões compartilham os mesmos timestamps).
--   • cost_updated_local_at / cost_updated_bl_at —
--     idem pro grupo CUSTO (cost + landedCost compartilham timestamps).
--
-- Last-write-wins: sync BL só sobrescreve um grupo quando bl_at > local_at.
-- Se operador editou local depois da última sync BL, local vence.
--
-- Idempotente via stored procedure que checa information_schema antes do ADD.
-- Mesmo padrão de 0023_product_cache_videos.sql. NÃO usa IF NOT EXISTS no
-- ALTER (MySQL 9 community não suporta — só MariaDB).
--
-- Statements separados por `--> statement-breakpoint` pra preservar BEGIN/END
-- da PROCEDURE durante o split.

DROP PROCEDURE IF EXISTS add_product_cache_dim_cost_cols_0026;
--> statement-breakpoint
CREATE PROCEDURE add_product_cache_dim_cost_cols_0026()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'dimension_length'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `dimension_length` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'dimension_width'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `dimension_width` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'dimension_height'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `dimension_height` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'average_cost'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `average_cost` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'average_landed_cost'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `average_landed_cost` VARCHAR(32) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'weight_updated_local_at'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `weight_updated_local_at` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'weight_updated_bl_at'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `weight_updated_bl_at` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'dim_updated_local_at'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `dim_updated_local_at` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'dim_updated_bl_at'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `dim_updated_bl_at` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'cost_updated_local_at'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `cost_updated_local_at` TIMESTAMP NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'product_cache'
      AND column_name = 'cost_updated_bl_at'
  ) THEN
    ALTER TABLE `product_cache` ADD COLUMN `cost_updated_bl_at` TIMESTAMP NULL;
  END IF;
END;
--> statement-breakpoint
CALL add_product_cache_dim_cost_cols_0026();
--> statement-breakpoint
DROP PROCEDURE IF EXISTS add_product_cache_dim_cost_cols_0026;
