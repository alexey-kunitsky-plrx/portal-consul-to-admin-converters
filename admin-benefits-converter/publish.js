import "dotenv/config";
import fs from "fs";

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  category: (msg) =>
    console.log(`\n${colors.cyan}${colors.bright}${msg}${colors.reset}`),
  item: (msg) => console.log(`  ${colors.green}→${colors.reset} ${msg}`),
};

if (!process.env.STRAPI_URL || !process.env.STRAPI_TOKEN) {
  console.error(
    "Missing required env vars. Set STRAPI_URL and STRAPI_TOKEN in .env (see .env.example).",
  );
  process.exit(1);
}

const API_BASE_URL = `${process.env.STRAPI_URL.replace(/\/+$/, "")}/api`;
const token = process.env.STRAPI_TOKEN;

// Read converted data
const convertedData = JSON.parse(
  fs.readFileSync("compensation-data-converted.json", "utf8")
);

// Helper function to make API requests
async function apiRequest(method, url, data = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };

  if (data) {
    options.body = JSON.stringify({ data });
  }

  try {
    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        `API Error: ${response.status} ${response.statusText}\n${JSON.stringify(
          result,
          null,
          2
        )}`
      );
    }

    return result;
  } catch (error) {
    if (error.message.includes("fetch failed")) {
      throw new Error(
        `Failed to connect to Strapi. Make sure Strapi is running on ${API_BASE_URL}`
      );
    }
    throw error;
  }
}

// Main publish function
async function publish() {
  log.info("Starting publish process...\n");

  const categoryMap = new Map(); // Maps category key to { ruDocumentId, enDocumentId }

  // Step 1: Create categories
  log.category("📁 Creating Benefit Categories");

  const ruCategories = convertedData.ru || {};
  const enCategories = convertedData.en || {};

  for (const [categoryKey, ruCategory] of Object.entries(ruCategories)) {
    if (categoryKey === "default") {
      log.warning(`Skipping default category`);
      continue;
    }

    const enCategory = enCategories[categoryKey];
    if (!enCategory) {
      log.warning(`No EN variant found for category ${categoryKey}, skipping`);
      continue;
    }

    try {
      // Create RU category
      log.info(`Creating category: ${categoryKey} (ru)`);
      const ruCategoryData = {
        section_code: ruCategory.section_code,
        name: ruCategory.name,
        description: ruCategory.description || null,
        featureFlag: ruCategory.featureFlag || null,
        links: ruCategory.links || null,
        actions: ruCategory.actions || null,
        locale: ruCategory.locale,
      };

      // Remove null fields
      if (ruCategoryData.description === null) {
        delete ruCategoryData.description;
      }
      if (ruCategoryData.featureFlag === null) {
        delete ruCategoryData.featureFlag;
      }
      if (ruCategoryData.links === null) {
        delete ruCategoryData.links;
      }
      if (ruCategoryData.actions === null) {
        delete ruCategoryData.actions;
      }

      const ruResponse = await apiRequest(
        "POST",
        `${API_BASE_URL}/benefit-categories`,
        ruCategoryData
      );

      const ruDocumentId = ruResponse.data.documentId || ruResponse.data.id;
      log.success(
        `Created category ${categoryKey} (ru) with documentId: ${ruDocumentId}`
      );

      // Create EN category variant
      log.info(`Creating category: ${categoryKey} (en)`);
      const enCategoryData = {
        section_code: enCategory.section_code,
        name: enCategory.name,
        description: enCategory.description || null,
        featureFlag: enCategory.featureFlag || null,
        links: enCategory.links || null,
        actions: enCategory.actions || null,
        locale: enCategory.locale,
      };

      // Remove null fields
      if (enCategoryData.description === null) {
        delete enCategoryData.description;
      }
      if (enCategoryData.featureFlag === null) {
        delete enCategoryData.featureFlag;
      }
      if (enCategoryData.links === null) {
        delete enCategoryData.links;
      }
      if (enCategoryData.actions === null) {
        delete enCategoryData.actions;
      }

      const enResponse = await apiRequest(
        "PUT",
        `${API_BASE_URL}/benefit-categories/${ruDocumentId}?locale=en`,
        enCategoryData
      );

      const enDocumentId = enResponse.data.documentId || enResponse.data.id;
      log.success(
        `Created category ${categoryKey} (en) with documentId: ${enDocumentId}`
      );

      categoryMap.set(categoryKey, {
        ruDocumentId: ruDocumentId,
        enDocumentId: enDocumentId,
      });

      log.info(`Category ${categoryKey} completed\n`);
    } catch (error) {
      log.error(`Failed to publish category ${categoryKey}`);
      console.error(`  Error: ${error.message}`);
      // Continue with next category instead of failing completely
    }
  }

  // Step 2: Create benefits for each category
  log.category("📦 Creating Benefits");

  let totalItems = 0;
  let createdItems = 0;

  for (const [categoryKey, ruCategory] of Object.entries(ruCategories)) {
    if (categoryKey === "default") {
      continue;
    }

    const categoryIds = categoryMap.get(categoryKey);
    if (!categoryIds) {
      log.warning(`Skipping category ${categoryKey} - no documentId found`);
      continue;
    }

    const enCategory = enCategories[categoryKey];
    if (!enCategory) {
      log.warning(`Skipping category ${categoryKey} - no EN variant found`);
      continue;
    }

    log.category(`Processing items for category: ${categoryKey}`);

    const items = ruCategory.items || [];
    const enItems = enCategory.items || [];
    totalItems += items.length;

    for (let i = 0; i < items.length; i++) {
      const ruItem = items[i];
      const enItem = enItems[i];

      if (!enItem) {
        log.warning(
          `No EN variant found for item ${i} in category ${categoryKey}`
        );
        continue;
      }

      try {
        // Create RU benefit
        const ruBenefitData = {
          category: categoryIds.ruDocumentId,
          name: ruItem.name,
          description: ruItem.description || null,
          featureFlag: ruItem.featureFlag || null,
          links: ruItem.links || null,
          actions: ruItem.actions || null,
          locale: ruItem.locale,
        };

        // Remove null fields
        if (ruBenefitData.description === null)
          delete ruBenefitData.description;
        if (ruBenefitData.featureFlag === null)
          delete ruBenefitData.featureFlag;
        if (ruBenefitData.links === null) delete ruBenefitData.links;
        if (ruBenefitData.actions === null) delete ruBenefitData.actions;

        log.item(`Creating benefit: ${ruItem.name} (ru)`);
        const ruBenefitResponse = await apiRequest(
          "POST",
          `${API_BASE_URL}/benefits`,
          ruBenefitData
        );

        const ruBenefitDocumentId =
          ruBenefitResponse.data.documentId || ruBenefitResponse.data.id;
        log.success(
          `  Created benefit (ru) with documentId: ${ruBenefitDocumentId}`
        );

        // Create EN benefit variant
        const enBenefitData = {
          category: categoryIds.enDocumentId,
          name: enItem.name,
          description: enItem.description || null,
          featureFlag: enItem.featureFlag || null,
          links: enItem.links || null,
          actions: enItem.actions || null,
          locale: enItem.locale,
        };

        // Remove null fields
        if (enBenefitData.description === null)
          delete enBenefitData.description;
        if (enBenefitData.featureFlag === null)
          delete enBenefitData.featureFlag;
        if (enBenefitData.links === null) delete enBenefitData.links;
        if (enBenefitData.actions === null) delete enBenefitData.actions;

        log.item(`Creating benefit: ${enItem.name} (en)`);
        const enBenefitResponse = await apiRequest(
          "PUT",
          `${API_BASE_URL}/benefits/${ruBenefitDocumentId}?locale=en`,
          enBenefitData
        );

        const enBenefitDocumentId =
          enBenefitResponse.data.documentId || enBenefitResponse.data.id;
        log.success(
          `  Created benefit (en) with documentId: ${enBenefitDocumentId}`
        );

        createdItems += 2; // Count both ru and en
      } catch (error) {
        const itemName = ruItem.name || enItem.name || `item ${i + 1}`;
        log.error(`Failed to publish benefit ${itemName}`);

        // Output detailed error information
        console.error(`\n  ${colors.red}Error details:${colors.reset}`);
        if (error.message) {
          console.error(`  Message: ${error.message}`);
        }

        // Try to extract and format API error details
        try {
          const errorStr = error.message || error.toString();
          if (errorStr.includes("API Error")) {
            // Extract the JSON part from the error message
            const jsonMatch = errorStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const errorData = JSON.parse(jsonMatch[0]);
                console.error(`  API Error Response:`);
                console.error(JSON.stringify(errorData, null, 4));
              } catch (e) {
                // If JSON parsing fails, just output the raw error
                console.error(`  API Error: ${errorStr}`);
              }
            } else {
              console.error(`  API Error: ${errorStr}`);
            }
          } else {
            // For non-API errors, show the full message
            console.error(`  Error: ${errorStr}`);
          }
        } catch (e) {
          // Fallback: output the error as-is
          console.error(`  Error: ${error.toString()}`);
        }

        console.error(""); // Empty line for readability

        // Continue with next item instead of failing completely
      }
    }

    log.info(
      `Completed category ${categoryKey}: ${items.length} items processed\n`
    );
  }

  // Summary
  log.category("📊 Summary");
  log.success(`Categories created: ${categoryMap.size}`);
  log.success(
    `Benefits created: ${createdItems} (${createdItems / 2} items × 2 locales)`
  );
  log.info("\n✅ Publish process completed successfully!");
}

// Run the publish function
publish().catch((error) => {
  log.error(`\nPublish failed: ${error.message}`);
  process.exit(1);
});
