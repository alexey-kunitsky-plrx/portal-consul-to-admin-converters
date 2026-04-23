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

const localAPI_BASE_URL = "http://localhost:1337/api";
const stageAPI_BASE_URL =
  "https://itwa-stage-personal-account-admin.local.playrix.com/api";

const API_BASE_URL = localAPI_BASE_URL;

const stageToken =
  "c3336c3a937a8da442b39f608fa0bf64da28d137bf7de62e67c55da7ccd8bbbc1171cdb25dcc7df95bffeab1c53319f965dbc6031eddc7a588a303bac1b7f98619ecbf57a4374a7ba31bb74b09abb661cd1b06404be8cd9ccd89ed8ca8d1fdb72a9d2183343cad09f64bcf6050ce20828d6f867cd2a6486763ffda8a085f1290";
const localToken =
  "8a448afe339787d38c5032a13cfde25fe7d460e2f4bbfc657f9bb2e0eb45b4ca9298bd0c253cf278a792b1e8912c2eb54ab7648c242fcbcb243d074b885169a026ba0e8025681dbdc688472a1eb6215bfd0cba7f5b156cb67f45bf0f82ea3808291e329005e4ba07d8fec3a58d0df44c72e5597fe7f82c06121b78c7f9722572";

// Authorization token (can be set via environment variable)
const token = localToken;

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

    // Handle empty responses (common for DELETE requests)
    let result;
    const contentType = response.headers.get("content-type");
    const text = await response.text();

    if (text && contentType && contentType.includes("application/json")) {
      try {
        result = JSON.parse(text);
      } catch (parseError) {
        throw new Error(
          `Failed to parse JSON response: ${
            parseError.message
          }\nResponse text: ${text.substring(0, 200)}`
        );
      }
    } else if (text) {
      // Non-JSON response
      result = { message: text };
    } else {
      // Empty response (common for successful DELETE)
      result = {};
    }

    if (!response.ok) {
      throw new Error(
        `API Error: ${response.status} ${
          response.statusText
        }\nURL: ${url}\n${JSON.stringify(result, null, 2)}`
      );
    }

    return result;
  } catch (error) {
    if (error.message.includes("fetch failed")) {
      throw new Error(
        `Failed to connect to Strapi. Make sure Strapi is running on ${API_BASE_URL}`
      );
    }
    if (error.message.includes("Unexpected end of JSON input")) {
      throw new Error(
        `Empty or invalid JSON response from ${url}\nMethod: ${method}\nThis might indicate the resource was already deleted or doesn't exist.`
      );
    }
    throw error;
  }
}

// Main delete function
async function deleteAll() {
  log.info("Starting delete process...\n");

  let deletedCategories = 0;
  let deletedBenefits = 0;
  let categoryErrors = 0;
  let benefitErrors = 0;
  const processedItems = new Set(); // Track processed items by locale+documentId

  // Step 1: Fetch and delete all benefits (items) by locale
  log.category("📦 Deleting Benefits");

  const locales = ["ru", "en"];
  for (const locale of locales) {
    try {
      log.info(`Fetching benefits with locale=${locale}...`);
      const benefitsResponse = await apiRequest(
        "GET",
        `${API_BASE_URL}/benefits?locale=${locale}&pagination[limit]=1000`
      );

      const benefits = benefitsResponse.data || [];
      log.info(
        `Found ${benefits.length} benefits (locale=${locale}) to delete\n`
      );

      for (const benefit of benefits) {
        const documentId = benefit.documentId || benefit.id;
        if (!documentId) {
          log.warning(
            `Skipping benefit without documentId: ${JSON.stringify(benefit)}`
          );
          continue;
        }

        // Track by locale+documentId to handle same documentId in different locales
        const itemKey = `${locale}:${documentId}`;
        if (processedItems.has(itemKey)) {
          log.warning(`Skipping already processed benefit: ${itemKey}`);
          continue;
        }

        try {
          log.item(
            `Deleting benefit (locale=${locale}): ${benefit.name || documentId}`
          );
          // Include locale parameter in DELETE request
          await apiRequest(
            "DELETE",
            `${API_BASE_URL}/benefits/${documentId}?locale=${locale}`
          );
          log.success(
            `  Deleted benefit with documentId: ${documentId} (locale=${locale})`
          );
          deletedBenefits++;
          processedItems.add(itemKey);
        } catch (error) {
          log.error(
            `Failed to delete benefit ${documentId} (locale=${locale})`
          );
          console.error(`  Name: ${benefit.name || "N/A"}`);
          console.error(`  DocumentId: ${documentId}`);
          console.error(`  URL: ${API_BASE_URL}/benefits/${documentId}`);
          console.error(`  Error: ${error.message}`);

          // Try to extract and format API error details
          try {
            const errorStr = error.message || error.toString();
            if (errorStr.includes("API Error")) {
              const jsonMatch = errorStr.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  const errorData = JSON.parse(jsonMatch[0]);
                  console.error(`  API Error Details:`);
                  console.error(JSON.stringify(errorData, null, 4));
                } catch (e) {
                  console.error(`  API Error: ${errorStr}`);
                }
              }
            }
          } catch (e) {
            // Fallback: output the error as-is
            console.error(`  Full Error: ${error.toString()}`);
          }
          console.error(""); // Empty line for readability
          benefitErrors++;
        }
      }
    } catch (error) {
      log.error(
        `Failed to fetch benefits (locale=${locale}): ${error.message}`
      );
      benefitErrors++;
    }
  }

  log.info(
    `\nCompleted benefits deletion: ${deletedBenefits} deleted, ${benefitErrors} errors\n`
  );

  // Step 2: Fetch and delete all benefit categories by locale
  log.category("📁 Deleting Benefit Categories");

  processedItems.clear(); // Reset for categories

  for (const locale of locales) {
    try {
      log.info(`Fetching categories with locale=${locale}...`);
      const categoriesResponse = await apiRequest(
        "GET",
        `${API_BASE_URL}/benefit-categories?locale=${locale}&pagination[limit]=1000`
      );

      const categories = categoriesResponse.data || [];
      log.info(
        `Found ${categories.length} categories (locale=${locale}) to delete\n`
      );

      for (const category of categories) {
        const documentId = category.documentId || category.id;
        if (!documentId) {
          log.warning(
            `Skipping category without documentId: ${JSON.stringify(category)}`
          );
          continue;
        }

        // Track by locale+documentId to handle same documentId in different locales
        const itemKey = `${locale}:${documentId}`;
        if (processedItems.has(itemKey)) {
          log.warning(`Skipping already processed category: ${itemKey}`);
          continue;
        }

        try {
          log.item(
            `Deleting category (locale=${locale}): ${
              category.name || documentId
            }`
          );
          // Include locale parameter in DELETE request
          await apiRequest(
            "DELETE",
            `${API_BASE_URL}/benefit-categories/${documentId}?locale=${locale}`
          );
          log.success(
            `  Deleted category with documentId: ${documentId} (locale=${locale})`
          );
          deletedCategories++;
          processedItems.add(itemKey);
        } catch (error) {
          log.error(
            `Failed to delete category ${documentId} (locale=${locale})`
          );
          console.error(`  Name: ${category.name || "N/A"}`);
          console.error(`  DocumentId: ${documentId}`);
          console.error(
            `  URL: ${API_BASE_URL}/benefit-categories/${documentId}`
          );
          console.error(`  Error: ${error.message}`);

          // Try to extract and format API error details
          try {
            const errorStr = error.message || error.toString();
            if (errorStr.includes("API Error")) {
              const jsonMatch = errorStr.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  const errorData = JSON.parse(jsonMatch[0]);
                  console.error(`  API Error Details:`);
                  console.error(JSON.stringify(errorData, null, 4));
                } catch (e) {
                  console.error(`  API Error: ${errorStr}`);
                }
              }
            }
          } catch (e) {
            // Fallback: output the error as-is
            console.error(`  Full Error: ${error.toString()}`);
          }
          console.error(""); // Empty line for readability
          categoryErrors++;
        }
      }
    } catch (error) {
      log.error(
        `Failed to fetch categories (locale=${locale}): ${error.message}`
      );
      categoryErrors++;
    }
  }

  log.info(
    `\nCompleted categories deletion: ${deletedCategories} deleted, ${categoryErrors} errors\n`
  );

  // Summary
  log.category("📊 Summary");
  log.success(`Benefits deleted: ${deletedBenefits}`);
  if (benefitErrors > 0) {
    log.warning(`Benefits errors: ${benefitErrors}`);
  }
  log.success(`Categories deleted: ${deletedCategories}`);
  if (categoryErrors > 0) {
    log.warning(`Categories errors: ${categoryErrors}`);
  }
  log.info("\n✅ Delete process completed!");
}

// Run the delete function
deleteAll().catch((error) => {
  log.error(`\nDelete failed: ${error.message}`);
  process.exit(1);
});
