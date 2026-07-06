const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://smaeuuvhklqmvfygbulf.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtYWV1dXZoa2xxbXZmeWdidWxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTE5NTMsImV4cCI6MjA5ODIyNzk1M30.J5Rc3NR8cfl6tzfU1spJVtGQvM8ocb8IfEXA49t8zF4'
);

const anthropic = new Anthropic({ 
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-version': '2023-06-01' }
});

const twilioClient = twilio(
  process.env.TWILIO_SID || 'AC0c7aba8165d7a96b7ab11c05b6c57fdf',
  process.env.TWILIO_TOKEN || '58ae4b7facd36d996963b461180101af'
);

const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE || '7107666399';
const GREEN_API_TOKEN    = process.env.GREEN_API_TOKEN    || 'f7434d0d76894545ad7050789742777d96781ce277af4a278f';
const GREEN_API_BASE     = `https://api.green-api.com/waInstance${GREEN_API_INSTANCE}`;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL         = 'noreply@rimon-tours.co.il';
const PIPEDRIVE_TOKEN    = process.env.PIPEDRIVE_TOKEN || 'e30e3a85a358ecf8918b588d8af2fc31de1672dd';
const PIPEDRIVE_STAGE_ID = 1; // ליד טרום שיחה
const BASE_URL           = 'https://tarbutu-chat-production.up.railway.app';

// ── Password helpers ──────────────────────────────────────

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'tarbutu-salt-2024').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Email via Resend ──────────────────────────────────────

async function sendEmail(to, subject, html) {
  try {
    await axios.post('https://api.resend.com/emails', {
      from: `תרבותו AI <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    }, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }
    });
    console.log(`[Email] Sent to ${to}`);
  } catch (err) {
    console.error('[Email] Error:', err.response?.data || err.message);
  }
}

// ── Pipedrive ─────────────────────────────────────────────

async function createPipedriveLead(name, phone, summary) {
  try {
    // 1. Create person
    const personRes = await axios.post(
      `https://api.pipedrive.com/v1/persons?api_token=${PIPEDRIVE_TOKEN}`,
      { name, phone: [{ value: phone, primary: true }] }
    );
    const personId = personRes.data.data?.id;

    // 2. Create deal
    const dealRes = await axios.post(
      `https://api.pipedrive.com/v1/deals?api_token=${PIPEDRIVE_TOKEN}`,
      {
        title: `פנייה מבוט — ${name}`,
        stage_id: PIPEDRIVE_STAGE_ID,
        person_id: personId,
        '862b7d3afb751251d1d3dee296f39949da0ca889': 298, // מקור הגעה = בוט
      }
    );
    const dealId = dealRes.data.data?.id;

    // 3. Add note to deal
    if (dealId && summary) {
      await axios.post(
        `https://api.pipedrive.com/v1/notes?api_token=${PIPEDRIVE_TOKEN}`,
        {
          content: `מקור: בוט תרבותו\n\n${summary}`,
          deal_id: dealId,
        }
      );
    }
    console.log(`[Pipedrive] Lead created for ${name} ${phone}`);
  } catch (err) {
    console.error('[Pipedrive] Error:', err.response?.data || err.message);
  }
}

// ── Supabase helpers ──────────────────────────────────────

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

async function getAgentByEmail(email) {
  const { data } = await supabase.from('agents').select('*').eq('email', email.toLowerCase()).single();
  return data;
}

async function getAgentById(id) {
  const { data } = await supabase.from('agents').select('*').eq('id', id).single();
  return data;
}

async function getAllAgents() {
  const { data, error } = await supabase.from('agents').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updateAgent(id, updates) {
  const { data, error } = await supabase.from('agents').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deleteAgentById(id) {
  const { error } = await supabase.from('agents').delete().eq('id', id);
  if (error) throw error;
}

// ── Green API ─────────────────────────────────────────────

async function sendGreenAPI(chatId, message) {
  try {
    await axios.post(`${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`, { chatId, message });
  } catch (err) {
    console.error('Green API send error:', err.message);
  }
}

// ── Knowledge Base ───────────────────────────────────────

const TRIPS = [
  {name:"קרוז לאיסלנד", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost31797/"},
  {name:"קרוזים לאוסטרליה וניו זילנד", url:"https://tarbutu.co.il/קרוזים-לאוסטרליה-וניו-זילנד/"},
  {name:"רון וסון 13.7", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost33514/"},
  {name:"רון וסון 19.10", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost30742/"},
  {name:"רון וסון 24.10", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost34615/"},
  {name:"דאורו 10.7", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost33433/"},
  {name:"דאורו 22.8", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost33532/"},
  {name:"דאורו 19.10", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost30769/"},
  {name:"הכף הצפוני 26", url:"https://tarbutu.co.il/%d7%a7%d7%a8%d7%95%d7%96-%d7%9e%d7%90%d7%95%d7%a8%d7%92%d7%9f-%d7%9c%d7%a0%d7%95%d7%a8%d7%91%d7%92%d7%99%d7%94-%d7%95%d7%94%d7%9b%d7%a3-%d7%94%d7%a6%d7%a4%d7%95%d7%a0%d7%99-3/"},
  {name:"אלסקה 26", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost30133/"},
  {name:"ניו אינגלנד", url:"https://tarbutu.co.il/%d7%98%d7%99%d7%95%d7%9c-%d7%9e%d7%90%d7%95%d7%a8%d7%92%d7%9f-%d7%9e%d7%a9%d7%95%d7%9c%d7%91-%d7%91%d7%a7%d7%a8%d7%95%d7%96-%d7%91%d7%a0%d7%99%d7%95-%d7%90%d7%99%d7%a0%d7%92%d7%9c%d7%a0%d7%93/"},
  {name:"אוסטרליה נוב 26", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost32521/"},
  {name:"אוסטרליה 7.1.27", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost35331/"},
  {name:"אוסט 02.27", url:"https://tarbutu.co.il/%d7%a7%d7%a8%d7%95%d7%96-%d7%9e%d7%90%d7%95%d7%a8%d7%92%d7%9f-%d7%a1%d7%95%d7%91%d7%91-%d7%a0%d7%99%d7%95-%d7%96%d7%99%d7%9c%d7%a0%d7%93-%d7%9b%d7%95%d7%9c%d7%9c-%d7%94%d7%90%d7%99-%d7%98%d7%a1-3/"},
  {name:"אוס 03/27", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost35491/"},
  {name:"האיים הברטיים", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost29762/"},
  {name:"האיים הברטיים 13.8.27", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost33393/"},
  {name:"האיים הקנרים", url:"https://tarbutu.co.il/%d7%a7%d7%a8%d7%95%d7%96%d7%99%d7%9d-%d7%9e%d7%90%d7%95%d7%a8%d7%92%d7%a0%d7%99%d7%9d-%d7%9c%d7%90%d7%99%d7%99%d7%9d-%d7%94%d7%a7%d7%a0%d7%a8%d7%99%d7%9d/"},
  {name:"יפן 20/10/26", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost32506/"},
  {name:"יפן וקוריאה 17/11/26", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost32029/"},
  {name:"יפן 6/11/26", url:"https://tarbutu.co.il/%d7%a7%d7%a8%d7%95%d7%96-%d7%a1%d7%95%d7%91%d7%91-%d7%99%d7%a4%d7%9f-%d7%91%d7%aa%d7%a7%d7%95%d7%a4%d7%aa-%d7%94%d7%a9%d7%9c%d7%9b%d7%aa-3-2/"},
  {name:"מזרח הרחוק 19/11", url:"https://tarbutu.co.il/%d7%9e%d7%96%d7%a8%d7%97-%d7%a8%d7%97%d7%95%d7%a7-%d7%98%d7%99%d7%95%d7%9c-%d7%9e%d7%a9%d7%95%d7%9c%d7%91-%d7%91%d7%a7%d7%a8%d7%95%d7%96/"},
  {name:"מזרח הרחוק 30/12", url:"https://tarbutu.co.il/https-tarbutu-co-il-wp-admin-post-phpactioneditpost31540/"},
];

let knowledgeCache = null;
let lastScanTime = null;

async function scrapeUrl(url) {
  try {
    const res = await axios.get(url, { 
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TarbutuBot/1.0)' }
    });
    const html = res.data;
    // Remove HTML tags and get clean text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
      .slice(0, 3000); // Max 3000 chars per page
    return text;
  } catch (err) {
    console.error(`[Scan] Error scraping ${url}: ${err.message}`);
    return null;
  }
}

async function buildKnowledgeBase() {
  console.log('[KB] Building knowledge base...');
  
  // Get trips from Supabase
  const { data: dbTrips } = await supabase.from('knowledge_base').select('*');
  const { data: dbText } = await supabase.from('knowledge_text').select('*').order('id', { ascending: false }).limit(1);
  
  let kb = '=== מאגר מידע תרבותו ===\n\n';
  kb += 'תרבותו היא חברת טיולים ישראלית המתמחה בקרוזים וטיולים מאורגנים.\n\n';
  kb += '=== טיולים זמינים ===\n';
  
  // Add trips from DB if available
  if (dbTrips && dbTrips.length > 0) {
    for (const trip of dbTrips) {
      kb += `\n--- ${trip.name} ---\n`;
      kb += `קישור: ${trip.url}\n`;
      if (trip.content) kb += `${trip.content.slice(0, 500)}\n`;
    }
  } else {
    // Use static list
    for (const trip of TRIPS) {
      kb += `\n- ${trip.name}: ${trip.url}\n`;
    }
  }
  
  // Add support text
  if (dbText && dbText.length > 0) {
    kb += '\n=== מדיניות ושירות ===\n' + dbText[0].content;
  }
  
  knowledgeCache = kb;
  lastScanTime = new Date();
  console.log('[KB] Knowledge base ready:', kb.length, 'chars');
  return kb;
}

async function scanAndSaveTrips() {
  console.log('[Scan] Starting scan of', TRIPS.length, 'trips...');
  let scanned = 0;
  for (const trip of TRIPS) {
    const content = await scrapeUrl(trip.url);
    if (content) {
      await supabase.from('knowledge_base').upsert([{
        name: trip.name,
        url: trip.url,
        content,
        type: 'trip',
        scanned_at: new Date().toISOString(),
      }], { onConflict: 'url' });
      scanned++;
      console.log('[Scan] Scanned:', trip.name);
    }
    await new Promise(r => setTimeout(r, 1000)); // 1 sec delay
  }
  console.log('[Scan] Done:', scanned, 'trips scanned');
  knowledgeCache = null; // Reset cache
}

async function getKnowledge() {
  if (!knowledgeCache) await buildKnowledgeBase();
  return knowledgeCache;
}

// ── AI — בוט בלבד ────────────────────────────────────────

async function getAIResponse(phone, userMessage, systemPrompt) {
  console.log('[AI] Request from', phone, ':', userMessage.slice(0, 50));
  const conv = await getConversation(phone);
  const history = conv?.messages || [];
  const updatedHistory = [...history, { role: 'user', content: userMessage }];
  
  // Get knowledge base (max 2000 chars to avoid token limit)
  const kb = await getKnowledge();
  const kbShort = kb.slice(0, 2000);
  const system = systemPrompt || `אתה עוזר חכם של תרבותו — חברת טיולים ישראלית המתמחה בקרוזים וטיולים מאורגנים. שמך "עוזר תרבותו".

## אישיות:
- חם, נלהב, מקצועי
- ענה בעברית, קצר וממוקד
- אל תכתוב יותר מ-4 משפטים בתשובה
- אל תמציא מידע — אם אין לך תשובה, הפנה לנציג

## מצב מכירות — המטרה: להשאיר ליד!
שלב 1 — הבן מה הלקוח רוצה: יעד? תאריך? מספר נוסעים?
שלב 2 — הצג טיול רלוונטי מהמאגר בצורה מושכת
שלב 3 — צור עניין: "מקומות מוגבלים", "עונה מבוקשת"
שלב 4 — בקש ליד: "כדי לשלוח לך הצעת מחיר מותאמת, תשאיר שם ומספר טלפון ונציג יחזור אליך תוך שעה"
לגבי מחיר — אמור: "המחיר תלוי בתאריך וסוג הקבין, נציג יכין לך הצעה אישית"

## מצב שירות — המטרה: לפתור בלי נציג!
שאלות נפוצות שאתה יודע לענות עליהן:
- ביטול: "ניתן לבטל עד X ימים לפני היציאה בהתאם לתנאי הרכישה. מה תאריך הטיול שלך?"
- דרכון/ויזה: "נדרש דרכון בתוקף ל-6 חודשים מעבר לתאריך החזרה. ויזה תלויה ביעד"
- מסמכים: "המסמכים נשלחים 2-3 שבועות לפני היציאה לאימייל שנרשם"
- ביטוח: "אנחנו ממליצים על ביטוח נסיעות מקיף. רוצה שנציג יצור קשר?"
אם השאלה מורכבת — אמור: "שאלה חשובה! נציג מומחה יחזור אליך תוך שעה — מה שמך וטלפונך?"

## טיולים זמינים:
${kbShort}`;

  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system,
    messages: updatedHistory.slice(-20),
  }, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    timeout: 30000,
  });
  const aiMessage = response.data.content[0].text;
  const finalHistory = [...updatedHistory, { role: 'assistant', content: aiMessage }];
  await upsertConversation(phone, { messages: finalHistory, last_message: userMessage, last_reply: aiMessage });
  
  // Detect if user left contact details
  const phonePattern = /0[5-9]\d{8}|05\d[-\s]?\d{7}/;
  const hasPhone = phonePattern.test(userMessage);
  if (hasPhone && updatedHistory.length > 2) {
    // Extract name from conversation
    const allText = updatedHistory.map(m => m.content).join(' ');
    const nameMatch = allText.match(/שמ[יי]\s+([א-ת]+(?:\s+[א-ת]+)?)/);
    const detectedName = nameMatch ? nameMatch[1] : 'לקוח מהבוט';
    const detectedPhone = userMessage.match(phonePattern)?.[0] || userMessage;
    const summary = `פנייה מבוט תרבותו
${allText.slice(0, 300)}`;
    createPipedriveLead(detectedName, detectedPhone, summary).catch(console.error);
  }
  
  return aiMessage;
}

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
    const senderName = body.senderData?.senderName || body.senderData?.pushname || phone;
    if (!text || !phone) return;
    console.log(`[Webhook Green] ${senderName} (${phone}): ${text}`);
    const existing = await getConversation(phone);
    const msgs = existing?.messages || [];
    msgs.push({ role: 'user', content: text, time: new Date().toISOString(), channel: 'green' });
    await upsertConversation(phone, { messages: msgs, last_message: text, status: existing?.status || 'new', channel: 'green', contact_name: senderName });
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
    const existing = await getConversation(from);
    const msgs = existing?.messages || [];
    msgs.push({ role: 'user', content: text, time: new Date().toISOString(), channel: 'twilio' });
    await upsertConversation(from, { messages: msgs, last_message: text, status: existing?.status || 'new', channel: 'twilio' });
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(500);
  }
});

// ── Auth ──────────────────────────────────────────────────

app.post('/api/agents/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await getAgentByEmail(email);
    if (!agent) return res.status(401).json({ error: 'פרטי התחברות שגויים' });
    if (agent.status !== 'approved') return res.status(401).json({ error: 'המשתמש ממתין לאישור' });
    
    // בדוק סיסמה
    const hashed = hashPassword(password);
    if (agent.password !== hashed) return res.status(401).json({ error: 'פרטי התחברות שגויים' });
    
    // צור token
    const token = generateToken();
    await updateAgent(agent.id, { token, last_login: new Date().toISOString() });
    
    res.json({ success: true, token, agent: { id: agent.id, name: agent.name, email: agent.email, role: agent.role, availability: agent.availability } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'נא למלא את כל השדות' });
    
    const existing = await getAgentByEmail(email);
    if (existing) return res.status(400).json({ error: 'אימייל כבר קיים במערכת' });
    
    const id = 'agent-' + Date.now();
    const hashed = hashPassword(password);
    
    await supabase.from('agents').insert([{
      id, name, email: email.toLowerCase(), password: hashed,
      role: 'agent', status: 'pending', availability: 'online',
      created_at: new Date().toISOString()
    }]);

    // שלח מייל למנהל
    await sendEmail('yanivd@rimon-tours.co.il', 'בקשת הצטרפות חדשה', `
      <div dir="rtl" style="font-family:Arial;padding:20px">
        <h2>בקשת הצטרפות חדשה</h2>
        <p><strong>שם:</strong> ${name}</p>
        <p><strong>אימייל:</strong> ${email}</p>
        <p>כנס למערכת הניהול לאשר או לדחות את הבקשה.</p>
        <a href="${BASE_URL}/admin" style="background:#1a6fa8;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">כנס למערכת</a>
      </div>
    `);

    res.json({ success: true, message: 'הבקשה נשלחה למנהל לאישור' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/me', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (!token) return res.status(401).json({ error: 'לא מחובר' });
    // Accept admin token always
    if (token === 'admin-token-tarbutu') {
      return res.json(ADMIN_AGENT);
    }
    const { data } = await supabase.from('agents').select('*').eq('token', token).single();
    if (!data) return res.status(401).json({ error: 'לא מחובר' });
    res.json({ id: data.id, name: data.name, email: data.email, role: data.role, availability: data.availability });
  } catch (err) {
    res.status(401).json({ error: 'לא מחובר' });
  }
});

app.post('/api/agents/logout', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    if (token) {
      const { data } = await supabase.from('agents').select('id').eq('token', token).single();
      if (data) await updateAgent(data.id, { token: null });
    }
  } catch (e) {}
  res.json({ success: true });
});

app.post('/api/agents/availability', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    const { data } = await supabase.from('agents').select('id').eq('token', token).single();
    if (data) await updateAgent(data.id, { availability: req.body.availability });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// שכחתי סיסמה
app.post('/api/agents/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const agent = await getAgentByEmail(email);
    if (!agent) return res.json({ success: true, message: 'אם האימייל קיים, נשלח מייל' });
    
    const resetToken = generateToken();
    const resetExpiry = new Date(Date.now() + 3600000).toISOString(); // שעה
    await updateAgent(agent.id, { reset_token: resetToken, reset_expiry: resetExpiry });
    
    const resetLink = `${BASE_URL}/reset-password?token=${resetToken}`;
    await sendEmail(email, 'איפוס סיסמה — תרבותו AI', `
      <div dir="rtl" style="font-family:Arial;padding:20px">
        <h2>איפוס סיסמה</h2>
        <p>שלום ${agent.name},</p>
        <p>לחץ על הקישור הבא לאיפוס הסיסמה (תקף לשעה):</p>
        <a href="${resetLink}" style="background:#1a6fa8;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">איפוס סיסמה</a>
        <p style="margin-top:16px;font-size:12px;color:#888">אם לא ביקשת איפוס סיסמה, התעלם מהמייל הזה.</p>
      </div>
    `);
    
    res.json({ success: true, message: 'נשלח מייל לאיפוס סיסמה' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// איפוס סיסמה
app.post('/api/agents/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const { data } = await supabase.from('agents').select('*').eq('reset_token', token).single();
    if (!data) return res.status(400).json({ error: 'קישור לא תקין' });
    if (new Date(data.reset_expiry) < new Date()) return res.status(400).json({ error: 'הקישור פג תוקף' });
    
    const hashed = hashPassword(password);
    await updateAgent(data.id, { password: hashed, reset_token: null, reset_expiry: null });
    
    res.json({ success: true, message: 'הסיסמה עודכנה בהצלחה' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// דף איפוס סיסמה
app.get('/reset-password', (req, res) => {
  const token = req.query.token;
  res.send(`<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><title>איפוס סיסמה</title>
<style>body{font-family:Arial;background:#e8f4fd;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;padding:2rem;border-radius:12px;width:350px;box-shadow:0 4px 20px rgba(0,0,0,.1)}
h2{color:#0e4e7a;margin-bottom:1rem}
input{width:100%;padding:10px;border:1.5px solid #dee2e6;border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box}
button{width:100%;padding:12px;background:#1a6fa8;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer}
.msg{padding:10px;border-radius:8px;text-align:center;margin-top:10px;display:none}
.ok{background:#e8f8ef;color:#1a5e35}.err{background:#fdecea;color:#a01010}</style>
</head>
<body>
<div class="card">
  <h2>איפוס סיסמה</h2>
  <input type="password" id="pass" placeholder="סיסמה חדשה">
  <input type="password" id="pass2" placeholder="אימות סיסמה">
  <button onclick="reset()">אפס סיסמה</button>
  <div class="msg" id="msg"></div>
</div>
<script>
async function reset() {
  const p = document.getElementById('pass').value;
  const p2 = document.getElementById('pass2').value;
  const msg = document.getElementById('msg');
  if (!p || p.length < 6) { showMsg('סיסמה חייבת להיות לפחות 6 תווים', 'err'); return; }
  if (p !== p2) { showMsg('הסיסמאות לא תואמות', 'err'); return; }
  const r = await fetch('/api/agents/reset-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token:'${token}', password: p}) });
  const d = await r.json();
  if (d.success) { showMsg('הסיסמה עודכנה! מועבר להתחברות...', 'ok'); setTimeout(() => window.location='/admin', 2000); }
  else showMsg(d.error, 'err');
}
function showMsg(t,c){const m=document.getElementById('msg');m.textContent=t;m.className='msg '+c;m.style.display='block';}
</script>
</body></html>`);
});

// ── Agents CRUD ───────────────────────────────────────────

app.get('/api/agents', async (req, res) => {
  try { res.json(await getAllAgents()); } catch (err) { res.json([]); }
});

app.post('/api/agents/:id/approve', async (req, res) => {
  try {
    const action = req.body.action;
    const agent = await getAgentById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'לא נמצא' });
    
    if (action === 'approve') {
      await updateAgent(req.params.id, { status: 'approved' });
      // שלח מייל אישור לנציג
      await sendEmail(agent.email, 'הבקשה אושרה — תרבותו AI', `
        <div dir="rtl" style="font-family:Arial;padding:20px">
          <h2>ברוך הבא, ${agent.name}!</h2>
          <p>הבקשה שלך אושרה. כעת תוכל להתחבר למערכת.</p>
          <a href="${BASE_URL}/admin" style="background:#1a6fa8;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">כנס למערכת</a>
        </div>
      `);
    } else {
      await updateAgent(req.params.id, { status: 'rejected' });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/agents/:id', async (req, res) => {
  try { await deleteAgentById(req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WA Conversations ──────────────────────────────────────

app.get('/api/wa-conversations', async (req, res) => {
  try {
    const convs = await getAllConversations();
    // Only WhatsApp conversations (phone numbers, not bot sessions)
    const waConvs = convs.filter(c => c.phone && !c.phone.startsWith('tc_'));
    res.json(waConvs.map(c => ({
      phone: c.phone, name: c.contact_name || c.phone, lastMessage: c.last_message || '',
      status: c.status || 'new', updatedAt: c.updated_at,
      channel: c.channel || 'green', tags: c.tags || [], messages: c.messages || [], isMyConv: false,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/wa-conversations/:phone', async (req, res) => {
  try {
    const conv = await getConversation(decodeURIComponent(req.params.phone));
    if (!conv) return res.json({ phone: req.params.phone, messages: [], status: 'new', tags: [] });
    res.json({ phone: conv.phone, name: conv.phone, messages: conv.messages || [], status: conv.status || 'new', channel: conv.channel || 'green', tags: conv.tags || [], updatedAt: conv.updated_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/send', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { message } = req.body;
    const conv = await getConversation(phone);
    
    // מצא שם נציג
    const token = req.headers['x-auth-token'];
    let agentName = 'נציג';
    if (token) {
      const { data } = await supabase.from('agents').select('name').eq('token', token).single();
      if (data) agentName = data.name;
    }
    
    if (conv?.channel === 'twilio') {
      await twilioClient.messages.create({ from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || '+97233823637'}`, to: `whatsapp:${phone}`, body: message });
    } else {
      await sendGreenAPI(`${phone}@c.us`, message);
    }
    const msgs = conv?.messages || [];
    msgs.push({ role: 'agent', content: message, time: new Date().toISOString(), channel: conv?.channel || 'green', agentName });
    await upsertConversation(phone, { messages: msgs, last_reply: message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/status', async (req, res) => {
  try { await upsertConversation(decodeURIComponent(req.params.phone), { status: req.body.status }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/note', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const conv = await getConversation(phone);
    const msgs = conv?.messages || [];
    msgs.push({ role: 'note', content: req.body.note, time: new Date().toISOString() });
    await upsertConversation(phone, { messages: msgs });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/tag', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const conv = await getConversation(phone);
    const tags = conv?.tags || [];
    if (!tags.includes(req.body.tag)) tags.push(req.body.tag);
    await upsertConversation(phone, { tags });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/assign', async (req, res) => {
  try { await upsertConversation(decodeURIComponent(req.params.phone), { assigned_agent: req.body.agentId }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/transfer', (req, res) => { res.json({ success: true }); });

app.delete('/api/wa-conversations/delete-all', async (req, res) => {
  try { await supabase.from('conversations').delete().neq('phone', ''); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wa-conversations/:phone', async (req, res) => {
  try { await supabase.from('conversations').delete().eq('phone', decodeURIComponent(req.params.phone)); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wa-conversations', async (req, res) => {
  try {
    const { data } = await supabase.from('conversations').select('phone').eq('status', 'resolved');
    if (data) for (const c of data) await supabase.from('conversations').delete().eq('phone', c.phone);
    res.json({ deleted: data?.length || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Bot / Conversations ───────────────────────────────────

app.get('/api/conversations', async (req, res) => {
  try { 
    const convs = await getAllConversations();
    // Only bot conversations (tc_ sessions)
    const botConvs = convs.filter(c => c.phone && c.phone.startsWith('tc_'));
    res.json(botConvs.map(c => ({
      ...c,
      id: c.phone,
      lastMessage: c.last_message || '',
      updatedAt: c.updated_at,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations/:phone', async (req, res) => {
  try { const conv = await getConversation(req.params.phone); res.json(conv || { phone: req.params.phone, messages: [], history: [] }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/conversations/:phone', async (req, res) => {
  try { await supabase.from('conversations').delete().eq('phone', req.params.phone); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conversations/:id/takeover', async (req, res) => {
  try { await upsertConversation(req.params.id, { agentMode: true, agentName: req.body.agentName }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conversations/:id/release', async (req, res) => {
  try { await upsertConversation(req.params.id, { agentMode: false }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conversations/:id/agent-message', async (req, res) => {
  try {
    const conv = await getConversation(req.params.id);
    const msgs = conv?.messages || [];
    msgs.push({ role: 'agent', content: req.body.message, agentName: req.body.agentName, time: new Date().toISOString() });
    await upsertConversation(req.params.id, { messages: msgs });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { phone, message, systemPrompt, sessionId, history, chatType } = req.body;
    const phoneId = phone || sessionId || 'web-' + Date.now();
    const reply = await getAIResponse(phoneId, message, systemPrompt);
    res.json({ reply, message: reply }); // support both d.reply and d.message
  } catch (err) { 
    console.error('[Chat Error]', err.message, err.stack);
    res.status(500).json({ error: err.message }); 
  }
});

// Poll endpoint for agent messages
app.get('/api/conversations/:id/poll', async (req, res) => {
  try {
    const conv = await getConversation(req.params.id);
    if (!conv || !conv.agentMode) return res.json({ type: 'bot' });
    const msgs = conv.messages || [];
    const lastAgent = msgs.filter(m => m.role === 'agent').pop();
    if (lastAgent) return res.json({ type: 'agent', message: lastAgent.content, agentName: lastAgent.agentName });
    res.json({ type: 'bot' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── KB / Reports / Status ─────────────────────────────────

app.post('/api/kb-update', async (req, res) => { 
  try {
    const { trips, supportText } = req.body;
    if (supportText) {
      await supabase.from('knowledge_text').upsert([{ id: 1, content: supportText, updated_at: new Date().toISOString() }]);
    }
    knowledgeCache = null; // Reset cache
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/scan-now', async (req, res) => { 
  res.json({ success: true, message: 'סריקה התחילה' });
  scanAndSaveTrips().catch(console.error);
});
app.get('/api/cache-status', (req, res) => { 
  res.json({ 
    hasCache: !!knowledgeCache, 
    isScanning: false, 
    contentLength: knowledgeCache ? knowledgeCache.length : 0,
    lastScanned: lastScanTime,
    pagesScanned: TRIPS.length,
    totalPages: TRIPS.length
  }); 
});
app.post('/api/import-green', (req, res) => { res.json({ success: true, message: 'לא זמין' }); });

app.get('/api/reports', async (req, res) => {
  try {
    const convs = await getAllConversations();
    const byStatus = { new: 0, open: 0, resolved: 0 };
    const byChannel = { green: 0, twilio: 0 };
    convs.forEach(c => { const s = c.status || 'new'; byStatus[s] = (byStatus[s] || 0) + 1; if (c.channel === 'twilio') byChannel.twilio++; else byChannel.green++; });
    res.json({ total: convs.length, byStatus, byChannel, agentStats: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/send', async (req, res) => {
  try {
    const { phone, message, channel } = req.body;
    if (channel === 'whatsapp-twilio') { await twilioClient.messages.create({ from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || '+97233823637'}`, to: `whatsapp:${phone}`, body: message }); }
    else { await sendGreenAPI(`${phone}@c.us`, message); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/status', async (req, res) => {
  const convs = await getAllConversations().catch(() => []);
  res.json({ status: 'ok', supabase: 'connected', conversations: convs.length, timestamp: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname)));
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/', (req, res) => { res.json({ status: 'Tarbutu Chat ✅' }); });

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Auth system with Resend emails active`);
});
