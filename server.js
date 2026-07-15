require('dotenv').config();
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ─── Kick OAuth konstansok ────────────────────────────────────────────────────
const KICK_AUTH_URL  = 'https://id.kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const KICK_USERS_URL = 'https://api.kick.com/public/v1/users';

// ─── PKCE segédfüggvények ─────────────────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Játékok listája (RAWG slug + kategória) ──────────────────────────────────
const GAMES = [
  // ── Battle Royale ──
  { name: "Fortnite",               slug: "fortnite",                     category: "battle-royale", hints: ["Battle Royale", "Építkezés a harcban", "Epic Games", "100 játékos szigeten"] },
  { name: "Apex Legends",           slug: "apex-legends",                 category: "battle-royale", hints: ["Battle Royale", "Legendák különleges képességei", "EA Respawn", "Pályák és pingrendszer"] },
  { name: "Call of Duty: Warzone",  slug: "call-of-duty-warzone",         category: "battle-royale", hints: ["Battle Royale", "Activision", "Gulág visszatérés", "Verdansk térkép"] },
  { name: "PUBG",                   slug: "playerunknowns-battlegrounds", category: "battle-royale", hints: ["Battle Royale", "Erangel térkép", "Fanzón szűkül", "Brendan Greene"] },
  { name: "Fall Guys",              slug: "fall-guys",                    category: "battle-royale", hints: ["Party battle royale", "Mediatonic", "Jelly Bean karakterek", "Akadálypályák"] },

  // ── FPS / Lövöldözős ──
  { name: "Valorant",               slug: "valorant",                     category: "fps", hints: ["Taktikai lövöldözős", "Riot Games", "Ügynöki képességek", "5v5 bombás mód"] },
  { name: "Counter-Strike 2",       slug: "counter-strike-2",             category: "fps", hints: ["Taktikai FPS", "Terroristák vs Kommandósok", "Valve", "Bombalerakás"] },
  { name: "Overwatch 2",            slug: "overwatch-2",                  category: "fps", hints: ["Hős-alapú lövöldözős", "Blizzard", "Tank/Support/DPS", "Payload mód"] },
  { name: "Destiny 2",              slug: "destiny-2",                    category: "fps", hints: ["Looter shooter", "Bungie", "Guardian főszereplő", "Raid küldetések"] },
  { name: "Rainbow Six Siege",      slug: "tom-clancys-rainbow-six-siege",category: "fps", hints: ["Taktikai FPS", "Ubisoft", "Operátorok képességei", "Rombolható falak"] },

  // ── MOBA / Stratégia ──
  { name: "League of Legends",      slug: "league-of-legends",            category: "moba", hints: ["MOBA játék", "Rift pálya", "Riot Games", "Top/Mid/Bot/Jungle/Support"] },
  { name: "Dota 2",                 slug: "dota-2",                       category: "moba", hints: ["MOBA játék", "Valve", "Ancient elpusztítása", "5v5 stratégia"] },
  { name: "Clash Royale",           slug: "clash-royale",                 category: "moba", hints: ["Mobil stratégia", "Supercell", "Kártya alapú harc", "Aréna tornyok"] },

  // ── RPG ──
  { name: "The Witcher 3",          slug: "the-witcher-3-wild-hunt",      category: "rpg", hints: ["Fehér Farkas", "Geralt of Rivia", "CD Projekt Red", "Nyílt világ RPG"] },
  { name: "Cyberpunk 2077",         slug: "cyberpunk-2077",               category: "rpg", hints: ["Night City", "V főszereplő", "CD Projekt Red", "Futurisztikus RPG"] },
  { name: "Elden Ring",             slug: "elden-ring",                   category: "rpg", hints: ["FromSoftware", "Nyílt világ souls-like", "George R.R. Martin", "Tarnished főszereplő"] },
  { name: "Sekiro",                 slug: "sekiro-shadows-die-twice",     category: "rpg", hints: ["FromSoftware", "Japán shinobi", "Posture rendszer", "Genichiro boss"] },
  { name: "Red Dead Redemption 2",  slug: "red-dead-redemption-2",        category: "rpg", hints: ["Vadnyugat", "Arthur Morgan", "Rockstar Games", "Nyílt világ western"] },
  { name: "Skyrim",                 slug: "the-elder-scrolls-v-skyrim",   category: "rpg", hints: ["Északi tájak", "Sárkányok", "Bethesda", "Dragonborn főszereplő"] },
  { name: "Dark Souls 3",           slug: "dark-souls-iii",               category: "rpg", hints: ["FromSoftware", "Souls-like", "Nehéz boss harcok", "Lothric kingdom"] },
  { name: "Hades",                  slug: "hades",                        category: "rpg", hints: ["Roguelite", "Supergiant Games", "Görög mitológia", "Alvilágból menekülés"] },

  // ── Sandbox / Nyílt világ ──
  { name: "Minecraft",              slug: "minecraft",                    category: "sandbox", hints: ["Blokkos világ", "Bányászás és építés", "Creeper", "Nyílt világ survival"] },
  { name: "GTA V",                  slug: "grand-theft-auto-v",           category: "sandbox", hints: ["Los Santos", "Nyílt világ bűnözés", "Rockstar Games", "Trevor, Michael, Franklin"] },
  { name: "Roblox",                 slug: "roblox",                       category: "sandbox", hints: ["Felhasználók által készített játékok", "Blocky karakterek", "Robux valuta", "Gyerekek kedvence"] },
  { name: "Terraria",               slug: "terraria",                     category: "sandbox", hints: ["2D sandbox", "Bosszok legyőzése", "Re-Logic", "Bányászás és kaland"] },
  { name: "No Man's Sky",           slug: "no-mans-sky",                  category: "sandbox", hints: ["Végtelen bolygók", "Hello Games", "Űrutazás", "Procedurális generálás"] },

  // ── Sport / Verseny ──
  { name: "Rocket League",          slug: "rocket-league",                category: "sport", hints: ["Autók fociznak", "Psyonix", "Aerial manőverek", "Boost gyűjtés"] },
  { name: "FIFA 24",                slug: "ea-sports-fc-24",              category: "sport", hints: ["EA Sports", "Ultimate Team", "Focis szimuláció", "Évi megjelenés"] },
  { name: "NBA 2K24",               slug: "nba-2k24",                     category: "sport", hints: ["Kosárlabda szimuláció", "2K Games", "MyCareer mód", "Jordan Challenge"] },

  // ── Indie ──
  { name: "Among Us",               slug: "among-us",                     category: "indie", hints: ["Űrhajón játszódik", "Impostor kell megtalálni", "InnerSloth", "Crewmate feladatok"] },
  { name: "Hollow Knight",          slug: "hollow-knight",                category: "indie", hints: ["Metroidvania", "Team Cherry", "Rovar világ", "Hallownest kingdom"] },
  { name: "Celeste",                slug: "celeste",                      category: "indie", hints: ["Platformer", "Madeline főszereplő", "Hegymászás", "Nehéz de igazságos"] },
  { name: "Stardew Valley",         slug: "stardew-valley",               category: "indie", hints: ["Farm szimuláció", "ConcernedApe", "Pelican Town", "Gazda élet"] },
  { name: "Cuphead",                slug: "cuphead",                      category: "indie", hints: ["1930-as rajzfilm stílus", "StudioMDHR", "Nehéz boss rush", "Animált karakterek"] },
  { name: "Undertale",              slug: "undertale",                    category: "indie", hints: ["RPG ahol nem kell ölni", "Toby Fox", "Pacifist út", "Sans boss"] },
];

// Elérhető kategóriák
const CATEGORIES = {
  'all':          'Minden kategória',
  'battle-royale':'Battle Royale',
  'fps':          'FPS / Lövöldözős',
  'moba':         'MOBA / Stratégia',
  'rpg':          'RPG',
  'sandbox':      'Sandbox / Nyílt világ',
  'sport':        'Sport / Verseny',
  'indie':        'Indie',
};

// ─── RAWG képcache (slug → imageUrl) ─────────────────────────────────────────
const imageCache = new Map();

async function fetchGameImage(slug) {
  if (imageCache.has(slug)) return imageCache.get(slug);
  if (!process.env.RAWG_API_KEY || process.env.RAWG_API_KEY.startsWith('ide_ird')) {
    return null; // nincs API kulcs, kép nélkül fut
  }
  try {
    const res = await axios.get(`https://api.rawg.io/api/games/${slug}`, {
      params: { key: process.env.RAWG_API_KEY },
      timeout: 5000
    });
    const url = res.data.background_image || null;
    imageCache.set(slug, url);
    return url;
  } catch (err) {
    console.warn(`RAWG kép hiba (${slug}):`, err.message);
    imageCache.set(slug, null); // ne próbálja újra
    return null;
  }
}

// Összes kép előtöltése induláskor (háttérben)
async function prefetchAllImages() {
  if (!process.env.RAWG_API_KEY || process.env.RAWG_API_KEY.startsWith('ide_ird')) {
    console.log('⚠️  RAWG_API_KEY nincs beállítva – képek nélkül fut a játék.');
    return;
  }
  console.log('🖼️  Játékképek előtöltése RAWG API-ból...');
  for (const game of GAMES) {
    await fetchGameImage(game.slug);
    await new Promise(r => setTimeout(r, 300)); // rate limit kímélés
  }
  const loaded = [...imageCache.values()].filter(Boolean).length;
  console.log(`✅ Képek betöltve: ${loaded}/${GAMES.length}`);
}

// ─── Jelszó generálás ─────────────────────────────────────────────────────────
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// ─── Szobák tárolása ──────────────────────────────────────────────────────────
const rooms = new Map();

// ─── Session beállítás ────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'titkos_kulcs_csere_le',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth routes (kézi PKCE, passport nélkül) ────────────────────────────────
app.get('/auth/kick', (req, res) => {
  const state        = generateState();
  const codeVerifier = generateCodeVerifier();
  const challenge    = generateCodeChallenge(codeVerifier);

  req.session.oauthState        = state;
  req.session.oauthCodeVerifier = codeVerifier;

  const params = new URLSearchParams({
    response_type:          'code',
    client_id:              process.env.KICK_CLIENT_ID,
    redirect_uri:           process.env.KICK_REDIRECT_URI,
    scope:                  'user:read',
    state,
    code_challenge:         challenge,
    code_challenge_method:  'S256',
  });

  res.redirect(`${KICK_AUTH_URL}?${params}`);
});

app.get('/auth/kick/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('Kick OAuth hiba:', error);
    return res.redirect('/?error=' + encodeURIComponent(error));
  }
  if (!code || state !== req.session.oauthState) {
    return res.redirect('/?error=state_mismatch');
  }

  const codeVerifier = req.session.oauthCodeVerifier;
  delete req.session.oauthState;
  delete req.session.oauthCodeVerifier;

  try {
    // Token csere
    const tokenRes = await axios.post(KICK_TOKEN_URL,
      new URLSearchParams({
        grant_type:    'authorization_code',
        client_id:     process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        redirect_uri:  process.env.KICK_REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;

    // Felhasználó adatai
    const userRes = await axios.get(KICK_USERS_URL, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = userRes.data?.data?.[0] || userRes.data?.[0] || userRes.data;
    req.session.user = {
      id:       data.user_id || data.id,
      username: data.username || data.name || 'Kick User',
      avatar:   data.profile_pic || data.avatar || null,
    };

    console.log('Kick bejelentkezés sikeres:', req.session.user.username);
    res.redirect('/');
  } catch (err) {
    console.error('Kick token/user hiba:', err.response?.data || err.message);
    res.redirect('/?error=' + encodeURIComponent(err.response?.data?.message || 'token_failed'));
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/categories', (req, res) => {
  res.json(CATEGORIES);
});

app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// ─── Socket.io – valós idejű játéklogika ──────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Kapcsolódott: ${socket.id}`);

  // Szoba létrehozása
  socket.on('create_room', ({ username, avatar, password }) => {
    const roomId = uuidv4().substring(0, 6).toUpperCase();

    // Jelszó validáció és auto-generálás
    let roomPassword;
    if (!password || password.trim().length === 0) {
      roomPassword = generatePassword(); // auto-generált
    } else if (password.trim().length < 2 || password.trim().length > 15) {
      socket.emit('error_msg', 'A jelszó 2–15 karakter legyen!');
      return;
    } else {
      roomPassword = password.trim();
    }

    const room = {
      id: roomId,
      password: roomPassword,
      host: socket.id,
      players: [{
        id: socket.id,
        username: username || 'Vendég',
        avatar: avatar || null,
        score: 0,
        ready: false,
        wrongGuesses: 0,
      }],
      state: 'lobby',
      currentGame: null,
      currentHintIndex: 0,
      hintInterval: null,
      round: 0,
      maxRounds: 5,
      category: 'all',
      guessedThisRound: new Set(),
      usedGames: new Set(),
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('room_created', { roomId, password: roomPassword, room: sanitizeRoom(room) });
    console.log(`Szoba létrehozva: ${roomId} (jelszó: ${roomPassword}) by ${username}`);
  });

  // Szobához csatlakozás
  socket.on('join_room', ({ roomId, username, avatar, password }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) {
      socket.emit('error_msg', 'Nem létező szoba!');
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('error_msg', 'A játék már elkezdődött!');
      return;
    }
    if (room.players.length >= 8) {
      socket.emit('error_msg', 'A szoba tele van! (max 8 játékos)');
      return;
    }
    if (!password || password.trim() !== room.password) {
      socket.emit('error_msg', '🔑 Helytelen jelszó!');
      return;
    }

    const player = {
      id: socket.id,
      username: username || 'Vendég',
      avatar: avatar || null,
      score: 0,
      ready: false,
      wrongGuesses: 0,
    };
    room.players.push(player);
    socket.join(roomId.toUpperCase());
    socket.roomId = roomId.toUpperCase();

    socket.emit('room_joined', { roomId: room.id, room: sanitizeRoom(room) });
    io.to(room.id).emit('player_joined', { player, room: sanitizeRoom(room) });
    console.log(`${username} csatlakozott: ${room.id}`);
  });

  // Szoba beállítások frissítése (csak host)
  socket.on('update_settings', ({ maxRounds, category }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;

    const rounds = parseInt(maxRounds);
    if (isNaN(rounds) || rounds < 5 || rounds > 30) {
      socket.emit('error_msg', 'A körök száma 5–30 között legyen!');
      return;
    }
    if (!CATEGORIES[category]) {
      socket.emit('error_msg', 'Érvénytelen kategória!');
      return;
    }

    room.maxRounds = rounds;
    room.category  = category;
    io.to(room.id).emit('settings_updated', {
      maxRounds: room.maxRounds,
      category:  room.category,
      categoryName: CATEGORIES[category],
    });
  });

  // Játékos kész jelzés
  socket.on('player_ready', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = true;
      io.to(room.id).emit('player_updated', { room: sanitizeRoom(room) });

      // Ha mindenki kész és legalább 1 játékos van
      const allReady = room.players.every(p => p.ready);
      if (allReady && room.players.length >= 1) {
        startGame(room);
      }
    }
  });

  // Tipp küldése
  socket.on('submit_guess', ({ guess }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing') return;
    if (room.guessedThisRound.has(socket.id)) return; // már tippelt

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const correct = guess.trim().toLowerCase() === room.currentGame.name.toLowerCase();

    if (correct) {
      room.guessedThisRound.add(socket.id);

      // Pontozás: 2000 alap - eltelt idő arányosan, +100 bónusz ha első tippre
      const elapsed = (Date.now() - room.roundStartTime) / 1000;
      const duration = room.roundDuration;
      const ratio = Math.max(0, 1 - elapsed / duration);           // 1.0 → 0.0
      const base = Math.round(2000 * ratio);                        // 2000 → 0
      const bonus = room.guessedThisRound.size === 1 &&
                    player.wrongGuesses === 0 ? 100 : 0;            // első helyes tipp bónusz
      const points = Math.max(base, 50) + bonus;                    // minimum 50 pont
      player.score += points;

      io.to(room.id).emit('correct_guess', {
        playerId: socket.id,
        username: player.username,
        points,
        answer: room.currentGame.name,
        room: sanitizeRoom(room)
      });

      // Ha mindenki kitalálta, következő kör
      if (room.guessedThisRound.size >= room.players.length) {
        clearInterval(room.hintInterval);
        setTimeout(() => nextRound(room), 3000);
      }
    } else {
      // Rossz tipp: -400 pont (minimum 0)
      player.wrongGuesses = (player.wrongGuesses || 0) + 1;
      player.score = Math.max(0, (player.score || 0) - 400);

      const closeHint = getCloseHint(guess, room.currentGame.name);
      if (closeHint) {
        socket.emit('wrong_guess', { guess, closeHint, penalty: 400 });
      } else {
        socket.emit('wrong_guess', { guess, penalty: 400 });
      }
      io.to(room.id).emit('player_guessed', {
        username: player.username,
        guess: '❌ Rossz tipp (-400 pont)'
      });
      io.to(room.id).emit('score_updated', { room: sanitizeRoom(room) });
    }
  });

  // Chat üzenet
  socket.on('chat_message', ({ message }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    if (message.length > 200) return;

    io.to(room.id).emit('chat_message', {
      username: player.username,
      avatar: player.avatar,
      message,
      timestamp: Date.now()
    });
  });

  // Kilépés / szétkapcsolódás
  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);
    room.guessedThisRound.delete(socket.id);

    if (room.players.length === 0) {
      // Üres szoba törlése
      clearInterval(room.hintInterval);
      rooms.delete(room.id);
      console.log(`Szoba törölve: ${room.id}`);
    } else {
      // Ha a host ment el, új host
      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
      io.to(room.id).emit('player_left', { room: sanitizeRoom(room) });
    }
    console.log(`Kilépett: ${socket.id}`);
  });
});

// ─── Játék indítása ───────────────────────────────────────────────────────────
function startGame(room) {
  room.state = 'playing';
  room.round = 0;
  room.players.forEach(p => { p.score = 0; p.ready = false; p.wrongGuesses = 0; });
  room.usedGames.clear();

  io.to(room.id).emit('game_started', { room: sanitizeRoom(room) });
  setTimeout(() => startRound(room), 1000);
}

function startRound(room) {
  room.round++;
  room.guessedThisRound = new Set();
  room.currentHintIndex = 0;
  room.roundStartTime = Date.now();
  room.roundDuration = 30;
  room.players.forEach(p => { p.wrongGuesses = 0; }); // kör elején nullázás

  // Véletlenszerű játék, amit még nem használtunk (kategória szűréssel)
  const pool = room.category && room.category !== 'all'
    ? GAMES.filter(g => g.category === room.category)
    : GAMES;
  const available = pool.filter(g => !room.usedGames.has(g.name));
  if (available.length === 0) room.usedGames.clear();
  const filtered = pool.filter(g => !room.usedGames.has(g.name));
  const randomGame = filtered[Math.floor(Math.random() * filtered.length)];
  room.currentGame = randomGame;
  room.usedGames.add(randomGame.name);

  const imageUrl = imageCache.get(randomGame.slug) || null;
  const totalHints = randomGame.hints.length;

  io.to(room.id).emit('round_start', {
    round: room.round,
    maxRounds: room.maxRounds,
    hint: randomGame.hints[0],
    hintIndex: 0,
    totalHints,
    imageUrl,
    duration: room.roundDuration,
  });

  // Hint időzítő (8 mp-enként új hint)
  let hintIdx = 1;
  room.hintInterval = setInterval(() => {
    if (hintIdx < randomGame.hints.length) {
      room.currentHintIndex = hintIdx;
      io.to(room.id).emit('new_hint', {
        hint: randomGame.hints[hintIdx],
        hintIndex: hintIdx,
      });
      hintIdx++;
    } else {
      clearInterval(room.hintInterval);
    }
  }, 8000);

  // 30 másodperces kör időkorlát
  room.roundTimeout = setTimeout(() => {
    clearInterval(room.hintInterval);
    io.to(room.id).emit('round_timeout', { answer: randomGame.name, room: sanitizeRoom(room) });
    setTimeout(() => nextRound(room), 4000);
  }, room.roundDuration * 1000);
}

function nextRound(room) {
  clearInterval(room.hintInterval);
  clearTimeout(room.roundTimeout);
  if (room.round >= room.maxRounds) {
    endGame(room);
  } else {
    room.state = 'playing';
    io.to(room.id).emit('next_round_countdown', { seconds: 3 });
    setTimeout(() => startRound(room), 3000);
  }
}

function endGame(room) {
  room.state = 'gameOver';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.id).emit('game_over', {
    leaderboard: sorted,
    winner: sorted[0]
  });
  // Szoba visszaállítása lobby-ba 30mp után
  setTimeout(() => {
    if (rooms.has(room.id)) {
      room.state = 'lobby';
      room.round = 0;
      room.players.forEach(p => { p.score = 0; p.ready = false; });
      io.to(room.id).emit('room_reset', { room: sanitizeRoom(room) });
    }
  }, 30000);
}

// ─── Levenshtein távolság ─────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Közel-e a tipp? → privát szöveges hint generálása
function getCloseHint(guess, answer) {
  const g = guess.trim().toLowerCase();
  const a = answer.toLowerCase();

  // Pontos egyezés – ezt a caller kezeli
  if (g === a) return null;

  const dist = levenshtein(g, a);
  const threshold = Math.max(3, Math.floor(a.length * 0.35)); // max 35% eltérés

  if (dist > threshold) return null; // túl messze, nincs hint

  const hints = [];

  // Hossz különbség
  if (g.length < a.length) {
    hints.push(`📏 A válasz hosszabb (${a.length} karakter)`);
  } else if (g.length > a.length) {
    hints.push(`📏 A válasz rövidebb (${a.length} karakter)`);
  }

  // Első karakter
  if (g[0] !== a[0]) {
    hints.push(`🔤 Nem jó betűvel kezdődik (nem "${g[0].toUpperCase()}")`);
  }

  // Tartalmazza-e részben
  if (a.includes(g) || g.includes(a.split(' ')[0])) {
    hints.push(`🔍 Nagyon közel vagy, pontosíts!`);
  }

  // Elírás / közel
  if (dist <= 2) {
    hints.push(`✏️ Csak ${dist} karakter a különbség, elírás?`);
  } else if (dist <= threshold) {
    hints.push(`🤏 Közel vagy, de nem pontos!`);
  }

  return hints.length > 0 ? hints[0] : `🤏 Majdnem! Próbáld újra.`;
}

// Szoba adatainak tisztítása (Set-ek nem JSON-ba serializálhatók)
function sanitizeRoom(room) {
  return {
    id: room.id,
    host: room.host,
    players: room.players,
    state: room.state,
    round: room.round,
    maxRounds: room.maxRounds,
    category: room.category || 'all',
  };
}

// ─── Szerver indítása ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎮 Game Guesser szerver fut: http://localhost:${PORT}`);
  console.log(`📋 Kick OAuth callback: ${process.env.KICK_REDIRECT_URI}\n`);
  prefetchAllImages(); // háttérben betölti a képeket
});
