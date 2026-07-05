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

// ── Supabase helpers ──────────────────────────────────────

async function getAgent(agentId) {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();
  if (error) throw error;
  return data;
}

async function getAllAgents() {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createAgent(agent) {
  const { data, error } = await supabase
    .from('agents')
    .insert([agent])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateAgent(agentId, updates) {
  const { data, error } = await supabase
    .from('agents')
    .update(updates)
    .eq('id', agentId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteAgent(agentId) {
  const { error } = await supabase
    .from('agents')
    .delete()
    .eq('id', agentId);
  if (error) throw error;
}

async function getConversation(phone) {
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('phone', phone)
    .single();
  return data; // null if not found
}

async function upsertConversation(phone, updates) {
  const existing = await getConversation(phone);
  if (existing) {
    const { data, error } = await supabase
      .from('conversations')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('phone', phone)
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await supabase
      .from('conversations')
      .insert([{ phone, ...updates, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function getAllConversations() {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── AI Response ───────────────────────────────────────────

async function getAIResponse(agentId, phone, userMessage) {
  try {
    // Get agent
    let agent;
    try {
      agent = await getAgent(agentId);
    } catch (e) {
      // fallback agent
      agent = {
        id: agentId,
        name: 'תרבותו',
        system_prompt: 'אתה עוזר AI של תרבותו - חברת טיולים ישראלית. ענה בעברית בצורה ידידותית ומקצועית.',
      };
    }

    // Get conversation history
    const conv = await getConversation(phone);
    const history = conv?.messages || [];

    // Add user message
    const updatedHistory = [...history, { role: 'user', content: userMessage }];

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: agent.system_prompt || 'אתה עוזר AI מועיל. ענה בעברית.',
      messages: updatedHistory.slice(-20), // last 20 messages
    });

    const aiMessage = response.content[0].text;

    // Save conversation
    const finalHistory = [...updatedHistory, { role: 'assistant', content: aiMessage }];
    await upsertConversation(phone, {
      agent_id: agentId,
      messages: finalHistory,
      last_message: userMessage,
      last_reply: aiMessage,
    });

    return aiMessage;
  } catch (err) {
    console.error('AI Error:', err);
    return 'מצטער, אירעה שגיאה. נסה שוב.';
  }
}

// ── Green API helpers ─────────────────────────────────────

async function sendGreenAPI(chatId, message) {
  try {
    await axios.post(`${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`, {
      chatId,
      message,
    });
  } catch (err) {
    console.error('Green API send error:', err.message);
  }
}

// Polling from Green API
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
        const agentId = await getDefaultAgentId();
        const reply = await getAIResponse(agentId, phone, text);
        await sendGreenAPI(chatId, reply);
      }
    }

    // Delete processed notification
    await axios.delete(`${GREEN_API_BASE}/deleteNotification/${GREEN_API_TOKEN}/${receiptId}`);
  } catch (err) {
    // silent
  }
}

async function getDefaultAgentId() {
  const agents = await getAllAgents();
  return agents[0]?.id || 'default';
}

// Start polling every 30s
setInterval(pollGreenAPI, 30000);

// ── Webhooks ──────────────────────────────────────────────

// Green API webhook (groups + instant)
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
    const agentId = await getDefaultAgentId();
    const reply = await getAIResponse(agentId, phone, text);
    await sendGreenAPI(chatId, reply);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// Twilio WhatsApp webhook
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const from = req.body.From?.replace('whatsapp:', '');
    const text = req.body.Body;

    if (!from || !text) return res.sendStatus(200);

    console.log(`[Twilio] ${from}: ${text}`);
    const agentId = await getDefaultAgentId();
    const reply = await getAIResponse(agentId, from, text);

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

// ── REST API ──────────────────────────────────────────────

// Auth
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === 'yanivd@rimon-tours.co.il' && password === 'tarbutu2024') {
    res.json({ success: true, token: 'admin-token-tarbutu' });
  } else {
    res.status(401).json({ error: 'פרטי התחברות שגויים' });
  }
});

// Agents CRUD
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAllAgents();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const agent = await createAgent({
      ...req.body,
      created_at: new Date().toISOString(),
    });
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

app.delete('/api/agents/:id', async (req, res) => {
  try {
    await deleteAgent(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Conversations
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
    res.json(conv || { messages: [] });
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

// Send message manually
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
      // Green API default
      await sendGreenAPI(`${phone}@c.us`, message);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat test endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { agentId, phone, message } = req.body;
    const reply = await getAIResponse(agentId, phone || 'test-user', message);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Status
app.get('/api/status', async (req, res) => {
  const agents = await getAllAgents().catch(() => []);
  const convs = await getAllConversations().catch(() => []);
  res.json({
    status: 'ok',
    supabase: 'connected',
    agents: agents.length,
    conversations: convs.length,
    timestamp: new Date().toISOString(),
  });
});

// Admin panel
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
