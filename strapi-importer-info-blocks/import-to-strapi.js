// File: import-to-strapi.js

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Configuration
const STRAPI_URL = process.env.STRAPI_URL;
const TOKEN = process.env.STRAPI_TOKEN;

if (!STRAPI_URL || !TOKEN) {
    console.error('Missing required env vars. Set STRAPI_URL and STRAPI_TOKEN in .env (see .env.example).');
    process.exit(1);
}

const INFO_BLOCKS_ENDPOINT = '/api/info-blocks';
const BLOCK_CODES_ENDPOINT = '/api/info-block-codes';
const FEATURE_FLAGS_ENDPOINT = '/api/feature-flags';
const INPUT_FILE = './data.json';


// Mappings from document
const validatorLegalEntity = {
    371: "fluyt_studio",
    393: "remote_europe",
    411: "boolat_play",
    412: "4friends",
    413: "forestwest",
    414: "hit_games_company",
    415: "home_games",
    416: "mgl_games",
    419: "playrix_armenia",
    420: "brig_studio",
    421: "playrix_dmr",
    422: "playrix_dmu",
    423: "playrix",
    424: "playrix_rs",
    425: "plr_worldwide_sales",
    426: "redbark",
    427: "rimute_holdings",
    428: "voki_games_ukraine",
    429: "zagrava_studios",
    430: "outsource_hays",
    431: "outsorce_ventura",
    433: "voki_cyprus",
    434: "playrix_cyprus",
    435: "playrix_kazakhstan",
    437: "marte_galante",
    439: "levante_assets",
    440: "playrix_montenegro",
    441: "game_ocean_am",
    442: "game_ocean_rs",
    443: "playrix_holdings",
    444: "tsagu",
    445: "baygroup",
    448: "oysters",
    479: "playrix_georgia",
    512: "playos",
    545: "deel",
    546: "native_teams"
};

const validatorLegalContractTypes = {
    "Трудовой договор": 'employment_contract',
    "ГПХ": 'GPC',
};

const validatorStudioIds = {
    1: "playrix",
    2: "zefir_games",
    5: "playrix_rs",
    6: "perfect_play",
    7: "playrix_armenia",
    8: "zagrava",
    9: "game_ocean",
    10: "voki",
    11: "4friends",
    12: "bear_games",
    13: "mariaglorum",
    14: "playrix_hr",
    15: "home_games",
    17: "boolat_play",
    18: "daily_magic",
    20: "red_bark"
};

// Generate feature flag from validator
function generateFeatureFlag(blockCode, validator) {
    // Universal (validator === 1) - no feature flag needed
    if (validator === 1 || validator === undefined) {
        return null;
    }

    if (validator === 0) {
        return `${blockCode}__disabled`;
    }

    // Complex validator object
    if (typeof validator === 'object' && validator !== null) {
        const parts = [];

        // Process each field in validator
        Object.entries(validator).forEach(([field, values]) => {
            const isNegation = field.startsWith('!');
            const cleanField = isNegation ? field.substring(1) : field;

            if (cleanField === 'legal_entity.id' && Array.isArray(values)) {
                const entities = values.map(id => validatorLegalEntity[id] || `entity_${id}`).join('_or_');
                parts.push(`legal_entity-${isNegation ? 'not_' : ''}${entities}`);
            } else if (cleanField === 'studio.id' && Array.isArray(values)) {
                const studios = values.map(id => validatorStudioIds[id] || `studio_${id}`).join('_or_');
                parts.push(`studio-${isNegation ? 'not_' : ''}${studios}`);
            } else if (cleanField === 'contract_type' && Array.isArray(values)) {
                const types = values.map(type => validatorLegalContractTypes[type] || type).join('_or_');
                parts.push(`contract_type-${isNegation ? 'not_' : ''}${types}`);
            }
        });

        return parts.length > 0 ? `${blockCode}__${parts.join('_and_')}` : blockCode;
    }

    return blockCode;
}

// Generate human-readable title from validator
function generateTitleFromValidator(blockCode, validator, locale = 'ru') {
    // Universal
    if (validator === 1 || validator === undefined) {
        return blockCode;
    }

    if (validator === 0) {
        return `${blockCode} (disabled)`;
    }

    // Complex validator object
    if (typeof validator === 'object' && validator !== null) {
        const parts = [];

        Object.entries(validator).forEach(([field, values]) => {
            const isNegation = field.startsWith('!');
            const cleanField = isNegation ? field.substring(1) : field;

            if (cleanField === 'legal_entity.id' && Array.isArray(values)) {
                const entities = values.map(id => validatorLegalEntity[id] || `entity_${id}`).join(', ');
                const prefix = locale === 'ru' ? (isNegation ? 'кроме' : 'для') : (isNegation ? 'except' : 'for');
                parts.push(`${prefix} ${entities}`);
            } else if (cleanField === 'studio.id' && Array.isArray(values)) {
                const studios = values.map(id => validatorStudioIds[id] || `studio_${id}`).join(', ');
                const prefix = locale === 'ru' ? (isNegation ? 'кроме студии' : 'для студии') : (isNegation ? 'except studio' : 'for studio');
                parts.push(`${prefix} ${studios}`);
            } else if (cleanField === 'contract_type' && Array.isArray(values)) {
                const types = values.map(type => type).join(', ');
                const prefix = locale === 'ru' ? (isNegation ? 'кроме типа контракта' : 'для типа контракта') : (isNegation ? 'except contract type' : 'for contract type');
                parts.push(`${prefix} ${types}`);
            }
        });

        const separator = locale === 'ru' ? ' и ' : ' and ';
        return parts.length > 0 ? `${blockCode} (${parts.join(separator)})` : blockCode;
    }

    return blockCode;
}

// Helper function to convert blocks to markdown
function blocksToMarkdown(blocks, lang = 'ru') {
    if (!blocks || !Array.isArray(blocks)) return '';

    let markdown = '';

    blocks.forEach((block, index) => {
        switch (block.type) {
            case 'span':
            case 'div':
                let text = block.text?.[lang] || block.text?.ru || block.text?.en || '';
                // Add space before em dash if it starts with it
                // if (text.startsWith('—')) {
                //     text = ' ' + text;
                // }
                markdown += text;
                break;

            case 'strong':
            case 'b':
                let strongText = block.text?.[lang] || block.text?.ru || block.text?.en || '';
                // Add space before em dash if it starts with it
                if (strongText.startsWith('—')) {
                    markdown += ' '
                }
                markdown += `**${strongText}**`;

                // Добавляем пробел после жирного текста, если это не конец блоков
                // и следующий блок не начинается с пунктуации или пробела
                const nextBlock = blocks[index + 1];
                if (nextBlock && nextBlock.type !== 'br') {
                    markdown += ' ';
                }
                break;

            case 'a':
                // Add space before link if markdown doesn't end with space
                if (markdown.length > 0 && !markdown.endsWith(' ') && !markdown.endsWith('\n')) {
                    markdown += ' ';
                }
                const linkText = block.text?.[lang] || block.text?.ru || block.text?.en || 'Link';
                markdown += `[${linkText}](${block.url})`;
                break;

            case 'br':
                markdown += '\n\n';
                break;

            case 'binding-list':
            case 'ordered-list':
                if (block.blocks && Array.isArray(block.blocks)) {
                    // Add newline before list if there's content before
                    if (markdown.length > 0 && !markdown.endsWith('\n\n')) {
                        markdown += '\n\n';
                    }

                    block.blocks.forEach((item, listIndex) => {
                        const prefix = block.type === 'ordered-list' ? `${listIndex + 1}. ` : '- ';
                        markdown += prefix + blocksToMarkdown([item], lang).trim() + '\n';
                    });

                    // Add newline after list if there are more blocks after
                    if (index < blocks.length - 1) {
                        markdown += '\n';
                    }
                }
                break;

            default:
                // Handle nested blocks
                if (block.blocks && Array.isArray(block.blocks)) {
                    markdown += blocksToMarkdown(block.blocks, lang);
                }
        }
    });

    return markdown.trim();
}

// Translate section names to Russian for description
function getSectionDescription(section) {
    const translations = {
        'alert': 'Алерты',
        'field': 'Поля',
        'hint': 'Подсказки',
        'info': 'Информация'
    };
    return translations[section] || section;
}

// Check if title exists in Strapi
async function checkTitleExists(endpoint, title, locale, usedTitlesCache) {
    // For block codes (no locale)
    if (locale === null) {
        const cacheKey = title;
        if (usedTitlesCache.has(cacheKey)) {
            return true;
        }

        try {
            const searchUrl = `${STRAPI_URL}${endpoint}?filters[title][$eq]=${encodeURIComponent(title)}`;
            const response = await fetch(searchUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (response.ok) {
                const result = await response.json();
                return result.data && result.data.length > 0;
            }
            return false;
        } catch (error) {
            console.error('Error checking title existence:', error);
            return false;
        }
    }

    // For info blocks (with locale)
    const cacheKey = `${title}__${locale}`;
    if (usedTitlesCache.has(cacheKey)) {
        return true;
    }

    try {
        const searchUrl = `${STRAPI_URL}${endpoint}?filters[title][$eq]=${encodeURIComponent(title)}&locale=${locale}`;
        const response = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (response.ok) {
            const result = await response.json();
            return result.data && result.data.length > 0;
        }
        return false;
    } catch (error) {
        console.error('Error checking title existence:', error);
        return false;
    }
}

// Generate unique title by appending suffix if needed
async function generateUniqueTitle(endpoint, baseTitle, code, locale, usedTitlesCache) {
    let title = baseTitle;
    let counter = 1;

    // Always check if title exists before using it (with locale)
    while (await checkTitleExists(endpoint, title, locale, usedTitlesCache)) {
        title = `${baseTitle} (${counter})`;
        counter++;

        // Safety limit
        if (counter > 100) {
            console.warn(`Warning: Could not generate unique title for ${code}, using timestamp`);
            title = `${baseTitle} (${Date.now()})`;
            break;
        }
    }

    // Add to cache with locale
    const cacheKey = locale === null ? title : `${title}__${locale}`;
    usedTitlesCache.add(cacheKey);

    if (locale) {
        console.log(`  Generated unique title (${locale}): "${title}"`);
    } else {
        console.log(`  Generated unique title: "${title}"`);
    }

    return title;
}

// Fetch all feature flags from Strapi with pagination, return Map<code, id>
async function fetchAllFeatureFlags() {
    const flagsByCode = new Map();
    const pageSize = 100;
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount) {
        const url = `${STRAPI_URL}${FEATURE_FLAGS_ENDPOINT}?fields[0]=code&pagination[page]=${page}&pagination[pageSize]=${pageSize}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch feature flags: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        const items = result.data || [];

        for (const item of items) {
            // Support Strapi v4 (attributes.code) and v5 (flat code) response shapes
            const code = item.attributes?.code ?? item.code;
            if (code) {
                flagsByCode.set(code, item.id);
            }
        }

        pageCount = result.meta?.pagination?.pageCount ?? 1;
        page += 1;
    }

    console.log(`✓ Loaded ${flagsByCode.size} feature flags from Strapi`);
    return flagsByCode;
}

// Map from data.json validator keys → UI attribute names used by the conditions plugin
// (see src/plugins/feature-flag-conditions/admin/src/utils/serialize.js — JSON_KEY_BY_ATTRIBUTE)
const ATTRIBUTE_BY_JSON_KEY = {
    'legal_entity.id': 'legal_entity',
    'studio.id': 'studio',
    'contract_type': 'contract_type',
};

// Convert a validator from data.json into the conditions JSON the plugin stores in the DB
function buildConditionsFromValidator(validator) {
    if (validator === 1 || validator === undefined) {
        return { availability: 'all', branches: [] };
    }
    if (validator === 0) {
        return { availability: 'none', branches: [] };
    }
    if (typeof validator === 'object' && validator !== null) {
        const rows = [];
        for (const [field, values] of Object.entries(validator)) {
            const isNegation = field.startsWith('!');
            const cleanField = isNegation ? field.substring(1) : field;
            const attribute = ATTRIBUTE_BY_JSON_KEY[cleanField];
            if (!attribute || !Array.isArray(values)) continue;
            rows.push({
                kind: 'predicate',
                attribute,
                negate: isNegation,
                values,
            });
        }
        if (rows.length === 0) {
            return { availability: 'all', branches: [] };
        }
        return { availability: 'conditional', branches: [{ rows }] };
    }
    return { availability: 'all', branches: [] };
}

// POST a new feature flag to Strapi, return created id
async function createFeatureFlag({ code, title, validator }) {
    const url = `${STRAPI_URL}${FEATURE_FLAGS_ENDPOINT}`;
    const body = {
        data: {
            code,
            title,
            conditions: buildConditionsFromValidator(validator),
        },
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create feature flag "${code}": ${response.status} - ${errorText}`);
    }
    const result = await response.json();
    return result.data.id;
}

// Resolve code → id from cache, create it in Strapi if missing
async function getOrCreateFeatureFlagId({ code, title, validator }, cache, createdCodes) {
    if (!code) return null;
    const existing = cache.get(code);
    if (existing) return existing;
    try {
        const id = await createFeatureFlag({ code, title, validator });
        cache.set(code, id);
        createdCodes.add(code);
        console.log(`  ✓ Created feature flag: "${code}" (ID: ${id})`);
        return id;
    } catch (err) {
        console.error(`  ✗ ${err.message}`);
        return null;
    }
}

// Create or get block code
async function getOrCreateBlockCode(title, section, usedTitlesCache) {
    try {
        // Block codes don't have locale, so pass null
        const uniqueTitle = await generateUniqueTitle(BLOCK_CODES_ENDPOINT, title, title, null, usedTitlesCache);

        // Search with the unique title
        const searchUrl = `${STRAPI_URL}${BLOCK_CODES_ENDPOINT}?filters[title][$eq]=${encodeURIComponent(uniqueTitle)}`;
        console.log(`  Searching block code: "${uniqueTitle.substring(0, 60)}..."`);

        const searchResponse = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        console.log(`  Search response status: ${searchResponse.status}`);

        if (searchResponse.ok) {
            const searchResult = await searchResponse.json();
            if (searchResult.data && searchResult.data.length > 0) {
                console.log(`✓ Found existing block code: "${uniqueTitle.substring(0, 60)}..." (ID: ${searchResult.data[0].id})`);
                return searchResult.data[0].id;
            }
            console.log(`  Block code not found, will create new one`);
        } else {
            const errorText = await searchResponse.text();
            console.error(`  Search failed: ${searchResponse.status} - ${errorText}`);
        }

        // Create new block code with unique title
        const description = `${getSectionDescription(section)} - ${title}`;
        const createUrl = `${STRAPI_URL}${BLOCK_CODES_ENDPOINT}`;
        console.log(`  Creating block code with title: "${uniqueTitle.substring(0, 60)}..."`);

        const response = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            },
            body: JSON.stringify({
                data: {
                    title: uniqueTitle,
                    description: description
                }
            })
        });

        console.log(`  Create response status: ${response.status}`);

        if (!response.ok) {
            const error = await response.text();
            console.error(`  Create error body: ${error}`);
            throw new Error(`HTTP error! status: ${response.status}, body: ${error}`);
        }

        const result = await response.json();
        console.log(`✓ Created block code: "${uniqueTitle.substring(0, 60)}..." (ID: ${result.data.id})`);
        return result.data.id;
    } catch (error) {
        console.error('Error with block code:', error);
        throw error;
    }
}

// Create entity data for Strapi
function createInfoBlockData(key, item, blockCodeId, uniqueTitleRu, uniqueTitleEn, featureFlagId) {
    // Validate blockCodeId
    if (!blockCodeId) {
        throw new Error(`Missing blockCodeId for key: ${key}`);
    }

    // Convert title and blocks to markdown
    let contentRu = '';
    let contentEn = '';

    // Title as plain text (not h3)
    if (item.title && Array.isArray(item.title)) {
        const titleTextRu = blocksToMarkdown(item.title, 'ru').trim();
        const titleTextEn = blocksToMarkdown(item.title, 'en').trim();

        if (titleTextRu) {
            contentRu += `${titleTextRu}\n\n`;
        }
        if (titleTextEn) {
            contentEn += `${titleTextEn}\n\n`;
        }
    }

    if (item.blocks && Array.isArray(item.blocks)) {
        contentRu += blocksToMarkdown(item.blocks, 'ru');
        contentEn += blocksToMarkdown(item.blocks, 'en');
    }

    return {
        ru: {
            locale: 'ru',
            data: {
                title: uniqueTitleRu,
                content: contentRu.trim(),
                typeAlert: item.typeAlert || 'gradient',
                withIcon: item.withIcon || true,
                featureFlag: featureFlagId,
                blockCode: blockCodeId
            }
        },
        en: {
            locale: 'en',
            data: {
                title: uniqueTitleEn,
                content: contentEn.trim(),
                typeAlert: item.typeAlert || 'gradient',
                withIcon: item.withIcon || true,
                featureFlag: featureFlagId,
                blockCode: blockCodeId
            }
        }
    };
}

// Post entity to Strapi
async function postToStrapi(entityDataWithLocale) {
    try {
        const { locale, data } = entityDataWithLocale;
        const url = `${STRAPI_URL}${INFO_BLOCKS_ENDPOINT}?locale=${locale}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            },
            body: JSON.stringify({ data })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, body: ${error}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Error posting to Strapi:', error);
        throw error;
    }
}

// Main import function
async function importToStrapi() {
    try {
        // Read input JSON file
        const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
        const data = JSON.parse(rawData);

        // Load all existing feature flags so we can attach them as relations by code.
        // Missing ones will be created on-demand in getOrCreateFeatureFlagId.
        const featureFlagsCache = await fetchAllFeatureFlags();
        const createdFeatureFlags = new Set();

        let successCount = 0;
        let errorCount = 0;
        const blockCodeCache = {}; // Cache to avoid duplicate block code lookups
        const usedTitlesCache = new Set(); // Cache to track titles used in current session

        // Process all sections
        for (const section of ['alert', 'field', 'hint', 'info']) {
            if (data[section]) {
                console.log(`\n--- Processing section: ${section} ---`);

                for (const [key, items] of Object.entries(data[section])) {
                    if (Array.isArray(items)) {
                        // Get or create block code
                        if (!blockCodeCache[key]) {
                            blockCodeCache[key] = await getOrCreateBlockCode(key, section, usedTitlesCache);
                            // Small delay after creating/getting block code
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }

                        const blockCodeId = blockCodeCache[key];

                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];

                            // Generate feature flag and titles based on validator
                            const featureFlagCode = generateFeatureFlag(key, item.validator);
                            const titleRu = generateTitleFromValidator(key, item.validator, 'ru');
                            const titleEn = generateTitleFromValidator(key, item.validator, 'en');
                            const featureFlagId = await getOrCreateFeatureFlagId(
                                { code: featureFlagCode, title: titleRu, validator: item.validator },
                                featureFlagsCache,
                                createdFeatureFlags
                            );

                            console.log(`\n  Processing block ${i + 1}/${items.length} for key: ${key}`);
                            console.log(`    Validator:`, JSON.stringify(item.validator));
                            console.log(`    Feature Flag: ${featureFlagCode || 'null (universal)'}${featureFlagCode ? ` → id ${featureFlagId ?? 'failed'}` : ''}`);
                            console.log(`    Title RU: ${titleRu}`);
                            console.log(`    Title EN: ${titleEn}`);

                            // Generate unique titles (in case of duplicates in DB)
                            const uniqueTitleRu = await generateUniqueTitle(INFO_BLOCKS_ENDPOINT, titleRu, key, 'ru', usedTitlesCache);
                            const uniqueTitleEn = await generateUniqueTitle(INFO_BLOCKS_ENDPOINT, titleEn, key, 'en', usedTitlesCache);

                            // Ensure blockCodeId exists
                            if (!blockCodeId) {
                                throw new Error(`No blockCodeId found for key: ${key}`);
                            }

                            // Create entity data with unique titles
                            const entityData = createInfoBlockData(key, item, blockCodeId, uniqueTitleRu, uniqueTitleEn, featureFlagId);

                            // Create RU version
                            console.log(`  → Creating RU version...`);
                            const ruResult = await postToStrapi(entityData.ru);
                            console.log(`✓ Created info block (RU): ${uniqueTitleRu}`);
                            successCount++;

                            // Small delay
                            await new Promise(resolve => setTimeout(resolve, 100));

                            // Create EN version
                            console.log(`  → Creating EN version...`);
                            const enResult = await postToStrapi(entityData.en);
                            console.log(`✓ Created info block (EN): ${uniqueTitleEn}`);
                            successCount++;

                            // Small delay to avoid overwhelming the server
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                }
            }
        }

        console.log('\n--- Import Summary ---');
        console.log(`Total successful: ${successCount}`);
        console.log(`Total failed: ${errorCount}`);
        console.log(`Block codes created/used: ${Object.keys(blockCodeCache).length}`);
        console.log(`Feature flags in cache: ${featureFlagsCache.size}`);
        if (createdFeatureFlags.size > 0) {
            console.log(`Feature flags created (${createdFeatureFlags.size}):`);
            for (const code of createdFeatureFlags) {
                console.log(`  + ${code}`);
            }
        }

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run the import
if (require.main === module) {
    importToStrapi();
}

module.exports = { importToStrapi, createFeatureFlags, blocksToMarkdown };