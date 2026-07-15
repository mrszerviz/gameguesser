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

// ─── Játékok listája (RAWG slug a képekhez) ───────────────────────────────────
const GAMES = [
  { name: "Minecraft",              slug: "minecraft",                    hints: ["Blokkos világ", "Bányászás és építés", "Creeper", "Nyílt világ survival"] },
  { name: "Fortnite",               slug: "fortnite",                     hints: ["Battle Royale", "Építkezés a harcban", "Epic Games", "100 játékos szigeten"] },
  { name: "GTA V",                  slug: "grand-theft-auto-v",           hints: ["Los Santos", "Nyílt világ bűnözés", "Rockstar Games", "Trevor, Michael, Franklin"] },
  { name: "Among Us",               slug: "among-us",                     hints: ["Űrhajón játszódik", "Impostor kell megtalálni", "InnerSloth", "Crewmate feladatok"] },
  { name: "Valorant",               slug: "valorant",                     hints: ["Taktikai lövöldözős", "Riot Games", "Ügynöki képességek", "5v5 bombás mód"] },
  { name: "League of Legends",      slug: "league-of-legends",            hints: ["MOBA játék", "Rift pálya", "Riot Games", "Top/Mid/Bot/Jungle/Support"] },
  { name: "Counter-Strike 2",       slug: "counter-strike-2",             hints: ["Taktikai FPS", "Terroristák vs Kommandósok", "Valve", "Bombalerakás"] },
  { name: "Roblox",                 slug: "roblox",                       hints: ["Felhasználók által készített játékok", "Blocky karakterek", "Robux valuta", "Gyerekek kedvence"] },
  { name: "Apex Legends",           slug: "apex-legends",                 hints: ["Battle Royale", "Legendák különleges képességei", "EA Respawn", "Pályák és pingrendszer"] },
  { name: "Rocket League",          slug: "rocket-league",                hints: ["Autók fociznak", "Psyonix", "Aerial manőverek", "Boost gyűjtés"] },
  { name: "Overwatch 2",            slug: "overwatch-2",                  hints: ["Hős-alapú lövöldözős", "Blizzard", "Tank/Support/DPS", "Payload mód"] },
  { name: "The Witcher 3",          slug: "the-witcher-3-wild-hunt",      hints: ["Fehér Farkas", "Geralt of Rivia", "CD Projekt Red", "Nyílt világ RPG"] },
  { name: "Cyberpunk 2077",         slug: "cyberpunk-2077",               hints: ["Night City", "V főszereplő", "CD Projekt Red", "Futurisztikus RPG"] },
  { name: "Elden Ring",             slug: "elden-ring",                   hints: ["FromSoftware", "Nyílt világ souls-like", "George R.R. Martin", "Tarnished főszereplő"] },
  { name: "Red Dead Redemption 2",  slug: "red-dead-redemption-2",        hints: ["Vadnyugat", "Arthur Morgan", "Rockstar Games", "Nyílt világ western"] },
  { name: "Call of Duty: Warzone",  slug: "call-of-duty-warzone",         hints: ["Battle Royale", "Activision", "Gulág visszatérés", "Verdansk térkép"] },
  { name: "Dota 2",                 slug: "dota-2",                       hints: ["MOBA játék", "Valve", "Ancient elpusztítása", "5v5 stratégia"] },
  { name: "Terraria",               slug: "terraria",                     hints: ["2D sandbox", "Bosszok legyőzése", "Re-Logic", "Bányászás és kaland"] },
  { name: "Stardew Valley",         slug: "stardew-valley",               hints: ["Farm szimuláció", "ConcernedApe", "Pelican Town", "Gazda élet"] },
  { name: "Fall Guys",              slug: "fall-guys",                    hints: ["Party battle royale", "Mediatonic", "Jelly Bean karakterek", "Akadálypályák"] },
  { name: "Hollow Knight",          slug: "hollow-knight",                hints: ["Metroidvania", "Team Cherry", "Rovar világ", "Hallownest kingdom"] },
  { name: "Celeste",                slug: "celeste",                      hints: ["Platformer", "Madeline főszereplő", "Hegymászás", "Nehéz de igazságos"] },
  { name: "Hades",                  slug: "hades",                        hints: ["Roguelite", "Supergiant Games", "Görög mitológia", "Alvilágból menekülés"] },
  { name: "Sekiro",                 slug: "sekiro-shadows-die-twice",     hints: ["FromSoftware", "Japán shinobi", "Posture rendszer", "Genichiro boss"] },
];

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
  socket.on('create_room', ({ username, avatar }) => {
    const roomId = uuidv4().substring(0, 6).toUpperCase();
    const room = {
      id: roomId,
      host: socket.id,
      players: [{
        id: socket.id,
        username: username || 'Vendég',
        avatar: avatar || null,
        score: 0,
        ready: false
      }],
      state: 'lobby',       // lobby | playing | roundEnd | gameOver
      currentGame: null,
      currentHintIndex: 0,
      hintInterval: null,
      round: 0,
      maxRounds: 5,
      guessedThisRound: new Set(),
      usedGames: new Set(),
    };
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('room_created', { roomId, room: sanitizeRoom(room) });
    console.log(`Szoba létrehozva: ${roomId} by ${username}`);
  });

  // Szobához csatlakozás
  socket.on('join_room', ({ roomId, username, avatar }) => {
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

    const player = {
      id: socket.id,
      username: username || 'Vendég',
      avatar: avatar || null,
      score: 0,
      ready: false
    };
    room.players.push(player);
    socket.join(roomId.toUpperCase());
    socket.roomId = roomId.toUpperCase();

    socket.emit('room_joined', { roomId: room.id, room: sanitizeRoom(room) });
    io.to(room.id).emit('player_joined', { player, room: sanitizeRoom(room) });
    console.log(`${username} csatlakozott: ${room.id}`);
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
      // Pont: minél kevesebb hint kellett, annál több pont
      const points = Math.max(10 - room.currentHintIndex * 2, 2);
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
      socket.emit('wrong_guess', { guess });
      io.to(room.id).emit('player_guessed', {
        username: player.username,
        guess: '❌ Rossz tipp'
      });
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
  room.players.forEach(p => { p.score = 0; p.ready = false; });
  room.usedGames.clear();

  io.to(room.id).emit('game_started', { room: sanitizeRoom(room) });
  setTimeout(() => startRound(room), 1000);
}

function startRound(room) {
  room.round++;
  room.guessedThisRound = new Set();
  room.currentHintIndex = 0;

  // Véletlenszerű játék, amit még nem használtunk
  const available = GAMES.filter(g => !room.usedGames.has(g.name));
  if (available.length === 0) room.usedGames.clear();
  const randomGame = available[Math.floor(Math.random() * available.length)];
  room.currentGame = randomGame;
  room.usedGames.add(randomGame.name);

  const imageUrl = imageCache.get(randomGame.slug) || null;
  const totalHints = randomGame.hints.length;
  // blur: 4 hint esetén 24px → 16px → 8px → 0px
  const blurLevels = Array.from({ length: totalHints }, (_, i) =>
    Math.max(0, Math.round(24 - (24 / (totalHints - 1 || 1)) * i))
  );

  io.to(room.id).emit('round_start', {
    round: room.round,
    maxRounds: room.maxRounds,
    hint: randomGame.hints[0],
    hintIndex: 0,
    totalHints,
    imageUrl,
    blurPx: blurLevels[0],
  });

  // Tipp megjelenítés időzítve
  let hintIdx = 1;
  room.hintInterval = setInterval(() => {
    if (hintIdx < randomGame.hints.length) {
      room.currentHintIndex = hintIdx;
      io.to(room.id).emit('new_hint', {
        hint: randomGame.hints[hintIdx],
        hintIndex: hintIdx,
        blurPx: blurLevels[hintIdx] ?? 0,
      });
      hintIdx++;
    } else {
      // Minden hint elfogyott – round over
      clearInterval(room.hintInterval);
      io.to(room.id).emit('round_timeout', { answer: randomGame.name, room: sanitizeRoom(room) });
      setTimeout(() => nextRound(room), 4000);
    }
  }, 8000); // 8 másodpercenként új hint
}

function nextRound(room) {
  clearInterval(room.hintInterval);
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

// Szoba adatainak tisztítása (Set-ek nem JSON-ba serializálhatók)
function sanitizeRoom(room) {
  return {
    id: room.id,
    host: room.host,
    players: room.players,
    state: room.state,
    round: room.round,
    maxRounds: room.maxRounds,
  };
}

// ─── Szerver indítása ─────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎮 Game Guesser szerver fut: http://localhost:${PORT}`);
  console.log(`📋 Kick OAuth callback: ${process.env.KICK_REDIRECT_URI}\n`);
  prefetchAllImages(); // háttérben betölti a képeket
});
