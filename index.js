// index.js 내용
import {
    extension_settings,
    loadExtensionSettings
} from '../../../extensions.js';

const extensionName = 'MyCustomExtension'; // manifest.json과 일치하게 설정
const DEFAULT_SETTINGS = {
    enabled: true,
    width: 300,
    height: 200,
    pos: { top: 100, left: 100 }
};
let settings;

/**
 * 팝업 창 UI를 DOM에 삽입
 */
function createCustomPopup() {
    const popupHTML = `
        <div id="my-custom-popup-container">
            <div id="my-custom-popup-header">
                <b>Hello SillyTavern!</b>
            </div>
            <div id="my-custom-popup-content">
                <p>이것은 확장 프로그램으로 만든 떠 있는 팝업 창입니다.</p>
                <button id="my-custom-close-btn">닫기</button>
            </div>
        </div>
    `;
    // SillyTavern의 최상위 DOM인 'body'에 추가합니다.
    $('body').append(popupHTML); 

    // 닫기 버튼 이벤트 바인딩
    $('#my-custom-close-btn').on('click', () => {
        $('#my-custom-popup-container').hide();
        settings.enabled = false;
        // 설정 저장 로직 (필요시 추가)
    });
}

/**
 * 설정 적용 및 팝업 창 표시
 */
function applySettings() {
    const $popupContainer = $('#my-custom-popup-container');

    // 1. 활성화 토글
    $popupContainer.toggle(settings.enabled); 

    // 2. 위치 및 크기 적용 (CSS 파일의 기본 스타일을 오버라이드)
    $popupContainer.css({
        top: `${settings.pos.top}px`,
        left: `${settings.pos.left}px`,
        width: `${settings.width}px`,
        height: `${settings.height}px`,
    });
    
    // 3. 설정 UI에 값 반영 (settings.html에 정의된 ID 사용)
    $('#my_ext_enable_toggle').prop('checked', settings.enabled);
    $('#my_ext_width_input').val(settings.width);
    $('#my_ext_height_input').val(settings.height);
}

/**
 * 설정 UI 변경 이벤트 핸들러
 */
function onSettingChange() {
    settings.enabled = $('#my_ext_enable_toggle').prop('checked');
    settings.width = parseInt($('#my_ext_width_input').val()) || DEFAULT_SETTINGS.width;
    settings.height = parseInt($('#my_ext_height_input').val()) || DEFAULT_SETTINGS.height;
    
    applySettings();
    // saveSettingsDebounced() 함수를 가져와야 저장이 됩니다. (팝업 메모장 참고)
}

// SillyTavern 진입점
(async function() {
    // 1. 설정 로드
    settings = extension_settings[extensionName] = extension_settings[extensionName] || DEFAULT_SETTINGS;
    if (Object.keys(settings).length === 0) {
        settings = Object.assign(extension_settings[extensionName], DEFAULT_SETTINGS);
    }
    
    // 2. UI 생성
    createCustomPopup();
    
    // 3. 설정 UI 로드 및 이벤트 바인딩
    try {
        const settingsHtml = await $.get(`scripts/extensions/third-party/${extensionName}/settings.html`);
		$("#extensions_settings2").append(settingsHtml);
        
        // 설정 변경 이벤트 바인딩
        $('#my_ext_enable_toggle, #my_ext_width_input, #my_ext_height_input').on('change', onSettingChange);

    } catch (error) {
        console.error(`[${extensionName}] Failed to load settings.html:`, error);
    }

    // 4. 최종 설정 적용
    applySettings();
})();