import "dotenv/config";
import fs from "fs";
import {
  fetchAllFeatureFlags,
  resolveFeatureFlagsDeep,
} from "../shared/feature-flags.js";

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

const baseUrl = process.env.STRAPI_URL.replace(/\/+$/, "");
const API_BASE_URL = `${baseUrl}/api`;
const token = process.env.STRAPI_TOKEN;

let flagsCache;
const missingFeatureFlags = new Set();
async function resolvePayload(body) {
  await resolveFeatureFlagsDeep(body, {
    baseUrl,
    token,
    cache: flagsCache,
    missingCodes: missingFeatureFlags,
    autoCreate: false,
  });
}

// Read converted data
const convertedData = JSON.parse(
  fs.readFileSync("converted-customer-service-data.json", "utf8")
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

  flagsCache = await fetchAllFeatureFlags({ baseUrl, token });

  const categoryMap = new Map(); // Maps category key to { ruDocumentId, enDocumentId }

  // Step 1: Create categories
  log.category("📁 Creating Categories");

  for (const [categoryKey, category] of Object.entries(convertedData)) {
    if (categoryKey === "example") {
      log.warning(`Skipping example category`);
      continue;
    }

    try {
      // Create RU category
      log.info(`Creating category: ${categoryKey} (ru)`);
      const ruCategoryData = {
        section_code: categoryKey,
        name: category.ru.name,
        description: category.ru.description,
        locale: category.ru.locale,
      };

      const ruResponse = await apiRequest(
        "POST",
        `${API_BASE_URL}/customer-service-categories`,
        ruCategoryData
      );

      const ruDocumentId = ruResponse.data.documentId || ruResponse.data.id;
      log.success(
        `Created category ${categoryKey} (ru) with documentId: ${ruDocumentId}`
      );

      // Create EN category variant
      log.info(`Creating category: ${categoryKey} (en)`);
      const enCategoryData = {
        section_code: categoryKey,
        name: category.en.name,
        description: category.en.description,
        locale: category.en.locale,
      };

      const enResponse = await apiRequest(
        "PUT",
        `${API_BASE_URL}/customer-service-categories/${ruDocumentId}?locale=en`,
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
      // Continue with next category instead of failing completely
    }
  }

  // Step 2: Create customer services for each category
  log.category("📦 Creating Customer Services");

  let totalItems = 0;
  let createdItems = 0;

  for (const [categoryKey, category] of Object.entries(convertedData)) {
    if (categoryKey === "example") {
      continue;
    }

    const categoryIds = categoryMap.get(categoryKey);
    if (!categoryIds) {
      log.warning(`Skipping category ${categoryKey} - no documentId found`);
      continue;
    }

    log.category(`Processing items for category: ${categoryKey}`);

    // Process buttons - convert strongFeat to featureFlag if needed
    const processButtons = (buttons) => {
      if (!buttons || !Array.isArray(buttons)) return buttons;
      return buttons.map((button) => {
        const processedButton = { ...button };
        // Convert strongFeat to featureFlag if present
        if (processedButton.strongFeat && !processedButton.featureFlag) {
          processedButton.featureFlag = processedButton.strongFeat;
          delete processedButton.strongFeat;
        }
        return processedButton;
      });
    };

    const items = category.ru.items || [];
    totalItems += items.length;

    for (let i = 0; i < items.length; i++) {
      const ruItem = items[i];
      const enItem = category.en.items[i];

      if (!enItem) {
        log.warning(
          `No EN variant found for item ${i} in category ${categoryKey}`
        );
        continue;
      }

      try {
        // Create RU customer service
        const ruServiceData = {
          category: categoryIds.ruDocumentId,
          serviceId: ruItem.serviceId || null,
          taskId: ruItem.taskId || null,
          featureFlag: ruItem.featureFlag || null,
          name: ruItem.name,
          examples: ruItem.examples,
          description: ruItem.description,
          buttons: processButtons(ruItem.buttons),
          locale: ruItem.locale,
        };

        // Remove null fields
        if (ruServiceData.serviceId === null) delete ruServiceData.serviceId;
        if (ruServiceData.taskId === null) delete ruServiceData.taskId;
        if (ruServiceData.featureFlag === null)
          delete ruServiceData.featureFlag;

        // Handle description_inform_block if present (additional field)
        if (ruItem.description_inform_block) {
          ruServiceData.description_inform_block =
            ruItem.description_inform_block;
        }

        await resolvePayload(ruServiceData);

        log.item(`Creating service: ${ruItem.name} (ru)`);
        const ruServiceResponse = await apiRequest(
          "POST",
          `${API_BASE_URL}/customer-services`,
          ruServiceData
        );

        const ruServiceDocumentId =
          ruServiceResponse.data.documentId || ruServiceResponse.data.id;
        log.success(
          `  Created service (ru) with documentId: ${ruServiceDocumentId}`
        );

        // Create EN customer service variant
        const enServiceData = {
          category: categoryIds.enDocumentId,
          serviceId: enItem.serviceId || null,
          taskId: enItem.taskId || null,
          featureFlag: enItem.featureFlag || null,
          name: enItem.name,
          examples: enItem.examples,
          description: enItem.description,
          buttons: processButtons(enItem.buttons),
          locale: enItem.locale,
        };

        // Remove null fields
        if (enServiceData.serviceId === null) delete enServiceData.serviceId;
        if (enServiceData.taskId === null) delete enServiceData.taskId;
        if (enServiceData.featureFlag === null)
          delete enServiceData.featureFlag;

        // Handle description_inform_block if present (additional field)
        if (enItem.description_inform_block) {
          enServiceData.description_inform_block =
            enItem.description_inform_block;
        }

        await resolvePayload(enServiceData);

        log.item(`Creating service: ${enItem.name} (en)`);
        const enServiceResponse = await apiRequest(
          "PUT",
          `${API_BASE_URL}/customer-services/${ruServiceDocumentId}?locale=en`,
          enServiceData
        );

        const enServiceDocumentId =
          enServiceResponse.data.documentId || enServiceResponse.data.id;
        log.success(
          `  Created service (en) with documentId: ${enServiceDocumentId}`
        );

        createdItems += 2; // Count both ru and en
      } catch (error) {
        const serviceName = ruItem.name || enItem.name || `item ${i + 1}`;
        log.error(`Failed to publish service ${serviceName}`);

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
    `Customer services created: ${createdItems} (${
      createdItems / 2
    } items × 2 locales)`
  );
  if (missingFeatureFlags.size > 0) {
    log.warning(
      `Feature flags not found in Strapi (${missingFeatureFlags.size}) — create them manually and re-run, or the relation will stay empty:`,
    );
    for (const code of missingFeatureFlags) log.item(code);
  }
  log.info("\n✅ Publish process completed successfully!");
}

// Run the publish function
publish().catch((error) => {
  log.error(`\nPublish failed: ${error.message}`);
  process.exit(1);
});
