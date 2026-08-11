const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const FormData = require('form-data');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
const GREEN_API_TOKEN    = process.env.GREEN_API_TOKEN    || 'e18173e79bb24641a0f3c6fb07190379c7c3d8316baf4c6cad';
const GREEN_API_BASE      = `https://7107.api.greenapi.com/waInstance${GREEN_API_INSTANCE}`;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL         = 'noreply@rimon-tours.co.il';
const PIPEDRIVE_TOKEN    = process.env.PIPEDRIVE_TOKEN || 'e30e3a85a358ecf8918b588d8af2fc31de1672dd';
const PIPEDRIVE_STAGE_ID = 1; // ליד טרום שיחה
const BASE_URL           = 'https://tarbutu-chat-production.up.railway.app';
const MONDAY_TOKEN       = process.env.MONDAY_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU5MzczOTM4NCwiYWFpIjoxMSwidWlkIjo5MzgyNjY2NiwiaWFkIjoiMjAyNS0xMi0wNFQwNzozMzo0OS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MzIwNTc1NDEsInJnbiI6ImV1YzEifQ.KCw6QItc0geq0SeIhVvHJ8sJ3JprATzmlX-ANuUSe_E';
const MONDAY_BOARD_ID    = '5054953529'; // שירות לקוחות

// ── Monday Groups ────────────────────────────────────────
const MONDAY_GROUP_NEW     = 'topics';          // חדשה
const MONDAY_GROUP_ACTIVE  = 'group_mkwcbk8q'; // בטיפול
const MONDAY_GROUP_DONE    = 'group_mkwcrv9c'; // טופלה

// ── מייל שירות לקוחות ────────────────────────────────────
const SERVICE_EMAIL        = 'service-tarbutu@rimon-tours.co.il';
const SKIP_EMAIL_SENDER    = 'telekol@telekol.co.il';

// ── נציגי שירות לקוחות — פותחים ITEM ב-Monday ──────────
const SERVICE_AGENTS = new Set([
  'agent-1783346115877', // מירב אברהמוב
  'agent-1784701113063', // ערן יום טוב
]);

// ── מיפוי נציגים: שם ב-Pipedrive → מזהה נציג ב-Supabase ──
const AGENT_MAP = {
  'AVI': 'agent-1783347049009',
  'RACHEL': 'agent-1',
  'MEIRAV': 'agent-1783346115877',
};

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

// חיפוש ב-Pipedrive לפי מספר טלפון — מחזיר גם את הנציג וגם את שם הלקוח
async function findPipedriveInfo(waPhone) {
  const result = { agentId: null, customerName: null };
  try {
    // נסה כמה וריאציות של המספר לחיפוש
    const variants = [];
    variants.push(waPhone); // 972...
    if (waPhone.startsWith('972')) {
      variants.push('0' + waPhone.slice(3)); // 05...
      variants.push('+' + waPhone);          // +972...
    }

    let person = null;
    for (const term of variants) {
      const pdRes = await axios.get(
        `https://api.pipedrive.com/v1/persons/search`,
        { params: { term, fields: 'phone', api_token: PIPEDRIVE_TOKEN } }
      );
      person = pdRes.data.data?.items?.[0]?.item;
      if (person) break;
    }
    if (!person) {
      console.log('[Missed Call] No Pipedrive person found for', waPhone);
      return result;
    }

    // שם הלקוח מ-Pipedrive
    result.customerName = person.name || null;

    // מצא את העסקה של אותו איש קשר וקח את הבעלים
    const dealsRes = await axios.get(
      `https://api.pipedrive.com/v1/persons/${person.id}/deals`,
      { params: { api_token: PIPEDRIVE_TOKEN, status: 'all_not_deleted' } }
    );
    const deal = dealsRes.data.data?.[0];
    const dealStatus = deal?.status || '';
    const ownerName = (deal?.owner_name || person.owner?.name || '').toUpperCase();
    console.log('[Pipedrive] owner:', ownerName, '| customer:', result.customerName, '| deal status:', dealStatus);

    // אם הדיל Won — שייך למירב (שירות לקוחות)
    if (dealStatus === 'won') {
      result.agentId = AGENT_MAP['MEIRAV'];
      result.isWon = true;
      return result;
    }

    for (const [key, id] of Object.entries(AGENT_MAP)) {
      if (ownerName.includes(key)) { result.agentId = id; break; }
    }
    return result;
  } catch (err) {
    console.error('[Missed Call] Pipedrive lookup error:', err.response?.data || err.message);
    return result;
  }
}

// ── Monday.com ───────────────────────────────────────────

async function createMondayItem(name, phone, description) {
  try {
    const cleanName = (name || 'לקוח מהבוט').substring(0, 50);
    const colValues = {
      'phone_mkw59e3v': { phone: phone, countryShortName: 'IL' },
      'long_text_mkw5q0e2': { text: (description || '').substring(0, 500) },
      'text_mkzmby8z': 'בוט',
      'color_mkw5dvjb': { label: 'חדשה' },
    };
    const query = `mutation { create_item(board_id: ${MONDAY_BOARD_ID}, item_name: "${cleanName}", column_values: ${JSON.stringify(JSON.stringify(colValues))}) { id } }`;
    await axios.post('https://api.monday.com/v2',
      { query },
      { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
    );
    console.log('[Monday] Item created for', name, phone);
  } catch (err) {
    console.error('[Monday] Error:', err.response?.data || err.message);
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
  if (!email) return null;
  // ניקוי רווחים ואותיות גדולות — משתמשים מדביקים מיילים עם רווח נסתר
  const clean = String(email).trim().toLowerCase();
  const { data } = await supabase.from('agents').select('*').eq('email', clean).maybeSingle();
  if (data) return data;

  // גיבוי: אם נשמר בעבר עם אותיות גדולות או רווח, חיפוש לא רגיש
  const { data: alt } = await supabase.from('agents').select('*').ilike('email', clean).maybeSingle();
  return alt || null;
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

// ── הרשאות לפי תפקיד ──────────────────────────────────────
// admin      = מנהל מערכת — הכל, כולל שינוי הרשאות ומחיקת נציגים
// supervisor = סופרוויזר  — רואה את כל הנציגים והנתונים, בלי שינוי הרשאות
// agent      = נציג       — רק השיחות שלו

const ROLES = ['admin', 'supervisor', 'agent'];
const ROLE_LABELS = { admin: 'מנהל מערכת', supervisor: 'סופרוויזר', agent: 'נציג' };

async function getAgentByToken(token) {
  if (!token) return null;
  if (token === 'admin-token-tarbutu') {
    return { id: 'admin-1', name: 'מחלקת אופרציה', role: 'admin', status: 'approved' };
  }
  try {
    const { data } = await supabase.from('agents').select('*').eq('token', token).single();
    return data || null;
  } catch (e) { return null; }
}

// מחזיר את הנציג אם התפקיד שלו מורשה, אחרת שולח 403 ומחזיר null
async function requireRole(req, res, allowed) {
  const agent = await getAgentByToken(req.headers['x-auth-token']);
  if (!agent) {
    res.status(401).json({ error: 'נדרשת התחברות' });
    return null;
  }
  if (!allowed.includes(agent.role)) {
    res.status(403).json({ error: 'אין לך הרשאה לפעולה זו' });
    return null;
  }
  return agent;
}

// ── התראות על הודעה נכנסת ─────────────────────────────────
// 1. מייל לנציג שהשיחה משויכת אליו
// 2. ITEM חדש ב-Monday לכל הודעה שמגיעה לנציג שירות (מירב / ערן)

async function emailAgentNewMessage(agent, phone, text, contactName) {
  if (!agent?.email) return;
  const who = contactName || phone;
  const preview = (text || '📎 קובץ').slice(0, 300);

  await sendEmail(agent.email, `הודעה חדשה מ-${who}`, `
    <div dir="rtl" style="font-family:Arial,sans-serif;padding:20px;max-width:520px">
      <h2 style="margin:0 0 4px;font-size:18px;font-weight:500">הודעה חדשה ממתינה לך</h2>
      <p style="margin:0 0 16px;color:#6c757d;font-size:13px">${who} · ${phone}</p>
      <div style="background:#f8f9fa;border-right:3px solid #1a6fa8;padding:12px 14px;border-radius:4px;font-size:14px;line-height:1.7">
        ${preview.replace(/</g,'&lt;').replace(/\n/g,'<br>')}
      </div>
      <a href="${BASE_URL}/admin" style="display:inline-block;margin-top:18px;background:#1a6fa8;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-size:14px">פתח את השיחה</a>
    </div>
  `);
  console.log('[Notify] Email sent to', agent.email, 'for', phone);
}

// מוצא את מזהה המשתמש במונדיי לפי כתובת המייל שלו.
// כך אין צורך לקודד מספרי משתמשים בקוד — מספיק שהמייל בטבלת הנציגים
// תואם למייל שאיתו הנציג רשום במונדיי.
const _mondayUserCache = {};
let _mondayAllUsers = null;

async function getMondayUserIdByEmail(email) {
  if (!email) return null;
  const key = email.toLowerCase().trim();
  if (_mondayUserCache[key] !== undefined) return _mondayUserCache[key];

  try {
    // שליפת כל המשתמשים והשוואה בקוד — כך אותיות גדולות/קטנות
    // בכתובת לא משנות. users(emails:) של מונדיי היא התאמה מדויקת.
    if (!_mondayAllUsers) {
      const r = await axios.post('https://api.monday.com/v2',
        { query: 'query { users(limit: 300) { id name email } }' },
        { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
      );
      _mondayAllUsers = r.data?.data?.users || [];
      console.log('[Monday] נטענו', _mondayAllUsers.length, 'משתמשים');
    }

    const user = _mondayAllUsers.find(u => (u.email || '').toLowerCase().trim() === key);
    const id = user?.id ? Number(user.id) : null;
    _mondayUserCache[key] = id;

    if (id) console.log('[Monday] נציג מטפל:', user.name, '=', id);
    else console.warn('[Monday] לא נמצא משתמש עם המייל', key,
                      '| קיימים:', _mondayAllUsers.map(u => u.email).filter(Boolean).join(', ').slice(0, 200));
    return id;
  } catch (e) {
    console.error('[Monday] שגיאה בחיפוש משתמש:', e.message);
    _mondayUserCache[key] = null;
    return null;
  }
}


async function createServiceMondayItem(phone, text, contactName, agentName, agentEmail) {
  const cleanName = (contactName || phone || 'לקוח').substring(0, 50);
  const colValues = {
    'phone_mkw59e3v': { phone: String(phone).replace('+',''), countryShortName: 'IL' },
    'long_text_mkw5q0e2': { text: (text || '📎 קובץ').slice(0, 500) },
    'text_mkzmby8z': 'וואטסאפ',
    'color_mkw5dvjb': { label: 'חדשה' },
  };

  // "נציג מטפל" — לפי המייל של הנציג
  const mondayUserId = await getMondayUserIdByEmail(agentEmail);
  if (mondayUserId) {
    colValues['multiple_person_mkw5rbj0'] = {
      personsAndTeams: [{ id: mondayUserId, kind: 'person' }]
    };
  }

  const query = `mutation {
    create_item(
      board_id: ${MONDAY_BOARD_ID},
      group_id: "${MONDAY_GROUP_NEW}",
      item_name: ${JSON.stringify(cleanName)},
      column_values: ${JSON.stringify(JSON.stringify(colValues))}
    ) { id }
  }`;

  const r = await axios.post('https://api.monday.com/v2',
    { query },
    { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
  );
  const itemId = r.data?.data?.create_item?.id;
  console.log('[Monday] Item', itemId, 'created for', agentName, '|', phone);
  return itemId;
}

// נקראת אחרי שההודעה כבר נשמרה. לא זורקת — התראה שנכשלת לא תפיל הודעה.
async function notifyIncomingMessage(phone, text, conv) {
  try {
    const agentId = conv?.assigned_agent;
    if (!agentId) {
      console.log('[Notify] No assigned agent for', phone, '— skipping');
      return;
    }

    const agent = await getAgentById(agentId);
    const contactName = conv?.contact_name;

    // מייל — בכל הודעה נכנסת
    await emailAgentNewMessage(agent, phone, text, contactName)
      .catch(e => console.error('[Notify] Email failed:', e.message));

    // ITEM ב-Monday — רק אם עדיין אין אחד לשיחה הזו
    if (!SERVICE_AGENTS.has(agentId)) return;

    if (conv?.monday_item_id) {
      console.log('[Notify] Item', conv.monday_item_id, 'already exists for', phone, '— skipping');
      return;
    }

    const itemId = await createServiceMondayItem(phone, text, contactName, agent?.name, agent?.email)
      .catch(e => { console.error('[Notify] Monday item failed:', e.message); return null; });

    // שמירת המזהה — זה מה שמאפשר את סנכרון הסטטוס בשני הכיוונים
    if (itemId) {
      await upsertConversation(phone, { monday_item_id: String(itemId) });
    }
  } catch (e) {
    console.error('[Notify] Error:', e.message);
  }
}

// ── Green API ─────────────────────────────────────────────

async function sendGreenAPI(phone, message) {
  try {
    const url = `${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`;
    
    // Green API דורש chatId בפורמט: "phone@c.us" (בלי +)
    const cleanPhone = phone.replace('+', '').replace('@c.us', '').replace('@g.us', '');
    const chatId = `${cleanPhone}@c.us`;
    
    console.log(`[Green API] Sending to: ${chatId}`);
    console.log(`[Green API] Message: ${message}`);
    
    const response = await axios.post(url, { 
      chatId, 
      message 
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[Green API] Success:`, response.data);
    return response.data;
  } catch (err) {
    console.error(`[Green API Error]`, err.response?.status, err.response?.data?.message || err.message);
    throw err;
  }
}

// ── Green API — שליחת קובץ ─────────────────────────────

async function sendGreenAPIFile(phone, fileUrl, fileName, caption) {
  try {
    const cleanPhone = phone.replace('+', '').replace('@c.us', '').replace('@g.us', '');
    const chatId = `${cleanPhone}@c.us`;
    
    console.log(`[Green API] Sending file to: ${chatId}`);
    
    const response = await axios.post(`${GREEN_API_BASE}/sendFileByUrl/${GREEN_API_TOKEN}`, {
      chatId,
      urlFile: fileUrl,
      fileName: fileName || 'file',
      caption: caption || ''
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`[Green API] File sent:`, response.data);
    return response.data;
  } catch (err) {
    console.error('[Green API] File send error:', err.response?.status, err.response?.data?.message || err.message);
    throw err;
  }
}

// ── Phone Normalization ──────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return null;
  let normalized = phone.replace(/[^0-9+]/g, ''); // הסר תווים לא חוקיים
  if (normalized.startsWith('+972')) return normalized;
  if (normalized.startsWith('00972')) return '+' + normalized.slice(2);
  if (normalized.startsWith('0')) return '+972' + normalized.slice(1);
  if (normalized.startsWith('972')) return '+' + normalized;
  return normalized;
}

// ── Opening Hours ──────────────────────────────────────────

// ── Widget Welcome Messages ────────────────────────────

// ── Upload File ─────────────────────────────────────────

// ── Widget Start Chat ─────────────────────────────────────

app.post('/api/widget/start-chat', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'חסר מספר טלפון' });
    
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return res.status(400).json({ error: 'מספר לא תקין' });
    
    console.log(`[Widget] Start chat from ${phone}`);
    
    // הודעה ראשונה
    await sendGreenAPI(normalizedPhone, 'שלום 👋 מה אוכל לעזור?');
    
    // שמור שיחה
    await upsertConversation(normalizedPhone, {
      messages: [{ role: 'agent', content: 'שלום 👋 מה אוכל לעזור?', time: new Date().toISOString(), channel: 'green', agentName: 'בוט' }],
      status: 'new',
      channel: 'green'
    });
    
    res.json({ success: true, phone: normalizedPhone });
  } catch (err) {
    console.error('[Widget Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Download File ─────────────────────────────────────────

app.get('/api/download', async (req, res) => {
  try {
    const fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).json({ error: 'missing url' });

    console.log('[Download] File:', fileUrl);
    
    const fileName = fileUrl.split('/').pop() || 'file';
    
    // הורד מDigital Ocean
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    
    // שלח ללקוח עם headers נכונים
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', response.data.length);
    
    res.send(response.data);
  } catch (err) {
    console.error('[Download Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Twilio ─────────────────────────────────────────────────

async function sendTwilioMsg(phone, message) {
  try {
    const from = process.env.TWILIO_WHATSAPP_FROM;
    const accountSid = process.env.TWILIO_SID;
    const authToken = process.env.TWILIO_TOKEN;
    
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    
    const formData = new URLSearchParams();
    formData.append('From', `whatsapp:${from}`);
    formData.append('To', `whatsapp:${phone}`);
    formData.append('Body', message);
    
    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      formData,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    console.log('[Twilio] Message sent:', response.data.sid);
  } catch (err) {
    console.error('[Twilio] Send error:', err.response?.data || err.message);
  }
}

// שליחת קובץ מנציג — מקישור
app.post('/api/wa-conversations/:phone/send-file', async (req, res) => {
  try {
    const phone = normalizePhone(decodeURIComponent(req.params.phone));
    const { fileUrl, fileName, caption } = req.body;
    if (!fileUrl) return res.status(400).json({ error: 'חסר קישור לקובץ' });

    console.log('[Send File] Phone:', phone, 'File:', fileName);
    
    await sendGreenAPIFile(phone, fileUrl, fileName, caption);

    // שמור בהיסטוריה
    const conv = await getConversation(phone);
    const msgs = conv?.messages || [];
    const token = req.headers['x-auth-token'];
    let agentName = 'נציג';
    if (token === 'admin-token-tarbutu') agentName = 'מחלקת אופרציה';
    else if (token) {
      try { const { data } = await supabase.from('agents').select('name').eq('token', token).single(); if (data) agentName = data.name; } catch(e) {}
    }

    msgs.push({ role: 'agent', content: caption || '📎 קובץ', fileUrl, fileName, time: new Date().toISOString(), channel: 'green', agentName });
    await upsertConversation(phone, { messages: msgs, last_reply: '📎 קובץ' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Send File Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// שליחת קובץ מנציג — העלאה מהמחשב
app.post('/api/wa-conversations/:phone/upload-file', upload.single('file'), async (req, res) => {
  try {
    const phone = normalizePhone(decodeURIComponent(req.params.phone));
    const file = req.file;
    const caption = req.body.caption || '';
    if (!file) return res.status(400).json({ error: 'לא נבחר קובץ' });

    console.log('[Upload File] Phone:', phone, 'File:', file.originalname);

    // שלח ל-Green API דרך sendFileByUpload
    const formData = new FormData();
    const cleanPhone = phone.replace('+', '').replace('@c.us', '');
    formData.append('chatId', `${cleanPhone}@c.us`);
    formData.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });
    formData.append('fileName', file.originalname);
    formData.append('caption', caption);

    await axios.post(`${GREEN_API_BASE}/sendFileByUpload/${GREEN_API_TOKEN}`, formData, {
      headers: formData.getHeaders(),
      maxContentLength: 20 * 1024 * 1024,
      maxBodyLength: 20 * 1024 * 1024,
    });

    // שמור בהיסטוריה
    const conv = await getConversation(phone);
    const msgs = conv?.messages || [];
    const token = req.headers['x-auth-token'];
    let agentName = 'נציג';
    if (token === 'admin-token-tarbutu') agentName = 'מחלקת אופרציה';
    else if (token) {
      try { const { data } = await supabase.from('agents').select('name').eq('token', token).single(); if (data) agentName = data.name; } catch(e) {}
    }

    msgs.push({ role: 'agent', content: caption || '📎 ' + file.originalname, fileName: file.originalname, time: new Date().toISOString(), channel: 'green', agentName });
    await upsertConversation(phone, { messages: msgs, last_reply: '📎 ' + file.originalname });
    res.json({ success: true });
  } catch (err) {
    console.error('[Upload] Error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Knowledge Base ───────────────────────────────────────

const TRIPS = [];

let knowledgeCache = null;
let lastScanTime = null;
let scanState = { isScanning: false, current: 0, total: 0, currentName: '', ok: 0, failed: [], finishedAt: null };

// מחלץ מדף הטיול את המידע שהבוט הכי צריך, ומרכז אותו בראש התוכן
// כדי שלא ייחתך: מה כולל · תאריכים · אנייה · חברה · למה תרבותו
function extractTripHighlights(text) {
  const out = [];

  // בלוק הפרטים בראש הדף: קוד, משך, יציאה, חזרה, מדינות, אונייה, סגנון
  const facts = [];
  const grab = (label, re) => { const m = text.match(re); if (m) facts.push(label + ': ' + m[1].trim()); };
  grab('קוד הטיול',  /קוד\s+הטיול\s*:?\s*([A-Z0-9\-]{2,15})/);
  grab('משך',        /משך\s+הטיול[^:]{0,10}:?\s*([^\n]{2,40})/);
  grab('יציאה',      /יציאה\s*:?\s*([^\n]{3,40})/);
  grab('חזרה',       /חזרה\s*:?\s*([^\n]{3,40})/);
  grab('מדינות',     /מדינות\s*:?\s*([^\n]{3,120})/);
  grab('אונייה',     /אוני[יה]ה\s*:?\s*([^\n]{2,60})/);
  grab('סגנון',      /סגנון\s*:?\s*([^\n]{3,60})/);
  if (facts.length) out.push('=== פרטי הטיול ===\n' + facts.join('\n'));

  // המחיר כולל
  const inc = text.match(/(?:המחיר|הטיול)\s+כולל\s*:?([\s\S]{0,1200}?)(?=\n\s*(?:ה?(?:מחיר|טיול)\s+(?:אינו|לא)\s+כולל|הערות|על האוני|מדוע עם|למה עם)|$)/);
  if (inc) {
    // שורות טיסה מוסרות — הבוט לא מוסר פרטי טיסות
    const t = inc[1]
      .split('\n')
      .filter(l => !/טיס(ות|ה)|מסלול\s+ישראל|נמל\s+התעופה/.test(l))
      .join('\n')
      .replace(/[ \t]+/g,' ').trim();
    if (t.length > 30) out.push('=== המחיר כולל ===\n' + t.slice(0,1200));
  }

  // אינו כולל — כולל הנוסח "הטיול אינו כולל"
  const notInc = text.match(/(?:המחיר|הטיול)\s+(?:אינו|לא)\s+כולל\s*:?([\s\S]{0,600}?)(?=\n\s*(?:הערות|תנאים|על האוני|מדוע עם|למה עם)|$)/);
  if (notInc) {
    const t = notInc[1].replace(/[ \t]+/g,' ').trim();
    if (t.length > 15) out.push('=== אינו כולל ===\n' + t.slice(0,600));
  }

  // למה עם תרבותו — סעיף שלם בדף
  const why = text.match(/(?:מדוע|למה)\s+עם\s+תרבותו([\s\S]{0,1200}?)(?=\n\s*(?:אתרים ואטרקציות|על האוני|המחיר כולל)|$)/);
  if (why) {
    const t = why[1].replace(/[ \t]+/g,' ').trim();
    if (t.length > 40) out.push('=== למה עם תרבותו ===\n' + t.slice(0,1200));
  }

  // תאריכי יציאה
  const dates = [...new Set((text.match(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g) || []))];
  if (dates.length) out.push('=== תאריכים בדף ===\n' + dates.slice(0,25).join(' · '));

  // חברת ההפלגות
  const lines = ['MSC','Costa','Royal Caribbean','Norwegian','Celebrity','Princess','Holland America',
                 'Cunard','AIDA','TUI','CroisiEurope','Viking','Ponant','Silversea','Oceania','Explora'];
  const found = lines.filter(l => new RegExp(l.replace(/ /g,'\\s+'),'i').test(text));
  if (found.length) out.push('=== חברת הפלגות ===\n' + found.join(', '));

  return out.length ? out.join('\n\n') : null;
}

// ── סיווג טיולים לפי סוג ויעד ─────────────────────────────
// היעדים מוגדרים במקום אחד — הבוט, האדמין והסיווג האוטומטי משתמשים באותה רשימה.

const DESTINATIONS = {
  cruise: [
    { id: 'japan',      label: 'יפן והמזרח הרחוק',        keys: ['יפן','מזרח הרחוק','קוריאה','סין','הונג קונג','טייוואן','סינגפור','וייטנאם'] },
    { id: 'australia',  label: 'אוסטרליה וניו זילנד',      keys: ['אוסטרלי','ניו זילנד'] },
    { id: 'mediterr',   label: 'הים התיכון',                keys: ['ים התיכון','הים התיכון','אדריאטי','דוברובניק','מונטנגרו','קורפו','ונציה','יוון','איטליה','ספרד','מלטה'] },
    { id: 'canary',     label: 'האיים הקנריים',             keys: ['קנרי','קנרים','טנריף','לנסרוטה','גראן קנריה','מדיירה','פונשל'] },
    { id: 'north',      label: 'פיורדים, איסלנד והצפון',   keys: ['פיורד','איסלנד','שפיצברגן','הכף הצפוני','ארקטי','נורווג'] },
    { id: 'baltic',     label: 'הים הבלטי',                keys: ['בלטי','בלטיות'] },
    { id: 'southam',    label: 'דרום אמריקה',              keys: ['דרום אמריקה','פטגוני','ארגנטינ','ברזיל','צ׳ילה',"צ'ילה",'טראנס אטלנטי','אורוגוואי'] },
    { id: 'british',    label: 'האיים הבריטיים',           keys: ['בריטי','אירלנד','סקוטלנד'] },
    { id: 'newengland', label: 'ניו אינגלנד ומזרח קנדה',   keys: ['ניו אינגלנד','ניו אנגלנד','מזרח קנדה','אלסקה','קנדה'] },
    { id: 'indian',     label: 'האוקיינוס ההודי',          keys: ['סיישל','מדגסקר','מאוריציוס','מלדיב','הודו'] },
  ],
  river: [
    { id: 'rhine',    label: 'הריין',        keys: ['ריין'] },
    { id: 'danube',   label: 'הדנובה',       keys: ['דנובה'] },
    { id: 'rhone',    label: 'הרון והסון',   keys: ['רון','סון','פרובאנס','בורגונדי','ליון'] },
    { id: 'dordogne', label: 'הדורדון',      keys: ['דורדון','פריגור'] },
    { id: 'seine',    label: 'הסיין',        keys: ['סיין','נורמנדי'] },
    { id: 'douro',    label: 'הדאורו',       keys: ['דאורו','דואורו','פורטוגל'] },
    { id: 'other',    label: 'נהרות נוספים', keys: ['מקונג','לואר','ויטנאם'] },
  ]
};

// מזהה סוג ויעד לפי שם הטיול ותוכנו. הסוג נקבע ראשון — הוא מצמצם את החיפוש.
function classifyTrip(name, content) {
  const hay = ((name || '') + ' ' + (content || '')).toLowerCase();
  const has = (w) => hay.includes(w.toLowerCase());

  // שייט נהרות מזוהה במפורש; כל השאר נחשב קרוז
  const isRiver = has('שייט נהר') || has('שייט על נהר') || has('ספינת נהר') ||
                  (has('שייט') && DESTINATIONS.river.some(d => d.keys.some(has)) && !has('קרוז'));
  const category = isRiver ? 'river' : 'cruise';

  // היעד — לפי מספר ההתאמות, השם מקבל משקל כפול
  const nameLower = (name || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const dest of DESTINATIONS[category]) {
    let score = 0;
    for (const k of dest.keys) {
      if (nameLower.includes(k.toLowerCase())) score += 2;
      else if (has(k)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = dest.id; }
  }
  return { category, destination: best, destinationLabel: best ? DESTINATIONS[category].find(d=>d.id===best).label : null };
}

function destLabel(category, id) {
  const d = (DESTINATIONS[category] || []).find(x => x.id === id);
  return d ? d.label : id;
}

async function scrapeUrl(url) {
  try {
    const res = await axios.get(url, { 
      timeout: 15000,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    const html = typeof res.data === 'string' ? res.data : String(res.data || '');
    if (!html || html.length < 100) {
      console.error(`[Scan] תגובה ריקה מ-${url} (סטטוס ${res.status}, אורך ${html.length})`);
      return null;
    }
    // דף התחברות או שגיאה מוסווית כ-200
    if (/wp-login|<title>[^<]*(?:404|לא נמצא|Not Found)/i.test(html.slice(0, 3000))) {
      console.error(`[Scan] הדף דורש התחברות או אינו קיים: ${url}`);
      return null;
    }
    // הסרת רעש: תפריטים, פוטר, סרגלים, טפסים — כל מה שחוזר בכל דף
    let clean = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

    const text = clean
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')   // שמירת מבנה שורות
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#8211;|&#8212;/g, '-')
      .replace(/&quot;|&#8221;|&#8220;/g, '"')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // חילוץ המידע החשוב לראש התוכן, כדי שלא ייחתך
    const highlights = extractTripHighlights(text);
    const body = text.slice(0, 5000);
    const result = highlights ? highlights + '\n\n--- פרטים נוספים ---\n' + body : body;

    console.log(`[Scan] Got ${result.length} chars from ${url}${highlights ? ' (עם חילוץ)' : ''}`);
    return result || null;

  } catch (err) {
    console.error(`[Scan] Error scraping ${url}: ${err.message}`);
    return null;
  }
}

async function buildKnowledgeBase() {
  console.log('[KB] Building knowledge base...');
  
  // Get trips from Supabase
  const { data: dbTrips } = await supabase.from('knowledge_base').select('*');
  const { data: dbText } = await supabase.from('knowledge_text').select('*').order('id', { ascending: true });
  
  let kb = '=== מאגר מידע תרבותו ===\n\n';
  kb += 'תרבותו היא חברת טיולים ישראלית המתמחה בקרוזים וטיולים מאורגנים.\n\n';
  kb += '=== טיולים זמינים ===\n';
  
  // Add trips from DB if available
  if (dbTrips && dbTrips.length > 0) {
    for (const trip of dbTrips) {
      kb += `\n--- ${trip.name} ---\n`;
      kb += `קישור: ${trip.url}\n`;
      if (trip.content) kb += `${trip.content.slice(0, 3000)}\n`;
    }
  } else {
    // Use static list
    for (const trip of TRIPS) {
      kb += `\n- ${trip.name}: ${trip.url}\n`;
    }
  }
  
  // Add support text
  if (dbText && dbText.length > 0) {
    kb += '\n=== מדיניות ושירות ===\n';
    dbText.forEach(d => { if ((d.content || '').trim()) kb += (d.content || '').trim() + '\n\n'; });
  }
  
  knowledgeCache = kb;
  lastScanTime = new Date();
  console.log('[KB] Knowledge base ready:', kb.length, 'chars');
  return kb;
}

async function scanAndSaveTrips() {
  const { data: dbTrips } = await supabase.from('trips_list').select('*');
  const allTrips = dbTrips && dbTrips.length > 0
    ? dbTrips.map(t => ({ name: t.name, url: t.url }))
    : TRIPS;

  scanState = { isScanning: true, current: 0, total: allTrips.length, currentName: '', ok: 0, failed: [], finishedAt: null };
  console.log('[Scan] Starting scan of', allTrips.length, 'trips...');

  let scanned = 0;
  for (let i = 0; i < allTrips.length; i++) {
    const trip = allTrips[i];
    scanState.current = i + 1;
    scanState.currentName = trip.name;
    console.log(`[Scan] ${i+1}/${allTrips.length}: ${trip.name}`);

    const content = await scrapeUrl(trip.url);

    // שיוך שנבחר ידנית באדמין גובר על הזיהוי האוטומטי
    const { data: prev } = await supabase.from('knowledge_base')
      .select('category, destination, manual_dest, content').eq('url', trip.url).maybeSingle();
    const keepManual = prev?.manual_dest && prev?.destination;
    const cls = classifyTrip(trip.name, content || '');

    if (content) {
      await supabase.from('knowledge_base').upsert([{
        name: trip.name,
        url: trip.url,
        content,
        type: 'trip',
        category:    keepManual ? prev.category    : cls.category,
        destination: keepManual ? prev.destination : cls.destination,
        manual_dest: prev?.manual_dest || false,
        scan_error: null,
        scanned_at: new Date().toISOString(),
      }], { onConflict: 'url' });
      console.log(`[Scan]   → ${keepManual ? prev.destination + ' (ידני)' : cls.destination || 'ללא יעד'}`);
      scanned++;
      scanState.ok++;
    } else {
      // הסריקה נכשלה — שומרים את השיוך ומסמנים את הסיבה, כדי שלא ייעלם בשקט
      console.warn(`[Scan]   ✗ לא הוחזר תוכן מ-${trip.url}`);
      await supabase.from('knowledge_base').upsert([{
        name: trip.name,
        url: trip.url,
        content: prev?.content || '',
        type: 'trip',
        category:    keepManual ? prev.category    : (prev?.category || cls.category),
        destination: keepManual ? prev.destination : (prev?.destination || cls.destination),
        manual_dest: prev?.manual_dest || false,
        scan_error: 'לא הוחזר תוכן מהדף',
      }], { onConflict: 'url' });
      scanState.failed.push(trip.name);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  scanState = {
    isScanning: false,
    current: allTrips.length,
    total: allTrips.length,
    currentName: '',
    ok: scanState.ok,
    failed: scanState.failed,
    finishedAt: new Date().toISOString(),
  };
  lastScanTime = new Date();
  knowledgeCache = null;
  console.log('[Scan] Done:', scanned, '/', allTrips.length, 'trips scanned');
}

// מאגר ממוקד: רק הטיולים של היעד שנבחר, בתוכן מלא.
// זה מה שמחליף את החיתוך ל-2000 תווים שגרם לבוט לא להכיר את רוב הטיולים.
async function getFocusedKnowledge({ category, destination } = {}) {
  const { data: trips } = await supabase.from('knowledge_base').select('*').eq('type', 'trip');
  const { data: txt }   = await supabase.from('knowledge_text').select('*').order('id', { ascending: true });

  let kb = '=== מאגר מידע תרבותו ===\n';
  kb += 'תרבותו — חברת טיולים ישראלית המתמחה בקרוזים, שייט נהרות וטיולים מאורגנים.\n\n';

  const all = trips || [];
  let list = all;
  if (category)    list = list.filter(t => (t.category || 'cruise') === category);
  if (destination) list = list.filter(t => t.destination === destination);

  if (destination && list.length) {
    kb += `=== טיולים ל${destLabel(category, destination)} (${list.length}) ===\n`;
    for (const t of list) {
      kb += `\n--- ${t.name} ---\nקישור: ${t.url}\n${(t.content || '').slice(0, 4000)}\n`;
    }
  } else if (category && list.length) {
    // עדיין לא נבחר יעד — רק שמות, כדי שהבוט יוכל להציג אפשרויות
    const byDest = {};
    list.forEach(t => { const d = t.destination || 'other'; (byDest[d] = byDest[d] || []).push(t.name); });
    kb += '=== היעדים הזמינים ===\n';
    for (const d in byDest) kb += `\n${destLabel(category, d)}: ${byDest[d].join(' · ')}\n`;
  } else {
    // אין הקשר — רשימת שמות בלבד
    kb += '=== הטיולים שלנו ===\n';
    all.slice(0, 60).forEach(t => { kb += `- ${t.name}\n`; });
  }

  if (txt && txt.length) {
    kb += '\n=== מדיניות ושירות ===\n';
    txt.forEach(d => { if ((d.content || '').trim()) kb += (d.content || '').trim() + '\n\n'; });
  }
  return kb;
}

// מאגר השירות בלבד — למסלול "כבר הזמנתי"
async function getServiceKnowledge() {
  // כל המסמכים, לא רק האחרון — זה מה שמאפשר לבוט לענות בעצמו
  const { data: docs } = await supabase.from('knowledge_text')
    .select('*').order('id', { ascending: true });

  let kb = '=== מידע שירות לקוחות — תרבותו ===\n';
  if (!docs || !docs.length) return kb + '(אין עדיין תוכן במאגר השירות)';

  docs.forEach((d, i) => {
    const body = (d.content || '').trim();
    if (!body) return;
    const title = (d.title || body.split('\n')[0] || '').trim().slice(0, 80);
    kb += `\n--- ${title || 'מסמך ' + (i + 1)} ---\n${body}\n`;
  });
  return kb;
}

async function getKnowledge() {
  if (!knowledgeCache) await buildKnowledgeBase();
  return knowledgeCache;
}

// ── AI — בוט בלבד ────────────────────────────────────────

// קורא את השיחה עד כה ומזהה: מסלול (מכירות/שירות), סוג ויעד.
// זה מה שקובע איזה חלק מהמאגר יישלח לבוט.
function detectContext(messages) {
  const text = (messages || [])
    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'bot')
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .join(' ')
    .toLowerCase();

  const has = (w) => text.includes(w.toLowerCase());

  // מסלול שירות — מי שכבר הזמין
  const service = has('כבר הזמנתי') || has('כבר נרשמתי') || has('הזמנה קיימת') ||
                  has('שאלה על טיול שהזמנתי') || has('כבר סגרתי') ||
                  has('הטיול שלי') || has('הדרכון') || has('ביטול') || has('ההזמנה שלי');
  if (service) return { track: 'service' };

  // סוג
  let category = null;
  if (has('שייט נהר') || has('נהרות')) category = 'river';
  else if (has('קרוז') || has('הפלגה') || has('בים')) category = 'cruise';

  // יעד — נבדק בשני הסוגים אם עוד לא נקבע סוג
  let destination = null;
  const search = category ? [category] : ['cruise', 'river'];
  for (const cat of search) {
    for (const d of DESTINATIONS[cat]) {
      if (d.keys.some(k => has(k)) || has(d.label)) {
        destination = d.id;
        category = cat;
        break;
      }
    }
    if (destination) break;
  }

  return { track: 'sales', category, destination };
}

async function getAIResponse(phone, userMessage, systemPrompt) {
  console.log('[AI] Request from', phone, ':', userMessage.slice(0, 50));
  const conv = await getConversation(phone);
  const history = conv?.messages || [];
  const updatedHistory = [...history, { role: 'user', content: userMessage }];
  
  // מאגר ממוקד לפי ההקשר שהתגלה בשיחה — במקום חיתוך גס של כל המאגר
  const ctx = detectContext(updatedHistory);
  const kb = ctx.track === 'service'
    ? await getServiceKnowledge()
    : await getFocusedKnowledge({ category: ctx.category, destination: ctx.destination });

  const destList = (cat) => DESTINATIONS[cat].map(d => '• ' + d.label).join('\n');

  const system = systemPrompt || `אתה העוזר הדיגיטלי של תרבותו — חברת טיולים ישראלית המתמחה בקרוזים, שייט נהרות וטיולים מאורגנים בליווי ישראלי.

## איך לדבר
רוב הפונים אלינו הם בני 60 ומעלה. דבר איתם בחום, בסבלנות ובכבוד.
- משפטים קצרים ובהירים. בלי מונחים מקצועיים ובלי סלנג.
- אם שואלים אותך שוב או מנסחים אחרת — ענה מחדש באותה נעימות. לעולם אל תרמוז שכבר ענית.
- שאלה אחת בכל פעם. אל תמהר ואל תלחץ.
- אמוג'י אחד לכל היותר בהודעה.
- לעולם אל תמציא מידע שאינו במאגר.

## שני דברים שחשוב להדגיש בכל תשובה מהותית
**למה תרבותו:** ליווי ישראלי לאורך כל הדרך · מדריך מומחה דובר עברית · קבוצה מאורגנת · מסלול מלא ללא ימים חופשיים וללא סיורי בחירה בתשלום · הכל מטופל מראש.
**מה המסלול כולל:** ספר בפירוט מה נכלל — הלינה, הסיורים, הארוחות, המדריך, ההעברות. זה מה שממחיש את הערך.

## איסור מוחלט — מחירים
לעולם אל תנקוב במחיר, גם אם הוא מופיע במאגר וגם אם מתעקשים.
במקום זה: "המחיר משתנה לפי התאריך וסוג התא. נציג שלנו יכין לך הצעה אישית מדויקת."
כך גם לגבי פרטי טיסות — אל תמסור מספרי טיסה או שעות.

## מסלול מכירות 🚢
שלב 1 — שאל: "האם מעניין אותך קרוז בים או שייט נהרות באירופה?"
שלב 2 — לפי הבחירה, הצג את היעדים:
קרוז בים:
${destList('cruise')}
שייט נהרות:
${destList('river')}
שלב 3 — הצג את הטיולים של אותו יעד מהמאגר, עם תיאור קצר וקישור.
שלב 4 — **ענה על שאלות.** זה השלב החשוב. הישאר בשיחה כל עוד שואלים: מה כולל, מתי יוצא, איזו אנייה, מה רואים. אל תמהר לבקש פרטים.
שלב 5 — כשניכר עניין אמיתי או שנגמרו השאלות, בקש בשאלה אחת:
"נשמח שנציג יחזור אליך עם כל הפרטים. מה השם המלא והטלפון שלך?"
סיום: "תודה [שם]! נציג שלנו יחזור אליך בהקדם 😊"

## מה לא לשאול — חשוב
- **אל תשאל שוב על סוג הטיול** אחרי שהלקוח כבר בחר קרוז או שייט נהרות. אתה כבר יודע מה הוא רוצה — אל תציע לו קטגוריה אחרת ואל תחזור על השאלה.
- **אל תשאל אם הוא נוסע לבד או בזוג.**
- **אל תשאל על דרישות מיוחדות** — תזונה, נגישות, בעיות רפואיות. הנציג יברר את זה.
- **אל תשאל על תאריך מועדף.** התאריכים מופיעים ליד כל טיול, והנציג יסגור את זה.
- בסוף אתה מבקש **רק שם מלא וטלפון**, ובשאלה אחת.

## מסלול שירות לקוחות 💬 (למי שכבר הזמין)
**התפקיד שלך כאן הוא לענות בעצמך.** העברה לנציג היא המוצא האחרון, לא הראשון.

1. **חפש היטב במאגר השירות שלמטה.** התשובה שם גם אם הלקוח ניסח אחרת ממה שכתוב. "מתי לשלם" ו"תנאי תשלום" זה אותו דבר. "מה עם המזוודה" ו"מדיניות כבודה" זה אותו דבר.
2. אם מצאת — **ענה במלואה**, בחום ובבהירות. אל תסתפק בהפניה.
3. אם השאלה נוגעת לכמה נושאים — ענה על כולם.
4. אם התשובה חלקית — תן את מה שיש לך, ורק על החלק החסר אמור שנציג ישלים.
5. **רק אם באמת אין כלום במאגר** — אמור: "אני רוצה לוודא שתקבל תשובה מדויקת. אשמח לקחת פרטים ונציג יחזור אליך."
   ואז בקש שם מלא, טלפון, ונושא הפנייה בקצרה.
6. סיים: "תודה [שם]! נציג יחזור אליך בהקדם 🙏"

**אל תעביר לנציג** רק כי השאלה נשמעת מורכבת. אם המידע במאגר — ענה.
**אל תמציא** מידע שאינו במאגר. זה ההבדל היחיד.

## אסור
- אל תבטיח מסגרת זמן לחזרת נציג ("תוך שעה" וכדומה) — רק "בהקדם".
- אל תשלח קישורים אלא אם התבקשת או שהצגת טיול ספציפי.

## המאגר
${kb}`;

  // Anthropic מקבל רק user/assistant עם תוכן טקסט לא ריק, והרשימה חייבת להתחיל ב-user.
  // ההיסטוריה השמורה מכילה גם הודעות נציג, הערות פנימיות והודעות קבצים — כל אחת מהן
  // מחזירה 400 ומפילה את כל הבקשה.
  function sanitizeForAnthropic(msgs) {
    const clean = [];
    for (const m of msgs) {
      const role = m.role === 'user' ? 'user'
                 : (m.role === 'assistant' || m.role === 'bot') ? 'assistant'
                 : null;                       // agent / note / system — לא נשלחים
      if (!role) continue;

      const content = typeof m.content === 'string' ? m.content.trim() : '';
      if (!content) continue;                  // הודעת קובץ בלי טקסט

      // מיזוג הודעות רצופות מאותו תפקיד — Anthropic מעדיף החלפה
      if (clean.length && clean[clean.length - 1].role === role) {
        clean[clean.length - 1].content += '\n' + content;
      } else {
        clean.push({ role, content });
      }
    }
    // הרשימה חייבת להתחיל בהודעת user
    while (clean.length && clean[0].role !== 'user') clean.shift();
    return clean;
  }

  const messages = sanitizeForAnthropic(updatedHistory).slice(-20);
  if (!messages.length) messages.push({ role: 'user', content: userMessage });

  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system,
    messages,
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
  const cleanMsg = userMessage.replace(/[-\s]/g, '');
  const phonePattern = /05[0-9]{8}/;
  const hasPhone = phonePattern.test(cleanMsg);
  if (hasPhone) {
    const allText = updatedHistory.map(m => m.role === 'user' ? m.content : '').join(' ');
    const detectedPhone = cleanMsg.match(phonePattern)?.[0] || '';
    
    // Try to extract name - various patterns
    let detectedName = 'לקוח מהבוט';
    const namePatterns = [
      /שמ[יי]\s+([א-ת]+(?:\s+[א-ת]+)?)/,
      /([א-ת]{2,}\s+[א-ת]{2,})\s+05/,
      /^([א-ת]{2,}(?:\s+[א-ת]{2,})?)\s+05/m,
    ];
    for (const pattern of namePatterns) {
      const match = allText.match(pattern);
      if (match) { detectedName = match[1]; break; }
    }
    
    const summary = updatedHistory.map(m => (m.role === 'user' ? 'לקוח: ' : 'בוט: ') + m.content).join(' | ').slice(0, 500);
    
    // Check if this is a service inquiry (support) or sales
    const allTextFull = updatedHistory.map(m => m.content).join(' ');
    const isService = allTextFull.includes('שירות') || allTextFull.includes('בעיה') || 
                      allTextFull.includes('ביטול') || allTextFull.includes('שאלה') ||
                      allTextFull.includes('הזמנה') || allTextFull.includes('מסמך') ||
                      phone.includes('tc_') === false && allTextFull.includes('🎧');
    
    if (isService) {
      createMondayItem(detectedName, detectedPhone, summary).catch(console.error);
    } else {
      createPipedriveLead(detectedName, detectedPhone, summary).catch(console.error);
    }
  }
  
  return aiMessage;
}

// ── Webhooks ──────────────────────────────────────────────

app.post('/webhook/greenapi', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    
    console.log('[Webhook Green] Type:', body?.typeWebhook);
    console.log('[Webhook Green] Full body:', JSON.stringify(body).substring(0, 200));
    
    if (body?.typeWebhook !== 'incomingMessageReceived') return;
    const msg = body.messageData;
    
    // רק logging - כדי לראות מה Green API שולח
    if (msg?.typeMessage && ['imageMessage', 'documentMessage', 'videoMessage', 'audioMessage'].includes(msg.typeMessage)) {
      console.log('[File Received]', JSON.stringify(msg, null, 2).substring(0, 500));
    }
    const chatId = body.senderData?.chatId;
    const isGroup = chatId?.includes('@g.us');
    const phone = normalizePhone(chatId?.replace('@c.us', '').replace('@g.us', ''));
    const senderName = body.senderData?.senderName || body.senderData?.pushname || phone;
    if (!phone) return;
    
    console.log(`[Webhook Green] ${isGroup ? '👥 קבוצה' : '👤 אישי'}: ${senderName}`);

    // טקסט רגיל
    const text = msg?.textMessageData?.textMessage || msg?.extendedTextMessageData?.text;

    // קבצים: תמונה, מסמך, אודיו, וידאו
    let fileUrl = null, fileName = '';
    const fileType = msg?.typeMessage || '';
    
    // Green API — תמיכה בכל סוגי הקבצים
    if (['imageMessage','documentMessage','videoMessage','audioMessage'].includes(fileType)) {
      // נסה fileMessageData קודם
      if (msg?.fileMessageData?.downloadUrl) {
        fileUrl = msg.fileMessageData.downloadUrl;
        fileName = msg.fileMessageData.fileName || msg.fileMessageData.caption || fileType;
      }
      // נסה imageMessageData
      else if (msg?.imageMessageData?.downloadUrl) {
        fileUrl = msg.imageMessageData.downloadUrl;
        fileName = msg.imageMessageData.caption || 'image.jpg';
      }
      // נסה documentMessageData
      else if (msg?.documentMessageData?.downloadUrl) {
        fileUrl = msg.documentMessageData.downloadUrl;
        fileName = msg.documentMessageData.fileName || 'document';
      }
      // נסה videoMessageData
      else if (msg?.videoMessageData?.downloadUrl) {
        fileUrl = msg.videoMessageData.downloadUrl;
        fileName = msg.videoMessageData.caption || 'video.mp4';
      }
      // נסה audioMessageData
      else if (msg?.audioMessageData?.downloadUrl) {
        fileUrl = msg.audioMessageData.downloadUrl;
        fileName = 'audio.ogg';
      }
      // נסה downloadUrl ישירות
      else if (msg?.downloadUrl) {
        fileUrl = msg.downloadUrl;
        fileName = msg.fileName || msg.caption || fileType;
      }
      if (fileUrl) {
        console.log(`[Webhook Green] FILE TYPE: ${fileType}, NAME: ${fileName}, URL: ${fileUrl}`);
      } else {
        console.log(`[Webhook Green] FILE RECEIVED but no downloadUrl found. Type: ${fileType}`);
        console.log('[Webhook Green] Full msg:', JSON.stringify(msg, null, 2).substring(0, 800));
      }
    }

    if (!text && !fileUrl) return;

    console.log(`[Webhook Green] ${senderName} (${phone}): ${text || '[קובץ: '+fileType+']'}`);
    console.log('[Webhook Green File]', { fileUrl, fileName, fileType });
    
    // קבל שיחה קיימת
    const existing = await getConversation(phone);
    
    const msgs = existing?.messages || [];
    
    if (fileUrl) {
      // הודעת קובץ
      console.log('[Webhook] Adding file to messages:', { fileUrl, fileName, fileType });
      msgs.push({
        role: 'user',
        content: fileName || 'קובץ',
        fileUrl,
        fileType,
        fileName: fileName || 'קובץ',
        time: new Date().toISOString(),
        channel: 'green'
      });
      console.log('[Webhook] Messages count after file:', msgs.length);
    }
    if (text) {
      msgs.push({ role: 'user', content: text, time: new Date().toISOString(), channel: 'green' });
    }

    // שמור את ההודעה תחילה (חשוב!)
    let updates = { messages: msgs, last_message: text || '📎 קובץ', status: existing?.status || 'new', channel: 'green', contact_name: senderName, isGroup };
    
    console.log('[Webhook Save]', JSON.stringify(updates, null, 2).substring(0, 300));

    // שיוך אוטומטי לנציג — רק בפנייה חדשה (אין שיחה קיימת או שהיא טופלה)
    if (!existing || existing.status === 'resolved' || !existing.assigned_agent) {
      try {
        const pdInfo = await findPipedriveInfo(phone);
        if (pdInfo.agentId) updates.assigned_agent = pdInfo.agentId;
        if (pdInfo.customerName && !senderName) updates.contact_name = pdInfo.customerName;
      } catch(e) { console.error('[Green Webhook] Pipedrive lookup error:', e.message); }
    }

    // שמור את ההודעה של הלקוח ב-Supabase
    await upsertConversation(phone, updates);
    console.log('[Webhook] Saved to Supabase, messages with file:', updates.messages.some(m => m.fileUrl) ? 'YES' : 'NO');

    // התראות: מייל לנציג + ITEM ב-Monday לנציגי שירות
    const savedConv = await getConversation(phone).catch(() => null);
    notifyIncomingMessage(phone, text, savedConv || { ...existing, ...updates }).catch(console.error);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const from = normalizePhone(req.body.From?.replace('whatsapp:', ''));
    const text = req.body.Body;
    if (!from || !text) {
      res.type('text/xml');
      res.send('<Response></Response>');
      return;
    }
    
    console.log(`[Twilio] ${from}: ${text}`);

    // שמור שיחה
    const existing = await getConversation(from);
    const msgs = existing?.messages || [];
    msgs.push({ role: 'user', content: text, time: new Date().toISOString(), channel: 'twilio' });
    
    let updates = { 
      messages: msgs, 
      last_message: text, 
      status: existing?.status || 'new',
      channel: 'twilio'
    };

    // שיוך אוטומטי לנציג — רק בפנייה חדשה
    if (!existing || existing.status === 'resolved' || !existing.assigned_agent) {
      try {
        const pdInfo = await findPipedriveInfo(from);
        if (pdInfo.agentId) updates.assigned_agent = pdInfo.agentId;
      } catch(e) { console.error('[Twilio] Pipedrive lookup error:', e.message); }
    }

    await upsertConversation(from, updates);

    // התראות: מייל לנציג + ITEM ב-Monday לנציגי שירות
    const savedTwilioConv = await getConversation(from).catch(() => null);
    notifyIncomingMessage(from, text, savedTwilioConv || { ...existing, ...updates }).catch(console.error);

    // תשובה ריקה ל-Twilio
    res.type('text/xml');
    res.send('<Response></Response>');
  } catch (err) {
    console.error('Twilio webhook error:', err.message);
    res.type('text/xml');
    res.send('<Response></Response>');
  }
});

// ── Auth ──────────────────────────────────────────────────

app.post('/api/agents/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const agent = await getAgentByEmail(email);
    if (!agent) {
      console.warn('[Login] לא נמצא משתמש עם המייל:', JSON.stringify(email));
      return res.status(401).json({ error: 'פרטי התחברות שגויים' });
    }
    if (agent.status !== 'approved') {
      console.warn('[Login] סטטוס לא מאושר:', agent.email, '=', agent.status);
      return res.status(401).json({ error: 'המשתמש ממתין לאישור' });
    }
    
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
      id, name: String(name).trim(), email: String(email).trim().toLowerCase(), password: hashed,
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
    if (!agent) {
      console.warn('[Reset] לא נמצא משתמש עם המייל:', JSON.stringify(email));
      return res.json({ success: true, message: 'אם האימייל קיים, נשלח מייל' });
    }
    console.log('[Reset] נשלח קישור איפוס ל-', agent.email);
    
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
    const me = await requireRole(req, res, ['admin', 'supervisor']);
    if (!me) return;

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

// שינוי תפקיד — מנהל מערכת בלבד
app.post('/api/agents/:id/role', async (req, res) => {
  try {
    const me = await requireRole(req, res, ['admin']);
    if (!me) return;

    const { role } = req.body;
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: 'תפקיד לא מוכר' });
    }

    const target = await getAgentById(req.params.id);
    if (!target) return res.status(404).json({ error: 'נציג לא נמצא' });

    // מנהל לא יכול להוריד לעצמו הרשאות ולנעול את המערכת
    if (target.id === me.id && role !== 'admin') {
      return res.status(400).json({ error: 'אי אפשר לשנות את ההרשאה של עצמך' });
    }

    // חייב להישאר לפחות מנהל מערכת אחד
    if (target.role === 'admin' && role !== 'admin') {
      const all = await getAllAgents();
      const admins = all.filter(a => a.role === 'admin' && a.status === 'approved');
      if (admins.length <= 1) {
        return res.status(400).json({ error: 'חייב להישאר מנהל מערכת אחד לפחות' });
      }
    }

    await updateAgent(req.params.id, { role });
    console.log(`[Roles] ${me.name} שינה את ${target.name} ל-${ROLE_LABELS[role]}`);
    res.json({ success: true, role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// כמות ההודעות והשיחות לכל נציג — מנהל וסופרוויזר
app.get('/api/agents/stats', async (req, res) => {
  try {
    const me = await requireRole(req, res, ['admin', 'supervisor']);
    if (!me) return;

    const [agents, convs] = await Promise.all([
      getAllAgents(),
      getAllConversations()
    ]);

    const byId = {};
    const byName = {};
    agents.forEach(a => {
      byId[a.id] = {
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        roleLabel: ROLE_LABELS[a.role] || a.role,
        availability: a.availability,
        status: a.status,
        conversations: 0,   // שיחות שמשויכות אליו
        open: 0,            // מתוכן עדיין פתוחות
        messages: 0,        // הודעות שהוא עצמו שלח
        lastActivity: null
      };
      byName[a.name] = a.id;
    });

    convs.forEach(c => {
      const owner = byId[c.assigned_agent];
      if (owner) {
        owner.conversations++;
        if (c.status !== 'resolved') owner.open++;
      }
      const msgs = Array.isArray(c.messages) ? c.messages : [];
      msgs.forEach(m => {
        if (m.role !== 'agent' && m.role !== 'note') return;
        const id = byName[m.agentName];
        if (!id) return;
        const rec = byId[id];
        rec.messages++;
        if (m.time && (!rec.lastActivity || m.time > rec.lastActivity)) {
          rec.lastActivity = m.time;
        }
      });
    });

    const stats = Object.values(byId).sort((a, b) => b.messages - a.messages);
    res.json({ agents: stats, totalConversations: convs.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// מחיקת נציג — מנהל מערכת בלבד
app.delete('/api/agents/:id', async (req, res) => {
  try {
    const me = await requireRole(req, res, ['admin']);
    if (!me) return;
    if (req.params.id === me.id) {
      return res.status(400).json({ error: 'אי אפשר למחוק את עצמך' });
    }
    await deleteAgentById(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WA Conversations ──────────────────────────────────────

app.get('/api/wa-conversations', async (req, res) => {
  try {
    const convs = await getAllConversations();
    const token = req.headers['x-auth-token'];
    let myId = null;
    if (token === 'admin-token-tarbutu') {
      myId = 'admin-1';
    } else if (token) {
      const { data } = await supabase.from('agents').select('id').eq('token', token).single();
      if (data) myId = data.id;
    }
    
    // Get all agents for name lookup
    const agents = await getAllAgents().catch(() => []);
    const agentMap = {};
    agents.forEach(a => { agentMap[a.id] = a.name; });
    agentMap['admin-1'] = 'מחלקת אופרציה';
    
    const waConvs = convs.filter(c => c.phone && !c.phone.startsWith('tc_'));
    res.json(waConvs.map(c => ({
      phone: c.phone,
      name: c.contact_name || c.phone,
      lastMessage: c.last_message || '',
      status: c.status || 'new',
      updatedAt: c.updated_at,
      channel: c.channel || 'green',
      tags: c.tags || [],
      messages: c.messages || [],
      isMyConv: myId && c.assigned_agent === myId,
      assignedAgentName: c.assigned_agent ? (agentMap[c.assigned_agent] || 'נציג') : null,
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
    const phone = normalizePhone(decodeURIComponent(req.params.phone));
    const { message } = req.body;
    const conv = await getConversation(phone);
    
    // מצא שם נציג
    const token = req.headers['x-auth-token'];
    let agentName = 'נציג';
    if (token === 'admin-token-tarbutu') {
      agentName = 'מחלקת אופרציה';
    } else if (token) {
      try {
        const { data } = await supabase.from('agents').select('name').eq('token', token).single();
        if (data) agentName = data.name;
      } catch(e) {}
    }
    
    if (conv?.channel === 'twilio') {
      await sendTwilioMsg(phone, message);
    } else {
      await sendGreenAPI(`${phone}@c.us`, message);
    }
    const msgs = conv?.messages || [];
    msgs.push({ role: 'agent', content: message, time: new Date().toISOString(), channel: conv?.channel || 'green', agentName });
    await upsertConversation(phone, { messages: msgs, last_reply: message });
    res.json({ success: true });
  } catch (err) { 
    console.error('[Send Error]', err.message, err.stack);
    res.status(500).json({ error: err.message }); 
  }
});

app.post('/api/wa-conversations/:phone/status', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { status } = req.body;
    await upsertConversation(phone, { status });

    // סינכרון Admin → Monday. האדמין שולח resolved/open/new — לא done.
    const STATUS_TO_MONDAY = { resolved: 'טופלה', open: 'בטיפול', new: 'חדשה', awaiting: 'בטיפול' };
    const mondayLabel = STATUS_TO_MONDAY[status];
    if (mondayLabel) {
      try {
        const conv = await getConversation(phone);
        if (conv?.monday_item_id) {
          const colValues = JSON.stringify({ color_mkw5dvjb: { label: mondayLabel } });
          await axios.post('https://api.monday.com/v2', {
            query: `mutation {
              change_column_value(
                board_id: ${MONDAY_BOARD_ID},
                item_id: ${conv.monday_item_id},
                column_id: "color_mkw5dvjb",
                value: ${JSON.stringify(colValues)}
              ) { id }
            }`
          }, { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } });
          console.log('[Admin→Monday]', status, '→', mondayLabel, '| item', conv.monday_item_id);
        }
      } catch(mondayErr) { console.error('[Monday] Sync error:', mondayErr.message); }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monday Webhook — סינכרון Monday → Admin ──────────────
app.post('/api/monday-webhook', async (req, res) => {
  try {
    if (req.body?.challenge) return res.json({ challenge: req.body.challenge });
    const event = req.body?.event;
    if (event?.type === 'change_column_value') {
      const itemId = String(event.pulseId);
      const label  = event.value?.label?.text || '';

      // מיפוי הסטטוס במונדיי לסטטוס באדמין.
      // הערכים חייבים להיות בדיוק אלה שהאדמין מכיר: new / open / awaiting / resolved
      let newStatus = null;
      if (label === 'טופל' || label === 'טופלה' || label === 'Done') newStatus = 'resolved';
      else if (label === 'בטיפול') newStatus = 'open';
      else if (label === 'חדשה' || label === 'חדש') newStatus = 'new';

      if (newStatus) {
        const { data: conv } = await supabase.from('conversations')
          .select('phone').eq('monday_item_id', itemId).single();
        if (conv?.phone) {
          await supabase.from('conversations').update({ status: newStatus }).eq('phone', conv.phone);
          console.log('[Monday→Admin]', label, '→', newStatus, '|', conv.phone);
        }
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

// שינוי שם לקוח ידנית
app.post('/api/wa-conversations/:phone/rename', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'נא להזין שם' });
    await upsertConversation(phone, { contact_name: name.trim() });
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
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { agentId } = req.body;
    await upsertConversation(phone, { assigned_agent: agentId });

    // הודע לנציג שהשיחה הועברה אליו
    try {
      const conv = await getConversation(phone);
      const agent = await getAgentById(agentId);
      const lastMsg = (conv?.messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
      emailAgentNewMessage(agent, phone, lastMsg, conv?.contact_name)
        .catch(e => console.error('[Assign] Email failed:', e.message));
    } catch(e) { console.error('[Assign] Notify error:', e.message); }

    // אם הוקצה לנציג שירות — פתח ITEM ב-Monday
    if (SERVICE_AGENTS.has(agentId)) {
      try {
        const conv = await getConversation(phone);
        // פתח רק אם אין ITEM קיים
        if (!conv?.monday_item_id) {
          const agentData = await getAgentById(agentId);
          const msgs = conv?.messages || [];
          const lastUserMsg = msgs.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
          const description = msgs
            .filter(m => m.role === 'user')
            .map(m => m.content)
            .join(' | ')
            .slice(0, 500);

          const cleanName = (conv?.contact_name || 'לקוח').substring(0, 50);

          // "נציג מטפל" — מזהה המשתמש נשלף לפי המייל של הנציג
          const mondayUserId = await getMondayUserIdByEmail(agentData?.email);

          const colValues = {
            'phone_mkw59e3v': { phone: phone.replace('+',''), countryShortName: 'IL' },
            'long_text_mkw5q0e2': { text: description },
            'text_mkzmby8z': 'Admin',
            'color_mkw5dvjb': { label: 'חדשה' },
          };
          if (mondayUserId) {
            colValues['multiple_person_mkw5rbj0'] = {
              personsAndTeams: [{ id: mondayUserId, kind: 'person' }]
            };
          }

          const query = `mutation {
            create_item(
              board_id: ${MONDAY_BOARD_ID},
              group_id: "${MONDAY_GROUP_NEW}",
              item_name: "${cleanName}",
              column_values: ${JSON.stringify(JSON.stringify(colValues))}
            ) { id }
          }`;

          const mondayRes = await axios.post('https://api.monday.com/v2',
            { query },
            { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
          );
          const mondayItemId = mondayRes.data?.data?.create_item?.id;
          if (mondayItemId) {
            await upsertConversation(phone, { monday_item_id: String(mondayItemId) });
            console.log('[Monday] Item created for service agent:', agentData?.name, '| Item:', mondayItemId);
          }
        }
      } catch(mondayErr) {
        console.error('[Monday] Error creating item:', mondayErr.message);
      }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/wa-conversations/:phone/transfer', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    // When transferring, mark as new so receiving agent sees it
    await upsertConversation(phone, { 
      assigned_agent: req.body.agentId,
      status: 'new'
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wa-conversations/delete-all', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    // רק admin יכול למחוק הכל
    if (token !== 'admin-token-tarbutu') {
      const { data } = await supabase.from('agents').select('role').eq('token', token).single();
      if (!data || data.role !== 'admin') return res.status(403).json({ error: 'הרשאה נדחתה — רק Admin יכול למחוק' });
    }
    await supabase.from('conversations').delete().neq('phone', '');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wa-conversations/:phone', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    // רק admin יכול למחוק
    if (token !== 'admin-token-tarbutu') {
      const { data } = await supabase.from('agents').select('role').eq('token', token).single();
      if (!data || data.role !== 'admin') return res.status(403).json({ error: 'הרשאה נדחתה — רק Admin יכול למחוק' });
    }
    await supabase.from('conversations').delete().eq('phone', decodeURIComponent(req.params.phone));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/wa-conversations', async (req, res) => {
  try {
    const token = req.headers['x-auth-token'];
    // רק admin יכול למחוק
    if (token !== 'admin-token-tarbutu') {
      const { data } = await supabase.from('agents').select('role').eq('token', token).single();
      if (!data || data.role !== 'admin') return res.status(403).json({ error: 'הרשאה נדחתה — רק Admin יכול למחוק' });
    }
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
  try {
    const token = req.headers['x-auth-token'];
    // רק admin יכול למחוק
    if (token !== 'admin-token-tarbutu') {
      const { data } = await supabase.from('agents').select('role').eq('token', token).single();
      if (!data || data.role !== 'admin') return res.status(403).json({ error: 'הרשאה נדחתה — רק Admin יכול למחוק' });
    }
    await supabase.from('conversations').delete().eq('phone', req.params.phone);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const { phone, message, systemPrompt, sessionId, history, chatType, traffic } = req.body;
    const phoneId = phone ? normalizePhone(phone) : (sessionId || 'web-' + Date.now());
    const reply = await getAIResponse(phoneId, message, systemPrompt);

    // מקור ההגעה — נשמר פעם אחת לשיחה, למדידת קמפיינים
    if (traffic && (traffic.source || traffic.campaign || traffic.gclid)) {
      try {
        const { data: conv } = await supabase.from('conversations')
          .select('traffic_source').eq('phone', phoneId).maybeSingle();
        if (!conv?.traffic_source) {
          await supabase.from('conversations').update({
            traffic_source:   traffic.source   || null,
            traffic_medium:   traffic.medium   || null,
            traffic_campaign: traffic.campaign || null,
            traffic_gclid:    traffic.gclid    || null,
            landing_page:     traffic.landing  || null,
          }).eq('phone', phoneId);
        }
      } catch (e) { console.error('[Traffic] שמירה נכשלה:', e.message); }
    }
    res.json({ reply, message: reply }); // support both d.reply and d.message
  } catch (err) {
    // axios מסתיר את הסיבה בתוך response.data — בלי זה רואים רק "status code 400"
    const upstream = err.response?.data;
    console.error('[Chat Error]', err.message);
    if (upstream) console.error('[Chat Error] פירוט מה-API:', JSON.stringify(upstream));
    res.status(500).json({
      error: err.message,
      detail: upstream?.error?.message || upstream?.error?.type || null
    });
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
    // שמור טיולים ב-Supabase
    if (trips && trips.length > 0) {
      await supabase.from('trips_list').upsert(
        trips.map(t => ({ url: t.url, name: t.name, added_at: t.addedAt || new Date().toISOString() })),
        { onConflict: 'url' }
      );
    }
    knowledgeCache = null;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// טעינת רשימת טיולים מ-Supabase
// רשימת היעדים — לשימוש האדמין
// דוח קמפיינים — ספירות בלבד, בלי שמות או טלפונים.
// זה מה שאפשר להעביר לחברת הפרסום.
app.get('/api/campaign-report', async (req, res) => {
  try {
    const me = await requireRole(req, res, ['admin', 'supervisor']);
    if (!me) return;

    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 864e5).toISOString();

    const { data: convs } = await supabase.from('conversations')
      .select('phone, status, created_at, traffic_source, traffic_medium, traffic_campaign, landing_page, messages')
      .gte('created_at', since);

    const rows = {};
    let noSource = 0;

    (convs || []).forEach(c => {
      const src = c.traffic_source;
      if (!src) { noSource++; return; }

      const key = [src, c.traffic_medium || '-', c.traffic_campaign || '-'].join(' | ');
      if (!rows[key]) rows[key] = {
        source: src,
        medium: c.traffic_medium || '—',
        campaign: c.traffic_campaign || '—',
        conversations: 0, leads: 0, resolved: 0, pages: {}
      };
      const r = rows[key];
      r.conversations++;
      if (c.status === 'resolved') r.resolved++;

      // ליד = השאיר טלפון בשיחה
      const txt = (Array.isArray(c.messages) ? c.messages : [])
        .filter(m => m.role === 'user')
        .map(m => m.content || '').join(' ');
      if (/0[5-9][\d\-\s]{7,}/.test(txt)) r.leads++;

      if (c.landing_page) r.pages[c.landing_page] = (r.pages[c.landing_page] || 0) + 1;
    });

    const report = Object.values(rows)
      .map(r => ({
        ...r,
        conversionRate: r.conversations ? Math.round(r.leads / r.conversations * 100) : 0,
        topPage: Object.entries(r.pages).sort((a,b) => b[1]-a[1])[0]?.[0] || null,
        pages: undefined,
      }))
      .sort((a, b) => b.leads - a.leads || b.conversations - a.conversations);

    res.json({
      days,
      from: since.slice(0, 10),
      totalConversations: (convs || []).length,
      withoutSource: noSource,
      campaigns: report,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/destinations', (req, res) => res.json(DESTINATIONS));

// תיקון ידני של סוג/יעד לטיול
app.post('/api/trip-classify', async (req, res) => {
  try {
    const me = await requireRole(req, res, ['admin', 'supervisor']);
    if (!me) return;
    const { url, category, destination, manual } = req.body;
    if (!url) return res.status(400).json({ error: 'חסר קישור' });

    const { data: existing } = await supabase.from('knowledge_base')
      .select('url').eq('url', url).maybeSingle();

    const fields = {
      category: category || null,
      destination: destination || null,
      manual_dest: manual ? true : undefined,
    };
    Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);

    if (existing) {
      await supabase.from('knowledge_base').update(fields).eq('url', url);
    } else {
      // הטיול עוד לא נסרק — שומרים שורה כדי שהשיוך לא יאבד
      const { data: t } = await supabase.from('trips_list').select('name').eq('url', url).maybeSingle();
      await supabase.from('knowledge_base').upsert([{
        url, name: t?.name || url, type: 'trip', content: '', ...fields
      }], { onConflict: 'url' });
    }
    knowledgeCache = null;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trips-list', async (req, res) => {
  try {
    const { data: dbTrips } = await supabase.from('trips_list').select('*').order('added_at', { ascending: true });
    const { data: scanned } = await supabase.from('knowledge_base')
      .select('url, name, scanned_at, category, destination, scan_error').eq('type', 'trip');

    const scannedByUrl = {};
    (scanned || []).forEach(s => { scannedByUrl[s.url] = s; });

    const seen = new Set();
    const trips = (dbTrips || []).map(t => {
      seen.add(t.url);
      const sc = scannedByUrl[t.url];
      return {
        name: t.name, url: t.url, addedAt: t.added_at,
        scanned: !!(sc && sc.scanned_at),
        scanError: sc?.scan_error || null,
        category: sc?.category || null,
        destination: sc?.destination || null,
        destinationLabel: sc?.destination ? destLabel(sc.category || 'cruise', sc.destination) : null,
      };
    });

    // טיולים שנסרקו אך אינם ברשימה — אחרת הם נעלמים מהאדמין למרות שהבוט מכיר אותם
    (scanned || []).forEach(sc => {
      if (seen.has(sc.url)) return;
      trips.push({
        name: sc.name || sc.url, url: sc.url, addedAt: sc.scanned_at,
        scanned: true, orphan: true,
        category: sc.category || null,
        destination: sc.destination || null,
        destinationLabel: sc.destination ? destLabel(sc.category || 'cruise', sc.destination) : null,
      });
    });

    res.json({ trips });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// מחיקת טיול מ-Supabase
app.delete('/api/trips-list', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'חסר url' });
    await supabase.from('trips_list').delete().eq('url', url);
    await supabase.from('knowledge_base').delete().eq('url', url);
    knowledgeCache = null;
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
    isScanning: scanState.isScanning,
    current: scanState.current,
    total: scanState.total,
    currentName: scanState.currentName,
    ok: scanState.ok,
    failed: scanState.failed,
    finishedAt: scanState.finishedAt,
    contentLength: knowledgeCache ? knowledgeCache.length : 0,
    lastScanned: lastScanTime,
    pagesScanned: scanState.current,
    totalPages: scanState.total || TRIPS.length
  }); 
});
app.post('/api/import-green', (req, res) => { res.json({ success: true, message: 'לא זמין' }); });

app.get('/api/reports', async (req, res) => {
  try {
    const convs = await getAllConversations();
    const today = new Date().toDateString();
    
    // סטטיסטיקות יום
    const byStatus = { new: 0, open: 0, resolved: 0, awaiting: 0 };
    const byChannel = { green: 0, twilio: 0 };
    const agentStats = {};
    
    convs.forEach(c => {
      const s = c.status || 'new';
      byStatus[s] = (byStatus[s] || 0) + 1;
      if (c.channel === 'twilio') byChannel.twilio++;
      else byChannel.green++;
      
      // ביצוע נציגים
      if (c.assigned_agent) {
        if (!agentStats[c.assigned_agent]) {
          agentStats[c.assigned_agent] = { total: 0, resolved: 0, messages: 0, avgResponseTime: 0 };
        }
        agentStats[c.assigned_agent].total++;
        if (c.status === 'resolved') agentStats[c.assigned_agent].resolved++;
        agentStats[c.assigned_agent].messages += (c.messages || []).length;
        
        // חישוב זמן מענה ממוצע
        const messages = c.messages || [];
        if (messages.length > 1) {
          let firstUserMsg = null;
          let firstAgentMsg = null;
          
          for (const msg of messages) {
            if (!firstUserMsg && msg.role === 'user') firstUserMsg = new Date(msg.time);
            if (!firstAgentMsg && msg.role === 'agent') firstAgentMsg = new Date(msg.time);
            if (firstUserMsg && firstAgentMsg) break;
          }
          
          if (firstUserMsg && firstAgentMsg) {
            const responseTime = (firstAgentMsg - firstUserMsg) / 60000; // דקות
            agentStats[c.assigned_agent].avgResponseTime = responseTime;
          }
        }
      }
    });
    
    // קבל שמות נציגים
    const { data: agents } = await supabase.from('agents').select('id, name, role');
    const agentMap = {};
    if (agents) agents.forEach(a => { agentMap[a.id] = a.name; });
    
    // פרמט ביצוע
    const agentPerformance = Object.entries(agentStats).map(([id, stats]) => ({
      id,
      name: agentMap[id] || id,
      total: stats.total,
      resolved: stats.resolved,
      avgResponseTime: Math.round(stats.avgResponseTime),
      messages: stats.messages,
      rating: Math.round((stats.resolved / stats.total) * 100) || 0
    })).sort((a, b) => b.total - a.total);
    
    res.json({
      total: convs.length,
      byStatus,
      byChannel,
      agentStats: agentPerformance
    });
  } catch (err) {
    console.error('[Reports Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send', async (req, res) => {
  try {
    const { phone, message, channel } = req.body;
    if (channel === 'whatsapp-twilio') { 
      await sendTwilioMsg(phone, message);
    } else { 
      await sendGreenAPI(`${phone}@c.us`, message); 
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/status', async (req, res) => {
  const convs = await getAllConversations().catch(() => []);
  res.json({ status: 'ok', supabase: 'connected', conversations: convs.length, timestamp: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname)));
// ── Outlook Email Webhook — פתיחת ITEM ב-Monday ──────────
app.post('/api/email-webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const { from, subject, body, to } = req.body;
    if (!from) return;

    // Make שולח from, subject, body כstrings ישירים
    const senderEmail = (from || '').toLowerCase().trim();
    
    // דלג על מיילים מ-telekol
    if (senderEmail.includes('telekol')) {
      console.log('[Email Webhook] Skipping telekol email from:', senderEmail);
      return;
    }

    // רק מיילים שנשלחו ל-service-tarbutu
    const toEmail = (to || '').toLowerCase().trim();
    if (!toEmail.includes('service-tarbutu')) {
      console.log('[Email Webhook] Not service email, skipping');
      return;
    }

    const emailSubject = subject || 'פנייה חדשה';
    const emailBody = (body || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 500);
    const senderName = senderEmail.split('@')[0] || 'Guest';

    console.log('[Email Webhook] New email from:', senderEmail, '| Subject:', emailSubject);

    // צור ITEM ב-Monday
    const colValues = {
      'long_text_mkw5q0e2': { text: `נושא: ${emailSubject}\n\n${emailBody}` },
      'text_mkzmby8z': 'מייל',
      'color_mkw5dvjb': { label: 'חדשה' },
      'email_mm3qph95': { email: senderEmail, text: senderEmail },
    };

    const cleanName = senderName.substring(0, 50);
    const query = `mutation {
      create_item(
        board_id: ${MONDAY_BOARD_ID},
        group_id: "${MONDAY_GROUP_NEW}",
        item_name: "${cleanName}",
        column_values: ${JSON.stringify(JSON.stringify(colValues))}
      ) { id }
    }`;

    const mondayRes = await axios.post('https://api.monday.com/v2',
      { query },
      { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
    );
    const itemId = mondayRes.data?.data?.create_item?.id;
    console.log('[Email Webhook] Monday item created:', itemId, 'for:', senderEmail);
  } catch(e) {
    console.error('[Email Webhook] Error:', e.message);
  }
});

app.get('/api/monday-groups', async (req, res) => {
  try {
    const r = await axios.post('https://api.monday.com/v2',
      { query: `{ boards(ids: [${MONDAY_BOARD_ID}]) { groups { id title } } }` },
      { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
    );
    res.json(r.data.data.boards[0].groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/monday-columns', async (req, res) => {
  try {
    const r = await axios.post('https://api.monday.com/v2',
      { query: '{ boards(ids: [5054953529]) { columns { id title type } } }' },
      { headers: { Authorization: MONDAY_TOKEN, 'Content-Type': 'application/json' } }
    );
    res.json(r.data.data.boards[0].columns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Missed Call Webhook (Aircall + Make) ─────────────────

app.post('/webhook/missed-call', async (req, res) => {
  res.sendStatus(200);
  try {
    const phone = req.body.phone || req.body.number || req.body.caller_number;
    if (!phone) return;
    
    // Normalize phone number
    const waPhone = normalizePhone(phone);
    
    console.log(`[Missed Call] Sending WhatsApp to ${waPhone}`);

    // חיפוש ב-Pipedrive — נציג מטפל + שם לקוח
    const pdInfo = await findPipedriveInfo(waPhone);
    
    const message = `שלום! 👋 התקשרת אלינו לתרבותו ולא הצלחנו לענות.
נחזור אליך בהקדם האפשרי 🙏
בינתיים, אם תרצה — שלח לנו הודעה כאן ונטפל בך מיד!`;

    await sendGreenAPI(`${waPhone}@c.us`, message);
    
    // Save to admin
    const existing = await getConversation(waPhone);
    const msgs = existing?.messages || [];
    msgs.push({ role: 'agent', content: '📞 שיחה שלא נענתה — נשלחה הודעת WhatsApp', time: new Date().toISOString(), channel: 'green' });

    const updates = { messages: msgs, last_message: 'שיחה שלא נענתה', status: 'new', channel: 'green' };
    if (pdInfo.agentId) updates.assigned_agent = pdInfo.agentId;
    // שמור שם לקוח מ-Pipedrive רק אם אין כבר שם
    if (pdInfo.customerName && !existing?.contact_name) updates.contact_name = pdInfo.customerName;

    await upsertConversation(waPhone, updates);
    
    console.log(`[Missed Call] Done for ${waPhone}, assigned to: ${pdInfo.agentId || 'none'}, name: ${pdInfo.customerName || 'unknown'}`);
  } catch (err) {
    console.error('[Missed Call] Error:', err.message);
  }
});

app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/preview', (req, res) => { res.sendFile(path.join(__dirname, 'preview.html')); });
app.get('/', (req, res) => { res.json({ status: 'Tarbutu Chat ✅' }); });

// ── Start ─────────────────────────────────────────────────
async function initDB() {
  // העבר את TRIPS הקבועים ל-Supabase אם הטבלה ריקה
  try {
    const { data, error } = await supabase.from('trips_list').select('url').limit(1);
    if (!error && (!data || data.length === 0)) {
      console.log('[Init] Seeding trips_list from static TRIPS...');
      await supabase.from('trips_list').upsert(
        TRIPS.map(t => ({ url: t.url, name: t.name, added_at: new Date().toISOString() })),
        { onConflict: 'url' }
      );
      console.log('[Init] Seeded', TRIPS.length, 'trips');
    }
  } catch(e) {
    console.log('[Init] trips_list not ready yet:', e.message);
  }
}

const PORT = process.env.PORT || 3000;
// ── דוח פניות פעמיים ביום ─────────────────────────────────
// נשלח ב-09:00 וב-16:00 שעון ישראל למנהלי מערכת וסופרוויזרים.

const REPORT_HOURS = [9, 16];

function waitingSince(conv) {
  const msgs = Array.isArray(conv.messages) ? conv.messages : [];
  const lastCustomer = [...msgs].reverse().find(m => m.role === 'user');
  const t = lastCustomer?.time || conv.updated_at || conv.created_at;
  if (!t) return null;
  const hours = (Date.now() - new Date(t).getTime()) / 36e5;
  return isNaN(hours) ? null : hours;
}

function formatWait(h) {
  if (h == null) return '';
  if (h < 1) return 'לפני פחות משעה';
  if (h < 24) return `לפני ${Math.floor(h)} שעות`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ${d === 1 ? 'יום' : 'ימים'}`;
}

function buildReportHtml(newConvs, openConvs, agentsById) {
  const row = (c) => {
    const agent = agentsById[c.assigned_agent]?.name || '<span style="color:#b42318">לא משויך</span>';
    const wait = waitingSince(c);
    const urgent = wait != null && wait >= 24;
    const preview = (c.last_message || '').replace(/</g,'&lt;').slice(0, 60);
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;font-size:13px">${c.contact_name || c.phone}</td>
      <td style="padding:8px 10px;font-size:13px;color:#5a6a72">${preview}</td>
      <td style="padding:8px 10px;font-size:13px">${agent}</td>
      <td style="padding:8px 10px;font-size:12px;color:${urgent ? '#b42318;font-weight:600' : '#5a6a72'}">${formatWait(wait)}${urgent ? ' ⚠️' : ''}</td>
    </tr>`;
  };

  const table = (title, list, color) => {
    if (!list.length) return `<h3 style="font-size:15px;margin:22px 0 6px;color:${color}">${title} — אין</h3>`;
    return `
      <h3 style="font-size:15px;margin:22px 0 8px;color:${color}">${title} (${list.length})</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden">
        <tr style="background:#f4f6f8">
          <th style="padding:8px 10px;text-align:right;font-size:12px;color:#5a6a72;font-weight:600">לקוח</th>
          <th style="padding:8px 10px;text-align:right;font-size:12px;color:#5a6a72;font-weight:600">הודעה אחרונה</th>
          <th style="padding:8px 10px;text-align:right;font-size:12px;color:#5a6a72;font-weight:600">נציג</th>
          <th style="padding:8px 10px;text-align:right;font-size:12px;color:#5a6a72;font-weight:600">ממתין</th>
        </tr>
        ${list.map(row).join('')}
      </table>`;
  };

  const stuck = [...newConvs, ...openConvs].filter(c => {
    const w = waitingSince(c);
    return w != null && w >= 24;
  }).length;

  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });

  return `<div dir="rtl" style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px">
    <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:10px;padding:24px">
      <h2 style="margin:0 0 4px;font-size:19px;color:#0d4f6c">דוח פניות — תרבותו</h2>
      <p style="margin:0 0 18px;color:#5a6a72;font-size:13px">${now}</p>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <div style="flex:1;min-width:120px;background:#fdecea;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:700;color:#b42318">${newConvs.length}</div>
          <div style="font-size:12px;color:#7a4a45">חדשות</div>
        </div>
        <div style="flex:1;min-width:120px;background:#fef9e7;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:700;color:#a05c00">${openConvs.length}</div>
          <div style="font-size:12px;color:#7a5a2a">בטיפול</div>
        </div>
        ${stuck ? `<div style="flex:1;min-width:120px;background:#fbe9e7;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:26px;font-weight:700;color:#b42318">${stuck}</div>
          <div style="font-size:12px;color:#7a4a45">מעל 24 שעות ⚠️</div>
        </div>` : ''}
      </div>

      ${table('פניות חדשות', newConvs, '#b42318')}
      ${table('פניות בטיפול', openConvs, '#a05c00')}

      <a href="${BASE_URL}/admin" style="display:inline-block;margin-top:22px;background:#1a6fa8;color:#fff;padding:10px 22px;text-decoration:none;border-radius:6px;font-size:14px">פתח את מרכז הניהול</a>
    </div>
  </div>`;
}

async function sendConversationsReport() {
  try {
    const [convs, agents] = await Promise.all([getAllConversations(), getAllAgents()]);

    const agentsById = {};
    agents.forEach(a => { agentsById[a.id] = a; });

    const relevant = convs.filter(c => !(c.phone || '').startsWith('tc_'));
    const sortByWait = (a, b) => (waitingSince(b) ?? 0) - (waitingSince(a) ?? 0);
    const newConvs  = relevant.filter(c => c.status === 'new').sort(sortByWait);
    const openConvs = relevant.filter(c => c.status === 'open' || c.status === 'awaiting').sort(sortByWait);

    const recipients = agents.filter(a =>
      (a.role === 'admin' || a.role === 'supervisor') &&
      a.status === 'approved' && a.email
    );

    if (!recipients.length) {
      console.log('[Report] אין נמענים (מנהל/סופרוויזר עם מייל) — מדלג');
      return;
    }

    const subject = `דוח פניות · ${newConvs.length} חדשות · ${openConvs.length} בטיפול`;
    const html = buildReportHtml(newConvs, openConvs, agentsById);

    for (const r of recipients) {
      await sendEmail(r.email, subject, html)
        .catch(e => console.error('[Report] נכשל ל-' + r.email + ':', e.message));
    }
    console.log(`[Report] נשלח ל-${recipients.length} נמענים | ${newConvs.length} חדשות, ${openConvs.length} בטיפול`);
  } catch (e) {
    console.error('[Report] שגיאה:', e.message);
  }
}

// בדיקה כל דקה. נשמר סימון כדי שלא יישלח פעמיים באותה שעה.
let _lastReportKey = null;
function startReportScheduler() {
  setInterval(() => {
    const israelNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const hour = israelNow.getHours();
    const key = israelNow.toDateString() + '-' + hour;

    if (REPORT_HOURS.includes(hour) && israelNow.getMinutes() === 0 && _lastReportKey !== key) {
      _lastReportKey = key;
      sendConversationsReport();
    }
  }, 60 * 1000);
  console.log(`✅ דוח פניות מתוזמן לשעות ${REPORT_HOURS.join(', ')} (שעון ישראל)`);
}

// שליחה ידנית לבדיקה — מנהל וסופרוויזר
app.post('/api/send-report', async (req, res) => {
  const me = await requireRole(req, res, ['admin', 'supervisor']);
  if (!me) return;
  await sendConversationsReport();
  res.json({ success: true, message: 'הדוח נשלח' });
});

app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Auth system with Resend emails active`);
  await initDB();
  startReportScheduler();
});
