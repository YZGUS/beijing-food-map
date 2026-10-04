(() => {
 'use strict';
 const $ = id => document.getElementById(id);
 const baseURL = new URL('./', location.href);
 let registering = false, busy = false;
 function setMode(value) {
  registering = value;
  $('register-fields').hidden = !value;
  $('display-name').required = value;
  $('invitation-code').required = value;
  $('password').minLength = value ? 12 : 1;
  $('password').autocomplete = value ? 'new-password' : 'current-password';
  $('form-title').textContent = value ? '一起记录好吃的' : '欢迎回来';
  $('form-description').textContent = value ? '使用邀请口令创建账号，昵称会随你的记录与评价展示。' : '登录后，继续浏览收藏、记录美食与分享体验。';
  $('submit-auth').textContent = value ? '创建账号' : '登录食单';
  $('toggle-mode').textContent = value ? '已有账号？去登录' : '有邀请口令？创建账号';
  $('auth-status').textContent = '';
  $('username').focus();
 }
 $('toggle-mode').addEventListener('click', () => { if (!busy) setMode(!registering); });
 $('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !$('auth-form').reportValidity()) return;
  busy = true;
  $('submit-auth').disabled = true;
  $('toggle-mode').disabled = true;
  $('auth-status').textContent = '';
  const payload = { username: $('username').value.trim(), password: $('password').value };
  if (registering) { payload.displayName = $('display-name').value.trim(); payload.code = $('invitation-code').value; }
  try {
   const res = await fetch(new URL(registering ? 'auth/register' : 'auth/login', baseURL), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Food-Request': '1' }, body: JSON.stringify(payload) });
   const result = await res.json();
   if (!res.ok) throw new Error(result.error || '暂时无法登录，请稍后重试');
   $('password').value = '';
   $('invitation-code').value = '';
   location.replace(baseURL.href);
  } catch (error) { $('auth-status').textContent = error instanceof TypeError ? '连接暂时中断，请稍后重试。' : error.message; }
  finally { busy = false; $('submit-auth').disabled = false; $('toggle-mode').disabled = false; }
 });
 async function loadMode() {
  try {
   const res = await fetch(new URL('auth/me', baseURL), { credentials: 'same-origin', cache: 'no-store' });
   if (!res.ok) return;
   const result = await res.json();
   if (result.user) { location.replace(baseURL.href); return; }
   $('toggle-mode').hidden = !result.registrationEnabled;
   $('browse-link').hidden = !result.publicRead;
  } catch { $('auth-status').textContent = '连接暂时中断，请稍后重试。'; }
 }
 loadMode();
})();
