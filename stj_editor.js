(function() {
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm'];
    const MODULE_NAME = 'stj_editor';

    const mediaCache = new Map();

    let stjModalEl = null;
    let stjButtonEl = null;
    let outsideClickHandlerInstalled = false;
    let modalOpenedTimestamp = 0;
    const MODAL_OPEN_GUARD_MS = 300;

    let confirmDialogEl = null;
    let pendingDeleteCallback = null;

    let pointerDragState = null;
    let pointerDragHandlerInstalled = false;
    const DRAG_THRESHOLD_PX = 5;

    // ===== 自動スクロール関連 =====
    const AUTOSCROLL_EDGE_PX = 70;       // 上下端から何px以内でスクロール開始するか
    const AUTOSCROLL_MAX_SPEED = 22;     // 1フレームあたりの最大スクロール量(px)
    let autoScrollRAF = null;
    let autoScrollTarget = null;
    let autoScrollDelta = 0;

    function isVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return !!url.match(/\.(mp4|webm)$/i);
    }

    function getSTContext() {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            return window.SillyTavern.getContext();
        }
        return null;
    }

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

    function persistSettings() {
        const context = getSTContext();
        if (context && typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
        } else {
            console.warn('[STJ Editor] saveSettingsDebounced が利用できないため設定を保存できませんでした。');
        }
    }

    function detectCharacterNameFromDOM() {
        const nameHolder = document.querySelector('#character_name_holder');
        if (nameHolder && nameHolder.textContent) return nameHolder.textContent.trim();
        const greetingMessage = document.querySelector('.mes[mesid="0"][is_user="false"]');
        if (greetingMessage && greetingMessage.getAttribute('ch_name')) return greetingMessage.getAttribute('ch_name');
        return null;
    }

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

    async function detectImageExtension(charName, fileNameWithExt) {
        if (!charName || !fileNameWithExt) return null;
        const path = fileNameWithExt.startsWith('addchara/')
            ? fileNameWithExt
            : `addchara/${charName}/${fileNameWithExt}`;
        const exists = await checkMediaExists(path);
        return exists ? path : null;
    }

    function extractFileNameFromPath(path) {
        if (!path) return '';
        const parts = path.split('/');
        return parts[parts.length - 1];
    }

    function parseImageNames(input) {
        if (!input) return [];
        return input.split(',').map(name => name.trim()).filter(name => name.length > 0);
    }

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

    // --- 条件評価エンジン ---
    function normalizeConditionExpression(expr) {
        if (!expr || typeof expr !== 'string') return '';
        return expr
            .replace(/\band\b/gi, '+')
            .replace(/\bor\b/gi, ',')
            .replace(/\bnot\b/gi, '!');
    }

    function tokenizeCondition(expr) {
        const tokens = [];
        let i = 0;
        const len = expr.length;
        while (i < len) {
            const ch = expr[i];
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
            if (ch === '(' || ch === ')' || ch === '!' || ch === '+' || ch === ',') {
                tokens.push({ type: ch, value: ch });
                i++;
                continue;
            }
            let j = i;
            while (j < len && !'()!+,'.includes(expr[j])) j++;
            const raw = expr.slice(i, j).trim();
            if (raw) tokens.push({ type: 'KEYWORD', value: raw });
            i = j > i ? j : i + 1;
        }
        return tokens;
    }

    function parseConditionTokens(tokens) {
        let pos = 0;
        const peek = () => tokens[pos];
        const consume = (type) => {
            const t = tokens[pos];
            if (t && t.type === type) { pos++; return t; }
            return null;
        };

        function parseOr() {
            let node = parseAnd();
            while (peek() && peek().type === ',') {
                consume(',');
                const right = parseAnd();
                node = { type: 'OR', left: node, right };
            }
            return node;
        }
        function parseAnd() {
            let node = parseUnary();
            while (peek() && peek().type === '+') {
                consume('+');
                const right = parseUnary();
                node = { type: 'AND', left: node, right };
            }
            return node;
        }
        function parseUnary() {
            if (peek() && peek().type === '!') {
                consume('!');
                return { type: 'NOT', operand: parseUnary() };
            }
            return parsePrimary();
        }
        function parsePrimary() {
            const t = peek();
            if (!t) return null;
            if (t.type === '(') {
                consume('(');
                const inner = parseOr();
                consume(')');
                return inner;
            }
            if (t.type === 'KEYWORD') {
                consume('KEYWORD');
                return { type: 'KEYWORD', value: t.value };
            }
            return null;
        }
        return parseOr();
    }

    function evaluateConditionNode(node, lowerText) {
        if (!node) return false;
        switch (node.type) {
            case 'KEYWORD':
                return lowerText.includes(node.value.toLowerCase());
            case 'AND':
                return evaluateConditionNode(node.left, lowerText) && evaluateConditionNode(node.right, lowerText);
            case 'OR':
                return evaluateConditionNode(node.left, lowerText) || evaluateConditionNode(node.right, lowerText);
            case 'NOT':
                return !evaluateConditionNode(node.operand, lowerText);
            default:
                return false;
        }
    }

    function evaluateCondition(condStr, text) {
        if (!condStr || !text) return false;
        try {
            const normalized = normalizeConditionExpression(condStr);
            const tokens = tokenizeCondition(normalized);
            if (tokens.length === 0) return false;
            const ast = parseConditionTokens(tokens);
            return evaluateConditionNode(ast, text.toLowerCase());
        } catch (error) {
            console.error(`❌ 条件評価エラー "${condStr}":`, error);
            return false;
        }
    }

    function calcConditionComplexity(condition) {
        if (!condition || typeof condition !== 'string') return 0;
        return (
            (condition.match(/\band\b/gi) || []).length * 10 +
            (condition.match(/\bor\b/gi)  || []).length * 5  +
            (condition.match(/\+/g)       || []).length * 8  +
            (condition.match(/,/g)        || []).length * 4  +
            (condition.match(/!/g)        || []).length * 6  +
            (condition.match(/\(/g)       || []).length * 3  +
            (condition.match(/\)/g)       || []).length * 3  +
            condition.length
        );
    }

    function showDeleteConfirmDialog(onConfirm) {
        if (!confirmDialogEl) return;
        pendingDeleteCallback = onConfirm;
        confirmDialogEl.style.display = 'flex';
    }

    function hideDeleteConfirmDialog() {
        if (!confirmDialogEl) return;
        confirmDialogEl.style.display = 'none';
        pendingDeleteCallback = null;
    }

    function swapCells(a, b) {
        if (!a || !b || a === b) return;
        const parent = a.parentNode;
        if (!parent || parent !== b.parentNode) return;
        const placeholder = document.createComment('stj-swap');
        parent.insertBefore(placeholder, a);
        parent.insertBefore(a, b);
        parent.insertBefore(b, placeholder);
        parent.removeChild(placeholder);
    }

    // ===== 自動スクロール =====
    function findScrollableAncestor(el) {
        let cur = el ? el.parentElement : null;
        while (cur && cur !== document.body && cur !== document.documentElement) {
            const style = window.getComputedStyle(cur);
            const oy = style.overflowY;
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay')
                && cur.scrollHeight > cur.clientHeight + 1) {
                return cur;
            }
            cur = cur.parentElement;
        }
        // フォールバック：document のスクロール要素
        return document.scrollingElement || document.documentElement;
    }

    function stopAutoScroll() {
        if (autoScrollRAF) {
            cancelAnimationFrame(autoScrollRAF);
            autoScrollRAF = null;
        }
        autoScrollTarget = null;
        autoScrollDelta = 0;
    }

    function autoScrollStep() {
        autoScrollRAF = null;
        if (!pointerDragState || !autoScrollTarget || autoScrollDelta === 0) return;

        const before = autoScrollTarget.scrollTop;
        autoScrollTarget.scrollTop = before + autoScrollDelta;

        // スクロール後にカーソル下のセルを再検出してハイライトを更新
        if (pointerDragState.isDragging) {
            updateDragTarget(pointerDragState, pointerDragState.lastX, pointerDragState.lastY);
        }

        // まだ端にいるならループ継続
        if (autoScrollTarget.scrollTop !== before || autoScrollDelta !== 0) {
            autoScrollRAF = requestAnimationFrame(autoScrollStep);
        }
    }

    function updateAutoScroll(container, cursorY) {
        if (!container) {
            stopAutoScroll();
            return;
        }
        const rect = container.getBoundingClientRect();
        const topDist = cursorY - rect.top;
        const bottomDist = rect.bottom - cursorY;

        let delta = 0;
        if (topDist >= 0 && topDist < AUTOSCROLL_EDGE_PX) {
            // 上端付近：上方向へスクロール（端に近いほど速い）
            const ratio = (AUTOSCROLL_EDGE_PX - topDist) / AUTOSCROLL_EDGE_PX;
            delta = -Math.ceil(ratio * AUTOSCROLL_MAX_SPEED);
        } else if (bottomDist >= 0 && bottomDist < AUTOSCROLL_EDGE_PX) {
            const ratio = (AUTOSCROLL_EDGE_PX - bottomDist) / AUTOSCROLL_EDGE_PX;
            delta = Math.ceil(ratio * AUTOSCROLL_MAX_SPEED);
        }

        autoScrollTarget = container;
        autoScrollDelta = delta;

        if (delta !== 0) {
            if (!autoScrollRAF) {
                autoScrollRAF = requestAnimationFrame(autoScrollStep);
            }
        } else {
            stopAutoScroll();
        }
    }

    function updateDragTarget(s, x, y) {
        const el = document.elementFromPoint(x, y);
        const target = el && el.closest ? el.closest('.stj-keyword-item') : null;
        const validTarget = (target && target !== s.sourceItem) ? target : null;

        if (s.currentTarget && s.currentTarget !== validTarget) {
            s.currentTarget.classList.remove('stj-drag-over');
        }
        s.currentTarget = validTarget;
        if (validTarget) {
            validTarget.classList.add('stj-drag-over');
        }
    }

    // ===== カスタムドラッグゴースト =====
    function createDragGhost(sourceItem, cursorX, cursorY) {
        const previewEl = sourceItem.querySelector('.stj-image-preview');
        if (!previewEl) return null;

        const rect = previewEl.getBoundingClientRect();

        const ghost = document.createElement('div');
        ghost.className = 'stj-drag-ghost';

        const container = sourceItem.parentNode;
        if (container) {
            const items = Array.from(container.querySelectorAll('.stj-keyword-item'));
            const num = items.indexOf(sourceItem) + 1;
            ghost.dataset.cellNum = String(num);
        }

        const media = previewEl.querySelector('img, video');
        if (media) {
            const cloned = media.cloneNode(true);
            cloned.style.width = '100%';
            cloned.style.height = '100%';
            cloned.style.objectFit = 'contain';
            cloned.style.display = 'block';
            cloned.style.pointerEvents = 'none';
            cloned.removeAttribute('id');
            if (cloned.tagName === 'VIDEO') {
                cloned.muted = true;
                cloned.autoplay = true;
                cloned.loop = true;
                cloned.playsInline = true;
                cloned.play().catch(() => {});
            }
            ghost.appendChild(cloned);
        } else {
            const fallback = document.createElement('div');
            fallback.textContent = 'プレビュー';
            fallback.style.position = 'absolute';
            fallback.style.top = '50%';
            fallback.style.left = '50%';
            fallback.style.transform = 'translate(-50%, -50%)';
            fallback.style.color = '#a0aec0';
            fallback.style.fontSize = '14px';
            fallback.style.pointerEvents = 'none';
            ghost.appendChild(fallback);
        }

        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        const offsetX = cursorX - rect.left;
        const offsetY = cursorY - rect.top;
        ghost.style.left = (cursorX - offsetX) + 'px';
        ghost.style.top = (cursorY - offsetY) + 'px';

        document.body.appendChild(ghost);

        return { el: ghost, offsetX, offsetY };
    }

    function moveDragGhost(ghostState, cursorX, cursorY) {
        if (!ghostState || !ghostState.el) return;
        ghostState.el.style.left = (cursorX - ghostState.offsetX) + 'px';
        ghostState.el.style.top = (cursorY - ghostState.offsetY) + 'px';
    }

    function removeDragGhost(ghostState) {
        if (!ghostState) return;
        if (ghostState.el && ghostState.el.parentNode) {
            ghostState.el.parentNode.removeChild(ghostState.el);
        }
    }

    function installPointerDragHandlers() {
        if (pointerDragHandlerInstalled) return;
        pointerDragHandlerInstalled = true;

        document.addEventListener('mousemove', (e) => {
            if (!pointerDragState) return;
            const s = pointerDragState;
            s.lastX = e.clientX;
            s.lastY = e.clientY;

            const dx = e.clientX - s.startX;
            const dy = e.clientY - s.startY;

            if (!s.isDragging && (dx * dx + dy * dy) > (DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX)) {
                s.isDragging = true;
                s.sourceItem.classList.add('stj-dragging');
                s.ghostState = createDragGhost(s.sourceItem, e.clientX, e.clientY);
                s.scrollContainer = findScrollableAncestor(s.sourceItem);
                // ★ ドラッグ中はテスト枠を無視するクラスを付与
                if (stjModalEl) stjModalEl.classList.add('stj-drag-active');
            }

            if (!s.isDragging) return;

            moveDragGhost(s.ghostState, e.clientX, e.clientY);
            updateDragTarget(s, e.clientX, e.clientY);
            updateAutoScroll(s.scrollContainer, e.clientY);
        });

        document.addEventListener('mouseup', () => {
            if (!pointerDragState) return;
            const s = pointerDragState;
            pointerDragState = null;

            stopAutoScroll();
            // ★ ドラッグ終了：テスト枠を元に戻す
            if (stjModalEl) stjModalEl.classList.remove('stj-drag-active');

            if (s.sourceItem) s.sourceItem.classList.remove('stj-dragging');
            if (s.currentTarget) s.currentTarget.classList.remove('stj-drag-over');
            removeDragGhost(s.ghostState);

            if (s.isDragging) {
                if (s.currentTarget && s.currentTarget !== s.sourceItem) {
                    swapCells(s.sourceItem, s.currentTarget);
                    runLiveTest();
                }
            } else {
                if (s.sourceItem && !s.sourceItem.classList.contains('editing')) {
                    s.sourceItem.classList.add('editing');
                }
            }
        });

        window.addEventListener('blur', () => {
            if (!pointerDragState) return;
            const s = pointerDragState;
            pointerDragState = null;
            stopAutoScroll();
            // ★ ドラッグ強制終了時もクラスを除去
            if (stjModalEl) stjModalEl.classList.remove('stj-drag-active');
            if (s.sourceItem) s.sourceItem.classList.remove('stj-dragging');
            if (s.currentTarget) s.currentTarget.classList.remove('stj-drag-over');
            removeDragGhost(s.ghostState);
        });
    }

    function createExportButton() {
        const buttonContainer = document.querySelector('#rm_ch_create_block .form_create_bottom_buttons_block');
        if (!buttonContainer) return;

        if (stjButtonEl && document.body.contains(stjButtonEl)) {
            if (stjButtonEl.parentNode !== buttonContainer) {
                buttonContainer.prepend(stjButtonEl);
            }
        } else {
            const exportButton = document.createElement('button');
            exportButton.id = 'stj_export_button';
            exportButton.textContent = 'JSONデータ編集';
            exportButton.className = 'menu_button';
            exportButton.addEventListener('click', handleExportButtonClick, true);
            buttonContainer.prepend(exportButton);
            stjButtonEl = exportButton;
        }

        if (!stjModalEl || !document.body.contains(stjModalEl)) {
            createExportModal();
        }
    }

    function handleExportButtonClick(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        openExportModal();
    }

    function openExportModal() {
        if (!stjModalEl) return;

        stjModalEl.style.display = 'block';
        stjModalEl.style.position = 'fixed';
        stjModalEl.style.top = '0px';
        stjModalEl.style.left = '0vw';
        stjModalEl.style.width = '85vw';
        stjModalEl.style.height = '100vh';
        stjModalEl.style.zIndex = '10001';
        stjModalEl.scrollTop = 0;

        modalOpenedTimestamp = Date.now();

        const charName = detectCharacterNameFromDOM() || '';
        const nameEl = document.getElementById('stj_char_name_display');
        if (nameEl) nameEl.textContent = charName;

        (async () => {
            try {
                await loadExistingJSONData(charName);
                loadSavedData(charName);
                setupPreviewListeners();
                runLiveTest();
            } catch (err) {
                console.error('[STJ Editor] モーダル表示エラー:', err);
            }
        })();
    }

    function closeExportModal() {
        if (!stjModalEl) return;
        stjModalEl.style.display = 'none';
    }

    const applyBtnStyle = 'margin-top: 6px; padding: 6px 14px; font-size: 13px; font-weight: bold; color: #000000; background-color: #e0e0e0; border: 1px solid #aaa; border-radius: 4px; cursor: pointer; display: inline-block; width: fit-content;';

    function createExportModal() {
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

            <div id="stj_test_section" style="position: sticky; top: 0; z-index: 100; background: #1e1e1e; border: 1px solid #555; padding: 10px; margin-bottom: 15px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
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
                                <button type="button" class="stj-apply-special" data-target="default" style="${applyBtnStyle}">決定</button>
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
                                <button type="button" class="stj-apply-special" data-target="thumbnail" style="${applyBtnStyle}">決定</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="stj_keywords_container" class="stj-grid-container">
                <div class="stj-keyword-item editing">
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
                                    <button type="button" class="stj-apply-row" style="${applyBtnStyle}">決定</button>
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

            <div id="stj_confirm_dialog">
                <div class="stj-confirm-box">
                    <div class="stj-confirm-message">本当に削除しますか？</div>
                    <div class="stj-confirm-buttons">
                        <button type="button" class="stj-confirm-yes">はい</button>
                        <button type="button" class="stj-confirm-no">いいえ</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        stjModalEl = modal;
        confirmDialogEl = modal.querySelector('#stj_confirm_dialog');

        if (confirmDialogEl) {
            confirmDialogEl.addEventListener('click', (e) => e.stopPropagation());
            confirmDialogEl.querySelector('.stj-confirm-yes').addEventListener('click', (e) => {
                e.stopPropagation();
                const cb = pendingDeleteCallback;
                hideDeleteConfirmDialog();
                if (typeof cb === 'function') {
                    try { cb(); } catch (err) { console.error(err); }
                }
            });
            confirmDialogEl.querySelector('.stj-confirm-no').addEventListener('click', (e) => {
                e.stopPropagation();
                hideDeleteConfirmDialog();
            });
        }

        modal.addEventListener('click', (e) => e.stopPropagation());

        const testInput = document.getElementById('stj_test_input');
        if (testInput) {
            testInput.addEventListener('input', runLiveTest);
        }

        const addBtn = document.getElementById('stj_add_keyword');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                addKeywordRow(modal);
            });
        }

        const cancelBtn = document.getElementById('stj_cancel_export');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeExportModal();
            });
        }

        const exportBtn = document.getElementById('stj_export_json');
        if (exportBtn) {
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exportJSON();
            });
        }

        const saveBtn = document.getElementById('stj_save_data');
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                saveData();
            });
        }

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

        installPointerDragHandlers();

        if (!outsideClickHandlerInstalled) {
            outsideClickHandlerInstalled = true;
            document.addEventListener('mousedown', (e) => {
                if (!stjModalEl) return;
                if (stjModalEl.style.display !== 'block') return;
                if (Date.now() - modalOpenedTimestamp < MODAL_OPEN_GUARD_MS) return;
                if (stjModalEl.contains(e.target)) return;
                if (stjButtonEl && stjButtonEl.contains(e.target)) return;
                closeExportModal();
            }, true);
        }
    }

    function attachKeywordRowListeners(item, index) {
        const previewEl = item.querySelector('.stj-image-preview');
        if (previewEl) {
            previewEl.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                if (item.classList.contains('editing')) return;

                const target = e.target;
                if (target && target.closest && target.closest('button')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                pointerDragState = {
                    sourceItem: item,
                    startX: e.clientX,
                    startY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    isDragging: false,
                    currentTarget: null,
                    ghostState: null,
                    scrollContainer: null
                };
            });
        }

        const deleteButton = item.querySelector('.stj-delete-row');
        if (deleteButton) {
            deleteButton.addEventListener('click', function(e) {
                e.stopPropagation();
                showDeleteConfirmDialog(() => {
                    item.remove();
                    runLiveTest();
                });
            });
        }

        const applyButton = item.querySelector('.stj-apply-row');
        if (applyButton) {
            applyButton.addEventListener('click', function(e) {
                e.stopPropagation();
                updateSinglePreviewByItem(item);
                item.classList.remove('editing');
            });
        }

        const inputs = item.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', runLiveTest);
            // ★ Enter キーで決定ボタンと同じ動作
            input.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter') return;
                if (e.shiftKey) return;
                if (e.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                e.stopPropagation();
                updateSinglePreviewByItem(item);
                item.classList.remove('editing');
            });
        });
    }

    function runLiveTest() {
        const testInput = document.getElementById('stj_test_input');
        const testResult = document.getElementById('stj_test_result');
        if (!testInput || !testResult) return;

        const text = testInput.value.trim();
        const items = document.querySelectorAll('.stj-keyword-item');

        items.forEach(item => {
            item.style.border = '';
            item.style.backgroundColor = '';
        });

        if (!text) {
            testResult.innerHTML = '判定結果: <span style="color: #aaa; font-weight: normal;">文章を入力するとヒットするキーワードが表示されます</span>';
            return;
        }

        const candidates = [];
        items.forEach(item => {
            const kwInput = item.querySelector('.stj-keyword-input');
            const imgInput = item.querySelector('.stj-image-input');
            if (!kwInput || !imgInput) return;
            const kw = kwInput.value.trim();
            if (!kw) return;

            candidates.push({
                element: item,
                keyword: kw,
                imageName: imgInput.value.trim(),
                complexity: calcConditionComplexity(kw)
            });
        });
        candidates.sort((a, b) => b.complexity - a.complexity);

        let matched = null;
        for (const c of candidates) {
            try {
                if (evaluateCondition(c.keyword, text)) {
                    matched = c;
                    break;
                }
            } catch (e) {
                console.error(`条件評価エラー "${c.keyword}":`, e);
            }
        }

        if (matched) {
            testResult.innerHTML = `判定結果: <span style="color: #64b5f6; font-size: 15px;">「${matched.keyword}」</span> にマッチしました！ (ファイル: ${matched.imageName || '未指定'})`;
            matched.element.style.border = '2px solid #64b5f6';
            matched.element.style.backgroundColor = 'rgba(100, 181, 246, 0.15)';
        } else {
            const defaultImg = document.getElementById('stj_default_image')?.value.trim();
            testResult.innerHTML = `判定結果: <span style="color: #ffb74d;">一致するキーワードがありません（デフォルト「${defaultImg || 'defa'}」が適用されます）</span>`;
        }
    }

    function addKeywordRow(modal) {
        const container = modal.querySelector('#stj_keywords_container');
        const itemCount = container.querySelectorAll('.stj-keyword-item').length;
        const newItem = document.createElement('div');
        newItem.className = 'stj-keyword-item editing';
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
                            <button type="button" class="stj-apply-row" style="${applyBtnStyle}">決定</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(newItem);

        attachKeywordRowListeners(newItem, itemCount);

        modal.scrollTop = modal.scrollHeight;
        setTimeout(() => updateSinglePreviewByItem(newItem), 100);
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
            const el = document.getElementById('stj_default_image');
            if (el) el.value = toInputValue(imageMap.default);
        }
        if (imageMap.thumbnail !== undefined) {
            const el = document.getElementById('stj_thumbnail_image');
            if (el) el.value = toInputValue(imageMap.thumbnail);
        }

        const container = document.getElementById('stj_keywords_container');
        if (!container) return;
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
        const nameEl = document.getElementById('stj_char_name_display');
        if (!nameEl) return;
        const charName = nameEl.textContent;
        await updateImagePreview('stj_preview_default', charName, document.getElementById('stj_default_image')?.value);
        await updateImagePreview('stj_preview_thumbnail', charName, document.getElementById('stj_thumbnail_image')?.value);
        const keywordItems = document.querySelectorAll('.stj-keyword-item');
        for (const item of keywordItems) {
            await updateSinglePreviewByItem(item);
        }
    }

    async function updateSinglePreviewByItem(item) {
        if (!item) return;
        const nameEl = document.getElementById('stj_char_name_display');
        if (!nameEl) return;
        const charName = nameEl.textContent;
        const imageInput = item.querySelector('.stj-image-input');
        const previewEl = item.querySelector('.stj-image-preview');
        if (!imageInput || !previewEl) return;
        await updateImagePreview(previewEl.id, charName, imageInput.value);
    }

    function attachPreviewNavButtonGuards(btn) {
        const stopAll = (e) => {
            e.stopPropagation();
            if (e.type === 'mousedown') {
                e.preventDefault();
            }
        };
        btn.addEventListener('mousedown', stopAll);
        btn.addEventListener('mouseup', stopAll);
        btn.addEventListener('dblclick', stopAll);
    }

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
                if (vid) vid.play().catch(() => {});
            }

            if (imageNames.length > 1) {
                const leftButton = document.createElement('button');
                leftButton.innerHTML = '←';
                leftButton.type = 'button';
                leftButton.style.position = 'absolute';
                leftButton.style.left = '5px';
                leftButton.style.top = '50%';
                leftButton.style.transform = 'translateY(-50%)';
                leftButton.style.zIndex = '25';
                leftButton.style.background = 'rgba(0,0,0,0.65)';
                leftButton.style.color = 'white';
                leftButton.style.border = '2px solid rgba(255,255,255,0.6)';
                leftButton.style.borderRadius = '4px';
                leftButton.style.padding = '5px 10px';
                leftButton.style.cursor = 'pointer';
                leftButton.style.pointerEvents = 'auto';
                attachPreviewNavButtonGuards(leftButton);
                leftButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    updateImagePreview(previewId, charName, rawValue, currentIndex - 1);
                });
                previewEl.appendChild(leftButton);

                const rightButton = document.createElement('button');
                rightButton.innerHTML = '→';
                rightButton.type = 'button';
                rightButton.style.position = 'absolute';
                rightButton.style.right = '5px';
                rightButton.style.top = '50%';
                rightButton.style.transform = 'translateY(-50%)';
                rightButton.style.zIndex = '25';
                rightButton.style.background = 'rgba(0,0,0,0.65)';
                rightButton.style.color = 'white';
                rightButton.style.border = '2px solid rgba(255,255,255,0.6)';
                rightButton.style.borderRadius = '4px';
                rightButton.style.padding = '5px 10px';
                rightButton.style.cursor = 'pointer';
                rightButton.style.pointerEvents = 'auto';
                attachPreviewNavButtonGuards(rightButton);
                rightButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    updateImagePreview(previewId, charName, rawValue, currentIndex + 1);
                });
                previewEl.appendChild(rightButton);

                const indexDisplay = document.createElement('div');
                indexDisplay.style.position = 'absolute';
                indexDisplay.style.bottom = '5px';
                indexDisplay.style.left = '50%';
                indexDisplay.style.transform = 'translateX(-50%)';
                indexDisplay.style.zIndex = '25';
                indexDisplay.style.background = 'rgba(0,0,0,0.65)';
                indexDisplay.style.color = 'white';
                indexDisplay.style.padding = '2px 8px';
                indexDisplay.style.borderRadius = '3px';
                indexDisplay.style.fontSize = '12px';
                indexDisplay.style.pointerEvents = 'none';
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
        const nameEl = document.getElementById('stj_char_name_display');
        const charName = nameEl ? nameEl.textContent : '';
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
        const nameEl = document.getElementById('stj_char_name_display');
        const charName = nameEl ? nameEl.textContent : '';
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
            const defEl = document.getElementById('stj_default_image');
            if (defEl) defEl.value = data.defaultImage || '';
            const thumbEl = document.getElementById('stj_thumbnail_image');
            if (thumbEl) thumbEl.value = data.thumbnailImage || '';
            const container = document.getElementById('stj_keywords_container');
            if (!container) return;
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
                            <button type="button" class="stj-apply-row" style="${applyBtnStyle}">決定</button>
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
