/**
 * Local Bot API File Downloader
 * 
 * When using Telegram Local Bot API Server, the standard downloadFile
 * method from node-telegram-bot-api may not work correctly.
 * 
 * This module provides a direct HTTP download approach.
 */

const https = require('https');
const http = require('http');
const fs = require('fs-extra');
const path = require('path');

/**
 * Download file from Telegram using Local Bot API or standard Bot API
 * 
 * @param {Object} bot - TelegramBot instance
 * @param {string} fileId - Telegram file_id
 * @param {string} destDir - Destination directory
 * @param {string} fileName - File name to save as
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function downloadTelegramFile(bot, fileId, destDir, fileName) {
    const localApiUrl = process.env.LOCAL_API_URL;
    const botToken = process.env.BOT_TOKEN;

    try {
        // Ensure destination directory exists
        await fs.ensureDir(destDir);
        const destPath = path.join(destDir, fileName);

        // Get file info first
        console.log(`[DOWNLOAD] Getting file info for ID: ${fileId}`);
        const fileInfo = await bot.getFile(fileId);
        
        if (!fileInfo || !fileInfo.file_path) {
            throw new Error('File info not found or file_path is missing');
        }
        
        console.log(`[DOWNLOAD] File path from API: ${fileInfo.file_path}`);
        console.log(`[DOWNLOAD] File size: ${fileInfo.file_size || 'unknown'} bytes`);

        if (localApiUrl) {
            // LOCAL BOT API: Files are stored locally on the filesystem!
            // The file_path is an absolute path like: /opt/telegram-bot-api/.../file.zip
            
            let localFilePath = fileInfo.file_path;
            
            // Check if the path is relative or absolute
            if (!path.isAbsolute(localFilePath)) {
                // Try to construct absolute path
                const possiblePaths = [
                    localFilePath,
                    path.join('/opt/telegram-bot-api', botToken, localFilePath),
                    path.join('/var/lib/telegram-bot-api', botToken, localFilePath),
                    path.join('/root/telegram-bot-api', botToken, localFilePath)
                ];
                
                // Find existing file
                for (const testPath of possiblePaths) {
                    if (await fs.pathExists(testPath)) {
                        localFilePath = testPath;
                        break;
                    }
                }
            }

            console.log(`[DOWNLOAD] Looking for local file: ${localFilePath}`);
            
            // Check if file exists locally
            if (await fs.pathExists(localFilePath)) {
                console.log(`[DOWNLOAD] Copying local file: ${localFilePath}`);
                await fs.copy(localFilePath, destPath);
                
                const stats = await fs.stat(destPath);
                console.log(`[DOWNLOAD] Copied ${stats.size} bytes to ${destPath}`);
                
                return { success: true, path: destPath, size: stats.size };
            } else {
                // Fallback: try HTTP download (for compatibility)
                console.log(`[DOWNLOAD] Local file not found, trying HTTP download...`);
                const downloadUrl = `${localApiUrl}/file/bot${botToken}/${fileInfo.file_path}`;
                console.log(`[DOWNLOAD] Download URL: ${downloadUrl.substring(0, 80)}...`);
                
                try {
                    await downloadFileViaHttp(downloadUrl, destPath);
                    const stats = await fs.stat(destPath);
                    console.log(`[DOWNLOAD] Downloaded ${stats.size} bytes`);
                    return { success: true, path: destPath, size: stats.size };
                } catch (httpError) {
                    console.error(`[DOWNLOAD] HTTP download failed: ${httpError.message}`);
                    throw new Error(`File not accessible: ${httpError.message}`);
                }
            }
        } else {
            // Standard Bot API - download via HTTP
            const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
            console.log(`[DOWNLOAD] Download URL: ${downloadUrl.substring(0, 80)}...`);
            
            await downloadFileViaHttp(downloadUrl, destPath);
            const stats = await fs.stat(destPath);
            console.log(`[DOWNLOAD] Downloaded ${stats.size} bytes to ${destPath}`);
            
            return { success: true, path: destPath, size: stats.size };
        }

    } catch (error) {
        console.error('[DOWNLOAD] Download error:', error.message);
        console.error('[DOWNLOAD] Error stack:', error.stack);
        return { success: false, error: error.message };
    }
}

/**
 * Download file via HTTP/HTTPS with retry mechanism
 */
function downloadFileViaHttp(url, destPath, retries = 3) {
    return new Promise(async (resolve, reject) => {
        let lastError = null;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`[DOWNLOAD] Attempt ${attempt}/${retries}`);
                await downloadFileViaHttpOnce(url, destPath);
                return resolve();
            } catch (error) {
                lastError = error;
                console.log(`[DOWNLOAD] Attempt ${attempt} failed: ${error.message}`);
                
                // Clean up partial file if exists
                try {
                    if (await fs.pathExists(destPath)) {
                        await fs.remove(destPath);
                    }
                } catch (e) {}
                
                if (attempt < retries) {
                    // Wait before retry
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }
        }
        
        reject(lastError || new Error('Download failed after retries'));
    });
}

/**
 * Download file via HTTP/HTTPS - single attempt
 */
function downloadFileViaHttpOnce(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        let requestAborted = false;
        
        // Set timeout for the request
        const timeout = setTimeout(() => {
            if (!requestAborted) {
                requestAborted = true;
                request.destroy();
                file.close();
                fs.unlink(destPath, () => {});
                reject(new Error('Download timeout after 60 seconds'));
            }
        }, 60000); // 60 seconds timeout
        
        const request = protocol.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                clearTimeout(timeout);
                file.close();
                fs.unlink(destPath, () => {});
                return downloadFileViaHttpOnce(response.headers.location, destPath)
                    .then(resolve)
                    .catch(reject);
            }
            
            // Check for errors
            if (response.statusCode !== 200) {
                clearTimeout(timeout);
                file.close();
                fs.unlink(destPath, () => {});
                
                let body = '';
                response.on('data', chunk => body += chunk);
                response.on('end', () => {
                    reject(new Error(`HTTP ${response.statusCode}: ${body || response.statusMessage}`));
                });
                return;
            }
            
            response.pipe(file);
            
            file.on('finish', () => {
                clearTimeout(timeout);
                file.close();
                resolve();
            });
        });
        
        request.on('error', (error) => {
            clearTimeout(timeout);
            file.close();
            fs.unlink(destPath, () => {});
            reject(error);
        });
        
        file.on('error', (error) => {
            clearTimeout(timeout);
            file.close();
            fs.unlink(destPath, () => {});
            reject(error);
        });
        
        // Set socket timeout
        request.setTimeout(60000, () => {
            if (!requestAborted) {
                requestAborted = true;
                request.destroy();
                file.close();
                fs.unlink(destPath, () => {});
                reject(new Error('Socket timeout'));
            }
        });
    });
}

module.exports = {
    downloadTelegramFile
};