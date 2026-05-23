// ── Helpers ──
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = async (path, opts = {}) => {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (r.status === 204) return null;
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || 'API error');
  }
  return r.json();
};
const toast = (msg, type = '') => {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => (t.className = 'toast'), 2400);
};
const fmtTime = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const parseTags = s => (s || '').split(',').map(t => t.trim()).filter(Boolean);
const tryParseJSON = (s, fallback) => {
  if (!s || !s.trim()) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

// ── Navigation ──
const views = ['dashboard', 'agents', 'automations', 'logs'];
const navigate = name => {
  views.forEach(v => $('#view-' + v).classList.toggle('hidden', v !== name));
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === name));
  if (name === 'dashboard') loadDashboard();
  if (name === 'agents') loadAgents();
  if (name === 'automations') loadAutomations();
  if (name === 'logs') loadLogs();
};
$$('.nav-item').forEach(el => el.addEventListener('click', e => {
  e.preventDefault();
  navigate(el.dataset.view);
}));
document.addEventListener('click', e => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) navigate(navBtn.dataset.nav);
});

// ── Dashboard ──
async function loadDashboard() {
  try {
    const s = await api('/stats');
    $('#kpi-agents').textContent = s.agentCount;
    $('#kpi-agents-active').textContent = s.activeAgents;
    $('#kpi-automations').textContent = s.automationCount;
    $('#kpi-automations-running').textContent = s.runningAutomations;
    $('#kpi-automations-error').textContent = s.errorAutomations;
    $('#kpi-runs').textContent = s.totalRuns;
    $('#kpi-success').textContent = s.totalSuccesses;
    $('#kpi-fail').textContent = s.totalFails;
    const rate = s.totalRuns > 0 ? Math.round((s.totalSuccesses / s.totalRuns) * 100) + '%' : '—';
    $('#kpi-rate').textContent = rate;
    $('#kpi-tags').textContent = `태그 ${s.tags.length}개`;
    renderLogList($('#recent-logs'), s.recentLogs.slice(0, 8));
    $('#serverStatus').textContent = '● 서버 연결됨';
    $('#serverStatus').classList.remove('off');
  } catch (e) {
    $('#serverStatus').textContent = '● 서버 오류';
    $('#serverStatus').classList.add('off');
  }
}

// ── Agents ──
const agentSearch = $('#agent-search');
agentSearch.addEventListener('input', () => loadAgents());

async function loadAgents() {
  const q = agentSearch.value.trim();
  const items = await api('/agents' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  const grid = $('#agent-list');
  grid.innerHTML = '';
  if (items.length === 0) {
    grid.innerHTML = `<div class="log-empty">등록된 에이전트가 없습니다. "+ 새 에이전트" 버튼으로 추가하세요.</div>`;
    return;
  }
  for (const a of items) {
    grid.appendChild(renderAgentCard(a));
  }
}

function renderAgentCard(a) {
  const card = document.createElement('div');
  card.className = 'card';
  const successRate = a.runCount > 0 ? Math.round((a.successCount / a.runCount) * 100) + '%' : '—';
  card.innerHTML = `
    <div class="card-head">
      <div class="card-title">🧠 ${escape(a.name)}</div>
      <span class="status-badge status-${a.status}">${labelStatus(a.status)}</span>
    </div>
    <div class="card-desc">${escape(a.description) || '<span style="opacity:.5">설명 없음</span>'}</div>
    <div class="tag-list">${(a.tags || []).map(t => `<span class="tag">${escape(t)}</span>`).join('')}</div>
    <div class="card-meta">
      <span class="stat">▶ ${a.runCount || 0}회</span>
      <span class="stat success">✓ ${successRate}</span>
      <span class="stat">⏱ ${fmtTime(a.lastCheckedAt)}</span>
    </div>
    <div class="card-actions">
      <button class="btn-small run" data-act="run">▶ 실행</button>
      <button class="btn-small" data-act="edit">편집</button>
      <button class="btn-small" data-act="detail">상세</button>
      <button class="btn-small danger" data-act="delete" style="margin-left:auto">삭제</button>
    </div>
  `;
  card.querySelector('[data-act="run"]').addEventListener('click', () => invokeAgent(a));
  card.querySelector('[data-act="edit"]').addEventListener('click', () => openAgentModal(a));
  card.querySelector('[data-act="detail"]').addEventListener('click', () => showAgentDetail(a));
  card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteAgent(a));
  return card;
}

async function invokeAgent(a) {
  if (!a.endpoint) {
    toast('엔드포인트가 등록되지 않았습니다', 'error');
    return;
  }
  toast(`"${a.name}" 실행 중...`);
  try {
    const r = await api(`/agents/${a.id}/invoke`, { method: 'POST', body: '{}' });
    toast(r.ok ? `✓ 성공 (${r.durationMs}ms)` : `✗ HTTP ${r.status}`, r.ok ? 'success' : 'error');
    showDetailModal(`${a.name} — 실행 결과`, [
      ['상태', r.ok ? '✓ 성공' : '✗ 실패'],
      ['HTTP', r.status],
      ['소요', `${r.durationMs}ms`],
    ], r.body);
    loadAgents();
  } catch (e) {
    toast('실행 실패: ' + e.message, 'error');
  }
}

async function deleteAgent(a) {
  if (!confirm(`"${a.name}" 에이전트를 삭제할까요? 관련 로그도 함께 삭제됩니다.`)) return;
  await api(`/agents/${a.id}`, { method: 'DELETE' });
  toast('삭제되었습니다', 'success');
  loadAgents();
}

function showAgentDetail(a) {
  const rows = [
    ['ID', a.id],
    ['이름', a.name],
    ['엔드포인트', a.endpoint || '—'],
    ['메서드', a.method],
    ['상태', labelStatus(a.status)],
    ['실행', `${a.runCount || 0}회 (성공 ${a.successCount || 0} · 실패 ${a.failCount || 0})`],
    ['마지막 호출', fmtTime(a.lastCheckedAt)],
    ['태그', (a.tags || []).join(', ') || '—'],
    ['생성', fmtTime(a.createdAt)],
  ];
  const preview = a.lastResult ? JSON.stringify(a.lastResult, null, 2) : '';
  showDetailModal(`에이전트 — ${a.name}`, rows, preview);
}

// ── Agent Modal ──
$('#btn-new-agent').addEventListener('click', () => openAgentModal());

function openAgentModal(a = null) {
  $('#agent-modal-title').textContent = a ? '에이전트 편집' : '새 에이전트';
  $('#agent-id').value = a?.id || '';
  $('#agent-name').value = a?.name || '';
  $('#agent-description').value = a?.description || '';
  $('#agent-endpoint').value = a?.endpoint || '';
  $('#agent-method').value = a?.method || 'POST';
  $('#agent-headers').value = a?.headers ? JSON.stringify(a.headers, null, 2) : '';
  $('#agent-payload').value = a?.payloadTemplate || '';
  $('#agent-tags').value = (a?.tags || []).join(', ');
  $('#agent-status').value = a?.status || 'active';
  $('#modal-agent').classList.remove('hidden');
}

$('#btn-save-agent').addEventListener('click', async () => {
  const name = $('#agent-name').value.trim();
  if (!name) return toast('이름을 입력하세요', 'error');
  const data = {
    name,
    description: $('#agent-description').value,
    endpoint: $('#agent-endpoint').value.trim(),
    method: $('#agent-method').value,
    headers: tryParseJSON($('#agent-headers').value, {}),
    payloadTemplate: $('#agent-payload').value,
    tags: parseTags($('#agent-tags').value),
    status: $('#agent-status').value,
  };
  const id = $('#agent-id').value;
  try {
    if (id) await api(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    else await api('/agents', { method: 'POST', body: JSON.stringify(data) });
    toast(id ? '수정되었습니다' : '추가되었습니다', 'success');
    closeModals();
    loadAgents();
  } catch (e) { toast(e.message, 'error'); }
});

// ── Automations ──
const automationSearch = $('#automation-search');
automationSearch.addEventListener('input', () => loadAutomations());

async function loadAutomations() {
  const q = automationSearch.value.trim();
  const items = await api('/automations' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  const grid = $('#automation-list');
  grid.innerHTML = '';
  if (items.length === 0) {
    grid.innerHTML = `<div class="log-empty">등록된 자동화가 없습니다. "+ 새 자동화" 버튼으로 추가하세요.</div>`;
    return;
  }
  for (const a of items) {
    grid.appendChild(renderAutomationCard(a));
  }
}

function renderAutomationCard(a) {
  const card = document.createElement('div');
  card.className = 'card';
  const successRate = a.runCount > 0 ? Math.round((a.successCount / a.runCount) * 100) + '%' : '—';
  const typeIcon = { manual: '👆', cron: '⏰', webhook: '🔗', event: '⚡' }[a.type] || '⚙️';
  card.innerHTML = `
    <div class="card-head">
      <div class="card-title">${typeIcon} ${escape(a.name)}</div>
      <span class="status-badge status-${a.status}">${labelStatus(a.status)}</span>
    </div>
    <div class="card-desc">${escape(a.description) || '<span style="opacity:.5">설명 없음</span>'}</div>
    <div class="tag-list">
      ${a.runtime ? `<span class="tag">📍 ${escape(a.runtime)}</span>` : ''}
      ${a.schedule ? `<span class="tag">⏰ ${escape(a.schedule)}</span>` : ''}
      ${(a.tags || []).map(t => `<span class="tag">${escape(t)}</span>`).join('')}
    </div>
    <div class="card-meta">
      <span class="stat">▶ ${a.runCount || 0}회</span>
      <span class="stat success">✓ ${successRate}</span>
      <span class="stat">⏱ ${fmtTime(a.lastRunAt)}</span>
    </div>
    <div class="card-actions">
      ${a.url ? `<button class="btn-small run" data-act="trigger">▶ 트리거</button>` : ''}
      <button class="btn-small" data-act="edit">편집</button>
      <button class="btn-small" data-act="detail">상세</button>
      <button class="btn-small danger" data-act="delete" style="margin-left:auto">삭제</button>
    </div>
  `;
  card.querySelector('[data-act="trigger"]')?.addEventListener('click', () => triggerAutomation(a));
  card.querySelector('[data-act="edit"]').addEventListener('click', () => openAutomationModal(a));
  card.querySelector('[data-act="detail"]').addEventListener('click', () => showAutomationDetail(a));
  card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteAutomation(a));
  return card;
}

async function triggerAutomation(a) {
  toast(`"${a.name}" 트리거 중...`);
  try {
    const r = await api(`/automations/${a.id}/trigger`, { method: 'POST', body: '{}' });
    toast(r.ok ? `✓ 트리거 성공 (${r.durationMs}ms)` : `✗ HTTP ${r.status}`, r.ok ? 'success' : 'error');
    loadAutomations();
  } catch (e) {
    toast('트리거 실패: ' + e.message, 'error');
  }
}

async function deleteAutomation(a) {
  if (!confirm(`"${a.name}" 자동화를 삭제할까요?`)) return;
  await api(`/automations/${a.id}`, { method: 'DELETE' });
  toast('삭제되었습니다', 'success');
  loadAutomations();
}

function showAutomationDetail(a) {
  const rows = [
    ['ID', a.id],
    ['이름', a.name],
    ['유형', a.type],
    ['실행 환경', a.runtime || '—'],
    ['URL', a.url || '—'],
    ['스케줄', a.schedule || '—'],
    ['상태', labelStatus(a.status)],
    ['실행', `${a.runCount || 0}회 (성공 ${a.successCount || 0} · 실패 ${a.failCount || 0})`],
    ['마지막 실행', fmtTime(a.lastRunAt)],
    ['연결 에이전트', (a.linkedAgentIds || []).length + '개'],
    ['태그', (a.tags || []).join(', ') || '—'],
    ['생성', fmtTime(a.createdAt)],
  ];
  showDetailModal(`자동화 — ${a.name}`, rows);
}

// ── Automation Modal ──
$('#btn-new-automation').addEventListener('click', () => openAutomationModal());

async function openAutomationModal(a = null) {
  $('#automation-modal-title').textContent = a ? '자동화 편집' : '새 자동화';
  $('#automation-id').value = a?.id || '';
  $('#automation-name').value = a?.name || '';
  $('#automation-description').value = a?.description || '';
  $('#automation-type').value = a?.type || 'manual';
  $('#automation-runtime').value = a?.runtime || '';
  $('#automation-url').value = a?.url || '';
  $('#automation-schedule').value = a?.schedule || '';
  $('#automation-tags').value = (a?.tags || []).join(', ');
  $('#automation-status').value = a?.status || 'running';
  // populate linked agents
  const agents = await api('/agents');
  const sel = $('#automation-linked');
  sel.innerHTML = '';
  for (const ag of agents) {
    const opt = document.createElement('option');
    opt.value = ag.id;
    opt.textContent = ag.name;
    if ((a?.linkedAgentIds || []).includes(ag.id)) opt.selected = true;
    sel.appendChild(opt);
  }
  $('#modal-automation').classList.remove('hidden');
}

$('#btn-save-automation').addEventListener('click', async () => {
  const name = $('#automation-name').value.trim();
  if (!name) return toast('이름을 입력하세요', 'error');
  const data = {
    name,
    description: $('#automation-description').value,
    type: $('#automation-type').value,
    runtime: $('#automation-runtime').value,
    url: $('#automation-url').value.trim(),
    schedule: $('#automation-schedule').value,
    tags: parseTags($('#automation-tags').value),
    status: $('#automation-status').value,
    linkedAgentIds: [...$('#automation-linked').selectedOptions].map(o => o.value),
  };
  const id = $('#automation-id').value;
  try {
    if (id) await api(`/automations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    else await api('/automations', { method: 'POST', body: JSON.stringify(data) });
    toast(id ? '수정되었습니다' : '추가되었습니다', 'success');
    closeModals();
    loadAutomations();
  } catch (e) { toast(e.message, 'error'); }
});

// ── Logs ──
$('#log-filter').addEventListener('change', loadLogs);
$('#log-status').addEventListener('change', loadLogs);
$('#btn-refresh-logs').addEventListener('click', loadLogs);
$('#btn-clear-logs').addEventListener('click', async () => {
  if (!confirm('모든 로그를 삭제할까요?')) return;
  await api('/logs', { method: 'DELETE' });
  toast('로그가 초기화되었습니다', 'success');
  loadLogs();
});

async function loadLogs() {
  const params = new URLSearchParams();
  const t = $('#log-filter').value;
  const s = $('#log-status').value;
  if (t) params.set('refType', t);
  if (s) params.set('status', s);
  params.set('limit', '200');
  const items = await api('/logs?' + params);
  renderLogList($('#log-list'), items);
}

function renderLogList(el, items) {
  el.innerHTML = '';
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="log-empty">로그가 없습니다</div>';
    return;
  }
  for (const log of items) {
    const row = document.createElement('div');
    row.className = 'log-row';
    const badge = log.status === 'success'
      ? `<span class="status-badge status-active">성공</span>`
      : `<span class="status-badge status-error">오류</span>`;
    row.innerHTML = `
      <div class="when">${fmtTime(log.createdAt)}</div>
      <div class="type">${log.refType === 'agent' ? '🧠 에이전트' : '⚙️ 자동화'}</div>
      <div class="msg"><strong>${escape(log.refName || '')}</strong> — ${escape(log.message || '')}</div>
      <div class="when">${log.durationMs ? log.durationMs + 'ms' : '—'}</div>
      <div class="badge">${badge}</div>
    `;
    el.appendChild(row);
  }
}

// ── Detail Modal ──
function showDetailModal(title, rows, code = '') {
  $('#detail-title').textContent = title;
  const body = $('#detail-body');
  body.innerHTML = '';
  for (const [k, v] of rows) {
    const r = document.createElement('div');
    r.className = 'detail-row';
    r.innerHTML = `<div class="k">${escape(k)}</div><div>${escape(String(v))}</div>`;
    body.appendChild(r);
  }
  if (code) {
    const pre = document.createElement('pre');
    pre.className = 'code';
    pre.textContent = code;
    body.appendChild(pre);
  }
  $('#modal-detail').classList.remove('hidden');
}

// ── Modal close ──
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal')) closeModals();
});
function closeModals() {
  $$('.modal').forEach(m => m.classList.add('hidden'));
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

// ── Helpers ──
function labelStatus(s) {
  return { active: '활성', inactive: '비활성', error: '오류', running: '실행중',
    paused: '일시중지', stopped: '중지' }[s] || s;
}
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ── Init ──
navigate('dashboard');
setInterval(() => {
  if (!$('#view-dashboard').classList.contains('hidden')) loadDashboard();
}, 15000);
