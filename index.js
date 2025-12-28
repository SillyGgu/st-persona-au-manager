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
    toastr.success(`[${currentName}] : ${version.name} 적용됨`);
}

/**
 * 4. 태그 UI 업데이트 (무한 새로고침 방지 및 토글 로직 수정)
 */
function updateActiveTagUI() {
    const activeData = getActivePersonaData();
    const activeVersion = extension_settings[extensionName]?.activeVersionName?.[activeData.name] || "기본";
    
    const $header = $('span[data-i18n="Persona Description"]').closest('h4.flex-container.alignItemsBaseline');
    if ($header.length === 0) return;

    // 태그가 이미 있고 내용이 같다면 다시 그리지 않음
    const $existingTag = $header.find('.ps-active-tag');
    if ($existingTag.length > 0 && $existingTag.attr('data-version') === activeVersion) {
        return; 
    }

    // 기존 태그 제거 후 새로 생성
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

    // 클릭 이벤트 바인딩
    $('.ps-active-tag').off('click').on('click', function(e) {
        // 팝업 내부의 아이템을 클릭한 것이라면 함수 종료 (버블링 방지)
        if ($(e.target).closest('#ps-quick-popup').length > 0) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const $popup = $('#ps-quick-popup');
        if ($popup.length > 0) {
            // 이미 켜져있다면 닫기
            $popup.remove();
            $(document).off('click.psQuickClose');
        } else {
            // 꺼져있다면 열기
            showQuickPopup(e, $(this));
        }
    });
}

/**
 * 5. 심플 퀵 팝업 (외부 클릭 감지 및 버블링 수정)
 */
function showQuickPopup(event, $tagElement) {
    const active = getActivePersonaData();
    const versions = extension_settings[extensionName].personaHistory[active.name] || [];

    if (versions.length === 0) {
        toastr.info("저장된 AU 버전이 없습니다.");
        return;
    }

    // 기존 팝업 제거
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
        'min-width': '160px',
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
            <span style="font-weight:bold; pointer-events:none;">${v.name}</span>
            <span style="font-size:10px; opacity:0.5; pointer-events:none;">${new Date(v.date).toLocaleDateString()}</span>
        </div>
    `).join('');

    $popup.append(listHtml);
    $tagElement.append($popup);

    // 호버 효과
    $popup.find('.ps-quick-item').hover(
        function() { $(this).css('background', '#f0f0f0'); },
        function() { $(this).css('background', 'transparent'); }
    );

    // 아이템 클릭 이벤트
    $popup.find('.ps-quick-item').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation(); // 태그 클릭 이벤트로 번지지 않게 차단
        
        const targetName = $(this).data('name');
        const targetVer = versions.find(v => v.name === targetName);
        if (targetVer) {
            applyPersonaVersion(targetVer);
        }
        $popup.remove();
        $(document).off('click.psQuickClose');
    });

    // 외부 클릭 시 닫기 (약간의 지연을 주어 클릭 이벤트가 겹치지 않게 함)
    setTimeout(() => {
        $(document).off('click.psQuickClose').on('click.psQuickClose', function(e) {
            // 클릭된 대상이 태그(.ps-active-tag) 자체가 아닐 때만 닫기
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
        <div class="ps-item" style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding:10px; margin-bottom:5px; border-radius:5px;">
            <div class="ps-info">
                <div style="font-weight:bold; color:var(--mainColor);">${v.name}</div>
                <div style="font-size:0.8em; opacity:0.6;">${new Date(v.date).toLocaleString()}</div>
            </div>
            <div class="ps-actions" style="display:flex; gap:5px;">
                <button class="menu_button ps-btn-apply" data-idx="${idx}" style="white-space:nowrap;">적용</button>
                <button class="menu_button ps-btn-delete" data-idx="${idx}" style="background-color:rgba(255,0,0,0.1); color:red; white-space:nowrap;">삭제</button>
            </div>
        </div>
    `).join('') || '<div style="padding:20px; text-align:center; opacity:0.5;">저장된 AU 버전이 없습니다.</div>';

    const modalHtml = `
        <div class="ps-wrapper" style="min-width:450px;">
            <div class="ps-header" style="border-bottom:1px solid var(--SmartThemeBorderColor); padding-bottom:10px; margin-bottom:15px;">
                <h3 style="margin:0;">Persona AU Switcher</h3>
                <div style="color:var(--mainColor); font-weight:bold;">유저: ${active.name}</div>
            </div>
            <div class="ps-list" style="max-height:350px; overflow-y:auto;">
                ${listHtml}
            </div>
            <div class="ps-footer" style="margin-top:20px;">
                <div style="display:flex; gap:10px; margin-bottom:10px;">
                    <input type="text" id="ps_new_name" class="text_display" placeholder="새 버전 이름" style="flex:1;">
                    <button id="ps_btn_save" class="menu_button" style="white-space:nowrap;">현재 상태 저장</button>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:5px; align-items:center;">
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
        $('.ps-btn-delete').off('click').on('click', function() {
            if (confirm("이 버전을 삭제하시겠습니까?")) {
                versions.splice($(this).data('idx'), 1);
                saveSettingsDebounced();
                openSwitcherModal();
            }
        });
        $('#ps_btn_save').off('click').on('click', async () => {
            const newName = $('#ps_new_name').val().trim();
            if (!newName) { toastr.warning("이름을 입력하세요."); return; }
            const existingIdx = versions.findIndex(v => v.name === newName);
            const newVersion = { name: newName, desc: active.desc, date: new Date().toISOString() };
            if (existingIdx !== -1) {
                if (!confirm(`'${newName}'을 덮어씌울까요?`)) return;
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
                    if (Array.isArray(importedData)) {
                        const currentNames = versions.map(v => v.name);
                        const filteredImport = importedData.filter(v => !currentNames.includes(v.name));
                        extension_settings[extensionName].personaHistory[active.name] = [...versions, ...filteredImport];
                        saveSettingsDebounced();
                        openSwitcherModal();
                        toastr.success(`${filteredImport.length}개 추가됨`);
                    }
                } catch (err) { toastr.error("오류 발생"); }
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
    updateActiveTagUI();
}

// 실행
initSettings();
setInterval(addLauncherButton, 1000);