(function() {
    // 対応する画像拡張子のリスト
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];
    
    // DOMからキャラクター名を検出する関数
    function detectCharacterNameFromDOM() {
        const nameHolder = document.querySelector('#character_name_holder');
        if (nameHolder && nameHolder.textContent) return nameHolder.textContent;
        const greetingMessage = document.querySelector('.mes[mesid="0"][is_user="false"]');
        if (greetingMessage && greetingMessage.getAttribute('ch_name')) 
            return greetingMessage.getAttribute('ch_name');
        return null;
    }

    // 画像の拡張子を自動検出する関数
    async function detectImageExtension(charName, imageName) {
        if (!charName || !imageName) return null;
        
        // 各拡張子を試して存在確認
        for (const ext of ALLOWED_EXTENSIONS) {
            const imagePath = `addchara/${charName}/${imageName}.${ext}`;
            const exists = await checkImageExists(imagePath);
            if (exists) {
                return ext;
            }
        }
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

    // 拡張子を含むパスからファイル名を抽出
    function extractFileNameFromPath(path) {
        if (!path) return '';
        // パスをスラッシュで分割
        const parts = path.split('/');
        // 最後の部分がファイル名
        const fileNameWithExt = parts[parts.length - 1];
        // 拡張子を除去
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
        // 指定されたパネル内のボタンコンテナを取得
        const buttonContainer = document.querySelector('#rm_ch_create_block .form_create_bottom_buttons_block');
        if (!buttonContainer) {
            console.error('Button container not found');
            return;
        }

        // 既にボタンが追加されていないか確認
        if (document.getElementById('stj_export_button')) {
            return;
        }

        // 新規ボタン作成
        const exportButton = document.createElement('button');
        exportButton.id = 'stj_export_button';
        exportButton.textContent = 'JSONデータ編集';
        exportButton.className = 'menu_button';
        
        // ボタンコンテナの先頭に追加
        buttonContainer.prepend(exportButton);
        
        // モーダルウィンドウ作成
        createExportModal(exportButton);
    }

    // モーダルウィンドウ作成関数
    function createExportModal(anchorButton) {
        // 既存のモーダルがあれば削除
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
        
        // モーダル内のクリックイベントが伝播しないように
        modal.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        
        // キーワード追加ボタン
        document.getElementById('stj_add_keyword').addEventListener('click', function(e) {
            e.stopPropagation();
            addKeywordRow(modal);
        });
        
        // ボタンイベントリスナー登録
        anchorButton.addEventListener('click', async function(e) {
            e.stopPropagation();
            
            // モーダルを表示する前に位置を設定
            modal.style.display = 'block';
            modal.style.top = '0';
            modal.style.left = '10vw';
            modal.style.width = '80vw';
            modal.style.height = '100vh';
            
            // キャラクター名を検出して表示欄に設定
            const charName = detectCharacterNameFromDOM() || '';
            document.getElementById('stj_char_name_display').textContent = charName;
            
            // 既存のJSONデータを読み込んで入力フィールドに設定
            await loadExistingJSONData(charName);
            
            // 保存データの読み込み
            loadSavedData(charName);
            
            // プレビュー更新イベントリスナーを設定
            setupPreviewListeners();
        });
        
        // キャンセルボタン：イベント伝播を停止
        document.getElementById('stj_cancel_export').addEventListener('click', function(e) {
            e.stopPropagation();
            modal.style.display = 'none';
        });
        
        // JSON出力ボタン：イベント伝播を停止
        document.getElementById('stj_export_json').addEventListener('click', function(e) {
            e.stopPropagation();
            exportJSON();
        });
        
        // セーブボタンのイベントリスナー追加
        document.getElementById('stj_save_data').addEventListener('click', function(e) {
            e.stopPropagation();
            saveData();
        });
        
        // 画面クリックでモーダルを閉じる
        document.addEventListener('click', function(e) {
            if (e.target !== anchorButton && !modal.contains(e.target)) {
                modal.style.display = 'none';
            }
        });
        
        // 初期行の削除ボタンにイベントリスナーを追加
        const firstDeleteButton = modal.querySelector('.stj-delete-row');
        if (firstDeleteButton) {
            firstDeleteButton.addEventListener('click', function(e) {
                e.stopPropagation();
                const item = this.closest('.stj-keyword-item');
                if (item) {
                    item.remove();
                }
            });
        }
        
        // 画像入力にプレビューリスナーを設定
        const imageInputs = ['stj_default_image', 'stj_thumbnail_image'];
        imageInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', debounce(updatePreview, 500));
            }
        });
    }

    // デバウンス関数（入力頻度を制御）
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

    // キーワード行を追加
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
        
        // 削除ボタンのイベントリスナーを追加
        const deleteButton = newItem.querySelector('.stj-delete-row');
        deleteButton.addEventListener('click', function(e) {
            e.stopPropagation();
            newItem.remove();
        });
        
        // 画像ファイル名入力欄にリスナーを設定
        const imageInput = newItem.querySelector('.stj-image-input');
        if (imageInput) {
            imageInput.addEventListener('input', debounce(function() {
                updateSinglePreview(itemCount);
            }, 500));
        }
        
        // スクロールを最下部に移動
        modal.scrollTop = modal.scrollHeight;
        
        // プレビュー更新
        setTimeout(() => updateSinglePreview(itemCount), 100);
    }

    // 既存のJSONデータを読み込む関数
    async function loadExistingJSONData(charName) {
        if (!charName) return;

        try {
            // JSONファイルのパスを構築
            const jsonPath = `addchara/${charName}/${charName}_ext.json`;
            
            // JSONファイルをフェッチ
            const response = await fetch(jsonPath);
            if (!response.ok) {
                // JSONファイルが存在しない場合は新規作成モード
                return;
            }
            
            const jsonData = await response.json();
            const imageData = jsonData.image_display_extension;
            
            if (!imageData) return;
            
            // デフォルト画像の設定
            if (imageData.default) {
                if (Array.isArray(imageData.default)) {
                    // 配列の場合（複数画像）
                    const fileNames = imageData.default.map(path => extractFileNameFromPath(path));
                    const imageNamesString = fileNames.join(', ');
                    document.getElementById('stj_default_image').value = imageNamesString;
                } else {
                    // 文字列の場合（単一画像）
                    const defaultFileName = extractFileNameFromPath(imageData.default);
                    document.getElementById('stj_default_image').value = defaultFileName;
                }
            }
            
            // サムネイル画像の設定
            if (imageData.thumbnail) {
                if (Array.isArray(imageData.thumbnail)) {
                    // 配列の場合（複数画像）
                    const fileNames = imageData.thumbnail.map(path => extractFileNameFromPath(path));
                    const imageNamesString = fileNames.join(', ');
                    document.getElementById('stj_thumbnail_image').value = imageNamesString;
                } else {
                    // 文字列の場合（単一画像）
                    const thumbnailFileName = extractFileNameFromPath(imageData.thumbnail);
                    document.getElementById('stj_thumbnail_image').value = thumbnailFileName;
                }
            }
            
            // キーワードデータの設定
            const container = document.getElementById('stj_keywords_container');
            container.innerHTML = '';
            
            let keywordIndex = 0;
            for (const [keyword, imagePaths] of Object.entries(imageData)) {
                // defaultとthumbnailはスキップ
                if (keyword === 'default' || keyword === 'thumbnail') continue;
                
                // 配列の場合（複数画像）
                if (Array.isArray(imagePaths)) {
                    const fileNames = imagePaths.map(path => extractFileNameFromPath(path));
                    const imageNamesString = fileNames.join(', ');
                    addKeywordRowWithData(container, keywordIndex, {
                        keyword: keyword,
                        imageName: imageNamesString
                    });
                    keywordIndex++;
                } 
                // 文字列の場合（単一画像）
                else if (typeof imagePaths === 'string') {
                    const fileName = extractFileNameFromPath(imagePaths);
                    addKeywordRowWithData(container, keywordIndex, {
                        keyword: keyword,
                        imageName: fileName
                    });
                    keywordIndex++;
                }
            }
            
            // キーワードが1つもない場合は空の行を追加
            if (keywordIndex === 0) {
                const modal = document.getElementById('stj_export_modal');
                addKeywordRow(modal);
            }
            
        } catch (error) {
            console.error('JSONデータの読み込みに失敗しました:', error);
        }
    }

    // プレビュー更新リスナーを設定
    function setupPreviewListeners() {
        // 画像ファイル名入力欄に対してリスナーを設定
        document.querySelectorAll('.stj-image-input').forEach(input => {
            // 入力欄が属する行のインデックスを取得
            const idParts = input.id.split('_');
            const index = idParts[idParts.length - 1];
            
            input.addEventListener('input', debounce(function() {
                // 特定の行のプレビューのみ更新
                updateSinglePreview(index);
            }, 500));
        });
        
        // 初期プレビューを更新
        updateAllPreviews();
    }

    // 特定の行のプレビューを更新
    async function updateSinglePreview(index) {
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) return;
        
        if (index === 'default' || index === 'thumbnail') {
            const imageInput = document.getElementById(`stj_${index}_image`);
            if (imageInput) {
                const imageNamesString = imageInput.value;
                const imageNames = parseImageNames(imageNamesString);
                
                // 画像名の配列と現在のインデックスを保存
                const preview = document.getElementById(`stj_preview_${index}`);
                preview.dataset.imageNames = JSON.stringify(imageNames);
                preview.dataset.currentIndex = 0;
                
                // 最初の画像でプレビューを更新
                if (imageNames.length > 0) {
                    const firstImageName = imageNames[0];
                    const detectedExtension = await detectImageExtension(charName, firstImageName);
                    updateImagePreviewWithNavigation(index, firstImageName, detectedExtension, imageNames);
                } else {
                    updateImagePreviewWithNavigation(index, '', null, []);
                }
            }
        } else {
            const imageInput = document.getElementById(`stj_image_name_${index}`);
            if (imageInput) {
                const imageNamesString = imageInput.value;
                const imageNames = parseImageNames(imageNamesString);
                
                // 画像名の配列と現在のインデックスを保存
                const preview = document.getElementById(`stj_preview_${index}`);
                preview.dataset.imageNames = JSON.stringify(imageNames);
                preview.dataset.currentIndex = 0;
                
                // 最初の画像でプレビューを更新
                if (imageNames.length > 0) {
                    const firstImageName = imageNames[0];
                    const detectedExtension = await detectImageExtension(charName, firstImageName);
                    updateImagePreviewWithNavigation(index, firstImageName, detectedExtension, imageNames);
                } else {
                    updateImagePreviewWithNavigation(index, '', null, []);
                }
            }
        }
    }

    // すべてのプレビューを更新
    async function updateAllPreviews() {
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) return;
        
        // デフォルト画像プレビュー更新
        const defaultImageInput = document.getElementById('stj_default_image');
        if (defaultImageInput) {
            const imageNamesString = defaultImageInput.value;
            const imageNames = parseImageNames(imageNamesString);
            
            // 画像名の配列と現在のインデックスを保存
            const preview = document.getElementById('stj_preview_default');
            preview.dataset.imageNames = JSON.stringify(imageNames);
            preview.dataset.currentIndex = 0;
            
            // 最初の画像でプレビューを更新
            if (imageNames.length > 0) {
                const firstImageName = imageNames[0];
                const defaultExtension = await detectImageExtension(charName, firstImageName);
                updateImagePreviewWithNavigation('default', firstImageName, defaultExtension, imageNames);
            } else {
                updateImagePreviewWithNavigation('default', '', null, []);
            }
        }
        
        // サムネイル画像プレビュー更新
        const thumbnailImageInput = document.getElementById('stj_thumbnail_image');
        if (thumbnailImageInput) {
            const imageNamesString = thumbnailImageInput.value;
            const imageNames = parseImageNames(imageNamesString);
            
            // 画像名の配列と現在のインデックスを保存
            const preview = document.getElementById('stj_preview_thumbnail');
            preview.dataset.imageNames = JSON.stringify(imageNames);
            preview.dataset.currentIndex = 0;
            
            // 最初の画像でプレビューを更新
            if (imageNames.length > 0) {
                const firstImageName = imageNames[0];
                const thumbnailExtension = await detectImageExtension(charName, firstImageName);
                updateImagePreviewWithNavigation('thumbnail', firstImageName, thumbnailExtension, imageNames);
            } else {
                updateImagePreviewWithNavigation('thumbnail', '', null, []);
            }
        }
        
        // キーワードプレビュー更新
        const keywordItems = document.querySelectorAll('.stj-keyword-item');
        for (let i = 0; i < keywordItems.length; i++) {
            const imageInput = document.getElementById(`stj_image_name_${i}`);
            if (imageInput && imageInput.value) {
                const imageNamesString = imageInput.value;
                const imageNames = parseImageNames(imageNamesString);
                
                // 画像名の配列と現在のインデックスを保存
                const preview = document.getElementById(`stj_preview_${i}`);
                preview.dataset.imageNames = JSON.stringify(imageNames);
                preview.dataset.currentIndex = 0;
                
                // 最初の画像でプレビューを更新
                if (imageNames.length > 0) {
                    const firstImageName = imageNames[0];
                    const detectedExtension = await detectImageExtension(charName, firstImageName);
                    updateImagePreviewWithNavigation(i, firstImageName, detectedExtension, imageNames);
                } else {
                    updateImagePreviewWithNavigation(i, '', null, []);
                }
            }
        }
    }

    // プレビューを更新
    async function updatePreview() {
        await updateAllPreviews();
    }

    // 個別のプレビューを更新（ナビゲーション付き）
    function updateImagePreviewWithNavigation(type, imageName, extension, imageNames) {
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) return;
        
        const preview = document.getElementById(`stj_preview_${type}`);
        if (!preview) return;
        
        // プレビューをクリア
        preview.innerHTML = '';
        
        // ナビゲーションコンテナを作成
        const navContainer = document.createElement('div');
        navContainer.style.width = '100%';
        navContainer.style.height = '100%';
        navContainer.style.display = 'flex';
        navContainer.style.justifyContent = 'center';
        navContainer.style.alignItems = 'center';
        navContainer.style.position = 'relative';
        navContainer.style.overflow = 'hidden';
        
        // 複数画像がある場合のみナビゲーションボタンを表示
        if (imageNames.length > 1) {
            // 左ボタン
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
                navigatePreview(type, -1);
            });
            
            // 右ボタン
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
                navigatePreview(type, 1);
            });
            
            navContainer.appendChild(leftButton);
            navContainer.appendChild(rightButton);
            
            // インデックス表示
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
            const currentIndex = parseInt(preview.dataset.currentIndex) || 0;
            indexDisplay.textContent = `${currentIndex + 1}/${imageNames.length}`;
            navContainer.appendChild(indexDisplay);
        }
        
        if (imageName && extension) {
            // 画像パスを生成
            const imagePath = `addchara/${charName}/${imageName}.${extension}`;
            
            // 画像要素を作成
            const img = document.createElement('img');
            img.src = imagePath;
            img.alt = `プレビュー: ${type}`;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain';
            
            // ロード成功時の処理
            img.onload = function() {
                navContainer.appendChild(img);
            };
            
            // ロード失敗時の処理
            img.onerror = function() {
                const text = document.createElement('div');
                text.className = 'stj-preview-text stj-preview-error';
                text.textContent = 'image not found';
                navContainer.appendChild(text);
            };
        } else {
            // 入力がない場合
            const text = document.createElement('div');
            text.className = 'stj-preview-text';
            text.textContent = type === 'default' ? 'デフォルト画像プレビュー' : 
                              type === 'thumbnail' ? 'サムネイル画像プレビュー' : '画像プレビュー';
            navContainer.appendChild(text);
        }
        
        preview.appendChild(navContainer);
    }

    // プレビューナビゲーション処理
    async function navigatePreview(type, direction) {
        const preview = document.getElementById(`stj_preview_${type}`);
        if (!preview) return;
        
        const imageNames = JSON.parse(preview.dataset.imageNames || '[]');
        let currentIndex = parseInt(preview.dataset.currentIndex) || 0;
        
        if (imageNames.length <= 1) return;
        
        // インデックスを更新（循環）
        currentIndex += direction;
        if (currentIndex < 0) {
            currentIndex = imageNames.length - 1;
        } else if (currentIndex >= imageNames.length) {
            currentIndex = 0;
        }
        
        // 新しいインデックスを保存
        preview.dataset.currentIndex = currentIndex;
        
        // 新しい画像でプレビューを更新
        const charName = document.getElementById('stj_char_name_display').textContent;
        const imageName = imageNames[currentIndex];
        const detectedExtension = await detectImageExtension(charName, imageName);
        updateImagePreviewWithNavigation(type, imageName, detectedExtension, imageNames);
    }

    // JSONエクスポート処理
    async function exportJSON() {
        // 表示されているキャラクター名を取得
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) {
            alert('キャラクター名が設定されていません');
            return;
        }
    
        // デフォルト画像設定
        const defaultImageInput = document.getElementById('stj_default_image').value;
        const defaultImageNames = parseImageNames(defaultImageInput);
        
        // サムネイル画像設定
        const thumbnailImageInput = document.getElementById('stj_thumbnail_image').value;
        const thumbnailImageNames = parseImageNames(thumbnailImageInput);

        // キーワード、画像ファイル名、拡張子のペアを収集
        const keywordItems = document.querySelectorAll('.stj-keyword-item');
        const keywordImageMap = new Map(); // キーワードごとに画像パスをグループ化
        
        let hasError = false;

        // デフォルト画像の検証
        const defaultImagePaths = [];
        for (const imageName of defaultImageNames) {
            const extension = await detectImageExtension(charName, imageName);
            if (extension) {
                const imagePath = `addchara/${charName}/${imageName}`;
                defaultImagePaths.push(imagePath);
            } else {
                alert(`デフォルト画像ファイルが見つかりません: ${imageName}`);
                hasError = true;
                break;
            }
        }

        // サムネイル画像の検証
        const thumbnailImagePaths = [];
        for (const imageName of thumbnailImageNames) {
            const extension = await detectImageExtension(charName, imageName);
            if (extension) {
                const imagePath = `addchara/${charName}/${imageName}`;
                thumbnailImagePaths.push(imagePath);
            } else {
                alert(`サムネイル画像ファイルが見つかりません: ${imageName}`);
                hasError = true;
                break;
            }
        }

        if (hasError) {
            return;
        }

        for (const item of keywordItems) {
            const keywordInput = item.querySelector('.stj-keyword-input');
            const imageInput = item.querySelector('.stj-image-input');
        
            if (!keywordInput || !imageInput) continue;
        
            const keyword = keywordInput.value;
            const imageNamesString = imageInput.value;

            if (keyword && imageNamesString) {
                const imageNames = parseImageNames(imageNamesString);
                const imagePaths = [];
                
                for (const imageName of imageNames) {
                    const extension = await detectImageExtension(charName, imageName);
                    if (extension) {
                        const imagePath = `addchara/${charName}/${imageName}`;
                        imagePaths.push(imagePath);
                    } else {
                        alert(`画像ファイルが見つかりません: ${imageName}（キーワード: ${keyword}）`);
                        hasError = true;
                        break;
                    }
                }
                
                if (!hasError && imagePaths.length > 0) {
                    // 同じキーワードが既にある場合は配列に追加、ない場合は新規作成
                    if (keywordImageMap.has(keyword)) {
                        keywordImageMap.get(keyword).push(...imagePaths);
                    } else {
                        keywordImageMap.set(keyword, imagePaths);
                    }
                }
            } else if (keyword || imageNamesString) {
                alert(`キーワードと画像ファイル名の両方を入力してください（キーワード: ${keyword}）`);
                hasError = true;
            }
        }

        if (hasError) {
            return;
        }

        if (keywordImageMap.size === 0 && defaultImagePaths.length === 0 && thumbnailImagePaths.length === 0) {
            alert('少なくとも1つのキーワードと画像ファイル名のペアを入力してください');
            return;
        }

        if (defaultImagePaths.length === 0) {
            alert('デフォルト画像ファイルが見つかりません');
            return;
        }

        if (thumbnailImagePaths.length === 0) {
            alert('サムネイル画像ファイルが見つかりません');
            return;
        }

        // JSONデータ生成
        const imageDisplayExtension = {};
        
        // キーワードごとの画像パスを設定
        for (const [keyword, imagePaths] of keywordImageMap) {
            // 画像が1つの場合は文字列、複数の場合は配列
            imageDisplayExtension[keyword] = imagePaths.length === 1 ? imagePaths[0] : imagePaths;
        }
        
        // デフォルトとサムネイル
        imageDisplayExtension.default = defaultImagePaths.length === 1 ? defaultImagePaths[0] : defaultImagePaths;
        imageDisplayExtension.thumbnail = thumbnailImagePaths.length === 1 ? thumbnailImagePaths[0] : thumbnailImagePaths;

        const jsonData = {
            image_display_extension: imageDisplayExtension
        };
    
        // ファイルダウンロード処理
        const jsonStr = JSON.stringify(jsonData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${charName}_ext.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    
        // モーダルを閉じる
        document.getElementById('stj_export_modal').style.display = 'none';
    }

    // カスタムアラート表示関数
    function showCustomAlert(message) {
        // 既存のアラートがあれば削除
        const existingAlert = document.getElementById('stj_custom_alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        // アラート要素を作成
        const alertDiv = document.createElement('div');
        alertDiv.id = 'stj_custom_alert';
        alertDiv.textContent = message;
        document.body.appendChild(alertDiv);
        
        // アラートを表示
        setTimeout(() => {
            alertDiv.style.opacity = '1';
            alertDiv.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 10);
        
        // 3秒後にフェードアウト
        setTimeout(() => {
            alertDiv.style.opacity = '0';
            alertDiv.style.transform = 'translate(-50%, -50%) scale(0.9)';
            
            // 完全に消去
            setTimeout(() => {
                if (alertDiv.parentNode) {
                    alertDiv.parentNode.removeChild(alertDiv);
                }
            }, 300);
        }, 3000);
    }

    // データ保存関数
    function saveData() {
        // 表示されているキャラクター名を取得
        const charName = document.getElementById('stj_char_name_display').textContent;
        if (!charName) {
            alert('キャラクター名が設定されていません');
            return;
        }

        // 基本データ収集（拡張子は保存しない）
        const data = {
            charName: charName,
            defaultImage: document.getElementById('stj_default_image').value,
            thumbnailImage: document.getElementById('stj_thumbnail_image').value,
            keywords: []
        };

        // キーワードデータ収集（拡張子は保存しない）
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

        // localStorageに保存（キャラ名をキーに使用）
        localStorage.setItem(`stj_editor_data_${charName}`, JSON.stringify(data));
        
        // カスタムアラート表示
        showCustomAlert('データを保存しました');
    }

    // 保存データ読み込み関数
    function loadSavedData(charName) {
        if (!charName) return;

        const savedData = localStorage.getItem(`stj_editor_data_${charName}`);
        if (!savedData) return;

        try {
            const data = JSON.parse(savedData);
            
            // 基本データ設定
            document.getElementById('stj_default_image').value = data.defaultImage || '';
            document.getElementById('stj_thumbnail_image').value = data.thumbnailImage || '';

            // キーワード行をリセット
            const container = document.getElementById('stj_keywords_container');
            container.innerHTML = '';
            
            // 保存されたキーワード行を再構築
            if (data.keywords && data.keywords.length > 0) {
                data.keywords.forEach((kw, index) => {
                    addKeywordRowWithData(container, index, kw);
                });
            }
            
            // プレビューを更新
            setTimeout(updatePreview, 100);
        } catch (e) {
            console.error('保存データの読み込みに失敗しました', e);
        }
    }

    // データ付きキーワード行追加関数
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
        newItem.querySelector('.stj-delete-row').addEventListener('click', function() {
            newItem.remove();
        });
    }

    // パネルが開かれたことを検出するObserver
    function observePanel() {
        const targetNode = document.getElementById('right-nav-panel');
        if (!targetNode) {
            // パネルがまだない場合、再試行
            setTimeout(observePanel, 500);
            return;
        }

        const config = { childList: true, subtree: true };
        
        const callback = function(mutationsList, observer) {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    // キャラクター編集パネルが開かれたか確認
                    if (document.getElementById('rm_ch_create_block')) {
                        createExportButton();
                    }
                }
            }
        };

        const observer = new MutationObserver(callback);
        observer.observe(targetNode, config);
    }

    // 初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            // 既にパネルが開いている場合
            if (document.getElementById('rm_ch_create_block')) {
                createExportButton();
            }
            observePanel();
        });
    } else {
        if (document.getElementById('rm_ch_create_block')) {
            createExportButton();
        }
        observePanel();
    }
})();
