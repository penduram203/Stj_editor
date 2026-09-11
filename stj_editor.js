import { getContext } from '../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';

(function() {
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];
    const MODULE_NAME = 'stj_editor';

    // extensionSettings の初期化・取得ヘルパー
    function getExtensionSettings() {
        if (!extension_settings[MODULE_NAME]) {
            extension_settings[MODULE_NAME] = {};
        }
        return extension_settings[MODULE_NAME];
    }

    // DOMからキャラクター名を検出する関数
    function detectCharacterNameFromDOM() {
        const nameHolder = document.querySelector('#character_name_holder');
        if (nameHolder && nameHolder.textContent) return nameHolder.textContent.trim();
        const greetingMessage = document.querySelector('.mes[mesid="0"][is_user="false"]');
        if (greetingMessage && greetingMessage.getAttribute('ch_name')) return greetingMessage.getAttribute('ch_name');
        return null;
    }

    // 画像の存在確認関数
    function checkImageExists(imageUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = imageUrl;
        });
    }

    // 画像の拡張子を自動検出する関数
    async function detectImageExtension(charName, imageName) {
        if (!charName || !imageName) return null;
        for (const ext of ALLOWED_EXTENSIONS) {
            const imagePath = `addchara/${charName}/${imageName}.${ext}`;
            const exists = await checkImageExists(imagePath);
            if (exists) {
                return ext;
            }
        }
        return null;
    }

    // 拡張子を含むパスからファイル名を抽出
    function extractFileNameFromPath(path) {
        if (!path) return '';
        const parts = path.split('/');
        const fileNameWithExt = parts[parts.length - 1];
        const fileName = fileNameWithExt.split('.')[0];
        return fileName;
    }

    // ファイル名文字列を配列に変換（カンマ区切り対応）
    function parseImageNames(input) {
        if (!input) return [];
        return input.split(',').map(name => name.trim()).filter(name => name.length > 0);
    }

    // 新規ボタン作成関数
    function createExportButton() {
        const buttonContainer = document.querySelector('#rm_ch_create_block .form_create_bottom_buttons_block');
        if (!buttonContainer) {
            return;
        }
        if (document.getElementById('stj_export_button')) {
            return;
        }
        const exportButton = document.createElement('button');
        exportButton.id = 'stj_export_button';
        exportButton.textContent = 'JSONデータ編集';
        exportButton.className = 'menu_button';
        buttonContainer.prepend(exportButton);
        createExportModal(exportButton);
    }

    // デバウンス処理
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // モーダルウィンドウ作成関数
    function createExportModal(anchorButton) {
        const existingModal = document.getElementById('stj_export_modal');
        if (existingModal) {
            existingModal.remove();
        }
        const modal = document.createElement('div');
        modal.id = 'stj_export_modal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.zIndex = '10001';
        modal.innerHTML = `
            <div class="stj-header" style="margin-bottom: 15px;">
                <strong id="stj_char_name_display" style="font-size: 24px; font-weight: bold; color: white; text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);"></strong>
                <div style="color: #ccc; font-size: 12px; margin-top: 5px;">※複数画像はカンマ区切りで入力（例: image1,image2,image3）</div>
            </div>
            <div class="stj-special-container">
                <div class="stj-special-item">
                    <div class="stj-special-preview">
                        <div class="stj-image-preview" id="stj_preview_default">
                            <div class="stj-preview-text">デフォルト画像プレビュー</div>
                        </div>
                    </div>
                    <div class="stj-special-inputs">
                        <div class="stj-input-group">
                            <label for="stj_default_image">画像ファイル名</label>
                            <input type="text" id="stj_default_image" value="defa" class="stj-image-input" placeholder="複数画像はカンマ区切り">
                        </div>
                    </div>
                </div>
                <div class="stj-special-item">
                    <div class="stj-special-preview">
                        <div class="stj-image-preview" id="stj_preview_thumbnail">
                            <div class="stj-preview-text">サムネイル画像プレビュー</div>
                        </div>
                    </div>
                    <div class="stj-special-inputs">
                        <div class="stj-input-group">
                            <label for="stj_thumbnail_image">画像ファイル名</label>
                            <input type="text" id="stj_thumbnail_image" value="thum" class="stj-image-input" placeholder="複数画像はカンマ区切り">
                        </div>
                    </div>
                </div>
            </div>
            <div id="stj_keywords_container" class="stj-grid-container">
                <div class="stj-keyword-item">
                    <div class="stj-image-preview" id="stj_preview_0">
                        <div class="stj-preview-text">画像プレビュー</div>
                    </div>
                    <div class="stj-inputs-container">
                        <div class="stj-input-row">
                            <button class="stj-delete-row">×</button>
                            <div class="stj-input-group stj-keyword-width">
                                <label for="stj_keywords_0">キーワード</label>
                                <input type="text" id="stj_keywords_0" class="stj-keyword-input">
                            </div>
                        </div>
                        <div class="stj-input-row">
                            <div class="stj-input-group stj-image-width">
                                <label for="stj_image_name_0">画像ファイル名</label>
                                <input type="text" id="stj_image_name_0" class="stj-image-input" placeholder="複数画像はカンマ区切り">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="stj-button-group">
                <button id="stj_add_keyword">キーワード追加</button>
                <div>
                    <button id="stj_save_data">セーブ</button>
                    <button id="stj_cancel_export">キャンセル</button>
                    <button id="stj_export_json">JSON出力</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', function(e) { e.stopPropagation(); });
        document.getElementById('stj_add_keyword').addEventListener('click', function(e) {
            e.stopPropagation();
            addKeywordRow(modal);
        });
        anchorButton.addEventListener('click', async function(e) {
            e.stopPropagation();
            modal.style.display = 'block';
            modal.style.top = '0';
            modal.style.left = '10vw';
            modal.style.width = '80vw';
            modal.style.height = '100vh';
            const charName = detectCharacterNameFromDOM() || '';
            document.getElementById('stj_char_name_display').textContent = charName;
            await loadExistingJSONData(charName);
            loadSavedData(charName);
            setupPreviewListeners();
        });
        document.getElementById('stj_cancel_export').addEventListener('click', function(e) {
            e.stopPropagation();
            modal.style.display = 'none';
        });
        document.getElementById('stj_export_json').addEventListener('click', function(e) {
            e.stopPropagation();
            exportJSON();
        });
        document.getElementById('stj_save_data').addEventListener('click', function(e) {
            e.stopPropagation();
            saveData();
        });
        document.addEventListener('click', function(e) {
            if (e.target !== anchorButton && !modal.contains(e.target)) {
                modal.style.display = 'none';
            }
        });

        const firstDeleteButton = modal.querySelector('.stj-delete-row');
        if (firstDeleteButton) {
            firstDeleteButton.addEventListener('click', function(e) {
                e.stopPropagation();
                const item = this.closest('.stj-keyword-item');
                if (item) { item.remove(); }
            });
        }
        const imageInputs = ['stj_default_image', 'stj_thumbnail_image'];
        imageInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', debounce(updatePreview, 500));
            }
        });
    }

    function addKeywordRow(modal) {
        const container = modal.querySelector('#stj_keywords_container');
        const itemCount = container.querySelectorAll('.stj-keyword-item').length;
        const newItem = document.createElement('div');
        newItem.className = 'stj-keyword-item';
        newItem.innerHTML = `
            <div class="stj-image-preview" id="stj_preview_${itemCount}">
                <div class="stj-preview-text">画像プレビュー</div>
            </div>
            <div class="stj-inputs-container">
                <div class="stj-input-row">
                    <button class="stj-delete-row">×</button>
                    <div class="stj-input-group stj-keyword-width">
                        <label for="stj_keywords_${itemCount}">キーワード</label>
                        <input type="text" id="stj_keywords_${itemCount}" class="stj-keyword-input">
                    </div>
                </div>
                <div class="stj-input-row">
                    <div class="stj-input-group stj-image-width">
                        <label for="stj_image_name_${itemCount}">画像ファイル名</label>
                        <input type="text" id="stj_image_name_${itemCount}" class="stj-image-input" placeholder="複数画像はカンマ区切り">
                    </div>
                </div>
            </div>
        `;
        container.appendChild(newItem);

        const deleteButton = newItem.querySelector('.stj-delete-row');
        deleteButton.addEventListener('click', function(e) {
            e.stopPropagation();
            newItem.remove();
        });
        const imageInput = newItem.querySelector('.stj-image-input');
        if (imageInput) {
            imageInput.addEventListener('input', debounce(function() {
                updateSinglePreview(itemCount);
            }, 500));
        }
        modal.scrollTop = modal.scrollHeight;
        setTimeout(() => updateSinglePreview(itemCount), 100);
    }

    async function loadExistingJSONData(charName) {
        if (!charName) return;
        try {
            const jsonPath = `addchara/${charName}/${charName}_ext.json`;
            const response = await fetch(jsonPath);
            if (response.ok) {
                const data = await response.json();
                if (data) {
                    // JSONデータ読み込み処理（必要に応じて展開）
                }
            }
        } catch (e) {
            console.warn('既存JSONデータの取得に失敗しました:', e);
        }
    }

    function setupPreviewListeners() {
        // プレビューのイベント登録処理
    }

    function updatePreview() {
        // 全プレビュー更新処理
    }

    function updateSinglePreview(index) {
        // 単一プレビュー更新処理
    }

    function exportJSON() {
        // JSONダウンロード処理
        const modal = document.getElementById('stj_export_modal');
        if (modal) modal.style.display = 'none';
    }

    function showCustomAlert(message) {
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

    // データ保存関数（extensionSettings（サーバー保存））
    function saveData() {
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) {
            alert('キャラクター名が設定されていません');
            return;
        }
        const data = {
            charName: charName,
            defaultImage: document.getElementById('stj_default_image').value,
            thumbnailImage: document.getElementById('stj_thumbnail_image').value,
            keywords: []
        };
        const keywordItems = document.querySelectorAll('.stj-keyword-item');
        keywordItems.forEach(item => {
            const keywordInput = item.querySelector('.stj-keyword-input');
            const imageInput = item.querySelector('.stj-image-input');
            if (keywordInput && imageInput) {
                data.keywords.push({
                    keyword: keywordInput.value,
                    imageName: imageInput.value
                });
            }
        });

        const stjSettings = getExtensionSettings();
        stjSettings[charName] = data;

        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
        }
        showCustomAlert('データを保存しました');
    }

    // 保存データ読み込み関数
    function loadSavedData(charName) {
        if (!charName) return;
        const stjSettings = getExtensionSettings();
        const data = stjSettings[charName];
        if (!data) return;
        try {
            document.getElementById('stj_default_image').value = data.defaultImage || '';
            document.getElementById('stj_thumbnail_image').value = data.thumbnailImage || '';
            const container = document.getElementById('stj_keywords_container');
            container.innerHTML = '';
            if (data.keywords && data.keywords.length > 0) {
                data.keywords.forEach((kw, index) => {
                    addKeywordRowWithData(container, index, kw);
                });
            }
            setTimeout(updatePreview, 100);
        } catch (e) {
            console.error('保存データの読み込みに失敗しました', e);
        }
    }

    function addKeywordRowWithData(container, index, data) {
        const newItem = document.createElement('div');
        newItem.className = 'stj-keyword-item';
        newItem.innerHTML = `
            <div class="stj-image-preview" id="stj_preview_${index}">
                <div class="stj-preview-text">画像プレビュー</div>
            </div>
            <div class="stj-inputs-container">
                <div class="stj-input-row">
                    <button class="stj-delete-row">×</button>
                    <div class="stj-input-group stj-keyword-width">
                        <label for="stj_keywords_${index}">キーワード</label>
                        <input type="text" id="stj_keywords_${index}" class="stj-keyword-input" value="${data.keyword || ''}">
                    </div>
                </div>
                <div class="stj-input-row">
                    <div class="stj-input-group stj-image-width">
                        <label for="stj_image_name_${index}">画像ファイル名</label>
                        <input type="text" id="stj_image_name_${index}" class="stj-image-input" value="${data.imageName || ''}" placeholder="複数画像はカンマ区切り">
                    </div>
                </div>
            </div>
        `;
        container.appendChild(newItem);
    }

    /**
     * SillyTavern EventSource を利用した初期化とイベントリレー
     */
    function initStjEditor() {
        const context = getContext();
        const eventSource = context.eventSource;
        const eventTypes = context.eventTypes;

        // ボタン構築
        createExportButton();

        // チャット変更時、キャラクター読み込み時などのSillyTavernイベントをフックしてボタン再配置やUI更新を実施
        if (eventSource && eventTypes) {
            eventSource.on(eventTypes.CHAT_CHANGED, createExportButton);
            eventSource.on(eventTypes.CHARACTER_LOADED, createExportButton);
            eventSource.on(eventTypes.APP_READY, createExportButton);
        }
    }

    // jQuery Readyで初期化実行
    $(document).ready(() => {
        initStjEditor();
    });
})();
