/**
 * App Name Extractor
 * Extract app name from AndroidManifest.xml or pubspec.yaml
 */

const fs = require('fs-extra');
const path = require('path');
const xml2js = require('xml2js');
const yaml = require('js-yaml');

class AppNameExtractor {
    /**
     * Extract app name from Android project
     * Looks in AndroidManifest.xml for android:label
     * @param {string} projectPath - Path to Android project root
     * @returns {Promise<string>} - App name or default
     */
    async extractAndroidAppName(projectPath) {
        try {
            // Find AndroidManifest.xml
            let manifestPath = null;
            const possiblePaths = [
                path.join(projectPath, 'app', 'src', 'main', 'AndroidManifest.xml'),
                path.join(projectPath, 'src', 'main', 'AndroidManifest.xml'),
                path.join(projectPath, 'AndroidManifest.xml')
            ];

            for (const p of possiblePaths) {
                if (await fs.pathExists(p)) {
                    manifestPath = p;
                    break;
                }
            }

            if (!manifestPath) {
                console.log('AndroidManifest.xml not found');
                return null;
            }

            // Parse AndroidManifest.xml
            const manifestContent = await fs.readFile(manifestPath, 'utf8');
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
            
            const result = await parser.parseStringPromise(manifestContent);
            
            // Look for application label
            let appName = null;
            
            if (result.manifest && result.manifest.application) {
                const application = result.manifest.application;
                const attrs = application.$ || application;
                
                // Check android:label
                if (attrs['android:label']) {
                    let label = attrs['android:label'];
                    // If label is a string resource (starts with @string/)
                    if (label.startsWith('@string/')) {
                        const resourceName = label.substring(8);
                        // Try to find in strings.xml
                        const stringsPath = await this.findStringsXml(projectPath);
                        if (stringsPath) {
                            const extractedName = await this.extractFromStringsXml(stringsPath, resourceName);
                            if (extractedName) {
                                appName = extractedName;
                            }
                        }
                    } else {
                        appName = label;
                    }
                }
            }

            // Clean up app name (remove quotes, trim)
            if (appName) {
                appName = appName.replace(/^["']|["']$/g, '').trim();
                // Remove invalid filename characters
                appName = this.sanitizeFilename(appName);
            }

            return appName || null;
        } catch (error) {
            console.error('Error extracting Android app name:', error.message);
            return null;
        }
    }

    /**
     * Find strings.xml file in Android project
     */
    async findStringsXml(projectPath) {
        const possiblePaths = [
            path.join(projectPath, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
            path.join(projectPath, 'src', 'main', 'res', 'values', 'strings.xml'),
            path.join(projectPath, 'res', 'values', 'strings.xml')
        ];

        for (const p of possiblePaths) {
            if (await fs.pathExists(p)) {
                return p;
            }
        }
        return null;
    }

    /**
     * Extract string value from strings.xml
     */
    async extractFromStringsXml(stringsPath, resourceName) {
        try {
            const content = await fs.readFile(stringsPath, 'utf8');
            const parser = new xml2js.Parser({ explicitArray: false });
            const result = await parser.parseStringPromise(content);
            
            if (result.resources && result.resources.string) {
                const strings = Array.isArray(result.resources.string) 
                    ? result.resources.string 
                    : [result.resources.string];
                
                for (const str of strings) {
                    if (str.$ && str.$.name === resourceName) {
                        return str._ || str;
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Error extracting from strings.xml:', error.message);
            return null;
        }
    }

    /**
     * Extract app name from Flutter project
     * Looks in pubspec.yaml for name or in AndroidManifest.xml
     * @param {string} projectPath - Path to Flutter project root
     * @returns {Promise<string>} - App name or default
     */
    async extractFlutterAppName(projectPath) {
        try {
            // Try to get from pubspec.yaml
            const pubspecPath = path.join(projectPath, 'pubspec.yaml');
            if (await fs.pathExists(pubspecPath)) {
                const pubspecContent = await fs.readFile(pubspecPath, 'utf8');
                const pubspec = yaml.load(pubspecContent);
                
                if (pubspec && pubspec.name) {
                    let appName = pubspec.name;
                    // Convert snake_case or kebab-case to Title Case
                    appName = appName.replace(/[-_]/g, ' ');
                    appName = appName.split(' ').map(word => 
                        word.charAt(0).toUpperCase() + word.slice(1)
                    ).join(' ');
                    return this.sanitizeFilename(appName);
                }
            }

            // If not found, try AndroidManifest.xml in Flutter android folder
            const androidManifestPath = path.join(projectPath, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
            if (await fs.pathExists(androidManifestPath)) {
                const androidName = await this.extractAndroidAppName(path.join(projectPath, 'android'));
                if (androidName) {
                    return androidName;
                }
            }

            return null;
        } catch (error) {
            console.error('Error extracting Flutter app name:', error.message);
            return null;
        }
    }

    /**
     * Sanitize filename (remove invalid characters)
     */
    sanitizeFilename(name) {
        if (!name) return 'app';
        
        // Replace invalid filename characters with underscore
        return name
            .replace(/[<>:"/\\|?*]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 50); // Limit to 50 chars
    }

    /**
     * Main method to extract app name from project
     * @param {string} projectPath - Path to project root
     * @param {string} projectType - 'android' or 'flutter'
     * @returns {Promise<string>} - App name
     */
    async extractAppName(projectPath, projectType) {
        let appName = null;
        
        if (projectType === 'android') {
            appName = await this.extractAndroidAppName(projectPath);
        } else if (projectType === 'flutter') {
            appName = await this.extractFlutterAppName(projectPath);
        }
        
        // Return default if not found
        if (!appName) {
            appName = `${projectType === 'flutter' ? 'Flutter' : 'Android'}_App`;
        }
        
        // Ensure valid filename
        return this.sanitizeFilename(appName);
    }
}

module.exports = new AppNameExtractor();