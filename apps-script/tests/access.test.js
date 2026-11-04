const assert = require('assert');
const path = require('path');
const { makeEnv } = require('./gasmock');
const { ctx } = makeEnv();
let pass = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  pass++;
};

// 1. 所有需要登入的 ROUTES 都有登記權限
const missing = Object.keys(ctx.ROUTES).filter((a) => ctx.ROUTES[a].auth && !ctx.ACTION_PERM[a]);
ok(missing.length === 0, '沒登記權限的動作：' + missing.join(','));

// 2. 建立各角色帳號
const mk = (u, role, perms) => ctx.appendObjectRow('Users', { Username: u, PasswordHash: 'x', Role: role, DisplayName: u, Perms: perms ? JSON.stringify(perms) : '' });
mk('admin1', 'admin');
mk('ed', 'editor');
mk('vw', 'viewer');
mk('sal', 'sales');
mk('fa', 'fae');
mk('lim', 'limited', { cases: 'view', customers: 'edit' });
const can = (u, action) => {
  try {
    ctx.requirePermission_(action, { username: u });
    return true;
  } catch (e) {
    return false;
  }
};

['deleteCase', 'getUsers', 'dbTrim', 'deleteCustomer', 'saveFollowUp', 'getProfile'].forEach((a) => ok(can('admin1', a), 'admin ' + a));
ok(can('ed', 'createCase') && can('ed', 'updateCustomer') && can('ed', 'searchProducts') && can('ed', 'getCases'), 'editor rw');
ok(!can('ed', 'deleteCase') && !can('ed', 'deleteCustomer') && !can('ed', 'deleteProduct') && !can('ed', 'deleteContactLog'), 'editor 不能刪除');
ok(!can('ed', 'getUsers') && !can('ed', 'addUser') && !can('ed', 'getLoginLogs') && !can('ed', 'dbStatus'), 'editor 不能管帳號');
ok(can('ed', 'changePassword') && can('ed', 'toggleFavorite') && can('ed', 'addMemo'), 'editor 個人功能');
ok(can('vw', 'getCases') && can('vw', 'getCustomers') && can('vw', 'searchProducts') && can('vw', 'generateQuoteDoc') && can('vw', 'getContactLogs'), 'viewer 查看');
ok(!can('vw', 'createCase') && !can('vw', 'updateCustomer') && !can('vw', 'addContactLog') && !can('vw', 'saveFollowUp') && !can('vw', 'addProduct') && !can('vw', 'uploadCaseAttachment'), 'viewer 不能寫');
ok(!can('vw', 'deleteCase') && !can('vw', 'getUsers'), 'viewer 不能刪 / 管帳號');
ok(can('vw', 'changePassword') && can('vw', 'updateProfile') && can('vw', 'getMemos'), 'viewer 個人功能');
ok(can('lim', 'getCases') && can('lim', 'getCase') && !can('lim', 'createCase') && !can('lim', 'updateCase'), 'limited cases 只能看');
ok(can('lim', 'getCustomers') && can('lim', 'saveFollowUp') && can('lim', 'addContactLog') && !can('lim', 'deleteCustomer'), 'limited customers 可編輯不可刪');
ok(!can('lim', 'searchProducts') && !can('lim', 'addProduct') && !can('lim', 'getUsers'), 'limited 沒開放的區塊');
ok(can('lim', 'getProfile') && can('lim', 'changePassword'), 'limited 個人功能');
ok(can('sal', 'deleteCustomer') && can('sal', 'deleteCase') && can('sal', 'importDehongProducts') && can('sal', 'createCase'), 'sales 舊權限');
ok(!can('sal', 'getUsers') && !can('sal', 'deleteStaff') && !can('sal', 'dbTrim'), 'sales 不能管帳號');
ok(can('fa', 'createCase') && !can('fa', 'deleteCase') && !can('fa', 'deleteCustomer') && !can('fa', 'importDehongProducts') && !can('fa', 'renameCase'), 'fae 舊權限');
ok(!can('ed', 'noSuchAction') && can('admin1', 'noSuchAction'), '未知動作只有 admin');
ok(!can('ghost', 'getProfile'), '不存在帳號');

const acc = (u) => ctx.accessOf_(ctx.findUserRow_(u));
ok(acc('ed').blocks.cases === 'edit' && !acc('ed').canDelete, 'accessOf editor');
ok(acc('vw').blocks.products === 'view', 'accessOf viewer');
ok(acc('lim').blocks.cases === 'view' && acc('lim').blocks.customers === 'edit' && acc('lim').blocks.products === 'none', 'accessOf limited');
ok(acc('admin1').canDelete && acc('admin1').isAdmin, 'accessOf admin');
ok(acc('sal').canDelete && acc('sal').blocks.bot === 'none', 'accessOf sales');

const call = (fn, body, u) => ctx[fn](Object.assign({ _user: { username: u || 'admin1' } }, body));
let r = call('handleAddUser', { username: 'n1', role: 'limited', perms: { copy: 'edit', bot: 'bogus', nothing: 'edit' } });
ok(r.success, '新增 limited');
let row = ctx.findUserRow_('n1');
ok(row.Perms === '{"copy":"edit"}', '清理權限 ' + row.Perms);
ok(!call('handleAddUser', { username: 'n2', role: 'limited', perms: {} }).success, 'limited 要至少一項');
ok(!call('handleAddUser', { username: 'n3', role: 'boss' }).success, '角色不合法');
ok(call('handleAddUser', { username: 'n4', role: 'viewer' }).success && ctx.findUserRow_('n4').Perms === '', 'viewer 無 perms');
const idx = (u) => ctx.findUserRowIndex_(u);
ok(!call('handleUpdateUser', { rowIndex: idx('admin1'), fields: { Role: 'editor' } }).success, '不能自己降級（唯一管理員）');
mk('admin2', 'admin');
ok(!call('handleUpdateUser', { rowIndex: idx('admin1'), fields: { Role: 'editor' } }).success, '即使有第二位管理員也不能自己降級');
ok(call('handleUpdateUser', { rowIndex: idx('admin1'), fields: { Role: 'editor' } }, 'admin2').success, '由另一位管理員降級可');
ok(!call('handleUpdateUser', { rowIndex: idx('admin2'), fields: { Role: 'viewer' } }, 'admin2').success, '只剩一位時不能降');
ok(call('handleUpdateUser', { rowIndex: idx('n4'), fields: { Role: 'limited', Perms: { products: 'view' } } }, 'admin2').success && ctx.findUserRow_('n4').Perms === '{"products":"view"}', '改成 limited');
ok(call('handleUpdateUser', { rowIndex: idx('n4'), fields: { Role: 'editor' } }, 'admin2').success && ctx.findUserRow_('n4').Perms === '', '改回 editor 清掉 Perms');
ok(can('n4', 'createCase'), '改角色立刻生效');
ok(!call('handleDeleteUser', { rowIndex: idx('admin2') }, 'admin2').success, '不能刪自己');
const gu = call('handleGetUsers', {}, 'admin2');
ok(gu.users.every((u) => !('PasswordHash' in u)) && gu.legacyCount === 2 && gu.blocks.length === 6, 'getUsers');
r = call('handleMigrateRoles', {});
ok(r.success && r.changed.sales === 1 && r.changed.fae === 1 && ctx.findUserRow_('sal').Role === 'editor' && !can('sal', 'deleteCase'), '遷移舊角色');
console.log('通過 ' + pass + ' 項');
