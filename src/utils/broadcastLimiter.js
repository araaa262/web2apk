// src/utils/broadcastLimiter.js
const fs = require('fs-extra');
const path = require('path');

const LIMIT_FILE = path.join(__dirname, '..', '..', 'broadcast_limits.json');
const DAILY_LIMIT = 5;
const EXEMPT_ADMIN_ID = '1122207241'; // Admin yang tidak kena limit

class BroadcastLimiter {
    constructor() {
        this.data = {};
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(LIMIT_FILE)) {
                this.data = fs.readJsonSync(LIMIT_FILE);
            }
        } catch (e) {
            console.error('Failed to load broadcast limits:', e.message);
            this.data = {};
        }
    }

    save() {
        try {
            fs.writeJsonSync(LIMIT_FILE, this.data, { spaces: 2 });
        } catch (e) {
            console.error('Failed to save broadcast limits:', e.message);
        }
    }

    /**
     * Check if user can broadcast
     * @param {string|number} userId
     * @returns {object} { allowed: boolean, remaining: number, resetTime: string|null }
     */
    checkLimit(userId) {
        const id = String(userId);
        if (id === EXEMPT_ADMIN_ID) {
            return { allowed: true, remaining: Infinity, resetTime: null };
        }

        const today = new Date().toISOString().split('T')[0];
        const userData = this.data[id] || { date: today, count: 0 };

        if (userData.date !== today) {
            // Reset untuk hari baru
            return { allowed: true, remaining: DAILY_LIMIT, resetTime: null };
        }

        const used = userData.count;
        const remaining = Math.max(0, DAILY_LIMIT - used);
        const allowed = used < DAILY_LIMIT;

        // Waktu reset (besok jam 00:00 lokal)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const resetTime = tomorrow.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

        return { allowed, remaining, resetTime };
    }

    /**
     * Record a broadcast attempt
     * @param {string|number} userId
     * @returns {boolean} true if recorded, false if limit exceeded
     */
    recordBroadcast(userId) {
        const id = String(userId);
        if (id === EXEMPT_ADMIN_ID) return true;

        const today = new Date().toISOString().split('T')[0];
        if (!this.data[id]) {
            this.data[id] = { date: today, count: 0 };
        }

        if (this.data[id].date !== today) {
            this.data[id] = { date: today, count: 0 };
        }

        if (this.data[id].count >= DAILY_LIMIT) {
            return false;
        }

        this.data[id].count++;
        this.save();
        return true;
    }

    /**
     * Get user's remaining broadcasts for today
     * @param {string|number} userId
     * @returns {number}
     */
    getRemaining(userId) {
        const id = String(userId);
        if (id === EXEMPT_ADMIN_ID) return Infinity;

        const today = new Date().toISOString().split('T')[0];
        const userData = this.data[id];
        if (!userData || userData.date !== today) return DAILY_LIMIT;
        return Math.max(0, DAILY_LIMIT - userData.count);
    }

    /**
     * Reset limit for a specific user (admin only)
     * @param {string|number} userId
     */
    resetUser(userId) {
        const id = String(userId);
        if (this.data[id]) {
            delete this.data[id];
            this.save();
        }
    }
}

module.exports = new BroadcastLimiter();