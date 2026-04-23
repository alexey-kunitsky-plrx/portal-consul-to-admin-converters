import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd = process.argv.includes("--prod");

const baseUrl = isProd
  ? "https://itwa-personal-account-admin.local.playrix.com"
  : "https://itwa-stage-personal-account-admin.local.playrix.com";

const token =
  "c3336c3a937a8da442b39f608fa0bf64da28d137bf7de62e67c55da7ccd8bbbc1171cdb25dcc7df95bffeab1c53319f965dbc6031eddc7a588a303bac1b7f98619ecbf57a4374a7ba31bb74b09abb661cd1b06404be8cd9ccd89ed8ca8d1fdb72a9d2183343cad09f64bcf6050ce20828d6f867cd2a6486763ffda8a085f1290";

const convertedCategories = JSON.parse(
  fs.readFileSync(path.join(__dirname, "converted-categories.json"), "utf8"),
);

const convertedEvents = JSON.parse(
  fs.readFileSync(path.join(__dirname, "converted-events.json"), "utf8"),
);

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
  console.log(`\n📅 Phase 2: Publishing ${convertedEvents.length} events...`);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < convertedEvents.length; i++) {
    const event = convertedEvents[i];
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

    console.log(`\n[${i + 1}/${convertedEvents.length}] ${nameRu}`);

    try {
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
  console.log(`Environment: ${isProd ? "PROD" : "STAGE"}`);
  console.log(`Base URL: ${baseUrl}`);

  const categoryMap = await publishCategories();
  await publishEvents(categoryMap);

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
