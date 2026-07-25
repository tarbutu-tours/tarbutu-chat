// Tarbutu WhatsApp Widget
(function() {
  const COLORS = {
    primary: '#1a6fa8',
    success: '#25d366',
    white: '#fff',
  };

  const whatsappIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
  </svg>`;

  // CSS - מחשב vs מובייל
  const style = document.createElement('style');
  style.textContent = `
    #tarbutu-chat-button {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 14px 22px;
      border-radius: 50px;
      background: #25d366;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(37,211,102,0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      z-index: 9999;
      font-size: 16px;
      font-weight: 700;
      color: white;
      font-family: Arial, sans-serif;
      direction: rtl;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #tarbutu-chat-button:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(37,211,102,0.5);
    }
    #tarbutu-btn-text {
      display: inline;
    }
    /* מובייל — עיגול קטן בלבד */
    @media (max-width: 768px) {
      #tarbutu-chat-button {
        padding: 0;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        bottom: 16px;
        right: 16px;
      }
      #tarbutu-btn-text {
        display: none;
      }
    }
  `;
  document.head.appendChild(style);

  const widgetHTML = `
    <div id="tarbutu-widget-container">
      <button id="tarbutu-chat-button">
        ${whatsappIcon}
        <span id="tarbutu-btn-text">וואטסאפ למשרד</span>
      </button>

      <!-- Popup -->
      <div id="tarbutu-popup" style="
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 300px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        z-index: 9998;
        display: none;
        direction: rtl;
      ">
        <div style="background: #1a6fa8; color: white; padding: 16px; border-radius: 12px 12px 0 0; display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; font-size: 18px; font-weight: 600;">תרבותו 👋</h3>
          <button id="tarbutu-close-popup" style="background: transparent; border: none; color: white; font-size: 20px; cursor: pointer;">×</button>
        </div>
        <div style="padding: 16px; text-align: center;">
          <p style="margin: 0 0 12px 0; font-size: 14px; color: #555; line-height: 1.5;">
            שלום! 👋<br>ברוכים הבאים לתרבותו.<br><strong>איך אוכל לעזור?</strong>
          </p>
          <button id="tarbutu-whatsapp-button" style="width: 100%; padding: 12px; background: #25d366; border: none; border-radius: 8px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit;">
            ${whatsappIcon}
            התחל שיחה עם תרבותו
          </button>
          <p style="margin: 8px 0 0 0; font-size: 11px; color: #999;">Powered by Tarbutu AI</p>
        </div>
      </div>
    </div>
  `;

  document.addEventListener('DOMContentLoaded', function() {
    document.body.insertAdjacentHTML('beforeend', widgetHTML);
    
    const chatButton = document.getElementById('tarbutu-chat-button');
    const popup = document.getElementById('tarbutu-popup');
    const closeButton = document.getElementById('tarbutu-close-popup');
    const whatsappButton = document.getElementById('tarbutu-whatsapp-button');

    chatButton.addEventListener('click', () => {
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    closeButton.addEventListener('click', () => {
      popup.style.display = 'none';
    });
    whatsappButton.addEventListener('click', () => {
      window.open('https://wa.me/+972523661744', '_blank');
      popup.style.display = 'none';
    });
  });
})();
