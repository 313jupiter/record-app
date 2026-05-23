const express = require('express');
const path = require('path');
const os = require('os');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Agents ──
app.get('/api/agents', (req, res) => {
  res.json(db.listAgents(req.query));
});

app.get('/api/agents/:id', (req, res) => {
  const a = db.getAgent(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(a);
});

app.post('/api/agents', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name required' });
  res.status(201).json(db.createAgent(req.body));
});

app.put('/api/agents/:id', (req, res) => {
  const a = db.updateAgent(req.params.id, req.body);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(a);
});

app.delete('/api/agents/:id', (req, res) => {
  const ok = db.deleteAgent(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// 에이전트 호출(테스트/실행)
app.post('/api/agents/:id/invoke', async (req, res) => {
  const agent = db.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  if (!agent.endpoint) return res.status(400).json({ error: 'no endpoint' });

  const startedAt = new Date();
  let payload = req.body && Object.keys(req.body).length > 0 ? req.body : null;
  if (!payload && agent.payloadTemplate) {
    try {
      payload = JSON.parse(agent.payloadTemplate);
    } catch (e) {
      payload = { raw: agent.payloadTemplate };
    }
  }

  try {
    const init = {
      method: agent.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(agent.headers || {}) },
    };
    if (init.method !== 'GET' && payload) init.body = JSON.stringify(payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const r = await fetch(agent.endpoint, { ...init, signal: controller.signal });
    clearTimeout(timer);

    const text = await r.text();
    const durationMs = Date.now() - startedAt.getTime();
    const ok = r.ok;

    db.updateAgent(agent.id, {
      lastCheckedAt: new Date().toISOString(),
      lastResult: { ok, status: r.status, durationMs, preview: text.slice(0, 500) },
      runCount: (agent.runCount || 0) + 1,
      successCount: (agent.successCount || 0) + (ok ? 1 : 0),
      failCount: (agent.failCount || 0) + (ok ? 0 : 1),
    });

    db.addLog({
      refType: 'agent',
      refId: agent.id,
      refName: agent.name,
      status: ok ? 'success' : 'error',
      httpStatus: r.status,
      durationMs,
      message: ok ? 'OK' : `HTTP ${r.status}`,
      responsePreview: text.slice(0, 500),
    });

    res.json({ ok, status: r.status, durationMs, body: text });
  } catch (err) {
    const durationMs = Date.now() - startedAt.getTime();
    db.updateAgent(agent.id, {
      lastCheckedAt: new Date().toISOString(),
      lastResult: { ok: false, error: err.message, durationMs },
      runCount: (agent.runCount || 0) + 1,
      failCount: (agent.failCount || 0) + 1,
    });
    db.addLog({
      refType: 'agent',
      refId: agent.id,
      refName: agent.name,
      status: 'error',
      durationMs,
      message: err.message,
    });
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Automations ──
app.get('/api/automations', (req, res) => {
  res.json(db.listAutomations(req.query));
});

app.get('/api/automations/:id', (req, res) => {
  const a = db.getAutomation(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(a);
});

app.post('/api/automations', (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name required' });
  res.status(201).json(db.createAutomation(req.body));
});

app.put('/api/automations/:id', (req, res) => {
  const a = db.updateAutomation(req.params.id, req.body);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(a);
});

app.delete('/api/automations/:id', (req, res) => {
  const ok = db.deleteAutomation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// 자동화 실행 기록 (외부 시스템이 결과 보고)
app.post('/api/automations/:id/report', (req, res) => {
  const item = db.getAutomation(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  const { status = 'success', message = '', durationMs = 0 } = req.body || {};
  const ok = status === 'success';
  db.updateAutomation(item.id, {
    lastRunAt: new Date().toISOString(),
    runCount: (item.runCount || 0) + 1,
    successCount: (item.successCount || 0) + (ok ? 1 : 0),
    failCount: (item.failCount || 0) + (ok ? 0 : 1),
    status: ok ? 'running' : 'error',
  });
  const log = db.addLog({
    refType: 'automation',
    refId: item.id,
    refName: item.name,
    status,
    message,
    durationMs,
  });
  res.status(201).json(log);
});

// 수동 트리거 (등록된 URL 호출)
app.post('/api/automations/:id/trigger', async (req, res) => {
  const item = db.getAutomation(req.params.id);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (!item.url) return res.status(400).json({ error: 'no url' });

  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const r = await fetch(item.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await r.text();
    const durationMs = Date.now() - startedAt;
    const ok = r.ok;

    db.updateAutomation(item.id, {
      lastRunAt: new Date().toISOString(),
      runCount: (item.runCount || 0) + 1,
      successCount: (item.successCount || 0) + (ok ? 1 : 0),
      failCount: (item.failCount || 0) + (ok ? 0 : 1),
      status: ok ? 'running' : 'error',
    });
    db.addLog({
      refType: 'automation',
      refId: item.id,
      refName: item.name,
      status: ok ? 'success' : 'error',
      httpStatus: r.status,
      durationMs,
      message: ok ? '수동 트리거 성공' : `HTTP ${r.status}`,
      responsePreview: text.slice(0, 500),
    });
    res.json({ ok, status: r.status, durationMs, body: text });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    db.updateAutomation(item.id, {
      lastRunAt: new Date().toISOString(),
      runCount: (item.runCount || 0) + 1,
      failCount: (item.failCount || 0) + 1,
      status: 'error',
    });
    db.addLog({
      refType: 'automation',
      refId: item.id,
      refName: item.name,
      status: 'error',
      durationMs,
      message: err.message,
    });
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Logs ──
app.get('/api/logs', (req, res) => {
  res.json(db.listLogs(req.query));
});

app.delete('/api/logs', (req, res) => {
  db.clearLogs();
  res.status(204).end();
});

// ── Stats ──
app.get('/api/stats', (req, res) => {
  res.json(db.stats());
});

app.listen(PORT, HOST, () => {
  console.log(`\n🤖 Automation Hub 실행 중`);
  console.log(`   로컬:    http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`   네트워크: http://${iface.address}:${PORT}  (휴대폰에서 같은 Wi-Fi로 접속)`);
      }
    }
  }
  console.log('');
});
