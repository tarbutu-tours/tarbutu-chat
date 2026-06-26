const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- שמירת שיחות בזיכרון (בגרסה עתידית — DB) ----
const conversations = new Map();
const agents = new Map();

// ======================================================
// API: צ'אט עם AI + Web Search
// ======================================================
app.post('/api/chat', async (req, res) => {
  const { sessionId, message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });

  // בדוק אם נציג השתלט על השיחה
  const conv = conversations.get(sessionId);
  if (conv && conv.agentMode) {
    return res.json({ type: 'waiting', message: 'נציג אנושי בשיחה — ממתין לתגובה' });
  }

  try {
    // שלב 1: Web Search באתר תרבותו
    let siteContent = '';
    try {
      const searchRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: `אתה סוכן חיפוש. חפש תמיד עם site:tarbutu.co.il. ענה בעברית עם כל הפרטים שמצאת: תאריכים, אוניות, מסלולים, מחירים.`,
          messages: [{ role: 'user', content: `חפש באתר tarbutu.co.il: site:tarbutu.co.il ${message}` }]
        })
      });
      if (searchRes.ok) {
        const sd = await searchRes.json();
        siteContent = sd.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      }
    } catch (e) {
      console.log('Search error (continuing):', e.message);
    }

    // שלב 2: תשובה מלאה
    const systemPrompt = `אתה העוזר החכם של חברת "תרבותו" – חברת טיולי תרבות ישראלית.

## חוקים:
- ענה תמיד בעברית
- תן תשובות מלאות ומפורטות
- השתמש במידע מהאתר שנמצא למטה
- אם חסר מחיר מדויק — הפנה ל-03-5260090
- אל תמציא נתונים

## מידע מהאתר (עדכני):
${siteContent || '(לא נמצא מידע ספציפי — ענה מידע כללי)'}

## ידע כללי:
- חברה ישראלית: קרוזים, טיולים יבשתיים, שייט נהרות
- טלפון: 03-5260090 | tarbutu.co.il`;

    const chatRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [...history, { role: 'user', content: message }]
      })
    });

    const chatData = await chatRes.json();
    const reply = chatData.content?.[0]?.text || 'מצטער, לא הצלחתי לעבד את השאלה.';

    // שמור שיחה
    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, { id: sessionId, history: [], agentMode: false, createdAt: new Date() });
    }
    const c = conversations.get(sessionId);
    c.history.push({ role: 'user', content: message });
    c.history.push({ role: 'assistant', content: reply });
    c.lastMessage = message;
    c.lastReply = reply;
    c.updatedAt = new Date();

    res.json({ type: 'bot', message: reply, sessionId });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'שגיאת שרת: ' + err.message });
  }
});

// ======================================================
// API: ניהול שיחות (לוח נציגים)
// ======================================================
app.get('/api/conversations', (req, res) => {
  const list = Array.from(conversations.values()).map(c => ({
    id: c.id,
    lastMessage: c.lastMessage || '',
    lastReply: c.lastReply || '',
    agentMode: c.agentMode,
    messageCount: c.history.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  }));
  res.json(list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'שיחה לא נמצאה' });
  res.json(conv);
});

// נציג נכנס לשיחה
app.post('/api/conversations/:id/takeover', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'שיחה לא נמצאה' });
  conv.agentMode = true;
  conv.agentName = req.body.agentName || 'נציג';
  res.json({ success: true });
});

// נציג שולח הודעה
app.post('/api/conversations/:id/agent-message', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'שיחה לא נמצאה' });
  const { message, agentName } = req.body;
  conv.history.push({ role: 'agent', content: message, agentName: agentName || 'נציג', time: new Date() });
  conv.agentMessage = message;
  conv.agentMessageTime = new Date();
  res.json({ success: true });
});

// החזר לבוט
app.post('/api/conversations/:id/release', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'שיחה לא נמצאה' });
  conv.agentMode = false;
  res.json({ success: true });
});

// Polling לקוח — מחכה להודעת נציג
app.get('/api/conversations/:id/poll', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.json({ type: 'none' });
  if (conv.agentMessage && conv.agentMessageTime) {
    const msg = conv.agentMessage;
    const name = conv.agentName || 'נציג';
    conv.agentMessage = null;
    return res.json({ type: 'agent', message: msg, agentName: name });
  }
  res.json({ type: 'none' });
});

// ======================================================
// Routes לממשקים
// ======================================================
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ Tarbutu Chat Server running on port ${PORT}`));
