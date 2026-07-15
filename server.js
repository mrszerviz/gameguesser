require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ─── Játékok listája ─────────────────────────────────────────────────────────
const GAMES = [
  { name: "Minecraft", hints: ["Blokkos világ", "Bányászás és építés", "Creeper", "Nyílt világ survival"] },
  { name: "Fortnite", hints: ["Battle Royale", "Építkezés a harcban", "Epic Games", "100 játékos szigeten"] },
  { name: "GTA V", hints: ["Los Santos", "Nyílt világ bűnözés", "Rockstar Games", "Trevor, Michael, Franklin"] },
  { name: "Among Us", hints: ["Űrhajón játszódik", "Impostor kell megtalálni", "InnerSloth", "Crewmate feladatok"] },
  { name: "Valorant", hints: ["Taktikai lövöldözős", "Riot Games", "Ügynöki képességek", "5v5 bombás mód"] },
  { name: "League of Legends", hints: ["MOBA játék", "Rift pálya", "Riot Games", "Top/Mid/Bot/Jungle/Support"] },
  { name: "Counter-Strike 2", hints: ["Taktikai FPS", "Terroristák vs Kommandósok", "Valve", "Bombalerakás"] },
  { name: "Roblox", hints: ["Felhasználók által készített játékok", "Blocky karakterek", "Robux valuta", "Gyerekek kedvence"] },
  { name: "Apex Legends", hints: ["Battle Royale", "Legendák különleges képességei", "EA Respawn", "Pályák és pingrendszer"] },
  { name: "Rocket League", hints: ["Autók fociznak", "Psyonix", "Aerial manőverek", "Boost gyűjtés"] },
  { name: "Overwatch 2", hints: ["Hős-alapú lövöldözős", "Blizzard", "Tank/Support/DPS", "Payload mód"] },
  { name: "The Witcher 3", hints: ["Fehér Farkas", "Geralt of Rivia", "CD Projekt Red", "Nyílt világ RPG"] },
  { name: "Cyberpunk 2077", hints: ["Night City", "V főszereplő", "CD Projekt Red", "Futurisztikus RPG"] },
  { name: "Elden Ring", hints: ["FromSoftware", "Nyílt világ souls-like", "George R.R. Martin", "Tarnished főszereplő"] },
  { name: "Red Dead Redemption 2", hints: ["Vadnyugat", "Arthur Morgan", "Rockstar Games", "Nyílt világ western"] },
  { name: "FIFA 24", hints: ["EA Sports", "Ultimate Team", "Focis szimuláció", "Évi megjelenés"] },
  { name: "Call of Duty: Warzone", hints: ["Battle Royale", "Activision", "Gulág visszatérés", "Verdansk térkép"] },
  { name: "Dota 2", hints: ["MOBA játék", "Valve", "Ancient elpusztítása", "5v5 stratégia"] },
  { name: "Terraria", hints: ["2D sandbox", "Bosszok legyőzése", "Re-Logic", "Bányászás és kaland"] },
  { name: "Stardew Valley", hints: ["Farm szimuláció", "ConcernedApe", "Pelican Town", "Gazda élet"] },
  { name: "Fall Guys", hints: ["Party battle royale", "Mediatonic", "Jelly Bean karakterek", "Akadálypályák"] },
  { name: "Hollow Knight", hints: ["Metroidvania", "Team Cherry", "Rovar világ", "Hallownest kingdom"] },
  { name: "Celeste", hints: ["Platformer", "Madeline főszereplő", "Hegymászás", "Nehéz de igazságos"] },
  { name: "Hades", hints: ["Roguelite", "Supergiant Games", "Görög mitológia", "Alvilágból menekülés"] },
  { name: "Sekiro", hints: ["FromSoftware", "Japán shinobi", "Posture rendszer", "Genichiro boss"] },
];

// ─── Szobák tárolása ──────────────────────────────────────────────────────────
const rooms = new Map();

// ─── Session beállítás ────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'titkos_kulcs_csere_le',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Passport sorozatosítás ───────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── Kick OAuth2 stratégia ────────────────────────────────────────────────────
passport.use('kick', new OAuth2Strategy({
  authorizationURL: 'https://id.kick.com/oauth/authorize',
  tokenURL: 'https://id.kick.com/oauth/token',
  clientID: process.env.KICK_CLIENT_ID,
  clientSecret: process.env.KICK_CLIENT_SECRET,
  callbackURL: process.env.KICK_REDIRECT_URI,
  scope: ['user:read'],
  state: true,
},
async (accessToken, refreshToken, profile, done) => {
  try {
    // Kick API-ból felhasználó adatai
    const response = await axios.get('https://api.kick.com/public/v1/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    const userData = response.data;
    const user = {
      id: userData.data?.id || userData.id,
      username: userData.data?.username || userData.username || userData.name,
      avatar: userData.data?.profile_pic || userData.data?.avatar || null,
      accessToken
    };
    return done(null, user);
  } catch (err) {
    console.error('Kick API hiba:', err.message);
    return done(err);
  }
}));

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.get('/auth/kick', passport.authenticate('kick'));

app.get('/auth/kick/callback',
  passport.authenticate('kick', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ loggedIn: true, user: req.user });
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

  io.to(room.id).emit('round_start', {
    round: room.round,
    maxRounds: room.maxRounds,
    hint: randomGame.hints[0],
    hintIndex: 0,
    totalHints: randomGame.hints.length
  });

  // Tipp megjelenítés időzítve
  let hintIdx = 1;
  room.hintInterval = setInterval(() => {
    if (hintIdx < randomGame.hints.length) {
      room.currentHintIndex = hintIdx;
      io.to(room.id).emit('new_hint', {
        hint: randomGame.hints[hintIdx],
        hintIndex: hintIdx
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
});
