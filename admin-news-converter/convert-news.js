import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function getFeatureFlagCode(entry) {
  if (entry.validator === 1) return null;
  const slug =
    slugify(entry.title?.en || entry.title?.ru || "") || `news_${entry.id}`;
  return `${slug}_visible`;
}

// Format date to YYYY-MM-DD format
function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Read the original news.json file
const newsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "stage-news.json"), "utf8")
);

// Pass the channel through as { name, color } and let publish.js resolve it
// to a real Strapi id (creating the slack-channel entity if missing).
function getChannel(entry) {
  const name = entry.channel?.name;
  if (!name) return null;
  return { name, color: entry.channel?.color || null };
}

// Helper function to extract localized content.
// `imageUrl` is a pass-through field: publish.js downloads the URL, uploads
// it to Strapi's media library, and replaces it with `image: <file id>`.
function getLocalizedContent(entry, locale, featureFlag, channel, imageUrl) {
  return {
    title: entry.title?.[locale] || `[${locale}] title`,
    link: entry.link || "",
    channel,
    photoLink: entry.photoLink || entry.photos || null,
    imageUrl,
    date: formatDate(entry.date),
    announcement: entry.announcement?.[locale] || `[${locale}] announcement`,
    author: entry.author?.[locale] || `[${locale}] author`,
    text: entry.text?.[locale] || `[${locale}] text`,
    pinned: entry.pinned || false,
    featureFlag,
    locale: locale,
  };
}

// Convert each news entry with both ru and en localizations.
// Keep validator alongside the record so publish.js can build conditions
// for any missing feature flag without a separate list file.
const convertedNews = newsData.map((entry) => {
  const featureFlag = getFeatureFlagCode(entry);
  const channel = getChannel(entry);
  const imageUrl = typeof entry.image === "string" ? entry.image : null;
  const converted = {
    ru: {
      data: getLocalizedContent(entry, "ru", featureFlag, channel, imageUrl),
    },
    en: {
      data: getLocalizedContent(entry, "en", featureFlag, channel, imageUrl),
    },
  };
  if (entry.validator !== 1 && entry.validator !== undefined) {
    converted.validator = entry.validator;
  }
  return converted;
});

// Write the converted data to converted-news.json
fs.writeFileSync(
  path.join(__dirname, "converted-news-stage.json"),
  JSON.stringify(convertedNews, null, 2),
  "utf8"
);

console.log(
  `Successfully converted ${convertedNews.length} news entries to converted-news.json`
);
console.log("Conversion completed!");
