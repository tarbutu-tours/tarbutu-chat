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

const SEARCH_KEYWORDS = ['קרוז','טיול','מחיר','תאריך','יציאה','אונייה','ספינה','לפלנד','יפן','איסלנד','פיורד','בלטי','קנרי','גלאפגוס','פרו','קוריאה','ונציה','אוסטרליה','דנובה','ריין','שייט','כולל','ימים','לילות','עלות','הרשמה','ביטול','מדריך','מסלול','יעד','2025','2026','2027'];

function needsSearch(message) {
  var lower = message.toLowerCase();
  return SEARCH_KEYWORDS.some(function(k) { return lower.includes(k); });
}

app.post('/api/chat', async function(req, res) {
  var sessionId = req.body.sessionId;
  var message = req.body.message;
  var history = Array.isArray(req.body.history) ? req.body.history : [];
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });
  var conv = conversations.get(sessionId);
  if (conv && conv.agentMode) {
    return res.json({ type: 'waiting', message: 'נציג אנושי בשיחה' });
  }
  if (!needsSearch(message)) {
    try {
      var quickRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: 'אתה העוזר של תרבותו. ענה בעברית בצורה חמה וקצרה. טלפון: 03-5260090',
          messages: history.concat([{ role: 'user', content: message }])
        })
      });
      var qd = await quickRes.json();
      var qReply = qd.content && qd.content[0] ? qd.content[0].text : 'שלום! במה אוכל לעזור?';
      if (!conversations.has(sessionId)) conversations.set(sessionId, { id: sessionId, history: [], agentMode: false, createdAt: new Date() });
      var qc = conversations.get(sessionId);
      qc.history.push({ role: 'user', content: message });
      qc.history.push({ role: 'assistant', content: qReply });
      qc.lastMessage = message; qc.updatedAt = new Date();
      return res.json({ type: 'bot', message: qReply, sessionId: sessionId });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
  return res.json({ type: 'searching', message: 'מחפש...' });
});

app.post('/api/chat-search', async function(req, res) {
  var sessionId = req.body.sessionId;
  var message = req.body.message;
  var history = Array.isArray(req.body.history) ? req.body.history : [];
  try {
    var siteContent = '';
    try {
      var searchRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: 'אתה סוכן חיפוש. חפש עם site:tarbutu.co.il. ענה בעברית עם כל הפרטים.',
          messages: [{ role: 'user', content: 'site:tarbutu.co.il ' + message }]
        })
      });
      if (searchRes.ok) {
        var sd = await searchRes.json();
        siteContent = sd.content.filter(function(b) { return b.type === 'text'; }).map(function(b) { return b.text; }).join('\n');
      }
    } catch(e) { console.log('search error:', e.message); }
    var chatRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: 'אתה העוזר של תרבותו. ענה בעברית. תן תשובות מלאות.\nמידע:\n' + (siteContent || 'קרוזים וטיולים') + '\nטלפון: 03-5260090',
        messages: history.concat([{ role: 'user', content: message }])
      })
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

app.get('/api/conversations', function(req, res) {
  var list = Array.from(conversations.values()).map(function(c) {
    return { id: c.id, lastMessage: c.lastMessage || '', agentMode: c.agentMode, messageCount: c.history.length, createdAt: c.createdAt, updatedAt: c.updatedAt };
  });
  list.sort(function(a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
  res.json(list);
});

app.get('/api/conversations/:id', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  res.json(c);
});

app.post('/api/conversations/:id/takeover', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.agentMode = true;
  c.agentName = req.body.agentName || 'נציג';
  res.json({ success: true });
});

app.post('/api/conversations/:id/agent-message', function(req, res) {
  var c = conversations.get(req.params.id);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  c.history.push({ role: 'agent', content: req.body.message, agentName: req.body.agentName || 'נציג', time: new Date() });
  c.agentMessage = req.body.message;
  c.agentName = req.body.agentName || 'נציג';
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
  if (c.agentMessage) {
    var m = c.agentMessage;
    var n = c.agentName;
    c.agentMessage = null;
    return res.json({ type: 'agent', message: m, agentName: n });
  }
  res.json({ type: 'none' });
});

app.get('/admin', function(req, res) {
  var p1 = path.join(__dirname, 'public', 'admin.html');
  var p2 = path.join(__dirname, 'admin.html');
  res.sendFile(fs.existsSync(p1) ? p1 : p2);
});

app.get('/', function(req, res) {
  var p1 = path.join(__dirname, 'public', 'index.html');
  var p2 = path.join(__dirname, 'index.html');
  res.sendFile(fs.existsSync(p1) ? p1 : p2);
});

app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
});
