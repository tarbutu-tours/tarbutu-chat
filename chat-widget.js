// ═══════════════════════════════════════════════
//  תרבותו — צ'אט באתר
//  הטמעה: <script src="chat-widget.js"></script>
// ═══════════════════════════════════════════════

(function () {
  const API = 'https://tarbutu-chat-production.up.railway.app';

  // מקור ההגעה — נתפס פעם אחת ונשמר, כי הפרמטרים נעלמים מהכתובת בניווט הבא.
  // נשמר רק שם הקמפיין והמקור, לצורך ספירה. אין כאן שום מידע אישי.
  const TRAFFIC = (function () {
    try {
      const saved = sessionStorage.getItem('tarbutu_src');
      if (saved) return JSON.parse(saved);

      const q = new URLSearchParams(location.search);
      const src = {
        source:   q.get('utm_source')   || null,
        medium:   q.get('utm_medium')   || null,
        campaign: q.get('utm_campaign') || null,
        term:     q.get('utm_term')     || null,
        gclid:    q.get('gclid')        || null,
        landing:  location.pathname || null,
        referrer: document.referrer ? new URL(document.referrer).hostname : null,
      };

      // זיהוי מקור גם בלי פרמטרים, לפי מאיפה הגיע
      if (!src.source && src.referrer) {
        if (/google\./.test(src.referrer))   src.source = 'google-organic';
        else if (/facebook|instagram/.test(src.referrer)) src.source = 'facebook';
        else if (!/tarbutu/.test(src.referrer)) src.source = src.referrer;
      }
      if (!src.source && !src.referrer) src.source = 'direct';
      if (src.gclid && !src.medium) src.medium = 'cpc';

      sessionStorage.setItem('tarbutu_src', JSON.stringify(src));
      return src;
    } catch (e) { return {}; }
  })();

  // מזהה שיחה נשמר לאורך הגלישה — רענון עמוד לא מאבד את ההקשר.
  // נמחק כשהלקוח סוגר את הטאב.
  const SESSION_KEY = (function () {
    try {
      let s = sessionStorage.getItem('tarbutu_session');
      if (!s) {
        s = 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem('tarbutu_session', s);
      }
      return s;
    } catch (e) {
      return 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }
  })();

  // ── עיצוב ──────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #tb-chat-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; }
    #tb-chat-root {
      position: fixed;
      /* מעל כפתור הוואטסאפ שיושב ב-bottom:24px בגובה ~56px */
      bottom: 96px;
      right: 24px;
      z-index: 99999;
      direction: rtl;
    }

    /* ── חלון צ'אט ── */
    #tb-window {
      position: relative;   /* עוגן לחלון הפרטיות */
      width: 360px;
      height: 520px;
      /* לא יחרוג מהמסך בלפטופים נמוכים */
      max-height: calc(100vh - 120px);
      background: #fff;
      border-radius: 18px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(.4,0,.2,1);
      transform-origin: bottom left;
    }
    #tb-window.tb-hidden {
      opacity: 0;
      transform: scale(0.85) translateY(20px);
      pointer-events: none;
    }

    /* ── Header ── */
    #tb-header {
      background: linear-gradient(135deg, #1a6fa8 0%, #0e4e7a 100%);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #tb-avatar {
      width: 42px; height: 42px;
      background: rgba(255,255,255,0.15);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    #tb-header-info { flex: 1; }
    #tb-header-name {
      color: #fff;
      font-weight: 700;
      font-size: 14px;
    }
    #tb-header-status {
      color: rgba(255,255,255,0.75);
      font-size: 11px;
      margin-top: 1px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    #tb-status-dot {
      width: 7px; height: 7px;
      background: #4ade80;
      border-radius: 50%;
      animation: tb-pulse 2s infinite;
    }
    @keyframes tb-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    #tb-close-btn {
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      width: 28px; height: 28px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    #tb-close-btn:hover { background: rgba(255,255,255,0.25); }

    /* ── הודעות ── */
    #tb-msgs {
      flex: 1;
      overflow-y: auto;
      padding: 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f0f4f8;
      scroll-behavior: smooth;
    }
    #tb-msgs::-webkit-scrollbar { width: 4px; }
    #tb-msgs::-webkit-scrollbar-thumb { background: #dee2e6; border-radius: 99px; }

    .tb-msg { display: flex; flex-direction: column; }
    /* בעברית: הבוט מימין, הלקוח משמאל — כמו בוואטסאפ */
    .tb-msg.tb-bot { align-items: flex-start; }
    .tb-msg.tb-user { align-items: flex-end; }

    .tb-bbl {
      max-width: 82%;
      padding: 9px 13px;
      border-radius: 14px;
      font-size: 13px;
      /* גופן אמוג'י ייעודי — בגודל גדול יותר מהטקסט, כי ברירת המחדל קטנה מדי */
      font-family: 'Segoe UI', Arial, 'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI Emoji', sans-serif;
      line-height: 1.55;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .tb-msg.tb-bot .tb-bbl {
      background: #fff;
      color: #222;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .tb-msg.tb-user .tb-bbl {
      background: #1a6fa8;
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .tb-time {
      font-size: 10px;
      color: #adb5bd;
      margin-top: 3px;
      padding: 0 4px;
    }

    /* ── Typing ── */
    #tb-typing {
      display: none;
      align-items: flex-end;
    }
    #tb-typing.tb-show { display: flex; }
    #tb-typing-bbl {
      background: #fff;
      border-radius: 14px;
      border-bottom-right-radius: 4px;
      padding: 10px 14px;
      display: flex;
      gap: 4px;
      align-items: center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .tb-dot {
      width: 7px; height: 7px;
      background: #adb5bd;
      border-radius: 50%;
      animation: tb-bounce 1.2s infinite;
    }
    .tb-dot:nth-child(2) { animation-delay: 0.2s; }
    .tb-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes tb-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }

    /* ── Input ── */
    /* כפתורי בחירה — שלושת השלבים הראשונים */
    .tb-opts { display: flex; flex-direction: column; gap: 7px; margin: 2px 0 6px; align-items: flex-start; }
    .tb-opt {
      background: #fff;
      border: 1.5px solid #1a6fa8;
      color: #1a6fa8;
      padding: 10px 16px;
      border-radius: 18px;
      font-size: 13.5px;
      font-family: inherit;
      cursor: pointer;
      text-align: right;
      max-width: 88%;
      transition: background .15s, color .15s;
    }
    .tb-opt:hover { background: #1a6fa8; color: #fff; }
    .tb-opt:active { transform: scale(.98); }

    #tb-input-area {
      padding: 10px 12px;
      background: #fff;
      border-top: 1px solid #dee2e6;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
    }
    #tb-input {
      flex: 1;
      border: 1.5px solid #dee2e6;
      border-radius: 22px;
      padding: 9px 14px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
      direction: rtl;
      resize: none;
      min-height: 40px;
      max-height: 90px;
      line-height: 1.4;
      transition: border-color 0.2s;
      background: #f8f9fa;
    }
    #tb-input:focus { border-color: #1a6fa8; background: #fff; }
    #tb-input::placeholder { color: #adb5bd; }
    #tb-send {
      width: 38px; height: 38px;
      background: #1a6fa8;
      border: none;
      border-radius: 50%;
      color: #fff;
      font-size: 15px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    #tb-send:hover { background: #0e4e7a; transform: scale(1.05); }
    #tb-send:disabled { background: #dee2e6; cursor: not-allowed; transform: none; }

    /* ── כפתור פתיחה ── */
    #tb-toggle {
      display: none;
      width: 56px; height: 56px;
      background: linear-gradient(135deg, #1a6fa8, #0e4e7a);
      border: none;
      border-radius: 50%;
      color: #fff;
      font-size: 24px;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(26,111,168,0.4);
      align-items: center;
      justify-content: center;
      margin-top: 10px;
      transition: all 0.2s;
    }
    #tb-toggle:hover { transform: scale(1.08); }
    #tb-toggle.tb-show { display: flex; }
    #tb-notif {
      position: absolute;
      top: 0; right: 0;
      width: 18px; height: 18px;
      background: #e74c3c;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      display: none;
      align-items: center;
      justify-content: center;
    }
    #tb-notif.tb-show { display: flex; }

    /* ── Powered by ── */
    #tb-footer {
      text-align: center;
      font-size: 10px;
      color: #adb5bd;
      padding: 5px 8px 7px;
      flex-shrink: 0;
      background: #fff;
      line-height: 1.5;
    }
    #tb-disclaimer {
      color: #8c959d;
      font-size: 9.5px;
    }
    #tb-privacy-link {
      color: #1a6fa8;
      text-decoration: underline;
      cursor: pointer;
    }
    /* חלון הפרטיות */
    #tb-privacy {
      position: absolute;
      inset: 0;
      background: #fff;
      z-index: 20;
      display: none;
      flex-direction: column;
      padding: 16px 18px;
      overflow-y: auto;
      text-align: right;
    }
    #tb-privacy.tb-open { display: flex; }
    #tb-privacy h4 { font-size: 14px; color: #0d4f6c; margin-bottom: 8px; }
    #tb-privacy p { font-size: 12px; color: #495057; line-height: 1.75; margin-bottom: 8px; }
    .tb-emo { font-size: 1.45em; line-height: 1; vertical-align: -0.12em; }
    #tb-privacy button {
      margin-top: 8px;
      align-self: flex-start;
      background: #1a6fa8;
      color: #fff;
      border: 0;
      padding: 7px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }

    @media (max-width: 420px) {
      #tb-window { width: 100vw; height: 100vh; border-radius: 0; bottom: 0; right: 0; position: fixed; }
      #tb-chat-root { bottom: 74px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── HTML ────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'tb-chat-root';
  root.innerHTML = `
    <div id="tb-window" class="tb-hidden">
      <div id="tb-header">
        <div id="tb-avatar">🚢</div>
        <div id="tb-header-info">
          <div id="tb-header-name">עוזר תרבותו</div>
          <div id="tb-header-status">
            <div id="tb-status-dot"></div>
            <span id="tb-status-text">זמין לעזור</span>
          </div>
        </div>
        <button id="tb-close-btn" title="מזעור">✕</button>
      </div>

      <div id="tb-msgs">
        <div class="tb-msg tb-bot">
          <div class="tb-bbl">ברוכים הבאים לתרבותו! איך אפשר לעזור?</div>
          <div class="tb-time">עכשיו</div>
        </div>
      </div>

      <div class="tb-msg tb-bot" id="tb-typing" style="padding: 0 12px 8px;">
        <div id="tb-typing-bbl">
          <div class="tb-dot"></div>
          <div class="tb-dot"></div>
          <div class="tb-dot"></div>
        </div>
      </div>

      <div id="tb-input-area">
        <textarea id="tb-input" placeholder="כתוב הודעה..." rows="1"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,90)+'px'"></textarea>
        <button id="tb-send">➤</button>
      </div>
      <div id="tb-footer">
        <div id="tb-disclaimer">🤖 עוזר AI — התשובות עשויות להיות לא מדויקות. לפרטים מחייבים פנו לנציג.</div>
        <span id="tb-privacy-link">פרטיות ותנאי שימוש</span>
      </div>

      <div id="tb-privacy">
        <h4>פרטיות ותנאי שימוש</h4>
        <p><strong>זהו עוזר אוטומטי (AI).</strong> התשובות נוצרות אוטומטית ועשויות להיות לא מדויקות או לא מעודכנות. מחירים, זמינות ופרטי הזמנה מחייבים — יש לאמת מול נציג.</p>
        <p><strong>איזה מידע נשמר.</strong> תוכן השיחה נשמר במערכות תרבותו. אם תמסור שם וטלפון, הם יישמרו לצורך חזרה אליך ומתן שירות.</p>
        <p><strong>למה זה משמש.</strong> המידע משמש למענה לפנייתך ולשיפור השירות בלבד, ואינו נמכר לצדדים שלישיים.</p>
        <p><strong>מה לא לשלוח כאן.</strong> אין למסור בצ'אט פרטי אשראי, מספרי דרכון או מידע רפואי. לנושאים אלה — פנו ישירות לנציג.</p>
        <p>לשאלות בנושא המידע שנשמר עליך, ניתן לפנות אלינו בכל עת.</p>
        <button id="tb-privacy-close">הבנתי, חזרה לשיחה</button>
      </div>
    </div>

    <button id="tb-toggle" class="tb-show" title="פתח צ'אט">
      💬
      <span id="tb-notif"></span>
    </button>
  `;
  document.body.appendChild(root);

  // ── State ───────────────────────────────────────
  let history = [];
  let isTyping = false;
  let unread = 0;
  let isOpen = false;   // החלון נטען סגור — הכפתור גלוי עד שלוחצים או עד הפתיחה האוטומטית

  const win    = document.getElementById('tb-window');
  const msgs   = document.getElementById('tb-msgs');
  const input  = document.getElementById('tb-input');
  const sendBtn= document.getElementById('tb-send');
  const typing = document.getElementById('tb-typing');
  const toggle = document.getElementById('tb-toggle');
  const notif  = document.getElementById('tb-notif');
  const statusTxt = document.getElementById('tb-status-text');

  // ── פונקציות עזר ──────────────────────────────
  function nowTime() {
    return new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  // מגדיל אמוג'ים ומנטרל HTML שהוזרק בטקסט
  function formatBubble(text) {
    var safe = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // עוטף כל אמוג'י כדי להציג אותו גדול יותר
    safe = safe.replace(
      /(\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*)/gu,
      '<span class="tb-emo">$1</span>'
    );
    return safe.replace(/\n/g, '<br>');
  }

  function appendMsg(role, text) {
    const div = document.createElement('div');
    div.className = 'tb-msg ' + (role === 'user' ? 'tb-user' : 'tb-bot');
    div.innerHTML = `<div class="tb-bbl">${formatBubble(text)}</div><div class="tb-time">${nowTime()}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    if (role === 'bot' && !isOpen) {
      unread++;
      notif.textContent = unread;
      notif.classList.add('tb-show');
    }
  }

  function setTyping(show) {
    isTyping = show;
    typing.classList.toggle('tb-show', show);
    sendBtn.disabled = show;
    statusTxt.textContent = show ? 'מקליד...' : 'זמין לעזור';
    if (show) msgs.scrollTop = msgs.scrollHeight;
  }

  // ── מענה נציג ──────────────────────────────────
  // כשנציג משתלט, הבוט שותק. הווידג'ט בודק כל 5 שניות אם הנציג ענה.
  var agentPoll = null;
  var seenAgentMsgs = 0;

  function startAgentPolling() {
    if (agentPoll) return;
    agentPoll = setInterval(async function () {
      try {
        const r = await fetch(API + '/api/conversations/' + encodeURIComponent(SESSION_KEY) + '/messages');
        if (!r.ok) return;
        const d = await r.json();
        const agentMsgs = (d.messages || []).filter(m => m.role === 'agent' || m.role === 'system');
        if (agentMsgs.length > seenAgentMsgs) {
          agentMsgs.slice(seenAgentMsgs).forEach(function (m) {
            appendMsg('bot', m.role === 'system' ? m.content : m.content);
            history.push({ role: 'assistant', content: m.content });
          });
          seenAgentMsgs = agentMsgs.length;
        }
        if (d.agent_takeover === false) { clearInterval(agentPoll); agentPoll = null; }
      } catch (e) {}
    }, 5000);
  }

  // ── שלבי הכפתורים ──────────────────────────────
  // שלושת השלבים הראשונים נבחרים בלחיצה. אחריהם — מלל חופשי.
  const CRUISE_DESTS = [
    'יפן והמזרח הרחוק', 'אוסטרליה וניו זילנד', 'הים התיכון', 'האיים הקנריים',
    'פיורדים, איסלנד והצפון', 'הים הבלטי', 'דרום אמריקה',
    'האיים הבריטיים', 'ניו אינגלנד ומזרח קנדה', 'האוקיינוס ההודי'
  ];
  const RIVER_DESTS = [
    'הריין', 'הדנובה', 'הרון והסון', 'הדורדון', 'הסיין', 'הדאורו'
  ];

  let stage = 'track';   // track → type → dest → free
  // הבחירות נשמרות כערכים מפורשים ונשלחות לשרת — עדיף על ניחוש מהטקסט
  var choice = { track: null, category: null, destination: null };

  function showOptions(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'tb-opts';
    opts.forEach(function (label) {
      const b = document.createElement('button');
      b.className = 'tb-opt';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', function () { chooseOption(label, wrap); });
      wrap.appendChild(b);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function clearOptions() {
    msgs.querySelectorAll('.tb-opts').forEach(function (el) { el.remove(); });
  }

  function chooseOption(label, wrap) {
    if (wrap) wrap.remove();
    clearOptions();

    // הבחירה נשארת על המסך כהודעה של הלקוח
    appendMsg('user', label);
    history.push({ role: 'user', content: label });

    if (stage === 'track') {
      if (label.indexOf('הזמנתי') !== -1) {
        choice.track = 'service';
        stage = 'free';
        input.placeholder = 'איך אפשר לעזור?';
        botSay('בשמחה. ספר לי בקצרה במה מדובר, ואשתדל לעזור.');
      } else {
        choice.track = 'sales';
        stage = 'type';
        botSay('נהדר! מה מעניין אותך?');
        setTimeout(function () { showOptions(['🚢 קרוז בים', '🛶 שייט נהרות באירופה']); }, 350);
      }
      return;
    }

    if (stage === 'type') {
      stage = 'dest';
      const isRiver = label.indexOf('נהרות') !== -1;
      choice.category = isRiver ? 'river' : 'cruise';
      botSay('לאיזה יעד?');
      setTimeout(function () { showOptions(isRiver ? RIVER_DESTS : CRUISE_DESTS); }, 350);
      return;
    }

    if (stage === 'dest') {
      choice.destination = label;
      stage = 'free';
      input.placeholder = 'כתוב הודעה...';
      sendToBot(label);   // מכאן הבוט מציג את הטיולים של היעד
      return;
    }
  }

  function botSay(text) {
    appendMsg('bot', text);
    history.push({ role: 'assistant', content: text });
  }

  // ── שליחת הודעה ────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (!text || isTyping) return;
    input.value = '';
    input.style.height = 'auto';
    clearOptions();

    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    await sendToBot(text, true);
  }

  // שולח לשרת. skipEcho=true כשההודעה כבר הוצגה על המסך.
  async function sendToBot(text, skipEcho) {
    if (!skipEcho) {
      history.push({ role: 'user', content: text });
    }
    setTyping(true);
    try {
      const r = await fetch(API + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: SESSION_KEY,
          choice: choice,
          traffic: TRAFFIC,
          history: history.slice(-20),
          chatType: stage === 'free' ? 'auto' : 'sales',
        }),
      });
      const d = await r.json();

      if (!r.ok || (!d.reply && !d.message)) {
        // הלקוח רואה הודעה מנומסת. הסיבה האמיתית נרשמת בקונסול לאבחון.
        console.error('[Tarbutu Chat] שגיאת שרת:', r.status, d.detail || d.error || d);
        setTyping(false);
        appendMsg('bot', 'מצטער, יש תקלה רגעית. אפשר לנסות שוב, או לפנות אלינו בוואטסאפ ונחזור אליך.');
        return;
      }

      setTyping(false);

      // נציג השתלט על השיחה — אין תשובת בוט, מתחילים להאזין לתשובות שלו
      if (d.agentHandling) {
        if (!agentPoll) {
          appendMsg('bot', 'נציג שלנו הצטרף לשיחה ויענה לך כאן 👤');
          startAgentPolling();
        }
        return;
      }

      const reply = d.reply || d.message;
      history.push({ role: 'assistant', content: reply });
      appendMsg('bot', reply);
    } catch (e) {
      console.error('[Tarbutu Chat] שגיאת חיבור:', e);
      setTyping(false);
      appendMsg('bot', 'מצטער, אירעה שגיאת חיבור. נסה שוב בעוד רגע.');
    }
  }

  // ── פתיחה/סגירה ────────────────────────────────
  function openChat() {
    isOpen = true;
    win.classList.remove('tb-hidden');
    toggle.classList.remove('tb-show');
    unread = 0;
    notif.classList.remove('tb-show');
    setTimeout(() => input.focus(), 300);


  }

  function closeChat() {
    isOpen = false;
    win.classList.add('tb-hidden');
    toggle.classList.add('tb-show');
    try { sessionStorage.setItem('tarbutu_closed', '1'); } catch (e) {}
  }

  // ── Events ─────────────────────────────────────
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  // כפתורי הפתיחה מוצגים מיד עם הודעת הפתיחה — לא תלוי בפתיחת החלון
  if (stage === 'track') {
    showOptions(['🚢 מתכנן הפלגה חדשה', '💬 יש לי שאלה על טיול שהזמנתי']);
  }

  // פתיחה אוטומטית אחרי 5 שניות — בדסקטופ בלבד.
  // לא נפתח שוב אם הגולש כבר סגר, ולא במובייל (שם זה מכסה את כל המסך).
  (function autoOpen() {
    var isMobile = window.matchMedia('(max-width: 767px)').matches
                || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile) return;

    try { if (sessionStorage.getItem('tarbutu_closed')) return; } catch (e) {}

    setTimeout(function () {
      var alreadyClosed = false;
      try { alreadyClosed = !!sessionStorage.getItem('tarbutu_closed'); } catch (e) {}
      if (!isOpen && !alreadyClosed) openChat();
    }, 5000);
  })();

  // חלון פרטיות
  var privacyPanel = document.getElementById('tb-privacy');
  document.getElementById('tb-privacy-link').addEventListener('click', function () {
    privacyPanel.classList.add('tb-open');
  });
  document.getElementById('tb-privacy-close').addEventListener('click', function () {
    privacyPanel.classList.remove('tb-open');
  });

  document.getElementById('tb-close-btn').addEventListener('click', closeChat);
  toggle.addEventListener('click', openChat);
})();
