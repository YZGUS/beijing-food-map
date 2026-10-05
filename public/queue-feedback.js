'use strict';
(() => {
  const drafts = new Map();
  const kinds = {
    estimate: { label: '店员预计', description: '预计等位' },
    elapsed: { label: '仍在排队（已等）', description: '至少已等待' },
    actual: { label: '已入座（实际等位）', description: '实际等位' }
  };
  const recentAge = 2 * 60 * 60 * 1000;
  const clock = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const observedTime = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  function localTime(date = new Date()) { return clock.format(date).replace(' ', 'T'); }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, text) {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  }
  async function api(path, options = {}) {
    const headers = { 'X-Food-Request': '1' };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('等位反馈暂时无法连接，请稍后重试'); }
    if (!response.ok) {
      const error = new Error(data.error || '等位反馈暂时无法连接，请稍后重试');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function loginMessage(container, text = '登录后即可分享这家分店的等位情况。') {
    container.replaceChildren(element('span', '', text));
    const link = element('a', 'queue-login', '登录后反馈');
    link.href = 'login';
    link.target = '_top';
    container.append(link);
  }
  function field(form, id, labelText, input, hint) {
    const wrap = element('div', 'queue-field');
    const label = element('label', '', labelText);
    label.htmlFor = id;
    input.id = id;
    wrap.append(label, input);
    if (hint) wrap.append(element('p', 'queue-field-hint', hint));
    form.append(wrap);
    return input;
  }
  function mount(properties, container) {
    const branchId = String(properties.branchId || properties.id || '');
    if (!branchId || !container) return;
    container.querySelector('.queue-feedback')?.remove();
    const path = 'api/branches/' + encodeURIComponent(branchId) + '/queue';
    const draft = drafts.get(branchId) || {
      observedAt: '', waitMinutes: '', kind: 'estimate', partySize: '1', note: '',
      requestKey: crypto.randomUUID()
    };
    drafts.set(branchId, draft);
    const section = element('section', 'queue-feedback');
    section.setAttribute('aria-label', '这家分店的等位情况');
    const heading = element('div', 'queue-heading');
    heading.append(element('h3', '', '等位情况'));
    const open = button('queue-open', '反馈等位');
    open.setAttribute('aria-expanded', 'false');
    heading.append(open);
    const summary = element('p', 'queue-summary', '正在载入等位反馈…');
    const status = element('p', 'queue-status');
    status.hidden = true;
    status.setAttribute('role', 'status');
    const reportsHost = element('div', 'queue-reports');
    const editor = element('div', 'queue-editor');
    editor.hidden = true;
    const form = element('form', 'queue-form');
    const prefix = 'queue-' + crypto.randomUUID();
    editor.id = prefix + '-editor';
    open.setAttribute('aria-controls', editor.id);
    const observed = document.createElement('input');
    observed.type = 'datetime-local';
    observed.required = true;
    observed.value = draft.observedAt;
    field(form, prefix + '-time', '观察时间 · 北京时间', observed, '只填写最近 30 天实际观察到的情况。');
    const kind = document.createElement('select');
    for (const [value, item] of Object.entries(kinds)) {
      const option = element('option', '', item.label);
      option.value = value;
      kind.append(option);
    }
    kind.value = draft.kind;
    field(form, prefix + '-kind', '时长类型', kind);
    const grid = element('div', 'queue-field-grid');
    const minutes = document.createElement('input');
    Object.assign(minutes, { type: 'number', min: '0', max: '600', step: '1', required: true, inputMode: 'numeric', value: draft.waitMinutes, placeholder: '例如 60' });
    field(grid, prefix + '-minutes', '等位时长（分钟）', minutes);
    const people = document.createElement('input');
    Object.assign(people, { type: 'number', min: '1', max: '20', step: '1', required: true, inputMode: 'numeric', value: draft.partySize });
    field(grid, prefix + '-people', '用餐人数', people);
    form.append(grid);
    const note = document.createElement('textarea');
    Object.assign(note, { maxLength: 250, rows: 2, value: draft.note, placeholder: '例如：取号后可在附近等候' });
    field(form, prefix + '-note', '补充说明（选填）', note);
    const error = element('p', 'queue-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const controls = element('div', 'queue-form-actions');
    const cancel = button('queue-cancel', '收起');
    const submit = button('queue-submit', '保存反馈');
    submit.type = 'submit';
    controls.append(cancel, submit);
    form.append(error, controls);
    editor.append(form);
    section.append(heading, summary, status, reportsHost, editor);
    container.append(section);
    let busy = false;
    let shownReports = [];
    let generation = 0;
    let historyTimer = null;
    function setStatus(message) {
      status.hidden = false;
      status.textContent = message;
    }
    function setError(message) { error.hidden = false; error.textContent = message; }
    function hideEditor() {
      if (busy) return;
      editor.hidden = true;
      open.setAttribute('aria-expanded', 'false');
      open.focus();
    }
    function reportCard(report, now) {
      const article = element('article', 'queue-report');
      const byline = element('div', 'queue-report-byline');
      const date = new Date(report.observedAt);
      const time = element('time', '', observedTime.format(date));
      time.dateTime = date.toISOString();
      const age = now - date.getTime();
      const state = age > recentAge ? '历史反馈' : '近期反馈';
      byline.append(time, element('span', 'queue-report-age', state));
      article.append(byline);
      const content = element('div', 'queue-report-main');
      content.append(element('strong', '', kinds[report.kind].description + ' ' + report.waitMinutes + ' 分钟'));
      content.append(element('span', '', report.partySize + ' 人用餐'));
      article.append(content);
      if (report.note) article.append(element('p', 'queue-report-note', report.note));
      const attribution = element('div', 'queue-report-attribution');
      attribution.append(element('span', '', (report.name || '食单用户') + ' · 用户自述'));
      if (report.mine) {
        const remove = button('queue-delete', '删除');
        remove.setAttribute('aria-label', '删除自己这条等位反馈');
        remove.onclick = async () => {
          if (busy) return;
          generation += 1;
          remove.disabled = true;
          try {
            await api('api/queue-reports/' + encodeURIComponent(report.id), { method: 'DELETE' });
            if (!section.isConnected) return;
            render({ reports: shownReports.filter(item => item.id !== report.id) });
            setStatus('这条等位反馈已删除。');
          } catch (cause) {
            if (!section.isConnected) return;
            remove.disabled = false;
            setStatus(cause.message);
            if (cause.status === 401) loginMessage(status, '登录已失效，请重新登录后删除。');
          }
        };
        attribution.append(remove);
      }
      article.append(attribution);
      return article;
    }
    function render(data) {
      if (!section.isConnected) return;
      if (!Array.isArray(data.reports)) throw new Error('等位反馈暂时无法读取，请重新载入');
      if (historyTimer !== null) { clearTimeout(historyTimer); historyTimer = null; }
      const expanded = !!reportsHost.querySelector('.queue-more')?.open;
      const now = Date.now();
      shownReports = data.reports.filter(report =>
        kinds[report.kind] && Number.isInteger(report.waitMinutes) &&
        Number.isInteger(report.partySize) && Number.isFinite(new Date(report.observedAt).getTime())
      ).sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt));
      summary.textContent = shownReports.length
        ? (now - new Date(shownReports[0].observedAt).getTime() > recentAge
          ? '以下为历史反馈，当前等位情况尚不清楚。'
          : '近期用户反馈，按观察时间排列。')
        : '暂无等位反馈';
      reportsHost.replaceChildren();
      for (const report of shownReports.slice(0, 3)) reportsHost.append(reportCard(report, now));
      if (shownReports.length > 3) {
        const more = element('details', 'queue-more');
        more.open = expanded;
        more.append(element('summary', '', '查看更多反馈（' + (shownReports.length - 3) + '）'));
        for (const report of shownReports.slice(3)) more.append(reportCard(report, now));
        reportsHost.append(more);
      }
      const deadlines = shownReports.map(report => new Date(report.observedAt).getTime() + recentAge + 1)
        .filter(deadline => deadline > now);
      if (deadlines.length) {
        historyTimer = setTimeout(() => {
          historyTimer = null;
          if (section.isConnected) render({ reports: shownReports });
        }, Math.max(0, Math.min(...deadlines) - Date.now()));
      }
    }
    async function load() {
      if (!section.isConnected) return;
      const attempt = ++generation;
      try {
        const data = await api(path);
        if (attempt === generation) render(data);
      }
      catch (cause) {
        if (!section.isConnected || attempt !== generation) return;
        summary.textContent = '等位反馈暂时无法载入';
        setStatus(cause.message);
        const retry = button('queue-retry', '重新载入');
        retry.onclick = async () => {
          const retryAttempt = ++generation;
          retry.disabled = true;
          try {
            const data = await api(path);
            if (!section.isConnected || retryAttempt !== generation) return;
            render(data);
            status.hidden = true;
            status.replaceChildren();
          } catch (retryCause) {
            if (!section.isConnected || retryAttempt !== generation) return;
            setStatus(retryCause.message);
            status.append(retry);
            retry.disabled = false;
          }
        };
        status.append(retry);
      }
    }
    open.onclick = async () => {
      if (busy) return;
      if (!editor.hidden) { hideEditor(); return; }
      open.disabled = true;
      try {
        const session = await api('api/session');
        if (!section.isConnected) return;
        if (!session.user) {
          status.hidden = false;
          loginMessage(status);
          return;
        }
        status.hidden = true;
        const now = new Date();
        observed.min = localTime(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
        observed.max = localTime(now);
        if (!observed.value) { observed.value = localTime(now); draft.observedAt = observed.value; }
        editor.hidden = false;
        open.setAttribute('aria-expanded', 'true');
        minutes.focus();
      } catch (cause) {
        if (section.isConnected) setStatus(cause.message);
      } finally { if (section.isConnected) open.disabled = false; }
    };
    cancel.onclick = hideEditor;
    function saveDraft() {
      Object.assign(draft, { observedAt: observed.value, waitMinutes: minutes.value,
        partySize: people.value, kind: kind.value, note: note.value, requestKey: crypto.randomUUID() });
      error.hidden = true;
    }
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
    observed.addEventListener('focus', () => {
      const now = new Date();
      observed.max = localTime(now);
      observed.min = localTime(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    });
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const date = new Date(observed.value + (observed.value.length === 16 ? ':00' : '') + '+08:00');
      const now = Date.now();
      const waitMinutes = Number(minutes.value);
      const partySize = Number(people.value);
      if (!Number.isFinite(date.getTime()) || date.getTime() > now || date.getTime() < now - 30 * 24 * 60 * 60 * 1000) {
        setError('请选择最近 30 天内的观察时间，不能填写未来时间。');
        observed.focus();
        return;
      }
      if (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 600) {
        setError('等位时长请填写 0–600 分钟之间的整数。');
        minutes.focus();
        return;
      }
      if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
        setError('用餐人数请填写 1–20 人之间的整数。');
        people.focus();
        return;
      }
      busy = true;
      generation += 1;
      error.hidden = true;
      submit.textContent = '正在保存…';
      form.querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = true; });
      try {
        const data = await api(path, { method: 'POST', body: {
          observedAt: date.toISOString(), waitMinutes, partySize, kind: kind.value,
          note: note.value.trim(), requestKey: draft.requestKey
        } });
        if (!section.isConnected) return;
        render(data);
        Object.assign(draft, { observedAt: '', waitMinutes: '', kind: 'estimate', partySize: '1', note: '', requestKey: crypto.randomUUID() });
        observed.value = ''; minutes.value = ''; kind.value = 'estimate'; people.value = '1'; note.value = '';
        editor.hidden = true;
        open.setAttribute('aria-expanded', 'false');
        setStatus('等位反馈已保存，这家分店的其他食单也能看到。');
        open.focus();
      } catch (cause) {
        if (!section.isConnected) return;
        setError(cause.message);
        if (cause.status === 401) loginMessage(error, '登录已失效，已保留填写内容。');
      } finally {
        busy = false;
        if (section.isConnected) {
          submit.textContent = '保存反馈';
          form.querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = false; });
        }
      }
    };
    load();
  }
  window.FOOD_QUEUE = { mount };
})();
