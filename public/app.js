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
document.addEventListener('DOMContentLoaded', () => {
  loadUsername();
  loadCategories();
  initSocket();
  setupKeyListeners();

  // URL-ben van meghívó kód?
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('room');
  const invitePw   = params.get('pw');
  if (inviteCode) {
    history.replaceState({}, '', '/');
    showPage('homePage');
    document.getElementById('joinCodeInput').value = inviteCode.toUpperCase();
    if (invitePw) document.getElementById('joinPasswordInput').value = decodeURIComponent(invitePw);
    showToast(`🔗 Meghívó: ${inviteCode.toUpperCase()} – csatlakozz!`, 'success');
  }

  // Enter a modal inputban
  document.getElementById('usernameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveUsername();
  });
});

// ── Kategóriák betöltése ──────────────────────────────────────────────────────
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const cats = await res.json();
    const sel = document.getElementById('categorySelect');
    sel.innerHTML = '';
    Object.entries(cats).forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error('Kategória betöltési hiba:', e);
  }
}

// ── Szoba beállítások ─────────────────────────────────────────────────────────
function updateSettings() {
  const category  = document.getElementById('categorySelect').value;
  const maxRounds = parseInt(document.getElementById('roundsValue').textContent);
  state.socket.emit('update_settings', { maxRounds, category });
}

function changeRounds(delta) {
  const el = document.getElementById('roundsValue');
  let val = parseInt(el.textContent) + delta;
  val = Math.max(5, Math.min(30, val));
  el.textContent = val;
  updateSettings();
}

function applySettings(room, isHost) {
  document.getElementById('roundsValue').textContent = room.maxRounds;
  const sel = document.getElementById('categorySelect');
  if (sel) sel.value = room.category || 'all';

  const panel = document.getElementById('settingsPanel');
  const note  = document.getElementById('settingsNote');
  if (isHost) {
    panel.classList.remove('readonly');
    note.textContent = '⚙️ Te vagy a host – te állítod be a játékot.';
  } else {
    panel.classList.add('readonly');
    note.textContent = '👁️ Csak a host változtathatja a beállításokat.';
  }
}

// ── Felhasználónév kezelés (localStorage) ────────────────────────────────────
function loadUsername() {
  const saved = localStorage.getItem('gg_username');
  if (saved) {
    state.user = { id: null, username: saved, avatar: null };
    renderNavUser(saved);
  } else {
    // Első látogatás – azonnal kéri a nevet
    setTimeout(() => openUsernameModal(), 300);
  }
}

function renderNavUser(username) {
  document.getElementById('navUser').innerHTML = `
    <span style="font-size:1.2rem;">👤</span>
    <span class="nav-username">${escHtml(username)}</span>
    <button class="btn btn-outline" style="font-size:0.8rem;padding:6px 12px;" onclick="openUsernameModal()">✏️ Szerkesztés</button>
  `;
}

// ── Modal kezelés ─────────────────────────────────────────────────────────────
function openUsernameModal() {
  const current = state.user?.username || '';
  document.getElementById('usernameInput').value = current;
  document.getElementById('usernameModal').classList.add('open');
  setTimeout(() => document.getElementById('usernameInput').focus(), 50);
}

function closeModal() {
  document.getElementById('usernameModal').classList.remove('open');
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('usernameModal')) closeModal();
}

function saveUsername() {
  const input = document.getElementById('usernameInput');
  const name = input.value.trim();
  if (!name || name.length < 2) {
    showToast('❌ A név legalább 2 karakter legyen!', 'error');
    return;
  }
  if (name.length > 20) {
    showToast('❌ Maximum 20 karakter!', 'error');
    return;
  }
  localStorage.setItem('gg_username', name);
  state.user = { id: null, username: name, avatar: null };
  renderNavUser(name);
  closeModal();
  showToast(`✅ Név beállítva: ${name}`, 'success');
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
  state.socket.on('room_created', ({ roomId, password, room }) => {
    state.roomId = roomId;
    state.roomPassword = password;
    showLobby(room, password);
    showToast(`✅ Szoba létrehozva: ${roomId} | Jelszó: ${password}`, 'success');
  });

  state.socket.on('room_joined', ({ roomId, room }) => {
    state.roomId = roomId;
    showLobby(room, document.getElementById('joinPasswordInput').value.trim());
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

  state.socket.on('settings_updated', ({ maxRounds, category, categoryName }) => {
    document.getElementById('roundsValue').textContent = maxRounds;
    const sel = document.getElementById('categorySelect');
    if (sel) sel.value = category;
    addChatSystem(`⚙️ Beállítás: ${maxRounds} kör | ${categoryName}`);
  });

  // ── Játék események ──
  state.socket.on('game_started', ({ room }) => {
    state.currentRound = 0;
    state.maxRounds = room.maxRounds;
    showPage('gamePage');
    updateScoreboard(room.players);
    addChatSystem('🎮 A játék elkezdődött!');
  });

  state.socket.on('round_start', ({ round, maxRounds, hint, hintIndex, totalHints, imageUrl, duration }) => {
    state.currentRound = round;
    state.guessedThisRound = false;
    clearHints();
    document.getElementById('answerOverlay').classList.remove('show');
    document.getElementById('roundDisplay').textContent = `${round} / ${maxRounds}. kör`;
    document.getElementById('guessInput').disabled = false;
    document.getElementById('guessInput').value = '';
    setFeedback('', '');
    addHint(hint, hintIndex, totalHints);
    setGameImage(imageUrl, 24);
    startTimer(duration);
    startBlurTimer(duration);
    addChatSystem(`🎯 ${round}. kör kezdődik!`);
  });

  state.socket.on('new_hint', ({ hint, hintIndex }) => {
    addHint(hint, hintIndex);
  });

  state.socket.on('correct_guess', ({ playerId, username, points, answer, room }) => {
    const isMe = playerId === state.socket.id;
    if (isMe) {
      state.guessedThisRound = true;
      document.getElementById('guessInput').disabled = true;
      setFeedback(`🎉 Helyes! +${points} pont`, 'correct');
      stopTimer();
      showAnswerOverlay(answer, points);
    }
    // Ha mindenki kitalálta, a kép élesre vált
    if (room.players.every(p => p.score > 0 || playerId === p.id)) {
      updateImageBlur(0);
      stopBlurTimer();
    }
    updateScoreboard(room.players);
    addChatSystem(`✅ ${username} kitalálta! (+${points} pont)`);
  });

  state.socket.on('wrong_guess', ({ guess, closeHint, penalty }) => {
    const penaltyTxt = penalty ? ` (-${penalty} pont)` : '';
    if (closeHint) {
      setFeedback(`❌ Nem ez!${penaltyTxt} ${closeHint}`, 'close');
    } else {
      setFeedback(`❌ Nem ez!${penaltyTxt} Próbáld újra.`, 'wrong');
    }
  });

  state.socket.on('score_updated', ({ room }) => {
    updateScoreboard(room.players);
  });

  state.socket.on('player_guessed', ({ username, guess }) => {
    addChatSystem(`${username}: ${guess}`);
  });

  state.socket.on('round_timeout', ({ answer, room }) => {
    document.getElementById('guessInput').disabled = true;
    stopTimer();
    updateImageBlur(0);
    setFeedback(`⏰ Idő lejárt! A válasz: ${answer}`, 'info');
    updateScoreboard(room.players);
    addChatSystem(`⏰ A helyes válasz: ${answer}`);
    showAnswerOverlay(answer, null); // null = nem szerzett pontot
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
  if (state.user?.username) return state.user.username;
  // Ha még nincs neve, kéri be
  openUsernameModal();
  return null;
}
function getAvatar() {
  return state.user?.avatar || null;
}

function createRoom() {
  const name = getUsername();
  if (!name) { showToast('⚠️ Először állíts be egy nevet!', 'error'); return; }

  const pw = document.getElementById('createPasswordInput').value.trim();
  if (pw.length > 0 && (pw.length < 2 || pw.length > 15)) {
    showToast('❌ A jelszó 2–15 karakter legyen!', 'error');
    return;
  }
  state.socket.emit('create_room', { username: name, avatar: getAvatar(), password: pw });
}

function joinRoom() {
  const name = getUsername();
  if (!name) { showToast('⚠️ Először állíts be egy nevet!', 'error'); return; }

  const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    showToast('❌ Adj meg egy 6 karakteres szoba kódot!', 'error');
    return;
  }
  const pw = document.getElementById('joinPasswordInput').value.trim();
  if (!pw) {
    showToast('❌ Add meg a szoba jelszavát!', 'error');
    return;
  }
  state.socket.emit('join_room', { roomId: code, username: name, avatar: getAvatar(), password: pw });
}

function toggleReady() {
  state.isReady = !state.isReady;
  const btn = document.getElementById('readyBtn');
  btn.textContent = state.isReady ? '⏳ Várakozás...' : '✅ Kész vagyok';
  btn.classList.toggle('active', state.isReady);
  state.socket.emit('player_ready');
}

function copyInvite() {
  const pw = document.getElementById('roomPasswordDisplay').textContent;
  const url = `${window.location.origin}?room=${state.roomId}&pw=${encodeURIComponent(pw)}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('📋 Meghívó link másolva! (kód + jelszó)', 'success');
  }).catch(() => showToast('Link: ' + url));
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

function showLobby(room, password) {
  document.getElementById('roomCodeDisplay').textContent = room.id;
  document.getElementById('roomPasswordDisplay').textContent = password || '–';
  renderPlayerList(room.players, room.host);
  const isHost = room.host === (state.socket && state.socket.id);
  applySettings(room, isHost);
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

// ── Helyes válasz overlay ─────────────────────────────────────────────────────
let overlayTimeout = null;

function showAnswerOverlay(answer, points) {
  const overlay  = document.getElementById('answerOverlay');
  const nameEl   = document.getElementById('overlayAnswerName');
  const pointsEl = document.getElementById('overlayPoints');

  nameEl.textContent = answer;

  if (points !== null && points !== undefined) {
    pointsEl.textContent = `+${points} pont 🏆`;
    pointsEl.style.color = '#ffd700';
  } else {
    pointsEl.textContent = '⏰ Nem sikerült – 0 pont';
    pointsEl.style.color = 'var(--danger)';
  }

  overlay.classList.add('show');

  // 3 másodperc után automatikusan eltűnik
  clearTimeout(overlayTimeout);
  overlayTimeout = setTimeout(() => {
    overlay.classList.remove('show');
  }, 3000);
}

// ── Visszaszámláló timer ──────────────────────────────────────────────────────
let timerInterval = null;
let blurInterval  = null;

function startTimer(duration) {
  stopTimer();
  const el = document.getElementById('timerDisplay');
  let remaining = duration;

  function tick() {
    if (remaining <= 0) {
      el.textContent = '⏰ 0s';
      el.style.color = 'var(--danger)';
      stopTimer();
      return;
    }
    el.textContent = `⏱ ${remaining}s`;
    if (remaining > 15) {
      el.style.color = 'var(--accent)';
    } else if (remaining > 7) {
      el.style.color = '#ffd700';
    } else {
      el.style.color = 'var(--danger)';
    }
    remaining--;
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

function startBlurTimer(duration) {
  stopBlurTimer();
  const maxBlur  = 24;          // px induláskor
  const clearAt  = duration / 2; // 30mp-ből 15mp alatt teljesen éles
  let elapsed = 0;

  blurInterval = setInterval(() => {
    elapsed++;
    const ratio = Math.min(elapsed / clearAt, 1);  // 0→1 az első 15mp alatt
    const blur  = Math.round(maxBlur - ratio * maxBlur);
    updateImageBlur(blur);
    if (elapsed >= clearAt) stopBlurTimer(); // 15mp után leáll, kép éles marad
  }, 1000);
}

function stopBlurTimer() {
  if (blurInterval) {
    clearInterval(blurInterval);
    blurInterval = null;
  }
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  stopBlurTimer();
  const el = document.getElementById('timerDisplay');
  if (el) el.textContent = '';
}
