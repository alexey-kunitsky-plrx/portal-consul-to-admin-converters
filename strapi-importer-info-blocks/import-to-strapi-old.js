// File: import-to-strapi.js

const fs = require('fs');
const path = require('path');

// Configuration
const STRAPI_URL = 'http://localhost:1337';
const API_ENDPOINT = '/api/info-blocks';
const INPUT_FILE = './data.json';
const OUTPUT_FEATURE_FLAGS = './featureFlags.json';

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
}
const validatorLegalContractTypes = {
    "Трудовой договор": 'employment_contract',
    "ГПХ": 'GPC',
}

const validatorStudioIds = [
    {
        "id": 11,
        "name": "4Friends",
        "i18n": {
            "ru": {
                "id": 11,
                "name": "4Friends"
            }
        }
    },
    {
        "id": 12,
        "name": "BearGames",
        "i18n": {
            "ru": {
                "id": 12,
                "name": "BearGames"
            }
        }
    },
    {
        "id": 17,
        "name": "BoolatPlay",
        "i18n": {
            "ru": {
                "id": 17,
                "name": "BoolatPlay"
            }
        }
    },
    {
        "id": 18,
        "name": "DailyMagic",
        "i18n": {
            "ru": {
                "id": 18,
                "name": "DailyMagic"
            }
        }
    },
    {
        "id": 9,
        "name": "Game Ocean",
        "i18n": {
            "ru": {
                "id": 9,
                "name": "Game Ocean"
            }
        }
    },
    {
        "id": 15,
        "name": "HomeGames",
        "i18n": {
            "ru": {
                "id": 15,
                "name": "HomeGames"
            }
        }
    },
    {
        "id": 13,
        "name": "Mariaglorum",
        "i18n": {
            "ru": {
                "id": 13,
                "name": "Mariaglorum"
            }
        }
    },
    {
        "id": 6,
        "name": "PerfectPlay",
        "i18n": {
            "ru": {
                "id": 6,
                "name": "PerfectPlay"
            }
        }
    },
    {
        "id": 1,
        "name": "Playrix",
        "i18n": {
            "ru": {
                "id": 1,
                "name": "Playrix"
            }
        }
    },
    {
        "id": 7,
        "name": "PlayrixArmenia",
        "i18n": {
            "ru": {
                "id": 7,
                "name": "PlayrixArmenia"
            }
        }
    },
    {
        "id": 14,
        "name": "PlayrixHR",
        "i18n": {
            "ru": {
                "id": 14,
                "name": "PlayrixHR"
            }
        }
    },
    {
        "id": 5,
        "name": "PlayrixRS",
        "i18n": {
            "ru": {
                "id": 5,
                "name": "PlayrixRS"
            }
        }
    },
    {
        "id": 20,
        "name": "RedBark",
        "i18n": {
            "ru": {
                "id": 20,
                "name": "RedBark"
            }
        }
    },
    {
        "id": 10,
        "name": "Voki",
        "i18n": {
            "ru": {
                "id": 10,
                "name": "Voki"
            }
        }
    },
    {
        "id": 8,
        "name": "Zagrava",
        "i18n": {
            "ru": {
                "id": 8,
                "name": "Zagrava"
            }
        }
    },
    {
        "id": 2,
        "name": "Zefir Games",
        "i18n": {
            "ru": {
                "id": 2,
                "name": "Zefir Games"
            }
        }
    }
]

// Helper function to convert blocks to markdown
function blocksToMarkdown(blocks) {
    if (!blocks || !Array.isArray(blocks)) return '';

    let markdown = '';

    blocks.forEach(block => {
        switch (block.type) {
            case 'span':
            case 'div':
                markdown += (block.text?.ru || block.text?.en || '') + '\n';
                break;

            case 'strong':
            case 'b':
                markdown += `**${block.text?.ru || block.text?.en || ''}**`;
                break;

            case 'a':
                const linkText = block.text?.ru || block.text?.en || 'Link';
                markdown += `[${linkText}](${block.url})`;
                break;

            case 'br':
                markdown += '\n';
                break;

            case 'binding-list':
            case 'ordered-list':
                if (block.blocks && Array.isArray(block.blocks)) {
                    const prefix = block.type === 'ordered-list' ? '1. ' : '- ';
                    block.blocks.forEach(item => {
                        markdown += prefix + blocksToMarkdown([item]).trim() + '\n';
                    });
                }
                break;

            default:
                // Handle nested blocks
                if (block.blocks && Array.isArray(block.blocks)) {
                    markdown += blocksToMarkdown(block.blocks);
                }
        }
    });

    return markdown.trim();
}

// Helper function to determine feature flag
function getFeatureFlag(validator) {
    if (validator === 1 || validator === 0) {
        return String(validator);
    }

    if (typeof validator === 'object' && validator !== null) {
        return JSON.stringify(validator);
    }

    return '1'; // default
}

// Helper function to create feature flags object
function createFeatureFlags(data) {
    const featureFlags = {};

    // Process all sections
    ['alert', 'field', 'hint', 'info'].forEach(section => {
        if (data[section]) {
            Object.entries(data[section]).forEach(([key, items]) => {
                if (Array.isArray(items)) {
                    // If there's only one item, use the original key
                    if (items.length === 1) {
                        const item = items[0];
                        if (item.validator !== undefined) {
                            if (item.validator === 1 || item.validator === 0) {
                                featureFlags[key] = item.validator;
                            } else if (typeof item.validator === 'object') {
                                featureFlags[key] = item.validator;
                            }
                        }
                    } else {
                        // If there are multiple items, create versioned keys
                        items.forEach((item, index) => {
                            if (item.validator !== undefined) {
                                const versionedKey = `${key}_v${index + 1}`;
                                if (item.validator === 1 || item.validator === 0) {
                                    featureFlags[versionedKey] = item.validator;
                                } else if (typeof item.validator === 'object') {
                                    featureFlags[versionedKey] = item.validator;
                                }
                            }
                        });
                    }
                }
            });
        }
    });

    return featureFlags;
}

// Create entity data for Strapi
function createEntityData(code, item) {
    // Convert title and blocks to markdown
    let content = '';

    if (item.title && Array.isArray(item.title)) {
        const titleText = blocksToMarkdown(item.title).trim();
        if (titleText) {
            content += `### ${titleText}\n\n`;
        }
    }

    if (item.blocks && Array.isArray(item.blocks)) {
        content += blocksToMarkdown(item.blocks);
    }

    return {
        data: {
            code: code,
            content: content.trim(),
            isAlert: item.isAlert || false,
            typeAlert: item.typeAlert || 'default',
            withIcon: item.withIcon || false,
            featureFlag: code, // Use the code name as the featureFlag
            locale: 'ru'
        }
    };
}

// Post entity to Strapi
async function postToStrapi(entityData) {
    try {
        const response = await fetch(`${STRAPI_URL}${API_ENDPOINT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(entityData)
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

        // Generate feature flags file
        const featureFlags = createFeatureFlags(data);
        fs.writeFileSync(
            OUTPUT_FEATURE_FLAGS,
            JSON.stringify(featureFlags, null, 2),
            'utf8'
        );
        console.log(`✓ Feature flags saved to ${OUTPUT_FEATURE_FLAGS}`);

        let successCount = 0;
        let errorCount = 0;

        // Process all sections
        for (const section of ['alert', 'field', 'hint', 'info']) {
            if (data[section]) {
                for (const [key, items] of Object.entries(data[section])) {
                    if (Array.isArray(items)) {
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            try {
                                // Use versioned key if there are multiple items
                                const code = items.length > 1 ? `${key}_v${i + 1}` : key;
                                const entityData = createEntityData(code, item);
                                const result = await postToStrapi(entityData);
                                console.log(`✓ Created entity: ${code}`);
                                successCount++;

                                // Small delay to avoid overwhelming the server
                                await new Promise(resolve => setTimeout(resolve, 100));
                            } catch (error) {
                                console.error(`✗ Failed to create entity: ${key}`, error.message);
                                errorCount++;
                            }
                        }
                    }
                }
            }
        }

        console.log('\n--- Import Summary ---');
        console.log(`Total successful: ${successCount}`);
        console.log(`Total failed: ${errorCount}`);

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