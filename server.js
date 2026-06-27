const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_SID = process.env.TWILIO_SID || 'AC0c7aba8165d7a96b7ab11c05b6c57fdf';
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || '1f93c57e8c47bf37b4069e8b7ab82a1f';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+97233823637';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const conversations = new Map(); // שיחות בוט באתר
const waConversations = new Map(); // שיחות וואטסאפ

const CACHE_FILE = path.join(__dirname, 'cache.json');
const KB_FILE = path.join(__dirname, 'kb.json');

var kbTrips = [];
var kbSupportText = '';
var siteCache = { content: '', lastScanned: null, isScanning: false, pagesScanned: 0, totalPages: 0 };
var CACHE_TTL = 24 * 60 * 60 * 1000;

// ====== דיסק ======
function loadFromDisk() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      var data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      siteCache.content = data.content || '';
      siteCache.lastScanned = data.lastScanned ? new Date(data.lastScanned) : null;
      console.log('מטמון נטען: ' + siteCache.content.length + ' תווים');
    }
  } catch(e) { console.log('שגיאת טעינה:', e.message); }
  try {
    if (fs.existsSync(KB_FILE)) {
      var kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
      kbTrips = kb.trips || [];
      kbSupportText = kb.supportText || '';
      console.log('מאגר נטען: ' + kbTrips.length + ' טיולים');
    }
  } catch(e) { console.log('שגיאת טעינה:', e.message); }
}

function saveCacheToDisk() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ content: siteCache.content, lastScanned: siteCache.lastScanned }), 'utf8');
  } catch(e) { console.log('שגיאת שמירה:', e.message); }
}

function saveKbToDisk() {
  try {
    fs.writeFileSync(KB_FILE, JSON.stringify({ trips: kbTrips, supportText: kbSupportText }), 'utf8');
  } catch(e) { console.log('שגיאת שמירה:', e.message); }
}

// ====== סריקת טיולים ======
async function fetchTripInfo(trip) {
  var name = trip.name || trip.url;
  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'אתה סוכן חיפוש. חפש מידע על הטיול מ-tarbutu.co.il. החזר: שם, קוד, תאריך יציאה, תאריך חזרה, ימים, אונייה, מדינות, מסלול, מה כולל.',
        messages: [{ role: 'user', content: 'חפש מידע: ' + trip.url }]
      })
    });
    if (!res.ok) return '';
    var data = await res.json();
    var text = data.content.filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('\n');
    return text.length > 50 ? text : '';
  } catch(e) { return ''; }
}

async function scanSite() {
  if (siteCache.isScanning || !kbTrips.length) return;
  siteCache.isScanning = true;
  siteCache.pagesScanned = 0;
  siteCache.totalPages = kbTrips.length;
  var allContent = [];
  for (var i = 0; i < kbTrips.length; i++) {
    console.log('סורק ' + (i+1) + '/' + kbTrips.length + ': ' + kbTrips[i].name);
    var content = await fetchTripInfo(kbTrips[i]);
    if (content) allContent.push('=== ' + kbTrips[i].name + ' ===\n' + content);
    siteCache.pagesScanned = i + 1;
    await new Promise(function(r){setTimeout(r, 3000);});
  }
  if (allContent.length > 0) {
    siteCache.content = allContent.join('\n\n---\n\n');
    siteCache.lastScanned = new Date();
    saveCacheToDisk();
    console.log('סריקה הושלמה: ' + siteCache.content.length + ' תווים');
  }
  siteCache.isScanning = false;
}

setInterval(function(){ if (kbTrips.length > 0) scanSite(); }, CACHE_TTL);

// ====== שליחת הודעת וואטסאפ דרך Twilio ======
async function sendWhatsApp(to, body) {
  try {
    var toNum = to.startsWith('whatsapp:') ? to : 'whatsapp:' + to;
    var auth = Buffer.from(TWILIO_SID + ':' + TWILIO_TOKEN).toString('base64');
    var res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + TWILIO_SID + '/Messages.json', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'From=' + encodeURIComponent(TWILIO_WHATSAPP_FROM) + '&To=' + encodeURIComponent(toNum) + '&Body=' + encodeURIComponent(body)
    });
    var data = await res.json();
    console.log('WA נשלח ל-' + to + ': ' + (data.sid || data.message));
    return data.sid ? true : false;
  } catch(e) {
    console.log('שגיאת שליחת WA:', e.message);
    return false;
  }
}

// ====== Webhook וואטסאפ נכנס מ-Twilio ======
app.post('/webhook/whatsapp', function(req, res) {
  var from = req.body.From || '';
  var body = req.body.Body || '';
  var profileName = req.body.ProfileName || 'לקוח';

  console.log('WA נכנס מ-' + from + ': ' + body);

  var phone = from.replace('whatsapp:', '');

  if (!waConversations.has(phone)) {
    waConversations.set(phone, {
      phone: phone,
      name: profileName,
      messages: [],
      agentMode: false,
      agentName: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  var conv = waConversations.get(phone);
  conv.messages.push({ role: 'customer', content: body, time: new Date() });
  conv.lastMessage = body;
  conv.updatedAt = new Date();

  // שלח TwiML ריק (לא עונה אוטומטית)
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ====== API: רשימת שיחות וואטסאפ ======
app.get('/api/wa-conversations', function(req, res) {
  var list = Array.from(waConversations.values()).map(function(c) {
    return {
      phone: c.phone, name: c.name,
      lastMessage: c.lastMessage || '',
      messageCount: c.messages.length,
      agentMode: c.agentMode, agentName: c.agentName,
      createdAt: c.createdAt, updatedAt: c.updatedAt
    };
  });
  res.json(list.sort(function(a,b){ return new Date(b.updatedAt) - new Date(a.updatedAt); }));
});

app.get('/api/wa-conversations/:phone', function(req, res) {
  var phone = decodeURIComponent(req.params.phone);
  var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });
  res.json(c);
});

// שליחת הודעה מנציג דרך וואטסאפ
app.post('/api/wa-conversations/:phone/send', async function(req, res) {
  var phone = decodeURIComponent(req.params.phone);
  var message = req.body.message;
  var agentName = req.body.agentName || 'נציג';

  if (!message) return res.status(400).json({ error: 'חסר הודעה' });

  var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'שיחה לא נמצאה' });

  var sent = await sendWhatsApp(phone, message);
  if (sent) {
    c.messages.push({ role: 'agent', content: message, agentName: agentName, time: new Date() });
    c.agentMode = true;
    c.agentName = agentName;
    c.updatedAt = new Date();
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'שגיאה בשליחה' });
  }
});

// העברת שיחה בין ערוצים
app.post('/api/wa-conversations/:phone/transfer', async function(req, res) {
  var phone = decodeURIComponent(req.params.phone);
  var targetChannel = req.body.targetChannel; // 'site' or 'wa2'
  var c = waConversations.get(phone);
  if (!c) return res.status(404).json({ error: 'לא נמצא' });

  var msg = 'נציג מעביר אותך לערוץ אחר. נציג ייצור איתך קשר בהקדם.';
  await sendWhatsApp(phone, msg);
  c.transferred = targetChannel;
  c.updatedAt = new Date();
  res.json({ success: true });
});

// ====== API: עדכון מאגר ======
app.post('/api/kb-update', function(req, res) {
  if (req.body.trips) kbTrips = req.body.trips;
  if (req.body.supportText !== undefined) kbSupportText = req.body.supportText;
  saveKbToDisk();
  res.json({ success: true });
});

// ====== בניית System Prompt ======
function buildSystem(chatType, knowledge) {
  var supportSection = kbSupportText ? '\n\n=== מידע שירות לקוחות ===\n' + kbSupportText : '';
  var scanDate = siteCache.lastScanned ? siteCache.lastScanned.toLocaleDateString('he-IL') : 'היום';
  if (chatType === 'support') {
    return 'אתה נציג שירות לקוחות של "תרבותו".\nחוקים:\n- ענה בעברית\n- היה חם ומועיל\n- לשאלות אישיות הפנה ל-03-5260090\n- אל תמציא מידע\n' + supportSection;
  }
  return 'אתה יועץ מכירות של "תרבותו" – חברת טיולי תרבות.\nחוקים:\n- ענה בעברית\n- היה נלהב\n- תן מידע מפורט: תאריכים, אוניות, מסלולים\n- לגבי מחירים הפנה ל-03-5260090\n- אל תמציא נתונים\n\n' + (knowledge ? 'מידע מהאתר (נסרק ' + scanDate + '):\n' + knowledge : 'טלפון: 03-5260090 | tarbutu.co.il');
}

var SIMPLE = ['שלום','היי','תודה','להתראות','בוקר','ערב','מה שלומך','מי אתה'];
function isSimple(msg) { return SIMPLE.some(function(k){return msg.toLowerCase().includes(k);}) && msg.length < 20; }

// ====== API: צ'אט בוט ======
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
      else if (kbTrips.length > 0 && !siteCache.isScanning) { scanSite(); knowledge = 'המערכת סורקת. לפרטים: 03-5260090'; }
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

// ====== API: שיחות בוט ======
app.get('/api/conversations', function(req, res) {
  var list = Array.from(conversations.values()).map(function(c) {
    return { id: c.id, lastMessage: c.lastMessage || '', agentMode: c.agentMode, chatType: c.chatType || 'sales', messageCount: c.history.length, createdAt: c.createdAt, updatedAt: c.updatedAt };
  });
  res.json(list.sort(function(a,b){return new Date(b.updatedAt)-new Date(a.updatedAt);}));
});
app.get('/api/conversations/:id', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); res.json(c); });
app.post('/api/conversations/:id/takeover', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); c.agentMode=true; c.agentName=req.body.agentName||'נציג'; res.json({success:true}); });
app.post('/api/conversations/:id/agent-message', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); c.history.push({role:'agent',content:req.body.message,agentName:req.body.agentName||'נציג',time:new Date()}); c.agentMessage=req.body.message; c.agentName=req.body.agentName||'נציג'; res.json({success:true}); });
app.post('/api/conversations/:id/release', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.status(404).json({error:'לא נמצא'}); c.agentMode=false; res.json({success:true}); });
app.get('/api/conversations/:id/poll', function(req, res) { var c=conversations.get(req.params.id); if(!c)return res.json({type:'none'}); if(c.agentMessage){var m=c.agentMessage;var n=c.agentName;c.agentMessage=null;return res.json({type:'agent',message:m,agentName:n});} res.json({type:'none'}); });

app.get('/api/cache-status', function(req, res) {
  res.json({ hasCache: !!siteCache.content, lastScanned: siteCache.lastScanned, contentLength: siteCache.content.length, isScanning: siteCache.isScanning, pagesScanned: siteCache.pagesScanned, totalPages: siteCache.totalPages || kbTrips.length, savedToDisk: fs.existsSync(CACHE_FILE), kbCount: kbTrips.length });
});
app.post('/api/scan-now', function(req, res) {
  if (siteCache.isScanning) return res.json({ message: 'סריקה פעילה (' + siteCache.pagesScanned + '/' + siteCache.totalPages + ')' });
  if (!kbTrips.length) return res.json({ message: 'אין קישורים במאגר.' });
  scanSite(); res.json({ message: 'סריקה התחילה!' });
});

app.get('/admin', function(req, res) { var p1=path.join(__dirname,'public','admin.html'); var p2=path.join(__dirname,'admin.html'); res.sendFile(fs.existsSync(p1)?p1:p2); });
app.get('/', function(req, res) { var p1=path.join(__dirname,'public','index.html'); var p2=path.join(__dirname,'index.html'); res.sendFile(fs.existsSync(p1)?p1:p2); });

loadFromDisk();
app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
