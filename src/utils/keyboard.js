/**
 * Generate inline keyboards for bot
 */

// ─── Style → Color Mapping ────────────────────────────────────────────────────
// Maps style names to hex color codes (compatible with grammY / Telegram Bot API
// implementations that support button colors, e.g. via web_app or custom renderers).
const STYLE_COLORS = {
    primary: '#2481cc',   // Telegram blue
    success: '#00a86b',   // Green
    succes:  '#00a86b',   // Alias (typo-tolerant)
    danger:  '#e53935',   // Red
    warning: '#f59e0b',   // Amber
    default: '#5f6368',   // Grey
    info:    '#0891b2',   // Cyan
};

/**
 * Applies color field to every button that carries a `style` property.
 * Call this before sending a keyboard to the Telegram API.
 *
 * @param {Object} keyboard  - An inline_keyboard object
 * @returns {Object}         - Same structure with `color` fields injected
 */
function applyButtonStyles(keyboard) {
    if (!keyboard || !keyboard.inline_keyboard) return keyboard;

    const processed = keyboard.inline_keyboard.map(row =>
        row.map(button => {
            if (!button.style) return button;

            const color = STYLE_COLORS[button.style] || STYLE_COLORS.default;
            return { ...button, color };
        })
    );

    return { inline_keyboard: processed };
}

// ─── Keyboards ────────────────────────────────────────────────────────────────

// Main menu keyboard
function getMainKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: 'CREATE APK (URL)', callback_data: 'create_apk', style: 'primary', icon_custom_emoji_id: '4956525562483967357' }
            ],
            [
                { text: 'CREATE APK (ZIP)', callback_data: 'build_zip', style: 'primary', icon_custom_emoji_id: '4956525562483967357' }
            ],
            [
                { text: 'TQTO',    callback_data: 'thanks_to',     style: 'success', icon_custom_emoji_id: '5256047523620995497' },
                { text: 'Bantuan', callback_data: 'help',          style: 'success', icon_custom_emoji_id: '4958728373900674046' }
            ],
            [
                { text: 'Cek Antrian',    callback_data: 'check_queue',    style: 'success', icon_custom_emoji_id: '5346077597287589711' },
                { text: 'Daftar Perintah', callback_data: 'show_commands', style: 'success', icon_custom_emoji_id: '5346077597287589711' }
            ],
            [
                { text: 'Owner',   url: 'https://t.me/makloyyatim', style: 'danger', icon_custom_emoji_id: '5258362837411045098' },
                { text: 'Channel', url: 'https://t.me/yeahimwizz',  style: 'danger', icon_custom_emoji_id: '5215668805199473901' }
            ]
        ]
    });
}

// Color selection keyboard
function getColorKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: '🔵 Biru',   callback_data: 'color_blue',   style: 'primary' },
                { text: '🔴 Merah',  callback_data: 'color_red',    style: 'danger'  },
                { text: '🟢 Hijau',  callback_data: 'color_green',  style: 'success' }
            ],
            [
                { text: '🟣 Ungu',   callback_data: 'color_purple', style: 'info'    },
                { text: '🟠 Oranye', callback_data: 'color_orange', style: 'warning' },
                { text: '🔵 Teal',   callback_data: 'color_teal',   style: 'info'    }
            ],
            [
                { text: '💗 Pink',   callback_data: 'color_pink',   style: 'warning' },
                { text: '🔵 Indigo', callback_data: 'color_indigo', style: 'primary' }
            ],
            [
                { text: 'Batal', callback_data: 'cancel', style: 'danger', icon_custom_emoji_id: '6084880262179588505' }
            ]
        ]
    });
}

// Confirmation keyboard
function getConfirmKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: 'Buat APK', callback_data: 'confirm_build', style: 'success', icon_custom_emoji_id: '5215330331711775720' }
            ],
            [
                { text: 'Batal', callback_data: 'cancel', style: 'danger', icon_custom_emoji_id: '6084880262179588505' }
            ]
        ]
    });
}

// Cancel keyboard
function getCancelKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: 'Batal', callback_data: 'cancel', style: 'danger', icon_custom_emoji_id: '6084880262179588505' }
            ]
        ]
    });
}

// Icon upload keyboard
function getIconKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: 'Lewati (Gunakan Default)', callback_data: 'skip_icon', style: 'success', icon_custom_emoji_id: '5215330331711775720' }
            ],
            [
                { text: 'Batal', callback_data: 'cancel', style: 'danger', icon_custom_emoji_id: '6084880262179588505' }
            ]
        ]
    });
}

// ZIP project type keyboard
function getZipTypeKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: 'Android Studio/Gradle', callback_data: 'zip_android', style: 'default',  icon_custom_emoji_id: '5339267587337370029' }
            ],
            [
                { text: 'Flutter Project',        callback_data: 'zip_flutter', style: 'primary', icon_custom_emoji_id: '5370762896051545594' }
            ],
            [
                { text: 'Batal', callback_data: 'cancel', style: 'danger', icon_custom_emoji_id: '6084880262179588505' }
            ]
        ]
    });
}

// ZIP build type keyboard (debug/release)
function getZipBuildTypeKeyboard() {
    return applyButtonStyles({
        inline_keyboard: [
            [
                { text: 'Debug APK (Fast)', callback_data: 'zipbuild_debug',   style: 'success', icon_custom_emoji_id: '5445284980978621387' }
            ],
            [
                { text: 'Release APK',      callback_data: 'zipbuild_release', style: 'success', icon_custom_emoji_id: '5397991236361527676' }
            ],
            [
                { text: 'Batal', callback_data: 'cancel', style: 'danger', icon_custom_emoji_id: '6084880262179588505' }
            ]
        ]
    });
}

module.exports = {
    STYLE_COLORS,
    applyButtonStyles,
    getMainKeyboard,
    getColorKeyboard,
    getConfirmKeyboard,
    getCancelKeyboard,
    getIconKeyboard,
    getZipTypeKeyboard,
    getZipBuildTypeKeyboard
};
