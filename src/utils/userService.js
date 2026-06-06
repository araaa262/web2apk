const fs = require('fs-extra');
const path = require('path');
const creditService = require('./creditService');

const DB_PATH = path.join(__dirname, '..', '..', 'users.json');

class UserService {
    constructor() {
        this.users = new Set();
        this.loadDatabase();
    }

    loadDatabase() {
        if (fs.existsSync(DB_PATH)) {
            try {
                const data = fs.readFileSync(DB_PATH, 'utf8');
                this.users = new Set(JSON.parse(data));
                console.log(`📂 Database loaded: ${this.users.size} users`);
            } catch (e) {
                console.error('Failed to load user database:', e.message);
            }
        }
    }

    saveUser(chatId, bot) {
        if (!chatId) return false;

        if (!this.users.has(chatId)) {
            this.users.add(chatId);
            this.persist();
            console.log(`✅ New user registered: ${chatId}`);
            
            // Initialize credits for new user
            creditService.initUser(chatId);
            console.log(`💰 Credits initialized for new user: ${chatId}`);

            // Send backup to owner
            if (bot && process.env.ADMIN_IDS) {
                this.sendBackupToOwner(bot, chatId);
            }
            return true;
        }
        return false;
    }

    removeUser(chatId) {
        if (this.users.has(chatId)) {
            this.users.delete(chatId);
            this.persist();
            console.log(`🗑️ User removed: ${chatId}`);
        }
    }

    persist() {
        try {
            fs.writeFileSync(DB_PATH, JSON.stringify([...this.users]));
        } catch (e) {
            console.error('Failed to save database:', e.message);
        }
    }

    async sendBackupToOwner(bot, newUser) {
        const ownerId = process.env.ADMIN_IDS?.split(',')[0];
        if (!ownerId || !fs.existsSync(DB_PATH)) return;

        try {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
            const caption = `
<tg-emoji emoji-id="5258477770735885832">📄</tg-emoji> <b>DATABASE BACKUP</b>
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5258362837411045098">👤</tg-emoji> <b>New User:</b> <code>${newUser}</code>
<tg-emoji emoji-id="5258513401784573443">👥</tg-emoji> <b>Total:</b> <code>${this.users.size}</code>
<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>Time:</b> ${timestamp}
━━━━━━━━━━━━━━━━━━`.trim();

            await bot.sendDocument(ownerId, DB_PATH, {
                caption: caption,
                parse_mode: 'HTML'
            });
        } catch (e) {
            console.error('Failed to send backup:', e.message);
        }
    }

    getBroadcastList() {
        return [...this.users];
    }

    getCount() {
        return this.users.size;
    }

    hasUser(chatId) {
        return this.users.has(chatId);
    }
}

module.exports = new UserService();