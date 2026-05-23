const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const EMPTY = { agents: [], automations: [], logs: [] };

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(EMPTY, null, 2));
    return structuredClone(EMPTY);
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch (e) {
    return structuredClone(EMPTY);
  }
}

let state = load();
let writeQueue = Promise.resolve();

function persist() {
  writeQueue = writeQueue.then(() =>
    fs.promises.writeFile(DATA_FILE, JSON.stringify(state, null, 2))
  );
  return writeQueue;
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function now() {
  return new Date().toISOString();
}

const db = {
  // ── Agents ──
  listAgents(filter = {}) {
    let items = [...state.agents];
    if (filter.q) {
      const q = filter.q.toLowerCase();
      items = items.filter(
        a =>
          a.name.toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (filter.tag) items = items.filter(a => (a.tags || []).includes(filter.tag));
    if (filter.status) items = items.filter(a => a.status === filter.status);
    return items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },
  getAgent(id) {
    return state.agents.find(a => a.id === id);
  },
  createAgent(data) {
    const agent = {
      id: id(),
      name: data.name,
      description: data.description || '',
      endpoint: data.endpoint || '',
      method: data.method || 'POST',
      headers: data.headers || {},
      payloadTemplate: data.payloadTemplate || '',
      tags: data.tags || [],
      status: data.status || 'active',
      createdAt: now(),
      updatedAt: now(),
      lastCheckedAt: null,
      lastResult: null,
      runCount: 0,
      successCount: 0,
      failCount: 0,
    };
    state.agents.push(agent);
    persist();
    return agent;
  },
  updateAgent(id, data) {
    const i = state.agents.findIndex(a => a.id === id);
    if (i < 0) return null;
    state.agents[i] = { ...state.agents[i], ...data, id, updatedAt: now() };
    persist();
    return state.agents[i];
  },
  deleteAgent(id) {
    const before = state.agents.length;
    state.agents = state.agents.filter(a => a.id !== id);
    state.logs = state.logs.filter(l => !(l.refType === 'agent' && l.refId === id));
    persist();
    return state.agents.length < before;
  },

  // ── Automations ──
  listAutomations(filter = {}) {
    let items = [...state.automations];
    if (filter.q) {
      const q = filter.q.toLowerCase();
      items = items.filter(
        a =>
          a.name.toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (filter.tag) items = items.filter(a => (a.tags || []).includes(filter.tag));
    if (filter.status) items = items.filter(a => a.status === filter.status);
    if (filter.type) items = items.filter(a => a.type === filter.type);
    return items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },
  getAutomation(id) {
    return state.automations.find(a => a.id === id);
  },
  createAutomation(data) {
    const item = {
      id: id(),
      name: data.name,
      description: data.description || '',
      type: data.type || 'manual',
      runtime: data.runtime || '',
      url: data.url || '',
      schedule: data.schedule || '',
      linkedAgentIds: data.linkedAgentIds || [],
      tags: data.tags || [],
      status: data.status || 'running',
      createdAt: now(),
      updatedAt: now(),
      lastRunAt: null,
      runCount: 0,
      successCount: 0,
      failCount: 0,
    };
    state.automations.push(item);
    persist();
    return item;
  },
  updateAutomation(id, data) {
    const i = state.automations.findIndex(a => a.id === id);
    if (i < 0) return null;
    state.automations[i] = { ...state.automations[i], ...data, id, updatedAt: now() };
    persist();
    return state.automations[i];
  },
  deleteAutomation(id) {
    const before = state.automations.length;
    state.automations = state.automations.filter(a => a.id !== id);
    state.logs = state.logs.filter(l => !(l.refType === 'automation' && l.refId === id));
    persist();
    return state.automations.length < before;
  },

  // ── Logs ──
  addLog(entry) {
    const log = {
      id: id(),
      createdAt: now(),
      ...entry,
    };
    state.logs.unshift(log);
    if (state.logs.length > 1000) state.logs.length = 1000;
    persist();
    return log;
  },
  listLogs(filter = {}) {
    let items = [...state.logs];
    if (filter.refType) items = items.filter(l => l.refType === filter.refType);
    if (filter.refId) items = items.filter(l => l.refId === filter.refId);
    if (filter.status) items = items.filter(l => l.status === filter.status);
    const limit = Math.min(filter.limit || 100, 500);
    return items.slice(0, limit);
  },
  clearLogs() {
    state.logs = [];
    persist();
  },

  // ── Stats ──
  stats() {
    const agents = state.agents;
    const automations = state.automations;
    const logs = state.logs;
    const recentLogs = logs.slice(0, 20);
    return {
      agentCount: agents.length,
      automationCount: automations.length,
      activeAgents: agents.filter(a => a.status === 'active').length,
      runningAutomations: automations.filter(a => a.status === 'running').length,
      errorAutomations: automations.filter(a => a.status === 'error').length,
      totalRuns:
        agents.reduce((s, a) => s + (a.runCount || 0), 0) +
        automations.reduce((s, a) => s + (a.runCount || 0), 0),
      totalSuccesses:
        agents.reduce((s, a) => s + (a.successCount || 0), 0) +
        automations.reduce((s, a) => s + (a.successCount || 0), 0),
      totalFails:
        agents.reduce((s, a) => s + (a.failCount || 0), 0) +
        automations.reduce((s, a) => s + (a.failCount || 0), 0),
      tags: [...new Set([...agents, ...automations].flatMap(x => x.tags || []))].sort(),
      recentLogs,
    };
  },
};

module.exports = db;
