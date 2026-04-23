import fs from "fs";

// Read the source file
const sourceData = JSON.parse(
  fs.readFileSync("unmodified-customer-service-data.json", "utf8")
);

// Convert the data structure
const converted = {};

// Helper function to normalize category key
const normalizeCategoryKey = (key) => {
  if (key === "1C") {
    return "one_s";
  }
  return key;
};

for (const [categoryKey, category] of Object.entries(sourceData)) {
  const normalizedKey = normalizeCategoryKey(categoryKey);
  converted[normalizedKey] = {
    ru: {
      name: category.name?.ru || "",
      locale: "ru",
      description: category.description?.ru || "",
      items: [],
    },
    en: {
      name: category.name?.en || "",
      locale: "en",
      description: category.description?.en || "",
      items: [],
    },
  };

  // Process items
  if (category.items && Array.isArray(category.items)) {
    // Helper functions
    const convertExamples = (examples) => {
      if (!examples) return "";
      if (Array.isArray(examples)) {
        return examples.join("\n");
      }
      if (typeof examples === "string") {
        return examples;
      }
      return "";
    };

    const convertButtons = (buttonOrButtons, locale) => {
      if (!buttonOrButtons) return [];
      const buttons = Array.isArray(buttonOrButtons)
        ? buttonOrButtons
        : [buttonOrButtons];
      // Add __component to each button and process text field
      return buttons.map((button) => {
        const processedButton = {
          __component: "customer-service.button",
          ...button,
        };

        // Handle text field - if it's an object with ru/en, extract the correct locale
        if (processedButton.text && typeof processedButton.text === "object") {
          if (locale === "ru" && processedButton.text.ru) {
            processedButton.text = processedButton.text.ru;
          } else if (locale === "en" && processedButton.text.en) {
            processedButton.text = processedButton.text.en;
          } else {
            // Fallback: use the first available value
            processedButton.text =
              processedButton.text.ru || processedButton.text.en || "";
          }
        }

        // Convert button type: "network-access" -> "network_access"
        if (processedButton.type === "network-access") {
          processedButton.type = "network_access";
        }

        return processedButton;
      });
    };

    // Map to track items by serviceId (id) to merge duplicates
    const itemsMap = new Map();

    for (const item of category.items) {
      // Get serviceId from id field, and taskId as separate field
      const serviceId = item.id || null;
      const taskId = item.taskId || null;

      // If serviceId is null, treat each item as separate (no merging)
      if (serviceId === null) {
        // Create RU item
        const ruItem = {
          taskId: taskId,
          featureFlag: item.showFeat || null,
          name: item.name?.ru || "",
          description: item.description?.ru || "",
          examples: convertExamples(item.examples?.ru),
          locale: "ru",
          buttons: convertButtons(item.button || item.buttons, "ru"),
        };

        // Remove null fields
        if (ruItem.taskId === null) delete ruItem.taskId;
        if (ruItem.featureFlag === null) delete ruItem.featureFlag;

        // Create EN item
        const enItem = {
          taskId: taskId,
          featureFlag: item.showFeat || null,
          name: item.name?.en || "",
          description: item.description?.en || "",
          examples: convertExamples(item.examples?.en),
          locale: "en",
          buttons: convertButtons(item.button || item.buttons, "en"),
        };

        // Remove null fields
        if (enItem.taskId === null) delete enItem.taskId;
        if (enItem.featureFlag === null) delete enItem.featureFlag;

        converted[normalizedKey].ru.items.push(ruItem);
        converted[normalizedKey].en.items.push(enItem);
        continue;
      }

      // Check if item with this serviceId already exists
      if (itemsMap.has(serviceId)) {
        // Merge buttons from this item into existing item
        const existing = itemsMap.get(serviceId);

        // Get featureFlag from duplicate item's showFeat
        const duplicateFeatureFlag = item.showFeat || null;

        // Add buttons from current item to existing item, with featureFlag from duplicate
        const ruButtons = convertButtons(item.button || item.buttons, "ru");
        const enButtons = convertButtons(item.button || item.buttons, "en");

        // Add featureFlag to each button from duplicate if it exists
        if (duplicateFeatureFlag) {
          ruButtons.forEach((button) => {
            if (!button.featureFlag) {
              button.featureFlag = duplicateFeatureFlag;
            }
          });
          enButtons.forEach((button) => {
            if (!button.featureFlag) {
              button.featureFlag = duplicateFeatureFlag;
            }
          });
        }

        existing.ruItem.buttons.push(...ruButtons);
        existing.enItem.buttons.push(...enButtons);
      } else {
        // Create new item
        const ruItem = {
          serviceId: serviceId,
          taskId: taskId,
          featureFlag: item.showFeat || null,
          name: item.name?.ru || "",
          description: item.description?.ru || "",
          examples: convertExamples(item.examples?.ru),
          locale: "ru",
          buttons: convertButtons(item.button || item.buttons, "ru"),
        };

        // Remove null fields
        if (ruItem.taskId === null) delete ruItem.taskId;
        if (ruItem.featureFlag === null) delete ruItem.featureFlag;

        const enItem = {
          serviceId: serviceId,
          taskId: taskId,
          featureFlag: item.showFeat || null,
          name: item.name?.en || "",
          description: item.description?.en || "",
          examples: convertExamples(item.examples?.en),
          locale: "en",
          buttons: convertButtons(item.button || item.buttons, "en"),
        };

        // Remove null fields
        if (enItem.taskId === null) delete enItem.taskId;
        if (enItem.featureFlag === null) delete enItem.featureFlag;

        // Store in map for potential merging
        itemsMap.set(serviceId, { ruItem, enItem });
      }
    }

    // Add all unique items from map to converted data
    for (const { ruItem, enItem } of itemsMap.values()) {
      converted[normalizedKey].ru.items.push(ruItem);
      converted[normalizedKey].en.items.push(enItem);
    }
  }
}

// Write the converted data
fs.writeFileSync(
  "converted-customer-service-data.json",
  JSON.stringify(converted, null, 2),
  "utf8"
);

console.log(
  "Conversion complete! Output written to converted-customer-service-data.json"
);
