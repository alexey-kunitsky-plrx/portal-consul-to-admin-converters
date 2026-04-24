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

// --only <substring>: publish only events whose RU or EN name contains the
// substring (case-insensitive). Existing event-categories are fetched instead
// of recreated, so safe to re-run after a full publish.
const onlyIdx = process.argv.indexOf("--only");
const onlyFilter =
  onlyIdx !== -1 && process.argv[onlyIdx + 1]
    ? process.argv[onlyIdx + 1].toLowerCase()
    : null;

const convertedCategories = JSON.parse(
  fs.readFileSync(path.join(__dirname, "converted-categories.json"), "utf8"),
);

const convertedEvents = JSON.parse(
  fs.readFileSync(path.join(__dirname, "converted-events.json"), "utf8"),
);

// Build { code → validator } in memory from the converted records themselves.
// No external list file — Strapi is the source of truth for feature flags;
// we only read validators to populate `conditions` of flags we have to create.
const validatorsByCode = {};
for (const event of convertedEvents) {
  const code = event.ru?.data?.featureFlag;
  if (code && event.validator !== undefined) {
    validatorsByCode[code] = event.validator;
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

// Download the remote URL once and upload to Strapi's media library.
// Returns a file id or null (keeps the relation empty on failure).
const imageCache = new Map();
const uploadedImages = new Set();

async function uploadImageFromUrl(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);

  try {
    const download = await fetch(url);
    if (!download.ok) {
      console.warn(`  ⚠ Failed to download image ${url}: ${download.status}`);
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

// Drop date fields that are null — Strapi's date validator rejects "" and null
// with "Invalid format, expected yyyy-MM-dd".
function cleanNullDates(body) {
  if (!body?.data) return;
  for (const key of ["startDate", "endDate", "startTime"]) {
    if (body.data[key] === null || body.data[key] === "") {
      delete body.data[key];
    }
  }
}

async function postEntry(endpoint, body, label = "") {
  const response = await fetch(`${baseUrl}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST /${endpoint} ${response.status}: ${text}`);
  }

  const result = await response.json();
  console.log(`  ✅ POST [RU] ${label}`);
  return result;
}

async function putEntry(endpoint, documentId, locale, body, label = "") {
  const response = await fetch(
    `${baseUrl}/api/${endpoint}/${documentId}?locale=${locale}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `PUT /${endpoint}/${documentId}?locale=${locale} ${response.status}: ${text}`,
    );
  }

  const result = await response.json();
  console.log(`  ✅ PUT  [EN] ${label}`);
  return result;
}

// Fetch existing event-categories from Strapi (used by --only mode to avoid
// recreating categories on re-runs).
async function fetchCategoryMap() {
  const map = new Map();
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount) {
    const url = `${baseUrl}/api/event-categories?locale=en&pagination[page]=${page}&pagination[pageSize]=100`;
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch event-categories: ${res.status} - ${await res.text()}`,
      );
    }
    const data = await res.json();
    for (const item of data.data || []) {
      const name = item.attributes?.name ?? item.name;
      if (name) map.set(name, item.id);
    }
    pageCount = data.meta?.pagination?.pageCount ?? 1;
    page += 1;
  }
  console.log(`✓ Loaded ${map.size} event-categories from Strapi`);
  return map;
}

// Phase 1: create categories, build name → id map
async function publishCategories() {
  console.log(
    `\n📁 Phase 1: Publishing ${convertedCategories.length} categories...`,
  );

  const categoryMap = new Map();
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < convertedCategories.length; i++) {
    const cat = convertedCategories[i];
    const nameEn = cat.en.data.name;
    console.log(
      `\n[${i + 1}/${convertedCategories.length}] Category: ${nameEn}`,
    );

    try {
      const ruRes = await postEntry("event-categories", cat.ru, nameEn);
      const documentId = ruRes?.data?.documentId;
      if (!documentId) {
        throw new Error(`No documentId in response: ${JSON.stringify(ruRes)}`);
      }

      await putEntry("event-categories", documentId, "en", cat.en, nameEn);

      categoryMap.set(nameEn, ruRes.data.id);
      ok++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      fail++;
      console.error(`  ❌ ${nameEn}:`, err.message);
    }
  }

  console.log(`\n📊 Categories: ${ok} ok, ${fail} failed`);
  return categoryMap;
}

// Phase 2: create events
async function publishEvents(categoryMap) {
  const events = onlyFilter
    ? convertedEvents.filter((ev) => {
        const ru = (ev.ru?.data?.name || "").toLowerCase();
        const en = (ev.en?.data?.name || "").toLowerCase();
        return ru.includes(onlyFilter) || en.includes(onlyFilter);
      })
    : convertedEvents;

  if (onlyFilter) {
    console.log(
      `\n🎯 --only "${onlyFilter}": matched ${events.length}/${convertedEvents.length} event(s)`,
    );
    for (const ev of events) console.log(`  - ${ev.ru?.data?.name}`);
  }

  console.log(`\n📅 Phase 2: Publishing ${events.length} events...`);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const nameRu = event.ru.data.name;
    const categoryId = categoryMap.get(event.categoryKey);

    if (categoryId == null) {
      console.error(
        `  ❌ [${i + 1}] No category ID for "${event.categoryKey}", skipping: ${nameRu}`,
      );
      fail++;
      continue;
    }

    const ruBody = {
      data: { ...event.ru.data, category: categoryId },
    };
    const enBody = {
      data: { ...event.en.data, category: categoryId },
    };

    console.log(`\n[${i + 1}/${events.length}] ${nameRu}`);

    try {
      await resolvePayload(ruBody);
      await resolvePayload(enBody);
      await resolveImage(ruBody);
      await resolveImage(enBody);
      cleanNullDates(ruBody);
      cleanNullDates(enBody);

      const ruRes = await postEntry("events", ruBody, nameRu);
      const documentId = ruRes?.data?.documentId;
      if (!documentId) {
        throw new Error(`No documentId in response: ${JSON.stringify(ruRes)}`);
      }

      await putEntry("events", documentId, "en", enBody, nameRu);

      ok++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      fail++;
      console.error(`  ❌ ${nameRu}:`, err.message);
    }
  }

  console.log(`\n📊 Events: ${ok} ok, ${fail} failed`);
}

async function main() {
  console.log(`Base URL: ${baseUrl}`);

  flagsCache = await fetchAllFeatureFlags({ baseUrl, token });

  const categoryMap = onlyFilter
    ? await fetchCategoryMap()
    : await publishCategories();
  await publishEvents(categoryMap);

  if (createdFeatureFlags.size > 0) {
    console.log(`\nFeature flags created (${createdFeatureFlags.size}):`);
    for (const code of createdFeatureFlags) console.log(`  + ${code}`);
  }

  if (uploadedImages.size > 0) {
    console.log(`\nImages uploaded (${uploadedImages.size}):`);
    for (const name of uploadedImages) console.log(`  + ${name}`);
  }

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
