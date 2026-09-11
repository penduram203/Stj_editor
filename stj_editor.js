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
            
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'contain';
            video.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
            video.style.display = 'block';

            video.play().catch(err => {
                console.warn(`${LOG_PREFIX} 動画の自動再生がブロックされました:`, err);
            });

            video.onerror = async () => {
                console.warn(`${LOG_PREFIX} 動画読み込みエラー。拡張子再検出を実行: ${src}`);
                const detected = await detectMediaExtension(src);
                if (detected && detected !== src) {
                    video.src = detected;
                    video.play().catch(() => {});
                }
            };
            return video;
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.alt = altText;
            img.classList.add('stj-media-preview');
            
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';
            img.style.display = 'block';

            img.onerror = async () => {
                console.warn(`${LOG_PREFIX} 画像読み込みエラー。拡張子再検出を実行: ${src}`);
                const detected = await detectMediaExtension(src);
                if (detected && detected !== src) {
                    img.src = detected;
                }
            };
            return img;
        }
    }

    // --- メディアプレビューレンダラー ---
    async function renderMediaPreview(container, mediaPath) {
        if (!container) return;
        container.innerHTML = '';
        
        if (!mediaPath || typeof mediaPath !== 'string' || !mediaPath.trim()) {
            return;
        }

        const detectedPath = await detectMediaExtension(mediaPath);
        if (!detectedPath) {
            console.warn(`${LOG_PREFIX} メディアが見つかりませんでした: ${mediaPath}`);
            return;
        }

        const mediaEl = createMediaElement(detectedPath);
        container.appendChild(mediaEl);
    }

    // --- STJ Editor メインUIの初期化と入力フィールド監視 ---
    function setupEditorUI() {
        console.log(`${LOG_PREFIX} Setting up UI elements and event handlers...`);

        // 入力フィールドまたはJSONプレビューの更新イベントにフック
        document.addEventListener('input', async (e) => {
            if (e.target && (e.target.classList.contains('stj-input-path') || e.target.id === 'stj-image-path-input')) {
                const targetValue = e.target.value;
                const previewContainer = document.querySelector('#stj-preview-container, .stj-preview-area');
                if (previewContainer) {
                    await renderMediaPreview(previewContainer, targetValue);
                }
            }
        });

        // 既存のプレビュー領域を更新
        const existingInputs = document.querySelectorAll('.stj-input-path, #stj-image-path-input');
        existingInputs.forEach(async (input) => {
            const previewContainer = input.closest('.stj-item-row')?.querySelector('.stj-preview-container') || document.querySelector('#stj-preview-container');
            if (previewContainer && input.value) {
                await renderMediaPreview(previewContainer, input.value);
            }
        });
    }

    // デバウンス処理
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    const debouncedInitUI = debounce(setupEditorUI, 300);

    // --- DOM監視 ---
    function setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    const hasEditor = Array.from(mutation.addedNodes).some(node => 
                        node.nodeType === 1 && (node.id === 'stj-editor-container' || node.classList?.contains('stj-editor-panel') || node.querySelector?.('.stj-editor-panel'))
                    );
                    if (hasEditor) {
                        debouncedInitUI();
                        break;
                    }
                }
            }
        });

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

                safeOn(eventTypes.CHARACTER_SELECTED, debouncedInitUI);
                safeOn(eventTypes.CHARACTER_PAGE_LOADED, debouncedInitUI);

                console.log(`${LOG_PREFIX} Event listeners registered successfully`);
            }
        }
    }

    // --- 初期化 ---
    function init() {
        console.log(`${LOG_PREFIX} Stj Editor extension loaded with video support`);
        setupEventSourceListeners();
        setupMutationObserver();
        debouncedInitUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
