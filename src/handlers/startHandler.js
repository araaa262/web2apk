const { getMainKeyboard } = require('../utils/keyboard');

/**
 * Handle /start command
 * Mengirim stiker loading, menghapusnya, lalu menampilkan menu utama
 */

const STICKER_START_LOADING = "CAACAgIAAxkBAAIBcWnGyss54jxR9GsfVCmzYJxcSjf1AAIFAQACVp29Crfk_bYORV93OgQ";

async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const safeName = (msg.from.first_name || 'User').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Initialize credits for user
    const creditService = require('../utils/creditService');
    creditService.initUser(chatId);
    const creditInfo = creditService.getUserCredits(chatId);
    
    const welcomeCaption = `
<b>Selamat Datang, ${safeName}!</b>
<tg-emoji emoji-id="5339267587337370029">😉</tg-emoji> <b>Web2Apk Pro Bot Gen 4</b> adalah solusi instant mengubah website menjadi aplikasi Android.

<tg-emoji emoji-id="5418010521309815154">🎫</tg-emoji> <b>Sisa Credit:</b> <code>${creditInfo?.credits || 5}</code>
<tg-emoji emoji-id="5258477770735885832">📄</tg-emoji> <i>Setiap build menggunakan 1 credit</i>
<tg-emoji emoji-id="5208541126583136130">🎉</tg-emoji> <i>Dapatkan 5 credit gratis setiap minggu!</i>

<tg-emoji emoji-id="5201873494798776013">✨</tg-emoji> <i>Fitur Premium:</i>
• Tanpa Iklan
• Proses Cepat
• Custom Icon Support
• Build dari ZIP Project (Flutter/Android)
<tg-emoji emoji-id="5470177992950946662">👇</tg-emoji> <b>Mulai project Anda sekarang:</b>
    `.trim();

    try {
        // 1. Kirim stiker loading terlebih dahulu
        const stickerMessage = await bot.sendSticker(chatId, STICKER_START_LOADING);
        
        // 2. Tunggu sebentar (1.5 detik) agar stiker terlihat
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 3. Hapus stiker yang baru dikirim
        await bot.deleteMessage(chatId, stickerMessage.message_id);
        
        // 4. Kirim foto dengan caption dan menu
        await bot.sendPhoto(chatId, 'https://files.catbox.moe/ciqch1.png', {
            caption: welcomeCaption,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
        
    } catch (error) {
        console.error('Error in handleStart:', error);
        
        // Fallback jika ada error, kirim pesan biasa
        try {
            if (stickerMessage) {
                await bot.deleteMessage(chatId, stickerMessage.message_id).catch(() => {});
            }
        } catch (e) {}
        
        // Kirim menu tanpa foto
        await bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    }
}

module.exports = { handleStart };