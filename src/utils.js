import { getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

// 현재 활성화된 페르소나 이름 가져오기
export function getCurrentPersonaName() {
    const context = getContext();
    return $('.persona_name').first().text().trim() || context.powerUserSettings?.persona_selected || "Default";
}

// 현재 ST에 적혀있는 페르소나 설명 가져오기
export function getSTPersonaDescription() {
    return $('#persona_description').val() || "";
}

// ST 페르소나 설명 업데이트 및 저장
export async function updateSTPersona(description) {
    const $descInput = $('#persona_description');
    if ($descInput.length) {
        $descInput.val(description).trigger('input').trigger('change');
        await saveSettingsDebounced();
        return true;
    }
    return false;
}