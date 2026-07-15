// ── Állapot ──────────────────────────────────────────────────────────────────
const state = {
  socket: null,
  user: null,         // { id, username, avatar }
  roomId: null,
  isReady: false,
  guessedThisRound: false,
  currentRound: 0,
  maxRounds: 5,
  hintTimer: null,
};

// ── Oldal betöltés ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await fetchUser();
  initSocket();
  setupKeyListeners();

  // URL-ben van meghívó kód?
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('room');
  if (inviteCode) {
    history.replaceState({}, '', '/');
    showPage('homePage');
    document.getElementById('joinCodeInput').value = inviteCode.toUpperCase();
    showToast(`🔗 Meghívó: ${inviteCode.toUpperCase()} – csatlakozz!`, 'success');
  }

  const error = params.get('error');
  if (error === 'auth_failed' || error) {
    history.replaceState({}, '', '/');
    const msg = decodeURIComponent(error);
    showToast(`❌ Kick bejelentkezés sikertelen: ${msg}`, 'error');
  }
});

// ── Felhasználó betöltése ─────────────────────────────────────────────────────
async function fetchUser() {
  try {
    const res = await fetch('/api/user');
    const data = await res.json();
    if (data.loggedIn) {
      state.user = data.user;
      renderNavUser(data.user);
    } else {
      renderNavGuest();
    }
  } catch (e) {
    console.error('fetchUser hiba:', e);
    renderNavGuest();
  }
}

function renderNavUser(user) {
  const nav = document.getElementById('navUser');
  const avatarHtml = user.avatar
    ? `<img class="nav-avatar" src="${escHtml(user.avatar)}" alt="Avatar" />`
    : `<div class="nav-avatar" style="background:var(--bg3);display:flex;align-items:center;justify-content:center;">👤</div>`;
  nav.innerHTML = `
    ${avatarHtml}
    <span class="nav-username">${escHtml(user.username)}</span>
    <a href="/auth/logout" class="btn btn-outline" style="font-size:0.8rem;padding:6px 12px;">Kilépés</a>
  `;
}

function renderNavGuest() {
  document.getElementById('navUser').innerHTML = `
    <button class="btn btn-kick" onclick="kickLogin()">
      <img src="https://kick.com/favicon.ico" width="18" height="18" alt="Kick" />
      Bejelentkezés Kick-kel
    </button>
  `;
}

function kickLogin() {
  window.location.href = '/auth/kick';
}

// ── Socket.io init ────────────────────────────────────────────────────────────
function initSocket() {
  state.socket = io();

  state.socket.on('connect', () => {
    console.log('Socket csatlakozva:', state.socket.id);
  });

  state.socket.on('error_msg', (msg) => {
    showToast('❌ ' + msg, 'error');
  });

  // ── Szoba események ──
  state.socket.on('room_created', ({ roomId, room }) => {
    state.roomId = roomId;
    showLobby(room);
    showToast(`✅ Szoba létrehozva: ${roomId}`, 'success');
  });

  state.socket.on('room_joined', ({ roomId, room }) => {
    state.roomId = roomId;
    showLobby(room);
    showToast(`👋 Csatlakoztál a szobához: ${roomId}`, 'success');
  });

  state.socket.on('player_joined', ({ player, room }) => {
    renderPlayerList(room.players, room.host);
    addChatSystem(`👋 ${player.username} csatlakozott`);
  });

  state.socket.on('player_left', ({ room }) => {
    renderPlayerList(room.players, room.host);
    addChatSystem('👋 Egy játékos kilépett');
  });

  state.socket.on('player_updated', ({ room }) => {
    renderPlayerList(room.players, room.host);
  });

  // ── Játék események ──
  state.socket.on('game_started', ({ room }) => {
    state.currentRound = 0;
    state.maxRounds = room.maxRounds;
    showPage('gamePage');
    updateScoreboard(room.players);
    addChatSystem('🎮 A játék elkezdődött!');
  });

  state.socket.on('round_start', ({ round, maxRounds, hint, hintIndex, totalHints, imageUrl, blurPx }) => {
    state.currentRound = round;
    state.guessedThisRound = false;
    clearHints();
    document.getElementById('roundDisplay').textContent = `${round} / ${maxRounds}. kör`;
    document.getElementById('guessInput').disabled = false;
    document.getElementById('guessInput').value = '';
    setFeedback('', '');
    addHint(hint, hintIndex, totalHints);
    setGameImage(imageUrl, blurPx);
    addChatSystem(`🎯 ${round}. kör kezdődik!`);
  });

  state.socket.on('new_hint', ({ hint, hintIndex, blurPx }) => {
    addHint(hint, hintIndex);
    updateImageBlur(blurPx);
  });

  state.socket.on('correct_guess', ({ playerId, username, points, answer, room }) => {
    const isMe = playerId === state.socket.id;
    if (isMe) {
      state.guessedThisRound = true;
      document.getElementById('guessInput').disabled = true;
      setFeedback(`🎉 Helyes! +${points} pont`, 'correct');
    }
    updateScoreboard(room.players);
    addChatSystem(`✅ ${username} kitalálta! (+${points} pont)`);
  });

  state.socket.on('wrong_guess', () => {
    setFeedback('❌ Nem ez! Próbáld újra.', 'wrong');
  });

  state.socket.on('player_guessed', ({ username, guess }) => {
    addChatSystem(`${username}: ${guess}`);
  });

  state.socket.on('round_timeout', ({ answer, room }) => {
    document.getElementById('guessInput').disabled = true;
    setFeedback(`⏰ Idő lejárt! A válasz: ${answer}`, 'info');
    updateScoreboard(room.players);
    addChatSystem(`⏰ A helyes válasz: ${answer}`);
  });

  state.socket.on('next_round_countdown', ({ seconds }) => {
    setFeedback(`⏳ Következő kör ${seconds} másodperc múlva...`, 'info');
  });

  state.socket.on('game_over', ({ leaderboard, winner }) => {
    showGameOver(leaderboard, winner);
  });

  state.socket.on('room_reset', ({ room }) => {
    state.isReady = false;
    showLobby(room);
    showToast('🔄 A szoba visszaállt lobby állapotba.', 'success');
  });

  state.socket.on('chat_message', ({ username, avatar, message }) => {
    addChatMessage(username, avatar, message);
  });
}

// ── Key listeners ─────────────────────────────────────────────────────────────
function setupKeyListeners() {
  document.getElementById('guessInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGuess();
  });
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
  document.getElementById('joinCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
}


// ── Szoba műveletek ───────────────────────────────────────────────────────────
function getUsername() {
  return state.user ? state.user.username : ('Vendég_' + Math.floor(Math.random() * 9000 + 1000));
}
function getAvatar() {
  return state.user ? state.user.avatar : null;
}

function createRoom() {
  state.socket.emit('create_room', {
    username: getUsername(),
    avatar: getAvatar()
  });
}

function joinRoom() {
  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    showToast('❌ Adj meg egy 6 karakteres szoba kódot!', 'error');
    return;
  }
  state.socket.emit('join_room', {
    roomId: code,
    username: getUsername(),
    avatar: getAvatar()
  });
}

function toggleReady() {
  state.isReady = !state.isReady;
  const btn = document.getElementById('readyBtn');
  btn.textContent = state.isReady ? '⏳ Várakozás...' : '✅ Kész vagyok';
  btn.classList.toggle('active', state.isReady);
  state.socket.emit('player_ready');
}

function copyInvite() {
  const url = `${window.location.origin}?room=${state.roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('📋 Meghívó link másolva!', 'success');
  }).catch(() => {
    showToast('Link: ' + url);
  });
}

// ── Tipp küldése ──────────────────────────────────────────────────────────────
function submitGuess() {
  const input = document.getElementById('guessInput');
  const guess = input.value.trim();
  if (!guess) return;
  if (state.guessedThisRound) {
    showToast('Már tippeltél ebben a körben!', 'error');
    return;
  }
  state.socket.emit('submit_guess', { guess });
  input.value = '';
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  state.socket.emit('chat_message', { message: msg });
  input.value = '';
}

function addChatMessage(username, avatar, message) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const avatarHtml = avatar
    ? `<img src="${escHtml(avatar)}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:4px;" />`
    : '';
  div.innerHTML = `${avatarHtml}<span class="chat-author">${escHtml(username)}:</span> ${escHtml(message)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addChatSystem(msg) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = msg;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ── Oldal megjelenítés ────────────────────────────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

function showLobby(room) {
  document.getElementById('roomCodeDisplay').textContent = room.id;
  renderPlayerList(room.players, room.host);
  state.isReady = false;
  const btn = document.getElementById('readyBtn');
  btn.textContent = '✅ Kész vagyok';
  btn.classList.remove('active');
  document.getElementById('chatMessages').innerHTML = '';
  showPage('lobbyPage');
}

function backToLobby() {
  showPage('lobbyPage');
}

// ── Játékosok renderelése ─────────────────────────────────────────────────────
function renderPlayerList(players, hostId) {
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  players.forEach(p => {
    const isHost = p.id === hostId;
    const isMe = p.id === (state.socket && state.socket.id);
    const avatarHtml = p.avatar
      ? `<img class="player-avatar" src="${escHtml(p.avatar)}" alt="avatar" />`
      : `<div class="player-avatar" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">👤</div>`;
    const div = document.createElement('div');
    div.className = 'player-item' + (p.ready ? ' ready' : '');
    div.innerHTML = `
      ${avatarHtml}
      <span class="player-name">${escHtml(p.username)}${isMe ? ' <span style="color:var(--text-muted);font-size:0.8rem;">(Te)</span>' : ''}</span>
      ${isHost ? '<span class="player-badge host">Host</span>' : ''}
      ${p.ready ? '<span class="player-badge ready-badge">✅ Kész</span>' : ''}
    `;
    list.appendChild(div);
  });
}

// ── Ranglista frissítése ──────────────────────────────────────────────────────
function updateScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const list = document.getElementById('scoreList');
  list.innerHTML = '';
  const rankEmojis = ['🥇', '🥈', '🥉'];
  sorted.forEach((p, i) => {
    const isMe = p.id === (state.socket && state.socket.id);
    const avatarHtml = p.avatar
      ? `<img class="score-avatar" src="${escHtml(p.avatar)}" alt="" />`
      : `<div class="score-avatar" style="display:flex;align-items:center;justify-content:center;">👤</div>`;
    const li = document.createElement('li');
    li.className = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
    li.innerHTML = `
      <span class="rank">${rankEmojis[i] || (i + 1)}</span>
      ${avatarHtml}
      <span class="score-name">${escHtml(p.username)}${isMe ? ' <span style="font-size:0.7rem;color:var(--text-muted)">(Te)</span>' : ''}</span>
      <span class="score-pts">${p.score} pt</span>
    `;
    list.appendChild(li);
  });
}

// ── Hint megjelenítés ─────────────────────────────────────────────────────────
function clearHints() {
  document.getElementById('hintList').innerHTML = '';
}

function addHint(hint, index) {
  const ul = document.getElementById('hintList');
  const li = document.createElement('li');
  li.textContent = `#${index + 1} – ${hint}`;
  ul.appendChild(li);
}

// ── Visszajelzés ──────────────────────────────────────────────────────────────
function setFeedback(msg, type) {
  const el = document.getElementById('feedbackMsg');
  el.textContent = msg;
  el.className = 'feedback-msg' + (type ? ' ' + type : '');
}

// ── Játék vége ────────────────────────────────────────────────────────────────
function showGameOver(leaderboard, winner) {
  const winnerText = document.getElementById('winnerText');
  winnerText.textContent = winner
    ? `🏆 Győztes: ${winner.username} (${winner.score} pont)`
    : '🎮 Játék vége!';

  const ul = document.getElementById('finalLeaderboard');
  ul.innerHTML = '';
  const rankEmojis = ['🥇', '🥈', '🥉'];
  leaderboard.forEach((p, i) => {
    const avatarHtml = p.avatar
      ? `<img class="final-avatar" src="${escHtml(p.avatar)}" alt="" />`
      : `<div class="final-avatar" style="display:flex;align-items:center;justify-content:center;">👤</div>`;
    const li = document.createElement('li');
    li.className = i === 0 ? 'first' : '';
    li.innerHTML = `
      <span class="final-rank">${rankEmojis[i] || (i + 1)}</span>
      ${avatarHtml}
      <span class="final-name">${escHtml(p.username)}</span>
      <span class="final-pts">${p.score} pt</span>
    `;
    ul.appendChild(li);
  });

  showPage('gameOverPage');
}

// ── Toast értesítés ───────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ── XSS védelem ───────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Játék képe ────────────────────────────────────────────────────────────────
function setGameImage(imageUrl, blurPx) {
  const img = document.getElementById('gameImage');
  const placeholder = document.getElementById('gameImagePlaceholder');
  const wrap = document.getElementById('gameImageWrap');

  if (!imageUrl) {
    img.style.display = 'none';
    placeholder.style.display = 'flex';
    placeholder.textContent = '🖼️ Nincs kép';
    return;
  }

  placeholder.style.display = 'flex';
  placeholder.textContent = '🖼️ Betöltés...';
  img.style.display = 'none';

  img.onload = () => {
    placeholder.style.display = 'none';
    img.style.display = 'block';
    img.style.filter = `blur(${blurPx}px)`;
    img.style.transition = 'filter 1s ease';
  };
  img.onerror = () => {
    placeholder.textContent = '🖼️ Kép nem elérhető';
  };
  img.src = imageUrl;
}

function updateImageBlur(blurPx) {
  const img = document.getElementById('gameImage');
  if (img && img.style.display !== 'none') {
    img.style.filter = `blur(${blurPx}px)`;
  }
}
