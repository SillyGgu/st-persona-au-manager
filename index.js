import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getUserAvatar, user_avatar } from '../../../personas.js';
import { embedPersonaData, readPersonaData } from './persona-png.mjs';
import { makeFullBackup, mergeFullBackup } from './backup.mjs';
import { preserveRecoverySnapshot, readLegacyRecoverySnapshots, readRecoverySnapshot, readUnresolvedRecoverySnapshot, writeRecoverySnapshot } from './recovery.mjs';

const KEY = 'st-persona-au-manager';
const LEGACY_KEY = 'st-persona-switcher';
const BUTTON_ID = 'ps-switcher-btn';
const QUICK_ID = 'ps-quick-trigger';
const STYLE_ID = 'ps-avatar-override-style';
let dialog;
let quickMenu;
let avatarRequest = 0;
let pendingAvatarData = null;
let appliedAvatarData = null;
let appliedAvatarUrl = null;
const warnedLegacyNames = new Set();
let legacyKeyMerged = false;
let saveGeneration = 0;
let verifiedGeneration = 0;
let verificationTimer;
let verificationInFlight = false;
let verificationPending = false;
let recoveryWrite = Promise.resolve();
let recoveryInitialization = Promise.resolve();
let recoveryAccount = null;
let recoveryWarningShown = false;
let sizeWarningShown = false;
let sizeCheckTimer;
let legacyRecoveryAvailable = false;
let browserRecoveryAvailable = false;

function currentBackup() {
    return makeFullBackup(settings(), extension_settings[LEGACY_KEY], power_user.personas);
}

function backupContent(backup) {
    return JSON.stringify({ settings: backup.settings, legacySettings: backup.legacySettings });
}

function updateSaveState(message) {
    const label = dialog?.querySelector('.ps-save-state');
    if (label) label.textContent = message;
}

function journalCurrent() {
    const snapshot = currentBackup();
    if (!sizeWarningShown) {
        clearTimeout(sizeCheckTimer);
        sizeCheckTimer = setTimeout(() => {
            if (JSON.stringify(snapshot.settings).length > 4_000_000) {
                sizeWarningShown = true;
                toastr.warning('AU 이미지와 설명으로 ST 설정이 커졌습니다. 전체 AU 백업을 내려받고 이미지 크기를 점검해 주세요.');
            }
        }, 1000);
    }
    recoveryWrite = recoveryWrite.catch(() => {}).then(() => recoveryInitialization).then(() => {
        if (!recoveryAccount) throw new Error('ST account could not be identified');
        return writeRecoverySnapshot(recoveryAccount, snapshot);
    }).catch(error => {
        console.warn('[Persona AU Manager] Browser recovery copy could not be saved', error);
        if (!recoveryWarningShown) {
            recoveryWarningShown = true;
            toastr.warning('브라우저 복구본을 저장하지 못했습니다. 전체 AU 백업을 내려받아 주세요.');
        }
    });
}

function queueSave() {
    saveGeneration++;
    saveSettingsDebounced();
    journalCurrent();
    updateSaveState('서버 저장 대기 중 · 브라우저 복구본 기록 중');
    clearTimeout(verificationTimer);
    verificationTimer = setTimeout(verifyServerSave, 1800);
}

async function verifyServerSave() {
    if (saveGeneration === verifiedGeneration) return;
    if (verificationInFlight) { verificationPending = true; return; }
    verificationInFlight = true;
    const generation = saveGeneration;
    try {
        const response = await fetch('/api/settings/get', { method: 'POST', headers: getRequestHeaders() });
        if (!response.ok) throw new Error(`Settings readback: ${response.status}`);
        const payload = await response.json();
        const server = JSON.parse(payload.settings);
        if (generation !== saveGeneration) return;
        const descriptionMatches = !currentPersona() || server.power_user?.persona_descriptions?.[user_avatar]?.description === currentPersona().description;
        const auMatches = JSON.stringify(server.extension_settings?.[KEY] ?? {}) === JSON.stringify(settings());
        const legacyMatches = JSON.stringify(server.extension_settings?.[LEGACY_KEY] ?? null) === JSON.stringify(extension_settings[LEGACY_KEY] ?? null);
        if (auMatches && legacyMatches && descriptionMatches) {
            verifiedGeneration = generation;
            updateSaveState('서버 저장 확인됨');
        } else {
            updateSaveState('서버 저장 확인 필요 · 전체 AU 백업 권장');
        }
    } catch (error) {
        console.warn('[Persona AU Manager] Could not verify server save', error);
        if (generation === saveGeneration) updateSaveState('서버 연결 확인 필요 · 전체 AU 백업 권장');
    } finally {
        verificationInFlight = false;
        if (verificationPending || generation !== saveGeneration) {
            verificationPending = false;
            clearTimeout(verificationTimer);
            verificationTimer = setTimeout(verifyServerSave, 300);
        }
    }
}

function settings() {
    const legacy = extension_settings[LEGACY_KEY];
    if (!legacyKeyMerged && legacy && typeof legacy === 'object') {
        const current = extension_settings[KEY] ??= {};
        for (const [key, value] of Object.entries(legacy)) {
            if (['personaHistoryByAvatar', 'activeVersionByAvatar', 'personaHistory', 'activeVersionName'].includes(key) && value && typeof value === 'object') {
                const target = current[key] ??= {};
                for (const [id, entry] of Object.entries(value)) {
                    if (!Object.hasOwn(target, id)) target[id] = entry && typeof entry === 'object' ? JSON.parse(JSON.stringify(entry)) : entry;
                }
            } else if (!Object.hasOwn(current, key)) {
                current[key] = value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
            }
        }
        // Keep the old key as a recovery copy for users updating from older releases.
        // Existing values under KEY always take precedence.
        legacyKeyMerged = true;
        saveSettingsDebounced();
    }
    const data = extension_settings[KEY] ??= {};
    data.personaHistoryByAvatar ??= {};
    data.activeVersionByAvatar ??= {};
    return data;
}

function currentPersona() {
    const id = user_avatar;
    if (!id || !power_user.personas?.[id]) return null;
    return { id, name: power_user.personas[id], description: power_user.persona_descriptions?.[id]?.description ?? '' };
}

function cleanVersion(value) {
    if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.desc !== 'string') return null;
    const name = value.name.trim().slice(0, 120);
    if (!name) return null;
    const overrideAvatar = typeof value.overrideAvatar === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.overrideAvatar) && value.overrideAvatar.length < 8_000_000
        ? value.overrideAvatar : null;
    return { name, desc: value.desc, date: typeof value.date === 'string' ? value.date : new Date().toISOString(), overrideAvatar };
}

function versionsFor(persona) {
    const data = settings();
    const versions = data.personaHistoryByAvatar[persona.id] ??= [];
    const legacy = data.personaHistory?.[persona.name];
    if (Array.isArray(legacy) && !data.migratedLegacyByAvatar?.[persona.id]) {
        // Older releases keyed AU lists by display name. A duplicate name is ambiguous.
        const matches = Object.values(power_user.personas).filter(name => name === persona.name).length;
        if (matches === 1) {
            let fullyMigrated = true;
            let changed = false;
            for (const item of legacy) {
                const converted = cleanVersion(item);
                if (!converted) { fullyMigrated = false; continue; }
                const existing = versions.find(version => version.name === converted.name);
                if (!existing) {
                    versions.push(converted);
                    changed = true;
                } else if (existing.desc !== converted.desc || existing.overrideAvatar !== converted.overrideAvatar) {
                    fullyMigrated = false;
                }
            }
            if (!data.activeVersionByAvatar[persona.id] && data.activeVersionName?.[persona.name]) {
                data.activeVersionByAvatar[persona.id] = data.activeVersionName[persona.name];
                changed = true;
            }
            // Retain name-keyed data as a recovery copy. Mark even a partial
            // migration so a deliberately deleted AU cannot reappear later.
            (data.migratedLegacyByAvatar ??= {})[persona.id] = true;
            changed = true;
            if (!fullyMigrated) toastr.warning('일부 이전 AU가 현재 데이터와 다르거나 형식이 맞지 않습니다. 이전 원본은 설정에 보관되어 있습니다.');
            if (changed) queueSave();
        } else if (matches > 1 && !warnedLegacyNames.has(persona.name)) {
            warnedLegacyNames.add(persona.name);
            toastr.warning('같은 이름의 페르소나가 여럿 있어 이전 AU를 자동 연결하지 않았습니다. AU 관리창에서 직접 가져올 수 있습니다.');
        }
    }
    return versions;
}

const activeName = id => settings().activeVersionByAvatar[id] ?? '';

function updateLauncher() {
    const container = document.querySelector('.persona_controls_buttons_block');
    if (!container) return;
    let control = document.getElementById(BUTTON_ID);
    if (!control) {
        control = document.createElement('button');
        control.id = BUTTON_ID;
        control.type = 'button';
        control.className = 'menu_button fa-solid fa-address-book interactable';
        control.setAttribute('aria-label', '페르소나 AU 관리');
        control.addEventListener('click', openManager);
        container.prepend(control);
    }
    const persona = currentPersona();
    control.disabled = !persona;
    control.title = persona ? `AU 관리${activeName(persona.id) ? ` · ${activeName(persona.id)}` : ''}` : '페르소나를 먼저 선택하세요';
    updateQuickSwitch();
}

function closeQuickMenu() {
    quickMenu?.remove();
    quickMenu = null;
    document.removeEventListener('mousedown', onQuickOutside, true);
    document.removeEventListener('touchstart', onQuickOutside, true);
    window.removeEventListener('scroll', onQuickScroll, true);
    document.getElementById(QUICK_ID)?.setAttribute('aria-expanded', 'false');
}

function onQuickOutside(event) {
    if (!quickMenu?.contains(event.target) && !document.getElementById(QUICK_ID)?.contains(event.target)) closeQuickMenu();
}

function onQuickScroll(event) {
    if (!quickMenu?.contains(event.target)) closeQuickMenu();
}

function updateQuickSwitch() {
    const heading = document.querySelector('#persona_description')?.previousElementSibling;
    if (heading?.tagName !== 'H4') return;
    let trigger = document.getElementById(QUICK_ID);
    if (!trigger || trigger.parentElement !== heading) {
        trigger?.remove();
        trigger = document.createElement('button');
        trigger.id = QUICK_ID;
        trigger.type = 'button';
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (quickMenu) closeQuickMenu();
            else showQuickMenu(trigger);
        });
        heading.querySelector('.editor_maximize')?.before(trigger);
        if (!trigger.isConnected) heading.append(trigger);
    }
    const persona = currentPersona();
    const count = persona ? versionsFor(persona).length : 0;
    trigger.disabled = !persona;
    trigger.textContent = `AU · ${persona ? (activeName(persona.id) || '기본') : '없음'}`;
    trigger.title = count ? `빠른 AU 전환 · ${count}개` : 'AU 관리창에서 새 AU를 만드세요';
}

function showQuickMenu(trigger) {
    const persona = currentPersona();
    if (!persona) return;
    const versions = versionsFor(persona);
    if (!versions.length) return openManager();
    const menu = document.createElement('div');
    menu.className = 'ps-quick-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '빠른 AU 전환');
    keepPersonaDrawerOpen(menu);
    for (const version of versions) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ps-quick-item';
        item.setAttribute('role', 'menuitem');
        if (version.name === activeName(persona.id)) item.setAttribute('aria-current', 'true');
        item.textContent = version.name;
        item.title = version.name;
        item.addEventListener('click', () => {
            closeQuickMenu();
            applyVersion(persona, version);
        });
        menu.append(item);
    }
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'ps-quick-manage';
    manage.textContent = 'AU 관리…';
    manage.addEventListener('click', () => { closeQuickMenu(); openManager(); });
    menu.append(manage);
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeQuickMenu();
            trigger.focus();
        }
    });
    document.body.append(menu);
    quickMenu = menu;
    trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    const menuHeight = menu.getBoundingClientRect().height;
    menu.style.top = `${rect.bottom + 4 + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4}px`;
    document.addEventListener('mousedown', onQuickOutside, true);
    document.addEventListener('touchstart', onQuickOutside, true);
    window.addEventListener('scroll', onQuickScroll, true);
    menu.querySelector('button')?.focus({ preventScroll: true });
}

async function refreshAvatar() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.append(style);
    }
    const persona = currentPersona();
    const version = persona && versionsFor(persona).find(v => v.name === activeName(persona.id));
    const data = version?.overrideAvatar ?? null;
    if (data !== null && data === pendingAvatarData) return;
    if (data === appliedAvatarData && pendingAvatarData === null) return;
    const request = ++avatarRequest;
    pendingAvatarData = data;
    if (data === appliedAvatarData) {
        pendingAvatarData = null;
        return;
    }
    if (!data) {
        style.textContent = '';
        if (appliedAvatarUrl) URL.revokeObjectURL(appliedAvatarUrl);
        appliedAvatarUrl = null;
        appliedAvatarData = null;
        pendingAvatarData = null;
        return;
    }
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) {
        pendingAvatarData = null;
        style.textContent = '';
        if (appliedAvatarUrl) URL.revokeObjectURL(appliedAvatarUrl);
        appliedAvatarUrl = null;
        appliedAvatarData = null;
        return;
    }
    try {
        const blob = await (await fetch(data)).blob();
        if (blob.size > 5 * 1024 * 1024 || !/^image\/(?:png|jpeg|webp)$/.test(blob.type)) throw new Error('Invalid AU avatar');
        const objectUrl = URL.createObjectURL(blob);
        if (request !== avatarRequest) {
            URL.revokeObjectURL(objectUrl);
            return;
        }
        const previousUrl = appliedAvatarUrl;
        style.textContent = `.mes[is_user="true"][force_avatar="false"] .mesAvatarWrapper .avatar { background-image: url("${objectUrl}") !important; background-size: cover !important; background-position: center !important; } .mes[is_user="true"][force_avatar="false"] .mesAvatarWrapper .avatar img { opacity: 0 !important; }`;
        appliedAvatarUrl = objectUrl;
        appliedAvatarData = data;
        pendingAvatarData = null;
        if (previousUrl) URL.revokeObjectURL(previousUrl);
    } catch (error) {
        if (request === avatarRequest) {
            pendingAvatarData = null;
            style.textContent = '';
            if (appliedAvatarUrl) URL.revokeObjectURL(appliedAvatarUrl);
            appliedAvatarUrl = null;
            appliedAvatarData = null;
        }
        console.warn('[Persona AU Manager] AU avatar could not be displayed', error);
    }
}

function button(label, action, className = '') {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ps-button ${className}`;
    el.textContent = label;
    el.addEventListener('click', action);
    return el;
}

function notifyError(error, message) {
    console.error('[Persona AU Manager]', error);
    toastr.error(message);
}

function keepPersonaDrawerOpen(popup) {
    // ST closes unpinned drawers from its html mousedown/touchstart handler.
    // This popup lives under body, outside the persona drawer.
    for (const type of ['mousedown', 'touchstart']) {
        popup.addEventListener(type, event => event.stopPropagation());
    }
}

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function hasUnsavedDraft(modal = dialog) {
    const edit = modal?.editorState;
    const edited = edit && (edit.nameInput.value.trim() !== edit.selected.name || edit.descInput.value !== edit.selected.desc);
    return Boolean(edited || modal?.querySelector('.ps-new-name')?.value.trim() || modal?.querySelector('.ps-new-desc')?.value);
}

function saveUnsavedDraft(modal) {
    const edit = modal.editorState;
    if (edit && (edit.nameInput.value.trim() !== edit.selected.name || edit.descInput.value !== edit.selected.desc) && !edit.save()) return false;
    if ((modal.querySelector('.ps-new-name')?.value.trim() || modal.querySelector('.ps-new-desc')?.value) && !modal.createAU()) return false;
    return true;
}

function discardUnsavedDraft(modal) {
    const edit = modal.editorState;
    if (edit) {
        edit.nameInput.value = edit.selected.name;
        edit.descInput.value = edit.selected.desc;
    }
    const newName = modal.querySelector('.ps-new-name');
    if (newName) newName.value = '';
    const newDesc = modal.querySelector('.ps-new-desc');
    if (newDesc) newDesc.value = '';
}

function askUnsavedDraft() {
    return new Promise(resolve => {
        const promptDialog = document.createElement('dialog');
        promptDialog.className = 'ps-crop-dialog ps-unsaved-dialog';
        keepPersonaDrawerOpen(promptDialog);
        const message = document.createElement('p');
        message.textContent = '저장하지 않은 AU 이름 또는 설명이 있습니다.';
        const actions = document.createElement('div');
        actions.className = 'ps-actions';
        const finish = choice => { promptDialog.close(); promptDialog.remove(); resolve(choice); };
        actions.append(
            button('AU 저장', () => finish('save'), 'ps-primary'),
            button('버리기', () => finish('discard')),
            button('계속 편집', () => finish('cancel')),
        );
        promptDialog.append(message, actions);
        promptDialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
        document.body.append(promptDialog);
        promptDialog.showModal();
    });
}

async function withUnsavedDraft(action, modal = dialog) {
    if (!modal?.open || modal.draftPromptOpen) return;
    modal.draftPromptOpen = true;
    try {
        if (hasUnsavedDraft(modal)) {
            const choice = await askUnsavedDraft();
            if (choice === 'cancel' || !modal.open) return;
            if (choice === 'save' && !saveUnsavedDraft(modal)) return;
            if (choice === 'discard') discardUnsavedDraft(modal);
        }
        if (modal.open) action();
    } finally {
        modal.draftPromptOpen = false;
    }
}

function requestManagerClose(modal = dialog) {
    return withUnsavedDraft(() => modal.close(), modal);
}

function renderManager(persona, selectedName = '', createNew = false) {
    if (!dialog?.isConnected) return;
    if (user_avatar !== persona.id) { dialog.close(); return; }
    updateQuickSwitch();
    const list = dialog.querySelector('.ps-list');
    const editor = dialog.querySelector('.ps-editor');
    const versions = versionsFor(persona);
    dialog.querySelector('.ps-list-count').textContent = `${versions.length}개`;
    const selected = createNew ? null : versions.find(v => v.name === selectedName) ?? null;
    dialog.creatingAU = createNew;
    dialog.editorState = null;
    list.replaceChildren();
    editor.replaceChildren();
    if (!versions.length) {
        const empty = document.createElement('p');
        empty.className = 'ps-muted';
        empty.textContent = '아직 AU가 없습니다. 목록 옆 + 버튼으로 만들어 보세요.';
        list.append(empty);
    }
    for (const version of versions) {
        const row = document.createElement('div');
        row.className = `ps-item${version === selected ? ' ps-selected' : ''}`;
        const select = button(version.name, () => withUnsavedDraft(() => renderManager(persona, version.name)), 'ps-item-select');
        select.title = version.desc.slice(0, 200) || '설명 없음';
        const meta = document.createElement('span');
        meta.className = 'ps-item-meta';
        const applied = version.name === activeName(persona.id);
        meta.textContent = `${applied ? (currentPersona()?.description === version.desc ? '적용 중 · ' : '적용 후 수정됨 · ') : ''}${version.overrideAvatar ? '이미지 · ' : ''}${formatDate(version.date)}`;
        row.append(select, meta, button('적용', () => withUnsavedDraft(() => applyVersion(persona, version)), 'ps-compact'));
        list.append(row);
    }
    if (createNew) {
        editor.innerHTML = `<div class="ps-editor-head"><h4>새 AU</h4></div>
            <label>이름<input class="text_pole ps-new-name" maxlength="120" placeholder="AU 이름"></label>
            <label>설명<textarea class="text_pole ps-new-desc" rows="6" placeholder="새 설명을 입력하세요"></textarea></label>
            <div class="ps-editor-foot"><button type="button" class="ps-button ps-create-cancel">취소</button><button type="button" class="ps-button ps-primary ps-create-button">AU 만들기</button></div>`;
        editor.querySelector('.ps-create-cancel').onclick = () => renderManager(persona, dialog.returnToName);
        editor.querySelector('.ps-create-button').onclick = () => dialog.createAU();
        editor.querySelector('.ps-new-name').onkeydown = event => { if (event.key === 'Enter') dialog.createAU(); };
        editor.querySelector('.ps-new-name').focus();
        renderRecoveryOptions(persona);
        return;
    }
    if (!selected) { renderRecoveryOptions(persona); return; }
    const editorHead = document.createElement('div');
    editorHead.className = 'ps-editor-head';
    const heading = document.createElement('h4');
    heading.textContent = 'AU 편집';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = '이름';
    const nameInput = document.createElement('input');
    nameInput.className = 'text_pole';
    nameInput.maxLength = 120;
    nameInput.value = selected.name;
    nameLabel.append(nameInput);
    const descLabel = document.createElement('label');
    descLabel.textContent = 'AU 설명';
    const descInput = document.createElement('textarea');
    descInput.className = 'text_pole';
    descInput.rows = 6;
    descInput.value = selected.desc;
    descLabel.append(descInput);
    const editorFoot = document.createElement('div');
    editorFoot.className = 'ps-editor-foot';
    const saveSelected = () => {
        if (user_avatar !== persona.id) { toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.'); return false; }
        const nextName = nameInput.value.trim();
        if (!nextName) { toastr.warning('AU 이름을 입력하세요.'); return false; }
        if (versions.some(v => v !== selected && v.name === nextName)) { toastr.warning('같은 이름의 AU가 있습니다.'); return false; }
        if (selected.name === nextName && selected.desc === descInput.value) {
            toastr.info('변경 사항이 없습니다.');
            return true;
        }
        const oldName = selected.name;
        const wasActive = activeName(persona.id) === oldName;
        const field = wasActive ? document.getElementById('persona_description') : null;
        if (wasActive && !field) { toastr.error('ST 페르소나 설명 입력란을 찾지 못했습니다.'); return false; }
        selected.name = nextName;
        selected.desc = descInput.value;
        selected.date = new Date().toISOString();
        if (wasActive) {
            settings().activeVersionByAvatar[persona.id] = nextName;
            if (field.value !== selected.desc || currentPersona()?.description !== selected.desc) {
                field.value = selected.desc;
                field.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        queueSave();
        renderManager(persona, nextName);
        toastr.info('AU 변경을 반영했습니다. 서버 저장 상태를 확인해 주세요.');
        return true;
    };
    dialog.editorState = { selected, nameInput, descInput, save: saveSelected };
    const imageRow = document.createElement('div');
    imageRow.className = 'ps-image-row';
    const imageInfo = document.createElement('div');
    imageInfo.className = 'ps-image-info';
    const imagePreview = document.createElement('span');
    imagePreview.className = 'ps-image-preview';
    if (selected.overrideAvatar) {
        const image = document.createElement('img');
        image.src = selected.overrideAvatar;
        image.alt = '';
        imagePreview.append(image);
    } else imagePreview.innerHTML = '<i class="fa-solid fa-image" aria-hidden="true"></i>';
    const imageText = document.createElement('span');
    imageText.textContent = selected.overrideAvatar ? 'AU 이미지' : '이미지 없음';
    imageInfo.append(imagePreview, imageText);
    const imageActions = document.createElement('div');
    imageActions.className = 'ps-image-actions';
    imageActions.append(button(selected.overrideAvatar ? '변경' : '추가', () => withUnsavedDraft(() => chooseImage(selected, () => renderManager(persona, selected.name))), 'ps-subtle'));
    if (selected.overrideAvatar) imageActions.append(button('제거', () => withUnsavedDraft(() => {
            if (user_avatar !== persona.id) return toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.');
            selected.overrideAvatar = null;
            queueSave();
            refreshAvatar();
            renderManager(persona, selected.name);
        }), 'ps-subtle'));
    imageRow.append(imageInfo, imageActions);
    const deleteButton = button('', () => withUnsavedDraft(() => {
            if (user_avatar !== persona.id) return toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.');
            if (!confirm(`'${selected.name}' AU를 삭제할까요?`)) return;
            versions.splice(versions.indexOf(selected), 1);
            if (activeName(persona.id) === selected.name) settings().activeVersionByAvatar[persona.id] = '';
            queueSave();
            refreshAvatar();
            updateLauncher();
            renderManager(persona);
        }), 'ps-icon ps-danger');
    deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
    deleteButton.setAttribute('aria-label', '이 AU 삭제');
    deleteButton.title = '이 AU 삭제';
    editorHead.append(heading, deleteButton);
    editorFoot.append(button('저장', saveSelected, 'ps-primary'));
    editor.append(editorHead, nameLabel, descLabel, imageRow, editorFoot);
    renderRecoveryOptions(persona);
}

function applyVersion(persona, version) {
    if (user_avatar !== persona.id) return toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.');
    const field = document.getElementById('persona_description');
    if (!field) return toastr.error('ST 페르소나 설명 입력란을 찾지 못했습니다.');
    const descriptionChanged = field.value !== version.desc || currentPersona()?.description !== version.desc;
    const activeChanged = activeName(persona.id) !== version.name;
    if (!activeChanged && !descriptionChanged) {
        if (dialog?.open && dialog.editorState?.selected !== version) renderManager(persona, version.name);
        return;
    }
    settings().activeVersionByAvatar[persona.id] = version.name;
    if (descriptionChanged) {
        field.value = version.desc;
        field.dispatchEvent(new Event('input', { bubbles: true })); // ST updates its descriptor and schedules one save.
    }
    queueSave();
    if (activeChanged) refreshAvatar();
    updateLauncher();
    renderManager(persona, version.name);
    toastr.success(`'${version.name}' AU를 적용했습니다.`);
}

function chooseImage(version, done) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return toastr.warning('이미지는 5MB 이하로 선택해 주세요.');
        try {
            const bitmap = await createImageBitmap(file);
            const crop = document.createElement('dialog');
            crop.className = 'ps-crop-dialog';
            keepPersonaDrawerOpen(crop);
            crop.innerHTML = '<h3>AU 이미지</h3><p>이미지를 드래그하여 위치를 조절하세요.</p><canvas width="280" height="280" aria-label="이미지 미리보기"></canvas><label>확대 <input type="range" min="1" max="4" step="0.01" value="1"></label><div class="ps-actions"><button type="button" class="ps-button ps-crop-save">저장</button><button type="button" class="ps-button ps-crop-cancel">취소</button></div>';
            const preview = crop.querySelector('canvas');
            const zoom = crop.querySelector('input');
            let x = 0, y = 0, pointer = null;
            const draw = (context, side) => {
                const base = Math.min(bitmap.width, bitmap.height) / Number(zoom.value);
                const left = Math.max(0, Math.min(bitmap.width - base, (bitmap.width - base) / 2 + x));
                const top = Math.max(0, Math.min(bitmap.height - base, (bitmap.height - base) / 2 + y));
                context.clearRect(0, 0, side, side);
                context.drawImage(bitmap, left, top, base, base, 0, 0, side, side);
            };
            const repaint = () => draw(preview.getContext('2d'), 280);
            zoom.oninput = repaint;
            preview.onpointerdown = e => { pointer = { x: e.clientX, y: e.clientY }; preview.setPointerCapture(e.pointerId); };
            preview.onpointermove = e => {
                if (!pointer) return;
                const factor = Math.min(bitmap.width, bitmap.height) / Number(zoom.value) / 280;
                x -= (e.clientX - pointer.x) * factor;
                y -= (e.clientY - pointer.y) * factor;
                pointer = { x: e.clientX, y: e.clientY };
                repaint();
            };
            preview.onpointerup = preview.onpointercancel = () => { pointer = null; };
            crop.querySelector('.ps-crop-save').onclick = () => {
                if (!dialog?.open || !dialog.persona || user_avatar !== dialog.persona.id ||
                    !settings().personaHistoryByAvatar[user_avatar]?.includes(version)) {
                    crop.close();
                    return toastr.warning('페르소나가 변경되었습니다. 이미지를 다시 선택해 주세요.');
                }
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 400;
                draw(canvas.getContext('2d'), 400);
                const imageData = canvas.toDataURL('image/webp', 0.85);
                if (imageData.length > 1_350_000 && !confirm('이미지가 약 1MB 이상입니다. ST 설정 저장이 느려질 수 있습니다. 계속 저장할까요?')) return;
                version.overrideAvatar = imageData;
                queueSave();
                refreshAvatar();
                crop.close();
                done();
            };
            crop.querySelector('.ps-crop-cancel').onclick = () => crop.close();
            crop.addEventListener('close', () => { bitmap.close(); crop.remove(); });
            document.body.append(crop);
            crop.showModal();
            repaint();
        } catch (error) { notifyError(error, '이미지를 읽지 못했습니다.'); }
    };
    input.click();
}

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function exportFullBackup() {
    const backup = currentBackup();
    download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `persona_AU_full_${new Date().toISOString().slice(0, 10)}.json`);
}

function restoreFullBackup(backup) {
    const result = mergeFullBackup(settings(), extension_settings[LEGACY_KEY], backup, power_user.personas);
    const { added, duplicates, conflicts, orphanAvatars, legacyEntries } = result.stats;
    if (!confirm(`전체 AU 백업을 병합할까요?\n새 AU ${added}개, 같은 이름 충돌 ${conflicts}개, 중복 ${duplicates}개, 현재 없는 페르소나 ID ${orphanAvatars}개, 이전 설정 ${legacyEntries}항목.\n기존 AU와 설명은 덮어쓰지 않습니다.`)) return;
    if (added || legacyEntries || JSON.stringify(result.settings) !== JSON.stringify(settings())) {
        extension_settings[KEY] = result.settings;
        if (legacyEntries) extension_settings[LEGACY_KEY] = result.legacySettings;
        queueSave();
        updateLauncher();
        refreshAvatar();
        if (dialog?.open) renderManager(dialog.persona);
    }
    toastr.info(`새 AU ${added}개를 추가했습니다. 같은 이름 충돌 ${conflicts}개는 유지했습니다.`);
}

async function importFullBackup(file) {
    try {
        if (file.size > 100 * 1024 * 1024) throw new Error('전체 백업은 100MB 이하여야 합니다.');
        restoreFullBackup(JSON.parse(await file.text()));
    } catch (error) { notifyError(error, '전체 AU 백업을 읽지 못했습니다.'); }
}

async function restoreBrowserBackup() {
    try {
        await recoveryInitialization;
        if (!recoveryAccount) return toastr.warning('ST 계정을 확인할 수 없어 브라우저 복구본을 사용할 수 없습니다.');
        const unresolved = await readUnresolvedRecoverySnapshot(recoveryAccount);
        const latest = await readRecoverySnapshot(recoveryAccount);
        let backup = unresolved ?? latest;
        if (unresolved && latest && backupContent(unresolved) !== backupContent(latest)) {
            const choice = prompt('브라우저 복구본 선택: 1 = 이전에 발견된 불일치 복구본, 2 = 가장 최근 작업 복구본');
            if (choice === '2') backup = latest;
            else if (choice !== '1') return;
        }
        if (!backup) return toastr.info('이 브라우저에 AU 복구본이 없습니다.');
        restoreFullBackup(backup);
    } catch (error) { notifyError(error, '브라우저 복구본을 읽지 못했습니다.'); }
}

async function exportLegacyBrowserBackup() {
    try {
        const { latest, unresolved } = await readLegacyRecoverySnapshots();
        if (!latest && !unresolved) return toastr.info('구버전 브라우저 복구본이 없습니다.');
        let backup = unresolved ?? latest;
        if (latest && unresolved && backupContent(latest) !== backupContent(unresolved)) {
            const choice = prompt('구버전 복구본 선택: 1 = 이전에 발견된 불일치 복구본, 2 = 가장 최근 작업 복구본');
            if (choice === '2') backup = latest;
            else if (choice !== '1') return;
        }
        if (!confirm('구버전 브라우저 복구본은 ST 계정을 구분하지 않았습니다. 다른 계정의 AU일 수 있습니다. JSON으로 내려받아 확인할까요?')) return;
        download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), 'persona_AU_legacy_browser_recovery.json');
    } catch (error) { notifyError(error, '구버전 브라우저 복구본을 내려받지 못했습니다.'); }
}

function importOrphanAu(persona) {
    if (user_avatar !== persona.id) return toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.');
    const records = Object.entries(settings().personaHistoryByAvatar)
        .filter(([id, versions]) => !Object.hasOwn(power_user.personas, id) && Array.isArray(versions) && versions.length);
    if (!records.length) return toastr.info('보관된 페르소나의 AU가 없습니다.');
    const choices = records.map(([id, versions], index) => `${index + 1}. ${settings().archivedPersonaNamesByAvatar?.[id] ?? id} (${versions.length}개)`);
    const choice = Number(prompt(`현재 '${persona.name}'에 가져올 보관 AU를 선택하세요.\n${choices.join('\n')}`));
    if (!Number.isInteger(choice) || choice < 1 || choice > records.length) return;
    const [id, source] = records[choice - 1];
    if (!confirm(`보관된 '${settings().archivedPersonaNamesByAvatar?.[id] ?? id}'의 AU를 '${persona.name}'에 추가할까요? 같은 이름은 건너뜁니다.`)) return;
    const target = versionsFor(persona);
    const names = new Set(target.map(v => v.name));
    let added = 0;
    for (const item of source) {
        const version = cleanVersion(item);
        if (version && !names.has(version.name)) { target.push(version); names.add(version.name); added++; }
    }
    if (added) { queueSave(); renderManager(persona); }
    toastr.info(`${added}개 AU를 추가했습니다.`);
}

async function exportPng(persona) {
    try {
        const response = await fetch(getUserAvatar(persona.id));
        if (!response.ok) throw new Error(`Avatar fetch: ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const image = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'));
        const payload = { format: 'st-persona-au-manager', version: 1, persona: { name: persona.name, description: currentPersona()?.description ?? persona.description }, activeVersion: activeName(persona.id), versions: versionsFor(persona).map(cleanVersion).filter(Boolean) };
        const png = embedPersonaData(new Uint8Array(await image.arrayBuffer()), payload);
        download(new Blob([png], { type: 'image/png' }), `${persona.name}_AU.png`);
    } catch (error) { notifyError(error, 'PNG 내보내기에 실패했습니다.'); }
}

async function importFile(persona, file) {
    try {
        if (file.size > 40 * 1024 * 1024) throw new Error('파일이 40MB를 초과합니다.');
        const payload = file.name.toLowerCase().endsWith('.png')
            ? readPersonaData(new Uint8Array(await file.arrayBuffer())) : JSON.parse(await file.text());
        const source = Array.isArray(payload) ? payload : payload?.versions;
        if (!Array.isArray(source)) throw new Error('지원하지 않는 AU 데이터입니다.');
        if (source.length > 500) throw new Error('AU 500개를 초과하는 파일은 가져올 수 없습니다.');
        if (user_avatar !== persona.id) return toastr.warning('페르소나가 변경되었습니다. 파일을 다시 가져와 주세요.');
        if (payload?.persona?.name && payload.persona.name !== persona.name && !confirm(`파일의 페르소나 '${payload.persona.name}'과 현재 '${persona.name}'이 다릅니다. AU를 현재 페르소나에 가져올까요?`)) return;
        const target = versionsFor(persona);
        const names = new Set(target.map(v => v.name));
        let added = 0;
        for (const item of source) {
            const version = cleanVersion(item);
            if (version && !names.has(version.name)) { target.push(version); names.add(version.name); added++; }
        }
        if (added) queueSave();
        if (typeof payload?.persona?.description === 'string' && payload.persona.description !== currentPersona()?.description
            && confirm('파일의 기본 페르소나 설명도 현재 페르소나에 적용할까요?')) {
            const field = document.getElementById('persona_description');
            if (field && user_avatar === persona.id) {
                field.value = payload.persona.description;
                field.dispatchEvent(new Event('input', { bubbles: true }));
                queueSave();
            }
        }
        renderManager(persona);
        toastr.info(`${added}개 AU를 추가했습니다. 중복 이름은 건너뛰었습니다.`);
    } catch (error) { notifyError(error, 'AU 파일을 읽지 못했습니다. 이 확장의 PNG 또는 JSON 백업인지 확인해 주세요.'); }
}

function importLegacyAu(persona) {
    const legacy = settings().personaHistory?.[persona.name];
    if (!Array.isArray(legacy)) return;
    if (!confirm(`이전 이름별 AU를 '${persona.name}'에 추가할까요? 이름이 같은 다른 내용은 '(이전)'을 붙여 보존하고 기존 AU는 유지합니다.`)) return;
    const target = versionsFor(persona);
    const names = new Set(target.map(item => item.name));
    let added = 0;
    for (const item of legacy) {
        const version = cleanVersion(item);
        if (!version || target.some(current => current.desc === version.desc && current.overrideAvatar === version.overrideAvatar)) continue;
        if (names.has(version.name)) {
            const base = version.name.slice(0, 108);
            let candidate = `${base} (이전)`;
            for (let index = 2; names.has(candidate); index++) candidate = `${base} (이전 ${index})`;
            version.name = candidate;
        }
        target.push(version);
        names.add(version.name);
        added++;
    }
    if (added) { queueSave(); renderManager(persona); }
    toastr.info(`${added}개 이전 AU를 추가했습니다.`);
}

function renderRecoveryOptions(persona) {
    const area = dialog?.querySelector('.ps-recovery');
    if (!area) return;
    area.replaceChildren();
    const addNotice = (message, label, action) => {
        const row = document.createElement('div');
        row.className = 'ps-recovery-row';
        const copy = document.createElement('span');
        copy.textContent = message;
        row.append(copy, button(label, () => withUnsavedDraft(action), 'ps-subtle'));
        area.append(row);
    };
    const legacy = settings().personaHistory?.[persona.name];
    const versions = settings().personaHistoryByAvatar[persona.id] ?? [];
    if (Array.isArray(legacy) && legacy.some(item => {
        if (versions.some(current => current.desc === item?.desc && current.overrideAvatar === (item?.overrideAvatar ?? null))) return false;
        const version = cleanVersion(item);
        return version && !versions.some(current => current.desc === version.desc && current.overrideAvatar === version.overrideAvatar);
    })) addNotice('연결되지 않은 이전 AU가 있습니다.', '가져오기', () => importLegacyAu(persona));
    const orphans = Object.entries(settings().personaHistoryByAvatar).some(([id, items]) => !Object.hasOwn(power_user.personas, id) && Array.isArray(items) && items.length);
    if (orphans) addNotice('삭제된 페르소나의 AU가 보관되어 있습니다.', '가져오기', () => importOrphanAu(persona));
    if (browserRecoveryAvailable) addNotice('서버 설정과 다른 브라우저 AU 기록이 있습니다.', '복원 검토', restoreBrowserBackup);
    if (legacyRecoveryAvailable) addNotice('이전 버전의 브라우저 기록이 있습니다.', '파일 확인', exportLegacyBrowserBackup);
    area.hidden = !area.childElementCount;
}

async function importManagerFile(persona, file) {
    if (file.name.toLowerCase().endsWith('.json')) {
        try {
            if (file.size > 100 * 1024 * 1024) throw new Error('백업 파일은 100MB 이하여야 합니다.');
            const payload = JSON.parse(await file.text());
            if (payload?.format === 'st-persona-au-manager-full-backup') return restoreFullBackup(payload);
        } catch (error) { return notifyError(error, 'JSON 파일을 읽지 못했습니다.'); }
    }
    return importFile(persona, file);
}

function openManager() {
    const persona = currentPersona();
    if (!persona) return toastr.warning('페르소나를 먼저 선택하세요.');
    closeQuickMenu();
    if (dialog?.open) return;
    dialog = document.createElement('dialog');
    const modal = dialog;
    modal.persona = persona;
    dialog.className = 'ps-dialog';
    keepPersonaDrawerOpen(dialog);
    dialog.innerHTML = `<div class="ps-wrapper">
        <header class="ps-header"><div><h3>페르소나 AU</h3><p class="ps-persona-name"></p></div>
            <div class="ps-header-tools"><details class="ps-file-menu"><summary>파일 <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary>
                <div class="ps-file-options"><button type="button" class="ps-import">가져오기</button><button type="button" class="ps-export-png">AU PNG 내보내기</button><button type="button" class="ps-export-full">전체 AU 백업</button></div>
            </details><button type="button" class="ps-button ps-icon ps-close" aria-label="닫기" title="닫기"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>
        </header>
        <section class="ps-list-section"><div class="ps-section-head"><h4>현재 AU 목록</h4><div class="ps-list-tools"><span class="ps-list-count"></span><button type="button" class="ps-button ps-icon ps-add" aria-label="새 AU 만들기" title="새 AU 만들기"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></div></div><div class="ps-list"></div></section>
        <section class="ps-editor"></section>
        <section class="ps-recovery" aria-label="복구 가능한 AU" hidden></section>
        <div class="ps-bottom"><span class="ps-save-state" role="status"></span></div>
        <input class="ps-import-input" type="file" accept=".png,.json,image/png,application/json" hidden>
    </div>`;
    dialog.querySelector('.ps-persona-name').textContent = persona.name;
    dialog.addEventListener('click', event => {
        const menu = dialog.querySelector('.ps-file-menu');
        if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    dialog.querySelector('.ps-close').onclick = () => requestManagerClose(modal);
    dialog.addEventListener('cancel', event => { event.preventDefault(); requestManagerClose(modal); });
    dialog.querySelector('.ps-add').onclick = () => {
        if (dialog.creatingAU) return dialog.querySelector('.ps-new-name')?.focus();
        withUnsavedDraft(() => {
            dialog.returnToName = dialog.editorState?.selected.name || activeName(persona.id) || versionsFor(persona)[0]?.name || '';
            renderManager(persona, '', true);
        });
    };
    modal.createAU = () => {
        if (user_avatar !== persona.id) { toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.'); return false; }
        const input = dialog.querySelector('.ps-new-name');
        const description = dialog.querySelector('.ps-new-desc');
        const name = input.value.trim();
        if (!name) { toastr.warning('새 AU 이름을 입력하세요.'); return false; }
        const versions = versionsFor(persona);
        if (versions.some(v => v.name === name)) { toastr.warning('같은 이름의 AU가 있습니다. 목록에서 선택해 수정하세요.'); return false; }
        versions.push({ name, desc: description.value, date: new Date().toISOString(), overrideAvatar: null });
        queueSave();
        renderManager(persona, name);
        return true;
    };
    dialog.querySelector('.ps-export-png').onclick = () => withUnsavedDraft(() => { dialog.querySelector('.ps-file-menu').open = false; exportPng(persona); });
    dialog.querySelector('.ps-export-full').onclick = () => withUnsavedDraft(() => { dialog.querySelector('.ps-file-menu').open = false; exportFullBackup(); });
    dialog.querySelector('.ps-save-state').textContent = saveGeneration === verifiedGeneration ? 'AU 변경 없음' : '서버 저장 확인 필요';
    const fileInput = dialog.querySelector('.ps-import-input');
    dialog.querySelector('.ps-import').onclick = () => withUnsavedDraft(() => { dialog.querySelector('.ps-file-menu').open = false; fileInput.click(); });
    fileInput.onchange = async () => { const file = fileInput.files?.[0]; if (file) await importManagerFile(persona, file); fileInput.value = ''; };
    dialog.addEventListener('close', () => { modal.remove(); if (dialog === modal) dialog = null; });
    document.body.append(dialog);
    dialog.showModal();
    renderManager(persona, activeName(persona.id));
}

settings();
recoveryInitialization = fetch('/api/users/me').then(async response => {
    if (!response.ok) throw new Error(`Account lookup: ${response.status}`);
    const user = await response.json();
    if (!user?.handle || typeof user.handle !== 'string') throw new Error('Account handle missing');
    recoveryAccount = user.handle;
    const [backup, legacy] = await Promise.all([readRecoverySnapshot(recoveryAccount), readLegacyRecoverySnapshots()]);
    legacyRecoveryAvailable = [legacy.latest, legacy.unresolved].some(item => item && backupContent(item) !== backupContent(currentBackup()));
    if (dialog?.open) renderRecoveryOptions(dialog.persona);
    return backup;
}).then(backup => {
    if (!backup) journalCurrent();
    else if (backupContent(backup) !== backupContent(currentBackup())) {
        browserRecoveryAvailable = true;
        preserveRecoverySnapshot(recoveryAccount, backup).catch(error => console.warn('[Persona AU Manager] Could not preserve divergent recovery copy', error));
        toastr.info('이 브라우저에 서버 설정과 다른 AU 기록이 있습니다. AU 관리창의 복구 안내에서 확인할 수 있습니다.');
        if (dialog?.open) renderRecoveryOptions(dialog.persona);
    }
}).catch(error => console.warn('[Persona AU Manager] Browser recovery copy unavailable', error));
updateLauncher();
refreshAvatar();
eventSource.on(event_types.PERSONA_CHANGED, () => { closeQuickMenu(); if (dialog?.open) dialog.close(); updateLauncher(); refreshAvatar(); });
eventSource.on(event_types.PERSONA_DELETED, ({ avatarId, name }) => {
    // ST can delete personas during restore and other bulk operations. Preserve
    // AU records so a removed avatar does not silently destroy its history.
    if (avatarId && name && settings().personaHistoryByAvatar[avatarId]?.length) {
        (settings().archivedPersonaNamesByAvatar ??= {})[avatarId] = name;
        queueSave();
    }
    updateLauncher();
    refreshAvatar();
});
eventSource.on(event_types.SETTINGS_UPDATED, () => {
    updateLauncher();
    refreshAvatar();
    if (saveGeneration !== verifiedGeneration) {
        clearTimeout(verificationTimer);
        verificationTimer = setTimeout(verifyServerSave, 100);
    }
});
eventSource.on(event_types.PERSONA_CREATED, updateLauncher);
eventSource.on(event_types.PERSONA_RENAMED, () => {
    updateLauncher();
    const persona = currentPersona();
    if (persona && dialog?.open && dialog.persona?.id === persona.id) {
        dialog.persona.name = persona.name;
        dialog.querySelector('.ps-persona-name').textContent = persona.name;
    }
});
// Watch only the persona drawer: ST may replace its controls while rendering.
const panel = document.getElementById('persona-management-button');
if (panel) new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID) || !document.getElementById(QUICK_ID)) updateLauncher();
}).observe(panel, { childList: true, subtree: true });
