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
app.use(express.static(path.join(__dirname)));

const conversations = new Map();

app.post('/api/chat', async (req, res) => {
  const { sessionId, message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'חסר הודעה' });
  const conv = conversations.get(sessionId);
  if (conv && conv.agentMode) {
    return res.json({ type: 'waiting', message: 'נציג אנושי בשיחה' });
  }
  try {
    let siteContent = '';
    try {
      const searchRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1500, tools: [{ type: 'web_search_20250305', name: 'web_search' }], system: 'אתה סוכן חיפוש. חפש עם site:tarbutu.co.il. ענה בעברית עם כל הפרטים.', messages: [{ role: 'user', content: `site:tarbutu.co.il ${message}` }] })
      });
      if (searchRes.ok) { const sd = await searchRes.json(); siteContent = sd.content.filter(b => b.type === 'text').map(b => b.text).join('\n'); }
    } catch (e) { console.log('Search error:', e.message); }

    const chatRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, system: `אתה העוזר של תרבותו. ענה בעברית. תן תשובות מלאות. השתמש במידע:\n${siteContent || 'ידע כללי על תרבותו - קרוזים וטיולים'}. טלפון: 03-5260090`, messages: [...history, { role: 'user', content: message }] })
    });
    const chatData = await chatRes.json();
    const reply = chatData.content?.[0]?.text || 'מצטער, נסה שוב.';
    if (!conversations.has(sessionId)) conversations.set(sessionId, { id: sessionId, history: [], agentMode: false, createdAt: new Date() });
    const c = conversations.get(sessionId);
    c.history.push({ role: 'user', content: message });
    c.history.push({ role: 'assistant', content: reply });
    c.lastMessage = message; c.updatedAt = new Date();
    res.json({ type: 'bot', message: reply, sessionId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations', (req, res) => {
  res.json(Array.from(conversations.values()).map(c => ({ id: c.id, lastMessage: c.lastMessage || '', agentMode: c.agentMode, messageCount: c.history.length, createdAt: c.createdAt, updatedAt: c.updatedAt })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});
app.get('/api/conversations/:id', (req, res) => { const c = conversations.get(req.params.id); if (!c) return res.status(404).json({ error: 'לא נמצא' }); res.json(c); });
app.post('/api/conversations/:id/takeover', (req, res) => { const c = conversations.get(req.params.id); if (!c) return res.status(404).json({ error: 'לא נמצא' }); c.agentMode = true; c.agentName = req.body.agentName || 'נציג'; res.json({ success: true }); });
app.post('/api/conversations/:id/agent-message', (req, res) => { const c = conversations.get(req.params.id); if (!c) return res.status(404).json({ error: 'לא נמצא' }); c.history.push({ role: 'agent', content: req.body.message, agentName: req.body.agentName || 'נציג', time: new Date() }); c.agentMessage =
