/**
 * 工作清單：每個帳號各自的；可分享給指定的人 / 群組 / 全部同事（被分享的人只能查看）。
 */
let tdStatus = 'open';
let tdTodos = [];
let tdToday = '';

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tdSetStatus(s) {
  tdStatus = s;
  ['open', 'done', 'all'].forEach((k) => document.getElementById('td-s-' + k).classList.toggle('on', k === s));
  loadTodos();
}

async function loadTodos() {
  const box = document.getElementById('td-list');
  const r = await callApi('todoGet', { scope: document.getElementById('td-scope').value, status: tdStatus }, { silent: true });
  if (!r.success) {
    box.innerHTML = `<span class="calc-hint">${esc(r.message || '')}</span>`;
    return;
  }
  tdTodos = r.todos || [];
  tdToday = r.today || localTodayStr();
  renderTodos();
}

function renderTodos() {
  const box = document.getElementById('td-list');
  document.getElementById('td-count').textContent = `共 ${tdTodos.length} 項`;
  if (!tdTodos.length) {
    box.innerHTML = '<span class="calc-hint">' + (tdStatus === 'done' ? '還沒有完成的工作。' : '沒有工作 🎉') + '</span>';
    return;
  }
  box.innerHTML = tdTodos
    .map((t) => {
      const done = t.status === 'done';
      const late = !done && t.dueDate && t.dueDate < tdToday;
      const meta = [];
      if (t.dueDate) meta.push(`<span class="${late ? 'late' : ''}">${late ? '已逾期 ' : '期限 '}${esc(t.dueDate)}</span>`);
      if (!t.isMine) meta.push(`<span class="ws-badge shared">${esc(t.ownerName)} 分享（只能看）</span>`);
      else if (t.shareMode !== 'self') meta.push(`<span class="ws-badge shared">已分享：${esc(t.shareLabel)}</span>`);
      if (done && t.doneAt) meta.push(`完成於 ${esc(String(t.doneAt).slice(0, 10))}`);
      return `<div class="todo-row${done ? ' done' : ''}"><input type="checkbox" ${done ? 'checked' : ''} ${t.canEdit ? '' : 'disabled'} onchange="tdToggle(${t.id}, this.checked)" />
        <div class="todo-main"><div class="todo-title">${esc(t.title)} <span class="todo-pri p-${esc(t.priority)}">${esc(t.priority)}</span></div>
        ${t.notes ? `<div class="calc-hint">${esc(t.notes)}</div>` : ''}
        ${meta.length ? `<div class="todo-meta">${meta.join('')}</div>` : ''}</div>
        <div class="todo-act"><button type="button" class="btn-secondary" onclick="openTodoModal(${t.id})">${t.canEdit ? '編輯' : '查看'}</button>${t.canEdit ? `<button type="button" class="btn-secondary" onclick="tdDelete(${t.id})">刪除</button>` : ''}</div></div>`;
    })
    .join('');
}

async function tdToggle(id, done) {
  const r = await callApi('todoSetStatus', { id, status: done ? 'done' : 'todo' }, { silent: true });
  if (!r.success) alert(r.message);
  loadTodos();
}

async function addTodo() {
  const title = document.getElementById('td-title').value.trim();
  if (!title) return alert('請輸入工作內容');
  const share = ShareUI.get('td-share');
  const r = await callApi('todoSave', {
    title,
    dueDate: document.getElementById('td-due').value,
    priority: document.getElementById('td-pri').value,
    notes: document.getElementById('td-notes').value.trim(),
    shareMode: share.shareMode,
    shareWith: share.shareWith,
  });
  if (!r.success) return alert(r.message);
  ['td-title', 'td-due', 'td-notes'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('td-pri').value = '中';
  ShareUI.set('td-share', 'self', []);
  loadTodos();
}

async function tdDelete(id) {
  if (!confirm('確定要刪除這項工作嗎？')) return;
  const r = await callApi('todoDelete', { id });
  if (!r.success) return alert(r.message);
  loadTodos();
}

async function openTodoModal(id) {
  const t = tdTodos.find((x) => x.id === id);
  if (!t) return;
  await ShareUI.mount('tdm-share');
  document.getElementById('tdm-id').value = t.id;
  document.getElementById('tdm-title').value = t.title;
  document.getElementById('tdm-due').value = t.dueDate || '';
  document.getElementById('tdm-pri').value = t.priority;
  document.getElementById('tdm-notes').value = t.notes || '';
  ShareUI.set('tdm-share', t.shareMode, t.shareWith);
  ['tdm-title', 'tdm-due', 'tdm-pri', 'tdm-notes'].forEach((k) => (document.getElementById(k).disabled = !t.canEdit));
  document.querySelector('#tdm-share .share-mode').disabled = !t.canEdit;
  document.getElementById('tdm-share').style.display = t.canEdit ? '' : 'none';
  document.getElementById('tdm-save').style.display = t.canEdit ? '' : 'none';
  const ro = document.getElementById('tdm-readonly');
  ro.style.display = t.canEdit ? 'none' : '';
  ro.textContent = `這是 ${t.ownerName} 分享給你的工作，只能查看，不能修改。`;
  document.getElementById('tdm-heading').textContent = t.canEdit ? '編輯工作' : '工作內容';
  document.getElementById('todo-modal').style.display = 'flex';
}

function closeTodoModal() {
  document.getElementById('todo-modal').style.display = 'none';
}

async function saveTodoEdit() {
  const share = ShareUI.get('tdm-share');
  const r = await callApi('todoSave', {
    id: Number(document.getElementById('tdm-id').value),
    title: document.getElementById('tdm-title').value.trim(),
    dueDate: document.getElementById('tdm-due').value,
    priority: document.getElementById('tdm-pri').value,
    notes: document.getElementById('tdm-notes').value.trim(),
    shareMode: share.shareMode,
    shareWith: share.shareWith,
  });
  if (!r.success) return alert(r.message);
  closeTodoModal();
  loadTodos();
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureAuth())) return;
  renderHeaderUser();
  applyAdminOnlyVisibility();
  ShareUI.mount('td-share');
  document.getElementById('td-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTodo();
  });
  loadTodos();
});

// 導覽列「↻ 重撈資料」
window.refreshPageData = () => loadTodos();
