/**
 * 分享對象選擇器（行事曆 / 工作清單 / 備忘錄共用）
 *   自己 → 只有自己看得到（預設）／ 指定的人 ／ 自訂群組（管理員在「帳號管理」建立）／ 全部同事
 *   被分享的人「只能查看」，修改 / 刪除只有擁有者。
 * 用法：ShareUI.mount(容器元素) → ShareUI.set(容器, mode, with) → ShareUI.get(容器) = { shareMode, shareWith }
 */
const ShareUI = {
  targets: null,
  loading: null,

  /** 帳號與群組清單（整個頁面只抓一次） */
  load() {
    if (this.targets) return Promise.resolve(this.targets);
    if (!this.loading) {
      this.loading = callApi('getShareTargets', {}, { silent: true }).then((r) => {
        this.targets = r && r.success ? r : { users: [], groups: [], me: '' };
        this.loading = null;
        return this.targets;
      });
    }
    return this.loading;
  },

  esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  async mount(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    const t = await this.load();
    const me = t.me || (typeof currentUsername !== 'undefined' ? currentUsername : '');
    const users = (t.users || []).filter((u) => u.username !== me);
    el.classList.add('share-box');
    el.innerHTML = `
      <select class="share-mode">
        <option value="self">只有我自己</option>
        <option value="users">指定的人…</option>
        <option value="groups">自訂群組…</option>
        <option value="all">全部同事（只能看）</option>
      </select>
      <div class="share-pick share-users" style="display:none;">
        ${users.length ? users.map((u) => `<label><input type="checkbox" value="${this.esc(u.username)}" /> ${this.esc(u.name)}</label>`).join('') : '<span class="calc-hint">沒有其他帳號</span>'}
      </div>
      <div class="share-pick share-groups" style="display:none;">
        ${(t.groups || []).length ? t.groups.map((g) => `<label><input type="checkbox" value="${g.id}" /> ${this.esc(g.name)} <span class="calc-hint">${g.count} 人</span></label>`).join('') : '<span class="calc-hint">還沒有群組（系統管理員可以到「帳號管理」建立）</span>'}
      </div>
      <div class="calc-hint share-note">被分享的人只能查看，不能修改或刪除。</div>`;
    const sync = () => {
      const m = el.querySelector('.share-mode').value;
      el.querySelector('.share-users').style.display = m === 'users' ? '' : 'none';
      el.querySelector('.share-groups').style.display = m === 'groups' ? '' : 'none';
    };
    el.querySelector('.share-mode').addEventListener('change', sync);
    el._shareSync = sync;
  },

  set(el, mode, list) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el || !el.querySelector('.share-mode')) return;
    el.querySelector('.share-mode').value = ['users', 'groups', 'all'].includes(mode) ? mode : 'self';
    const picked = (list || []).map(String);
    el.querySelectorAll('.share-pick input').forEach((c) => (c.checked = picked.includes(c.value)));
    el._shareSync();
  },

  get(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el || !el.querySelector('.share-mode')) return { shareMode: 'self', shareWith: [] };
    const mode = el.querySelector('.share-mode').value;
    const box = mode === 'users' ? '.share-users' : mode === 'groups' ? '.share-groups' : null;
    const list = box ? [...el.querySelectorAll(box + ' input:checked')].map((c) => (mode === 'groups' ? Number(c.value) : c.value)) : [];
    return { shareMode: mode, shareWith: list };
  },
};
