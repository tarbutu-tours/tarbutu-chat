# תרבותו Chat System

## התקנה מקומית (לבדיקה)
```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... node server.js
```
פתח: http://localhost:3000/admin

## העלאה ל-Railway (ייצור)

1. העלה לGitHub:
   - צור repo חדש ב-github.com
   - העלה את כל הקבצים

2. Railway:
   - כנס ל-railway.app
   - "New Project" → "Deploy from GitHub"
   - בחר את ה-repo
   - לחץ "Variables" → הוסף: ANTHROPIC_API_KEY = המפתח שלך

3. לאחר Deploy — קבל URL כמו: https://tarbutu-chat.up.railway.app

## הטמעה באתר WordPress
הוסף לפני </body> בכל עמוד:
```html
<script>
window.TarbutuChat = {
  server: 'https://YOUR-RAILWAY-URL',
  color: '#1a6fa8'
};
</script>
<script src="https://YOUR-RAILWAY-URL/widget.js"></script>
```

ב-WordPress: Appearance → Theme Editor → footer.php
או דרך פלאגין "Insert Headers and Footers"
