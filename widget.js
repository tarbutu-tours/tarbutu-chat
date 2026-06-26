(function() {
  var SERVER = (window.TarbutuChat && window.TarbutuChat.server) ? window.TarbutuChat.server : '';
  var COLOR = (window.TarbutuChat && window.TarbutuChat.color) ? window.TarbutuChat.color : '#1a6fa8';
  var SESSION = 'tc_' + Math.random().toString(36).slice(2) + Date.now();
  var history = [];
  var isOpen = false;
  var pollTimer = null;
  var chatType = null;

  // ===== CSS =====
  var style = document.createElement('style');
  style.textContent = [
    '#tc-fab{position:fixed;bottom:24px;left:24px;width:58px;height:58px;background:'+COLOR+';border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:99999;border:none;transition:transform .2s}',
    '#tc-fab:hover{transform:scale(1.08)}',
    '#tc-fab svg{width:28px;height:28px;fill:#fff}',
    '#tc-badge{position:absolute;top:-3px;right:-3px;background:#e74c3c;color:#fff;border-radius:99px;font-size:11px;padding:2px 6px;font-weight:700;font-family:Arial;display:none}',
    '#tc-window{position:fixed;bottom:90px;left:24px;width:360px;background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.2);z-index:99998;display:none;flex-direction:column;overflow:hidden;font-family:"Segoe UI","Arial Hebrew",Arial,sans-serif;direction:rtl;max-height:560px}',
    '#tc-header{background:'+COLOR+';padding:14px 16px;display:flex;align-items:center;gap:10px;color:#fff;flex-shrink:0}',
    '#tc-avatar{width:38px;height:38px;background:#f0c040;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}',
    '#tc-hname{font-weight:700;font-size:.9rem}#tc-hsub{font-size:11px;opacity:.75}',
    '#tc-online{width:8px;height:8px;background:#4ade80;border-radius:50%;box-shadow:0 0 5px #4ade80;margin-right:auto;flex-shrink:0}',
    '#tc-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px;background:#f8fafc;min-height:280px}',
    '.tc-msg{display:flex;flex-direction:column;gap:2px}',
    '.tc-msg.bot{align-items:flex-end}.tc-msg.user{align-items:flex-start}.tc-msg.agent{align-items:flex-end}',
    '.tc-bbl{max-width:84%;padding:8px 12px;border-radius:13px;font-size:13px;line-height:1.5;word-break:break-word}',
    '.tc-msg.bot .tc-bbl{background:'+COLOR+';color:#fff;border-bottom-left-radius:3px}',
    '.tc-msg.user .tc-bbl{background:#fff;border:1px solid #dee2e6;color:#333;border-bottom-right-radius:3px}',
    '.tc-msg.agent .tc-bbl{background:#e8f8ef;border:1px solid #b0dfc0;color:#1a4a30;border-bottom-left-radius:3px}',
    '.tc-meta{font-size:10px;color:#adb5bd;padding:0 3px}',
    '.tc-sender{font-size:10px;font-weight:600;color:#1a7040;padding:0 3px}',
    '.tc-typing{display:none;align-self:flex-end}',
    '.tc-typing .tc-bbl{display:flex;align-items:center;gap:4px;padding:10px 14px}',
    '.tc-dot{width:6px;height:6px;background:rgba(255,255,255,.7);border-radius:50%;animation:tcb 1.2s infinite}',
    '.tc-dot:nth-child(2){animation-delay:.2s}.tc-dot:nth-child(3){animation-delay:.4s}',
    '@keyframes tcb{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}',
    '#tc-type-select{padding:12px;background:#fff;border-top:1px solid #eee;display:flex;flex-direction:column;gap:8px;flex-shrink:0}',
    '.ts-title{font-size:13px;color:#555;font-weight:600;text-align:center}',
    '.ts-btns{display:flex;gap:8px}',
    '.ts-btn{flex:1;padding:10px;border-radius:10px;border:2px solid #dee2e6;background:#fff;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:4px}',
    '.ts-btn:hover{border-color:'+COLOR+';background:#e8f4fd}',
    '.ts-btn.selected{border-color:'+COLOR+';background:'+COLOR+';color:#fff}',
    '.ts-btn .ts-icon{font-size:22px}.ts-btn .ts-label{font-size:12px;text-align:center}',
    '#tc-input-area{padding:10px 12px;background:#fff;border-top:1px solid #eee;display:flex;gap:7px;align-items:center;flex-shrink:0}',
    '#tc-input{flex:1;border:1.5px solid #dee2e6;border-radius:99px;padding:8px 14px;font-size:13px;outline:none;font-family:inherit;direction:rtl;transition:border-color .2s}',
    '#tc-input:focus{border-color:'+COLOR+'}',
    '#tc-send{background:'+COLOR+';color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px}',
    '#tc-send:hover{opacity:.85}#tc-send:disabled{opacity:.5;cursor:not-allowed}',
    '#tc-agent-notice{background:#e8f8ef;border-top:1px solid #b0dfc0;padding:6px 12px;font-size:12px;color:#1a5e35;display:none;align-items:center;gap:6px;flex-shrink:0}',
    // ===== DISCLAIMER BAR =====
    '#tc-disclaimer{text-align:center;font-size:10px;color:#adb5bd;padding:5px 10px;background:#f8fafc;flex-shrink:0;line-height:1.5;border-top:1px solid #f0f0f0}',
    '#tc-disclaimer a{color:'+COLOR+';text-decoration:underline;cursor:pointer;font-weight:600}',
    // ===== MODAL =====
    '#tc-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999999;display:none;align-items:center;justify-content:center;padding:16px}',
    '#tc-modal-overlay.show{display:flex}',
    '#tc-modal{background:#fff;border-radius:16px;max-width:400px;width:100%;max-height:85vh;overflow-y:auto;direction:rtl;font-family:"Segoe UI","Arial Hebrew",Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3)}',
    '#tc-modal-header{padding:16px 20px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff}',
    '#tc-modal-header h3{font-size:1rem;font-weight:700;color:#343a40}',
    '#tc-modal-close{background:transparent;border:none;font-size:24px;cursor:pointer;color:#adb5bd;line-height:1;padding:0}',
    '#tc-modal-close:hover{color:#343a40}',
    '#tc-modal-body{padding:20px;font-size:13px;line-height:1.75;color:#343a40}',
    '#tc-modal-body h4{font-size:.9rem;font-weight:700;margin:14px 0 6px;color:#1a6fa8}',
    '#tc-modal-body p{margin-bottom:10px}',
    '@media(max-width:480px){#tc-window{width:calc(100vw - 32px);left:16px;bottom:80px}#tc-modal{max-width:100%}}'
  ].join('');
  document.head.appendChild(style);

  // ===== FAB =====
  var fab = document.createElement('button');
  fab.id = 'tc-fab';
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg><span id="tc-badge"></span>';
  document.body.appendChild(fab);

  // ===== CHAT WINDOW =====
  var win = document.createElement('div');
  win.id = 'tc-window';
  win.innerHTML = [
    '<div id="tc-header">',
      '<div id="tc-avatar">🚢</div>',
      '<div><div id="tc-hname">עוזר תרבותו</div><div id="tc-hsub">מופעל על ידי AI</div></div>',
      '<div id="tc-online"></div>',
    '</div>',
    '<div id="tc-messages">',
      '<div class="tc-msg bot"><div class="tc-bbl">שלום! 👋 ברוכים הבאים לתרבותו.<br>כדי שאוכל לעזור לך בצורה הטובה ביותר — במה מדובר?</div><div class="tc-meta">עכשיו</div></div>',
      '<div class="tc-msg bot tc-typing" id="tc-typing"><div class="tc-bbl"><div class="tc-dot"></div><div class="tc-dot"></div><div class="tc-dot"></div></div></div>',
    '</div>',
    '<div id="tc-type-select">',
      '<div class="ts-title">בחר את סוג הפנייה:</div>',
      '<div class="ts-btns">',
        '<button class="ts-btn" onclick="tcSelectType(\'sales\',this)"><span class="ts-icon">🚢</span><span class="ts-label">מכירות<br>חפש טיול</span></button>',
        '<button class="ts-btn" onclick="tcSelectType(\'support\',this)"><span class="ts-icon">🎧</span><span class="ts-label">שירות לקוחות<br>יש לי שאלה</span></button>',
      '</div>',
    '</div>',
    '<div id="tc-agent-notice">👤 נציג אנושי נכנס לשיחה</div>',
    '<div id="tc-input-area" style="display:none">',
      '<input id="tc-input" type="text" placeholder="כתוב שאלה...">',
      '<button id="tc-send">➤</button>',
    '</div>',
    '<div id="tc-disclaimer">הבוט מספק מידע בעזרת AI, יש ללמוד את המידע לפני שימוש בו. <a onclick="tcShowModal()">למד עוד</a></div>'
  ].join('');
  document.body.appendChild(win);

  // ===== MODAL תנאי שימוש =====
  var modalEl = document.createElement('div');
  modalEl.id = 'tc-modal-overlay';
  modalEl.innerHTML = [
    '<div id="tc-modal">',
      '<div id="tc-modal-header">',
        '<h3>תנאי שימוש</h3>',
        '<button id="tc-modal-close" onclick="tcHideModal()">×</button>',
      '</div>',
      '<div id="tc-modal-body">',
        '<h4>לתשומת לבך:</h4>',
        '<p>הבוט הוא מערכת אוטומטית המבוססת על טכנולוגיית בינה מלאכותית, והוא נועד לספק מידע כללי בלבד ולעזור בשאלות בנוגע לשירותים שלנו. המידע המסופק עשוי שלא להיות מלא, מדויק או מעודכן בכל עת. לפיכך, מומלץ שלא להסתמך באופן בלעדי על המידע הניתן בבוט לצורך קבלת החלטות חשובות.</p>',
        '<p>הבוט אינו מיועד להוות תחליף ליעוץ מקצועי, יעוץ פיננסי משפטי או יעוץ רפואי לכל שאלה כזאת, אנא הקשורה לנושאים אלו, אנא פנה לאיש מקצוע מוסמך.</p>',
        '<h4>פרטיות:</h4>',
        '<p>שים לב כי הבוט אינו אוסף מידע אישי כלשהו במהלך השיחות. עם זאת, אנו מבקשים לשמור את השיחה ניטרלית ולא לשתף מידע אישי או פרטים רגישים אחרים.</p>',
        '<h4>אחריות:</h4>',
        '<p>השימוש במערכת זו הוא על אחריות המשתמש בלבד. בכל מקרה של ספק, יש לפנות לנציג מטעמנו לקבלת מידע נוסף ומדויק.</p>',
        '<p style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;color:#6c757d">📞 03-5260090 | tarbutu.co.il</p>',
      '</div>',
    '</div>'
  ].join('');
  document.body.appendChild(modalEl);

  // סגור מודל בלחיצה על הרקע
  modalEl.addEventListener('click', function(e) { if (e.target === modalEl) tcHideModal(); });

  // ===== FUNCTIONS =====
  window.tcShowModal = function() { modalEl.classList.add('show'); };
  window.tcHideModal = function() { modalEl.classList.remove('show'); };

  function now() { return new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}); }
  function scrollDown() { var m=document.getElementById('tc-messages'); m.scrollTop=m.scrollHeight; }
  function setTyping(s) { document.getElementById('tc-typing').style.display=s?'flex':'none'; scrollDown(); }

  function addMsg(role, html, time, senderName) {
    var msgs=document.getElementById('tc-messages');
    var typing=document.getElementById('tc-typing');
    var row=document.createElement('div');
    row.className='tc-msg '+role;
    if(role==='agent'&&senderName){var s=document.createElement('div');s.className='tc-sender';s.textContent=senderName;row.appendChild(s);}
    var b=document.createElement('div');b.className='tc-bbl';
    b.innerHTML=html.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    row.appendChild(b);
    var m=document.createElement('div');m.className='tc-meta';m.textContent=time||now();row.appendChild(m);
    msgs.insertBefore(row,typing);
    scrollDown();
    return row;
  }

  window.tcSelectType = function(type, btn) {
    chatType = type;
    document.querySelectorAll('.ts-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    setTimeout(function(){
      document.getElementById('tc-type-select').style.display='none';
      document.getElementById('tc-input-area').style.display='flex';
      if(type==='sales'){
        addMsg('bot','מצוין! 🚢 אשמח לעזור לך למצוא את הקרוז או הטיול המושלם.\nשאל אותי על יעדים, תאריכים, מסלולים וכל מה שתרצה!');
        document.getElementById('tc-input').placeholder='איזה טיול מעניין אותך?';
      } else {
        addMsg('bot','בשמחה! 🎧 אני כאן לעזור.\nשאל אותי על הזמנה קיימת, ביטולים, שינויים, מסמכים — כל שאלה שיש לך.');
        document.getElementById('tc-input').placeholder='במה אוכל לעזור לך?';
      }
      document.getElementById('tc-input').focus();
    }, 400);
  };

  async function send() {
    var inp=document.getElementById('tc-input');
    var snd=document.getElementById('tc-send');
    var txt=inp.value.trim();
    if(!txt) return;
    inp.value='';snd.disabled=true;
    addMsg('user',txt);
    setTyping(true);
    try {
      var r=await fetch(SERVER+'/api/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sessionId:SESSION,message:txt,history:history,chatType:chatType})
      });
      var d=await r.json();
      setTyping(false);
      if(d.message){
        history.push({role:'user',content:txt});
        history.push({role:'assistant',content:d.message});
        addMsg('bot',d.message);
      }
      if(d.type==='waiting') addMsg('bot','⏳ נציג אנושי יענה לך בהקדם...');
    } catch(e){
      setTyping(false);
      addMsg('bot','⚠️ שגיאת חיבור — נסה שוב.');
    }
    snd.disabled=false;inp.focus();
  }

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer=setInterval(async function(){
      try{
        var r=await fetch(SERVER+'/api/conversations/'+SESSION+'/poll');
        var d=await r.json();
        if(d.type==='agent'){
          document.getElementById('tc-agent-notice').style.display='flex';
          addMsg('agent',d.message,now(),d.agentName||'נציג');
          if(!isOpen){var b=document.getElementById('tc-badge');b.style.display='block';b.textContent='1';}
        }
      }catch(e){}
    },4000);
  }

  fab.addEventListener('click',function(){
    isOpen=!isOpen;
    win.style.display=isOpen?'flex':'none';
    document.getElementById('tc-badge').style.display='none';
    if(isOpen){scrollDown();startPolling();}
    else clearInterval(pollTimer);
  });
  document.getElementById('tc-send').addEventListener('click',send);
  document.getElementById('tc-input').addEventListener('keydown',function(e){if(e.key==='Enter')send();});
})();
