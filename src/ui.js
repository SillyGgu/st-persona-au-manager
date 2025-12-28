import { callPopup } from "../../../../script.js";
import { getPersonaAUs, updateAU, exportBackup } from "./storage.js";
import { getCurrentPersonaName, updateSTPersona } from "./utils.js";

export async function openAUMangerModal() {
    const personaName = getCurrentPersonaName();
    const auList = getPersonaAUs(personaName);

    const listHtml = auList.map(au => `
        <div class="paum-au-item" style="display:flex; gap:10px; margin-bottom:10px; align-items:center; background:rgba(0,0,0,0.2); padding:8px; border-radius:8px;">
            <div style="flex:1;">
                <strong>${au.title}</strong>
                <div style="font-size:0.8em; opacity:0.6; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">
                    ${au.content.substring(0, 30)}...
                </div>
            </div>
            <button class="menu_button paum-apply-btn" data-id="${au.id}" title="적용">적용</button>
            ${!au.isDefault ? `<button class="menu_button paum-del-btn" data-id="${au.id}" style="color:#ff6b6b;">삭제</button>` : ''}
        </div>
    `).join('');

    const html = `
        <div class="paum-container">
            <h3>Persona AU 관리: ${personaName}</h3>
            <div class="paum-list" style="max-height:400px; overflow-y:auto; margin-bottom:15px;">
                ${listHtml}
            </div>
            <hr>
            <h4>새 AU 추가</h4>
            <input type="text" id="paum-new-title" class="text_display" placeholder="AU 이름 (예: 현대물, 판타지 등)" style="width:100%; margin-bottom:5px;">
            <textarea id="paum-new-content" class="text_display" placeholder="페르소나 내용" style="width:100%; height:100px;"></textarea>
            <div style="display:flex; justify-content:space-between; margin-top:10px;">
                <button id="paum-add-btn" class="menu_button">추가하기</button>
                <button id="paum-backup-btn" class="menu_button">전체 데이터 백업</button>
            </div>
        </div>
    `;

    callPopup(html, 'none');

    // 이벤트 리스너 등록
    $('#paum-add-btn').on('click', () => {
        const title = $('#paum-new-title').val();
        const content = $('#paum-new-content').val();
        if (title && content) {
            updateAU(personaName, null, title, content);
            openAUMangerModal(); // 새로고침
        }
    });

    $('.paum-apply-btn').on('click', function() {
        const id = $(this).data('id');
        const target = auList.find(a => a.id == id);
        if (target) {
            updateSTPersona(target.content);
            toastr.success(`${target.title} 버전이 적용되었습니다.`);
        }
    });

    $('#paum-backup-btn').on('click', exportBackup);
}