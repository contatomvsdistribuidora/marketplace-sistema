/**
 * Debug script to test BaseLinker API tag filtering
 * Tests getInventoryProductsData to see how tags are returned
 */

const BASELINKER_API_URL = "https://api.baselinker.com/connector.php";

async function callApi(token, method, parameters = {}) {
  const body = new URLSearchParams();
  body.append("method", method);
  body.append("parameters", JSON.stringify(parameters));

  const response = await fetch(BASELINKER_API_URL, {
    method: "POST",
    headers: {
      "X-BLToken": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return response.json();
}

async function main() {
  // Read token from DB or env
  const token = process.env.BL_TOKEN;
  if (!token) {
    console.error("Set BL_TOKEN environment variable");
    process.exit(1);
  }

  const inventoryId = 25529;

  // Step 1: Get first page of products
  console.log("=== Step 1: Getting first page of products ===");
  const listResult = await callApi(token, "getInventoryProductsList", {
    inventory_id: inventoryId,
    page: 1,
  });
  const productIds = Object.keys(listResult.products || {}).map(Number);
  console.log(`Got ${productIds.length} products on page 1`);
  console.log(`First 5 IDs: ${productIds.slice(0, 5).join(", ")}`);

  // Step 2: Get detailed data for first 10 products to see tag format
  console.log("\n=== Step 2: Getting detailed data for first 10 products ===");
  const detailResult = await callApi(token, "getInventoryProductsData", {
    inventory_id: inventoryId,
    products: productIds.slice(0, 10),
  });

  for (const [id, product] of Object.entries(detailResult.products || {})) {
    console.log(`\nProduct ${id}: ${product.text_fields?.name || "no name"}`);
    console.log(`  tags: ${JSON.stringify(product.tags)}`);
    console.log(`  tags type: ${typeof product.tags}`);
    if (product.tags) {
      console.log(`  tags is array: ${Array.isArray(product.tags)}`);
      if (Array.isArray(product.tags) && product.tags.length > 0) {
        console.log(`  first tag type: ${typeof product.tags[0]}`);
        console.log(`  first tag value: ${JSON.stringify(product.tags[0])}`);
      }
    }
  }

  // Step 3: Try to find a product with HIGIPACK tag
  // Search through first few pages
  console.log("\n=== Step 3: Searching for HIGIPACK tagged products ===");
  
  // Try a specific product ID that we know has HIGIPACK tag (from the screenshot: ID 71607076)
  console.log("\nTrying product ID 71607076 (from screenshot)...");
  const specificResult = await callApi(token, "getInventoryProductsData", {
    inventory_id: inventoryId,
    products: [71607076],
  });
  
  if (specificResult.products && specificResult.products["71607076"]) {
    const p = specificResult.products["71607076"];
    console.log(`Product: ${p.text_fields?.name || "no name"}`);
    console.log(`Tags: ${JSON.stringify(p.tags)}`);
    console.log(`Full product keys: ${Object.keys(p).join(", ")}`);
    
    // Print all fields to understand the structure
    console.log("\n=== Full product structure (keys only) ===");
    for (const [key, value] of Object.entries(p)) {
      if (typeof value === 'object' && value !== null) {
        console.log(`  ${key}: ${Array.isArray(value) ? `array[${value.length}]` : `object{${Object.keys(value).slice(0,5).join(",")}...}`}`);
      } else {
        console.log(`  ${key}: ${typeof value} = ${JSON.stringify(value)?.substring(0, 100)}`);
      }
    }
  } else {
    console.log("Product 71607076 not found");
    console.log("Response:", JSON.stringify(specificResult).substring(0, 500));
  }
}

main().catch(console.error);
