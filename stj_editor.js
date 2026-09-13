(function() {
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm'];
    const MODULE_NAME = 'stj_editor';

    // 動画・画像のプリロード用キャッシュマップ
    const mediaCache = new Map();

    // 動画ファイルかどうかを判定
    function isVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return !!url.match(/\.(mp4|webm)$/i);
    }

    // SillyTavern context を取得するヘルパー
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

    // メディアの高速存在確認 & キャッシュ化
    function checkMediaExists(mediaUrl) {
        if (mediaCache.has(mediaUrl)) {
            return Promise.resolve(mediaCache.get(mediaUrl));
        }

        return new Promise((resolve) => {
            if (isVideoUrl(mediaUrl)) {
                const video = document.createElement('video');
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    mediaCache.set(mediaUrl, true);
                    resolve(true);
                };
                video.onerror = () => {
                    mediaCache.set(mediaUrl, false);
                    resolve(false);
                };
                video.src = mediaUrl;
            } else {
                const img = new Image();
                img.onload = () => {
                    mediaCache.set(mediaUrl, true);
                    resolve(true);
                };
                img.onerror = () => {
                    mediaCache.set(mediaUrl, false);
                    resolve(false);
                };
                img.src = mediaUrl;
            }
        });
    }

    // 拡張子付きのファイル名を受け取り、存在確認だけを行う関数（総当たり廃止）
    async function detectImageExtension(charName, fileNameWithExt) {
        if (!charName || !fileNameWithExt) return null;
        
        // 既にフルパス、あるいはファイル名として渡されたものをそのまま構築
        const path = fileNameWithExt.startsWith('addchara/') 
            ? fileNameWithExt 
            : `addchara/${charName}/${fileNameWithExt}`;

        const exists = await checkMediaExists(path);
        return exists ? path : null;
    }

    // 拡張子を含むパスからファイル名（拡張子込み）をそのまま抽出
    function extractFileNameFromPath(path) {
        if (!path) return '';
        const parts = path.split('/');
        return parts[parts.length - 1]; // 拡張子を保持したまま返す
    }

    // ファイル名文字列を配列に変換（カンマ区切り対応）
    function parseImageNames(input) {
        if (!input) return [];
        return input.split(',').map(name => name.trim()).filter(name => name.length > 0);
    }

    // JSON内を再帰探索して image_display_extension を見つける
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
        if (!buttonContainer) return;
        if (document.getElementById('stj_export_button')) return;

        const exportButton = document.createElement('button');
        exportButton.id = 'stj_export_button';
        exportButton.textContent = 'JSONデータ編集';
        exportButton.className = 'menu_button';
        buttonContainer.prepend(exportButton);
        createExportModal(exportButton);
    }

    // セルごとの要素イベント設定（反映ボタン & 削除ボタン）
    function attachKeywordRowListeners(item, index) {
        const deleteButton = item.querySelector('.stj-delete-row');
        if (deleteButton) {
            deleteButton.addEventListener('click', function(e) {
                e.stopPropagation();
                item.remove();
                runLiveTest(); // 行削除時にもテストを再実行
            });
        }

        const applyButton = item.querySelector('.stj-apply-row');
        if (applyButton) {
            applyButton.addEventListener('click', function(e) {
                e.stopPropagation();
                updateSinglePreview(index);
            });
        }

        // キーワードや画像入力の変更時にもテスト判定を更新
        const inputs = item.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', runLiveTest);
        });
    }

    // 共通の反映ボタン用CSSスタイル（大きめ・黒太字）
    const applyBtnStyle = 'margin-top: 6px; padding: 6px 14px; font-size: 13px; font-weight: bold; color: #000000; background-color: #e0e0e0; border: 1px solid #aaa; border-radius: 4px; cursor: pointer; display: inline-block; width: fit-content;';

    // モーダルウィンドウ作成関数
    function createExportModal(anchorButton) {
        const existingModal = document.getElementById('stj_export_modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'stj_export_modal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.zIndex = '10001';
        modal.innerHTML = `
            <div class="stj-header" style="margin-bottom: 15px;">
                <strong id="stj_char_name_display" style="font-size: 24px; font-weight: bold; color: white; text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);"></strong>
                <div style="color: #ccc; font-size: 12px; margin-top: 5px;">※複数ファイルはカンマ区切りで入力（例: image1,video1,image2）</div>
            </div>

            <!-- リアルタイムマッチングテスト用エリア -->
            <div id="stj_test_section" style="background: rgba(0,0,0,0.4); border: 1px solid #555; padding: 10px; margin-bottom: 15px; border-radius: 6px;">
                <label style="font-weight: bold; color: #64b5f6; display: block; margin-bottom: 5px;">
                    🔍 リアルタイムキーワード反応テスト
                </label>
                <textarea id="stj_test_input" placeholder="試しに文章を入力してください（例：笑顔で挨拶する）..." style="width: 100%; height: 50px; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 6px; box-sizing: border-box; resize: vertical;"></textarea>
                <div id="stj_test_result" style="margin-top: 6px; font-size: 13px; font-weight: bold; color: #aed581;">
                    判定結果: <span style="color: #aaa; font-weight: normal;">文章を入力するとヒットするキーワードが表示されます</span>
                </div>
            </div>

            <div class="stj-special-container">
                <div class="stj-special-item">
                    <div class="stj-special-preview">
                        <div class="stj-image-preview" id="stj_preview_default" style="position: relative;">
                            <div class="stj-preview-text">デフォルトメディアプレビュー</div>
                        </div>
                    </div>
                    <div class="stj-special-inputs">
                        <div class="stj-input-group">
                            <label for="stj_default_image">ファイル名</label>
                            <input type="text" id="stj_default_image" value="defa" class="stj-image-input" placeholder="複数ファイルはカンマ区切り">
                            <div>
                                <button type="button" class="stj-apply-special" data-target="default" style="${applyBtnStyle}">反映</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="stj-special-item">
                    <div class="stj-special-preview">
                        <div class="stj-image-preview" id="stj_preview_thumbnail" style="position: relative;">
                            <div class="stj-preview-text">サムネイルプレビュー</div>
                        </div>
                    </div>
                    <div class="stj-special-inputs">
                        <div class="stj-input-group">
                            <label for="stj_thumbnail_image">ファイル名</label>
                            <input type="text" id="stj_thumbnail_image" value="thum" class="stj-image-input" placeholder="複数ファイルはカンマ区切り">
                            <div>
                                <button type="button" class="stj-apply-special" data-target="thumbnail" style="${applyBtnStyle}">反映</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="stj_keywords_container" class="stj-grid-container">
                <div class="stj-keyword-item">
                    <div class="stj-image-preview" id="stj_preview_0" style="position: relative;">
                        <div class="stj-preview-text">プレビュー</div>
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
                                <label for="stj_image_name_0">ファイル名</label>
                                <input type="text" id="stj_image_name_0" class="stj-image-input" placeholder="複数ファイルはカンマ区切り">
                                <div>
                                    <button type="button" class="stj-apply-row" style="${applyBtnStyle}">反映</button>
                                </div>
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

        // テスト用入力エリアのイベント設定
        const testInput = document.getElementById('stj_test_input');
        if (testInput) {
            testInput.addEventListener('input', runLiveTest);
        }

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
            runLiveTest(); // モーダルオープン時にもテスト実行
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

        // デフォルト/サムネイルの変更反映ボタン設定
        modal.querySelectorAll('.stj-apply-special').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const charName = document.getElementById('stj_char_name_display').textContent;
                const target = this.getAttribute('data-target');
                if (target === 'default') {
                    updateImagePreview('stj_preview_default', charName, document.getElementById('stj_default_image')?.value);
                } else if (target === 'thumbnail') {
                    updateImagePreview('stj_preview_thumbnail', charName, document.getElementById('stj_thumbnail_image')?.value);
                }
            });
        });

        const firstItem = modal.querySelector('.stj-keyword-item');
        if (firstItem) {
            attachKeywordRowListeners(firstItem, 0);
        }
    }

    // リアルタイムマッチングテストの判定関数
    function runLiveTest() {
        const testInput = document.getElementById('stj_test_input');
        const testResult = document.getElementById('stj_test_result');
        if (!testInput || !testResult) return;

        const text = testInput.value.trim();
        const items = document.querySelectorAll('.stj-keyword-item');

        // ハイライトのリセット
        items.forEach(item => {
            item.style.border = '';
            item.style.backgroundColor = '';
        });

        if (!text) {
            testResult.innerHTML = '判定結果: <span style="color: #aaa; font-weight: normal;">文章を入力するとヒットするキーワードが表示されます</span>';
            return;
        }

        let matchedKeyword = null;
        let matchedImageName = '';
        let matchedElement = null;

        // キーワードのマッチング判定（先に登録されている項目、またはキーワード長の長いものを優先）
        items.forEach(item => {
            const kwInput = item.querySelector('.stj-keyword-input');
            const imgInput = item.querySelector('.stj-image-input');
            if (!kwInput || !imgInput) return;

            const kw = kwInput.value.trim();
            if (!kw) return;

            // 簡易的な部分一致判定（正規表現化やパイプ区切り|にも拡張可能）
            const keywords = kw.split('|').map(k => k.trim());
            const isMatch = keywords.some(k => k && text.includes(k));

            if (isMatch && !matchedKeyword) {
                matchedKeyword = kw;
                matchedImageName = imgInput.value.trim();
                matchedElement = item;
            }
        });

        if (matchedKeyword) {
            testResult.innerHTML = `判定結果: <span style="color: #64b5f6; font-size: 15px;">「${matchedKeyword}」</span> にマッチしました！ (ファイル: ${matchedImageName || '未指定'})`;
            if (matchedElement) {
                matchedElement.style.border = '2px solid #64b5f6';
                matchedElement.style.backgroundColor = 'rgba(100, 181, 246, 0.15)';
            }
        } else {
            const defaultImg = document.getElementById('stj_default_image')?.value.trim();
            testResult.innerHTML = `判定結果: <span style="color: #ffb74d;">一致するキーワードがありません（デフォルト「${defaultImg || 'defa'}」が適用されます）</span>`;
        }
    }

    function addKeywordRow(modal) {
        const container = modal.querySelector('#stj_keywords_container');
        const itemCount = container.querySelectorAll('.stj-keyword-item').length;
        const newItem = document.createElement('div');
        newItem.className = 'stj-keyword-item';
        newItem.innerHTML = `
            <div class="stj-image-preview" id="stj_preview_${itemCount}" style="position: relative;">
                <div class="stj-preview-text">プレビュー</div>
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
                        <label for="stj_image_name_${itemCount}">ファイル名</label>
                        <input type="text" id="stj_image_name_${itemCount}" class="stj-image-input" placeholder="複数ファイルはカンマ区切り">
                        <div>
                            <button type="button" class="stj-apply-row" style="${applyBtnStyle}">反映</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(newItem);

        attachKeywordRowListeners(newItem, itemCount);

        modal.scrollTop = modal.scrollHeight;
        setTimeout(() => updateSinglePreview(itemCount), 100);
        runLiveTest();
    }

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
            addKeywordRowWithData(container, 0, { keyword: '', imageName: '' });
        }
    }

    function setupPreviewListeners() {
        updatePreview();
    }

    async function updatePreview() {
        const charName = document.getElementById('stj_char_name_display').textContent;
        await updateImagePreview('stj_preview_default', charName, document.getElementById('stj_default_image')?.value);
        await updateImagePreview('stj_preview_thumbnail', charName, document.getElementById('stj_thumbnail_image')?.value);
        const keywordItems = document.querySelectorAll('.stj-keyword-item');
        for (let i = 0; i < keywordItems.length; i++) {
            await updateSinglePreview(i);
        }
    }

    async function updateSinglePreview(index) {
        const charName = document.getElementById('stj_char_name_display').textContent;
        const imageInput = document.getElementById(`stj_image_name_${index}`);
        if (!imageInput) return;
        await updateImagePreview(`stj_preview_${index}`, charName, imageInput.value);
    }

    // 指定プレビューボックスへ画像または動画を表示（高速再生・キャッシュ最適化版）
    async function updateImagePreview(previewId, charName, rawValue, targetIndex = 0) {
        const previewEl = document.getElementById(previewId);
        if (!previewEl) return;

        previewEl.style.position = 'relative';

        const imageNames = parseImageNames(rawValue);
        if (!charName || imageNames.length === 0) {
            previewEl.innerHTML = '<div class="stj-preview-text">プレビュー</div>';
            delete previewEl.dataset.currentIndex;
            return;
        }

        let currentIndex = targetIndex;
        if (currentIndex < 0) currentIndex = imageNames.length - 1;
        if (currentIndex >= imageNames.length) currentIndex = 0;
        previewEl.dataset.currentIndex = currentIndex;

        const fileName = extractFileNameFromPath(imageNames[currentIndex]);
        const fullPath = await detectImageExtension(charName, fileName);
        
        if (fullPath !== null) {
            let mediaHtml = '';
            if (isVideoUrl(fullPath)) {
                mediaHtml = `
                    <video src="${fullPath}" autoplay loop muted playsinline preload="auto"
                           style="width: 100%; height: 100%; object-fit: contain; display: block; background-color: rgba(0,0,0,0.4);">
                    </video>`;
            } else {
                mediaHtml = `
                    <img src="${fullPath}" alt="${fileName}" 
                         style="width: 100%; height: 100%; object-fit: contain; display: block;">`;
            }

            previewEl.innerHTML = mediaHtml;

            if (isVideoUrl(fullPath)) {
                const vid = previewEl.querySelector('video');
                if (vid) {
                    vid.play().catch(() => {});
                }
            }

            // 複数指定時のナビゲーションボタン & インデックス表示
            if (imageNames.length > 1) {
                const leftButton = document.createElement('button');
                leftButton.innerHTML = '←';
                leftButton.style.position = 'absolute';
                leftButton.style.left = '5px';
                leftButton.style.top = '50%';
                leftButton.style.transform = 'translateY(-50%)';
                leftButton.style.zIndex = '10';
                leftButton.style.background = 'rgba(0,0,0,0.5)';
                leftButton.style.color = 'white';
                leftButton.style.border = 'none';
                leftButton.style.borderRadius = '3px';
                leftButton.style.padding = '5px 10px';
                leftButton.style.cursor = 'pointer';
                leftButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateImagePreview(previewId, charName, rawValue, currentIndex - 1);
                });
                previewEl.appendChild(leftButton);

                const rightButton = document.createElement('button');
                rightButton.innerHTML = '→';
                rightButton.style.position = 'absolute';
                rightButton.style.right = '5px';
                rightButton.style.top = '50%';
                rightButton.style.transform = 'translateY(-50%)';
                rightButton.style.zIndex = '10';
                rightButton.style.background = 'rgba(0,0,0,0.5)';
                rightButton.style.color = 'white';
                rightButton.style.border = 'none';
                rightButton.style.borderRadius = '3px';
                rightButton.style.padding = '5px 10px';
                rightButton.style.cursor = 'pointer';
                rightButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateImagePreview(previewId, charName, rawValue, currentIndex + 1);
                });
                previewEl.appendChild(rightButton);

                const indexDisplay = document.createElement('div');
                indexDisplay.style.position = 'absolute';
                indexDisplay.style.bottom = '5px';
                indexDisplay.style.left = '50%';
                indexDisplay.style.transform = 'translateX(-50%)';
                indexDisplay.style.zIndex = '10';
                indexDisplay.style.background = 'rgba(0,0,0,0.5)';
                indexDisplay.style.color = 'white';
                indexDisplay.style.padding = '2px 8px';
                indexDisplay.style.borderRadius = '3px';
                indexDisplay.style.fontSize = '12px';
                indexDisplay.textContent = `${currentIndex + 1}/${imageNames.length}`;
                previewEl.appendChild(indexDisplay);
            }
        } else {
            previewEl.innerHTML = '<div class="stj-preview-text stj-preview-error">ファイルが見つかりません</div>';
        }
    }

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
        if (existingAlert) existingAlert.remove();

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
                if (alertDiv.parentNode) alertDiv.parentNode.removeChild(alertDiv);
            }, 300);
        }, 3000);
    }

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
            <div class="stj-image-preview" id="stj_preview_${index}" style="position: relative;">
                <div class="stj-preview-text">プレビュー</div>
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
                        <label for="stj_image_name_${index}">ファイル名</label>
                        <input type="text" id="stj_image_name_${index}" class="stj-image-input" value="${data.imageName || ''}" placeholder="複数ファイルはカンマ区切り">
                        <div>
                            <button type="button" class="stj-apply-row" style="${applyBtnStyle}">反映</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(newItem);

        attachKeywordRowListeners(newItem, index);
    }

    function initStjEditor() {
        const context = getSTContext();
        if (!context) {
            setTimeout(initStjEditor, 500);
            return;
        }

        const eventSource = context.eventSource;
        const eventTypes = context.eventTypes;

        createExportButton();

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

    $(document).ready(() => {
        initStjEditor();
    });
})();
