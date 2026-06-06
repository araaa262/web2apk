// src/utils/creditService.js
const fs = require('fs-extra');
const path = require('path');

const CREDIT_DB_PATH = path.join(__dirname, '..', '..', 'credits.json');

class CreditService {
    constructor() {
        this.credits = {};
        this.loadDatabase();
        this.scheduleWeeklyRefresh();
    }

    loadDatabase() {
        if (fs.existsSync(CREDIT_DB_PATH)) {
            try {
                const data = fs.readFileSync(CREDIT_DB_PATH, 'utf8');
                this.credits = JSON.parse(data);
                console.log(`💰 Credits loaded: ${Object.keys(this.credits).length} users`);
            } catch (e) {
                console.error('Failed to load credits:', e.message);
                this.credits = {};
            }
        }
    }

    persist() {
        try {
            fs.writeFileSync(CREDIT_DB_PATH, JSON.stringify(this.credits, null, 2));
        } catch (e) {
            console.error('Failed to save credits:', e.message);
        }
    }

    scheduleWeeklyRefresh() {
        const now = new Date();
        const nextMonday = new Date(now);
        const daysUntilMonday = (8 - now.getDay()) % 7;
        nextMonday.setDate(now.getDate() + daysUntilMonday);
        nextMonday.setHours(0, 0, 0, 0);
        const delay = nextMonday - now;
        setTimeout(() => {
            this.refreshWeeklyCredits();
            setInterval(() => this.refreshWeeklyCredits(), 7 * 24 * 60 * 60 * 1000);
        }, delay);
        console.log(`💰 Weekly credit refresh scheduled for: ${nextMonday.toLocaleString()}`);
    }

    refreshWeeklyCredits() {
        const now = new Date();
        let refreshed = 0;
        for (const [userId, data] of Object.entries(this.credits)) {
            const lastRefresh = data.lastWeeklyRefresh ? new Date(data.lastWeeklyRefresh) : null;
            const daysSinceRefresh = lastRefresh ? (now - lastRefresh) / (1000 * 60 * 60 * 24) : 999;
            if (!lastRefresh || daysSinceRefresh >= 7) {
                data.credits = (data.credits || 0) + 5;
                data.lastWeeklyRefresh = now.toISOString();
                refreshed++;
            }
        }
        if (refreshed > 0) {
            this.persist();
            console.log(`💰 Weekly credit refresh: +5 credits for ${refreshed} users`);
        }
    }

    initUser(userId) {
        const id = String(userId);
        if (!this.credits[id]) {
            this.credits[id] = {
                userId: id,
                credits: 5,
                totalEarned: 5,
                totalSpent: 0,
                createdAt: new Date().toISOString(),
                lastWeeklyRefresh: new Date().toISOString(),
                transactions: [{
                    type: 'weekly',
                    amount: 5,
                    description: 'Initial credits',
                    timestamp: new Date().toISOString()
                }]
            };
            this.persist();
            console.log(`💰 New user initialized: ${id} with 5 credits`);
        }
        return this.credits[id];
    }

    addCredits(userId, amount, reason = 'Admin added') {
        const id = String(userId);
        if (!amount || amount <= 0) return { success: false, error: 'Jumlah credit harus positif' };
        this.initUser(id);
        this.credits[id].credits += amount;
        this.credits[id].totalEarned += amount;
        this.credits[id].transactions.push({
            type: 'admin_add',
            amount,
            description: reason,
            timestamp: new Date().toISOString()
        });
        if (this.credits[id].transactions.length > 50) this.credits[id].transactions = this.credits[id].transactions.slice(-50);
        this.persist();
        return { success: true, newBalance: this.credits[id].credits, added: amount };
    }

    useCredit(userId, buildType = 'url') {
        const id = String(userId);
        this.initUser(id);
        const user = this.credits[id];
        if (user.credits <= 0) {
            return { success: false, error: 'Credit tidak mencukupi.', remainingCredits: 0 };
        }
        user.credits--;
        user.totalSpent++;
        user.transactions.push({
            type: 'build',
            amount: -1,
            description: `Build ${buildType}`,
            timestamp: new Date().toISOString()
        });
        if (user.transactions.length > 50) user.transactions = user.transactions.slice(-50);
        this.persist();
        return { success: true, remainingCredits: user.credits, used: 1 };
    }

    useBroadcastCredit(userId) {
        const id = String(userId);
        const BROADCAST_COST = 5;
        this.initUser(id);
        const user = this.credits[id];
        if (user.credits < BROADCAST_COST) {
            return { success: false, error: `Credit tidak mencukupi. Butuh ${BROADCAST_COST}, sisa ${user.credits}`, remainingCredits: user.credits, required: BROADCAST_COST };
        }
        user.credits -= BROADCAST_COST;
        user.totalSpent += BROADCAST_COST;
        user.transactions.push({
            type: 'broadcast',
            amount: -BROADCAST_COST,
            description: 'Broadcast message',
            timestamp: new Date().toISOString()
        });
        this.persist();
        return { success: true, remainingCredits: user.credits, used: BROADCAST_COST };
    }

    hasBroadcastCredits(userId) {
        const id = String(userId);
        if (!this.credits[id]) return false;
        return this.credits[id].credits >= 5;
    }

    getUserCredits(userId) {
        const id = String(userId);
        if (!this.credits[id]) return null;
        const user = this.credits[id];
        const now = new Date();
        const lastRefresh = user.lastWeeklyRefresh ? new Date(user.lastWeeklyRefresh) : null;
        const daysUntilNextRefresh = lastRefresh ? 7 - Math.floor((now - lastRefresh) / (1000 * 60 * 60 * 24)) : 7;
        return {
            userId: user.userId,
            credits: user.credits,
            totalEarned: user.totalEarned,
            totalSpent: user.totalSpent,
            createdAt: user.createdAt,
            lastWeeklyRefresh: user.lastWeeklyRefresh,
            daysUntilNextRefresh: Math.max(0, daysUntilNextRefresh),
            transactions: user.transactions.slice(-20)
        };
    }

    hasSufficientCredits(userId) {
        const id = String(userId);
        if (!this.credits[id]) return false;
        return this.credits[id].credits > 0;
    }

    getBalance(userId) {
        const id = String(userId);
        if (!this.credits[id]) return 0;
        return this.credits[id].credits;
    }

    listAllUsers() {
        return Object.values(this.credits).map(user => ({
            userId: user.userId,
            credits: user.credits,
            totalEarned: user.totalEarned,
            totalSpent: user.totalSpent,
            createdAt: user.createdAt,
            lastWeeklyRefresh: user.lastWeeklyRefresh
        })).sort((a, b) => b.credits - a.credits);
    }

    resetUserCredits(userId) {
        const id = String(userId);
        if (!this.credits[id]) return { success: false, error: 'User tidak ditemukan' };
        this.credits[id].credits = 5;
        this.credits[id].transactions.push({
            type: 'admin_reset',
            amount: 0,
            description: 'Credit reset by admin',
            timestamp: new Date().toISOString()
        });
        this.persist();
        return { success: true, newBalance: 5 };
    }

    getCreditInfoMessage(userId) {
        const info = this.getUserCredits(userId);
        if (!info) {
            return `
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Info Credit</b>
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5420323339723881652">⚠️</tg-emoji> <i>Anda belum memiliki credit. Mulai build pertama akan mendapatkan 5 credit gratis!</i>`;
        }
        return `
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>INFO CREDIT</b>
━━━━━━━━━━━━━━━━━━
<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Sisa Credit:</b> <code>${info.credits}</code>
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Total Digunakan:</b> <code>${info.totalSpent}</code>
<tg-emoji emoji-id="5206607081334906820">✔️</tg-emoji> <b>Total Diterima:</b> <code>${info.totalEarned}</code>
<tg-emoji emoji-id="5368295871131695793">⏰</tg-emoji> <b>Topup Gratis:</b> ${info.daysUntilNextRefresh} hari lagi
<tg-emoji emoji-id="5258477770735885832">📄</tg-emoji> <i>Setiap build menggunakan 1 credit</i>
<tg-emoji emoji-id="5215668805199473901">📣</tg-emoji> <i>Broadcast menggunakan 5 credit</i>
<tg-emoji emoji-id="5208541126583136130">🎉</tg-emoji> <i>Dapatkan 5 credit gratis setiap minggu!</i>`;
    }
}

module.exports = new CreditService();