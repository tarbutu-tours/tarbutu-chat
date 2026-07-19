// Tarbutu WhatsApp Widget
(function() {
  // צבעים וסגנון
  const COLORS = {
    primary: '#1a6fa8',
    success: '#25d366',
    white: '#fff',
    gray: '#f0f4f8',
    border: '#dee2e6'
  };

  // יצירת HTML
  const widgetHTML = `
    <div id="tarbutu-widget-container">
      <!-- כפתור ירוק -->
      <button id="tarbutu-chat-button" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: ${COLORS.success};
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        font-size: 24px;
      ">
        💬
      </button>

      <!-- Popup -->
      <div id="tarbutu-popup" style="
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 320px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        z-index: 9998;
        display: none;
        direction: rtl;
      ">
        <!-- Header -->
        <div style="
          background: ${COLORS.primary};
          color: white;
          padding: 16px;
          border-radius: 12px 12px 0 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <h3 style="margin: 0; font-size: 16px;">ברוכים הבאים לתרבותו 👋</h3>
          <button id="tarbutu-close-popup" style="
            background: transparent;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
          ">×</button>
        </div>

        <!-- Body -->
        <div style="padding: 16px; text-align: center;">
          <p style="
            margin: 0 0 12px 0;
            font-size: 14px;
            color: #555;
            line-height: 1.5;
          ">
            שלום! 👋<br>
            אנחנו כאן כדי לעזור לך.<br>
            <strong>מה אוכל לעשות עבורך?</strong>
          </p>

          <!-- WhatsApp Button -->
          <button id="tarbutu-whatsapp-button" style="
            width: 100%;
            padding: 12px;
            background: ${COLORS.success};
            border: none;
            border-radius: 8px;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-family: inherit;
          ">
            <span style="font-size: 18px;">💬</span>
            התחל שיחה ב-WhatsApp
          </button>

          <p style="
            margin: 8px 0 0 0;
            font-size: 11px;
            color: #999;
          ">
            Powered by Tarbutu AI
          </p>
        </div>
      </div>
    </div>
  `;

  // טען HTML כשהעמוד טוען
  document.addEventListener('DOMContentLoaded', function() {
    document.body.insertAdjacentHTML('beforeend', widgetHTML);
    
    const chatButton = document.getElementById('tarbutu-chat-button');
    const popup = document.getElementById('tarbutu-popup');
    const closeButton = document.getElementById('tarbutu-close-popup');
    const whatsappButton = document.getElementById('tarbutu-whatsapp-button');

    // פתח/סגור popup
    chatButton.addEventListener('click', () => {
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });

    closeButton.addEventListener('click', () => {
      popup.style.display = 'none';
    });

    // כשלוחצים על כפתור WhatsApp
    whatsappButton.addEventListener('click', async () => {
      // קבל מספר טלפון (אפשר להוסיף input אם צריך)
      const phoneNumber = '972523661744'; // מספר ברירת מחדל
      
      try {
        // שלח בקשה לשרת - שיגיד לשלוח הודעות
        const response = await fetch('https://tarbutu-chat-production.up.railway.app/api/widget/start-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phoneNumber })
        });

        if (response.ok) {
          console.log('✅ הודעות יישלחו בעוד רגעים');
          // פתח WhatsApp
          window.open('https://wa.me/972523661744', '_blank');
          // סגור popup
          popup.style.display = 'none';
        } else {
          alert('שגיאה - נסה שוב');
        }
      } catch (err) {
        console.error('Error:', err);
        alert('שגיאת חיבור');
      }
    });
  });
})();
