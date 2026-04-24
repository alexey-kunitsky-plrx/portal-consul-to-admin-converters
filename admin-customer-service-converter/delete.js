import "dotenv/config";

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
const LOCALES = ["ru", "en"];

async function apiRequest(method, url) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await response.text();
  let result = {};
  if (text) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        result = JSON.parse(text);
      } catch {
        result = { message: text };
      }
    } else {
      result = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      `API Error: ${response.status} ${response.statusText}\nURL: ${url}\n${JSON.stringify(result, null, 2)}`,
    );
  }
  return result;
}

async function deleteCollection(endpoint, label) {
  log.category(`🗑  Deleting ${label}`);

  let deleted = 0;
  let errors = 0;
  const processed = new Set();

  for (const locale of LOCALES) {
    try {
      log.info(`Fetching ${label} (locale=${locale})...`);
      const res = await apiRequest(
        "GET",
        `${API_BASE_URL}/${endpoint}?locale=${locale}&pagination[limit]=1000`,
      );
      const items = res.data || [];
      log.info(`Found ${items.length} ${label} (locale=${locale})`);

      for (const item of items) {
        const documentId = item.documentId || item.id;
        if (!documentId) {
          log.warning(`Skipping ${label} without documentId`);
          continue;
        }

        const key = `${locale}:${documentId}`;
        if (processed.has(key)) continue;

        const name = item.name || item.attributes?.name || documentId;
        try {
          log.item(`Deleting ${label} (locale=${locale}): ${name}`);
          await apiRequest(
            "DELETE",
            `${API_BASE_URL}/${endpoint}/${documentId}?locale=${locale}`,
          );
          log.success(`  Deleted ${documentId} (locale=${locale})`);
          deleted++;
          processed.add(key);
        } catch (err) {
          log.error(`Failed to delete ${label} ${documentId} (${locale})`);
          console.error(`  ${err.message}\n`);
          errors++;
        }
      }
    } catch (err) {
      log.error(`Failed to fetch ${label} (locale=${locale}): ${err.message}`);
      errors++;
    }
  }

  log.info(`\n${label}: ${deleted} deleted, ${errors} errors\n`);
  return { deleted, errors };
}

async function deleteAll() {
  log.info("Starting delete process...\n");

  const services = await deleteCollection(
    "customer-services",
    "customer services",
  );
  const categories = await deleteCollection(
    "customer-service-categories",
    "customer service categories",
  );

  log.category("📊 Summary");
  log.success(`Customer services deleted: ${services.deleted}`);
  if (services.errors > 0) log.warning(`  errors: ${services.errors}`);
  log.success(`Categories deleted: ${categories.deleted}`);
  if (categories.errors > 0) log.warning(`  errors: ${categories.errors}`);
  log.info("\n✅ Delete process completed!");
}

deleteAll().catch((err) => {
  log.error(`\nDelete failed: ${err.message}`);
  process.exit(1);
});
