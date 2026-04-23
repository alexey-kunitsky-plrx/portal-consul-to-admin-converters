import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      throw new Error(`HTTP error! status: ${response.status}`);
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

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < convertedNews.length; i++) {
    const entry = convertedNews[i];
    const ruTitle = entry.ru?.data?.title || `Entry ${i + 1}`;
    console.log(
      `\nPublishing entry ${i + 1}/${convertedNews.length}: ${ruTitle}`
    );

    try {
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
}

// Run the publishing process
publishAllNews().catch((error) => {
  console.error("Fatal error during publishing:", error);
  process.exit(1);
});
