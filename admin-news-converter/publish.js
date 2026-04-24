import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchAllFeatureFlags,
  resolveFeatureFlagsDeep,
} from "../shared/feature-flags.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.STRAPI_URL || !process.env.STRAPI_TOKEN) {
  console.error(
    "Missing required env vars. Set STRAPI_URL and STRAPI_TOKEN in .env (see .env.example).",
  );
  process.exit(1);
}

const baseUrl = process.env.STRAPI_URL.replace(/\/+$/, "");
const token = process.env.STRAPI_TOKEN;

// Read the converted news data
const convertedNews = JSON.parse(
  fs.readFileSync(path.join(__dirname, "converted-news-stage.json"), "utf8")
);

// Build { code → validator } in memory from the converted records themselves.
const validatorsByCode = {};
for (const entry of convertedNews) {
  const code = entry.ru?.data?.featureFlag;
  if (code && entry.validator !== undefined) {
    validatorsByCode[code] = entry.validator;
  }
}

let flagsCache;
const createdFeatureFlags = new Set();
async function resolvePayload(body) {
  await resolveFeatureFlagsDeep(body, {
    baseUrl,
    token,
    cache: flagsCache,
    createdCodes: createdFeatureFlags,
    validatorsByCode,
  });
}

// Collect unique slack channels from the converted data.
const sourceChannels = new Map();
for (const entry of convertedNews) {
  const ch = entry.ru?.data?.channel;
  if (ch && typeof ch === "object" && ch.name && !sourceChannels.has(ch.name)) {
    sourceChannels.set(ch.name, ch);
  }
}

const createdSlackChannels = new Set();

async function ensureSlackChannels() {
  const cache = new Map();

  let page = 1;
  let pageCount = 1;
  while (page <= pageCount) {
    const url = `${baseUrl}/api/slack-channels?fields[0]=name&pagination[page]=${page}&pagination[pageSize]=100`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch slack-channels: ${res.status} - ${await res.text()}`,
      );
    }
    const result = await res.json();
    for (const item of result.data || []) {
      const name = item.attributes?.name ?? item.name;
      if (name) cache.set(name, item.id);
    }
    pageCount = result.meta?.pagination?.pageCount ?? 1;
    page += 1;
  }
  console.log(`✓ Loaded ${cache.size} slack channels from Strapi`);

  for (const [name, source] of sourceChannels) {
    if (cache.has(name)) continue;
    const res = await fetch(`${baseUrl}/api/slack-channels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { name, color: source.color } }),
    });
    if (!res.ok) {
      console.error(
        `  ✗ Failed to create slack-channel "${name}": ${res.status} - ${await res.text()}`,
      );
      continue;
    }
    const result = await res.json();
    cache.set(name, result.data.id);
    createdSlackChannels.add(name);
    console.log(`  ✓ Created slack-channel: "${name}" (ID: ${result.data.id})`);
  }

  return cache;
}

let channelsCache;

function resolveChannel(body) {
  const ch = body?.data?.channel;
  if (ch && typeof ch === "object" && ch.name) {
    const id = channelsCache.get(ch.name);
    if (id) {
      body.data.channel = id;
    } else {
      delete body.data.channel;
    }
  }
}

// Download the remote URL once and upload to Strapi's media library.
// Returns a file id or null (keeps the relation empty on failure).
const imageCache = new Map(); // url → id
const uploadedImages = new Set();

async function uploadImageFromUrl(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);

  try {
    const download = await fetch(url);
    if (!download.ok) {
      console.warn(
        `  ⚠ Failed to download image ${url}: ${download.status}`,
      );
      imageCache.set(url, null);
      return null;
    }
    const arrayBuffer = await download.arrayBuffer();
    const contentType =
      download.headers.get("content-type") || "application/octet-stream";
    const filename = (url.split("/").pop() || "image").split("?")[0];

    const form = new FormData();
    form.append("files", new Blob([arrayBuffer], { type: contentType }), filename);

    const upload = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!upload.ok) {
      console.warn(
        `  ⚠ Failed to upload image ${filename}: ${upload.status} - ${await upload.text()}`,
      );
      imageCache.set(url, null);
      return null;
    }
    const result = await upload.json();
    const id = Array.isArray(result) ? result[0]?.id : result.id;
    if (!id) {
      console.warn(`  ⚠ Upload returned no id for ${filename}`);
      imageCache.set(url, null);
      return null;
    }
    imageCache.set(url, id);
    uploadedImages.add(filename);
    console.log(`  ✓ Uploaded image: ${filename} (ID: ${id})`);
    return id;
  } catch (err) {
    console.warn(`  ⚠ Failed to upload image ${url}: ${err.message}`);
    imageCache.set(url, null);
    return null;
  }
}

async function resolveImage(body) {
  const url = body?.data?.imageUrl;
  if (url) {
    const id = await uploadImageFromUrl(url);
    if (id) body.data.image = id;
  }
  if (body?.data) delete body.data.imageUrl;
}

// Function to POST a single news entry
async function publishNewsEntry(entry, title = "") {
  try {
    const response = await fetch(`${baseUrl}/api/news`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(entry),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${text}`);
    }

    const result = await response.json();
    console.log(`✅ Successfully published entry: ${title}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to publish entry: ${title}`, error.message);
    throw error;
  }
}

// Function to PUT a news entry (for localization updates)
async function updateNewsEntry(documentId, entry, locale, title = "") {
  try {
    const response = await fetch(
      `${baseUrl}/api/news/${documentId}?locale=${locale}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(entry),
      }
    );

    if (!response.ok) {
      console.error(await response.text());
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log(`✅ Successfully updated entry: ${title}`);
    return result;
  } catch (error) {
    console.error(error);
    console.error(`❌ Failed to update entry: ${title}`, error.message);
    throw error;
  }
}

// Function to publish all news entries
async function publishAllNews() {
  console.log(`Starting to publish ${convertedNews.length} news entries...`);

  flagsCache = await fetchAllFeatureFlags({ baseUrl, token });
  channelsCache = await ensureSlackChannels();

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < convertedNews.length; i++) {
    const entry = convertedNews[i];
    const ruTitle = entry.ru?.data?.title || `Entry ${i + 1}`;
    console.log(
      `\nPublishing entry ${i + 1}/${convertedNews.length}: ${ruTitle}`
    );

    try {
      await resolvePayload(entry.ru);
      await resolvePayload(entry.en);
      resolveChannel(entry.ru);
      resolveChannel(entry.en);
      await resolveImage(entry.ru);
      await resolveImage(entry.en);

      // Step 1: Post RU variant
      console.log(`  📤 Posting RU variant...`);
      const ruResponse = await publishNewsEntry(entry.ru, `[RU] ${ruTitle}`);

      // Step 2: Extract documentId from response
      const documentId = ruResponse?.data?.documentId;
      if (!documentId) {
        throw new Error(
          `Failed to extract documentId from RU response: ${JSON.stringify(
            ruResponse
          )}`
        );
      }
      console.log(`  ✅ RU posted with documentId: ${documentId}`);

      // Step 3: PUT EN variant using documentId
      console.log(`  📤 Updating EN variant...`);
      const enTitle = entry.en?.data?.title || ruTitle;
      await updateNewsEntry(documentId, entry.en, "en", `[EN] ${enTitle}`);
      console.log(
        `  ✅ EN updated and linked to RU (documentId: ${documentId})`
      );

      successCount++;

      // Add a small delay between requests to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Error publishing entry ${i + 1}:`, error);
    }
  }

  console.log("\n📊 Publishing Summary:");
  console.log(`✅ Successfully published: ${successCount}`);
  console.log(`❌ Failed to publish: ${errorCount}`);
  console.log(`📝 Total entries: ${convertedNews.length}`);

  if (createdFeatureFlags.size > 0) {
    console.log(`\nFeature flags created (${createdFeatureFlags.size}):`);
    for (const code of createdFeatureFlags) console.log(`  + ${code}`);
  }

  if (createdSlackChannels.size > 0) {
    console.log(`\nSlack channels created (${createdSlackChannels.size}):`);
    for (const name of createdSlackChannels) console.log(`  + ${name}`);
  }

  if (uploadedImages.size > 0) {
    console.log(`\nImages uploaded (${uploadedImages.size}):`);
    for (const name of uploadedImages) console.log(`  + ${name}`);
  }
}

// Run the publishing process
publishAllNews().catch((error) => {
  console.error("Fatal error during publishing:", error);
  process.exit(1);
});
