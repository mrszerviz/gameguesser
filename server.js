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

const KICK_AUTH_URL = 'https://id.kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const KICK_USERS_URL = 'https://api.kick.com/public/v1/users';

function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ====================== 1000+ JÁTÉK BETÖLTÉS ======================
let GAMES = [];
const imageCache = new Map();

async function loadMassiveGames() {
  if (!process.env.RAWG_API_KEY || process.env.RAWG_API_KEY.includes('ide_ird')) {
    console.log('⚠️ RAWG kulcs nélkül csak demo!');
    return;
  }
  console.log('🔥 RAWG-ból szopom a rengeteg játékot...');
  const allGames = [];
  for (let page = 1; page <= 25; page++) {
    try {
      const res = await axios.get('https://api.rawg.io/api/games', {
        params: { key: process.env.RAWG_API_KEY, page_size: 50, page, ordering: '-rating' },
        timeout: 8000
      });
      const games = res.data.results.map(g => ({
        name: g.name,
        slug: g.slug,
        category: g.genres?.[0]?.slug || 'other',
        hints: [
          g.genres?.map(gen => gen.name).join(' • ') || 'Videójáték',
          g.platforms ? g.platforms.map(p => p.platform.name).slice(0,3).join(', ') : '',
          g.released ? g.released.substring(0,4) : '',
          g.rating ? `Értékelés: ${g.rating.toFixed(1)}` : ''
        ].filter(h => h.length > 3)
      }));
      allGames.push(...games);
      console.log(`Oldal ${page} kész – ${allGames.length} játék`);
      await new Promise(r => setTimeout(r, 350));
    } catch (e) {
      console.error(`Hiba ${page}. oldalnál`, e.message);
      break;
    }
  }
  GAMES = allGames.length > 50 ? allGames : GAMES;
  console.log(`✅ ${GAMES.length} játék betöltve!`);
}

async function fetchGameImage(slug) {
  if (imageCache.has(slug)) return imageCache.get(slug);
  if (!process.env.RAWG_API_KEY || process.env.RAWG_API_KEY.startsWith('ide_ird')) return null;
  try {
    const res = await axios.get(`https://api.rawg.io/api/games/${slug}`, {
      params: { key: process.env.RAWG_API_KEY },
      timeout: 5000
    });
    const url = res.data.background_image || null;
    imageCache.set(slug, url);
    return url;
  } catch {
    imageCache.set(slug, null);
    return null;
  }
}

async function prefetchAllImages() {
  if (!process.env.RAWG_API_KEY || process.env.RAWG_API_KEY.startsWith('ide_ird')) {
    console.log('⚠️ RAWG_API_KEY nincs beállítva – képek nélkül fut.');
    return;
  }
  console.log('🖼️ Képek előtöltése...');
  for (const game of GAMES.slice(0, 200)) {
    await fetchGameImage(game.slug);
    await new Promise(r => setTimeout(r, 250));
  }
  const loaded = [...imageCache.values()].filter(Boolean).length;
  console.log(`✅ ${loaded} kép betöltve!`);
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

const rooms = new Map();

app.use(session({
  secret: process.env.SESSION_SECRET || 'titkos_kulcs_csere_le',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/auth/kick', (req, res) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(codeVerifier);
  req.session.oauthState = state;
  req.session.oauthCodeVerifier = codeVerifier;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.KICK_CLIENT_ID,
    redirect_uri: process.env.KICK_REDIRECT_URI,
    scope: 'user:read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
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
    const tokenRes = await axios.post(KICK_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        redirect_uri: process.env.KICK_REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get(KICK_USERS_URL, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = userRes.data?.data?.[0] || userRes.data?.[0] || userRes.data;
    req.session.user = {
      id: data.user_id || data.id,
      username: data.username || data.name || 'Kick User',
      avatar: data.profile_pic || data.avatar || null,
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
  res.json({
    'all': 'Minden kategória',
    'battle-royale':'Battle Royale',
    'fps': 'FPS / Lövöldözős',
    'moba': 'MOBA / Stratégia',
    'rpg': 'RPG',
    'sandbox': 'Sandbox / Nyílt világ',
    'sport': 'Sport / Verseny',
    'indie': 'Indie',
  });
});

app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

io.on('connection', (socket) => {
  console.log(`Kapcsolódott: ${socket.id}`);

  socket.on('create_room', ({ username, avatar, password }) => {
    const roomId = uuidv4().substring(0, 6).toUpperCase();
    let roomPassword = password && password.trim().length > 0 ? password.trim() : generatePassword();
    const room = {
      id: roomId,
      password: roomPassword,
      host: socket.id,
      players: [{ id: socket.id, username: username || 'Vendég', avatar, score: 0, ready: false, wrongGuesses: 0 }],
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
  });

  socket.on('join_room', ({ roomId, username, avatar, password }) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room || room.state !== 'lobby' || room.players.length >= 8 || password !== room.password) {
      socket.emit('error_msg', room ? 'Helytelen jelszó vagy tele van!' : 'Nem létező szoba!');
      return;
    }
    const player = { id: socket.id, username: username || 'Vendég', avatar, score: 0, ready: false, wrongGuesses: 0 };
    room.players.push(player);
    socket.join(roomId.toUpperCase());
    socket.roomId = roomId.toUpperCase();
    socket.emit('room_joined', { roomId: room.id, room: sanitizeRoom(room) });
    io.to(room.id).emit('player_joined', { player, room: sanitizeRoom(room) });
  });

  socket.on('update_settings', ({ maxRounds, category }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.host !== socket.id) return;
    room.maxRounds = parseInt(maxRounds) || 5;
    room.category = category || 'all';
    io.to(room.id).emit('settings_updated', { maxRounds: room.maxRounds, category: room.category });
  });

  socket.on('player_ready', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.ready = true;
    io.to(room.id).emit('player_updated', { room: sanitizeRoom(room) });
    if (room.players.every(p => p.ready) && room.players.length >= 1) startGame(room);
  });

  socket.on('submit_guess', ({ guess }) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.state !== 'playing' || room.guessedThisRound.has(socket.id)) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const correct = guess.trim().toLowerCase() === room.currentGame.name.toLowerCase();
    if (correct) {
      room.guessedThisRound.add(socket.id);
      const elapsed = (Date.now() - room.roundStartTime) / 1000;
      const points = Math.max(50, Math.round(2000 * Math.max(0, 1 - elapsed / 30)));
      player.score += points;
      io.to(room.id).emit('correct_guess', { playerId: socket.id, username: player.username, points, answer: room.currentGame.name, room: sanitizeRoom(room) });
      if (room.guessedThisRound.size >= room.players.length) {
        clearInterval(room.hintInterval);
        setTimeout(() => nextRound(room), 3000);
      }
    } else {
      player.wrongGuesses = (player.wrongGuesses || 0) + 1;
      player.score = Math.max(0, player.score - 400);
      io.to(room.id).emit('player_guessed', { username: player.username, guess: '❌ Rossz tipp (-400 pont)' });
      io.to(room.id).emit('score_updated', { room: sanitizeRoom(room) });
    }
  });

  socket.on('chat_message', ({ message }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player && message.length <= 200) {
      io.to(room.id).emit('chat_message', { username: player.username, avatar: player.avatar, message, timestamp: Date.now() });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else if (room.host === socket.id) {
      room.host = room.players[0].id;
    }
    io.to(room.id).emit('player_left', { room: sanitizeRoom(room) });
  });
});

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

  const pool = room.category !== 'all' ? GAMES.filter(g => g.category === room.category) : GAMES;
  let available = pool.filter(g => !room.usedGames.has(g.name));
  if (available.length === 0) {
    room.usedGames.clear();
    available = pool;
  }
  const randomGame = available[Math.floor(Math.random() * available.length)];
  room.currentGame = randomGame;
  room.usedGames.add(randomGame.name);

  const imageUrl = imageCache.get(randomGame.slug) || null;
  io.to(room.id).emit('round_start', {
    round: room.round,
    maxRounds: room.maxRounds,
    hint: randomGame.hints[0],
    hintIndex: 0,
    totalHints: randomGame.hints.length,
    imageUrl,
    duration: room.roundDuration,
  });

  let hintIdx = 1;
  room.hintInterval = setInterval(() => {
    if (hintIdx < randomGame.hints.length) {
      io.to(room.id).emit('new_hint', { hint: randomGame.hints[hintIdx], hintIndex: hintIdx });
      hintIdx++;
    } else clearInterval(room.hintInterval);
  }, 8000);

  room.roundTimeout = setTimeout(() => {
    clearInterval(room.hintInterval);
    io.to(room.id).emit('round_timeout', { answer: randomGame.name, room: sanitizeRoom(room) });
    setTimeout(() => nextRound(room), 4000);
  }, room.roundDuration * 1000);
}

function nextRound(room) {
  clearInterval(room.hintInterval);
  clearTimeout(room.roundTimeout);
  if (room.round >= room.maxRounds) endGame(room);
  else {
    io.to(room.id).emit('next_round_countdown', { seconds: 3 });
    setTimeout(() => startRound(room), 3000);
  }
}

function endGame(room) {
  room.state = 'gameOver';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.id).emit('game_over', { leaderboard: sorted, winner: sorted[0] });
  setTimeout(() => {
    if (rooms.has(room.id)) {
      room.state = 'lobby';
      room.round = 0;
      room.players.forEach(p => { p.score = 0; p.ready = false; });
      io.to(room.id).emit('room_reset', { room: sanitizeRoom(room) });
    }
  }, 30000);
}

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

server.listen(PORT, async () => {
  console.log(`🎮 Game Guesser szerver fut: http://localhost:${PORT}`);
  await loadMassiveGames();
  prefetchAllImages();
});
