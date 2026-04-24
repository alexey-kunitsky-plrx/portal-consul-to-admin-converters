// Shared helper for attaching feature-flag relations to Strapi records.
// Looks up existing flags by code and creates missing ones with a conditions
// JSON shaped for plugin::feature-flag-conditions.conditions.
//
// Used by:
//   admin-benefits-converter (publish.js, publish-customer-service.js)
//   admin-customer-service-converter (publish.js)
//   admin-events-converter (publish.js)
//
// Not used by strapi-importer-info-blocks — that one is CommonJS and keeps
// its own inline copy of this logic.

const FEATURE_FLAGS_ENDPOINT = "/api/feature-flags";

// Reverse of JSON_KEY_BY_ATTRIBUTE in
// src/plugins/feature-flag-conditions/admin/src/utils/serialize.js
const ATTRIBUTE_BY_JSON_KEY = {
  "legal_entity.id": "legal_entity",
  "studio.id": "studio",
  "contract_type": "contract_type",
  "cooperation_status.id": "cooperation_status",
  "city.country.id": "country",
  "work_format.id": "work_format",
  "project.id": "project",
  uid: "uid",
  participant_status: "participant_status",
  north_worker: "north_worker",
  is_manager: "is_manager",
};

export function buildConditionsFromValidator(validator) {
  if (validator === 1) return { availability: "all", branches: [] };
  if (validator === 0) return { availability: "none", branches: [] };
  // Unknown validator (benefits / customer-service) — placeholder that the
  // admin will fill in manually.
  if (validator === undefined || validator === null) {
    return { availability: "conditional", branches: [] };
  }
  if (typeof validator === "object") {
    const rows = [];
    for (const [field, values] of Object.entries(validator)) {
      const isNegation = field.startsWith("!");
      const cleanField = isNegation ? field.substring(1) : field;
      const attribute = ATTRIBUTE_BY_JSON_KEY[cleanField];
      if (!attribute || !Array.isArray(values)) continue;
      rows.push({ kind: "predicate", attribute, negate: isNegation, values });
    }
    if (rows.length === 0) {
      return { availability: "conditional", branches: [] };
    }
    return { availability: "conditional", branches: [{ rows }] };
  }
  return { availability: "conditional", branches: [] };
}

export async function fetchAllFeatureFlags({ baseUrl, token }) {
  const flagsByCode = new Map();
  const pageSize = 100;
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const url = `${baseUrl}${FEATURE_FLAGS_ENDPOINT}?fields[0]=code&pagination[page]=${page}&pagination[pageSize]=${pageSize}`;
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch feature flags: ${response.status} - ${await response.text()}`,
      );
    }
    const result = await response.json();
    for (const item of result.data || []) {
      const code = item.attributes?.code ?? item.code;
      if (code) flagsByCode.set(code, item.id);
    }
    pageCount = result.meta?.pagination?.pageCount ?? 1;
    page += 1;
  }

  console.log(`✓ Loaded ${flagsByCode.size} feature flags from Strapi`);
  return flagsByCode;
}

async function createFeatureFlag({ baseUrl, token, code, title, validator }) {
  const response = await fetch(`${baseUrl}${FEATURE_FLAGS_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      data: {
        code,
        title: title || code,
        conditions: buildConditionsFromValidator(validator),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to create feature flag "${code}": ${response.status} - ${await response.text()}`,
    );
  }
  const result = await response.json();
  return result.data.id;
}

export async function getOrCreateFeatureFlagId(
  { code, title, validator },
  { baseUrl, token, cache, createdCodes },
) {
  if (!code) return null;
  const existing = cache.get(code);
  if (existing) return existing;
  try {
    const id = await createFeatureFlag({
      baseUrl,
      token,
      code,
      title,
      validator,
    });
    cache.set(code, id);
    if (createdCodes) createdCodes.add(code);
    const note =
      validator === undefined || validator === null
        ? " (empty conditions — fill in manually in admin)"
        : "";
    console.log(`  ✓ Created feature flag: "${code}" (ID: ${id})${note}`);
    return id;
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    return null;
  }
}

// Walk `data` recursively and replace every string value under a `featureFlag`
// key with the resolved relation id. If resolution returns null, the key is
// removed entirely so the POST/PUT payload stays clean.
//
// Options:
//   autoCreate       — true (default) creates missing flags in Strapi; false
//                      leaves the relation empty and logs a warning, tracking
//                      the code in `missingCodes`. Use autoCreate only when
//                      you have proper validator data to build conditions.
//   validatorsByCode — map of { code: validator } that feeds conditions when
//                      auto-creating.
//   createdCodes     — Set collected for the summary (auto-create path).
//   missingCodes     — Set collected for the summary (resolve-only path).
export async function resolveFeatureFlagsDeep(
  data,
  {
    baseUrl,
    token,
    cache,
    createdCodes,
    missingCodes,
    validatorsByCode = {},
    autoCreate = true,
  },
) {
  if (Array.isArray(data)) {
    for (const item of data) {
      await resolveFeatureFlagsDeep(item, {
        baseUrl,
        token,
        cache,
        createdCodes,
        missingCodes,
        validatorsByCode,
        autoCreate,
      });
    }
    return;
  }
  if (!data || typeof data !== "object") return;

  for (const key of Object.keys(data)) {
    const value = data[key];
    if (key === "featureFlag" && typeof value === "string") {
      let id;
      if (autoCreate) {
        id = await getOrCreateFeatureFlagId(
          { code: value, title: value, validator: validatorsByCode[value] },
          { baseUrl, token, cache, createdCodes },
        );
      } else {
        id = cache.get(value);
        if (!id) {
          if (missingCodes && !missingCodes.has(value)) {
            console.warn(
              `  ⚠ Feature flag not found in Strapi: "${value}" — relation left empty`,
            );
            missingCodes.add(value);
          }
        }
      }
      if (id) {
        data[key] = id;
      } else {
        delete data[key];
      }
    } else if (value && typeof value === "object") {
      await resolveFeatureFlagsDeep(value, {
        baseUrl,
        token,
        cache,
        createdCodes,
        missingCodes,
        validatorsByCode,
        autoCreate,
      });
    }
  }
}
