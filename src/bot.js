require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs-extra');

// Handlers
const { handleStart } = require('./handlers/startHandler');
const { handleCallback, handleZipUpload, initQueueCallback } = require('./handlers/callbackHandler');
const { handleMessage } = require('./handlers/messageHandler');
const { getMainKeyboard, getConfirmKeyboard, getCancelKeyboard, getZipTypeKeyboard, getZipBuildTypeKeyboard } = require('./utils/keyboard');

// Utils
const { cleanupOldFiles } = require('./utils/cleanup');
const userService = require('./utils/userService');
const licenseKeyService = require('./utils/licenseKeyService');
const { downloadTelegramFile } = require('./utils/fileDownloader');
const { startWebServer, updateNotification } = require('./server');
const maintenanceService = require('./utils/maintenance');
const { isAdmin, isReseller } = require('./utils/permissions');
const resellerService = require('./utils/resellerService');

// Validate environment
if (!process.env.BOT_TOKEN) {
    console.error('❌ Error: BOT_TOKEN tidak ditemukan di .env');
    console.error('   Silakan copy .env.example ke .env dan isi token bot Anda');
    process.exit(1);
}

// Bot configuration with Local Bot API support
const botOptions = { polling: true };

// Use Local Bot API Server if configured
if (process.env.LOCAL_API_URL) {
    botOptions.baseApiUrl = process.env.LOCAL_API_URL;
    console.log(`🚀 Using Local Bot API Server: ${process.env.LOCAL_API_URL}`);
    console.log('   File limit: 2GB upload/download');
} else {
    console.log('ℹ️  Using standard Bot API (api.telegram.org)');
    console.log('   File limit: 20MB download, 50MB upload');
}

// Create bot instance
const bot = new TelegramBot(process.env.BOT_TOKEN, botOptions);

// Store user sessions
global.sessions = new Map();

// Ensure directories exist
const dirs = ['temp', 'output'];
dirs.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    fs.ensureDirSync(dirPath);
});

// Set bot commands menu
bot.setMyCommands([
    { command: 'start', description: '🏠 Mulai menggunakan bot' },
    { command: 'help', description: '❓ Bantuan & panduan' },
    { command: 'stats', description: '📊 Statistik bot (Admin)' },
    { command: 'broadcast', description: '📢 Broadcast pesan (Admin)' },
    { command: 'addcredit', description: 'addcredit userid,jumlah ( Ress & Owner )' },
    { command: 'addreseller', description: 'Add Reseller (Owner Only)' }
]).catch(e => console.error('Failed to set commands:', e.message));

// Initialize queue callback for auto-starting queued builds
initQueueCallback(bot);

// --- CHANNEL MEMBERSHIP CHECK ---
async function checkChannelMembership(userId) {
    const requiredChannels = process.env.REQUIRED_CHANNEL;
    if (!requiredChannels) return true; 
    const channelList = requiredChannels.split(',').map(ch => ch.trim()).filter(Boolean);
    
    if (channelList.length === 0) return true;

    try {
        for (const channel of channelList) {
            const channelName = channel.startsWith('@') ? channel : `@${channel}`;
            
            const member = await bot.getChatMember(channelName, userId);
            const status = member.status;
            
            if (!['member', 'administrator', 'creator'].includes(status)) {
                console.log(`User ${userId} not member of ${channelName}`);
                return false;
            }
        }
        
        return true;
    } catch (error) {
        console.warn(`Channel check failed for ${userId}:`, error.message);
        return false;
    }
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(chatId)) {
        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Bot gw off in dulu ya cuyyy.
Hanya <b>Owner</b> yang dapat mengakses saat ini.

<i>Mohon coba lagi nanti.</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    userService.saveUser(chatId, bot);

    const isMember = await checkChannelMembership(chatId);
    
    if (!isMember) {
        const requiredChannels = process.env.REQUIRED_CHANNEL || '';
        const channelList = requiredChannels.split(',').map(ch => ch.trim()).filter(Boolean);
        
        const inlineKeyboard = channelList.map(channel => {
            const channelName = channel.startsWith('@') ? channel.substring(1) : channel;
            return [{
                text: `Join @${channelName}`,
                url: `https://t.me/${channelName}`,
                style: "primary",
                icon_custom_emoji_id: "5215668805199473901", // ✅ FIX: typo diperbaiki
            }];
        });
        
        inlineKeyboard.push([{
            text: 'Sudah Join',
            callback_data: 'check_membership',
            style: "success",
            icon_custom_emoji_id: "5017470156276761427"
        }]);

        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>Verifikasi Diperlukan</b>

Silakan join channel-channel berikut terlebih dahulu:

${channelList.map(ch => ` ${ch.startsWith('@') ? ch : '@' + ch}`).join('\n')}

Setelah join semua channel, klik tombol "Sudah Join" atau tekan /start lagi.
        `.trim(), {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    }

    handleStart(bot, msg);
});

bot.on('callback_query', async (query) => {
    if (query.data === 'check_membership') {
        const chatId = query.message.chat.id;
        const isMember = await checkChannelMembership(chatId);
        
        if (isMember) {
            await bot.answerCallbackQuery(query.id, { text: '✅ Verifikasi berhasil!' });
            await bot.deleteMessage(chatId, query.message.message_id);
            handleStart(bot, query.message);
        } else {
            await bot.answerCallbackQuery(query.id, { 
                text: '❌ Anda belum join semua channel. Silakan join dulu.',
                show_alert: true 
            });
        }
    }
});
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;

    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(chatId)) {
        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Bot gw off in dulu ya cuyyy.
Hanya <b>Owner</b> yang dapat mengakses saat ini.

<i>Mohon coba lagi nanti.</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    userService.saveUser(chatId, bot);

    const isMember = await checkChannelMembership(chatId);
    
    if (!isMember) {
        const requiredChannels = process.env.REQUIRED_CHANNEL || '';
        const channelList = requiredChannels.split(',').map(ch => ch.trim()).filter(Boolean);
        
        const inlineKeyboard = channelList.map(channel => {
            const channelName = channel.startsWith('@') ? channel.substring(1) : channel;
            return [{
                text: `Join @${channelName}`,
                url: `https://t.me/${channelName}`,
                style: "primary",
                icon_custom_emoji_id: "5215668805199473901", // ✅ FIX: typo diperbaiki
            }];
        });
        
        inlineKeyboard.push([{
            text: 'Sudah Join',
            callback_data: 'check_membership',
            style: "success",
            icon_custom_emoji_id: "5017470156276761427"
        }]);

        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>Verifikasi Diperlukan</b>

Silakan join channel-channel berikut terlebih dahulu:

${channelList.map(ch => ` ${ch.startsWith('@') ? ch : '@' + ch}`).join('\n')}

Setelah join semua channel, klik tombol "Sudah Join" atau tekan /start lagi.
        `.trim(), {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            }
        });
    }

    handleStart(bot, msg);
});

// --- ADMIN: STATS COMMAND ---
bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    const stats = `
<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>BOT STATISTICS</b>
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5870695289714643076">👤</tg-emoji> Total Users: <code>${userService.getCount()}</code>
<tg-emoji emoji-id="5017470156276761427">🔄</tg-emoji> Active Sessions: <code>${global.sessions.size}</code>
<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> Uptime: <code>${Math.floor(process.uptime() / 60)} minutes</code>
━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.sendMessage(msg.chat.id, stats, { parse_mode: 'HTML' });
});

// --- UPLOAD TO LOCAL STORAGE COMMAND ---


bot.onText(/\/upload(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const creditService = require('./utils/creditService');
    const UPLOAD_COST = 2; // 2 credit per upload
    
    // Cek credit
    if (creditService.getBalance(chatId) < UPLOAD_COST) {
        const creditInfo = creditService.getCreditInfoMessage(chatId);
        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>CREDIT TIDAK CUKUP!</b>
━━━━━━━━━━━━━━━━━━

${creditInfo}

<tg-emoji emoji-id="5258477770735885832">📄</tg-emoji> <b>Biaya Upload:</b> ${UPLOAD_COST} credit
        `.trim(), { parse_mode: 'HTML' });
    }

    // Cek apakah reply ke file
    const replyToMsg = msg.reply_to_message;
    let fileToUpload = null;
    
    if (replyToMsg) {
        if (replyToMsg.document) {
            fileToUpload = {
                fileId: replyToMsg.document.file_id,
                fileName: replyToMsg.document.file_name || 'file.apk'
            };
        } else if (replyToMsg.video) {
            fileToUpload = {
                fileId: replyToMsg.video.file_id,
                fileName: replyToMsg.video.file_name || 'video.mp4'
            };
        } else if (replyToMsg.audio) {
            fileToUpload = {
                fileId: replyToMsg.audio.file_id,
                fileName: replyToMsg.audio.file_name || 'audio.mp3'
            };
        }
    }
    
    if (!fileToUpload) {
        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5258477770735885832">📄</tg-emoji> <b>UPLOAD TO LOCAL STORAGE</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Biaya:</b> ${UPLOAD_COST} credit
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Credit Anda:</b> ${creditService.getBalance(chatId)}

<b>Cara Penggunaan:</b>
Reply ke file APK dengan command:
<code>/upload</code>

<b>Contoh:</b>
Reply ke pesan yang berisi file APK, lalu ketik:
<code>/upload</code>

<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> <i>File akan tersimpan di server selama 24 jam</i>
<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <i>Link download akan dikirim setelah upload selesai</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    // Proses upload
    const statusMsg = await bot.sendMessage(chatId, `
<tg-emoji emoji-id="5445355530111437729">📤</tg-emoji> <b>Mengupload file...</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5215327832040811010">⏳</tg-emoji> Status: Mengunduh dari Telegram...
<tg-emoji emoji-id="6087023283356568182">🎁</tg-emoji> File: ${fileToUpload.fileName}
    `.trim(), { parse_mode: 'HTML' });

    try {
        // Download file dari Telegram
        const { downloadTelegramFile } = require('./utils/fileDownloader');
        const tempDir = path.join(__dirname, '..', 'temp', `upload_${Date.now()}`);
        await fs.ensureDir(tempDir);
        
        const downloadResult = await downloadTelegramFile(
            bot,
            fileToUpload.fileId,
            tempDir,
            fileToUpload.fileName
        );
        
        if (!downloadResult.success) {
            throw new Error(downloadResult.error);
        }

        // Update progress
        await bot.editMessageText(`
<tg-emoji emoji-id="5445355530111437729">📤</tg-emoji> <b>Mengupload file...</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5215327832040811010">⏳</tg-emoji> Status: Menyimpan ke server...
<tg-emoji emoji-id="6087023283356568182">🎁</tg-emoji> File: ${fileToUpload.fileName}
        `.trim(), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'HTML'
        });

        // Upload ke local storage
        const uploadResult = await localUploader.uploadFile(
            downloadResult.path,
            fileToUpload.fileName,
            chatId,
            24 // Expiry 24 jam
        );
        
        if (!uploadResult.success) {
            throw new Error(uploadResult.error);
        }

        // Kurangi credit
        const creditResult = creditService.useCredit(chatId, 'upload');

        // Kirim hasil
        await bot.editMessageText(`
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>UPLOAD BERHASIL!</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="6087023283356568182">🎁</tg-emoji> <b>File:</b> ${uploadResult.fileName}
<tg-emoji emoji-id="6087023283356568182">🎁</tg-emoji> <b>Ukuran:</b> ${uploadResult.sizeMB} MB
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Credit Digunakan:</b> ${UPLOAD_COST}
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Sisa Credit:</b> ${creditResult.remainingCredits}
<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> <b>Berlaku:</b> ${uploadResult.expiresIn}

<tg-emoji emoji-id="5271604874419647061">🔗</tg-emoji> <b>Link Download:</b>
<code>${uploadResult.url}</code>

<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Link akan expired setelah 24 jam</i>
        `.trim(), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 Download File', url: uploadResult.url }],
                    [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main', style: "default", icon_custom_emoji_id: "5258236805890710909" }]
                ]
            }
        });

        // Cleanup temp file
        await fs.remove(downloadResult.path).catch(() => {});
        await fs.remove(tempDir).catch(() => {});

    } catch (error) {
        console.error('Upload error:', error);
        await bot.editMessageText(`
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>UPLOAD GAGAL</b>
━━━━━━━━━━━━━━━━━━

<b>Error:</b>
<code>${error.message}</code>

<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Coba lagi nanti.</i>
        `.trim(), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    }
});
// --- ADMIN/RESELLER: ADD CREDITS COMMAND ---
bot.onText(/\/addcredit(?:\s+(.+))?/, async (msg, match) => {
    // Admin & Reseller Access
    if (!isAdmin(msg.chat.id) && !isReseller(msg.chat.id)) return;

    const input = match[1];
    if (!input) {
        return bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>ADD CREDITS</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/addcredit user_id,jumlah</code>

<b>Contoh:</b>
<code>/addcredit 123456789,10</code>
<code>/addcredit 987654321,25</code>

<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <i>Jumlah credit harus positif</i>
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <i>Setiap build menggunakan 1 credit</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    const parts = input.split(',').map(p => p.trim());
    if (parts.length !== 2) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Format salah! Gunakan: <code>/addcredit user_id,jumlah</code>', { parse_mode: 'HTML' });
    }

    const [userId, amountStr] = parts;
    const amount = parseInt(amountStr, 10);

    if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Jumlah credit harus berupa angka positif!', { parse_mode: 'HTML' });
    }

    const creditService = require('./utils/creditService');
    const result = creditService.addCredits(userId, amount, `Added by ${isAdmin(msg.chat.id) ? 'admin' : 'reseller'}`);

    if (result.success) {
        // Send confirmation to admin/reseller
        bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>CREDITS ADDED</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5258362837411045098">👤</tg-emoji> <b>User ID:</b> <code>${userId}</code>
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Added:</b> +${amount} credits
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>New Balance:</b> ${result.newBalance} credits

<tg-emoji emoji-id="5445355530111437729">📤</tg-emoji> <i>Mengirim notifikasi ke user...</i>
        `.trim(), { parse_mode: 'HTML' });

        // Notify the user
        try {
            await bot.sendMessage(userId, `
<tg-emoji emoji-id="5208541126583136130">🎉</tg-emoji> <b>CREDIT DITAMBAH!</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Credit Ditambahkan:</b> +${amount}
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Sisa Credit:</b> ${result.newBalance}

<tg-emoji emoji-id="5208541126583136130">🎉</tg-emoji> <i>Gunakan credit untuk build APK!</i>
<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Setiap build menggunakan 1 credit</i>
            `.trim(), { parse_mode: 'HTML' });
            
            bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Notifikasi berhasil dikirim ke user.`);
        } catch (sendError) {
            bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Gagal mengirim notifikasi: ${sendError.message}`);
        }
    } else {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ADMIN/RESELLER: CHECK CREDITS COMMAND ---
bot.onText(/\/checkcredit(?:\s+(.+))?/, async (msg, match) => {
    // Admin & Reseller Access
    if (!isAdmin(msg.chat.id) && !isReseller(msg.chat.id)) return;

    const userId = match[1]?.trim();
    
    if (!userId) {
        // Show own credit info if no ID provided
        const creditService = require('./utils/creditService');
        const creditInfo = creditService.getCreditInfoMessage(msg.chat.id);
        return bot.sendMessage(msg.chat.id, creditInfo, { parse_mode: 'HTML' });
    }

    const creditService = require('./utils/creditService');
    const userCredits = creditService.getUserCredits(userId);
    
    if (!userCredits) {
        return bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> User <code>${userId}</code> tidak ditemukan.`, { parse_mode: 'HTML' });
    }
    
    const message = `
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>CREDIT INFO - USER ${userId}</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Sisa Credit:</b> <code>${userCredits.credits}</code>
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Total Digunakan:</b> <code>${userCredits.totalSpent}</code>
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Total Diterima:</b> <code>${userCredits.totalEarned}</code>
<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> <b>Bergabung:</b> ${new Date(userCredits.createdAt).toLocaleDateString('id-ID')}

<tg-emoji emoji-id="5258477770735885832">📄</tg-emoji> <i>Topup gratis ${userCredits.daysUntilNextRefresh} hari lagi</i>
    `.trim();
    
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
});

// --- ADMIN: LIST ALL CREDITS ---
// --- ADMIN: LIST ALL CREDITS WITH PAGINATION ---
const CREDITS_PER_PAGE = 10;

bot.onText(/\/listcredit/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    await showCreditListPage(bot, msg.chat.id, 0);
});

// Handle listcredit pagination callbacks
bot.on('callback_query', async (query) => {
    if (query.data === 'listcredit_refresh') {
        if (!isAdmin(query.from.id)) {
            return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
        }
        await bot.answerCallbackQuery(query.id, { text: '🔄 Memuat ulang data...' });
        await showCreditListPage(bot, query.message.chat.id, 0, query.message.message_id);
        return;
    }
    
    if (query.data.startsWith('listcredit_page_')) {
        if (!isAdmin(query.from.id)) {
            return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
        }
        
        const page = parseInt(query.data.replace('listcredit_page_', ''), 10);
        await bot.answerCallbackQuery(query.id);
        await showCreditListPage(bot, query.message.chat.id, page, query.message.message_id);
        return;
    }
    
    if (query.data === 'listcredit_next') {
        if (!isAdmin(query.from.id)) {
            return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
        }
        
        const currentPage = parseInt(query.data.split('_')[2] || '0', 10);
        await bot.answerCallbackQuery(query.id);
        await showCreditListPage(bot, query.message.chat.id, currentPage + 1, query.message.message_id);
        return;
    }
    
    if (query.data === 'listcredit_prev') {
        if (!isAdmin(query.from.id)) {
            return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
        }
        
        const currentPage = parseInt(query.data.split('_')[2] || '0', 10);
        await bot.answerCallbackQuery(query.id);
        await showCreditListPage(bot, query.message.chat.id, currentPage - 1, query.message.message_id);
        return;
    }
});

async function showCreditListPage(bot, chatId, page, messageId = null) {
    const creditService = require('./utils/creditService');
    const users = creditService.listAllUsers();
    
    if (users.length === 0) {
        const emptyMsg = `
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>ALL USER CREDITS</b>
━━━━━━━━━━━━━━━━━━

<i>Belum ada user dengan credit.</i>

<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> User akan muncul setelah melakukan /start atau menerima credit.
        `.trim();
        
        if (messageId) {
            return bot.editMessageText(emptyMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        }
        return bot.sendMessage(chatId, emptyMsg, { parse_mode: 'HTML' });
    }
    
    const totalPages = Math.ceil(users.length / CREDITS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * CREDITS_PER_PAGE;
    const pageUsers = users.slice(startIdx, startIdx + CREDITS_PER_PAGE);
    
    // Calculate statistics
    const totalCredits = users.reduce((sum, u) => sum + u.credits, 0);
    const totalUsed = users.reduce((sum, u) => sum + u.totalSpent, 0);
    const activeUsers = users.filter(u => u.credits > 0).length;
    
    let message = `
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>ALL USER CREDITS</b> (${users.length})
━━━━━━━━━━━━━━━━━━
`;
    
    pageUsers.forEach((user, i) => {
        const creditIcon = user.credits > 0 ? '🟢' : '🔴';
        message += `
${startIdx + i + 1}. <b>User:</b> <code>${user.userId}</code>
   ${creditIcon} <b>Credits:</b> ${user.credits}
   <tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Used:</b> ${user.totalSpent}
   <tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Earned:</b> ${user.totalEarned}
`;
    });
    
    message += `
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Statistik:</b>
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> Total Credit: ${totalCredits}
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Total Used: ${totalUsed}
<tg-emoji emoji-id="5215685881989442149">🟢</tg-emoji> Active Users: ${activeUsers}
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> Halaman ${currentPage + 1}/${totalPages}
`;
    
    // Build pagination buttons
    const buttons = [];
    
    if (currentPage > 0) {
        buttons.push({ text: 'PREV', callback_data: `listcredit_page_${currentPage - 1}`, style: "default", icon_custom_emoji_id: "5258236805890710909" });
    }
    
    if (currentPage < totalPages - 1) {
        buttons.push({ text: 'NEXT', callback_data: `listcredit_page_${currentPage + 1}`, style: "default", icon_custom_emoji_id: "5215330331711775720" });
    }
    
    buttons.push({ text: 'Refresh', callback_data: 'listcredit_refresh', style: "default", icon_custom_emoji_id: "5017470156276761427" });
    
    const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
    
    if (messageId) {
        await bot.editMessageText(message.trim(), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, message.trim(), {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }
}

// --- ADMIN: RESET USER CREDITS ---
bot.onText(/\/resetcredit(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const userId = match[1]?.trim();
    if (!userId) {
        return bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5017470156276761427">🔄</tg-emoji> <b>RESET USER CREDITS</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/resetcredit user_id</code>

<b>Contoh:</b>
<code>/resetcredit 123456789</code>

<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <i>Merestart credit user menjadi 5</i>
        `.trim(), { parse_mode: 'HTML' });
    }
    
    const creditService = require('./utils/creditService');
    const result = creditService.resetUserCredits(userId);
    
    if (result.success) {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Credit user <code>${userId}</code> direset menjadi 5.`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ADMIN: FORCE WEEKLY REFRESH ---
bot.onText(/\/refreshcredits/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    
    const creditService = require('./utils/creditService');
    creditService.refreshWeeklyCredits();
    
    bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>WEEKLY CREDIT REFRESH</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Refresh credit mingguan telah dijalankan.

<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <i>Semua user mendapat +5 credit</i>
    `.trim(), { parse_mode: 'HTML' });
});

// --- CREDIT INFO COMMAND FOR USERS ---
bot.onText(/\/credit/, async (msg) => {
    const chatId = msg.chat.id;
    const creditService = require('./utils/creditService');
    const creditInfo = creditService.getCreditInfoMessage(chatId);
    bot.sendMessage(chatId, creditInfo, { parse_mode: 'HTML' });
});

bot.onText(/\/addreseller(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const input = match[1];
    if (!input) {
        return bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5870695289714643076">👤</tg-emoji> <b>ADD RESELLER</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/addreseller telegram_id,nama_reseller</code>

<b>Contoh:</b>
<code>/addreseller 123456789,BudiReseller</code>
        `.trim(), { parse_mode: 'HTML' });
    }

    const parts = input.split(',').map(p => p.trim());
    if (parts.length !== 2) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Format salah! Gunakan: <code>/addreseller id,nama</code>', { parse_mode: 'HTML' });
    }

    const [userId, name] = parts;

    if (isNaN(parseInt(userId, 10))) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> User ID harus berupa angka!', { parse_mode: 'HTML' });
    }

    const result = resellerService.addReseller(userId, name);

    if (result.success) {
        bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>RESELLER ADDED</b>
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5870695289714643076">👤</tg-emoji> User ID: <code>${userId}</code>
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> Name: <b>${name}</b>

<i>User tersebut sekarang dapat akses /addcredit dan tools lainnya.</i>
        `.trim(), { parse_mode: 'HTML' });

        // Notify the new reseller
        bot.sendMessage(userId, `
<tg-emoji emoji-id="5208541126583136130">🎉</tg-emoji> <b>Selamat! Anda telah diangkat menjadi Reseller.</b>

<b>Akses Anda:</b>
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Membuat License Key (/addcredit)
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Memperpanjang License Key (/extendkey)
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> Akses Project Tools (Analyze, Cleanup, Build ZIP)
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Hapus License Key (Hubungi Admin)
        `.trim(), { parse_mode: 'HTML' }).catch(() => { });

    } else {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// Delete Reseller
bot.onText(/\/delreseller(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const userId = match[1]?.trim();
    if (!userId) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Masukkan User ID reseller yang akan dihapus.', { parse_mode: 'HTML' });
    }

    const result = resellerService.removeReseller(userId);

    if (result.success) {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> User ID <code>${userId}</code> telah dihapus dari daftar reseller.`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// List Resellers
bot.onText(/\/listreseller/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    const resellers = resellerService.listResellers();

    if (resellers.length === 0) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> Belum ada reseller terdaftar.', { parse_mode: 'HTML' });
    }

    let message = `
<tg-emoji emoji-id="5870695289714643076">👤</tg-emoji> <b>DAFTAR RESELLER</b> (${resellers.length})
━━━━━━━━━━━━━━━━━━
`;

    resellers.forEach((r, i) => {
        message += `
${i + 1}. <b>${r.name}</b>
   ID: <code>${r.id}</code>
   Sejak: ${new Date(r.createdAt).toLocaleDateString('id-ID')}
`;
    });

    bot.sendMessage(msg.chat.id, message.trim(), { parse_mode: 'HTML' });
});

const KEYS_PER_PAGE = 10;

bot.onText(/\/listkey/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;
    await showLicenseKeyPage(bot, msg.chat.id, 0);
});

// Handle listkey pagination callbacks
bot.on('callback_query', async (query) => {
    if (query.data === 'listkey_refresh') {
        if (!isAdmin(query.from.id)) {
            return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
        }
        await bot.answerCallbackQuery(query.id, { text: '🔄 Memuat ulang data...' });
        await showLicenseKeyPage(bot, query.message.chat.id, 0, query.message.message_id);
        return;
    }
    
    if (!query.data.startsWith('listkey_page_')) return;
    if (!isAdmin(query.from.id)) {
        return bot.answerCallbackQuery(query.id, { text: '⛔ Akses ditolak' });
    }

    const page = parseInt(query.data.replace('listkey_page_', ''), 10);
    await bot.answerCallbackQuery(query.id);
    await showLicenseKeyPage(bot, query.message.chat.id, page, query.message.message_id);
});

async function showLicenseKeyPage(bot, chatId, page, messageId = null) {
    const keys = licenseKeyService.listKeys();

    if (keys.length === 0) {
        const emptyMsg = `
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>LICENSE KEYS</b>
━━━━━━━━━━━━━━━━━━

<i>Belum ada license key.</i>

<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> Gunakan <code>/addcredit userid,hari,telegram_id</code> untuk membuat key baru.
        `.trim();

        if (messageId) {
            return bot.editMessageText(emptyMsg, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' });
        }
        return bot.sendMessage(chatId, emptyMsg, { parse_mode: 'HTML' });
    }

    const totalPages = Math.ceil(keys.length / KEYS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * KEYS_PER_PAGE;
    const pageKeys = keys.slice(startIdx, startIdx + KEYS_PER_PAGE);
    
    // Hitung statistik
    const activeCount = keys.filter(k => !k.isExpired && k.deviceId).length;
    const unusedCount = keys.filter(k => !k.isExpired && !k.deviceId).length;
    const expiredCount = keys.filter(k => k.isExpired).length;

    let message = `
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>LICENSE KEYS</b> (${keys.length})
━━━━━━━━━━━━━━━━━━
`;

    pageKeys.forEach((k, i) => {
        const status = k.isExpired ? '<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Expired' : (k.deviceId ? '<tg-emoji emoji-id="5215685881989442149">🟢</tg-emoji> Active' : '<tg-emoji emoji-id="5215301689881804379">🟡</tg-emoji> Unused');
        message += `
${startIdx + i + 1}. <b>${k.username}</b>
   <tg-emoji emoji-id="5420094143089111506">🗝</tg-emoji> <code>${k.key}</code>
   ${status} ${!k.isExpired ? `(${k.daysLeft} hari lagi)` : ''}
   <tg-emoji emoji-id="5408885489627315489">📱</tg-emoji> ${k.deviceId ? `Device: <code>${k.deviceId.substring(0, 12)}...</code>` : 'Belum login'}
   <tg-emoji emoji-id="5408885489627315489">📱</tg-emoji> Telegram: ${k.telegramId ? `<code>${k.telegramId}</code>` : '<i>Tidak ada</i>'}
`;
    });

    message += `
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> Halaman ${currentPage + 1}/${totalPages}
<tg-emoji emoji-id="5258130763148172425">🗑</tg-emoji> <code>/delkey username</code> untuk hapus
<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <code>/extendkey user,hari</code> untuk perpanjang
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Statistik:</b>
🟢 Active: ${activeCount} | 🟡 Unused: ${unusedCount} | ⚠️ Expired: ${expiredCount}
`;

    // Build pagination buttons
    const buttons = [];
    if (currentPage > 0) {
        buttons.push({ text: 'Prev', callback_data: `listkey_page_${currentPage - 1}`, style: "danger", icon_custom_emoji_id: "5258236805890710909" });
    }
    if (currentPage < totalPages - 1) {
        buttons.push({ text: 'Next', callback_data: `listkey_page_${currentPage + 1}`, style: "success", icon_custom_emoji_id: "5215330331711775720" });
    }
    buttons.push({ text: 'Refresh', callback_data: 'listkey_refresh', style: "primary", icon_custom_emoji_id: "5017470156276761427" });

    const keyboard = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;

    if (messageId) {
        await bot.editMessageText(message.trim(), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, message.trim(), {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
    }
}

// --- ADMIN: DELETE LICENSE KEY ---
bot.onText(/\/delkey(?:\s+(.+))?/, async (msg, match) => {
    // Strict Admin Access (Resellers cannot delete keys)
    if (!isAdmin(msg.chat.id)) return;

    const username = match[1]?.trim();
    if (!username) {
        return bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5258130763148172425">🗑</tg-emoji> <b>DELETE LICENSE KEY</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/delkey username</code>

<b>Contoh:</b>
<code>/delkey john</code>
        `.trim(), { parse_mode: 'HTML' });
    }

    const result = licenseKeyService.deleteKey(username);

    if (result.success) {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> License key untuk <b>${result.username}</b> berhasil dihapus.`, { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ADMIN: EXTEND LICENSE KEY ---
bot.onText(/\/extendkey(?:\s+(.+))?/, async (msg, match) => {
    // Admin & Reseller Access
    if (!isAdmin(msg.chat.id) && !isReseller(msg.chat.id)) return;

    const input = match[1];
    if (!input) {
        return bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>EXTEND LICENSE KEY</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/extendkey username,hari</code>

<b>Contoh:</b>
<code>/extendkey john,30</code>
<code>/extendkey user123,7</code>

<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Menambah masa aktif key (1-365 hari)</i>
<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Jika key sudah expired, akan dihitung dari hari ini</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    const parts = input.split(',').map(p => p.trim());
    if (parts.length !== 2) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Format salah! Gunakan: <code>/extendkey username,hari</code>', { parse_mode: 'HTML' });
    }

    const [username, daysStr] = parts;
    const days = parseInt(daysStr, 10);

    if (isNaN(days)) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Jumlah hari harus berupa angka!', { parse_mode: 'HTML' });
    }

    const result = licenseKeyService.extendKey(username, days);

    if (result.success) {
        const newExpireDate = new Date(result.newExpiresAt).toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const prevExpireDate = new Date(result.previousExpires).toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>LICENSE KEY EXTENDED</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5258011929993026890">👤</tg-emoji> <b>Username:</b> <code>${result.username}</code>
➕ <b>Ditambah:</b> ${result.addedDays} hari

<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>Sebelum:</b> ${prevExpireDate}${result.wasExpired ? ' (EXPIRED)' : ''}
<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>Sesudah:</b> ${newExpireDate}

${result.wasExpired ? '<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Key expired telah diaktifkan kembali!</i>' : ''}
        `.trim(), { parse_mode: 'HTML' });
    } else {
        bot.sendMessage(msg.chat.id, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Gagal:</b> ${result.error}`, { parse_mode: 'HTML' });
    }
});

// --- ANALYZE PROJECT COMMAND ---
bot.onText(/\/analyze(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    const projectType = match[1]?.toLowerCase();

    if (!projectType || !['flutter', 'android'].includes(projectType)) {
        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5429419796988970289">🔍</tg-emoji> <b>ANALYZE PROJECT</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/analyze flutter</code> - Untuk project Flutter
<code>/analyze android</code> - Untuk project Android

<b>Langkah:</b>
1. Kirim command di atas
2. Upload file ZIP project anda
3. Tunggu hasil analisis

<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <i>Akan menjalankan flutter analyze atau gradle lint</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    // Set session for file upload
    global.sessions.set(chatId, {
        step: 'analyze_upload',
        projectType: projectType,
        createdAt: Date.now()
    });

    bot.sendMessage(chatId, `
<tg-emoji emoji-id="5445355530111437729">📤</tg-emoji> <b>Upload Project ZIP</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5818955300463447293">🗂</tg-emoji> <b>Tipe:</b> ${projectType.toUpperCase()}
<tg-emoji emoji-id="5429419796988970289">🔍</tg-emoji> <b>Mode:</b> Analyze

Kirim file <b>.zip</b> project anda sekarang.

<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> <i>Menunggu file... (timeout: 30 menit)</i>
    `.trim(), { parse_mode: 'HTML' });

    setTimeout(() => {
        const session = global.sessions.get(chatId);
        if (session?.step === 'analyze_upload') {
            global.sessions.delete(chatId);
            bot.sendMessage(chatId, '<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> Timeout! Silakan kirim /analyze lagi.');
        }
    }, 30 * 60 * 1000);
});

bot.onText(/\/cleanup(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;

    const projectType = match[1]?.toLowerCase();

    if (!projectType || !['flutter', 'android'].includes(projectType)) {
        return bot.sendMessage(chatId, `
🧹 <b>CLEANUP PROJECT</b>
━━━━━━━━━━━━━━━━━━

<b>Penggunaan:</b>
<code>/cleanup flutter</code> - Untuk project Flutter
<code>/cleanup android</code> - Untuk project Android

<b>Langkah:</b>
1. Kirim command di atas
2. Upload file ZIP project anda
3. Dapatkan project yang sudah bersih

💡 <i>Akan menghapus cache & build files</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    global.sessions.set(chatId, {
        step: 'cleanup_upload',
        projectType: projectType,
        createdAt: Date.now()
    });

    bot.sendMessage(chatId, `
📤 <b>Upload Project ZIP</b>
━━━━━━━━━━━━━━━━━━

📁 <b>Tipe:</b> ${projectType.toUpperCase()}
🧹 <b>Mode:</b> Cleanup

Kirim file <b>.zip</b> project anda sekarang.

⏱ <i>Menunggu file... (timeout: 30 menit)</i>
    `.trim(), { parse_mode: 'HTML' });

    setTimeout(() => {
        const session = global.sessions.get(chatId);
        if (session?.step === 'cleanup_upload') {
            global.sessions.delete(chatId);
            bot.sendMessage(chatId, '⏰ Timeout! Silakan kirim /cleanup lagi.');
        }
    }, 30 * 60 * 1000);
});

// --- BROADCAST COMMAND (ALL USERS WITH CREDIT & DAILY LIMIT) ---
bot.onText(/\/broadcast(?: (.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const textContent = match[1];
    const isReply = msg.reply_to_message;

    if (!isReply && !textContent) {
        return bot.sendMessage(msg.chat.id, `
╔══════════════════════════╗
     <tg-emoji emoji-id="5215668805199473901">📣</tg-emoji>  <b>BROADCAST CENTER</b>  <tg-emoji emoji-id="5215668805199473901">📣</tg-emoji>
╚══════════════════════════╝

<b><tg-emoji emoji-id="5226512880362332956">📖</tg-emoji> Cara Penggunaan:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>Text Broadcast:</b>
<code>/broadcast &lt;pesan anda&gt;</code>

<b>Forward Message:</b>
Reply pesan apapun dengan <code>/broadcast</code>

<b>Rich Format (HTML):</b>
<code>/broadcast &lt;b&gt;Bold&lt;/b&gt; &lt;i&gt;Italic&lt;/i&gt;</code>

━━━━━━━━━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> Total Users: <code>${userService.getCount()}</code>
        `.trim(), { parse_mode: 'HTML' });
    }

    const users = userService.getBroadcastList();
    const totalUsers = users.length;
    const estimatedTime = Math.ceil(totalUsers * 0.05); // 50ms per user

    // Confirmation message
    const confirmMsg = await bot.sendMessage(msg.chat.id, `
╔══════════════════════════╗
   <tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji>  <b>KONFIRMASI BROADCAST</b>  <tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji>
╚══════════════════════════╝

<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Statistik:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> Target: <code>${totalUsers}</code> users
<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> Estimasi: <code>~${estimatedTime}</code> detik
<tg-emoji emoji-id="5330237710655306682">📱</tg-emoji> Tipe: ${isReply ? 'Forward Message' : 'Text Message'}

<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>Preview:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${isReply ? ' <i>(Forward dari pesan yang di-reply)</i>' : textContent?.substring(0, 200) + (textContent?.length > 200 ? '...' : '')}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>Klik tombol untuk melanjutkan...</i>
    `.trim(), {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Mulai Broadcast', callback_data: 'bc_confirm', style: "success", icon_emoji_custom_id: "5206607081334906820" },
                    { text: 'Batal', callback_data: 'bc_cancel', style: "danger", icon_custom_emoji_id: "6084880262179588505" }
                ]
            ]
        }
    });

    // Store broadcast data temporarily
    global.pendingBroadcast = {
        adminId: msg.chat.id,
        confirmMsgId: confirmMsg.message_id,
        isReply,
        textContent,
        replyMsgId: isReply ? msg.reply_to_message.message_id : null,
        users,
        timestamp: Date.now()
    };
});

// Handle broadcast confirmation
bot.on('callback_query', async (query) => {
    if (!query.data.startsWith('bc_')) return;
    if (!isAdmin(query.from.id)) return;

    const action = query.data;
    const bc = global.pendingBroadcast;

    if (!bc || bc.adminId !== query.from.id) {
        return bot.answerCallbackQuery(query.id, { text: '⚠️ Session expired', show_alert: true });
    }

    if (action === 'bc_cancel') {
        await bot.editMessageText('<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Broadcast dibatalkan.</b>', {
            chat_id: bc.adminId,
            message_id: bc.confirmMsgId,
            parse_mode: 'HTML'
        });
        global.pendingBroadcast = null;
        return bot.answerCallbackQuery(query.id);
    }

    if (action === 'bc_confirm') {
        await bot.answerCallbackQuery(query.id, { text: '<tg-emoji emoji-id="5213452215527677338">⏳</tg-emoji> Memulai broadcast...' });

        const startTime = Date.now();
        let success = 0, failed = 0;
        const total = bc.users.length;

        // Progress bar function
        const getProgressBar = (current, total) => {
            const percent = Math.round((current / total) * 100);
            const filled = Math.round(percent / 5);
            const empty = 20 - filled;
            return '█'.repeat(filled) + '░'.repeat(empty);
        };

        // Initial progress message
        await bot.editMessageText(`
╔══════════════════════════╗
   <tg-emoji emoji-id="5445284980978621387">🚀</tg-emoji>  <b>BROADCAST IN PROGRESS</b>  <tg-emoji emoji-id="5445284980978621387">🚀</tg-emoji>
╚══════════════════════════╝

<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Progress:</b>
<code>[${getProgressBar(0, total)}]</code> 0%

<tg-emoji emoji-id="5472107610087889157">📭</tg-emoji> Sent: <code>0</code>
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Failed: <code>0</code>
<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> Total: <code>${total}</code>

<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> Elapsed: <code>0s</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>⏳ Mohon tunggu...</i>
        `.trim(), {
            chat_id: bc.adminId,
            message_id: bc.confirmMsgId,
            parse_mode: 'HTML'
        });

        let lastUpdate = 0;

        for (let i = 0; i < bc.users.length; i++) {
            const userId = bc.users[i];

            try {
                if (bc.isReply) {
                    // For forwarded messages, send header first then forward
                    await bot.sendMessage(userId, `
╔═══════════════════════════════╗
     <tg-emoji emoji-id="5215668805199473901">📣</tg-emoji>  <b>PENGUMUMAN RESMI</b>  <tg-emoji emoji-id="5215668805199473901">📣</tg-emoji>
╚═══════════════════════════════╝
`, { parse_mode: 'HTML' });
                    await bot.forwardMessage(userId, bc.adminId, bc.replyMsgId);
                } else {
                    // For text messages, wrap in professional template
                    const formattedMessage = `
╔═══════════════════════════════╗
     <tg-emoji emoji-id="5215668805199473901">📣</tg-emoji>  <b>PENGUMUMAN RESMI</b>  <tg-emoji emoji-id="5215668805199473901">📣</tg-emoji>
╚═══════════════════════════════╝

${bc.textContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5339267587337370029">😉</tg-emoji> <i>Pesan otomatis dari Web2APK Bot</i>
<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <i>${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</i>
`.trim();
                    await bot.sendMessage(userId, formattedMessage, { parse_mode: 'HTML' });
                }
                success++;
            } catch (e) {
                failed++;
                if (e.response?.body?.error_code === 403) {
                    userService.removeUser(userId);
                }
            }

            // Update progress every 10 users or at the end
            const current = i + 1;
            if (current - lastUpdate >= 10 || current === total) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                const percent = Math.round((current / total) * 100);

                await bot.editMessageText(`
╔══════════════════════════╗
   <tg-emoji emoji-id="5445284980978621387">🚀</tg-emoji>  <b>BROADCAST IN PROGRESS</b>  <tg-emoji emoji-id="5445284980978621387">🚀</tg-emoji>
╚══════════════════════════╝

<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Progress:</b>
<code>[${getProgressBar(current, total)}]</code> ${percent}%

<tg-emoji emoji-id="5472107610087889157">📭</tg-emoji> Sent: <code>${success}</code>
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Failed: <code>${failed}</code>
<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> Total: <code>${total}</code>

<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> Elapsed: <code>${elapsed}s</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<i>⏳ ${current}/${total} processed...</i>
                `.trim(), {
                    chat_id: bc.adminId,
                    message_id: bc.confirmMsgId,
                    parse_mode: 'HTML'
                }).catch(() => { });

                lastUpdate = current;
            }

            await new Promise(r => setTimeout(r, 50));
        }

        const totalTime = Math.round((Date.now() - startTime) / 1000);
        const successRate = Math.round((success / total) * 100);

        // Final result
        await bot.editMessageText(`
╔══════════════════════════╗
   <tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji>  <b>BROADCAST COMPLETE</b>  <tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji>
╚══════════════════════════╝

<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> <b>Final Result:</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━
<code>[████████████████████]</code> 100%

<tg-emoji emoji-id="5472107610087889157">📭</tg-emoji> Sent: <code>${success}</code> ✓
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Failed: <code>${failed}</code>
<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Success Rate: <code>${successRate}%</code>

<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> Total Time: <code>${totalTime}s</code>
<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> Completed: <code>${new Date().toLocaleString('id-ID')}</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━
${failed > 0 ? `\n<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <i>${failed} users telah dihapus (blocked/deleted)</i>` : '<tg-emoji emoji-id="5208541126583136130">🎉</tg-emoji> <i>Semua pesan terkirim dengan sukses!</i>'}
        `.trim(), {
            chat_id: bc.adminId,
            message_id: bc.confirmMsgId,
            parse_mode: 'HTML'
        });

        global.pendingBroadcast = null;
    }
});

// Callback query handler (for inline buttons)
bot.on('callback_query', (query) => {
    // Save user on any interaction
    userService.saveUser(query.from.id, bot);
    handleCallback(bot, query);
});

// Photo handler (for custom icon)
bot.on('photo', (msg) => {
    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(msg.chat.id)) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>MAINTENANCE MODE:</b> Upload foto tidak aktif.', { parse_mode: 'HTML' });
    }
    handleMessage(bot, msg, 'photo');
});

// Document handler (for ZIP file uploads)
// With Local Bot API Server, files up to 2GB are supported!
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;

    // Maintenance Check
    if (maintenanceService.isEnabled() && !isAdmin(chatId)) {
        return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Upload file dinonaktifkan sementara.
        `.trim(), { parse_mode: 'HTML' });
    }

    const document = msg.document;

    // Check if it's a ZIP file
    if (document.file_name?.endsWith('.zip')) {
        const session = global.sessions.get(chatId);

        // Handle different upload modes
        if (session?.step === 'zip_upload' || session?.step === 'analyze_upload' || session?.step === 'cleanup_upload') {
            const fileSize = document.file_size || 0;
            const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

            // Check file size limit based on API type
            const MAX_SIZE = process.env.LOCAL_API_URL
                ? 2 * 1024 * 1024 * 1024  // 2GB with Local Bot API
                : 20 * 1024 * 1024;        // 20MB with standard Bot API

            if (fileSize > MAX_SIZE) {
                const limitMB = process.env.LOCAL_API_URL ? '2048' : '20';
                return bot.sendMessage(chatId, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>File Terlalu Besar!</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="6087023283356568182">🎁</tg-emoji> <b>Ukuran:</b> ${fileSizeMB} MB
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>Batas:</b> ${limitMB} MB

${!process.env.LOCAL_API_URL ? `
<tg-emoji emoji-id="5954136131929902524">🚨</tg-emoji> <b>Untuk file lebih besar:</b>
Setup Local Bot API Server untuk limit 2GB!
<code>sudo ./scripts/setup-local-api.sh API_ID API_HASH</code>
` : ''}
                `.trim(), { parse_mode: 'HTML' });
            }

            try {
                console.log(`📥 Downloading file (${fileSizeMB} MB)...`);
                console.log(`   File ID: ${document.file_id}`);
                console.log(`   Mode: ${session.step}`);

                // Use custom downloader that works with Local Bot API
                const fileName = document.file_name || `file_${Date.now()}.zip`;
                const result = await downloadTelegramFile(
                    bot,
                    document.file_id,
                    path.join(__dirname, '..', 'temp'),
                    fileName
                );

                if (!result.success) {
                    return bot.sendMessage(chatId, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Gagal mengunduh file: ${result.error}`);
                }

                console.log(`✅ File downloaded: ${result.path}`);

                // Route based on session step
                if (session.step === 'zip_upload') {
                    await handleZipUpload(bot, chatId, result.path);
                } else if (session.step === 'analyze_upload') {
                    await handleAnalyzeUpload(bot, chatId, result.path, session.projectType);
                } else if (session.step === 'cleanup_upload') {
                    await handleCleanupUpload(bot, chatId, result.path, session.projectType);
                }

            } catch (error) {
                console.error('Error downloading ZIP:', error);
                bot.sendMessage(chatId, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Gagal mengunduh file: ${error.message}`);
            }
        } else {
            bot.sendMessage(chatId, '<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Untuk menggunakan file ZIP, kirim salah satu command:\n• /analyze flutter\n• /analyze android\n• /cleanup flutter\n• /cleanup android\n• Atau klik tombol BUILD PROJECT (ZIP)');
        }
    }
});

// --- ANALYZE UPLOAD HANDLER ---
async function handleAnalyzeUpload(bot, chatId, zipPath, projectType) {
    const { analyzeProject, safeExtractZip } = require('./builder/zipBuilder');
    const { v4: uuidv4 } = require('uuid');

    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp', 'analyze-' + jobId);

    try {
        const statusMsg = await bot.sendMessage(chatId, `
<tg-emoji emoji-id="5429419796988970289">🔎</tg-emoji> <b>ANALYZING PROJECT</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5818955300463447293">🗂</tg-emoji> Tipe: ${projectType.toUpperCase()}
<tg-emoji emoji-id="5215327832040811010">⏳</tg-emoji> Status: Mengekstrak file...
        `.trim(), { parse_mode: 'HTML' });

        // Extract ZIP using safe extraction (handles invalid filenames)
        const extractResult = await safeExtractZip(zipPath, tempDir);

        let statusText = 'Menjalankan analyze...';
        if (extractResult.sanitized) {
            statusText = 'Beberapa nama file disanitasi. Menjalankan analyze...';
        }

        await bot.editMessageText(`
<tg-emoji emoji-id="5429419796988970289">🔎</tg-emoji> <b>ANALYZING PROJECT</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5818955300463447293">🗂</tg-emoji> Tipe: ${projectType.toUpperCase()}
<tg-emoji emoji-id="5215327832040811010">⏳</tg-emoji> Status: ${statusText}
        `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

        // Find project root
        const targetFile = projectType === 'flutter' ? 'pubspec.yaml' : 'build.gradle';
        let projectRoot = tempDir;

        if (!await fs.pathExists(path.join(tempDir, targetFile))) {
            const items = await fs.readdir(tempDir);
            for (const item of items) {
                const itemPath = path.join(tempDir, item);
                if ((await fs.stat(itemPath)).isDirectory()) {
                    if (await fs.pathExists(path.join(itemPath, targetFile))) {
                        projectRoot = itemPath;
                        break;
                    }
                }
            }
        }

        const result = await analyzeProject(projectRoot, projectType);

        // Save log file
        const logDir = path.join(__dirname, '..', 'logs', 'tools');
        await fs.ensureDir(logDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFileName = `analyze_${projectType}_${timestamp}.txt`;
        const logFilePath = path.join(logDir, logFileName);

        const logContent = `=== PROJECT ANALYZE LOG ===
Date: ${new Date().toLocaleString('id-ID')}
Project Type: ${projectType}
Status: ${result.success ? 'SUCCESS' : 'FAILED'}

=== OUTPUT ===
${result.output || result.error || 'No output'}
`;
        await fs.writeFile(logFilePath, logContent);

        // Send result
        if (result.success) {
            await bot.editMessageText(`
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>ANALYZE COMPLETE</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5818955300463447293">🗂</tg-emoji> Tipe: ${projectType.toUpperCase()}
<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Status: Berhasil

<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>Hasil telah dikirim sebagai file.</b>
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        } else {
            await bot.editMessageText(`
<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> <b>ANALYZE FAILED</b>
━━━━━━━━━━━━━━━━━━

<tg-emoji emoji-id="5818955300463447293">🗂</tg-emoji> Tipe: ${projectType.toUpperCase()}
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> Error: ${result.error || 'Unknown error'}

<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>Log telah dikirim sebagai file.</b>
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        }

        // Send log file
        await bot.sendDocument(chatId, logFilePath, {
            caption: `<tg-emoji emoji-id="5231200819986047254">📊</tg-emoji> Analyze Log - ${projectType.toUpperCase()}`
        });

    } catch (error) {
        bot.sendMessage(chatId, `<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Analyze gagal: ${error.message}`);
    } finally {
        global.sessions.delete(chatId);
        await fs.remove(zipPath).catch(() => { });
        await fs.remove(tempDir).catch(() => { });
    }
}

// --- CLEANUP UPLOAD HANDLER ---
async function handleCleanupUpload(bot, chatId, zipPath, projectType) {
    const { cleanupProject, safeExtractZip } = require('./builder/zipBuilder');
    const archiver = require('archiver');
    const { v4: uuidv4 } = require('uuid');

    const jobId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp', 'cleanup-' + jobId);
    const outputZipPath = path.join(__dirname, '..', 'temp', `cleaned-${jobId}.zip`);

    try {
        const statusMsg = await bot.sendMessage(chatId, `
🧹 <b>CLEANING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: Mengekstrak file...
        `.trim(), { parse_mode: 'HTML' });

        // Extract ZIP using safe extraction (handles invalid filenames)
        const extractResult = await safeExtractZip(zipPath, tempDir);

        let statusText = 'Menjalankan cleanup...';
        if (extractResult.sanitized) {
            statusText = 'Beberapa nama file disanitasi. Menjalankan cleanup...';
        }

        await bot.editMessageText(`
🧹 <b>CLEANING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: ${statusText}
        `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

        // Find project root
        const targetFile = projectType === 'flutter' ? 'pubspec.yaml' : 'build.gradle';
        let projectRoot = tempDir;

        if (!await fs.pathExists(path.join(tempDir, targetFile))) {
            const items = await fs.readdir(tempDir);
            for (const item of items) {
                const itemPath = path.join(tempDir, item);
                if ((await fs.stat(itemPath)).isDirectory()) {
                    if (await fs.pathExists(path.join(itemPath, targetFile))) {
                        projectRoot = itemPath;
                        break;
                    }
                }
            }
        }

        const result = await cleanupProject(projectRoot, projectType);

        if (result.success) {
            await bot.editMessageText(`
🧹 <b>CLEANING PROJECT</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⏳ Status: Mengompres hasil...
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

            // Re-zip the cleaned project
            const output = fs.createWriteStream(outputZipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                archive.on('error', reject);
                archive.pipe(output);
                archive.directory(projectRoot, false);
                archive.finalize();
            });

            const sizeSavedMB = ((result.savedBytes || 0) / (1024 * 1024)).toFixed(2);
            const sizeBeforeMB = ((result.sizeBefore || 0) / (1024 * 1024)).toFixed(2);
            const sizeAfterMB = ((result.sizeAfter || 0) / (1024 * 1024)).toFixed(2);

            await bot.editMessageText(`
✅ <b>CLEANUP COMPLETE</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
📊 Before: ${sizeBeforeMB} MB
📊 After: ${sizeAfterMB} MB
💾 Saved: ${sizeSavedMB} MB

📥 <b>Mengirim file...</b>
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });

            // Send cleaned ZIP
            await bot.sendDocument(chatId, outputZipPath, {
                caption: `📦 Cleaned Project\n\n📊 Before: ${sizeBeforeMB} MB\n📊 After: ${sizeAfterMB} MB\n💾 Saved: ${sizeSavedMB} MB`
            });

        } else {
            await bot.editMessageText(`
❌ <b>CLEANUP FAILED</b>
━━━━━━━━━━━━━━━━━━

📁 Tipe: ${projectType.toUpperCase()}
⚠️ Error: ${result.error || 'Unknown error'}
            `.trim(), { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'HTML' });
        }

    } catch (error) {
        bot.sendMessage(chatId, `❌ Cleanup gagal: ${error.message}`);
    } finally {
        global.sessions.delete(chatId);
        await fs.remove(zipPath).catch(() => { });
        await fs.remove(tempDir).catch(() => { });
        await fs.remove(outputZipPath).catch(() => { });
    }
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
    console.error('Bot error:', error.message);
});

// Cleanup scheduler (every 15 minutes for old files)
setInterval(() => {
    cleanupOldFiles(path.join(__dirname, '..', 'temp'), 30); // 15 min max age
    cleanupOldFiles(path.join(__dirname, '..', 'output'), 30);
}, 30 * 60 * 1000);

// Cleanup on startup - remove any leftover temp files from previous sessions
(async () => {
    console.log('🗑️ Cleaning up leftover temp files...');
    await cleanupOldFiles(path.join(__dirname, '..', 'temp'), 1); // Anything > 1 min old
    await cleanupOldFiles(path.join(__dirname, '..', 'output'), 1);
    console.log('✅ Startup cleanup complete');
})();

console.log('🤖 Web2APK Bot berhasil dijalankan!');
console.log(`   Total users: ${userService.getCount()} `);
console.log('   Tekan Ctrl+C untuk menghentikan bot');

// --- ADMIN: NOTIFICATION COMMAND ---
bot.onText(/\/notif(?: (.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const text = match[1];
    if (!text) {
        return bot.sendMessage(msg.chat.id, '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> Gunakan format: <code>/notif pesan anda</code>', { parse_mode: 'HTML' });
    }

    updateNotification(text);

    bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Notifikasi Dikirim!</b>
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5852614525370503272">📝</tg-emoji> <b>Pesan:</b>
${text}

        <i>Akan muncul di aplikasi dalam ~1 menit.</i>
        `.trim(), { parse_mode: 'HTML' });
});

// --- ADMIN: MAINTENANCE COMMAND ---
bot.onText(/\/maintenance(?:\s+(.+))?/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const action = match[1]?.toLowerCase();
    if (!action || !['on', 'off'].includes(action)) {
        const status = maintenanceService.isEnabled() ? '<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> ON' : '<tg-emoji emoji-id="6084880262179588505">❌</tg-emoji> OFF';
        return bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Status: ${status}

<b>Penggunaan:</b>
<code>/maintenance on</code> - Aktifkan mode perbaikan
<code>/maintenance off</code> - Matikan mode perbaikan

<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <i>Saat ON, user dan pemilik key addkey TIDAK BISA menggunakan bot. Hanya ADMIN yang terdaftar di env yang bisa.</i>
        `.trim(), { parse_mode: 'HTML' });
    }

    const enable = action === 'on';
    maintenanceService.set(enable);

    bot.sendMessage(msg.chat.id, `
${enable ? '<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji>' : '<tg-emoji emoji-id="5215685881989442149">🟢</tg-emoji>'} <b>MAINTENANCE MODE ${enable ? 'ACTIVATED' : 'DEACTIVATED'}</b>
━━━━━━━━━━━━━━━━━━

Bot sekarang ${enable ? 'HANYA bisa diakses oleh Owner.' : 'bisa diakses oleh semua user.'}
    `.trim(), { parse_mode: 'HTML' });
});

// Global check for other messages
// Global check for other messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // Skip if maintenance is off or user is admin
    if (!maintenanceService.isEnabled() || isAdmin(chatId)) {
        
        // Skip commands (they are handled by onText)
        if (msg.text && msg.text.startsWith('/')) return;
        
        // Skip if no active session
        const session = global.sessions.get(chatId);
        if (!session) return;
        
        console.log(`[DEBUG] Processing message for ${chatId}, step: ${session.step}`);
        
        // Handle based on message type
        if (msg.photo) {
            await handleMessage(bot, msg, 'photo');
        } else if (msg.text) {
            await handleMessage(bot, msg, 'text');
        } else if (msg.document) {
            // Handle document uploads if needed
            console.log(`[DEBUG] Document received: ${msg.document.file_name}`);
        }
        return;
    }

    // If maintenance is ON and user is NOT admin
    if (msg.chat.type === 'private' && (!msg.text || !msg.text.startsWith('/'))) {
        bot.sendMessage(msg.chat.id, `
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <b>MAINTENANCE MODE</b>
━━━━━━━━━━━━━━━━━━

Bot sedang dalam perbaikan.
Silakan coba lagi nanti.
        `.trim(), { parse_mode: 'HTML' });
    }
});

// Start Web Server
startWebServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Bot dihentikan');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Bot dihentikan');
    bot.stopPolling();
    process.exit(0);
});