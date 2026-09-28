const FORMAT = 'st-persona-au-manager-full-backup';
const copy = value => JSON.parse(JSON.stringify(value));
const safeKey = key => !['__proto__', 'prototype', 'constructor'].includes(key);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const validImage = value => /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length < 8_000_000;

export function makeFullBackup(data, legacy, personaNames = {}) {
    return {
        format: FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        personaNames: copy(record(personaNames)),
        settings: copy(record(data)),
        legacySettings: legacy && typeof legacy === 'object' ? copy(legacy) : null,
    };
}

export function mergeFullBackup(currentData, currentLegacy, backup, currentPersonaNames = {}) {
    if (backup?.format !== FORMAT || backup.version !== 1 || !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) {
        throw new Error('지원하지 않는 전체 AU 백업입니다.');
    }
    const next = copy(record(currentData));
    const old = currentLegacy && typeof currentLegacy === 'object' ? copy(currentLegacy) : {};
    const source = backup.settings;
    const stats = { added: 0, duplicates: 0, conflicts: 0, orphanAvatars: 0, legacyEntries: 0 };
    const currentByAvatar = next.personaHistoryByAvatar = record(next.personaHistoryByAvatar);
    for (const [id, items] of Object.entries(record(source.personaHistoryByAvatar))) {
        if (!safeKey(id) || !Array.isArray(items)) continue;
        const target = currentByAvatar[id] = Array.isArray(currentByAvatar[id]) ? currentByAvatar[id] : [];
        const names = new Map(target.filter(v => v && typeof v.name === 'string').map(v => [v.name, v]));
        for (const item of items) {
            if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || typeof item.desc !== 'string') continue;
            const existing = names.get(item.name);
            if (existing) {
                if (JSON.stringify(existing) === JSON.stringify(item)) stats.duplicates++;
                else stats.conflicts++;
                continue;
            }
            const saved = copy(item);
            if (saved.overrideAvatar != null && (typeof saved.overrideAvatar !== 'string' || !validImage(saved.overrideAvatar))) saved.overrideAvatar = null;
            target.push(saved);
            names.set(saved.name, saved);
            stats.added++;
        }
        if (!Object.hasOwn(record(currentPersonaNames), id)) stats.orphanAvatars++;
    }
    for (const key of ['activeVersionByAvatar', 'personaHistory', 'activeVersionName', 'migratedLegacyByAvatar', 'archivedPersonaNamesByAvatar']) {
        const target = next[key] = record(next[key]);
        for (const [id, value] of Object.entries(record(source[key]))) {
            if (safeKey(id) && !Object.hasOwn(target, id)) target[id] = copy(value);
        }
    }
    const archivedNames = next.archivedPersonaNamesByAvatar;
    for (const [id, name] of Object.entries(record(backup.personaNames))) {
        if (safeKey(id) && !Object.hasOwn(record(currentPersonaNames), id) && typeof name === 'string' && !Object.hasOwn(archivedNames, id)) archivedNames[id] = name;
    }
    for (const [key, value] of Object.entries(record(backup.legacySettings))) {
        if (!safeKey(key)) continue;
        if (!Object.hasOwn(old, key)) { old[key] = copy(value); stats.legacyEntries++; }
        else if (['personaHistoryByAvatar', 'activeVersionByAvatar', 'personaHistory', 'activeVersionName'].includes(key)) {
            for (const [id, item] of Object.entries(record(value))) {
                if (safeKey(id) && !Object.hasOwn(record(old[key]), id)) { old[key][id] = copy(item); stats.legacyEntries++; }
            }
        }
    }
    return { settings: next, legacySettings: old, stats };
}
