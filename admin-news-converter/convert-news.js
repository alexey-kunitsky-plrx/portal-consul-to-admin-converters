import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const channelIdByChannelName = {
  "company-updates": 4,
  "dm-news": 5,
  "new-test-channel": 6,
  playrix_only: 3,
  project_news: 2,
};

const getChannelId = (channelName) => {
  if (!channelName) return 3;
  return channelIdByChannelName[channelName] || 3;
};

// Helper function to extract localized content
function getLocalizedContent(entry, locale) {
  const randomChannel = Math.floor(Math.random() * 2) + 1;
  const randomImage = Math.floor(Math.random() * 2) + 1;

  return {
    title: entry.title?.[locale] || `[${locale}] title`,
    link: entry.link || "",
    channel: getChannelId(entry.channel?.name),
    photoLink: entry.photoLink || null,
    image: 1,
    date: formatDate(entry.date),
    announcement: entry.announcement?.[locale] || `[${locale}] announcement`,
    author: entry.author?.[locale] || `[${locale}] author`,
    text: entry.text?.[locale] || `[${locale}] text`,
    pinned: entry.pinned || false,
    featureFlag: null,
    locale: locale,
  };
}

// Convert each news entry with both ru and en localizations
const convertedNews = newsData.map((entry) => {
  return {
    ru: {
      data: getLocalizedContent(entry, "ru"),
    },
    en: {
      data: getLocalizedContent(entry, "en"),
    },
  };
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
