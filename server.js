const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const conversations = new Map();

var PAGES_TO_SCAN = [
  'site:tarbutu.co.il קרוזים 2026 2027 תאריכים אוניה',
  'site:tarbutu.co.il שייט נהרות 2026 2027 דנובה ריין',
  'site:tarbutu.co.il קרוז יפן מזרח הרחוק 2026 2027',
  'site:tarbutu.co.il קרוז ים בלטי פיורדים איסלנד 2026',
  'site:tarbutu.co.il קרוז ים תיכון אלסקה דרום אמריקה 2026',
  'site:tarbutu.co.il שייט נהר דאורו פורטוגל 2026 2027'
];

var siteCache = {
  content: '',
  lastScanned: null,
  isScanning: false,
  pagesScanned: 0
};

var CACHE_TTL = 24 * 60 * 60 * 1000;

async function searchOnePage(query) {
  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'אתה סוכן חיפוש. חפש מידע מפורט מאתר tarbutu.co.il. החזר את כל הפרטים: שם טיול, תאריך יציאה, מספר ימים, שם אונייה, מסלול, מה כולל.',
        messages: [{ role: 'user', content: query }]
      })
    });
    if (!res.ok) return '';
    var data = await res.json();
    return data.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n');
  } catch(e) {
    console.log('שגיאת חיפוש:', e.message);
    return '';
  }
}

async function scanSite() {
  if (siteCache.isScanning) return;
  siteCache.isScanning = true;
  siteCache.pagesScanned = 0;
  console.log('מתחיל סריקה עמוקה...');
  var allContent = [];
  for (var i = 0; i < PAGES_TO_SCAN.length; i++) {
    console.log('סורק ' + (i+1) + '/' + PAGES_TO_SCAN.length);
    var content = await searchOnePage(PAGES_TO_SCAN[i]);
    if (content) allContent.push(content);
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

scanSite();
setInterval(scanSite, CACHE_TTL);

var SIMPLE = ['שלום','היי','תודה','להתראות','בוקר','ערב','מה שלומך','מי אתה'];
function isSimple(msg) {
  var l = msg.toLowerCase();
  return SIMPLE.some(function(k) { return l.includes(k); }) && msg.length < 20;
}

app.post('/api/chat', async function(req, res) {
  var sessionId = req.body.sessionId;
  var message = req.body.message;
  var history = Array.isArray(req.body.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });
  var conv = conversations.get(sessionId);
  if (conv && conv.agentMode) return res.json({ type: 'waiting', message: 'נציג אנושי בשיחה' });
  try {
    var knowledge = '';
    if (!isSimple(message)) {
      if (siteCache.content) {
        knowledge = siteCache.content;
      } else {
        if (!siteCache.isScanning) scanSite();
        knowledge = 'המערכת עדיין סורקת את האתר. לפרטים מדויקים: 03-5260090 | tarbutu.co.il';
      }
    }
    var scanDate = siteCache.lastScanned ? siteCache.lastScanned.toLocaleDateString('he-IL') : 'היום';
    var sys = 'אתה העוזר החכם של חברת "תרבותו" – חברת טיולי תרבות ישראלית.\n\nחוקים:\n- ענה תמיד בעברית\n- תן תשובות מלאות ומפורטות\n- ציין תאריכים, שמות אוניות ומסלולים מדויקים\n- אל תמציא נתונים\n- לגבי מחירים הפנה ל-03-5260090\n\n';
    if (knowledge) {
      sys += 'מידע עדכני מהאתר (נסרק ' + scanDate + '):\n' + knowledge;
    } else {
      sys += 'טלפון: 03-5260090 | tarbutu.co.il';
    }
    var chatRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: sys, messages: history.concat([{ role: 'user', content: message }]) })
    });
    var chatData = await chatRes.json();
    var reply = chatData.content && chatData.content[0] ? chatData.content[0].text : 'מצטער, נסה שוב.';
    if (!conversations.has(sessionId)) conversations.set(sessionId, { id: sessionId, history: [], agentMode: false, createdAt: new Date() });
    var c = conversations.get(sessionId);
    c.history.push({ role: 'user', content: message });
    c.history.push({ role: 'assistant', content: reply });
    c.lastMessage = message; c.updatedAt = new Date();
    res.json({ type: 'bot', message: reply, sessionId: sessionId });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cache-status', function(req, res) {
  res.json({ hasCache: !!siteCache.content, lastScanned: siteCache.lastScanned, contentLength: siteCache.content.length, isScanning: siteCache.isScanning, pagesScanned: siteCache.pagesScanned, totalPages: PAGES_TO_SCAN.length });
});

app.post('/api/scan-now', function(req, res) {
  if (siteCache.isScanning) return res.json({ message: 'סריקה פעילה (' + siteCache.pagesScanned + '/' + PAGES_TO_SCAN.length + ')' });
  scanSite();
  res.json({ message: 'סריקה עמוקה התחילה!' });
});

app.get('/api/conversations', function(req, res) {
  var list = Array.from(conversations.values()).map(function(c) {
    return { id: c.id, lastMessage: c.lastMessage || '', agentMode: c.agentMode, messageCount: c.history.length, createdAt: c.createdAt, updatedAt: c.updatedAt };
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
