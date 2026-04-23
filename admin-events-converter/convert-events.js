import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "events.json"), "utf8")
);

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function parseDate(dateString) {
  if (!dateString) return { date: null, time: null };

  const isoMatch = dateString.match(
    /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/
  );
  if (isoMatch) {
    return {
      date: isoMatch[1],
      time: isoMatch[2] ? `${isoMatch[2]}.000` : null,
    };
  }

  const partialMatch = dateString.match(/^(\d{4}-\d{2})$/);
  if (partialMatch) {
    return { date: `${partialMatch[1]}-01`, time: null };
  }

  return { date: null, time: null };
}

// --- Phase 1: Deduplicate categories ---

const categoryColorCounts = new Map();

for (const entry of eventsData) {
  const cat = entry.category;
  if (!cat) continue;

  const nameEn = cat.name?.en?.trim();
  if (!nameEn) continue;

  if (!categoryColorCounts.has(nameEn)) {
    categoryColorCounts.set(nameEn, { nameRu: cat.name.ru, colors: {} });
  }

  const record = categoryColorCounts.get(nameEn);
  record.colors[cat.color] = (record.colors[cat.color] || 0) + 1;
}

const canonicalCategories = new Map();

for (const [nameEn, { nameRu, colors }] of categoryColorCounts) {
  const mostFrequentColor = Object.entries(colors).sort(
    (a, b) => b[1] - a[1]
  )[0][0];

  const normalizedNameEn =
    nameEn === "Eduacational" ? "Educational" : nameEn;

  if (!canonicalCategories.has(normalizedNameEn)) {
    canonicalCategories.set(normalizedNameEn, {
      nameRu,
      color: mostFrequentColor,
    });
  }
}

const convertedCategories = [];
for (const [nameEn, { nameRu, color }] of canonicalCategories) {
  convertedCategories.push({
    ru: { data: { name: nameRu, color, locale: "ru" } },
    en: { data: { name: nameEn, color, locale: "en" } },
  });
}

// --- Phase 2: Convert events + collect feature flags ---

const featureFlags = {};

function getLocalizedEventData(entry, locale) {
  const { date: startDate, time: startTime } = parseDate(entry.startDate);
  const { date: endDate } = parseDate(entry.endDate);

  let featureFlag = null;
  if (entry.validator !== 1) {
    const slug = slugify(entry.name?.en || entry.name?.ru || `event_${entry.id}`);
    featureFlag = `${slug}_visible`;
    featureFlags[featureFlag] = entry.validator;
  }

  return {
    name: entry.name?.[locale] || `[${locale}] name`,
    announcement: entry.announcement?.[locale] || `[${locale}] announcement`,
    text: entry.text?.[locale] || `[${locale}] text`,
    format: entry.format || "offline",
    image: null,
    startDate: startDate || "",
    endDate: endDate || startDate || "",
    startTime: startTime || null,
    cancelled: entry.cancelled || false,
    featureFlag,
    photoLink: entry.photoLink || null,
    slackLink: entry.slackLink || null,
    registrationFormLink: entry.registrationFormLink || null,
    locale,
  };
}

function getCategoryKey(entry) {
  const raw = entry.category?.name?.en?.trim();
  if (raw === "Eduacational") return "Educational";
  return raw || "Entertaining";
}

const convertedEvents = eventsData.map((entry) => ({
  categoryKey: getCategoryKey(entry),
  ru: { data: getLocalizedEventData(entry, "ru") },
  en: { data: getLocalizedEventData(entry, "en") },
}));

// --- Write output files ---

fs.writeFileSync(
  path.join(__dirname, "converted-categories.json"),
  JSON.stringify(convertedCategories, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(__dirname, "converted-events.json"),
  JSON.stringify(convertedEvents, null, 2),
  "utf8"
);

fs.writeFileSync(
  path.join(__dirname, "feature-flags.json"),
  JSON.stringify(featureFlags, null, 2),
  "utf8"
);

console.log(`Categories: ${convertedCategories.length}`);
console.log(`Events:     ${convertedEvents.length}`);
console.log(`Feature flags: ${Object.keys(featureFlags).length}`);
console.log("Conversion completed!");
