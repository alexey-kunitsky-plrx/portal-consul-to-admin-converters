import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Checks if an object is a dual-language object (has both 'ru' and 'en' keys)
 */
function isDualLanguageObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }
  const keys = Object.keys(obj);
  return keys.length === 2 && keys.includes("ru") && keys.includes("en");
}

// Validators harvested from object-shaped feat/strongFeat. Mirrors what
// admin-events-converter does: convert.js synthesizes a stable code per
// validator, publish.js reads this map and creates the flag with proper
// conditions via shared/feature-flags.js#buildConditionsFromValidator.
const validatorsByCode = {};

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(stableStringify).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
      .join(",") +
    "}"
  );
}

function hashValidator(validator) {
  const s = stableStringify(validator);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function slugifyContext(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function registerValidator(context, validator) {
  const slug = slugifyContext(context) || "feat";
  const hash = hashValidator(validator);
  const code = `compensation__${slug}_${hash}`;
  validatorsByCode[code] = validator;
  return code;
}

/**
 * Converts feat/strongFeat to featureFlag. Strings pass through;
 * object validators get a synthetic code and their conditions are
 * stashed in validatorsByCode for publish.js to materialize.
 */
function convertFeatureFlag(obj, context = "") {
  const result = { ...obj };

  if (result.feat !== undefined) {
    if (typeof result.feat === "object" && result.feat !== null) {
      result.featureFlag = registerValidator(context, result.feat);
      delete result.feat;
    } else if (typeof result.feat === "string") {
      result.featureFlag = result.feat;
      delete result.feat;
    }
  }

  if (result.strongFeat !== undefined) {
    if (typeof result.strongFeat === "object" && result.strongFeat !== null) {
      result.featureFlag = registerValidator(context, result.strongFeat);
      delete result.strongFeat;
    } else if (typeof result.strongFeat === "string") {
      // If featureFlag already exists, prefer strongFeat (it's "stronger")
      result.featureFlag = result.strongFeat;
      delete result.strongFeat;
    }
  }

  return result;
}

/**
 * Converts dual-language name to ruText and enText
 */
function convertNameToText(obj) {
  const result = { ...obj };

  if (result.name && isDualLanguageObject(result.name)) {
    result.ruText = result.name.ru || "";
    result.enText = result.name.en || "";
    delete result.name;
  }

  return result;
}

/**
 * Processes a button/link item
 */
function processButtonOrLink(item) {
  // Convert name to ruText/enText if present
  let processed = convertNameToText(item);

  // Convert feat/strongFeat to featureFlag
  processed = convertFeatureFlag(
    processed,
    `button/link with type: ${processed.type}`
  );

  // Handle nested feat in param array (for vacation/absence types)
  if (processed.param && Array.isArray(processed.param)) {
    processed.param = processed.param.map((paramItem) => {
      return convertFeatureFlag(
        paramItem,
        `button param: ${paramItem.name || "unnamed"}`
      );
    });
  } else if (
    processed.param &&
    typeof processed.param === "object" &&
    processed.param !== null
  ) {
    // Warn if param is an object (not array, not string)
    console.warn(
      `⚠️  Warning: param is an object (needs manual fix): ${JSON.stringify(
        processed.param
      )} at button/link with type: ${processed.type}`
    );
  }

  // Buttons should be the same for both languages, keeping both ruText and enText
  return processed;
}

/**
 * Processes buttons array - separates links from actions
 */
function processButtons(buttons) {
  const links = [];
  const actions = [];

  if (!Array.isArray(buttons)) {
    return { links, actions };
  }

  for (const button of buttons) {
    const processed = processButtonOrLink(button);

    // Check if both ruText and enText are present and not empty
    const hasOverridedText =
      processed.ruText &&
      processed.enText &&
      processed.ruText.trim() !== "" &&
      processed.enText.trim() !== "";

    if (processed.type === "link") {
      // Links go to links array
      links.push({
        __component: "benefits.link",
        url: processed.url,
        ...(processed.featureFlag && { featureFlag: processed.featureFlag }),
        ...(processed.ruText && { ruText: processed.ruText }),
        ...(processed.enText && { enText: processed.enText }),
        ...(hasOverridedText && { hasOverridedText: true }),
      });
    } else if (Array.isArray(processed.param) && processed.param.length > 0) {
      // Multi-param button (e.g. vacation with several subtypes): Strapi's
      // benefits.button.param is a string, so explode into one action per
      // param item, carrying its own featureFlag.
      for (const paramItem of processed.param) {
        const featureFlag = paramItem.featureFlag || processed.featureFlag;
        actions.push({
          __component: "benefits.button",
          type: processed.type,
          ...(processed.url && { url: processed.url }),
          ...(paramItem.name && { param: paramItem.name }),
          ...(featureFlag && { featureFlag }),
          ...(processed.ruText && { ruText: processed.ruText }),
          ...(processed.enText && { enText: processed.enText }),
          ...(hasOverridedText && { hasOverridedText: true }),
        });
      }
    } else {
      // Single-param or no-param action
      const action = {
        __component: "benefits.button",
        type: processed.type,
        ...(processed.url && { url: processed.url }),
        ...(typeof processed.param === "string" && { param: processed.param }),
        ...(processed.featureFlag && { featureFlag: processed.featureFlag }),
        ...(processed.ruText && { ruText: processed.ruText }),
        ...(processed.enText && { enText: processed.enText }),
        ...(hasOverridedText && { hasOverridedText: true }),
      };
      actions.push(action);
    }
  }

  return { links, actions };
}

/**
 * Processes promoCode extension
 */
function processPromoCodes(extension) {
  const actions = [];

  if (
    !extension ||
    extension.type !== "promoCode" ||
    !extension.params ||
    !extension.params.items
  ) {
    return actions;
  }

  for (const promoCode of extension.params.items) {
    // Convert feat to featureFlag (promoCodes can have object feat, log it)
    const processed = convertFeatureFlag(
      promoCode,
      `promoCode: ${promoCode.name || "unnamed"}`
    );

    // PromoCodes have name as string, not dual-language, so we keep it
    actions.push({
      __component: "benefits.promo-code",
      name: processed.name,
      url: processed.url,
      value: processed.value,
      ...(processed.featureFlag && { featureFlag: processed.featureFlag }),
    });
  }

  return actions;
}

/**
 * Processes buttons/links/promoCodes and stores them separately
 * Returns { processedData, buttonsData } where buttonsData contains links and actions
 */
function processButtonsAndPromoCodes(value, path = "") {
  const buttonsData = { links: [], actions: [] };
  const processedValue = { ...value };

  // Handle buttons array
  if (value.buttons && Array.isArray(value.buttons)) {
    const { links, actions } = processButtons(value.buttons);
    buttonsData.links = links;
    buttonsData.actions = actions;
    delete processedValue.buttons;
  }

  // Handle extension (promoCodes)
  if (value.extension) {
    const promoCodeActions = processPromoCodes(value.extension);
    buttonsData.actions.push(...promoCodeActions);
    delete processedValue.extension;
  }

  return { processedValue, buttonsData };
}

/**
 * Recursively processes an object/value to extract the specified language variant
 * and transform buttons/links/promoCodes
 */
function extractLanguageVariant(value, lang, path = "", buttonsCache = null) {
  // If it's a dual-language object, extract the value for the specified language
  if (isDualLanguageObject(value)) {
    return value[lang] || "";
  }

  // If it's an array, process each element
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      extractLanguageVariant(item, lang, `${path}[${index}]`, buttonsCache)
    );
  }

  // If it's an object, process each property recursively
  if (value && typeof value === "object") {
    // Process buttons/links/promoCodes first
    const { processedValue, buttonsData } = processButtonsAndPromoCodes(
      value,
      path
    );
    const result = {};

    // Store buttons data if any
    if (buttonsData.links.length > 0 || buttonsData.actions.length > 0) {
      if (buttonsCache) {
        buttonsCache[path] = buttonsData;
      }
      if (buttonsData.links.length > 0) {
        result.links = buttonsData.links;
      }
      if (buttonsData.actions.length > 0) {
        result.actions = buttonsData.actions;
      }
    }

    // Process other properties
    for (const [key, val] of Object.entries(processedValue)) {
      // Recursively process nested objects
      if (
        val &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        !isDualLanguageObject(val)
      ) {
        // Convert feat/strongFeat in nested objects
        const processed = convertFeatureFlag(val, `${path}.${key}`);
        result[key] = extractLanguageVariant(
          processed,
          lang,
          `${path}.${key}`,
          buttonsCache
        );
      } else {
        result[key] = extractLanguageVariant(
          val,
          lang,
          `${path}.${key}`,
          buttonsCache
        );
      }
    }

    // Convert feat/strongFeat at the current level
    const finalResult = convertFeatureFlag(result, path);

    return finalResult;
  }

  // Otherwise, return the value as-is
  return value;
}

/**
 * Recursively copies buttons/links/actions from source to target
 */
function copyButtonsData(source, target) {
  if (source.actions) {
    target.actions = source.actions;
  }
  if (source.links) {
    target.links = source.links;
  }

  // Recursively process items array if present
  if (
    source.items &&
    Array.isArray(source.items) &&
    target.items &&
    Array.isArray(target.items)
  ) {
    for (let i = 0; i < source.items.length && i < target.items.length; i++) {
      copyButtonsData(source.items[i], target.items[i]);
    }
  }
}

/**
 * Recursively adds locale to items
 */
function addLocaleToItems(items, locale) {
  if (!Array.isArray(items)) {
    return;
  }
  for (const item of items) {
    item.locale = locale;
    // Recursively process nested items if any
    if (item.items && Array.isArray(item.items)) {
      addLocaleToItems(item.items, locale);
    }
  }
}

/**
 * Converts compensation data into language-separated structure
 */
function convertData(inputData) {
  const ruData = {};
  const enData = {};

  // Process each category
  for (const [categoryKey, categoryValue] of Object.entries(inputData)) {
    // Process buttons once and store them
    const buttonsCache = {};
    const ruCategory = extractLanguageVariant(
      categoryValue,
      "ru",
      categoryKey,
      buttonsCache
    );
    const enCategory = extractLanguageVariant(
      categoryValue,
      "en",
      categoryKey,
      buttonsCache
    );

    // Buttons should be the same for both languages (copy from ru to en)
    copyButtonsData(ruCategory, enCategory);

    // Add locale and section_code to categories
    ruCategory.locale = "ru";
    ruCategory.section_code = categoryKey;
    enCategory.locale = "en";
    enCategory.section_code = categoryKey;

    // Add locale to items
    if (ruCategory.items && Array.isArray(ruCategory.items)) {
      addLocaleToItems(ruCategory.items, "ru");
    }
    if (enCategory.items && Array.isArray(enCategory.items)) {
      addLocaleToItems(enCategory.items, "en");
    }

    ruData[categoryKey] = ruCategory;
    enData[categoryKey] = enCategory;
  }

  return {
    ru: ruData,
    en: enData,
  };
}

/**
 * Main function
 */
function main() {
  const inputFile = path.join(__dirname, "compensation-data.json");
  const outputFile = path.join(__dirname, "compensation-data-converted.json");
  const validatorsFile = path.join(
    __dirname,
    "feature-flag-validators.json"
  );

  console.log("Reading input file...");
  const inputData = JSON.parse(fs.readFileSync(inputFile, "utf8"));

  console.log("Converting data...");
  const convertedData = convertData(inputData);

  console.log("Writing output file...");
  // Always overwrite the file if it exists
  fs.writeFileSync(outputFile, JSON.stringify(convertedData, null, 2), {
    encoding: "utf8",
    flag: "w", // Explicitly set write flag to overwrite
  });

  fs.writeFileSync(
    validatorsFile,
    JSON.stringify(validatorsByCode, null, 2),
    { encoding: "utf8", flag: "w" }
  );

  const validatorCount = Object.keys(validatorsByCode).length;
  console.log(`✅ Conversion complete! Output written to ${outputFile}`);
  console.log(
    `   Harvested ${validatorCount} object-shaped validator(s) → ${validatorsFile}`
  );
}

main();

export { convertData, extractLanguageVariant };
