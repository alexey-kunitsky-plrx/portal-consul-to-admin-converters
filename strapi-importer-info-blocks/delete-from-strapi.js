// File: delete-from-strapi.js

require('dotenv').config();

const fs = require('fs');

// Configuration
const STRAPI_URL = process.env.STRAPI_URL;
const TOKEN = process.env.STRAPI_TOKEN;

if (!STRAPI_URL || !TOKEN) {
    console.error('Missing required env vars. Set STRAPI_URL and STRAPI_TOKEN in .env (see .env.example).');
    process.exit(1);
}

const INFO_BLOCKS_ENDPOINT = '/api/info-blocks';
const BLOCK_CODES_ENDPOINT = '/api/info-block-codes';


// Fetch all entities from Strapi (both locales)
async function fetchAllEntities(endpoint) {
    try {
        const allData = [];

        // Fetch RU locale
        const responseRu = await fetch(`${STRAPI_URL}${endpoint}?pagination[pageSize]=1000&locale=ru`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            },
        });

        if (responseRu.ok) {
            const resultRu = await responseRu.json();
            if (resultRu.data) {
                allData.push(...resultRu.data.map(item => ({ ...item, locale: 'ru' })));
            }
        }

        // Fetch EN locale
        const responseEn = await fetch(`${STRAPI_URL}${endpoint}?pagination[pageSize]=1000&locale=en`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            },
        });

        if (responseEn.ok) {
            const resultEn = await responseEn.json();
            if (resultEn.data) {
                allData.push(...resultEn.data.map(item => ({ ...item, locale: 'en' })));
            }
        }

        return allData;
    } catch (error) {
        console.error('Error fetching entities:', error);
        throw error;
    }
}

// Fetch all block codes (no locale)
async function fetchAllBlockCodes() {
    try {
        const response = await fetch(`${STRAPI_URL}${BLOCK_CODES_ENDPOINT}?pagination[pageSize]=1000`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('Error fetching block codes:', error);
        throw error;
    }
}

// Delete entity from Strapi by ID
async function deleteFromStrapi(endpoint, id, documentId, locale = null) {
    try {
        // Try using documentId first (newer Strapi versions)
        const identifier = documentId || id;
        const deleteUrl = locale
            ? `${STRAPI_URL}${endpoint}/${identifier}?locale=${locale}`
            : `${STRAPI_URL}${endpoint}/${identifier}`;

        console.log(`  Attempting to delete: ${deleteUrl}`);

        const response = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`,
            },
        });

        console.log(`  Delete response status: ${response.status}`);

        if (!response.ok) {
            const error = await response.text();
            console.log(`  Delete error: ${error}`);
            throw new Error(`HTTP error! status: ${response.status}, body: ${error}`);
        }

        // Handle 204 No Content responses (common for DELETE)
        if (response.status === 204) {
            return { success: true, id: identifier };
        }

        // Check if there's a response body before parsing JSON
        const text = await response.text();
        if (text && text.trim().length > 0) {
            try {
                return JSON.parse(text);
            } catch (e) {
                // If response is not JSON, return the text
                return { success: true, message: text, id: identifier };
            }
        }

        // If no response body, consider it successful
        return { success: true, id: identifier };
    } catch (error) {
        // Don't log the full error object here, it will be logged in the calling function
        throw error;
    }
}

// Main delete function
async function deleteAllFromStrapi() {
    try {
        let totalSuccess = 0;
        let totalError = 0;

        // First, delete all info blocks (both locales)
        console.log('=== Deleting Info Blocks (RU and EN locales) ===');
        const infoBlocks = await fetchAllEntities(INFO_BLOCKS_ENDPOINT);

        if (infoBlocks.length === 0) {
            console.log('No info blocks found to delete.\n');
        } else {
            console.log(`Found ${infoBlocks.length} info blocks to delete (including both locales).\n`);

            let successCount = 0;
            let errorCount = 0;

            for (const entity of infoBlocks) {
                try {
                    const documentId = entity.documentId || entity.id;
                    const locale = entity.locale || 'ru';
                    await deleteFromStrapi(INFO_BLOCKS_ENDPOINT, entity.id, documentId, locale);
                    console.log(`✓ Deleted info block [${locale}] ID: ${entity.id}, documentId: ${documentId} (title: ${entity.attributes?.title || entity.title || 'N/A'})`);
                    successCount++;

                    // Small delay to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`✗ Failed to delete info block ID: ${entity.id}`, error.message);
                    errorCount++;
                }
            }

            console.log('\n--- Info Blocks Deletion Summary ---');
            console.log(`Total successful: ${successCount}`);
            console.log(`Total failed: ${errorCount}\n`);

            totalSuccess += successCount;
            totalError += errorCount;
        }

        // Then, delete all info block codes
        console.log('=== Deleting Info Block Codes ===');
        const blockCodes = await fetchAllBlockCodes();

        if (blockCodes.length === 0) {
            console.log('No block codes found to delete.\n');
        } else {
            console.log(`Found ${blockCodes.length} block codes to delete.\n`);

            let successCount = 0;
            let errorCount = 0;

            for (const entity of blockCodes) {
                try {
                    const documentId = entity.documentId || entity.id;
                    await deleteFromStrapi(BLOCK_CODES_ENDPOINT, entity.id, documentId);
                    console.log(`✓ Deleted block code ID: ${entity.id}, documentId: ${documentId} (title: ${entity.attributes?.title || entity.title || 'N/A'})`);
                    successCount++;

                    // Small delay to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`✗ Failed to delete block code ID: ${entity.id}`, error.message);
                    errorCount++;
                }
            }

            console.log('\n--- Block Codes Deletion Summary ---');
            console.log(`Total successful: ${successCount}`);
            console.log(`Total failed: ${errorCount}\n`);

            totalSuccess += successCount;
            totalError += errorCount;
        }

        console.log('=== Overall Deletion Summary ===');
        console.log(`Total successful: ${totalSuccess}`);
        console.log(`Total failed: ${totalError}`);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Delete specific entities by IDs
async function deleteSpecificEntities(ids, type = 'info-blocks') {
    try {
        const endpoint = type === 'block-codes' ? BLOCK_CODES_ENDPOINT : INFO_BLOCKS_ENDPOINT;
        console.log(`Deleting ${ids.length} specific ${type}...\n`);

        let successCount = 0;
        let errorCount = 0;

        if (type === 'info-blocks') {
            // For info blocks, delete both locales
            for (const id of ids) {
                // Try RU locale
                try {
                    await deleteFromStrapi(endpoint, id, id, 'ru');
                    console.log(`✓ Deleted ${type} [ru] ID: ${id}`);
                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`✗ Failed to delete ${type} [ru] ID: ${id}`, error.message);
                    errorCount++;
                }

                // Try EN locale
                try {
                    await deleteFromStrapi(endpoint, id, id, 'en');
                    console.log(`✓ Deleted ${type} [en] ID: ${id}`);
                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`✗ Failed to delete ${type} [en] ID: ${id}`, error.message);
                    errorCount++;
                }
            }
        } else {
            // For block codes (no locale)
            for (const id of ids) {
                try {
                    await deleteFromStrapi(endpoint, id, id);
                    console.log(`✓ Deleted ${type} ID: ${id}`);
                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`✗ Failed to delete ${type} ID: ${id}`, error.message);
                    errorCount++;
                }
            }
        }

        console.log('\n--- Deletion Summary ---');
        console.log(`Total successful: ${successCount}`);
        console.log(`Total failed: ${errorCount}`);

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run the delete script
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length > 0) {
        // Check if first argument is a type flag
        if (args[0] === '--block-codes' || args[0] === '-bc') {
            // Delete specific block codes by IDs
            const ids = args.slice(1).map(arg => parseInt(arg)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                deleteSpecificEntities(ids, 'block-codes');
            } else {
                console.error('Invalid IDs provided. Please provide numeric IDs.');
                process.exit(1);
            }
        } else {
            // Delete specific info blocks by IDs
            const ids = args.map(arg => parseInt(arg)).filter(id => !isNaN(id));
            if (ids.length > 0) {
                deleteSpecificEntities(ids, 'info-blocks');
            } else {
                console.error('Invalid IDs provided. Please provide numeric IDs.');
                process.exit(1);
            }
        }
    } else {
        // Delete all entities (both info blocks and block codes)
        deleteAllFromStrapi();
    }
}

module.exports = { deleteAllFromStrapi, deleteSpecificEntities, fetchAllEntities, fetchAllBlockCodes };