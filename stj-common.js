/**
 * stj-common.js
 * SillyTavern カスタム拡張機能用 共通ユーティリティモジュール
 */

import { extension_settings, saveSettingsDebounced, saveSettingsToServer } from '../../../extensions.js';
import { getContext } from '../../../script.js';

// 対応画像拡張子リスト
export const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];

/**
 * 拡張機能設定の取得および初期化
 * @param {string} moduleName - モジュール識別名
 * @param {Object} defaultSettings - デフォルト設定オブジェクト
 * @returns {Object} モジュールの設定オブジェクト
 */
export function getOrInitSettings(moduleName, defaultSettings = {}) {
    if (!extension_settings[moduleName]) {
        extension_settings[moduleName] = { ...defaultSettings };
    } else {
        extension_settings[moduleName] = Object.assign({}, defaultSettings, extension_settings[moduleName]);
    }
    return extension_settings[moduleName];
}

/**
 * localStorage から extensionSettings (サーバー保存) への自動移行処理
 * @param {string} moduleName - モジュール識別名
 * @param {string} localKey - 移行元の localStorage キー
 * @param {Object} defaultSettings - デフォルト設定
 */
export function migrateFromLocalStorage(moduleName, localKey, defaultSettings = {}) {
    const settings = getOrInitSettings(moduleName, defaultSettings);
    const localData = localStorage.getItem(localKey);
    
    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            Object.assign(settings, parsed);
            localStorage.removeItem(localKey);
            saveSettingsToServer();
            console.log(`[${moduleName}] localStorage (${localKey}) から extensionSettings へ移行完了。`);
        } catch (e) {
            console.error(`[${moduleName}] localStorage データのパースに失敗しました:`, e);
        }
    }
}

/**
 * 設定値を更新してサーバーへ保存
 * @param {string} moduleName 
 * @param {string} key 
 * @param {any} value 
 * @param {boolean} [immediate=false] - 即時保存フラグ
 */
export function updateModuleSetting(moduleName, key, value, immediate = false) {
    if (!extension_settings[moduleName]) {
        extension_settings[moduleName] = {};
    }
    extension_settings[moduleName][key] = value;
    if (immediate) {
        saveSettingsToServer();
    } else {
        saveSettingsDebounced();
    }
}

/**
 * 指定したURLの画像が存在するか非同期で検証
 * @param {string} imageUrl 
 * @returns {Promise<boolean>}
 */
export function checkImageExists(imageUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = imageUrl;
    });
}

/**
 * 画像の拡張子を自動判定
 * @param {string} basePath - 例: 'addchara/CharacterName/imageName'
 * @returns {Promise<string|null>} 存在すれば拡張子文字列、存在しなければ null
 */
export function detectImageExtension(basePath) {
    return (async () => {
        for (const ext of ALLOWED_EXTENSIONS) {
            const fullPath = `${basePath}.${ext}`;
            const exists = await checkImageExists(fullPath);
            if (exists) {
                return ext;
            }
        }
        return null;
    })();
}

/**
 * DOMから現在アクティブなキャラクター名を取得
 * @returns {string|null}
 */
export function detectCharacterNameFromDOM() {
    const nameHolder = document.querySelector('#character_name_holder');
    if (nameHolder && nameHolder.textContent) {
        return nameHolder.textContent.trim();
    }
    const greetingMessage = document.querySelector('.mes[mesid="0"][is_user="false"]');
    if (greetingMessage && greetingMessage.getAttribute('ch_name')) {
        return greetingMessage.getAttribute('ch_name');
    }
    return null;
}

/**
 * カスタム通知アラート表示ヘルパー
 * @param {string} message 
 */
export function showCustomNotification(message) {
    const existingAlert = document.getElementById('stj_custom_alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    const alertDiv = document.createElement('div');
    alertDiv.id = 'stj_custom_alert';
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.style.opacity = '1';
        alertDiv.style.transform = 'translate(-50%, -50%) scale(1)';
    }, 10);
    
    setTimeout(() => {
        alertDiv.style.opacity = '0';
        alertDiv.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.parentNode.removeChild(alertDiv);
            }
        }, 300);
    }, 3000);
}

/**
 * SillyTavern Context オブジェクトの安全な取得
 * @returns {Object|null}
 */
export function getSTContext() {
    try {
        return getContext();
    } catch (e) {
        console.warn('ST Context 取得失敗:', e);
        return null;
    }
}
