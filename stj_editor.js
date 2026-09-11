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

    // --- メディアDOM要素（img または video）の作成 ---
    function createMediaPreviewElement(src, altText = '') {
        if (isVideoUrl(src)) {
            const video = document.createElement('video');
            video.src = src;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.classList.add('stj-media-preview');
            
            // 縦横比を維持して表示
            video.style.maxWidth = '100%';
            video.style.maxHeight = '200px';
            video.style.objectFit = 'contain';
            video.style.display = 'block';
            video.style.borderRadius = '4px';
            video.style.marginTop = '6px';
            video.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';

            video.play().catch(err => {
                console.warn(`${LOG_PREFIX} プレビュー動画の自動再生がブロックされました:`, err);
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
            
            // 縦横比を維持して表示
            img.style.maxWidth = '100%';
            img.style.maxHeight = '200px';
            img.style.objectFit = 'contain';
            img.style.display = 'block';
            img.style.borderRadius = '4px';
            img.style.marginTop = '6px';
            img.style.backgroundColor = 'rgba(0, 0, 0, 0.4)';

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

    // --- メディアプレビューの更新ロジック ---
    async function updatePreviewContainer(container, mediaPath) {
        if (!container) return;
        if (!mediaPath || typeof mediaPath !== 'string' || !mediaPath.trim()) {
            container.innerHTML = '';
            return;
        }

        const detectedPath = await detectMediaExtension(mediaPath) || mediaPath;
        const currentMedia = container.querySelector('.stj-media-preview');
        
        if (!currentMedia || currentMedia.getAttribute('data-src') !== detectedPath) {
            container.innerHTML = '';
            const mediaEl = createMediaPreviewElement(detectedPath);
            mediaEl.setAttribute('data-src', detectedPath);
            container.appendChild(mediaEl);
        }
    }

    // --- エディタ画面のDOM生成・アタッチ ---
    function attachPreviewToInputFields() {
        // パスが入力されるテキストフィールド（または設定フィールド）を取得
        const pathInputs = document.querySelectorAll('.stj-path-input, input[data-stj-path]');
        pathInputs.forEach(input => {
            let previewBox = input.parentNode.querySelector('.stj-preview-box');
            if (!previewBox) {
                previewBox = document.createElement('div');
                previewBox.className = 'stj-preview-box';
                input.parentNode.insertBefore(previewBox, input.nextSibling);
            }

            const handleChange = async () => {
                const pathVal = input.value;
                await updatePreviewContainer(previewBox, pathVal);
            };

            if (!input.dataset.stjObserved) {
                input.dataset.stjObserved = 'true';
                input.addEventListener('input', handleChange);
                input.addEventListener('change', handleChange);
                handleChange(); // 初期表示
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

    const debouncedAttach = debounce(attachPreviewToInputFields, 300);

    // --- DOM監視 ---
    function setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    debouncedAttach();
                    break;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        console.log(`${LOG_PREFIX} STJ Editor DOM 監視を開始しました。`);
    }

    // --- 初期化 ---
    function init() {
        console.log(`${LOG_PREFIX} STJ Editor 動画対応版をロードしました。`);
        setupMutationObserver();
        debouncedAttach();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
