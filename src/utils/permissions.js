const resellerService = require('./resellerService');

/**
 * Check if a user is an admin
 * @param {string|number} userId 
 * @returns {boolean}
 */
function isAdmin(userId) {
    const adminIds = process.env.ADMIN_IDS?.split(',').map(id => id.trim()) || [];
    return adminIds.includes(String(userId));
}

/**
 * Check if a user is a reseller
 * @param {string|number} userId 
 * @returns {boolean}
 */
function isReseller(userId) {
    return resellerService.isReseller(userId);
}

/**
 * Check if user has credits (replaces license check)
 * @param {string|number} userId 
 * @returns {boolean}
 */
function hasCredits(userId) {
    const creditService = require('./creditService');
    return creditService.hasSufficientCredits(userId);
}

module.exports = { isAdmin, isReseller, hasCredits };