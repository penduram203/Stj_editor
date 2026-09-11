// 修正版:
// 1) SillyTavern.getContext() 経由でのextensionSettings利用（前回修正分、維持）
// 2) exportJSON() が空スタブで実際にファイルをダウンロードしていなかったバグを修正
//    → フォームの内容から image_display_extension 形式のJSONを組み立て、
//      "{キャラ名}_ext.json" としてブラウザダウンロードするよう実装
// 3) updatePreview / updateSinglePreview / setupPreviewListeners が空スタブだったため
//    プレビュー画像が一切表示されなかったバグを修正
// 4) loadExistingJSONData が取得したJSONを捨てるだけだったため、既存データの
//    再編集ができなかったバグを修正（フォームへ反映するよう実装）
// 5) addKeywordRowWithData（保存データ/既存JSON読込時に行を生成する関数）に
//    削除ボタン・プレビュー更新のイベントリスナーが付いていなかったバグを修正
(function() {
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];
    const MODULE_NAME = 'stj_editor';

    // SillyTavern context を取得するヘルパー（未取得ならnull）
    function getSTContext() {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            return window.SillyTavern.getContext();
        }
        return null;
    }

    // extensionSettings の初期化・取得ヘルパー
    function getExtensionSettings() {
        const context = getSTContext();
        if (!context || !context.extensionSettings) {
            console.warn('[STJ Editor] SillyTavern context が取得できませんでした。');
            return {};
        }
        if (!context.extensionSettings[MODULE_NAME]) {
            context.extensionSettings[MODULE_NAME] = {};
        }
        return context.extensionSettings[MODULE_NAME];
    }

    // 設定をサーバー側へ保存依頼するヘルパー
    function persistSettings() {
        const context = getSTContext();
        if (context && typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        } else {
            console.warn('[STJ Editor] saveSettingsDebounced が利用できないため設定を保存できませんでした。');
        }
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

    // 画像の拡張子を自動検出する関数（addchara/{charName}/{imageName}.{ext} の存在確認）
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

    // 拡張子を含むパスからファイル名（拡張子なし）を抽出
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

    // JSON内を再帰探索して image_display_extension を見つける（image-display.js と同じロジック）
    function findImageMapInData(data) {
        if (data === null || typeof data !== 'object') return null;
        if (data.hasOwnProperty('image_display_extension')) {
            const potentialMap = data.image_display_extension;
            if (typeof potentialMap === 'object' && potentialMap !== null) {
                return potentialMap;
            }
        }
        for (const key in data) {
            if (data.hasOwnProperty(key)) {
                const result = findImageMapInData(data[key]);
                if (result !== null) return result;
            }
        }
        return null;
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

    // キーワード行に「削除」「プレビュー自動更新」のイベントを付与する共通処理
    // （addKeywordRow・addKeywordRowWithData の両方から呼ぶことで付け忘れを防ぐ）
    function attachKeywordRowListeners(item, index) {
        const deleteButton = item.querySelector('.stj-delete-row');
        if (deleteButton) {
            deleteButton.addEventListener('click', function(e) {
                e.stopPropagation();
                item.remove();
            });
        }
        const imageInput = item.querySelector('.stj-image-input');
        if (imageInput) {
            imageInput.addEventListener('input', debounce(function() {
                updateSinglePreview(index);
            }, 500));
        }
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

        // 最初から存在する1行目にも「削除」「プレビュー更新」を付与
        const firstItem = modal.querySelector('.stj-keyword-item');
        if (firstItem) {
            attachKeywordRowListeners(firstItem, 0);
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

        attachKeywordRowListeners(newItem, itemCount);

        modal.scrollTop = modal.scrollHeight;
        setTimeout(() => updateSinglePreview(itemCount), 100);
    }

    // charName を起点に addchara/{charName}/{charName}_ext.json を取得し、
    // 見つかった image_display_extension をフォームへ反映する
    async function loadExistingJSONData(charName) {
        if (!charName) return;
        try {
            const jsonPath = `addchara/${charName}/${charName}_ext.json`;
            const response = await fetch(jsonPath);
            if (response.ok) {
                const data = await response.json();
                const imageMap = findImageMapInData(data);
                if (imageMap) {
                    console.log(`✅ ${charName}_ext.json から既存データを読み込みました`);
                    populateFormFromImageMap(imageMap);
                }
            }
        } catch (e) {
            console.warn('既存JSONデータの取得に失敗しました:', e);
        }
    }

    // image_display_extension オブジェクトからフォーム（デフォルト/サムネイル/キーワード行）を構築
    function populateFormFromImageMap(imageMap) {
        const toInputValue = (val) => {
            const arr = Array.isArray(val) ? val : [val];
            return arr.map(p => extractFileNameFromPath(p)).join(',');
        };

        if (imageMap.default !== undefined) {
            document.getElementById('stj_default_image').value = toInputValue(imageMap.default);
        }
        if (imageMap.thumbnail !== undefined) {
            document.getElementById('stj_thumbnail_image').value = toInputValue(imageMap.thumbnail);
        }

        const container = document.getElementById('stj_keywords_container');
        container.innerHTML = '';
        let index = 0;
        Object.entries(imageMap).forEach(([key, val]) => {
            if (key === 'default' || key === 'thumbnail') return;
            addKeywordRowWithData(container, index, { keyword: key, imageName: toInputValue(val) });
            index++;
        });
        if (index === 0) {
            // キーワード行が1つも無い場合は空行を1つ用意しておく
            addKeywordRowWithData(container, 0, { keyword: '', imageName: '' });
        }
    }

    function setupPreviewListeners() {
        // モーダルを開いた／データを読み込んだ直後に、現在のフォーム内容でプレビューを更新する
        updatePreview();
    }

    // デフォルト/サムネイル/全キーワード行のプレビューをまとめて更新
    async function updatePreview() {
        const charName = document.getElementById('stj_char_name_display').textContent;
        await updateImagePreview('stj_preview_default', charName, document.getElementById('stj_default_image')?.value);
        await updateImagePreview('stj_preview_thumbnail', charName, document.getElementById('stj_thumbnail_image')?.value);
        const keywordItems = document.querySelectorAll('.stj-keyword-item');
        for (let i = 0; i < keywordItems.length; i++) {
            await updateSinglePreview(i);
        }
    }

    // 指定したキーワード行だけプレビューを更新
    async function updateSinglePreview(index) {
        const charName = document.getElementById('stj_char_name_display').textContent;
        const imageInput = document.getElementById(`stj_image_name_${index}`);
        if (!imageInput) return;
        await updateImagePreview(`stj_preview_${index}`, charName, imageInput.value);
    }

    // 指定プレビューボックスへ画像を表示する共通処理（複数指定時は先頭の1枚を表示）
    async function updateImagePreview(previewId, charName, rawValue) {
        const previewEl = document.getElementById(previewId);
        if (!previewEl) return;

        const imageNames = parseImageNames(rawValue);
        if (!charName || imageNames.length === 0) {
            previewEl.innerHTML = '<div class="stj-preview-text">画像プレビュー</div>';
            return;
        }

        const firstName = extractFileNameFromPath(imageNames[0]);
        const ext = await detectImageExtension(charName, firstName);
        if (ext) {
            previewEl.innerHTML = `<img src="addchara/${charName}/${firstName}.${ext}" alt="${firstName}">`;
        } else {
            previewEl.innerHTML = '<div class="stj-preview-text stj-preview-error">画像が見つかりません</div>';
        }
    }

    // フォームの内容から image_display_extension 形式のオブジェクトを組み立てる
    // （画像ファイル名 → addchara/{charName}/{ファイル名} のフルパスに変換）
    function buildImageMapFromForm(charName) {
        const toPaths = (raw) => parseImageNames(raw).map(name => `addchara/${charName}/${extractFileNameFromPath(name)}`);
        const imageMap = {};

        const defaultPaths = toPaths(document.getElementById('stj_default_image').value);
        if (defaultPaths.length > 0) {
            imageMap.default = defaultPaths.length === 1 ? defaultPaths[0] : defaultPaths;
        }

        const thumbnailPaths = toPaths(document.getElementById('stj_thumbnail_image').value);
        if (thumbnailPaths.length > 0) {
            imageMap.thumbnail = thumbnailPaths.length === 1 ? thumbnailPaths[0] : thumbnailPaths;
        }

        document.querySelectorAll('.stj-keyword-item').forEach(item => {
            const keywordInput = item.querySelector('.stj-keyword-input');
            const imageInput = item.querySelector('.stj-image-input');
            if (!keywordInput || !imageInput) return;
            const keyword = keywordInput.value.trim();
            if (!keyword) return;
            const paths = toPaths(imageInput.value);
            if (paths.length === 0) return;
            imageMap[keyword] = paths.length === 1 ? paths[0] : paths;
        });

        return imageMap;
    }

    // 「JSON出力」ボタン: フォーム内容から {charName}_ext.json をブラウザダウンロードする
    function exportJSON() {
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) {
            alert('キャラクター名が設定されていません');
            return;
        }

        const imageMap = buildImageMapFromForm(charName);
        const exportData = {
            image_display_extension: imageMap
        };

        try {
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${charName}_ext.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showCustomAlert('JSONファイルを出力しました');
            console.log(`✅ ${charName}_ext.json を出力しました`, exportData);
        } catch (e) {
            console.error('[STJ Editor] JSON出力に失敗しました:', e);
            alert('JSON出力に失敗しました。詳細はコンソールを確認してください。');
        }
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

    // データ保存関数（ブラウザ内 extensionSettings（サーバー保存）へのセーブ。JSON出力とは別物）
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

        persistSettings();
        showCustomAlert('データを保存しました');
    }

    // 保存データ読み込み関数（ブラウザ内 extensionSettings から）
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

        // 元コードではここでイベントが一切付与されておらず、
        // 読み込んだ行の削除ボタン・プレビュー自動更新が機能していなかった
        attachKeywordRowListeners(newItem, index);
    }

    /**
     * SillyTavern EventSource を利用した初期化とイベントリレー
     */
    function initStjEditor() {
        const context = getSTContext();
        if (!context) {
            // SillyTavern本体の初期化がまだ済んでいない可能性があるため少し待って再試行
            setTimeout(initStjEditor, 500);
            return;
        }

        const eventSource = context.eventSource;
        const eventTypes = context.eventTypes;

        // ボタン構築
        createExportButton();

        // チャット変更時、キャラクター読み込み時などのSillyTavernイベントをフックしてボタン再配置やUI更新を実施
        if (eventSource && eventTypes) {
            if (eventTypes.CHAT_CHANGED) {
                eventSource.on(eventTypes.CHAT_CHANGED, createExportButton);
            }
            if (eventTypes.CHARACTER_LOADED) {
                eventSource.on(eventTypes.CHARACTER_LOADED, createExportButton);
            }
            if (eventTypes.APP_READY) {
                eventSource.on(eventTypes.APP_READY, createExportButton);
            }
        } else {
            console.warn('[STJ Editor] eventSource or eventTypes not found in context.');
        }
    }

    // jQuery Readyで初期化実行
    $(document).ready(() => {
        initStjEditor();
    });
})();
