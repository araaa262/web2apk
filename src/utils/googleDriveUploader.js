/**
 * Google Drive Uploader
 * Upload file ke Google Drive dengan link permanen
 */

const { google } = require('googleapis');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

class GoogleDriveUploader {
    constructor() {
        this.drive = null;
        this.folderId = process.env.GDRIVE_FOLDER_ID || null;
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        try {
            // Cek apakah ada credentials file
            const credentialsPath = path.join(__dirname, '..', '..', 'credentials.json');
            const tokenPath = path.join(__dirname, '..', '..', 'token.json');

            if (!await fs.pathExists(credentialsPath)) {
                console.error('[GoogleDrive] credentials.json not found!');
                console.log('[GoogleDrive] Please follow: https://developers.google.com/drive/api/quickstart/nodejs');
                return;
            }

            const auth = new google.auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/drive.file']
            });

            this.drive = google.drive({ version: 'v3', auth });
            this.initialized = true;
            console.log('[GoogleDrive] Initialized successfully');
        } catch (error) {
            console.error('[GoogleDrive] Init error:', error.message);
        }
    }

    async uploadFile(filePath, fileName, userId) {
        await this.init();

        if (!this.drive) {
            return { success: false, error: 'Google Drive not initialized' };
        }

        try {
            const fileMetadata = {
                name: fileName,
                parents: this.folderId ? [this.folderId] : []
            };

            const media = {
                mimeType: 'application/octet-stream',
                body: fs.createReadStream(filePath)
            };

            const response = await this.drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id, name, webViewLink, webContentLink'
            });

            const fileId = response.data.id;

            // Set permission to public
            await this.drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });

            // Get direct download link
            const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
            const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;

            const stats = await fs.stat(filePath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

            console.log(`[GoogleDrive] Uploaded: ${fileName} (${sizeMB} MB) - ID: ${fileId}`);

            return {
                success: true,
                url: downloadUrl,
                viewUrl: viewUrl,
                fileId: fileId,
                fileName: fileName,
                sizeMB: sizeMB,
                expiresIn: 'Permanent (until deleted)'
            };

        } catch (error) {
            console.error('[GoogleDrive] Upload error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async deleteFile(fileId) {
        try {
            await this.drive.files.delete({ fileId: fileId });
            return true;
        } catch (error) {
            console.error('[GoogleDrive] Delete error:', error.message);
            return false;
        }
    }
}

module.exports = new GoogleDriveUploader();