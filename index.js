import { BUTTON_ID, MODULE_NAME } from "./src/constants.js";
import { openAUMangerModal } from "./src/ui.js";

function addExtensionButton() {
    const container = $('.persona_controls_buttons_block');
    if (container.length === 0 || $(`#${BUTTON_ID}`).length > 0) return;

    const btn = $(`<div id="${BUTTON_ID}" class="menu_button fa-solid fa-users-rectangle interactable" 
                   title="Persona AU 관리자" tabindex="0" role="button"></div>`);
    
    btn.on('click', openAUMangerModal);
    container.prepend(btn);
}

// 버튼이 사라질 수 있으므로 폴링(Polling)으로 체크하여 다시 추가
function init() {
    setInterval(addExtensionButton, 1000);
    console.log(`[${MODULE_NAME}] 익스텐션 로드 완료`);
}

init();