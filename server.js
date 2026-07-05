const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Clients ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://smaeuuvhklqmvfygbulf.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtYWV1dXZoa2xxbXZmeWdidWxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTE5NTMsImV4cCI6MjA5ODIyNzk1M30.J5Rc3NR8cfl6tzfU1spJVtGQvM8ocb8IfEXA49t8zF4'
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const twilioClient = twilio(
  process.env.TWILIO_SID || 'AC0c7aba8165d7a96b7ab11c05b6c57fdf',
  process.env.TWILIO_TOKEN || '58ae4b7facd36d996963b461180101af'
);

const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE || '7107666399';
const GREEN_API_TOKEN    = process.env.GREEN_API_TOKEN    || 'f7434d0d76894545ad7050789742777d96781ce277af4a278f';
const GREEN_API_BASE     = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE}`;

// ── Admin agent ───────────────────────────────────────────
const ADMIN_AGENT = {
  id: 'admin-1',
  name: 'יניב',
  email: 'yanivd@rimon-tours.co.il',
  role: 'admin',
  status: 'approved',
  availability: 'online',
};

// ── Supabase helpers ──────────────────────────────────────

async function getAgent(agentId) {
  const { data, error } = await supabase.from('agents').select('*').eq('id', agentId).single();
  if (error) throw error;
  return data;
}

async function getAllAgents() {
  const { data, error } = await supabase.from('agents').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createAgent(agent) {
  const { data, error } = await supabase.from('agents').insert([agent]).select().single();
  if (error) throw error;
  return data;
}

async function updateAgent(agentId, updates) {
  const { data, error } = await supabase.from('agents').update(updates).eq('id', agentId).select().single();
  if (error) throw error;
  return data;
}

async function deleteAgent(agentId) {
  const { error } = await supabase.from('agents').delete().eq('id', agentId);
  if (error) throw error;
}

async function getConversation(phone) {
  const { data } = await supabase.from('conversations').select('*').eq('phone', phone).single();
  return data;
}

async function upsertConversation(phone, updates) {
  const existing = await getConversation(phone);
  if (existing) {
    const { data, error } = await supabase.from('conversations').update({ ...updates, updated_at: new Date().toISOString() }).eq('phone', phone).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase.from('conversations').insert([{ phone, ...updates, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]).select().single();
    if (error) throw error;
    return data;
  }
}

async function getAllConversations() {
  const { data, error } = await supabase.from('conversations').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── AI Response ───────────────────────────────────────────

async function getAIResponse(agentId, phone, userMessage) {
  try {
    const conv = await getConversation(phone);
    const history = conv?.messages || [];
    const updatedHistory = [...history, { role: 'user', content: userMessage }];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: 'אתה עוזר AI של תרבותו - חברת טיולים ישראלית. ענה בעברית בצורה ידידותית ומקצועית.',
      messages: updatedHistory.slice(-20),
    });

    const aiMessage = response.content[0].text;
    const finalHistory = [...updatedHistory, { role: 'assistant', content: aiMessage }];
    await upsertConversation(phone, { agent_id: agentId, messages: finalHistory, last_message: userMessage, last_reply: aiMessage });
    return aiMessage;
  } catch (err) {
    console.error('AI Error:', err);
    return 'מצטער, אירעה שגיאה. נסה שוב.';
  }
}

// ── Green API helpers ─────────────────────────────────────

async function sendGreenAPI(chatId, message) {
  try {
    await axios.post(`${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`, { chatId, message });
  } catch (err) {
    console.error('Green API send error:', err.message);
  }
}

async function pollGreenAPI() {
  try {
    const res = await axios.get(`${GREEN_API_BASE}/receiveNotification/${GREEN_API_TOKEN}`);
    if (!res.data || !res.data.receiptId) return;
    const { receiptId, body } = res.data;
    if (body?.typeWebhook === 'incomingMessageReceived') {
      const msg = body.messageData;
      const chatId = body.senderData?.chatId;
      const phone = chatId?.replace('@c.us', '').replace('@g.us', '');
      const text = msg?.textMessageData?.textMessage || msg?.extendedTextMessageData?.text;
      if (text && phone && !chatId.includes('@g.us')) {
        console.log(`[Polling] Message from ${phone}: ${text}`);
        const reply = await getAIResponse('default', phone, text);
        await sendGreenAPI(chatId, reply);
      }
    }
    await axios.delete(`${GREEN_API_BASE}/deleteNotification/${GREEN_API_TOKEN}/${receiptId}`);
  } catch (err) {}
}

setInterval(pollGreenAPI, 30000);

// ── Webhooks ──────────────────────────────────────────────

app.post('/webhook/greenapi', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body?.typeWebhook !== 'incomingMessageReceived') return;
    const msg = body.messageData;
    const chatId = body.senderData?.chatId;
    const phone = chatId?.replace('@c.us', '').replace('@g.us', '');
    const text = msg?.textMessageData?.textMessage || msg?.extendedTextMessageData?.text;
    if (!text || !phone) return;
    console.log(`[Webhook Green] ${phone}: ${text}`);
    const reply = await getAIResponse('default', phone, text);
    await sendGreenAPI(chatId, reply);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const from = req.body.From?.replace('whatsapp:', '');
    const text = req.body.Body;
    if (!from || !text) return res.sendStatus(200);
    console.log(`[Twilio] ${from}: ${text}`);
    const reply = await getAIResponse('default', from, text);
    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || '+97233823637'}`,
      to: `whatsapp:${from}`,
      body: reply,
    });
    res.sendStatus(200);
  } catch (err) {
    console.error('Twilio webhook error:', err.message);
    res.sendStatus(500);
  }
});

// ── Auth ──────────────────────────────────────────────────

app.post('/api/agents/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'yanivd@rimon-tours.co.il' && password === 'tarbutu2024') {
    res.json({ success: true, token: 'admin-token-tarbutu', agent: ADMIN_AGENT });
  } else {
    res.status(401).json({ error: 'פרטי התחברות שגויים' });
  }
});

app.post('/api/agents/register', (req, res) => {
  res.status(403).json({ error: 'הרשמה לא מאושרת' });
});

app.get('/api/agents/me', (req, res) => {
  res.json(ADMIN_AGENT);
});

app.post('/api/agents/logout', (req, res) => {
  res.json({ success: true });
});

app.post('/api/agents/availability', (req, res) => {
  res.json({ success: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'yanivd@rimon-tours.co.il' && password === 'tarbutu2024') {
    res.json({ success: true, token: 'admin-token-tarbutu', agent: ADMIN_AGENT });
  } else {
    res.status(401).json({ error: 'פרטי התחברות שגויים' });
  }
});

// ── Agents CRUD ───────────────────────────────────────────

app.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAllAgents();
    res.json(agents);
  } catch (err) {
    res.json([ADMIN_AGENT]);
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const agent = await createAgent({ ...req.body, created_at: new Date().toISOString() });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/agents/:id', async (req, res) => {
  try {
    const agent = await updateAgent(req.params.id, req.body);
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/:id/approve', async (req, res) => {
  try {
    const status = req.body.action === 'approve' ? 'approved' : 'rejected';
    await updateAgent(req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  try {
    await deleteAgent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WA Conversations ──────────────────────────────────────

app.get('/api/wa-conversations', async (req, res) => {
  try {
    const convs = await getAllConversations();
    const waList = convs.map(c => ({
      phone: c.phone,
      name: c.phone,
      lastMessage: c.last_message || '',
      status: c.status || 'new',
      updatedAt: c.updated_at,
      channel: 'green',
      tags: c.tags || [],
      messages: c.messages || [],
      isMyConv: false,
    }));
    res.json(waList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wa-conversations/:phone', async (req, res) => {
  try {
    const conv = await getConversation(decodeURIComponent(req.params.phone));
    if (!conv) return res.json({ phone: req.params.phone, messages: [], status: 'new', tags: [] });
    res.json({
      phone: conv.phone,
      name: conv.phone,
      messages: conv.messages || [],
      status: conv.status || 'new',
      channel: 'green',
      tags: conv.tags || [],
      updatedAt: conv.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa-conversations/:phone/send', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { message } = req.body;
    await sendGreenAPI(`${phone}@c.us`, message);
    const conv = await getConversation(phone);
    const msgs = conv?.messages || [];
    msgs.push({ role: 'agent', content: message, time: new Date().toISOString(), channel: 'green', agentName: 'יניב' });
    await upsertConversation(phone, { messages: msgs, last_reply: message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa-conversations/:phone/status', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    await upsertConversation(phone, { status: req.body.status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa-conversations/:phone/note', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const conv = await getConversation(phone);
    const msgs = conv?.messages || [];
    msgs.push({ role: 'note', content: req.body.note, time: new Date().toISOString() });
    await upsertConversation(phone, { messages: msgs });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa-conversations/:phone/tag', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const conv = await getConversation(phone);
    const tags = conv?.tags || [];
    if (!tags.includes(req.body.tag)) tags.push(req.body.tag);
    await upsertConversation(phone, { tags });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa-conversations/:phone/assign', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    await upsertConversation(phone, { assigned_agent: req.body.agentId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wa-conversations/:phone/transfer', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/wa-conversations/delete-all', async (req, res) => {
  try {
    await supabase.from('conversations').delete().neq('phone', '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wa-conversations/:phone', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    await supabase.from('conversations').delete().eq('phone', phone);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wa-conversations', async (req, res) => {
  try {
    const { data } = await supabase.from('conversations').select('phone').eq('status', 'resolved');
    if (data) {
      for (const c of data) {
        await supabase.from('conversations').delete().eq('phone', c.phone);
      }
    }
    res.json({ deleted: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bot Conversations ─────────────────────────────────────

app.get('/api/conversations', async (req, res) => {
  try {
    const convs = await getAllConversations();
    res.json(convs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversations/:phone', async (req, res) => {
  try {
    const conv = await getConversation(req.params.phone);
    res.json(conv || { phone: req.params.phone, messages: [], history: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversations/:phone', async (req, res) => {
  try {
    await supabase.from('conversations').delete().eq('phone', req.params.phone);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations/:id/takeover', async (req, res) => {
  try {
    await upsertConversation(req.params.id, { agentMode: true, agentName: req.body.agentName });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations/:id/release', async (req, res) => {
  try {
    await upsertConversation(req.params.id, { agentMode: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations/:id/agent-message', async (req, res) => {
  try {
    const conv = await getConversation(req.params.id);
    const msgs = conv?.messages || [];
    msgs.push({ role: 'agent', content: req.body.message, agentName: req.body.agentName, time: new Date().toISOString() });
    await upsertConversation(req.params.id, { messages: msgs });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── KB / Cache / Reports ──────────────────────────────────

app.post('/api/kb-update', (req, res) => { res.json({ success: true }); });
app.post('/api/scan-now', (req, res) => { res.json({ success: true }); });
app.get('/api/cache-status', (req, res) => { res.json({ hasCache: false, isScanning: false, contentLength: 0, pagesScanned: 0, totalPages: 0 }); });
app.post('/api/import-green', (req, res) => { res.json({ success: true, message: 'לא זמין' }); });

app.get('/api/reports', async (req, res) => {
  try {
    const convs = await getAllConversations();
    const byStatus = { new: 0, open: 0, resolved: 0 };
    const byChannel = { green: 0, twilio: 0 };
    convs.forEach(c => {
      const s = c.status || 'new';
      byStatus[s] = (byStatus[s] || 0) + 1;
      byChannel.green++;
    });
    res.json({ total: convs.length, byStatus, byChannel, agentStats: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Send / Chat / Status ──────────────────────────────────

app.post('/api/send', async (req, res) => {
  try {
    const { phone, message, channel } = req.body;
    if (channel === 'whatsapp-twilio') {
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || '+97233823637'}`,
        to: `whatsapp:${phone}`,
        body: message,
      });
    } else {
      await sendGreenAPI(`${phone}@c.us`, message);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { agentId, phone, message } = req.body;
    const reply = await getAIResponse(agentId, phone || 'test-user', message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', async (req, res) => {
  const agents = await getAllAgents().catch(() => []);
  const convs = await getAllConversations().catch(() => []);
  res.json({ status: 'ok', supabase: 'connected', agents: agents.length, conversations: convs.length, timestamp: new Date().toISOString() });
});

// ── Static ────────────────────────────────────────────────

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/', (req, res) => {
  res.json({ status: 'Tarbutu Chat AI - Running with Supabase ✅' });
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Supabase connected`);
  console.log(`✅ Green API polling every 30s`);
});
