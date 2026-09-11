(function () {
    const MODULE_NAME = 'stj_editor';
    const LOG_PREFIX = '[StjEditor DEBUG]';

    // --- 拡張子自動検出＆動画対応ロジック ---
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm'];

    function isVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return !!url.match(/\.(mp4|webm)$/i);
    }

    function checkMediaExists(mediaUrl) {
        return new Promise((resolve) => {
            if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) return resolve(false);
            if (isVideoUrl(mediaUrl)) {
                const video = document.createElement('video');
                video.onloadedmetadata = () => resolve(true);
                video.onerror = () => resolve(false);
                video.src = mediaUrl;
            } else {
                const img = new Image();
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = mediaUrl;
            }
        });
    }

    async function detectMediaExtension(basePath) {
        if (!basePath || typeof basePath !== 'string' || !basePath.trim()) return null;
        const cleanPath = basePath.trim();
        
        if (cleanPath.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp|mp4|webm)$/i)) {
            return cleanPath;
        }

        for (const ext of ALLOWED_EXTENSIONS) {
            const pathWithExt = `${cleanPath}.${ext}`;
            const exists = await checkMediaExists(pathWithExt);
            if (exists) {
                return pathWithExt;
            }
        }
        return null;
    }

    // --- メディアDOM要素（img または video）の生成 ---
    function createMediaElement(src, altText = '') {
        if (isVideoUrl(src)) {
            const video = document.createElement('video');
            video.src = src;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.classList.add('stj-media-preview');
            
            video.style.maxWidth = '100%';
            video.style.maxHeight = '180px';
            video.style.objectFit = 'contain';
            video.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
            video.style.display = 'block';
            video.style.borderRadius = '5px';
            video.style.marginTop = '5px';

            video.play().catch(() => {});
            return video;
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.alt = altText;
            img.classList.add('stj-media-preview');
            
            img.style.maxWidth = '100%';
            img.style.maxHeight = '180px';
            img.style.objectFit = 'contain';
            img.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
            img.style.display = 'block';
            img.style.borderRadius = '5px';
            img.style.marginTop = '5px';

            return img;
        }
    }

    // --- モーダルエディタの生成 & 表示 ---
    async function openStjEditor() {
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const character = context?.characters?.[context.characterId];
        const charName = character?.name;

        if (!charName) {
            alert('現在選択されているキャラクターが見つかりません。チャット画面でキャラクターを選択してください。');
            return;
        }

        const oldModal = document.getElementById('stj-editor-modal');
        if (oldModal) oldModal.remove();

        // データの取得 (_ext.json)
        let jsonData = {};
        const jsonPath = `addchara/${charName}/${charName}_ext.json`;
        try {
            const resp = await fetch(jsonPath);
            if (resp.ok) {
                jsonData = await resp.json();
            }
        } catch (e) {
            console.warn(`${LOG_PREFIX} JSONの読み込み失敗 (新規作成します):`, e);
        }

        // モーダル外枠
        const modal = document.createElement('div');
        modal.id = 'stj-editor-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
            align-items: center; z-index: 100000; color: #fff; font-family: sans-serif;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #222530; border: 1px solid #444b60; border-radius: 8px;
            padding: 20px; width: 650px; max-width: 92vw; max-height: 85vh;
            display: flex; flex-direction: column; gap: 12px; overflow-y: auto; box-shadow: 0 5px 20px rgba(0,0,0,0.5);
        `;

        dialog.innerHTML = `
            <div style="display:flex; justify-size:space-between; align-items:center; border-bottom: 1px solid #444; padding-bottom: 8px;">
                <h3 style="margin:0; font-size: 1.2em; color: #4da6ff;">⚙️ JSONデータ編集: ${charName}</h3>
            </div>
            <p style="font-size:0.85em; opacity:0.8; margin:0;">各感情・状態キー（default, happy, thumbnail など）に対応する画像/動画ファイル名を保存します。</p>
            <div id="stj-fields-container" style="display:flex; flex-direction:column; gap:12px; margin-top:10px;"></div>
            <div style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end; border-top: 1px solid #444; padding-top: 12px;">
                <button id="stj-add-key-btn" class="menu_button" style="background:#3a3f58; color:#fff;">+ キーを追加</button>
                <button id="stj-save-btn" class="menu_button result_condition_active" style="background:#28a745; color:#fff;">保存</button>
                <button id="stj-close-btn" class="menu_button" style="background:#555; color:#fff;">キャンセル</button>
            </div>
        `;

        modal.appendChild(dialog);
        document.body.appendChild(modal);

        const container = dialog.querySelector('#stj-fields-container');

        async function renderField(key, value) {
            const row = document.createElement('div');
            row.className = 'stj-item-row';
            row.style.cssText = 'background: #1a1c23; padding: 10px; border-radius: 5px; border: 1px solid #333d52;';

            const topDiv = document.createElement('div');
            topDiv.style.cssText = 'display: flex; gap: 8px; align-items: center;';

            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.value = key;
            keyInput.placeholder = 'キー名 (例: default, happy)';
            keyInput.style.cssText = 'flex: 1; padding: 6px; background: #0e1015; color: #fff; border: 1px solid #444; border-radius: 4px;';

            const valInput = document.createElement('input');
            valInput.type = 'text';
            valInput.value = value;
            valInput.placeholder = 'ファイル名 (例: defa.png, sakiba.mp4)';
            valInput.style.cssText = 'flex: 2; padding: 6px; background: #0e1015; color: #fff; border: 1px solid #444; border-radius: 4px;';

            const delBtn = document.createElement('button');
            delBtn.textContent = '削除';
            delBtn.style.cssText = 'background: #dc3545; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;';
            delBtn.onclick = () => row.remove();

            topDiv.appendChild(keyInput);
            topDiv.appendChild(valInput);
            topDiv.appendChild(delBtn);

            const previewArea = document.createElement('div');
            previewArea.style.marginTop = '6px';

            const updatePreview = async () => {
                previewArea.innerHTML = '';
                let path = valInput.value.trim();
                if (path) {
                    if (!path.startsWith('http') && !path.includes('/')) {
                        path = `addchara/${charName}/${path}`;
                    }
                    const detected = await detectMediaExtension(path);
                    if (detected) {
                        previewArea.appendChild(createMediaElement(detected));
                    }
                }
            };

            valInput.addEventListener('input', updatePreview);
            updatePreview();

            row.appendChild(topDiv);
            row.appendChild(previewArea);
            container.appendChild(row);
        }

        for (const [k, v] of Object.entries(jsonData)) {
            const valStr = Array.isArray(v) ? v[0] : v;
            await renderField(k, valStr);
        }

        dialog.querySelector('#stj-add-key-btn').onclick = () => renderField('', '');
        dialog.querySelector('#stj-close-btn').onclick = () => modal.remove();

        dialog.querySelector('#stj-save-btn').onclick = async () => {
            const rows = container.querySelectorAll('.stj-item-row');
            const newJson = {};
            rows.forEach(r => {
                const inputs = r.querySelectorAll('input');
                const k = inputs[0].value.trim();
                const v = inputs[1].value.trim();
                if (k) newJson[k] = v;
            });

            try {
                const response = await fetch('/api/plugins/stj_editor/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ charName, data: newJson })
                });

                if (response.ok) {
                    alert('JSONデータを保存しました。');
                    modal.remove();
                    if (context && context.eventSource) {
                        context.eventSource.emit(context.eventTypes.CHARACTER_SELECTED, context.characterId);
                    }
                } else {
                    const blob = new Blob([JSON.stringify(newJson, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${charName}_ext.json`;
                    a.click();
                    alert('API未応答のため、JSONファイルをダウンロードしました。');
                    modal.remove();
                }
            } catch (err) {
                console.error(`${LOG_PREFIX} 保存エラー:`, err);
                alert('保存処理に失敗しました。');
            }
        };
    }

    // --- ボタンのUI注入 (複数の場所に安全に追加) ---
    function injectEditorButton() {
        if (document.getElementById('stj-edit-json-btn')) return;

        // ボタン作成
        const btn = document.createElement('div');
        btn.id = 'stj-edit-json-btn';
        btn.className = 'menu_button fa-solid fa-file-code interactable';
        btn.title = 'JSONデータ編集 (Stj Editor)';
        btn.style.cssText = 'cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 6px 10px; margin: 2px; font-weight: bold; background: rgba(77, 166, 255, 0.2); border: 1px solid #4da6ff; border-radius: 4px; color: #fff;';
        btn.innerHTML = '<span style="font-size: 0.9em; margin-left: 4px;">⚙️ JSON編集</span>';
        
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            openStjEditor();
        };

        // 優先度1: トップバー (画面上部メニュー)
        const topBar = document.querySelector('#top-bar, #top_bar, .top-bar-controls');
        // 優先度2: キャラクター管理ポップアップ内
        const charPopup = document.querySelector('#character_popup .extra_editor_buttons, #character_popup, #character_edit_fields');
        // 優先度3: 拡張機能メニュー / ツールバー
        const extMenu = document.querySelector('#extensions_settings, #rm_extensions_block');

        if (topBar) {
            topBar.appendChild(btn);
            console.log(`${LOG_PREFIX} 「JSONデータ編集」ボタンをトップバーに追加しました。`);
        } else if (charPopup) {
            charPopup.appendChild(btn);
            console.log(`${LOG_PREFIX} 「JSONデータ編集」ボタンをキャラ設定領域に追加しました。`);
        } else if (extMenu) {
            extMenu.appendChild(btn);
            console.log(`${LOG_PREFIX} 「JSONデータ編集」ボタンを拡張機能メニューに追加しました。`);
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    const debouncedInject = debounce(injectEditorButton, 300);

    // --- DOM監視 ---
    function setupMutationObserver() {
        const observer = new MutationObserver(() => debouncedInject());
        observer.observe(document.body, { childList: true, subtree: true });
        console.log(`${LOG_PREFIX} エディタUI描画の監視を開始しました。`);
    }

    // --- SillyTavern イベントリスナー ---
    function setupEventSourceListeners() {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const context = SillyTavern.getContext();
            if (context && context.eventSource && context.eventTypes) {
                const { eventSource, eventTypes } = context;

                const safeOn = (eventType, handler) => {
                    if (eventType && typeof eventSource.on === 'function') {
                        eventSource.on(eventType, handler);
                    }
                };

                safeOn(eventTypes.CHARACTER_EDITOR_OPENED, debouncedInject);
                safeOn(eventTypes.CHARACTER_SELECTED, debouncedInject);
                safeOn(eventTypes.CHARACTER_PAGE_LOADED, debouncedInject);
                safeOn(eventTypes.APP_READY, debouncedInject);
            }
        }
    }

    // --- 初期化 ---
    function init() {
        console.log(`${LOG_PREFIX} Stj Editor extension loaded with TopBar & Modal Support`);
        setupEventSourceListeners();
        setupMutationObserver();
        setTimeout(debouncedInject, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
