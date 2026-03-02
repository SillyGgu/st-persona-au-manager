import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, callPopup } from "../../../../script.js";

const extensionName = "st-persona-switcher";
const BUTTON_ID = 'ps-switcher-btn';

/**
 * 1. 설정 초기화
 */
function initSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    if (!extension_settings[extensionName].personaHistory) {
        extension_settings[extensionName].personaHistory = {};
    }
    if (!extension_settings[extensionName].activeVersionName) {
        extension_settings[extensionName].activeVersionName = {};
    }
}

/**
 * 2. 현재 활성화된 페르소나 데이터 획득
 */
function getActivePersonaData() {
    const context = getContext();
    const powerSettings = context?.powerUserSettings;
    
    let name = $('#persona_name').val() || $('.persona_name').first().text().trim();
    if (!name) name = powerSettings?.persona_selected;
    if (!name) name = "Default User";

    const desc = $('#persona_description').val() || powerSettings?.persona_description || "";

    return { name, desc };
}


/**
 * 아바타 오버라이드 CSS 갱신 (채팅창 전용)
 */
function refreshAvatarOverride() {
    const activeData = getActivePersonaData();
    const activeVersionName = extension_settings[extensionName]?.activeVersionName?.[activeData.name];
    const history = extension_settings[extensionName]?.personaHistory?.[activeData.name] || [];
    const currentVersion = history.find(v => v.name === activeVersionName);
    
    let $style = $('#ps-avatar-override-style');
    if ($style.length === 0) {
        $style = $('<style id="ps-avatar-override-style"></style>').appendTo('head');
    }

    if (currentVersion && currentVersion.overrideAvatar) {
        $style.html(`
            .mes[is_user="true"] .mesAvatarWrapper .avatar img {
                content: url('${currentVersion.overrideAvatar}') !important;
                object-fit: cover !important;
            }
        `);
    } else {
        $style.html('');
    }
}

/**
 * 이미지 에디터 모달 (드래그, 줌 지원, 원본 및 좌표 저장)
 */
function openImageEditor(activeName, versions, idx) {
    const version = versions[idx];
    $('#ps-image-editor-modal').remove();

    let targetRatio = 1; // 기본 1:1
    const $userAvatar = $('.mes[is_user="true"] .avatar').last(); 
    const $sidebarAvatar = $('#avatar_user'); 
    
    let baseWidth = 0, baseHeight = 0;

    if ($userAvatar.length > 0 && $userAvatar.width() > 0) {
        baseWidth = $userAvatar.width();
        baseHeight = $userAvatar.height();
    } else if ($sidebarAvatar.length > 0 && $sidebarAvatar.width() > 0) {
        baseWidth = $sidebarAvatar.width();
        baseHeight = $sidebarAvatar.height();
    }

    if (baseWidth > 0 && baseHeight > 0) {
        targetRatio = baseWidth / baseHeight;
    }

    // 2. 에디터 뷰포트 크기 계산 (최대 250px 기준)
    let viewW = 220;
    let viewH = 220;
    
    if (targetRatio > 1) { 
        viewH = viewW / targetRatio;
    } else {
        viewW = viewH * targetRatio;
    }

    const editorHtml = `
        <div id="ps-image-editor-modal">
            <div class="ps-editor-container">
                <h4 style="margin:0 0 5px 0; color:#333;">아바타 설정</h4>
                <div style="font-weight:bold; color:#007bff; margin-bottom:5px;">${version.name}</div>
                <div style="font-size:0.8em; color:#666; margin-bottom:10px;">
                    비율 감지: ${baseWidth}x${baseHeight} (${targetRatio.toFixed(2)})<br>
                    PC: 휠/드래그 | Mobile: 핀치/터치
                </div>
                
                <div id="ps-crop-viewport" style="width:${viewW}px; height:${viewH}px;">
                    <img id="ps-crop-img" crossorigin="anonymous" />
                </div>
                
                <div class="ps-editor-btn-group">
                    <button id="ps-btn-img-upload">📂 파일 선택</button>
                    <button id="ps-btn-img-save">💾 저장</button>
                    <button id="ps-btn-img-delete">🗑️ 초기화</button>
                    <button id="ps-btn-img-close">✖ 닫기</button>
                </div>
                <input type="file" id="ps-img-file-input" accept="image/*" style="display:none;" />
            </div>
        </div>
    `;

    $('body').append(editorHtml);

    $('#ps-image-editor-modal').on('mousedown touchstart click', function(e) {
        e.stopPropagation();
    });

    const viewport = document.getElementById('ps-crop-viewport');
    const img = document.getElementById('ps-crop-img');
    const fileInput = document.getElementById('ps-img-file-input');
    
    let scale = 1, posX = 0, posY = 0;
    let startX, startY;
    let isDragging = false;
    let initialDistance = null;
    let initialScale = 1;

    function updateTransform() {
        img.style.transform = `translate(calc(-50% + ${posX}px), calc(-50% + ${posY}px)) scale(${scale})`;
    }

    if (version.originalAvatar) {
        img.src = version.originalAvatar;
        if (version.avatarConfig) {
            scale = version.avatarConfig.scale || 1;
            posX = version.avatarConfig.x || 0;
            posY = version.avatarConfig.y || 0;
        }
        img.style.display = 'block';
        updateTransform();
    } else if (version.overrideAvatar) {
        img.src = version.overrideAvatar;
        img.style.display = 'block';
        scale = 1; posX = 0; posY = 0;
        updateTransform();
    }

    $('#ps-btn-img-upload').on('click', () => fileInput.click());
    $(fileInput).on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            img.src = event.target.result;
            img.style.display = 'block';
            scale = 1; posX = 0; posY = 0; 
            updateTransform();
        };
        reader.readAsDataURL(file);
    });

    // 휠 감도 0.001 유지
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        scale += e.deltaY * -0.001; 
        scale = Math.min(Math.max(0.1, scale), 10);
        updateTransform();
    }, { passive: false });

viewport.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDragging = true; startX = e.clientX - posX; startY = e.clientY - posY;
    });

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.stopPropagation();
        posX = e.clientX - startX; posY = e.clientY - startY;
        updateTransform();
    };
    const onMouseUp = () => { isDragging = false; };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    viewport.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        if (e.touches.length === 1) {
            isDragging = true;
            startX = e.touches[0].clientX - posX;
            startY = e.touches[0].clientY - posY;
        } else if (e.touches.length === 2) {
            isDragging = false;
            initialDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            initialScale = scale;
        }
    }, { passive: false });

    viewport.addEventListener('touchmove', (e) => {
        e.preventDefault(); 
        e.stopPropagation();
        if (isDragging && e.touches.length === 1) {
            posX = e.touches[0].clientX - startX;
            posY = e.touches[0].clientY - startY;
            updateTransform();
        } else if (e.touches.length === 2 && initialDistance) {
            const currentDistance = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            scale = initialScale * (currentDistance / initialDistance);
            scale = Math.min(Math.max(0.1, scale), 10);
            updateTransform();
        }
    }, { passive: false });

    const onTouchEnd = () => { isDragging = false; initialDistance = null; };
    window.addEventListener('touchend', onTouchEnd);

    function cleanupWindowListeners() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchend', onTouchEnd);
    }

    $('#ps-btn-img-close').on('click', () => {
        cleanupWindowListeners();
        $('#ps-image-editor-modal').remove();
    });
	
    $('#ps-btn-img-delete').on('click', () => {
        if (confirm("이 버전의 아바타 설정을 삭제하시겠습니까?")) {
            version.overrideAvatar = null;
            version.originalAvatar = null;
            version.avatarConfig = null;
            saveSettingsDebounced();
            refreshAvatarOverride();
            cleanupWindowListeners();
            $('#ps-image-editor-modal').remove();
            if ($('.ps-wrapper').length) openSwitcherModal();
            toastr.info("아바타 설정이 초기화되었습니다.");
        }
    });

    $('#ps-btn-img-save').on('click', () => {
        if (!img.src || img.style.display === 'none') {
            toastr.warning("이미지가 없습니다.");
            return;
        }

        const canvas = document.createElement('canvas');
        
        let outputW = 400;
        let outputH = 400;
        
        if (targetRatio > 1) {
            outputH = 400 / targetRatio;
        } else {
            outputW = 400 * targetRatio;
        }
        
        canvas.width = outputW; 
        canvas.height = outputH;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const ratioMultiplier = outputW / viewW;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.translate(posX * ratioMultiplier, posY * ratioMultiplier);
        
        const finalScale = scale * ratioMultiplier;
        ctx.scale(finalScale, finalScale);

        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

        version.overrideAvatar = canvas.toDataURL('image/webp', 0.85);
        version.originalAvatar = img.src;
        version.avatarConfig = { x: posX, y: posY, scale: scale };

        saveSettingsDebounced();
        refreshAvatarOverride();
        cleanupWindowListeners();
        $('#ps-image-editor-modal').remove();
        if ($('.ps-wrapper').length) openSwitcherModal();
        toastr.success("아바타 설정이 저장되었습니다.");
    });
}

/**
 * 3. 페르소나 버전 적용
 */
async function applyPersonaVersion(version) {
    const context = getContext();
    const activeData = getActivePersonaData();
    const currentName = activeData.name;
    const powerSettings = context.powerUserSettings;

    powerSettings.persona_description = version.desc;
    if (powerSettings.personas && powerSettings.personas[currentName]) {
        powerSettings.personas[currentName] = version.desc;
    }

    extension_settings[extensionName].activeVersionName[currentName] = version.name;

    const $descInput = $('#persona_description');
    if ($descInput.length) {
        $descInput.val(version.desc).trigger('input').trigger('change');
    }

    await saveSettingsDebounced();
    updateActiveTagUI(); 
    refreshAvatarOverride(); 
    toastr.success(`[${currentName}] : ${version.name} 적용됨`);
}

/**
 * 4. 태그 UI 업데이트 (무한 새로고침 방지 및 토글 로직 수정)
 */
function updateActiveTagUI() {
    const activeData = getActivePersonaData();
    const activeVersion = extension_settings[extensionName]?.activeVersionName?.[activeData.name] || "기본";
    
    refreshAvatarOverride();

    const $header = $('span[data-i18n="Persona Description"]').closest('h4.flex-container.alignItemsBaseline');
    if ($header.length === 0) return;

    const $existingTag = $header.find('.ps-active-tag');
    if ($existingTag.length > 0 && $existingTag.attr('data-version') === activeVersion) {
        return; 
    }

    $existingTag.remove();

    const tagHtml = `
        <span class="ps-active-tag" data-version="${activeVersion}" title="클릭하여 빠른 전환" style="
            margin-left: auto !important; 
            margin-right: 10px !important; 
            font-size: 11px !important; 
            background-color: var(--mainColor) !important; 
            color: var(--SmartThemeBodyColor) !important; 
            padding: 2px 10px !important; 
            border-radius: 10px !important; 
            font-weight: bold !important;
            cursor: pointer !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            white-space: nowrap !important;
            z-index: 10 !important;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            position: relative;
        ">
            ${activeVersion}
        </span>
    `;

    const $icon = $header.find('.editor_maximize');
    if ($icon.length > 0) {
        $icon.before(tagHtml);
    } else {
        $header.append(tagHtml);
    }

    $('.ps-active-tag').off('click').on('click', function(e) {
        if ($(e.target).closest('#ps-quick-popup').length > 0) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const $popup = $('#ps-quick-popup');
        if ($popup.length > 0) {
            $popup.remove();
            $(document).off('click.psQuickClose');
        } else {
            showQuickPopup(e, $(this));
        }
    });
}

/**
 * 5. 심플 퀵 팝업 (외부 클릭 감지 및 버블링 수정, 아이콘 추가)
 */
function showQuickPopup(event, $tagElement) {
    const active = getActivePersonaData();
    const versions = extension_settings[extensionName].personaHistory[active.name] || [];

    if (versions.length === 0) {
        toastr.info("저장된 AU 버전이 없습니다.");
        return;
    }

    $('#ps-quick-popup').remove();

    const $popup = $('<div id="ps-quick-popup"></div>').css({
        'position': 'absolute',
        'top': '100%',
        'right': '0px',
        'margin-top': '5px',
        'z-index': '1000',
        'background-color': '#FFFFFF',
        'border': '1px solid #ddd',
        'border-radius': '6px',
        'padding': '4px',
        'min-width': '180px', 
        'box-shadow': '0 4px 12px rgba(0,0,0,0.2)',
        'display': 'flex',
        'flex-direction': 'column',
        'cursor': 'default'
    });

    const listHtml = versions.map((v) => `
        <div class="ps-quick-item" data-name="${v.name}" style="
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #333 !important;
            transition: background 0.2s;
            text-align: left;
        ">
            <div style="display:flex; align-items:center; gap:6px; pointer-events:none; overflow:hidden;">
                <span style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px;">${v.name}</span>
                ${v.overrideAvatar ? '<i class="fa-solid fa-image" style="color:#0096ff; font-size:0.9em;"></i>' : ''}
            </div>
            <span style="font-size:10px; opacity:0.5; pointer-events:none; margin-left:8px; white-space:nowrap;">${new Date(v.date).toLocaleDateString()}</span>
        </div>
    `).join('');

    $popup.append(listHtml);
    $tagElement.append($popup);

    $popup.find('.ps-quick-item').hover(
        function() { $(this).css('background', '#f0f0f0'); },
        function() { $(this).css('background', 'transparent'); }
    );

    $popup.find('.ps-quick-item').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation(); 
        
        const targetName = $(this).data('name');
        const targetVer = versions.find(v => v.name === targetName);
        if (targetVer) {
            applyPersonaVersion(targetVer);
        }
        $popup.remove();
        $(document).off('click.psQuickClose');
    });

    setTimeout(() => {
        $(document).off('click.psQuickClose').on('click.psQuickClose', function(e) {
            if (!$(e.target).closest('.ps-active-tag').length) {
                $('#ps-quick-popup').remove();
                $(document).off('click.psQuickClose');
            }
        });
    }, 10);
}

/**
 * 6. 전체 관리 모달 (사이드바 버튼 클릭 시)
 */
 
async function openSwitcherModal() {
    initSettings();
    const active = getActivePersonaData();
    
    if (!extension_settings[extensionName].personaHistory[active.name]) {
        extension_settings[extensionName].personaHistory[active.name] = [];
    }
    
    let versions = extension_settings[extensionName].personaHistory[active.name];

    if (versions.length === 0) {
        versions.push({ name: "기본", desc: active.desc, date: new Date().toISOString() });
        saveSettingsDebounced();
    }

    const listHtml = versions.map((v, idx) => `
        <div class="ps-item">
            <div class="ps-info" style="display:flex; flex-direction:column; justify-content:center; flex:1; overflow:hidden;">
                <div style="font-weight:bold; color:var(--mainColor); text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${v.name} ${v.overrideAvatar ? '<i class="fa-solid fa-image" style="font-size:0.8em; opacity:0.7;" title="아바타 포함됨"></i>' : ''}
                </div>
                <div style="font-size:0.8em; opacity:0.6; text-align:left;">${new Date(v.date).toLocaleString()}</div>
            </div>
            <div class="ps-actions" style="display:flex; gap:5px; align-items:center; margin-left:10px;">
                <button class="menu_button ps-btn-apply" data-idx="${idx}" style="white-space:nowrap; font-size:0.8em;">적용</button>
                <button class="menu_button ps-btn-image" data-idx="${idx}" style="background-color:rgba(0,150,255,0.1); color:#0096ff; white-space:nowrap; font-size:0.8em;">이미지</button>
                <button class="menu_button ps-btn-rename" data-idx="${idx}" style="white-space:nowrap; font-size:0.8em;">이름</button>
                <button class="menu_button ps-btn-delete" data-idx="${idx}" style="background-color:rgba(255,0,0,0.1); color:red; white-space:nowrap; font-size:0.8em;">삭제</button>
            </div>
        </div>
    `).join('') || '<div style="padding:20px; text-align:center; opacity:0.5;">저장된 AU 버전이 없습니다.</div>';

    const modalHtml = `
        <div class="ps-wrapper" style="min-width:480px; overflow-x:hidden;">
            <div class="ps-header" style="border-bottom:1px solid var(--SmartThemeBorderColor); padding-bottom:10px; margin-bottom:15px;">
                <h3 style="margin:0;">Persona AU Switcher</h3>
                <div style="color:var(--mainColor); font-weight:bold;">유저: ${active.name}</div>
            </div>
            <div class="ps-list" style="max-height:350px; overflow-y:auto; overflow-x:hidden;">
                ${listHtml}
            </div>
            <div class="ps-footer" style="margin-top:20px;">
                <div class="ps-footer-row" style="display:flex; gap:10px; margin-bottom:10px;">
                    <input type="text" id="ps_new_name" class="text_display" placeholder="새 버전 이름" style="flex:1;">
                    <button id="ps_btn_save" class="menu_button" style="white-space:nowrap;">현재 상태 저장</button>
                </div>
                <div class="ps-footer-buttons">
                    <input type="file" id="ps_import_file" style="display:none;" accept=".json">
                    <button id="ps_btn_import" class="menu_button" style="font-size:0.85em; white-space:nowrap; flex:1;">JSON 가져오기</button>
                    <button id="ps_btn_backup" class="menu_button" style="font-size:0.85em; white-space:nowrap; flex:1;">JSON 백업</button>
                </div>
            </div>
        </div>
    `;

    callPopup(modalHtml, 'text', '', { wide: true });

    setTimeout(() => {
        $('.ps-btn-apply').off('click').on('click', function() {
            const idx = $(this).data('idx');
            applyPersonaVersion(versions[idx]);
        });

        $('.ps-btn-image').off('click').on('click', function() {
            const idx = $(this).data('idx');
            openImageEditor(active.name, versions, idx);
        });

        $('.ps-btn-rename').off('click').on('click', function() {
            const idx = $(this).data('idx');
            const currentVer = versions[idx];
            const oldName = currentVer.name;
            const newName = prompt("변경할 이름을 입력하세요:", oldName);
            
            if (newName && newName.trim() !== "" && newName !== oldName) {
                if (versions.some((v, i) => i !== idx && v.name === newName)) {
                    toastr.warning("이미 존재하는 이름입니다.");
                    return;
                }
                versions[idx].name = newName.trim();
                if (extension_settings[extensionName].activeVersionName[active.name] === oldName) {
                    extension_settings[extensionName].activeVersionName[active.name] = newName.trim();
                }
                saveSettingsDebounced();
                openSwitcherModal(); 
                updateActiveTagUI(); 
            }
        });

        $('.ps-btn-delete').off('click').on('click', function() {
            if (confirm("이 버전을 삭제하시겠습니까?")) {
                const deletedName = versions[$(this).data('idx')].name;
                versions.splice($(this).data('idx'), 1);
                if (extension_settings[extensionName].activeVersionName[active.name] === deletedName) {
                    extension_settings[extensionName].activeVersionName[active.name] = "기본";
                }
                saveSettingsDebounced();
                openSwitcherModal();
                updateActiveTagUI();
            }
        });

        $('#ps_btn_save').off('click').on('click', async () => {
            const newName = $('#ps_new_name').val().trim();
            if (!newName) { toastr.warning("이름을 입력하세요."); return; }
            
            const existingIdx = versions.findIndex(v => v.name === newName);
            const currentDesc = $('#persona_description').val();
            const newVersion = { name: newName, desc: currentDesc, date: new Date().toISOString() };
            
            if (existingIdx !== -1) {
                if (!confirm(`'${newName}'을 덮어씌울까요?`)) return;
                // 기존 아바타 유지
                newVersion.overrideAvatar = versions[existingIdx].overrideAvatar;
                newVersion.originalAvatar = versions[existingIdx].originalAvatar;
                newVersion.avatarConfig = versions[existingIdx].avatarConfig;
                versions[existingIdx] = newVersion;
            } else {
                versions.push(newVersion);
            }
            
            extension_settings[extensionName].activeVersionName[active.name] = newName;
            saveSettingsDebounced();
            openSwitcherModal();
            updateActiveTagUI();
        });

        $('#ps_btn_backup').off('click').on('click', () => {
            const dataStr = JSON.stringify(versions, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `persona_${active.name}_backup.json`;
            a.click();
        });

        $('#ps_btn_import').off('click').on('click', () => { $('#ps_import_file').click(); });
        $('#ps_import_file').off('change').on('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importedData = JSON.parse(e.target.result);
                    if (!Array.isArray(importedData)) {
                        toastr.error("올바르지 않은 JSON 형식입니다."); return;
                    }
                    const currentNames = versions.map(v => v.name);
                    const filteredImport = importedData
                        .filter(v => v.name && v.desc !== undefined && !currentNames.includes(v.name))
                        .map(v => ({ ...v, date: v.date || new Date().toISOString() }));

                    if (filteredImport.length === 0 && importedData.length > 0) {
                        toastr.warning("모든 이름이 중복되거나 가져올 데이터가 없습니다."); return;
                    }

                    extension_settings[extensionName].personaHistory[active.name] = [...versions, ...filteredImport];
                    saveSettingsDebounced();
                    openSwitcherModal();
                    toastr.success(`${filteredImport.length}개 버전 추가됨`);
                } catch (err) { toastr.error("파일 처리 중 오류 발생"); }
            };
            reader.readAsText(file);
        });
    }, 100);
}
/**
 * 7. 런처 버튼 및 태그 상시 업데이트
 */
function addLauncherButton() {
    const container = $('.persona_controls_buttons_block');
    
    if (container.length > 0 && $(`#${BUTTON_ID}`).length === 0) {
        const btn = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-address-book interactable" title="AU Manager" role="button" tabindex="0"></div>`);
        btn.on('click', openSwitcherModal);
        container.prepend(btn);
    }

    const $popup = $('dialog.popup[open]');
    
    if ($popup.length > 0 && !$popup.hasClass('ps-delete-hooked')) {
        const h3Text = $popup.find('h3').text(); 
        
        if (h3Text.includes('Delete Persona')) {
            const parts = h3Text.split(':');
            if (parts.length >= 2) {
                const targetName = parts.slice(1).join(':').trim();
                
                if (targetName) {
                    $popup.addClass('ps-delete-hooked'); 
                    
                    $popup.find('.popup-button-ok').one('click', function() {
                        let deleted = false;

                        if (extension_settings[extensionName]?.personaHistory?.[targetName]) {
                            delete extension_settings[extensionName].personaHistory[targetName];
                            deleted = true;
                        }
                        if (extension_settings[extensionName]?.activeVersionName?.[targetName]) {
                            delete extension_settings[extensionName].activeVersionName[targetName];
                            deleted = true;
                        }

                        if (deleted) {
                            saveSettingsDebounced();
                            toastr.info(`[AU Switcher] ${targetName} 관련 데이터가 삭제되었습니다.`);
                        }
                    });
                }
            }
        }
    }

    updateActiveTagUI();
}
initSettings();

addLauncherButton();

try {
    const { eventSource, event_types } = await import('../../../../script.js').catch(() => ({}));
    if (eventSource && event_types) {
        eventSource.on(event_types.PERSONA_CHANGED, () => { addLauncherButton(); });
        eventSource.on(event_types.SETTINGS_UPDATED, () => { addLauncherButton(); });
    }
} catch(e) {
    
}

const psObserver = new MutationObserver(() => {
    addLauncherButton();
});

const observeTargets = [
    document.querySelector('.persona_controls_buttons_block'),
    document.querySelector('#persona_description')?.closest('h4'),
    document.getElementById('user_persona_block'),
].filter(Boolean);

if (observeTargets.length > 0) {
    observeTargets.forEach(target => {
        psObserver.observe(target, { childList: true, subtree: true, attributes: true });
    });
} else {
    const bodyObserver = new MutationObserver(() => {
        const targets = [
            document.querySelector('.persona_controls_buttons_block'),
            document.querySelector('#persona_description')?.closest('h4'),
            document.getElementById('user_persona_block'),
        ].filter(Boolean);

        if (targets.length > 0) {
            bodyObserver.disconnect();
            targets.forEach(target => {
                psObserver.observe(target, { childList: true, subtree: true, attributes: true });
            });
            addLauncherButton();
        }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
}