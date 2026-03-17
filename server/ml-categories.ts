/**
 * Mercado Livre Categories Module
 * Downloads and caches the entire ML category tree in our database.
 * Uses concurrent fetching and background processing for speed.
 * Provides local search and validation of category IDs.
 */

import { eq, like, and, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { mlCategories } from "../drizzle/schema";

const ML_API_BASE = "https://api.mercadolibre.com";
const ML_SITE_ID = "MLB";
const CONCURRENCY = 15; // Parallel API requests

// Known root category IDs for MLB (Mercado Livre Brasil)
const MLB_ROOT_CATEGORIES = [
  "MLB1648",  // Informática
  "MLB1051",  // Celulares e Telefones
  "MLB1574",  // Casa, Móveis e Decoração
  "MLB1276",  // Esportes e Fitness
  "MLB1132",  // Brinquedos e Hobbies
  "MLB1430",  // Calçados, Roupas e Bolsas
  "MLB1953",  // Mais Categorias
  "MLB1459",  // Imóveis
  "MLB1071",  // Pet Shop
  "MLB5726",  // Eletrodomésticos
  "MLB1499",  // Indústria e Comércio
  "MLB1182",  // Instrumentos Musicais
  "MLB3937",  // Joias e Relógios
  "MLB1168",  // Música, Filmes e Seriados
  "MLB263532", // Ferramentas
  "MLB1196",  // Livros, Revistas e Comics
  "MLB1144",  // Games
  "MLB1500",  // Construção
  "MLB218519", // Ingressos
  "MLB1367",  // Antiguidades e Coleções
  "MLB1384",  // Bebês
  "MLB1246",  // Beleza e Cuidado Pessoal
  "MLB5672",  // Acessórios para Veículos
  "MLB1540",  // Serviços
  "MLB1000",  // Eletrônicos, Áudio e Vídeo
  "MLB1743",  // Carros, Motos e Outros
  "MLB1403",  // Alimentos e Bebidas
  "MLB264586", // Saúde
];

// ─── Background sync state ───────────────────────────────────────────────────
interface SyncStatus {
  running: boolean;
  downloaded: number;
  saved: number;
  total: number;
  phase: "idle" | "downloading" | "saving" | "done" | "error";
  currentRoot: string;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

let syncStatus: SyncStatus = {
  running: false,
  downloaded: 0,
  saved: 0,
  total: 0,
  phase: "idle",
  currentRoot: "",
  error: null,
  startedAt: null,
  completedAt: null,
};

export function getSyncStatus(): SyncStatus {
  // Auto-reset stuck state: if running for more than 10 minutes, consider it failed
  if (syncStatus.running && syncStatus.startedAt) {
    const elapsed = Date.now() - syncStatus.startedAt;
    if (elapsed > 10 * 60 * 1000) {
      console.warn(`[ML Categories] Sync appears stuck (${Math.round(elapsed / 1000)}s). Resetting state.`);
      syncStatus.running = false;
      syncStatus.phase = "error";
      syncStatus.error = "Sincronização expirou (timeout de 10 minutos)";
    }
  }
  return { ...syncStatus };
}

/**
 * Reset sync status (useful when state gets stuck)
 */
export function resetSyncStatus(): void {
  syncStatus = {
    running: false,
    downloaded: 0,
    saved: 0,
    total: 0,
    phase: "idle",
    currentRoot: "",
    error: null,
    startedAt: null,
    completedAt: null,
  };
}

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

// ─── Concurrent fetching with queue ──────────────────────────────────────────

/**
 * Fetch a single category from ML API with retry
 */
async function fetchCategory(categoryId: string, retries = 2): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `${ML_API_BASE}/categories/${categoryId}`;
      const response = await fetch(url);
      if (response.status === 429) {
        // Rate limited - wait and retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!response.ok) {
        console.error(`[ML Categories] Failed to fetch ${categoryId}: ${response.status}`);
        return null;
      }
      return response.json();
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return null;
}

/**
 * Process a queue of category IDs concurrently using a worker pool
 */
async function processQueue(
  queue: Array<{ id: string; parentId: string | null; level: number; pathNames: string[]; pathIds: string[] }>,
  results: any[],
  concurrency: number
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const current = queue[index++];
      if (!current) break;

      const data = await fetchCategory(current.id);
      if (!data || !data.id) continue;

      const currentPathNames = [...current.pathNames, data.name];
      const currentPathIds = [...current.pathIds, data.id];
      const children = data.children_categories || [];

      results.push({
        mlCategoryId: data.id,
        name: data.name,
        parentId: current.parentId,
        pathFromRoot: currentPathNames.join(" > "),
        pathIds: currentPathIds.join(","),
        totalItems: data.total_items_in_this_category || 0,
        hasChildren: children.length > 0 ? 1 : 0,
        isLeaf: children.length === 0 ? 1 : 0,
        level: current.level,
        picture: data.picture || null,
      });

      syncStatus.downloaded = results.length;

      // Add children to the queue
      for (const child of children) {
        queue.push({
          id: child.id,
          parentId: data.id,
          level: current.level + 1,
          pathNames: currentPathNames,
          pathIds: currentPathIds,
        });
      }
    }
  }

  // Start worker pool
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
}

/**
 * Start background sync of all ML categories
 * Returns immediately, use getSyncStatus() to check progress
 */
export function startBackgroundSync(force = false): { started: boolean; message?: string } {
  // If stuck (running but started > 5 min ago), auto-reset
  if (syncStatus.running && syncStatus.startedAt) {
    const elapsed = Date.now() - syncStatus.startedAt;
    if (elapsed > 5 * 60 * 1000) {
      console.warn(`[ML Categories] Force-resetting stuck sync state (${Math.round(elapsed / 1000)}s old)`);
      syncStatus.running = false;
    }
  }
  
  if (syncStatus.running) {
    return { started: false, message: "Sincronização já em andamento" };
  }

  syncStatus = {
    running: true,
    downloaded: 0,
    saved: 0,
    total: 0,
    phase: "downloading",
    currentRoot: "",
    error: null,
    startedAt: Date.now(),
    completedAt: null,
  };

  // Run in background (fire and forget)
  doSync().catch((err) => {
    console.error("[ML Categories] Background sync error:", err);
    syncStatus.phase = "error";
    syncStatus.error = err.message || String(err);
    syncStatus.running = false;
  });

  return { started: true };
}

async function doSync() {
  const db = getDb();

  console.log(`[ML Categories] Starting concurrent category sync (concurrency=${CONCURRENCY})...`);

  // Build initial queue from root categories
  const queue: Array<{ id: string; parentId: string | null; level: number; pathNames: string[]; pathIds: string[] }> = 
    MLB_ROOT_CATEGORIES.map((id) => ({
      id,
      parentId: null,
      level: 0,
      pathNames: [],
      pathIds: [],
    }));

  const allCategories: any[] = [];
  syncStatus.phase = "downloading";

  // Process the queue concurrently
  await processQueue(queue, allCategories, CONCURRENCY);

  console.log(`[ML Categories] Downloaded ${allCategories.length} categories. Saving to database...`);
  syncStatus.phase = "saving";
  syncStatus.total = allCategories.length;

  // Clear existing categories
  await db.delete(mlCategories);

  // Insert in batches of 200
  const batchSize = 200;
  for (let i = 0; i < allCategories.length; i += batchSize) {
    const batch = allCategories.slice(i, i + batchSize);
    await db.insert(mlCategories).values(batch);
    syncStatus.saved = Math.min(i + batchSize, allCategories.length);
  }

  const duration = Math.round((Date.now() - (syncStatus.startedAt || Date.now())) / 1000);
  console.log(`[ML Categories] Sync complete: ${allCategories.length} categories in ${duration}s`);

  syncStatus.phase = "done";
  syncStatus.running = false;
  syncStatus.completedAt = Date.now();
  syncStatus.total = allCategories.length;
}

/**
 * Get category count in database
 */
export async function getCategoryCount(): Promise<number> {
  const db = getDb();
  const [result] = await db.select({ count: sql<number>`COUNT(*)` }).from(mlCategories);
  return result?.count || 0;
}

/**
 * Validate if a category ID exists in our local database
 */
export async function validateCategoryId(mlCategoryId: string): Promise<boolean> {
  const db = getDb();
  const [result] = await db
    .select()
    .from(mlCategories)
    .where(eq(mlCategories.mlCategoryId, mlCategoryId))
    .limit(1);
  return !!result;
}

/**
 * Get category info from local database
 */
export async function getLocalCategoryInfo(mlCategoryId: string) {
  const db = getDb();
  const [result] = await db
    .select()
    .from(mlCategories)
    .where(eq(mlCategories.mlCategoryId, mlCategoryId))
    .limit(1);
  return result || null;
}

/**
 * Search categories by name (full-text search)
 */
export async function searchCategories(query: string, limit: number = 20, leafOnly = false) {
  const db = getDb();
  
  const conditions = [like(mlCategories.name, `%${query}%`)];
  if (leafOnly) {
    conditions.push(eq(mlCategories.isLeaf, 1));
  }

  const results = await db
    .select({
      mlCategoryId: mlCategories.mlCategoryId,
      name: mlCategories.name,
      pathFromRoot: mlCategories.pathFromRoot,
      totalItems: mlCategories.totalItems,
      isLeaf: mlCategories.isLeaf,
      level: mlCategories.level,
    })
    .from(mlCategories)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(desc(mlCategories.totalItems))
    .limit(limit);

  return results;
}

/**
 * Search categories by name, prioritizing leaf categories
 */
export async function searchLeafCategories(query: string, limit: number = 20) {
  return searchCategories(query, limit, true);
}

/**
 * Get children of a category
 */
export async function getCategoryChildren(parentCategoryId: string) {
  const db = getDb();
  
  return db
    .select({
      mlCategoryId: mlCategories.mlCategoryId,
      name: mlCategories.name,
      pathFromRoot: mlCategories.pathFromRoot,
      totalItems: mlCategories.totalItems,
      hasChildren: mlCategories.hasChildren,
      isLeaf: mlCategories.isLeaf,
    })
    .from(mlCategories)
    .where(eq(mlCategories.parentId, parentCategoryId))
    .orderBy(mlCategories.name);
}

/**
 * Get root categories
 */
export async function getRootCategories() {
  const db = getDb();
  
  return db
    .select({
      mlCategoryId: mlCategories.mlCategoryId,
      name: mlCategories.name,
      totalItems: mlCategories.totalItems,
      hasChildren: mlCategories.hasChildren,
    })
    .from(mlCategories)
    .where(eq(mlCategories.level, 0))
    .orderBy(mlCategories.name);
}

/**
 * Find the best matching category for a product using local search + domain_discovery
 * This is the main function used during publishing
 */
export async function findBestCategory(productName: string): Promise<{
  categoryId: string;
  categoryName: string;
  pathFromRoot: string;
  source: "local_db" | "domain_discovery" | "search_fallback";
} | null> {
  // 1. First try domain_discovery API (it's usually accurate for the category ID)
  try {
    const url = `${ML_API_BASE}/sites/${ML_SITE_ID}/domain_discovery/search?q=${encodeURIComponent(productName)}`;
    console.log(`[ML findBestCategory] Trying domain_discovery for: "${productName}"`);
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const predicted = data[0];
        const predictedId = predicted.category_id;
        console.log(`[ML findBestCategory] domain_discovery suggested: ${predictedId} (${predicted.category_name})`);
        
        // Validate against local DB
        const localCat = await getLocalCategoryInfo(predictedId);
        if (localCat) {
          console.log(`[ML findBestCategory] Validated in local DB: ${predictedId} = ${localCat.name}`);
          return {
            categoryId: predictedId,
            categoryName: localCat.name,
            pathFromRoot: localCat.pathFromRoot || localCat.name,
            source: "domain_discovery",
          };
        } else {
          console.warn(`[ML findBestCategory] domain_discovery ID ${predictedId} NOT found in local DB, trying API validation...`);
          
          // Try to validate directly with ML API as fallback
          try {
            const catResponse = await fetch(`${ML_API_BASE}/categories/${predictedId}`);
            if (catResponse.ok) {
              const catData = await catResponse.json();
              console.log(`[ML findBestCategory] Validated via API: ${predictedId} = ${catData.name}`);
              return {
                categoryId: predictedId,
                categoryName: catData.name,
                pathFromRoot: (catData.path_from_root || []).map((p: any) => p.name).join(" > "),
                source: "domain_discovery",
              };
            }
          } catch (e) {
            console.error(`[ML findBestCategory] API validation failed for ${predictedId}`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`[ML findBestCategory] domain_discovery error:`, error);
  }

  // 2. Fallback: search local DB by product name keywords
  console.log(`[ML findBestCategory] Falling back to local DB search...`);
  const keywords = productName.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
  
  for (const keyword of keywords) {
    const results = await searchLeafCategories(keyword, 5);
    if (results.length > 0) {
      const best = results[0];
      console.log(`[ML findBestCategory] Local search found: ${best.mlCategoryId} (${best.name}) via keyword "${keyword}"`);
      return {
        categoryId: best.mlCategoryId,
        categoryName: best.name,
        pathFromRoot: best.pathFromRoot || best.name,
        source: "search_fallback",
      };
    }
  }

  console.error(`[ML findBestCategory] No category found for: "${productName}"`);
  return null;
}
