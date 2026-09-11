// SillyTavernの公式拡張機能ローダー（動的 import）対応フック
export async function onInstall() {
    console.log('[STJ Editor] onInstall フックが呼び出されました。初回セットアップを行います。');
    if (typeof toastr !== 'undefined') {
        toastr.success('STJ Character Exporter 拡張機能がインストールされました。');
    }
}

// サポートする画像拡張子
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// DOMからキャラクター名を検出する関数
function detectCharacterNameFromDOM() {
    const selectedChar = document.querySelector('#character_select option:selected') || 
                         document.querySelector('.character_select option:selected') ||
                         document.querySelector('#avatar_title_comment') ||
                         document.querySelector('#rm_char_name');
    if (selectedChar) {
        return selectedChar.textContent?.trim() || selectedChar.value?.trim() || '';
    }
    return '';
}

// カスタムアラート表示
function showCustomAlert(message) {
    if (typeof toastr !== 'undefined') {
        toastr.info(message);
        return;
    }
    const alertDiv = document.createElement('div');
    alertDiv.style.cssText = 'position:fixed;top:20px;right:20px;background:#2b6cb0;color:white;padding:12px 20px;border-radius:6px;z-index:10002;box-shadow:0 4px 6px rgba(0,0,0,0.3);font-weight:bold;';
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    setTimeout(() => {
        alertDiv.style.opacity = '0';
        alertDiv.style.transition = 'opacity 0.3s ease';
        setTimeout(() => alertDiv.remove(), 300);
    }, 2700);
}

// 画像の拡張子を自動検出する非同期関数
async function detectImageExtension(charName, imageName) {
    if (!charName || !imageName) return null;
    if (IMAGE_EXTENSIONS.some(ext => imageName.toLowerCase().endsWith(ext))) {
        return '';
    }
    for (const ext of IMAGE_EXTENSIONS) {
        try {
            const imgUrl = `addchara/${charName}/${imageName}${ext}`;
            const res = await fetch(imgUrl, { method: 'HEAD' });
            if (res.ok) return ext;
        } catch (e) {
            // 次の拡張子を試行
        }
    }
    return '.png';
}

// 初期化メイン関数
function initStjEditor() {
    console.log('[STJ Editor] 初期化開始');

    if (document.getElementById('stj_export_button')) {
        console.log('[STJ Editor] 既にボタンが存在するため多重生成をスキップします。');
        return;
    }

    // エクスポートボタンの作成
    const exportButton = document.createElement('button');
    exportButton.id = 'stj_export_button';
    exportButton.innerHTML = '⚙ STJ エディタ';
    exportButton.title = 'STJキャラクター設定エディタを開く';

    const targetContainer = document.querySelector('#extensions_settings') || 
                            document.querySelector('#top-bar') || 
                            document.body;
    targetContainer.appendChild(exportButton);

    // モーダルUIの生成
    const modal = document.createElement('div');
    modal.id = 'stj_export_modal';
    modal.innerHTML = `
        <div id="stj_char_name_display">キャラクター未選択</div>
        <div class="stj-grid-container">
            <div class="stj-input-group">
                <label for="stj_default_image">デフォルト画像名</label>
                <input type="text" id="stj_default_image" class="stj-image-input" placeholder="例: default">
            </div>
            <div class="stj-input-group">
                <label for="stj_thumbnail_image">サムネイル画像名</label>
                <input type="text" id="stj_thumbnail_image" class="stj-image-input" placeholder="例: thumb">
            </div>
            <hr style="border-color: #4a5568; margin: 15px 0;">
            <h3 style="color:#e2e8f0; margin-bottom:10px;">キーワード・画像マッピング</h3>
            <div id="stj_keywords_container"></div>
            <button type="button" id="stj_add_keyword" style="margin-top: 10px;">+ キーワード追加</button>
        </div>
        <div class="stj-button-group">
            <div>
                <button type="button" id="stj_save_data">一時保存</button>
            </div>
            <div>
                <button type="button" id="stj_cancel_export">閉じる</button>
                <button type="button" id="stj_export_json">JSON エクスポート</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // キーワード行を追加する補助関数
    function addKeywordRow(keyword = '', imageName = '') {
        const container = document.getElementById('stj_keywords_container');
        const row = document.createElement('div');
        row.className = 'stj-keyword-item';
        row.innerHTML = `
            <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; width: 100%;">
                <div class="stj-input-group">
                    <label>反応キーワード</label>
                    <input type="text" class="stj-keyword-input" value="${keyword}" placeholder="例: 笑顔, 怒り">
                </div>
                <div class="stj-input-group">
                    <label>表示画像ファイル名</label>
                    <input type="text" class="stj-image-input" value="${imageName}" placeholder="例: smile">
                </div>
            </div>
            <button type="button" class="stj-delete-row" title="削除">✕</button>
        `;
        row.querySelector('.stj-delete-row').addEventListener('click', () => {
            row.remove();
        });
        container.appendChild(row);
    }

    // イベントハンドラーの設定
    exportButton.addEventListener('click', async () => {
        const charName = detectCharacterNameFromDOM() || 'UnknownChar';
        document.getElementById('stj_char_name_display').textContent = charName;
        modal.style.display = 'block';
        
        await loadExistingJSONData(charName);
        loadSavedData(charName);
    });

    document.getElementById('stj_cancel_export').addEventListener('click', (e) => {
        e.stopPropagation();
        modal.style.display = 'none';
    });

    document.getElementById('stj_add_keyword').addEventListener('click', () => {
        addKeywordRow();
    });

    document.getElementById('stj_save_data').addEventListener('click', () => {
        saveData();
    });

    document.getElementById('stj_export_json').addEventListener('click', () => {
        exportJSON();
    });
}

// 既存のJSONファイルをフェッチして読み込む関数
async function loadExistingJSONData(charName) {
    if (!charName) return;
    try {
        const jsonPath = `addchara/${charName}/${charName}_ext.json`;
        const response = await fetch(jsonPath);
        if (!response.ok) return;
        
        const jsonData = await response.json();
        if (jsonData.default_image) {
            document.getElementById('stj_default_image').value = jsonData.default_image;
        }
        if (jsonData.thumbnail_image) {
            document.getElementById('stj_thumbnail_image').value = jsonData.thumbnail_image;
        }
        
        if (jsonData.image_display_extension && Array.isArray(jsonData.image_display_extension)) {
            const container = document.getElementById('stj_keywords_container');
            container.innerHTML = '';
            jsonData.image_display_extension.forEach(item => {
                addKeywordRow(item.keyword || '', item.imageName || item.image_name || '');
            });
        }
    } catch (e) {
        console.log('[STJ Editor] 既存JSONデータの自動読み込みスキップ:', e);
    }
}

// localStorage へのデータ一時保存
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
        if (keywordInput && imageInput && (keywordInput.value || imageInput.value)) {
            data.keywords.push({
                keyword: keywordInput.value,
                imageName: imageInput.value
            });
        }
    });

    localStorage.setItem(`stj_editor_data_${charName}`, JSON.stringify(data));
    showCustomAlert('データを保存しました');
}

// localStorage からのデータ復元
function loadSavedData(charName) {
    if (!charName) return;
    const savedData = localStorage.getItem(`stj_editor_data_${charName}`);
    if (!savedData) return;
    
    try {
        const data = JSON.parse(savedData);
        if (data.defaultImage) document.getElementById('stj_default_image').value = data.defaultImage;
        if (data.thumbnailImage) document.getElementById('stj_thumbnail_image').value = data.thumbnailImage;
        
        if (data.keywords && data.keywords.length > 0) {
            const container = document.getElementById('stj_keywords_container');
            container.innerHTML = '';
            data.keywords.forEach(kw => {
                addKeywordRow(kw.keyword, kw.imageName);
            });
        }
    } catch (e) {
        console.error('[STJ Editor] 保存データの読み込みエラー:', e);
    }
}

// JSONファイル生成およびダウンロード
async function exportJSON() {
    const charName = document.getElementById('stj_char_name_display').textContent;
    if (!charName) {
        alert('キャラクター名が設定されていません');
        return;
    }

    const defaultImg = document.getElementById('stj_default_image').value;
    const thumbImg = document.getElementById('stj_thumbnail_image').value;
    const keywordsList = [];

    const keywordItems = document.querySelectorAll('.stj-keyword-item');
    for (const item of keywordItems) {
        const keywordInput = item.querySelector('.stj-keyword-input');
        const imageInput = item.querySelector('.stj-image-input');
        if (keywordInput && imageInput && keywordInput.value) {
            const ext = await detectImageExtension(charName, imageInput.value);
            keywordsList.push({
                keyword: keywordInput.value,
                image_name: imageInput.value,
                extension: ext
            });
        }
    }

    const exportData = {
        character_name: charName,
        default_image: defaultImg,
        thumbnail_image: thumbImg,
        image_display_extension: keywordsList
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${charName}_ext.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showCustomAlert(`${charName}_ext.json をエクスポートしました`);
}

// 動的 import 読み込み対策（DOMContentLoaded発火済みへの防御的判定）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStjEditor);
} else {
    initStjEditor();
}
