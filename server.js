const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const conversations = new Map();

var kbTrips = [];
var kbSupportText = '';

var siteCache = { content: '', lastScanned: null, isScanning: false, pagesScanned: 0, totalPages: 0 };
var CACHE_TTL = 24 * 60 * 60 * 1000;

async function fetchPage(url) {
  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'אתה סוכן חיפוש. סרוק את הכתובת והחזר את כל הפרטים: שם טיול, תאריך יציאה, תאריך חזרה, מספר ימים, שם אונייה, קוד טיול, מסלול, מדינות, מה כולל.',
        messages: [{ role: 'user', content: 'סרוק את הדף הזה: ' + url }]
      })
    });
    if (!res.ok) return '';
    var data = await res.json();
    return data.content.filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('\n');
  } catch(e) { console.log('שגיאת סריקה:', e.message); return ''; }
}

async function scanSite() {
  if (siteCache.isScanning) return;
  if (!kbTrips.length) { console.log('אין קישורים לסריקה'); return; }
  siteCache.isScanning = true;
  siteCache.pagesScanned = 0;
  siteCache.totalPages = kbTrips.length;
  console.log('מתחיל סריקה של ' + kbTrips.length + ' טיולים...');
  var allContent = [];
  for (var i = 0; i < kbTrips.length; i++) {
    var item = kbTrips[i];
    console.log('סורק ' + (i+1) + '/' + kbTrips.length + ': ' + item.name);
    var content = await fetchPage(item.url);
    if (content) allContent.push('=== ' + item.name + ' ===\n' + content);
    siteCache.pagesScanned = i + 1;
    await new Promise(function(r) { setTimeout(r, 2000); });
  }
  if (allContent.length > 0) {
    siteCache.content = allContent.join('\n\n---\n\n');
    siteCache.lastScanned = new Date();
    console.log('סריקה הושלמה! ' + siteCache.content.length + ' תווים');
  }
  siteCache.isScanning = false;
}

setInterval(function() { if (kbTrips.length > 0) scanSite(); }, CACHE_TTL);

app.post('/api/kb-update', function(req, res) {
  if (req.body.trips) kbTrips = req.body.trips;
  if (req.body.supportText !== undefined) kbSupportText = req.body.supportText;
  console.log('מאגר עודכן — ' + kbTrips.length + ' טיולים, ' + kbSupportText.length + ' תווי שירות');
  res.json({ success: true });
});

function buildSystem(chatType, knowledge) {
  var supportSection = kbSupportText ? '\n\n=== מידע שירות לקוחות ===\n' + kbSupportText : '';
  var scanDate = siteCache.lastScanned ? siteCache.lastScanned.toLocaleDateString('he-IL') : 'היום';

  if (chatType === 'support') {
    return 'אתה נציג שירות לקוחות של חברת "תרבותו".\n\nחוקים:\n- ענה תמיד בעברית\n- היה חם, אמפתי ומועיל\n- ענה לפי המידע שבמאגר בלבד\n- לשאלות שדורשות בדיקה אישית — הפנה ל-03-5260090\n- אל תמציא מידע שלא קיים\n\n' + supportSection + (knowledge ? '\n\nמידע נוסף:\n' + knowledge : '');
  }

  return 'אתה יועץ מכירות של חברת "תרבותו" – חברת טיולי תרבות ישראלית.\n\nחוקים:\n- ענה תמיד בעברית\n- היה נלהב ומכירתי\n- תן מידע מפורט: תאריכים, אוניות, מסלולים\n- אם יש מספר תאריכים — ציין את כולם\n- לגבי מחירים הפנה ל-03-5260090\n- אל תמציא נתונים\n\n' + (knowledge ? 'מידע עדכני מהאתר (נסרק ' + scanDate + '):\n' + knowledge : 'טלפון: 03-5260090 | tarbutu.co.il');
}

var SIMPLE = ['שלום','היי','תודה','להתראות','בוקר','ערב','מה שלומך','מי אתה'];
function isSimple(msg) { return SIMPLE.some(function(k){return msg.toLowerCase().includes(k);}) && msg.length < 20; }

app.post('/api/chat', async function(req, res) {
  var sessionId = req.body.sessionId;
  var message = req.body.message;
  var history = Array.isArray(req.body.history) ? req.body.history : [];
  var chatType = req.body.chatType || 'sales';
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });
  var conv = conversations.get(sessionId);
  if (conv && conv.agentMode) return res.json({ type: 'waiting', message: 'נציג אנושי בשיחה' });
  try {
    var knowledge = '';
    if (!isSimple(message)) {
      if (siteCache.content) knowledge = siteCache.content;
      else if (kbTrips.length > 0 && !siteCache.isScanning) scanSite();
    }
    var sys = buildSystem(chatType, knowledge);
    var chatRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: sys, messages: history.concat([{ role: 'user', content: message }]) })
    });
    var chatData = await chatRes.json();
    var reply = chatData.content && chatData.content[0] ? chatData.content[0].text : 'מצטער, נסה שוב.';
    if (!conversations.has(sessionId)) conversations.set(sessionId, { id: sessionId, history: [], agentMode: false, chatType: chatType, createdAt: new Date() });
    var c = conversations.get(sessionId);
    c.history.push({ role: 'user', content: message });
    c.history.push({ role: 'assistant', content: reply });
    c.lastMessage = message; c.chatType = chatType; c.updatedAt = new Date();
    res.json({ type: 'bot', message: reply, sessionId: sessionId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cache-status', function(req, res) {
  res.json({ hasCache: !!siteCache.content, lastScanned: siteCache.lastScanned, contentLength: siteCache.content.length, isScanning: siteCache.isScanning, pagesScanned: siteCache.pagesScanned, totalPages: siteCache.totalPages || kbTrips.length, supportTextLength: kbSupportText.length });
});

app.post('/api/scan-now', function(req, res) {
  if (siteCache.isScanning) return res.json({ message: 'סריקה פעילה...' });
  if (!kbTrips.length) return res.json({ message: 'אין קישורים במאגר.' });
  scanSite();
  res.json({ message: 'סריקה התחילה!' });
});

app.get('/api/conversations', function(req, res) {
  var list = Array.from(conversations.values()).map(function(c) {
    return { id: c.id, lastMessage: c.lastMessage || '', agentMode: c.agentMode, chatType: c.chatType || 'sales', messageCount: c.history.length, createdAt: c.createdAt, updatedAt: c.updatedAt };
  });
  res.json(list.sort(function(a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }));
});

app.get('/api/conversations/:id', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  res.json(c);
});

app.post('/api/conversations/:id/takeover', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.agentMode = true; c.agentName = req.body.agentName || 'נציג';
  res.json({ success: true });
});

app.post('/api/conversations/:id/agent-message', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.history.push({ role: 'agent', content: req.body.message, agentName: req.body.agentName || 'נציג', time: new Date() });
  c.agentMessage = req.body.message; c.agentName = req.body.agentName || 'נציג';
  res.json({ success: true });
});

app.post('/api/conversations/:id/release', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.agentMode = false;
  res.json({ success: true });
});

app.get('/api/conversations/:id/poll', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.json({ type: 'none' });
  if (c.agentMessage) { var m=c.agentMessage; var n=c.agentName; c.agentMessage=null; return res.json({ type: 'agent', message: m, agentName: n }); }
  res.json({ type: 'none' });
});

app.get('/admin', function(req, res) {
  var p1=path.join(__dirname,'public','admin.html'); var p2=path.join(__dirname,'admin.html');
  res.sendFile(fs.existsSync(p1)?p1:p2);
});

app.get('/', function(req, res) {
  var p1=path.join(__dirname,'public','index.html'); var p2=path.join(__dirname,'index.html');
  res.sendFile(fs.existsSync(p1)?p1:p2);
});

app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
