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

// Pass --channels to also delete all slack-channels (seeded by publish.js).
// Off by default because channels may be used by other features beyond news.
const deleteChannels = process.argv.includes("--channels");

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

async function deleteLocalizedCollection(endpoint, label, labelField = "title") {
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

        const name =
          item[labelField] || item.attributes?.[labelField] || documentId;
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

async function deleteSlackChannels() {
  log.category("🗑  Deleting slack channels");

  let deleted = 0;
  let errors = 0;

  try {
    const res = await apiRequest(
      "GET",
      `${API_BASE_URL}/slack-channels?pagination[limit]=1000`,
    );
    const items = res.data || [];
    log.info(`Found ${items.length} slack channels`);

    for (const item of items) {
      const documentId = item.documentId || item.id;
      if (!documentId) continue;
      const name = item.name || item.attributes?.name || documentId;
      try {
        log.item(`Deleting slack channel: ${name}`);
        await apiRequest("DELETE", `${API_BASE_URL}/slack-channels/${documentId}`);
        log.success(`  Deleted ${documentId}`);
        deleted++;
      } catch (err) {
        log.error(`Failed to delete slack channel ${documentId}`);
        console.error(`  ${err.message}\n`);
        errors++;
      }
    }
  } catch (err) {
    log.error(`Failed to fetch slack channels: ${err.message}`);
    errors++;
  }

  log.info(`\nSlack channels: ${deleted} deleted, ${errors} errors\n`);
  return { deleted, errors };
}

async function deleteAll() {
  log.info("Starting delete process...\n");

  const news = await deleteLocalizedCollection("news", "news");

  let channels = null;
  if (deleteChannels) {
    channels = await deleteSlackChannels();
  }

  log.category("📊 Summary");
  log.success(`News deleted: ${news.deleted}`);
  if (news.errors > 0) log.warning(`  errors: ${news.errors}`);
  if (channels) {
    log.success(`Slack channels deleted: ${channels.deleted}`);
    if (channels.errors > 0) log.warning(`  errors: ${channels.errors}`);
  } else {
    log.info(
      "Slack channels left intact. Pass --channels to delete them as well.",
    );
  }
  log.info("\n✅ Delete process completed!");
}

deleteAll().catch((err) => {
  log.error(`\nDelete failed: ${err.message}`);
  process.exit(1);
});
