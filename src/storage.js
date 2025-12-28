import { STORAGE_KEYS } from "./constants.js";
import { getSTPersonaDescription } from "./utils.js";

export function loadAllData() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.PERSONA_DATA)) || {};
    } catch { return {}; }
}

export function saveAllData(data) {
    localStorage.setItem(STORAGE_KEYS.PERSONA_DATA, JSON.stringify(data));
}

// 특정 페르소나의 AU 리스트 가져오기 (없으면 기본값 생성)
export function getPersonaAUs(personaName) {
    const allData = loadAllData();
    if (!allData[personaName]) {
        // 처음 접근 시 현재 적힌 내용을 '기본(Original)'으로 자동 백업
        allData[personaName] = [
            { id: 'default', title: '기본 (Original)', content: getSTPersonaDescription(), isDefault: true }
        ];
        saveAllData(allData);
    }
    return allData[personaName];
}

// AU 추가/수정
export function updateAU(personaName, auId, title, content) {
    const allData = loadAllData();
    const list = allData[personaName] || [];
    const index = list.findIndex(item => item.id === auId);
    
    if (index !== -1) {
        list[index] = { ...list[index], title, content };
    } else {
        list.push({ id: Date.now().toString(), title, content, isDefault: false });
    }
    
    allData[personaName] = list;
    saveAllData(allData);
}

// 백업 기능 (JSON 다운로드)
export function exportBackup() {
    const data = localStorage.getItem(STORAGE_KEYS.PERSONA_DATA);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `persona_au_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
}