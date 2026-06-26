// ============================================================
// תרבותו Chat Widget — הטמע באתר WordPress
// הוסף לפני </body>:
// <script src="https://YOUR-RAILWAY-URL/widget.js"></script>
// ============================================================
(function() {
  const SERVER_URL = window.TarbutuChat?.server || '';
  const COLOR = window.TarbutuChat?.color || '#1a6fa8';
  const SESSION_ID = 'tc_' + Math.random().toString(36).slice(2) + Date.now();
  let history = [];
  let isOpen = false;
  let pollTimer = null;

  // ---- CSS ----
  const style = document.createElement('style');
  style.textContent = `
    #tc-fab{position:fixed;bottom:24px;left:24px;width:58px;height:58px;background:${COLOR};border-radius:50%;
      display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);
      z-index:99999;border:none;transition:transform .2s}
    #tc-fab:hover{transform:scale(1.08)}
    #tc-fab svg{width:28px;height:28px;fill:#fff}
    #tc-badge{position:absolute;top:-3px;right:-3px;background:#e74c3c;color:#fff;border-radius:99px;
      font-size:11px;padding:2px 6px;font-weight:700;font-family:Arial;display:none}
    #tc-window{position:fixed;bottom:90px;left:24px;width:360px;background:#fff;border-radius:18px;
      box-shadow:0 12px 40px rgba(0,0,0,.2);z-index:99998;display:none;flex-direction:column;
      overflow:hidden;font-family:'Segoe UI','Arial Hebrew',Arial,sans-serif;direction:rtl;
      max-height:520px}
    #tc-header{background:${COLOR};padding:14px 16px;display:flex;align-items:center;gap:10px;color:#fff;flex-shrink:0}
    #tc-avatar{width:38px;height:38px;background:#f0c040;border-radius:50%;display:flex;align-items:center;
      justify-content:center;font-size:18px;flex-shrink:0}
    #tc-hname{font-weight:700;font-size:.9rem}
    #tc-hsub{font-size:11px;opacity:.75}
    #tc-online{width:8px;height:8px;background:#4ade80;border-radius:50%;box-shadow:0 0 5px #4ade80;margin-right:auto;flex-shrink:0}
    #tc-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px;background:#f8fafc;min-height:280px}
    .tc-msg{display:flex;flex-direction:column;gap:2px}
    .tc-msg.bot{align-items:flex-end}.tc-msg.user{align-items:flex-start}.tc-msg.agent{align-items:flex-end}
    .tc-bbl{max-width:84%;padding:8px 12px;border-radius:13px;font-size:13px;line-height:1.5;word-break:break-word}
    .tc-msg.bot .tc-bbl{background:${COLOR};color:#fff;border-bottom-left-radius:3px}
    .tc-msg.user .tc-bbl{background:#fff;border:1px solid #dee2e6;color:#333;border-bottom-right-radius:3px}
    .tc-msg.agent .tc-bbl{background:#e8f8ef;border:1px solid #b0dfc0;color:#1a4a30;border-bottom-left-radius:3px}
    .tc-meta{font-size:10px;color:#adb5bd;padding:0 3px}
    .tc-sender{font-size:10px;font-weight:600;color:#1a7040;padding:0 3px}
    .tc-typing{display:none;align-self:flex-end}
    .tc-typing .tc-bbl{display:flex;align-items:center;gap:4px;padding:10px 14px}
    .tc-dot{width:6px;height:6px;background:rgba(255,255,255,.7);border-radius:50%;animation:tcb 1.2s infinite}
    .tc-dot:nth-child(2){animation-delay:.2s}.tc-dot:nth-child(3){animation-delay:.4s}
    @keyframes tcb{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
    #tc-input-area{padding:10px 12px;background:#fff;border-top:1px solid #eee;display:flex;gap:7px;align-items:center;flex-shrink:0}
    #tc-input{flex:1;border:1.5px solid #dee2e6;border-radius:99px;padding:8px 14px;font-size:13px;
      outline:none;font-family:inherit;direction:rtl;transition:border-color .2s}
    #tc-input:focus{border-color:${COLOR}}
    #tc-send{background:${COLOR};color:#fff;border:none;border-radius:50%;width:36px;height:36px;
      cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px}
    #tc-send:hover{opacity:.85}
    #tc-agent-notice{background:#e8f8ef;border-top:1px solid #b0dfc0;padding:6px 12px;font-size:12px;
      color:#1a5e35;display:none;align-items:center;gap:6px;flex-shrink:0}
    #tc-powered{text-align:center;font-size:10px;color:#adb5bd;padding:4px;background:#f8fafc;flex-shrink:0}
    @media(max-width:480px){#tc-window{width:calc(100vw - 32px);left:16px;bottom:80px}}
  `;
  document.head.appendChild(style);

  // ---- HTML ----
  const fab = document.createElement('button');
  fab.id = 'tc-fab';
  fab.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
  </svg><span id="tc-badge"></span>`;
  document.body.appendChild(fab);

  const win = document.createElement('div');
  win.id = 'tc-window';
  win.innerHTML = `
    <div id="tc-header">
      <div id="tc-avatar">🚢</div>
      <div><div id="tc-hname">עוזר תרבותו</div><div id="tc-hsub">מופעל על ידי AI</div></div>
      <div id="tc-online"></div>
    </div>
    <div id="tc-messages">
      <div class="tc-msg bot">
        <div class="tc-bbl">שלום! 👋 אני העוזר החכם של <strong>תרבותו</strong>.<br>שאל אותי על קרוזים, טיולים, תאריכים ועוד!</div>
        <div class="tc-meta">עכשיו</div>
      </div>
      <div class="tc-msg bot tc-typing" id="tc-typing">
        <div class="tc-bbl"><div class="tc-dot"></div><div class="tc-dot"></div><div class="tc-dot"></div></div>
      </div>
    </div>
    <div id="tc-agent-notice">👤 נציג אנושי נכנס לשיחה</div>
    <div id="tc-input-area">
      <input id="tc-input" type="text" placeholder="שאל שאלה...">
      <button id="tc-send">➤</button>
    </div>
    <div id="tc-powered">Powered by Tarbutu AI</div>
  `;
  document.body.appendChild(win);

  // ---- Functions ----
  function now() { return new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}); }
  function scrollDown() { const m=document.getElementById('tc-messages'); m.scrollTop=m.scrollHeight; }
  function setTyping(s) { document.getElementById('tc-typing').style.display=s?'flex':'none'; scrollDown(); }

  function addMsg(role, html, time, senderName) {
    const msgs = document.getElementById('tc-messages');
    const typing = document.getElementById('tc-typing');
    const row = document.createElement('div');
    row.className = 'tc-msg ' + role;
    if (role==='agent' && senderName) {
      const s=document.createElement('div');s.className='tc-sender';s.textContent=senderName;row.appendChild(s);
    }
    const b=document.createElement('div');b.className='tc-bbl';
    b.innerHTML=html.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    row.appendChild(b);
    const m=document.createElement('div');m.className='tc-meta';m.textContent=time||now();row.appendChild(m);
    msgs.insertBefore(row, typing);
    scrollDown();
  }

  async function send() {
    const inp = document.getElementById('tc-input');
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = '';
    addMsg('user', txt);
    setTyping(true);
    try {
      const res = await fetch(SERVER_URL + '/api/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sessionId: SESSION_ID, message: txt, history })
      });
      const data = await res.json();
      setTyping(false);
      if (data.type === 'bot') {
        history.push({role:'user',content:txt});
        history.push({role:'assistant',content:data.message});
        addMsg('bot', data.message);
      } else if (data.type === 'waiting') {
        addMsg('bot', '⏳ נציג אנושי יענה לך בהקדם...');
      }
    } catch(e) {
      setTyping(false);
      addMsg('bot', '⚠️ שגיאת חיבור — נסה שוב.');
    }
  }

  // Polling לנציג
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch(SERVER_URL + '/api/conversations/' + SESSION_ID + '/poll');
        const d = await r.json();
        if (d.type === 'agent') {
          document.getElementById('tc-agent-notice').style.display = 'flex';
          addMsg('agent', d.message, now(), d.agentName || 'נציג');
          showBadge();
        }
      } catch(e) {}
    }, 4000);
  }

  function showBadge() {
    const b = document.getElementById('tc-badge');
    if (!isOpen) { b.style.display='block'; b.textContent='1'; }
  }

  // Toggle
  fab.addEventListener('click', () => {
    isOpen = !isOpen;
    win.style.display = isOpen ? 'flex' : 'none';
    document.getElementById('tc-badge').style.display = 'none';
    if (isOpen) { scrollDown(); document.getElementById('tc-input').focus(); startPolling(); }
    else clearInterval(pollTimer);
  });

  document.getElementById('tc-send').addEventListener('click', send);
  document.getElementById('tc-input').addEventListener('keydown', e => { if(e.key==='Enter') send(); });
})();
