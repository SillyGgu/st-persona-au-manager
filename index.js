import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { power_user } from '../../../power-user.js';
import { getUserAvatar, user_avatar } from '../../../personas.js';
import { embedPersonaData, readPersonaData } from './persona-png.mjs';

const KEY = 'st-persona-switcher'; // Preserve existing settings.
const BUTTON_ID = 'ps-switcher-btn';
const STYLE_ID = 'ps-avatar-override-style';
let dialog;

function settings() {
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
    if (!Object.hasOwn(data.personaHistoryByAvatar, persona.id)) {
        // The old format used display names. Duplicate names cannot be mapped safely.
        const matches = Object.values(power_user.personas).filter(name => name === persona.name).length;
        const legacy = data.personaHistory?.[persona.name];
        if (matches === 1 && Array.isArray(legacy)) {
            data.personaHistoryByAvatar[persona.id] = legacy.map(cleanVersion).filter(Boolean);
            data.activeVersionByAvatar[persona.id] = data.activeVersionName?.[persona.name] ?? '';
            delete data.personaHistory[persona.name];
            if (data.activeVersionName) delete data.activeVersionName[persona.name];
            saveSettingsDebounced();
        } else {
            data.personaHistoryByAvatar[persona.id] = [];
            if (matches > 1 && legacy) toastr.warning('동명 페르소나의 기존 AU는 자동 이전하지 않았습니다. 기존 설정 백업을 확인해 주세요.');
        }
    }
    return data.personaHistoryByAvatar[persona.id];
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
        control.className = 'menu_button fa-solid fa-layer-group';
        control.setAttribute('aria-label', '페르소나 AU 관리');
        control.addEventListener('click', openManager);
        container.prepend(control);
    }
    const persona = currentPersona();
    control.disabled = !persona;
    control.title = persona ? `AU 관리${activeName(persona.id) ? ` · ${activeName(persona.id)}` : ''}` : '페르소나를 먼저 선택하세요';
}

function refreshAvatar() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.append(style);
    }
    const persona = currentPersona();
    const version = persona && versionsFor(persona).find(v => v.name === activeName(persona.id));
    const url = version?.overrideAvatar;
    const nextStyle = url && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)
        ? `.mes[is_user="true"][force_avatar="false"] .mesAvatarWrapper .avatar { background-image: url("${url}") !important; background-size: cover !important; background-position: center !important; } .mes[is_user="true"][force_avatar="false"] .mesAvatarWrapper .avatar img { opacity: 0 !important; }`
        : '';
    if (style.textContent !== nextStyle) style.textContent = nextStyle;
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

function renderManager(persona, selectedName = '') {
    if (!dialog?.isConnected) return;
    const list = dialog.querySelector('.ps-list');
    const editor = dialog.querySelector('.ps-editor');
    const versions = versionsFor(persona);
    const selected = versions.find(v => v.name === selectedName) ?? null;
    list.replaceChildren();
    editor.replaceChildren();
    if (!versions.length) {
        const empty = document.createElement('p');
        empty.className = 'ps-muted';
        empty.textContent = '아직 AU가 없습니다. 아래에서 이름을 입력해 현재 설명을 저장하세요.';
        list.append(empty);
    }
    for (const version of versions) {
        const row = document.createElement('div');
        row.className = `ps-item${version === selected ? ' ps-selected' : ''}`;
        const select = button(version.name, () => renderManager(persona, version.name), 'ps-item-select');
        select.title = version.desc.slice(0, 200) || '설명 없음';
        const meta = document.createElement('span');
        meta.className = 'ps-item-meta';
        const applied = version.name === activeName(persona.id);
        meta.textContent = `${applied ? (currentPersona()?.description === version.desc ? '적용 중 · ' : '적용 후 수정됨 · ') : ''}${version.overrideAvatar ? '이미지 · ' : ''}${formatDate(version.date)}`;
        row.append(select, meta, button('적용', () => applyVersion(persona, version), 'ps-compact'));
        list.append(row);
    }
    if (!selected) return;
    const heading = document.createElement('h4');
    heading.textContent = 'AU 수정';
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
    const actions = document.createElement('div');
    actions.className = 'ps-actions';
    actions.append(
        button('수정 저장', () => {
            const nextName = nameInput.value.trim();
            if (!nextName) return toastr.warning('AU 이름을 입력하세요.');
            if (versions.some(v => v !== selected && v.name === nextName)) return toastr.warning('같은 이름의 AU가 있습니다.');
            const oldName = selected.name;
            selected.name = nextName;
            selected.desc = descInput.value;
            selected.date = new Date().toISOString();
            if (activeName(persona.id) === oldName) settings().activeVersionByAvatar[persona.id] = nextName;
            saveSettingsDebounced();
            updateLauncher();
            renderManager(persona, nextName);
            toastr.success('AU를 저장했습니다.');
        }, 'ps-primary'),
        button('현재 설명으로 갱신', () => {
            if (!confirm(`현재 페르소나 설명으로 '${selected.name}' AU를 갱신할까요?`)) return;
            selected.desc = currentPersona()?.description ?? '';
            selected.date = new Date().toISOString();
            saveSettingsDebounced();
            renderManager(persona, selected.name);
        }),
        button('이미지 변경', () => chooseImage(selected, () => renderManager(persona, selected.name))),
        button('이미지 제거', () => {
            selected.overrideAvatar = null;
            saveSettingsDebounced();
            refreshAvatar();
            renderManager(persona, selected.name);
        }),
        button('삭제', () => {
            if (!confirm(`'${selected.name}' AU를 삭제할까요?`)) return;
            versions.splice(versions.indexOf(selected), 1);
            if (activeName(persona.id) === selected.name) settings().activeVersionByAvatar[persona.id] = '';
            saveSettingsDebounced();
            refreshAvatar();
            updateLauncher();
            renderManager(persona);
        }, 'ps-danger'),
    );
    editor.append(heading, nameLabel, descLabel, actions);
}

function applyVersion(persona, version) {
    if (user_avatar !== persona.id) return toastr.warning('페르소나가 변경되었습니다. AU 관리창을 다시 열어 주세요.');
    const field = document.getElementById('persona_description');
    if (!field) return toastr.error('ST 페르소나 설명 입력란을 찾지 못했습니다.');
    field.value = version.desc;
    field.dispatchEvent(new Event('input', { bubbles: true })); // Let ST update its descriptor and emit PERSONA_UPDATED.
    settings().activeVersionByAvatar[persona.id] = version.name;
    saveSettingsDebounced();
    refreshAvatar();
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
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 400;
                draw(canvas.getContext('2d'), 400);
                version.overrideAvatar = canvas.toDataURL('image/webp', 0.85);
                saveSettingsDebounced();
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
        if (payload?.persona?.name && payload.persona.name !== persona.name && !confirm(`파일의 페르소나 '${payload.persona.name}'과 현재 '${persona.name}'이 다릅니다. AU를 현재 페르소나에 가져올까요?`)) return;
        const target = versionsFor(persona);
        const names = new Set(target.map(v => v.name));
        let added = 0;
        for (const item of source) {
            const version = cleanVersion(item);
            if (version && !names.has(version.name)) { target.push(version); names.add(version.name); added++; }
        }
        if (added) saveSettingsDebounced();
        if (typeof payload?.persona?.description === 'string' && payload.persona.description !== currentPersona()?.description
            && confirm('파일의 기본 페르소나 설명도 현재 페르소나에 적용할까요?')) {
            const field = document.getElementById('persona_description');
            if (field && user_avatar === persona.id) {
                field.value = payload.persona.description;
                field.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        renderManager(persona);
        toastr.info(`${added}개 AU를 추가했습니다. 중복 이름은 건너뛰었습니다.`);
    } catch (error) { notifyError(error, 'AU 파일을 읽지 못했습니다. 이 확장의 PNG 또는 JSON 백업인지 확인해 주세요.'); }
}

function openManager() {
    const persona = currentPersona();
    if (!persona) return toastr.warning('페르소나를 먼저 선택하세요.');
    if (dialog?.open) return;
    dialog = document.createElement('dialog');
    const modal = dialog;
    modal.persona = persona;
    dialog.className = 'ps-dialog';
    keepPersonaDrawerOpen(dialog);
    dialog.innerHTML = '<div class="ps-wrapper"><header><div><h3>페르소나 AU</h3><p class="ps-persona-name"></p></div><button type="button" class="ps-button ps-close" aria-label="닫기">×</button></header><div class="ps-list"></div><section class="ps-editor"></section><div class="ps-create"><input class="text_pole ps-new-name" maxlength="120" placeholder="새 AU 이름"><button type="button" class="ps-button ps-create-button">현재 설명으로 AU 만들기</button></div><footer><button type="button" class="ps-button ps-export-png">PNG 내보내기</button><button type="button" class="ps-button ps-import">PNG / JSON 가져오기</button><button type="button" class="ps-button ps-export-json">JSON 백업</button><input class="ps-import-input" type="file" accept=".png,.json,image/png,application/json" hidden></footer><p class="ps-muted">PNG는 이 확장의 메타데이터 형식입니다. ST의 기본 캐릭터·페르소나 가져오기는 AU를 읽지 않습니다.</p></div>';
    dialog.querySelector('.ps-persona-name').textContent = persona.name;
    dialog.querySelector('.ps-close').onclick = () => dialog.close();
    dialog.querySelector('.ps-create-button').onclick = () => {
        const input = dialog.querySelector('.ps-new-name');
        const name = input.value.trim();
        if (!name) return toastr.warning('새 AU 이름을 입력하세요.');
        const versions = versionsFor(persona);
        if (versions.some(v => v.name === name)) return toastr.warning('같은 이름의 AU가 있습니다. 목록에서 선택해 수정하세요.');
        versions.push({ name, desc: currentPersona()?.description ?? '', date: new Date().toISOString(), overrideAvatar: null });
        input.value = '';
        saveSettingsDebounced();
        renderManager(persona, name);
    };
    dialog.querySelector('.ps-new-name').onkeydown = event => { if (event.key === 'Enter') dialog.querySelector('.ps-create-button').click(); };
    dialog.querySelector('.ps-export-png').onclick = () => exportPng(persona);
    dialog.querySelector('.ps-export-json').onclick = () => download(new Blob([JSON.stringify({ format: 'st-persona-au-manager', version: 1, persona: { name: persona.name, description: currentPersona()?.description ?? persona.description }, versions: versionsFor(persona) }, null, 2)], { type: 'application/json' }), `${persona.name}_AU.json`);
    const legacy = settings().personaHistory?.[persona.name];
    if (Array.isArray(legacy) && Object.values(power_user.personas).filter(name => name === persona.name).length > 1) {
        dialog.querySelector('footer').append(button('이전 AU JSON 저장', () => download(new Blob([JSON.stringify(legacy, null, 2)], { type: 'application/json' }), `${persona.name}_legacy_AU.json`)));
    }
    const fileInput = dialog.querySelector('.ps-import-input');
    dialog.querySelector('.ps-import').onclick = () => fileInput.click();
    fileInput.onchange = async () => { const file = fileInput.files?.[0]; if (file) await importFile(persona, file); fileInput.value = ''; };
    dialog.addEventListener('close', () => { modal.remove(); if (dialog === modal) dialog = null; });
    document.body.append(dialog);
    dialog.showModal();
    renderManager(persona, activeName(persona.id));
}

settings();
updateLauncher();
refreshAvatar();
eventSource.on(event_types.PERSONA_CHANGED, () => { if (dialog?.open) dialog.close(); updateLauncher(); refreshAvatar(); });
eventSource.on(event_types.PERSONA_DELETED, ({ avatarId, name }) => {
    const data = settings();
    let changed = false;
    if (Object.hasOwn(data.personaHistoryByAvatar, avatarId)) {
        delete data.personaHistoryByAvatar[avatarId];
        changed = true;
    }
    if (Object.hasOwn(data.activeVersionByAvatar, avatarId)) {
        delete data.activeVersionByAvatar[avatarId];
        changed = true;
    }
    // Legacy entries were keyed by name. Keep them while another persona
    // with that name exists; otherwise the old AU data becomes orphaned.
    if (name && !Object.values(power_user.personas).includes(name)) {
        if (data.personaHistory && Object.hasOwn(data.personaHistory, name)) {
            delete data.personaHistory[name];
            changed = true;
        }
        if (data.activeVersionName && Object.hasOwn(data.activeVersionName, name)) {
            delete data.activeVersionName[name];
            changed = true;
        }
    }
    if (changed) saveSettingsDebounced();
    updateLauncher();
    refreshAvatar();
});
eventSource.on(event_types.SETTINGS_UPDATED, () => { updateLauncher(); refreshAvatar(); });
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
if (panel) new MutationObserver(() => { if (!document.getElementById(BUTTON_ID)) updateLauncher(); }).observe(panel, { childList: true, subtree: true });
