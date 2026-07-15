# 🎮 Game Guesser

Multiplayer játéknév-kitalálós játék Kick.com bejelentkezéssel.

## Funkciók
- 🔐 Kick.com OAuth bejelentkezés
- 🚪 Szoba létrehozás és meghívás linkkel
- 👥 Több játékos egyszerre (max 8 fő)
- 💡 Fokozatos tipp rendszer
- 💬 Valós idejű chat
- 🏆 Pontozás és ranglista

## Telepítés (helyi)

```bash
npm install
# Töltsd ki a .env fájlt (lásd .env.example)
npm start
```

## Környezeti változók

Hozz létre egy `.env` fájlt a `.env.example` alapján:

```env
KICK_CLIENT_ID=...
KICK_CLIENT_SECRET=...
KICK_REDIRECT_URI=https://a-te-domain-ed/auth/kick/callback
SESSION_SECRET=hosszu_veletlenszeru_string
PORT=3000
```

## Deploy (Render)

1. Töltsd fel a kódot GitHub-ra
2. [render.com](https://render.com) → New Web Service → GitHub repo
3. Environment Variables-be add meg a `.env` tartalmát
4. Kick Developer Appban frissítsd a Redirect URI-t az éles URL-re
