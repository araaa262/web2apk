const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const xml2js = require('xml2js');
const yaml = require('js-yaml');

/**
 * App Name Extractor - Extract app name from project
 */
class AppNameExtractor {
    /**
     * Extract app name from Android project
     * Looks for android:label in AndroidManifest.xml
     */
    async extractAndroidAppName(projectRoot) {
        try {
            // Find AndroidManifest.xml
            let manifestPath = null;
            const possiblePaths = [
                path.join(projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml'),
                path.join(projectRoot, 'src', 'main', 'AndroidManifest.xml'),
                path.join(projectRoot, 'AndroidManifest.xml')
            ];

            for (const p of possiblePaths) {
                if (await fs.pathExists(p)) {
                    manifestPath = p;
                    break;
                }
            }

            if (!manifestPath) {
                console.log('[AppName] AndroidManifest.xml not found');
                return null;
            }

            const manifestContent = await fs.readFile(manifestPath, 'utf8');
            const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
            const result = await parser.parseStringPromise(manifestContent);
            
            let appName = null;
            
            if (result.manifest && result.manifest.application) {
                const application = result.manifest.application;
                const attrs = application.$ || application;
                
                if (attrs['android:label']) {
                    let label = attrs['android:label'];
                    
                    // If label is a string resource (starts with @string/)
                    if (label.startsWith('@string/')) {
                        const resourceName = label.substring(8);
                        const stringsPath = await this.findStringsXml(projectRoot);
                        if (stringsPath) {
                            const extractedName = await this.extractFromStringsXml(stringsPath, resourceName);
                            if (extractedName) appName = extractedName;
                        }
                    } else {
                        // Direct label value (like "X-VALHALLA V 3.3")
                        appName = label;
                    }
                }
            }

            if (appName) {
                appName = appName.replace(/^["']|["']$/g, '').trim();
                console.log(`[AppName] Extracted Android app name: ${appName}`);
            }
            
            return appName;
        } catch (error) {
            console.error('[AppName] Error extracting Android app name:', error.message);
            return null;
        }
    }

    /**
     * Find strings.xml file
     */
    async findStringsXml(projectRoot) {
        const possiblePaths = [
            path.join(projectRoot, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
            path.join(projectRoot, 'src', 'main', 'res', 'values', 'strings.xml'),
            path.join(projectRoot, 'res', 'values', 'strings.xml')
        ];

        for (const p of possiblePaths) {
            if (await fs.pathExists(p)) return p;
        }
        return null;
    }

    /**
     * Extract string from strings.xml
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
            return null;
        }
    }

    /**
     * Extract app name from Flutter project
     * PRIORITY: AndroidManifest.xml > pubspec.yaml
     */
    async extractFlutterAppName(projectRoot) {
        try {
            // PRIORITY 1: Try AndroidManifest.xml in Flutter android folder
            const androidManifestPath = path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
            if (await fs.pathExists(androidManifestPath)) {
                const androidName = await this.extractAndroidAppName(path.join(projectRoot, 'android'));
                if (androidName) {
                    console.log(`[AppName] Extracted Flutter app name from AndroidManifest: ${androidName}`);
                    return androidName;
                }
            }

            // PRIORITY 2: Try pubspec.yaml as fallback
            const pubspecPath = path.join(projectRoot, 'pubspec.yaml');
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
                    console.log(`[AppName] Extracted Flutter app name from pubspec: ${appName}`);
                    return appName;
                }
            }

            return null;
        } catch (error) {
            console.error('[AppName] Error extracting Flutter app name:', error.message);
            return null;
        }
    }

    /**
     * Sanitize filename (remove invalid characters)
     */
    sanitizeFilename(name) {
        if (!name) return 'app';
        
        // Replace spaces with underscores, remove special characters
        return name
            .replace(/[<>:"/\\|?*]/g, '_')  // Remove invalid filename chars
            .replace(/\s+/g, '_')            // Replace spaces with underscore
            .replace(/-+/g, '_')             // Replace hyphens with underscore
            .replace(/\.+/g, '_')            // Replace dots with underscore
            .replace(/_{2,}/g, '_')          // Replace multiple underscores with single
            .replace(/^_|_$/g, '')           // Remove leading/trailing underscores
            .substring(0, 50);               // Limit to 50 chars
    }

    /**
     * Main method to extract app name
     * @param {string} projectRoot - Path to project root
     * @param {string} projectType - 'android' or 'flutter'
     * @returns {Promise<string>} - Sanitized app name
     */
    async extractAppName(projectRoot, projectType) {
        let appName = null;
        
        if (projectType === 'android') {
            appName = await this.extractAndroidAppName(projectRoot);
        } else if (projectType === 'flutter') {
            appName = await this.extractFlutterAppName(projectRoot);
        }
        
        // Default name if nothing found
        if (!appName) {
            appName = `${projectType === 'flutter' ? 'Flutter' : 'Android'}_App`;
            console.log(`[AppName] Using default name: ${appName}`);
        }
        
        // Sanitize for filename
        const sanitizedName = this.sanitizeFilename(appName);
        console.log(`[AppName] Final sanitized name: ${sanitizedName}`);
        
        return sanitizedName;
    }
}

const appNameExtractor = new AppNameExtractor();

/**
 * Sanitize filename/path to remove invalid characters
 */
function sanitizePath(filePath) {
    if (!filePath) return filePath;

    let sanitized = filePath.replace(/\\/g, '/');
    sanitized = sanitized.replace(/[^\w\-./]/g, (char) => {
        if (char === ' ') return '_';
        if (char === '(' || char === ')') return '';
        if (char === '[' || char === ']') return '';
        if (char === '{' || char === '}') return '';
        const code = char.charCodeAt(0);
        if (code >= 32 && code <= 126) return char;
        return '';
    });

    sanitized = sanitized.split('/').map(segment =>
        segment.trim().replace(/^\.+|\.+$/g, '') || segment
    ).join('/');

    sanitized = sanitized.replace(/\/+/g, '/');
    return sanitized;
}

/**
/**
 * Safely extract ZIP file with filename sanitization
 */
async function safeExtractZip(zipPath, targetDir) {
    await fs.ensureDir(targetDir);

    // Check if file exists
    if (!await fs.pathExists(zipPath)) {
        throw new Error(`ZIP file not found: ${zipPath}`);
    }

    // Try system 'unzip' command
    try {
        console.log('[ZIP] Attempting system unzip...');
        await new Promise((resolve, reject) => {
            const unzip = spawn('unzip', ['-o', '-q', zipPath, '-d', targetDir]);
            unzip.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`unzip process exited with code ${code}`));
            });
            unzip.on('error', (err) => reject(err));
        });
        console.log('[ZIP] System unzip success');
        return { success: true };
    } catch (sysError) {
        console.log(`[ZIP] System unzip failed: ${sysError.message}, falling back to AdmZip...`);
    }

    // Fallback to AdmZip with sanitization
    try {
        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();
        let sanitized = false;
        let extractedCount = 0;

        for (const entry of entries) {
            try {
                const originalName = entry.entryName;
                const sanitizedName = sanitizePath(originalName);

                if (!sanitizedName || sanitizedName === '/') continue;

                const targetPath = path.join(targetDir, sanitizedName);
                const resolvedPath = path.resolve(targetPath);
                if (!resolvedPath.startsWith(path.resolve(targetDir))) continue;

                if (entry.isDirectory) {
                    await fs.ensureDir(targetPath);
                } else {
                    await fs.ensureDir(path.dirname(targetPath));
                    const content = entry.getData();
                    await fs.writeFile(targetPath, content);
                    extractedCount++;
                }

                if (originalName !== sanitizedName) {
                    sanitized = true;
                    console.log(`[ZIP] Renamed: "${originalName}" -> "${sanitizedName}"`);
                }
            } catch (entryError) {
                console.log(`[ZIP] Error extracting entry: ${entryError.message}`);
            }
        }

        console.log(`[ZIP] Extracted ${extractedCount} files`);
        return { success: true, sanitized };
        
    } catch (admError) {
        console.error('[ZIP] Safe extraction failed:', admError.message);
        throw new Error(`ZIP extraction failed: ${admError.message}`);
    }
}

/**
 * Find project root directory
 */
async function findProjectRoot(dir, projectType) {
    const targetFile = projectType === 'flutter' ? 'pubspec.yaml' : 'build.gradle';

    if (await fs.pathExists(path.join(dir, targetFile))) {
        return dir;
    }

    const items = await fs.readdir(dir);
    for (const item of items) {
        const itemPath = path.join(dir, item);
        const stat = await fs.stat(itemPath);
        if (stat.isDirectory()) {
            if (await fs.pathExists(path.join(itemPath, targetFile))) {
                return itemPath;
            }
        }
    }
    return null;
}

/**
 * Validate asset files
 */
async function validateAssets(projectDir, onProgress) {
    onProgress('🔍 Validating asset files...');
    const assetsDir = path.join(projectDir, 'assets');
    const imagesDir = path.join(projectDir, 'images');
    const corruptFiles = [];
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

    const dirsToCheck = [assetsDir, imagesDir];

    if (await fs.pathExists(assetsDir)) {
        try {
            const assetSubdirs = await fs.readdir(assetsDir);
            for (const subdir of assetSubdirs) {
                const subdirPath = path.join(assetsDir, subdir);
                const stat = await fs.stat(subdirPath).catch(() => null);
                if (stat?.isDirectory()) dirsToCheck.push(subdirPath);
            }
        } catch (e) { }
    }

    for (const dir of dirsToCheck) {
        if (!await fs.pathExists(dir)) continue;
        try {
            const files = await fs.readdir(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const ext = path.extname(file).toLowerCase();
                if (!imageExtensions.includes(ext)) continue;

                try {
                    const stat = await fs.stat(filePath);
                    if (stat.size < 10) {
                        corruptFiles.push(filePath);
                        continue;
                    }

                    const fileBuffer = await fs.readFile(filePath);
                    const buffer = fileBuffer.slice(0, 12);
                    const isValidImage =
                        (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) ||
                        (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) ||
                        (buffer.toString('ascii', 0, 3) === 'GIF') ||
                        (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') ||
                        (buffer[0] === 0x42 && buffer[1] === 0x4D);

                    if (!isValidImage) corruptFiles.push(filePath);
                } catch (e) {
                    corruptFiles.push(filePath);
                }
            }
        } catch (e) { }
    }

    if (corruptFiles.length > 0) {
        onProgress(`⚠️ Found ${corruptFiles.length} corrupt image(s), removing...`);
        for (const file of corruptFiles) {
            try { await fs.remove(file); } catch (e) { }
        }
    }
    return { corruptFiles: corruptFiles.length };
}

/**
 * Fix settings.gradle for Flutter 3.x
 */
async function fixSettingsGradle(projectDir, onProgress) {
    const settingsPath = path.join(projectDir, 'android', 'settings.gradle');
    if (!await fs.pathExists(settingsPath)) return;

    try {
        let content = await fs.readFile(settingsPath, 'utf8');
        let modified = false;

        const includeAppRegex = /include\s+['"]:app['"]/;
        const hasOldFormat = includeAppRegex.test(content) && !content.includes('pluginManagement');

        if (hasOldFormat) {
            onProgress('⚙️ Updating settings.gradle to Flutter 3.x format...');
            const newContent = `pluginManagement {
    def flutterSdkPath = {
        def properties = new Properties()
        file("local.properties").withInputStream { properties.load(it) }
        def flutterSdkPath = properties.getProperty("flutter.sdk")
        assert flutterSdkPath != null, "flutter.sdk not set in local.properties"
        return flutterSdkPath
    }()

    includeBuild("\${flutterSdkPath}/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id "dev.flutter.flutter-gradle-plugin" version "1.0.0" apply false
    id "com.android.application" version "7.3.0" apply false
    id "org.jetbrains.kotlin.android" version "1.7.10" apply false
}

include ":app"
`;
            await fs.writeFile(settingsPath, newContent);
            modified = true;
        }

        if (!content.includes('pluginManagement')) {
            const pluginMgmt = `pluginManagement {
    def flutterSdkPath = {
        def properties = new Properties()
        file("local.properties").withInputStream { properties.load(it) }
        def flutterSdkPath = properties.getProperty("flutter.sdk")
        assert flutterSdkPath != null, "flutter.sdk not set in local.properties"
        return flutterSdkPath
    }()

    includeBuild("\${flutterSdkPath}/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

`;
            content = pluginMgmt + content;
            await fs.writeFile(settingsPath, content);
            modified = true;
        }

        if (content.includes('dev.flutter.flutter-plugin-loader')) {
            onProgress('⚙️ Replacing deprecated Flutter plugin loader ID...');
            content = content.replace(
                /id\s+['"]dev\.flutter\.flutter-plugin-loader['"]\s+version\s+['"][^'"]+['"]/g,
                `id "dev.flutter.flutter-gradle-plugin" version "1.0.0" apply false`
            );
            await fs.writeFile(settingsPath, content);
            modified = true;
        }
    } catch (e) {
        console.log('[FIX] Could not update settings.gradle:', e.message);
    }
}

/**
 * Fix android/build.gradle
 */
async function fixBuildGradle(projectDir, onProgress) {
    const buildGradlePath = path.join(projectDir, 'android', 'build.gradle');
    if (!await fs.pathExists(buildGradlePath)) return;

    try {
        let content = await fs.readFile(buildGradlePath, 'utf8');
        let modified = false;

        const kotlinVersionRegex = /ext\.kotlin_version\s*=\s*['"]([^'"]+)['"]/;
        const match = content.match(kotlinVersionRegex);

        if (match && /^1\.[3-6]\./.test(match[1])) {
            onProgress(`⚙️ Upgrading Kotlin from ${match[1]} to 1.9.0...`);
            content = content.replace(kotlinVersionRegex, "ext.kotlin_version = '1.9.0'");
            modified = true;
        }

        if (!content.includes('subprojects {')) {
            content += `
subprojects {
    afterEvaluate { project ->
        if (project.hasProperty("android")) {
            android {
                lintOptions {
                    checkReleaseBuilds false
                    abortOnError false
                }
            }
        }
    }
}
`;
            modified = true;
        }

        if (modified) {
            await fs.writeFile(buildGradlePath, content);
        }
    } catch (e) {
        console.log('[FIX] Could not update build.gradle:', e.message);
    }
}

/**
 * Fix android/app/build.gradle
 */
async function fixAppBuildGradle(projectDir, onProgress) {
    const appBuildGradlePath = path.join(projectDir, 'android', 'app', 'build.gradle');
    if (!await fs.pathExists(appBuildGradlePath)) return;

    try {
        let content = await fs.readFile(appBuildGradlePath, 'utf8');
        let modified = false;

        const checkAndReplace = (regex, type, minVersion = 34) => {
            const match = content.match(regex);
            if (match) {
                const version = parseInt(match[1]);
                if (!isNaN(version) && version < minVersion) {
                    content = content.replace(regex, `${type} ${minVersion}`);
                    return true;
                }
            }
            return false;
        };

        if (checkAndReplace(/compileSdkVersion\s+(\d+)/, 'compileSdkVersion')) modified = true;
        if (checkAndReplace(/targetSdkVersion\s+(\d+)/, 'targetSdkVersion')) modified = true;
        if (checkAndReplace(/minSdkVersion\s+(\d+)/, 'minSdkVersion', 21)) modified = true;

        if (content.includes('minifyEnabled true')) {
            content = content.replace(/minifyEnabled\s+true/g, 'minifyEnabled false');
            modified = true;
        }
        if (content.includes('shrinkResources true')) {
            content = content.replace(/shrinkResources\s+true/g, 'shrinkResources false');
            modified = true;
        }
        if (!content.includes('lintOptions')) {
            content = content.replace('defaultConfig {', `
    lintOptions {
        checkReleaseBuilds false
        abortOnError false
    }
    defaultConfig {`);
            modified = true;
        }

        if (modified) {
            await fs.writeFile(appBuildGradlePath, content);
        }
    } catch (e) {
        console.log('[FIX] Could not update app/build.gradle:', e.message);
    }
}

/**
 * Fix Dart files that extend IconData (not allowed in Flutter 3.x - final class)
 * Converts: class Foo extends IconData { const Foo(int cp) : super(cp, fontFamily: 'X'); }
 * To:       class Foo { Foo._(); static const IconData bar = IconData(0x..., fontFamily: 'X'); }
 */
async function fixIconDataExtends(projectDir, onProgress) {
    const libDir = path.join(projectDir, 'lib');
    if (!await fs.pathExists(libDir)) return;

    async function scanDir(dir) {
        let items;
        try { items = await fs.readdir(dir); } catch (e) { return; }
        for (const item of items) {
            const fullPath = path.join(dir, item);
            let stat;
            try { stat = await fs.stat(fullPath); } catch (e) { continue; }
            if (stat.isDirectory()) {
                await scanDir(fullPath);
            } else if (item.endsWith('.dart')) {
                await fixDartFile(fullPath);
            }
        }
    }

    async function fixDartFile(filePath) {
        try {
            let content = await fs.readFile(filePath, 'utf8');
            if (!content.includes('extends IconData')) return;

            onProgress(`🔧 Fixing IconData extends in: ${path.basename(filePath)}`);

            // Pattern: class ClassName extends IconData { ... }
            // Replace the class declaration to remove extends IconData
            // and convert constructor to static factory fields
            content = content.replace(
                /class\s+(\w+)\s+extends\s+IconData\s*\{([\s\S]*?)\n\}/g,
                (match, className, body) => {
                    // Extract fontFamily if present in super() call
                    const fontFamilyMatch = body.match(/fontFamily\s*:\s*['"]([^'"]+)['"]/);
                    const fontPackageMatch = body.match(/fontPackage\s*:\s*['"]([^'"]+)['"]/);
                    const fontFamily = fontFamilyMatch ? fontFamilyMatch[1] : className;
                    const fontPackage = fontPackageMatch ? `, fontPackage: '${fontPackageMatch[1]}'` : '';

                    // Extract static const fields if any exist
                    const staticFields = [];
                    const staticRegex = /static\s+const\s+\w+\s+(\w+)\s*=\s*\w+\s*\(\s*(0x[0-9a-fA-F]+|\d+)/g;
                    let m;
                    while ((m = staticRegex.exec(body)) !== null) {
                        staticFields.push(
                            `  static const IconData ${m[1]} = IconData(${m[2]}, fontFamily: '${fontFamily}'${fontPackage});`
                        );
                    }

                    // Build replacement class
                    const fields = staticFields.length > 0
                        ? staticFields.join('\r\n')
                        : `  // TODO: Add your icon fields here\n  // static const IconData myIcon = IconData(0xe001, fontFamily: '${fontFamily}'${fontPackage});`;

                    return `class ${className} {\n  ${className}._();\n${fields}\n}`;
                }
            );

            // Also fix simpler inline extends: SomeClass(int cp) : super(cp, fontFamily: 'X')
            // that might not match above (e.g. multiline constructors already replaced)
            // Just ensure no 'extends IconData' remains
            if (content.includes('extends IconData')) {
                content = content.replace(/\s+extends\s+IconData/g, '');
                onProgress(`⚠️ Removed remaining extends IconData in: ${path.basename(filePath)}`);
            }

            await fs.writeFile(filePath, content, 'utf8');
        } catch (e) {
            console.log(`[FIX] Could not fix IconData in ${filePath}:`, e.message);
        }
    }

    try {
        await scanDir(libDir);
    } catch (e) {
        console.log('[FIX] fixIconDataExtends error:', e.message);
    }
}

/**
 * Run command with promise
 */
function runCommand(cmd, args, cwd, onOutput = null) {
    return new Promise((resolve, reject) => {
        const logDir = path.join(__dirname, '..', '..', 'logs');
        fs.ensureDirSync(logDir);
        const logFile = path.join(logDir, `build_${Date.now()}.log`);

        const isLinux = process.platform === 'linux';
        let finalCmd = cmd;
        let finalArgs = args;

        if (isLinux && (cmd === 'flutter' || cmd.includes('gradle'))) {
            finalCmd = 'nice';
            finalArgs = ['-n', '10', 'ionice', '-c', '2', '-n', '4', cmd, ...args];
        }

        const proc = spawn(finalCmd, finalArgs, {
            cwd,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                GRADLE_OPTS: '-Dorg.gradle.native=false -Dfile.encoding=UTF-8 -Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+UseParallelGC',
                _JAVA_OPTIONS: '-Xmx2048m -Dfile.encoding=UTF-8'
            }
        });

        let stdout = '';
        let stderr = '';
        let lastActivity = Date.now();

        proc.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            fs.appendFileSync(logFile, text);
            lastActivity = Date.now();
            if (onOutput) {
                const lines = text.split('\n').filter(l => l.trim());
                if (lines.length > 0) {
                    onOutput(lines[lines.length - 1].substring(0, 150));
                }
            }
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            fs.appendFileSync(logFile, '[STDERR] ' + text);
            lastActivity = Date.now();
            if (onOutput && (text.includes('error') || text.includes('Error') || text.includes('Exception'))) {
                onOutput('[!] ' + text.substring(0, 150));
            }
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                const allOutput = stdout + '\n' + stderr;
                fs.writeFileSync(logFile + '.error', allOutput);

                const errorPatterns = [
                    /FAILURE:.*$/gm,
                    /error:.*$/gmi,
                    /Error:.*$/gm,
                    /Exception:.*$/gm,
                    /\* What went wrong:[\s\S]*?(?=\* Try:|\* Get more help|$)/gm,
                ];

                let errorLines = [];
                for (const pattern of errorPatterns) {
                    const matches = allOutput.match(pattern);
                    if (matches) errorLines.push(...matches);
                }

                errorLines = [...new Set(errorLines)].slice(0, 10);
                let errorMsg = errorLines.length > 0 ? errorLines.join('\n') : `Build failed with code ${code}`;
                errorMsg = errorMsg.substring(0, 1500);
                reject(new Error(errorMsg));
            }
        });

        proc.on('error', (err) => reject(err));

        const TIMEOUT_MS = 30 * 60 * 1000;
        const timeoutCheck = setInterval(() => {
            if (Date.now() - lastActivity > TIMEOUT_MS) {
                clearInterval(timeoutCheck);
                proc.kill();
                reject(new Error('Build timeout (30 minutes of inactivity)'));
            }
        }, 60000);

        proc.on('close', () => clearInterval(timeoutCheck));
    });
}

/**
 * Recursive file search
 */
async function findFileRecursive(dir, ext, maxDepth = 5, depth = 0) {
    if (depth > maxDepth) return null;
    try {
        const items = await fs.readdir(dir);
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = await fs.stat(itemPath);
            if (stat.isFile() && item.endsWith(ext)) return itemPath;
            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                const found = await findFileRecursive(itemPath, ext, maxDepth, depth + 1);
                if (found) return found;
            }
        }
    } catch (e) { }
    return null;
}

/**
 * Find APK file
 */
async function findApk(projectDir, buildType) {
    const possiblePaths = [
        path.join(projectDir, 'app', 'build', 'outputs', 'apk', buildType, `app-${buildType}.apk`),
        path.join(projectDir, 'build', 'outputs', 'apk', buildType, `app-${buildType}.apk`),
        path.join(projectDir, 'app', 'build', 'outputs', 'apk', buildType, 'app-debug.apk'),
        path.join(projectDir, 'build', 'outputs', 'apk', buildType, 'app-debug.apk'),
    ];

    for (const p of possiblePaths) {
        if (await fs.pathExists(p)) return p;
    }
    return await findFileRecursive(projectDir, '.apk');
}

/**
 * Build Flutter project
 * Priority: Use app name from AndroidManifest.xml
 */
async function buildFlutter(projectDir, buildType, onProgress) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '/root';
    
    // Extract app name first (prioritizes AndroidManifest.xml)
    const appName = await appNameExtractor.extractAppName(projectDir, 'flutter');
    onProgress(`📱 App name detected: ${appName}`);

    await validateAssets(projectDir, onProgress);
    await fixSettingsGradle(projectDir, onProgress);
    await fixBuildGradle(projectDir, onProgress);
    await fixAppBuildGradle(projectDir, onProgress);
    await fixIconDataExtends(projectDir, onProgress);

    onProgress('🗑️ Cleaning Gradle caches...');
    try {
        await runCommand('rm', ['-rf',
            `${homeDir}/.gradle/caches/transforms-3`,
            `${homeDir}/.gradle/caches/transforms-4`,
            `${homeDir}/.gradle/caches/modules-2/files-2.1/io.flutter`,
            `${projectDir}/.gradle`,
            `${projectDir}/android/.gradle`,
            `${projectDir}/build`,
            `${projectDir}/android/app/build`,
            `${projectDir}/android/build`
        ], projectDir).catch(() => { });
    } catch (e) { }

    onProgress('⚙️ Configuring Gradle properties...');
    const gradlePropsPath = path.join(projectDir, 'android', 'gradle.properties');
    try {
        let gradleProps = '';
        if (await fs.pathExists(gradlePropsPath)) {
            gradleProps = await fs.readFile(gradlePropsPath, 'utf8');
        }

        const propsToSet = {
            'org.gradle.jvmargs': '-Xmx2048m -XX:MaxMetaspaceSize=512m -XX:+UseParallelGC -Dfile.encoding=UTF-8',
            'android.useAndroidX': 'true',
            'android.enableJetifier': 'false',
            'org.gradle.daemon': 'false',
            'org.gradle.parallel': 'true',
            'org.gradle.caching': 'true',
            'org.gradle.workers.max': '2',
            'kotlin.compiler.execution.strategy': 'in-process'
        };

        for (const [key, value] of Object.entries(propsToSet)) {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(gradleProps)) {
                gradleProps = gradleProps.replace(regex, `${key}=${value}`);
            } else {
                gradleProps += `\n${key}=${value}`;
            }
        }
        await fs.writeFile(gradlePropsPath, gradleProps.trim() + '\n');
    } catch (e) { }

    onProgress('🧹 Running flutter clean...');
    await runCommand('flutter', ['clean'], projectDir).catch(() => { });

    onProgress('📦 Getting Flutter dependencies...');
    await runCommand('flutter', ['pub', 'get'], projectDir, onProgress);

    onProgress('🔨 Building Flutter APK (this may take a while)...');
    const buildArgs = buildType === 'release'
        ? ['build', 'apk', '--release', '--no-tree-shake-icons']
        : ['build', 'apk', '--debug'];

    let keepAliveStep = 0;
    const buildingMessages = [
        '🔨 Compiling Dart code...',
        '⚙️ Processing resources...',
        '📦 Packaging APK...',
        '🔧 Optimizing assets...',
        '🚀 Building native code...',
        '📱 Generating APK bundle...'
    ];

    const keepAliveInterval = setInterval(() => {
        keepAliveStep++;
        onProgress(buildingMessages[keepAliveStep % buildingMessages.length]);
    }, 15000);

    try {
        await runCommand('flutter', buildArgs, projectDir, (output) => {
            if (output && output.trim()) onProgress(output);
        });
    } catch (buildError) {
        clearInterval(keepAliveInterval);
        throw buildError;
    }

    clearInterval(keepAliveInterval);
    onProgress('✅ Build complete! Locating APK...');

    // Find and rename APK to use app name from AndroidManifest.xml
    const apkDir = path.join(projectDir, 'build', 'app', 'outputs', 'flutter-apk');
    const defaultApkName = buildType === 'release' ? 'app-release.apk' : 'app-debug.apk';
    const defaultApkPath = path.join(apkDir, defaultApkName);
    
    if (await fs.pathExists(defaultApkPath)) {
        const newApkName = `${appName}_${buildType}.apk`;
        const outputDir = path.join(__dirname, '..', '..', 'output');
        await fs.ensureDir(outputDir);
        const finalPath = path.join(outputDir, newApkName);
        await fs.copy(defaultApkPath, finalPath);
        onProgress(`📝 Renamed APK to: ${newApkName}`);
        return finalPath;
    }
    
    throw new Error('APK file not found after build');
}

/**
 * Build Android (Gradle) project
 */
async function buildAndroid(projectDir, buildType, onProgress) {
    const isWindows = process.platform === 'win32';
    const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
    const gradlePath = path.join(projectDir, gradleCmd);
    
    // Extract app name first
    const appName = await appNameExtractor.extractAppName(projectDir, 'android');
    onProgress(`📱 App name detected: ${appName}`);

    let useGlobalGradle = false;
    if (!await fs.pathExists(gradlePath)) {
        useGlobalGradle = true;
    } else if (!isWindows) {
        await fs.chmod(gradlePath, '755');
    }

    onProgress('🔨 Running Gradle build...');
    const buildTask = buildType === 'release' ? 'assembleRelease' : 'assembleDebug';
    const gradleFlags = [buildTask, '--no-daemon', '--build-cache', '--parallel', '--max-workers=2', '--stacktrace'];

    if (useGlobalGradle) {
        await runCommand('gradle', gradleFlags, projectDir);
    } else {
        await runCommand(gradlePath, gradleFlags, projectDir);
    }

    onProgress('📦 Locating APK file...');
    const apkPath = await findApk(projectDir, buildType);
    if (!apkPath) throw new Error('APK file not found after build');

    const newApkName = `${appName}_${buildType}.apk`;
    const outputDir = path.join(__dirname, '..', '..', 'output');
    await fs.ensureDir(outputDir);
    const finalPath = path.join(outputDir, newApkName);
    await fs.copy(apkPath, finalPath);
    
    onProgress(`📝 Renamed APK to: ${newApkName}`);
    return finalPath;
}

/**
 * Build APK from ZIP project
 */
async function buildFromZip(zipPath, projectType, buildType, onProgress) {
    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', '..', 'temp', jobId);
    let extractedAppName = null;

    try {
        onProgress('📂 Extracting project files...');
        const extractResult = await safeExtractZip(zipPath, tempDir);
        if (extractResult.sanitized) {
            onProgress('⚠️ Some filenames were sanitized during extraction');
        }

        const projectRoot = await findProjectRoot(tempDir, projectType);
        if (!projectRoot) {
            throw new Error(`Invalid ${projectType} project. Required files not found.`);
        }

        // Extract app name from project (prioritizes AndroidManifest.xml for Flutter)
        extractedAppName = await appNameExtractor.extractAppName(projectRoot, projectType);
        onProgress(`📱 App name detected: ${extractedAppName}`);

        let apkPath;
        if (projectType === 'flutter') {
            apkPath = await buildFlutter(projectRoot, buildType, onProgress);
        } else {
            apkPath = await buildAndroid(projectRoot, buildType, onProgress);
        }

        if (!apkPath || !await fs.pathExists(apkPath)) {
            throw new Error('APK file not found after build');
        }

        const finalFileName = path.basename(apkPath);
        onProgress(`✅ Build complete: ${finalFileName}`);

        await fs.remove(zipPath).catch(() => { });

        return {
            success: true,
            apkPath: apkPath,
            buildDir: tempDir,
            appName: extractedAppName,
            fileName: finalFileName
        };

    } catch (error) {
        await fs.remove(tempDir).catch(() => { });
        await fs.remove(zipPath).catch(() => { });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Analyze project
 */
async function analyzeProject(projectDir, projectType) {
    try {
        let output;
        if (projectType === 'flutter') {
            output = await runCommand('flutter', ['analyze', '--no-fatal-infos'], projectDir);
        } else {
            const isWindows = process.platform === 'win32';
            const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
            const gradlePath = path.join(projectDir, gradleCmd);
            if (!isWindows && await fs.pathExists(gradlePath)) await fs.chmod(gradlePath, '755');
            const cmd = await fs.pathExists(gradlePath) ? gradlePath : 'gradle';
            output = await runCommand(cmd, ['lint', '--no-daemon'], projectDir);
        }
        return { success: true, output };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Cleanup project
 */
async function cleanupProject(projectDir, projectType) {
    try {
        // Get size before
        const sizeBefore = await getDirectorySize(projectDir);

        let output;

        if (projectType === 'flutter') {
            output = await runCommand('flutter', ['clean'], projectDir);

            // Also remove .dart_tool and build folders
            await fs.remove(path.join(projectDir, '.dart_tool')).catch(() => { });
            await fs.remove(path.join(projectDir, 'build')).catch(() => { });
            await fs.remove(path.join(projectDir, '.flutter-plugins')).catch(() => { });
            await fs.remove(path.join(projectDir, '.flutter-plugins-dependencies')).catch(() => { });
        } else {
            const isWindows = process.platform === 'win32';
            const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';
            const gradlePath = path.join(projectDir, gradleCmd);

            if (!isWindows && await fs.pathExists(gradlePath)) {
                await fs.chmod(gradlePath, '755');
            }

            const cmd = await fs.pathExists(gradlePath) ? gradlePath : 'gradle';
            output = await runCommand(cmd, ['clean', '--no-daemon'], projectDir);

            // Also remove build folders
            await fs.remove(path.join(projectDir, 'build')).catch(() => { });
            await fs.remove(path.join(projectDir, 'app', 'build')).catch(() => { });
            await fs.remove(path.join(projectDir, '.gradle')).catch(() => { });
        }

        // Get size after
        const sizeAfter = await getDirectorySize(projectDir);

        return {
            success: true,
            output,
            sizeBefore,
            sizeAfter,
            savedBytes: sizeBefore - sizeAfter
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Get directory size
 */
async function getDirectorySize(dir) {
    let size = 0;
    try {
        const files = await fs.readdir(dir, { withFileTypes: true });
        for (const file of files) {
            const filePath = path.join(dir, file.name);
            if (file.isDirectory()) {
                size += await getDirectorySize(filePath);
            } else {
                const stat = await fs.stat(filePath);
                size += stat.size;
            }
        }
    } catch (e) {
        console.log(`[getDirectorySize] Error reading ${dir}: ${e.message}`);
    }
    return size;
}

module.exports = { buildFromZip, analyzeProject, cleanupProject, safeExtractZip };