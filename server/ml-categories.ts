/**
 * Mercado Livre Categories Module
 * Downloads and caches the entire ML category tree in our database.
 * Provides local search and validation of category IDs.
 */

import { eq, like, and, sql, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { mlCategories } from "../drizzle/schema";

const ML_API_BASE = "https://api.mercadolibre.com";
const ML_SITE_ID = "MLB";

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

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return drizzle(process.env.DATABASE_URL);
}

/**
 * Fetch a single category from ML API
 */
async function fetchCategory(categoryId: string): Promise<any> {
  const url = `${ML_API_BASE}/categories/${categoryId}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`[ML Categories] Failed to fetch ${categoryId}: ${response.status}`);
    return null;
  }
  return response.json();
}

/**
 * Recursively download all categories from a root category
 */
async function downloadCategoryTree(
  categoryId: string,
  parentId: string | null,
  level: number,
  pathNames: string[],
  pathIds: string[],
  onProgress?: (count: number, name: string) => void
): Promise<Array<{
  mlCategoryId: string;
  name: string;
  parentId: string | null;
  pathFromRoot: string;
  pathIds: string;
  totalItems: number;
  hasChildren: number;
  isLeaf: number;
  level: number;
  picture: string | null;
}>> {
  const data = await fetchCategory(categoryId);
  if (!data || !data.id) return [];

  const currentPathNames = [...pathNames, data.name];
  const currentPathIds = [...pathIds, data.id];
  const children = data.children_categories || [];

  const result: any[] = [{
    mlCategoryId: data.id,
    name: data.name,
    parentId,
    pathFromRoot: currentPathNames.join(" > "),
    pathIds: currentPathIds.join(","),
    totalItems: data.total_items_in_this_category || 0,
    hasChildren: children.length > 0 ? 1 : 0,
    isLeaf: children.length === 0 ? 1 : 0,
    level,
    picture: data.picture || null,
  }];

  onProgress?.(1, data.name);

  // Small delay to avoid rate limiting
  await new Promise((r) => setTimeout(r, 50));

  // Recursively fetch children
  for (const child of children) {
    const childResults = await downloadCategoryTree(
      child.id,
      data.id,
      level + 1,
      currentPathNames,
      currentPathIds,
      onProgress
    );
    result.push(...childResults);
  }

  return result;
}

/**
 * Sync all ML categories to our database
 * Downloads the entire category tree recursively and saves to DB
 */
export async function syncAllCategories(
  onProgress?: (downloaded: number, total: number, currentName: string) => void
): Promise<{ total: number; duration: number }> {
  const startTime = Date.now();
  const db = getDb();
  let totalDownloaded = 0;

  console.log(`[ML Categories] Starting full category sync...`);

  const allCategories: any[] = [];

  for (const rootId of MLB_ROOT_CATEGORIES) {
    console.log(`[ML Categories] Downloading tree for ${rootId}...`);
    const categories = await downloadCategoryTree(
      rootId,
      null,
      0,
      [],
      [],
      (count, name) => {
        totalDownloaded += count;
        onProgress?.(totalDownloaded, 0, name);
        if (totalDownloaded % 100 === 0) {
          console.log(`[ML Categories] Downloaded ${totalDownloaded} categories...`);
        }
      }
    );
    allCategories.push(...categories);
  }

  console.log(`[ML Categories] Downloaded ${allCategories.length} categories. Saving to database...`);

  // Clear existing categories and insert new ones in batches
  await db.delete(mlCategories);

  // Insert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < allCategories.length; i += batchSize) {
    const batch = allCategories.slice(i, i + batchSize);
    await db.insert(mlCategories).values(batch);
    if ((i / batchSize) % 10 === 0) {
      console.log(`[ML Categories] Inserted ${Math.min(i + batchSize, allCategories.length)}/${allCategories.length}...`);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`[ML Categories] Sync complete: ${allCategories.length} categories in ${duration}s`);

  return { total: allCategories.length, duration };
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
export async function searchCategories(query: string, limit: number = 20) {
  const db = getDb();
  
  // Search for leaf categories (the ones you can actually list in)
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
    .where(like(mlCategories.name, `%${query}%`))
    .orderBy(desc(mlCategories.totalItems))
    .limit(limit);

  return results;
}

/**
 * Search categories by name, prioritizing leaf categories
 */
export async function searchLeafCategories(query: string, limit: number = 20) {
  const db = getDb();
  
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
    .where(
      and(
        like(mlCategories.name, `%${query}%`),
        eq(mlCategories.isLeaf, 1)
      )
    )
    .orderBy(desc(mlCategories.totalItems))
    .limit(limit);

  return results;
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
          console.warn(`[ML findBestCategory] domain_discovery ID ${predictedId} NOT found in local DB, trying local search...`);
          
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
