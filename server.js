const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+97233823637';
const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE || '7107666223';
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN || 'fda8a8fe1d2941c2a9702821b8d72f7a86a4841f1f2c47b084';
const GREEN_API_URL = 'https://7107.api.greenapi.com';

// Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://smaeuuvhklqmvfygbulf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtYWV1dXZoa2xxbXZmeWdidWxmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY1MTk1MywiZXhwIjoyMDk4MjI3OTUzfQ.My_w_RBY21lSelNckp8qG112DV8-OwXDK6t35U7nC_c';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const conversations = new Map();
const waConversations = new Map();
const sessions = new Map(); // token -> agentId

const CACHE_FILE = path.join(__dirname, 'cache.json');
const KB_FILE = path.join(__dirname, 'kb.json');

var kbTrips = [];
var kbSupportText = '';
var siteCache = { content: '', lastScanned: null, isScanning: false, pagesScanned: 0, totalPages: 0 };
var CACHE_TTL = 24 * 60 * 60 * 1000;

// ===== DISK =====
function loadFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      var data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      siteCache.content = data.content || '';
      siteCache.lastScanned = data.lastScanned ? new Date(data.lastScanned) : null;
      console.log('מטמון נטען: ' + siteCache.content.length + ' תווים');
    }
  } catch(e) {}
  try {
    if (fs.existsSync(KB_FILE)) {
      var kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
      kbTrips = kb.trips || [];
      kbSupportText = kb.supportText || '';
    }
  } catch(e) {}
}

function saveCacheToDisk() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ content: siteCache.content, lastScanned: siteCache.lastScanned }), 'utf8'); } catch(e) {}
}
function saveKbToDisk() {
  try { fs.writeFileSync(KB_FILE, JSON.stringify({ trips: kbTrips, supportText: kbSupportText }), 'utf8'); } catch(e) {}
}

// ===== SUPABASE AGENTS =====
async function sbFetch(path, options) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=representation',
      ...(options && options.headers)
    }
  });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase error: ' + err);
  }
  var text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function getAgentByEmail(email) {
  var res = await sbFetch('agents?email=eq.' + encodeURIComponent(email), { method: 'GET' });
  return res[0] || null;
}

async function getAgentById(id) {
  var res = await sbFetch('agents?agent_id=eq.' + encodeURIComponent(id), { method: 'GET' });
  return res[0] || null;
}

async function getAllAgents() {
  return await sbFetch('agents?order=created_at.asc', { method: 'GET' });
}

async function createAgent(agent) {
  return await sbFetch('agents', { method: 'POST', body: JSON.stringify(agent) });
}

async function updateAgent(id, data) {
  return await sbFetch('agents?agent_id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(data) });
}

async function deleteAgent(id) {
  return await sbFetch('agents?agent_id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
}

async function countAgents() {
  var res = await sbFetch('agents?select=agent_id', { method: 'GET', headers: { 'Prefer': 'count=exact' } });
  return res.length;
}

// ===== AUTH =====
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

async function authMiddleware(req, res, next) {
  var token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'לא מחובר' });
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'הסשן פג' });
  try {
    var agent = await getAgentById(agentId);
    if (!agent || agent.status !== 'approved') return res.status(403).json({ error: 'אין הרשאה' });
    req.agent = agent;
    next();
  } catch(e) { res.status(500).json({ error: 'שגיאת שרת' }); }
}

async function adminMiddleware(req, res, next) {
  var token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'לא מחובר' });
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'הסשן פג' });
  try {
    var agent = await getAgentById(agentId);
    if (!agent || agent.role !== 'admin') return res.status(403).json({ error: 'נדרשות הרשאות מנהל' });
    req.agent = agent;
    next();
  } catch(e) { res.status(500).json({ error: 'שגיאת שרת' }); }
}

// ===== AGENT API =====
app.post('/api/agents/register', async function(req, res) {
  var name = req.body.name;
  var email = req.body.email;
  var password = req.body.password;
  if (!name || !email || !password) return res.status(400).json({ error: 'חסרים פרטים' });
  try {
    var exists = await getAgentByEmail(email);
    if (exists) return res.status(400).json({ error: 'אימייל כבר קיים' });
    var count = await countAgents();
    var isFirst = count === 0;
    var agent = {
      agent_id: 'agent_' + Date.now(),
      name, email, password,
      role: isFirst ? 'admin' : 'agent',
      status: isFirst ? 'approved' : 'pending',
      availability: 'online'
    };
    await createAgent(agent);
    res.json({ success: true, message: isFirst ? 'נרשמת כמנהל ✅' : 'בקשתך נשלחה לאישור המנהל ⏳' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agents/login', async function(req, res) {
  var email = req.body.email;
  var password = req.body.password;
  try {
    var agent = await getAgentByEmail(email);
    if (!agent || agent.password !== password) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    if (agent.status === 'pending') return res.status(403).json({ error: 'בקשתך ממתינה לאישור המנהל' });
    if (agent.status === 'rejected') return res.status(403).json({ error: 'בקשתך נדחתה' });
    var token = generateToken();
    sessions.set(token, agent.agent_id);
    await updateAgent(agent.agent_id, { last_login: new Date().toISOString(), availability: 'online' });
    res.json({ success: true, token, agent: { id: agent.agent_id, name: agent.name, email: agent.email, role: agent.role, availability: agent.availability } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agents/logout', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (agentId) {
    sessions.delete(token);
    try { await updateAgent(agentId, { availability: 'offline' }); } catch(e) {}
  }
  res.json({ success: true });
});

app.post('/api/agents/availability', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'לא מחובר' });
  try {
    await updateAgent(agentId, { availability: req.body.availability || 'online' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents/me', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'לא מחובר' });
  try {
    var agent = await getAgentById(agentId);
    if (!agent) return res.status(404).json({ error: 'לא נמצא' });
    res.json({ id: agent.agent_id, name: agent.name, email: agent.email, role: agent.role, availability: agent.availability });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/agents', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'לא מחובר' });
  try {
    var agent = await getAgentById(agentId);
    if (!agent || agent.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
    var list = await getAllAgents();
    res.json(list.map(function(a) {
      return { id: a.agent_id, name: a.name, email: a.email, role: a.role, status: a.status, availability: a.availability, createdAt: a.created_at, lastLogin: a.last_login };
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agents/:id/approve', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'לא מחובר' });
  try {
    var me = await getAgentById(agentId);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
    var status = req.body.action === 'approve' ? 'approved' : 'rejected';
    await updateAgent(req.params.id, { status });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agents/:id/role', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'לא מחובר' });
  try {
    var me = await getAgentById(agentId);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
    await updateAgent(req.params.id, { role: req.body.role === 'admin' ? 'admin' : 'agent' });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/agents/:id', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  if (!agentId) return res.status(401).json({ error: 'לא מחובר' });
  try {
    var me = await getAgentById(agentId);
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
    await deleteAgent(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== SCAN =====
async function fetchTripInfo(trip) {
  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search' }], system: 'אתה סוכן חיפוש. חפש מידע על הטיול מ-tarbutu.co.il. החזר: שם, קוד, תאריך יציאה, חזרה, ימים, אונייה, מדינות, מסלול, מה כולל.', messages: [{ role: 'user', content: 'חפש מידע: ' + trip.url }] })
    });
    if (!res.ok) return '';
    var data = await res.json();
    var text = data.content.filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('\n');
    return text.length > 50 ? text : '';
  } catch(e) { return ''; }
}

async function scanSite() {
  if (siteCache.isScanning || !kbTrips.length) return;
  siteCache.isScanning = true; siteCache.pagesScanned = 0; siteCache.totalPages = kbTrips.length;
  var allContent = [];
  for (var i = 0; i < kbTrips.length; i++) {
    var content = await fetchTripInfo(kbTrips[i]);
    if (content) allContent.push('=== ' + kbTrips[i].name + ' ===\n' + content);
    siteCache.pagesScanned = i + 1;
    await new Promise(function(r){setTimeout(r, 3000);});
  }
  if (allContent.length > 0) { siteCache.content = allContent.join('\n\n---\n\n'); siteCache.lastScanned = new Date(); saveCacheToDisk(); }
  siteCache.isScanning = false;
}
setInterval(function(){ if (kbTrips.length > 0) scanSite(); }, CACHE_TTL);

// ===== WHATSAPP =====
async function sendWhatsApp(to, body) {
  try {
    var toNum = to.startsWith('whatsapp:') ? to : 'whatsapp:' + to;
    var auth = Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64');
    var res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Messages.json', { method: 'POST', headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'From=' + encodeURIComponent(TWILIO_WHATSAPP_FROM) + '&To=' + encodeURIComponent(toNum) + '&Body=' + encodeURIComponent(body) });
    var data = await res.json(); return data.sid ? true : false;
  } catch(e) { return false; }
}

async function sendGreenAPI(phone, message) {
  try {
    var chatId = phone.replace('+', '') + '@c.us';
    var res = await fetch(GREEN_API_URL + '/waInstance' + GREEN_API_INSTANCE + '/sendMessage/' + GREEN_API_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, message }) });
    var data = await res.json(); return data.idMessage ? true : false;
  } catch(e) { return false; }
}

app.post('/webhook/whatsapp', function(req, res) {
  var from = req.body.From || ''; var body = req.body.Body || ''; var profileName = req.body.ProfileName || 'לקוח';
  var phone = from.replace('whatsapp:', '');
  console.log('WA נכנס מ-' + phone + ': ' + body);
  if (!waConversations.has(phone)) waConversations.set(phone, { phone, name: profileName, messages: [], status: 'new', assignedTo: null, channel: 'twilio', tags: [], createdAt: new Date(), updatedAt: new Date() });
  var conv = waConversations.get(phone);
  conv.messages.push({ role: 'customer', content: body, time: new Date() });
  conv.lastMessage = body; conv.updatedAt = new Date();
  if (conv.status === 'resolved') conv.status = 'new';
  res.set('Content-Type', 'text/xml'); res.send('<Response></Response>');
});

app.post('/webhook/greenapi', function(req, res) {
  try {
    var body = req.body;
    if (!body || body.typeWebhook !== 'incomingMessageReceived') return res.json({ ok: true });
    var phone = '+' + body.senderData.sender.replace('@c.us', '');
    var message = body.messageData && body.messageData.textMessageData ? body.messageData.textMessageData.textMessage : '';
    var name = body.senderData.senderName || phone;
    if (!message) return res.json({ ok: true });
    console.log('Green API נכנס מ-' + phone + ': ' + message);
    if (!waConversations.has(phone)) waConversations.set(phone, { phone, name, messages: [], status: 'new', assignedTo: null, channel: 'green', tags: [], createdAt: new Date(), updatedAt: new Date() });
    var conv = waConversations.get(phone);
    conv.messages.push({ role: 'customer', content: message, time: new Date() });
    conv.lastMessage = message; conv.updatedAt = new Date();
    if (conv.status === 'resolved') conv.status = 'new';
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); }
});

// ===== MISSED CALL =====
app.post('/webhook/missed-call', async function(req, res) {
  var phone = req.body.phone || '';
  var callerName = req.body.caller_name || 'לקוח';
  console.log('שיחה שלא נענתה מ-' + phone);
  if (!phone) return res.json({ ok: false, error: 'חסר מספר' });
  var message = 'שלום ' + callerName + '! 👋\n\nהתקשרת לתרבותו ולא הצלחנו לענות.\nנחזור אליך בהקדם האפשרי! 😊\n\nלפרטים נוספים: 03-5260090\nאו השאר הודעה כאן ונחזור אליך.';
  var sent = await sendGreenAPI(phone, message);
  if (!sent) sent = await sendWhatsApp(phone, message);
  res.json({ ok: sent });
});

// ===== WA CONVERSATIONS =====
app.get('/api/wa-conversations', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var agentId = sessions.get(token);
  var list = Array.from(waConversations.values()).map(function(c) {
    return { phone: c.phone, name: c.name, lastMessage: c.lastMessage || '', messageCount: c.messages.length, status: c.status || 'new', assignedTo: c.assignedTo, channel: c.channel, tags: c.tags || [], isMyConv: c.assignedTo === agentId, createdAt: c.createdAt, updatedAt: c.updatedAt };
  });
  list.sort(function(a,b) { var o={'new':0,'open':1,'resolved':2}; if(o[a.status]!==o[b.status])return o[a.status]-o[b.status]; return new Date(b.updatedAt)-new Date(a.updatedAt); });
  res.json(list);
});

app.get('/api/wa-conversations/:phone', function(req, res) {
  var phone = decodeURIComponent(req.params.phone);
  var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  res.json(c);
});

app.post('/api/wa-conversations/:phone/send', async function(req, res) {
  var token = req.headers['x-auth-token']; var agentId = sessions.get(token);
  var phone = decodeURIComponent(req.params.phone); var message = req.body.message;
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });
  var c = waConversations.get(phone); if (!c) return res.status(404).json({ error: 'לא נמצא' });
  var agentName = 'נציג';
  try { var agent = await getAgentById(agentId); if (agent) agentName = agent.name; } catch(e) {}
  var sent = c.channel === 'green' ? await sendGreenAPI(phone, message) : await sendWhatsApp(phone, message);
  if (sent) {
    c.messages.push({ role: 'agent', content: message, agentName, agentId, time: new Date() });
    c.assignedTo = agentId; c.status = 'open'; c.lastMessage = message; c.updatedAt = new Date();
    res.json({ success: true });
  } else { res.status(500).json({ error: 'שגיאה בשליחה' }); }
});

app.post('/api/wa-conversations/:phone/status', function(req, res) {
  var phone = decodeURIComponent(req.params.phone); var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.status = req.body.status || 'open'; c.updatedAt = new Date(); res.json({ success: true });
});

app.post('/api/wa-conversations/:phone/assign', function(req, res) {
  var phone = decodeURIComponent(req.params.phone); var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.assignedTo = req.body.agentId; c.status = 'open'; c.updatedAt = new Date(); res.json({ success: true });
});

app.post('/api/wa-conversations/:phone/transfer', async function(req, res) {
  var phone = decodeURIComponent(req.params.phone); var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  try {
    var token = req.headers['x-auth-token']; var agentId = sessions.get(token);
    var fromAgent = await getAgentById(agentId); var toAgent = await getAgentById(req.body.agentId);
    c.assignedTo = req.body.agentId;
    c.messages.push({ role: 'system', content: 'השיחה הועברה מ-' + (fromAgent?fromAgent.name:'נציג') + ' ל-' + (toAgent?toAgent.name:'נציג'), time: new Date() });
    c.updatedAt = new Date(); res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wa-conversations/:phone/note', async function(req, res) {
  var phone = decodeURIComponent(req.params.phone); var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  var token = req.headers['x-auth-token']; var agentId = sessions.get(token);
  var agentName = 'נציג';
  try { var agent = await getAgentById(agentId); if (agent) agentName = agent.name; } catch(e) {}
  c.messages.push({ role: 'note', content: req.body.note, agentName, time: new Date() });
  c.updatedAt = new Date(); res.json({ success: true });
});

app.post('/api/wa-conversations/:phone/tag', function(req, res) {
  var phone = decodeURIComponent(req.params.phone); var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  if (!c.tags) c.tags = [];
  if (!c.tags.includes(req.body.tag)) c.tags.push(req.body.tag);
  c.updatedAt = new Date(); res.json({ success: true });
});

app.delete('/api/wa-conversations/:phone', function(req, res) {
  waConversations.delete(decodeURIComponent(req.params.phone)); res.json({ success: true });
});

app.delete('/api/wa-conversations', function(req, res) {
  var deleted = 0;
  waConversations.forEach(function(c, phone) { if (c.status === 'resolved') { waConversations.delete(phone); deleted++; } });
  res.json({ success: true, deleted });
});

app.get('/api/reports', async function(req, res) {
  try {
    var agents = await getAllAgents();
    var agentStats = {};
    agents.forEach(function(a) { agentStats[a.agent_id] = { name: a.name, total: 0, resolved: 0, open: 0 }; });
    waConversations.forEach(function(c) {
      if (c.assignedTo && agentStats[c.assignedTo]) {
        agentStats[c.assignedTo].total++;
        if (c.status === 'resolved') agentStats[c.assignedTo].resolved++;
        else agentStats[c.assignedTo].open++;
      }
    });
    var byStatus = { new: 0, open: 0, resolved: 0 };
    var byChannel = { twilio: 0, green: 0 };
    waConversations.forEach(function(c) { byStatus[c.status||'new']++; byChannel[c.channel||'twilio']++; });
    res.json({ total: waConversations.size, byStatus, byChannel, agentStats: Object.values(agentStats) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== BOT =====
app.post('/api/kb-update', function(req, res) {
  if (req.body.trips) kbTrips = req.body.trips;
  if (req.body.supportText !== undefined) kbSupportText = req.body.supportText;
  saveKbToDisk(); res.json({ success: true });
});

function buildSystem(chatType, knowledge) {
  var supportSection = kbSupportText ? '\n\n=== מידע שירות לקוחות ===\n' + kbSupportText : '';
  var scanDate = siteCache.lastScanned ? siteCache.lastScanned.toLocaleDateString('he-IL') : 'היום';
  if (chatType === 'support') return 'אתה נציג שירות לקוחות של "תרבותו".\nחוקים:\n- ענה בעברית\n- היה חם ומועיל\n- לשאלות אישיות הפנה ל-03-5260090\n- אל תמציא מידע\n' + supportSection;
  return 'אתה יועץ מכירות של "תרבותו".\nחוקים:\n- ענה בעברית\n- היה נלהב\n- תן מידע מפורט: תאריכים, אוניות, מסלולים\n- לגבי מחירים הפנה ל-03-5260090\n- אל תמציא נתונים\n\n' + (knowledge ? 'מידע מהאתר (נסרק ' + scanDate + '):\n' + knowledge : 'טלפון: 03-5260090 | tarbutu.co.il');
}

var SIMPLE = ['שלום','היי','תודה','להתראות','בוקר','ערב','מה שלומך','מי אתה'];
function isSimple(msg) { return SIMPLE.some(function(k){return msg.toLowerCase().includes(k);}) && msg.length < 20; }

app.post('/api/chat', async function(req, res) {
  var sessionId = req.body.sessionId; var message = req.body.message;
  var history = Array.isArray(req.body.history) ? req.body.history : [];
  var chatType = req.body.chatType || 'sales';
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });
  var conv = conversations.get(sessionId);
  if (conv && conv.agentMode) return res.json({ type: 'waiting', message: 'נציג אנושי בשיחה' });
  try {
    var knowledge = '';
    if (!isSimple(message)) { if (siteCache.content) knowledge = siteCache.content; else if (kbTrips.length > 0 && !siteCache.isScanning) { scanSite(); knowledge = 'המערכת סורקת. לפרטים: 03-5260090'; } }
    var chatRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: buildSystem(chatType, knowledge), messages: history.concat([{ role: 'user', content: message }]) }) });
    var chatData = await chatRes.json();
    var reply = chatData.content && chatData.content[0] ? chatData.content[0].text : 'מצטער, נסה שוב.';
    if (!conversations.has(sessionId)) conversations.set(sessionId, { id: sessionId, history: [], agentMode: false, chatType, createdAt: new Date() });
    var c = conversations.get(sessionId);
    c.history.push({ role: 'user', content: message }); c.history.push({ role: 'assistant', content: reply });
    c.lastMessage = message; c.chatType = chatType; c.updatedAt = new Date();
    res.json({ type: 'bot', message: reply, sessionId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations', function(req, res) {
  var list = Array.from(conversations.values()).map(function(c) { return { id: c.id, lastMessage: c.lastMessage || '', agentMode: c.agentMode, chatType: c.chatType || 'sales', messageCount: c.history.length, createdAt: c.createdAt, updatedAt: c.updatedAt }; });
  res.json(list.sort(function(a,b){return new Date(b.updatedAt)-new Date(a.updatedAt);}));
});
app.get('/api/conversations/:id', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); res.json(c); });
app.post('/api/conversations/:id/takeover', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); c.agentMode=true; c.agentName=req.body.agentName||'נציג'; res.json({success:true}); });
app.post('/api/conversations/:id/agent-message', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); c.history.push({role:'agent',content:req.body.message,agentName:req.body.agentName||'נציג',time:new Date()}); c.agentMessage=req.body.message; c.agentName=req.body.agentName||'נציג'; res.json({success:true}); });
app.post('/api/conversations/:id/release', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); c.agentMode=false; res.json({success:true}); });
app.get('/api/conversations/:id/poll', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.json({type:'none'}); if(c.agentMessage){var m=c.agentMessage;var n=c.agentName;c.agentMessage=null;return res.json({type:'agent',message:m,agentName:n});} res.json({type:'none'}); });
app.delete('/api/conversations/:id', function(req, res) { conversations.delete(req.params.id); res.json({success:true}); });

app.get('/api/cache-status', function(req, res) {
  res.json({ hasCache: !!siteCache.content, lastScanned: siteCache.lastScanned, contentLength: siteCache.content.length, isScanning: siteCache.isScanning, pagesScanned: siteCache.pagesScanned, totalPages: siteCache.totalPages || kbTrips.length, savedToDisk: fs.existsSync(CACHE_FILE), kbCount: kbTrips.length });
});
app.post('/api/scan-now', function(req, res) {
  if (siteCache.isScanning) return res.json({ message: 'סריקה פעילה...' });
  if (!kbTrips.length) return res.json({ message: 'אין קישורים.' });
  scanSite(); res.json({ message: 'סריקה התחילה!' });
});

app.get('/admin', function(req, res) { var p1=path.join(__dirname,'public','admin.html'); var p2=path.join(__dirname,'admin.html'); res.sendFile(fs.existsSync(p1)?p1:p2); });
app.get('/', function(req, res) { var p1=path.join(__dirname,'public','index.html'); var p2=path.join(__dirname,'index.html'); res.sendFile(fs.existsSync(p1)?p1:p2); });

loadFromDisk();
app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
