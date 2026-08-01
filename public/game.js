// ============================================================================
// TANKS MULTIPLAYER 3D — CLIENT (Three.js)
// Камера от третьего лица следует за танком. При зажатой ПКМ включается
// прицел от первого лица: камера переезжает на башню, FOV сужается (зум),
// мышь напрямую вращает башню через Pointer Lock API.
// ============================================================================

// ---------------------------------------------------------------------------
// СЦЕНА, КАМЕРА, РЕНДЕРЕР
// ---------------------------------------------------------------------------
const sceneContainer = document.getElementById('sceneContainer');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc1e0);

const NORMAL_FOV = 65;
const SCOPE_FOV = 20;
const camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 3000);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); // ограничиваем нагрузку на retina-экранах
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneContainer.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// СВЕТ
// ---------------------------------------------------------------------------
const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x3a6b3d, 0.5);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
sunLight.position.set(300, 500, 200);
sunLight.castShadow = true;
sunLight.shadow.bias = -0.0005;
sunLight.shadow.camera.left = -800;
sunLight.shadow.camera.right = 800;
sunLight.shadow.camera.top = 800;
sunLight.shadow.camera.bottom = -800;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);

// Вспышка у дула (общий свет для всех выстрелов)
const muzzleLight = new THREE.PointLight(0xffaa44, 0, 240);
muzzleLight.position.set(0, 30, 0);
scene.add(muzzleLight);

// ---------------------------------------------------------------------------
// НАСТРОЙКИ ГРАФИКИ
// ---------------------------------------------------------------------------
const settingsState = { quality: 'high', shadows: true, effects: true, fov: 65, volume: 0.7 };
try {
  Object.assign(settingsState, JSON.parse(localStorage.getItem('tanksGraphics') || '{}'));
} catch (e) { /* ignore */ }
const QUALITY_PIXEL_RATIO = { low: 1, medium: 1.25, high: 1.75 };
let normalFov = settingsState.fov || NORMAL_FOV;

function saveGraphicsSettings() {
  try { localStorage.setItem('tanksGraphics', JSON.stringify(settingsState)); } catch (e) { /* ignore */ }
}

function applyGraphicsSettings() {
  const shadows = settingsState.shadows && settingsState.quality !== 'low';
  renderer.shadowMap.enabled = shadows;
  sunLight.castShadow = shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_PIXEL_RATIO[settingsState.quality]));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (settingsState.fov) {
    normalFov = settingsState.fov;
    camera.fov = normalFov;
    camera.updateProjectionMatrix();
  }
}

function initSettingsUI() {
  const settingsBtn = document.getElementById('settingsBtn');
  const menuSettingsBtn = document.getElementById('menuSettingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const shadowsToggle = document.getElementById('shadowsToggle');
  const effectsToggle = document.getElementById('effectsToggle');
  const fovSlider = document.getElementById('fovSlider');
  const volumeSlider = document.getElementById('volumeSlider');

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('hidden');
  });
  menuSettingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.remove('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && e.target !== menuSettingsBtn) {
      settingsPanel.classList.add('hidden');
    }
  });
  document.querySelectorAll('[data-quality]').forEach(btn => {
    btn.addEventListener('click', () => {
      settingsState.quality = btn.dataset.quality;
      saveGraphicsSettings();
      applyGraphicsSettings();
      updateSettingsUI();
    });
  });
  shadowsToggle.addEventListener('change', () => {
    settingsState.shadows = shadowsToggle.checked;
    saveGraphicsSettings();
    applyGraphicsSettings();
  });
  effectsToggle.addEventListener('change', () => {
    settingsState.effects = effectsToggle.checked;
    saveGraphicsSettings();
  });
  fovSlider.addEventListener('input', () => {
    settingsState.fov = Number(fovSlider.value);
    saveGraphicsSettings();
    applyGraphicsSettings();
  });
  volumeSlider.addEventListener('input', () => {
    settingsState.volume = Number(volumeSlider.value) / 100;
    saveGraphicsSettings();
    shotSound.volume = settingsState.volume;
  });

  function updateSettingsUI() {
    document.querySelectorAll('[data-quality]').forEach(b => b.classList.toggle('active', b.dataset.quality === settingsState.quality));
    shadowsToggle.checked = settingsState.shadows;
    effectsToggle.checked = settingsState.effects;
    fovSlider.value = settingsState.fov;
    volumeSlider.value = Math.round(settingsState.volume * 100);
  }
  window.updateSettingsUI = updateSettingsUI;
  updateSettingsUI();
}

applyGraphicsSettings();
initSettingsUI();

// ---------------------------------------------------------------------------
// МИР (заполняется после получения init от сервера)
// ---------------------------------------------------------------------------
let world = { width: 2000, depth: 2000 };
let obstaclesData = [];
let maxHp = 100;

function buildGround() {
  const geo = new THREE.PlaneGeometry(world.width, world.depth);
  const grassTex = new THREE.TextureLoader().load('texture/grass-6.jpg');
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(80, 80);
  grassTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mat = new THREE.MeshStandardMaterial({ map: grassTex });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(world.width / 2, 0, world.depth / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // Стены-границы карты (невысокие, чтобы обозначить край)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc0392b });
  const wallHeight = 20, wallThickness = 6;
  const walls = [
    { x: world.width / 2, z: 0, w: world.width, d: wallThickness },
    { x: world.width / 2, z: world.depth, w: world.width, d: wallThickness },
    { x: 0, z: world.depth / 2, w: wallThickness, d: world.depth },
    { x: world.width, z: world.depth / 2, w: wallThickness, d: world.depth },
  ];
  walls.forEach(w => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, wallHeight, w.d), wallMat);
    mesh.position.set(w.x, wallHeight / 2, w.z);
    mesh.castShadow = true;
    scene.add(mesh);
  });
}

function buildObstacles() {
  obstaclesData.forEach(o => {
    let mesh;

    if (o.type === 'rock') {
      const r = Math.max(o.w, o.d) * 0.45;
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a8a }));
      mesh.position.set(o.x + o.w / 2, r * 0.7, o.z + o.d / 2);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.scale.y = 0.75;
    } else if (o.type === 'crate') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 16, o.d), new THREE.MeshStandardMaterial({ color: 0xa0522d }));
      mesh.position.set(o.x + o.w / 2, 8, o.z + o.d / 2);
    } else if (o.type === 'tree') {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.5, 14, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }));
      trunk.position.y = 7;
      tree.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(10, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2f8a3c }));
      crown.position.y = 20;
      tree.add(crown);
      tree.position.set(o.x + o.w / 2, 0, o.z + o.d / 2);
      mesh = tree;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 40, o.d), new THREE.MeshStandardMaterial({ color: 0x6b6b6b }));
      mesh.position.set(o.x + o.w / 2, 20, o.z + o.d / 2);
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
}

// ---------------------------------------------------------------------------
// ФАБРИКА ТАНКА (корпус + независимо вращаемая башня + дуло)
// ---------------------------------------------------------------------------
function createTankMesh(color) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

  // Корпус
  const body = new THREE.Mesh(new THREE.BoxGeometry(28, 14, 40), bodyMat);
  body.position.y = 10;
  body.castShadow = true;
  group.add(body);

  // Гусеницы (декоративные)
  [-1, 1].forEach(side => {
    const track = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 44), darkMat);
    track.position.set(side * 15, 7, 0);
    track.castShadow = true;
    group.add(track);
  });

  // Башня (вращается независимо от корпуса) — отдельная группа-пивот
  const turretPivot = new THREE.Group();
  turretPivot.position.y = 17;
  group.add(turretPivot);

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 12, 16), bodyMat);
  turret.rotation.y = 0;
  turret.castShadow = true;
  turretPivot.add(turret);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 12), darkMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1, 20); // дуло смотрит по +Z (вперёд), сдвинуто вперёд от центра
  barrel.castShadow = true;
  turretPivot.add(barrel);

  group.userData.turretPivot = turretPivot;
  group.userData.barrel = barrel;
  group.userData.barrelTipLocal = new THREE.Vector3(0, 18, 34); // точка для камеры прицела

  return group;
}

// ---------------------------------------------------------------------------
// СОСТОЯНИЕ КЛИЕНТА / СЕТИ
// ---------------------------------------------------------------------------
let socket = null;
let selfId = null;

let currentState = { players: [], bullets: [] };
const RENDER_DELAY = 100; // мс — рендерим мир с фиксированной задержкой (буфер интерполяции)
const stateBuffer = [];    // { time, state } — последние состояния от сервера

const tankMeshes = new Map();   // id -> THREE.Group
const bulletMeshes = new Map(); // id -> THREE.Mesh

let wasAlive = true;

// ---------------------------------------------------------------------------
// ЭКРАН ВВОДА НИКА
// ---------------------------------------------------------------------------
const nicknameOverlay = document.getElementById('nicknameOverlay');
const nicknameInput = document.getElementById('nicknameInput');
const startBtn = document.getElementById('startBtn');

const TANK_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6fa4'];
let selectedColor = null;

function buildColorPicker() {
  const wrap = document.getElementById('colorSwatches');
  TANK_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch';
    s.style.background = c;
    s.dataset.color = c;
    s.addEventListener('click', () => {
      selectedColor = c;
      wrap.querySelectorAll('.swatch').forEach(x => x.classList.toggle('selected', x === s));
    });
    wrap.appendChild(s);
  });
}
buildColorPicker();

nicknameInput.focus();
startBtn.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

function startGame() {
  const nickname = nicknameInput.value.trim();
  unlockAudio(); // разблокируем звук по жесту пользователя
  nicknameOverlay.classList.add('hidden');
  connectToServer(nickname, selectedColor);
}

// ---------------------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К СЕРВЕРУ
// ---------------------------------------------------------------------------
function connectToServer(nickname, color) {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join', { nickname, color });
  });

  socket.on('init', (data) => {
    selfId = data.selfId;
    world = data.world;
    obstaclesData = data.obstacles;
    maxHp = data.maxHp;
    buildGround();
    buildObstacles();
  });

  socket.on('state', (state) => {
    stateBuffer.push({ time: Date.now(), state });
    const cutoff = Date.now() - RENDER_DELAY;
    while (stateBuffer.length > 2 && stateBuffer[1].time <= cutoff) stateBuffer.shift();
    currentState = state;
    updateHUD();
    updateLeaderboard();
    checkDeathScreen();
  });

  socket.on('offerUpgrade', (options) => {
    showUpgradeChoice(options);
  });

  socket.on('hit', (data) => {
    spawnExplosion(data.x, data.z);
    if (data.barrel) breakOffBarrel(data.id);
  });

  socket.on('bulletBlocked', (data) => {
    spawnSpark(data.x, data.z);
    if (data.ownerId === selfId) showDamageText(data.x, data.z, 'НЕ ПРОБИТ', '#ffb84d');
  });

  socket.on('latencyRes', () => {
    pingMs = Date.now() - pingSentAt;
  });
}

// Замер пинга каждую секунду
let pingMs = null;
let pingSentAt = 0;
setInterval(() => {
  if (!socket || !socket.connected || !selfId) return;
  pingSentAt = Date.now();
  socket.emit('latencyReq');
}, 1000);

// ---------------------------------------------------------------------------
// ВВОД: клавиатура
// ---------------------------------------------------------------------------
const keys = { forward: false, back: false, left: false, right: false, shooting: false, camLeft: false, camRight: false };

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = true; break;
    case 'KeyS': case 'ArrowDown': keys.back = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'KeyQ': keys.camLeft = true; break;
    case 'KeyE': keys.camRight = true; break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = false; break;
    case 'KeyS': case 'ArrowDown': keys.back = false; break;
    case 'KeyA': case 'ArrowLeft': keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'KeyQ': keys.camLeft = false; break;
    case 'KeyE': keys.camRight = false; break;
  }
});

// ---------------------------------------------------------------------------
// ВВОД: мышь и режим прицела от первого лица (Pointer Lock)
// ---------------------------------------------------------------------------
let targetTurretAngle = 0;   // угол башни в мировых координатах (что отправляем на сервер)
let scopePitch = 0;          // наклон камеры в режиме прицела (косметика, только клиент)
let isScoped = false;

const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let mouseNDC = new THREE.Vector2(0, 0);

// Обычный режим: наводим башню рейкастом мыши на землю
window.addEventListener('mousemove', (e) => {
  if (isScoped) {
    // Pointer Lock режим: вращаем башню напрямую через движение мыши
    const sensitivity = 0.0022;
    targetTurretAngle -= e.movementX * sensitivity;
    scopePitch -= e.movementY * sensitivity;
    scopePitch = Math.max(-0.35, Math.min(0.45, scopePitch));
  } else {
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }
});

window.addEventListener('mousedown', (e) => {
  if (e.target.closest('#settingsPanel, #settingsBtn')) return;
  if (e.button === 0) keys.shooting = true;
  if (e.button === 2) enterScope();
});
window.addEventListener('mouseup', (e) => {
  if (e.target.closest('#settingsPanel, #settingsBtn')) return;
  if (e.button === 0) keys.shooting = false;
  if (e.button === 2) exitScope();
});
window.addEventListener('contextmenu', (e) => e.preventDefault()); // отключаем контекстное меню ПКМ

// Вращение камеры колесом (зум) и Q/E (орбита)
let camOrbit = 0;
let camDist = 75;
let camHeight = 40;
window.addEventListener('wheel', (e) => {
  if (e.target.closest('#settingsPanel, #settingsBtn')) return;
  camDist = Math.max(30, Math.min(160, camDist + Math.sign(e.deltaY) * 8));
  camHeight = 22 + (camDist - 30) * 0.32;
}, { passive: true });

const scopeOverlay = document.getElementById('scopeOverlay');

function enterScope() {
  isScoped = true;
  scopeOverlay.classList.remove('hidden');
  renderer.domElement.requestPointerLock();
}

function exitScope() {
  isScoped = false;
  scopeOverlay.classList.add('hidden');
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

document.addEventListener('pointerlockchange', () => {
  // Если браузер сам снял pointer lock (например, Esc) — выходим из прицела визуально
  if (document.pointerLockElement !== renderer.domElement && isScoped) {
    isScoped = false;
    scopeOverlay.classList.add('hidden');
  }
});

// Отправка ввода на сервер с фиксированной частотой
setInterval(() => {
  if (!socket || !selfId) return;

  // В обычном режиме считаем целевой угол башни через рейкаст мыши на землю
  if (!isScoped) {
    const me = currentState.players.find(p => p.id === selfId);
    if (me) {
      raycaster.setFromCamera(mouseNDC, camera);
      const hitPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        const dx = hitPoint.x - me.x;
        const dz = hitPoint.z - me.z;
        targetTurretAngle = Math.atan2(dx, dz);
      }
    }
  }

  socket.emit('input', {
    forward: keys.forward,
    back: keys.back,
    left: keys.left,
    right: keys.right,
    targetTurretAngle,
    shooting: keys.shooting,
  });
}, 1000 / 60);

// ---------------------------------------------------------------------------
// HUD: полоса здоровья
// ---------------------------------------------------------------------------
const hpBarFill = document.getElementById('hpBarFill');
const hpText = document.getElementById('hpText');
const reloadBarFill = document.getElementById('reloadBarFill');
const reloadText = document.getElementById('reloadText');
const pingText = document.getElementById('pingText');
let lastHp = null;
let lastShotAt = -Infinity;

function updateHUD() {
  const me = currentState.players.find(p => p.id === selfId);
  if (!me) return;

  // Пинг
  if (pingMs == null) {
    pingText.textContent = 'Пинг: —';
  } else {
    pingText.textContent = `Пинг: ${pingMs} мс`;
    pingText.style.color = pingMs < 80 ? '#2ecc71' : pingMs < 160 ? '#f1c40f' : '#e74c3c';
  }

  if (lastHp !== null && me.hp < lastHp) addShake(1.1); // попали — трясём камеру
  lastHp = me.hp;

  const pct = Math.max(0, me.hp / me.maxHp) * 100;
  hpBarFill.style.width = pct + '%';
  hpText.textContent = `${Math.max(0, Math.round(me.hp))} / ${me.maxHp}`;

  if (pct > 50) hpBarFill.style.background = 'linear-gradient(90deg, #27ae60, #2ecc71)';
  else if (pct > 20) hpBarFill.style.background = 'linear-gradient(90deg, #f39c12, #f1c40f)';
  else hpBarFill.style.background = 'linear-gradient(90deg, #c0392b, #e74c3c)';

  // Перезарядка
  const reloadMs = me.reloadMs || 2000;
  const progress = Math.max(0, Math.min(1, (Date.now() - lastShotAt) / reloadMs));
  reloadBarFill.style.width = (progress * 100) + '%';
  if (progress >= 1) {
    reloadBarFill.style.background = '#2ecc71';
    reloadText.textContent = 'ГОТОВО';
  } else {
    reloadBarFill.style.background = '#f39c12';
    reloadText.textContent = 'ПЕРЕЗАРЯДКА';
  }
}

// ---------------------------------------------------------------------------
// Лидерборд
// ---------------------------------------------------------------------------
const leaderboardList = document.getElementById('leaderboardList');
let lastLeaderboardRender = 0;

function updateLeaderboard() {
  const now = Date.now();
  if (now - lastLeaderboardRender < 200) return; // не чаще 5 раз/сек
  lastLeaderboardRender = now;
  const sorted = [...currentState.players].sort((a, b) => b.kills - a.kills).slice(0, 10);
  leaderboardList.innerHTML = sorted.map(p => `
    <li class="${p.id === selfId ? 'me' : ''}">
      <span class="name">${escapeHtml(p.nickname)}</span>
      <span>${p.kills} 🎯</span>
    </li>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Выбор прокачки
// ---------------------------------------------------------------------------
const upgradeOverlay = document.getElementById('upgradeOverlay');
const upgradeOptions = document.getElementById('upgradeOptions');

function showUpgradeChoice(options) {
  upgradeOptions.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'upgradeChoice';
    btn.textContent = opt.name;
    btn.addEventListener('click', () => {
      socket.emit('chooseUpgrade', opt.id);
      upgradeOverlay.classList.add('hidden');
    });
    upgradeOptions.appendChild(btn);
  });
  upgradeOverlay.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Экран смерти
// ---------------------------------------------------------------------------
const deathOverlay = document.getElementById('deathOverlay');
const respawnTimer = document.getElementById('respawnTimer');
let deathShownAt = 0;

function checkDeathScreen() {
  const me = currentState.players.find(p => p.id === selfId);
  if (!me) return;

  if (!me.alive && wasAlive) {
    deathShownAt = Date.now();
    deathOverlay.classList.remove('hidden');
    exitScope();
  }
  if (me.alive && !wasAlive) {
    deathOverlay.classList.add('hidden');
  }
  wasAlive = me.alive;

  if (!me.alive) {
    const elapsed = (Date.now() - deathShownAt) / 1000;
    const remaining = Math.max(0, Math.ceil(2.5 - elapsed));
    respawnTimer.textContent = `Возрождение через ${remaining}...`;
  }
}

// ---------------------------------------------------------------------------
// ИНТЕРПОЛЯЦИЯ СОСТОЯНИЯ
// ---------------------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAngleShort(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function getInterpolatedPlayers() {
  if (stateBuffer.length === 0) return [];
  const renderTime = Date.now() - RENDER_DELAY;
  const a = stateBuffer[0];
  const b = stateBuffer[1];
  if (!b || a.time >= b.time) return a.state.players;

  let t = (renderTime - a.time) / (b.time - a.time);
  t = Math.max(0, Math.min(1, t));

  return b.state.players.map(cur => {
    const prev = a.state.players.find(p => p.id === cur.id) || cur;
    return {
      ...cur,
      x: lerp(prev.x, cur.x, t),
      z: lerp(prev.z, cur.z, t),
      chassisAngle: lerpAngleShort(prev.chassisAngle, cur.chassisAngle, t),
      turretAngle: lerpAngleShort(prev.turretAngle, cur.turretAngle, t),
    };
  });
}

function getInterpolatedBullets() {
  if (stateBuffer.length === 0) return [];
  const renderTime = Date.now() - RENDER_DELAY;
  const a = stateBuffer[0];
  const b = stateBuffer[1];
  if (!b || a.time >= b.time) return a.state.bullets;

  let t = (renderTime - a.time) / (b.time - a.time);
  t = Math.max(0, Math.min(1, t));

  return b.state.bullets.map(cur => {
    const prev = a.state.bullets.find(bul => bul.id === cur.id);
    if (prev) {
      return { ...cur, x: lerp(prev.x, cur.x, t), z: lerp(prev.z, cur.z, t), dirX: cur.x - prev.x, dirZ: cur.z - prev.z };
    }
    return { ...cur, x: cur.x, z: cur.z, dirX: 0, dirZ: 0 };
  });
}

// ---------------------------------------------------------------------------
// СИНХРОНИЗАЦИЯ 3D-МЕШЕЙ С СОСТОЯНИЕМ
// ---------------------------------------------------------------------------
function syncTanks(players) {
  const seenIds = new Set();

  players.forEach(p => {
    seenIds.add(p.id);
    let mesh = tankMeshes.get(p.id);

    if (!mesh) {
      mesh = createTankMesh(p.color);
      scene.add(mesh);
      tankMeshes.set(p.id, mesh);
    }

    if (!p.alive) {
      // Уничтожен: корпус остаётся обломком, башня уже взлетела
      if (!mesh.userData.wrecked) {
        mesh.userData.wrecked = true;
        destroyTank(mesh);
      }
      return;
    }

    // Возродился — пересоздаём целый танк
    if (mesh.userData.wrecked) {
      scene.remove(mesh);
      mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
      tankMeshes.delete(p.id);
      mesh = createTankMesh(p.color);
      scene.add(mesh);
      tankMeshes.set(p.id, mesh);
    }

    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.chassisAngle;
    mesh.userData.turretPivot.rotation.y = p.turretAngle - p.chassisAngle;
  });

  // Удаляем меши отключившихся игроков
  for (const [id, mesh] of tankMeshes) {
    if (!seenIds.has(id)) {
      scene.remove(mesh);
      tankMeshes.delete(id);
    }
  }
}

function syncBullets(bullets) {
  const seenIds = new Set();
  const bulletGeo = getSharedBulletGeometry();

  bullets.forEach(b => {
    seenIds.add(b.id);
    let mesh = bulletMeshes.get(b.id);

    if (!mesh) {
      const mat = new THREE.MeshBasicMaterial({ color: b.color || '#ffffff' });
      mesh = new THREE.Mesh(bulletGeo, mat);
      scene.add(mesh);
      bulletMeshes.set(b.id, mesh);
      spawnMuzzleFlash(b.x, b.z);
      if (b.ownerId === selfId) {
        addShake(0.35); // отдача при своём выстреле
        playShotSound();
        lastShotAt = Date.now();
      }
    }

    mesh.position.set(b.x, 18, b.z);
    const dirLen = Math.hypot(b.dirX || 0, b.dirZ || 0);
    if (dirLen > 0.01) {
      mesh.rotation.y = Math.atan2(b.dirX, b.dirZ);
      mesh.scale.set(1, 1, 6); // трассер — вытягиваем пулю по направлению полёта
    } else {
      mesh.scale.set(1, 1, 1);
    }
  });

  for (const [id, mesh] of bulletMeshes) {
    if (!seenIds.has(id)) {
      scene.remove(mesh);
      mesh.geometry.dispose?.();
      mesh.material.dispose();
      bulletMeshes.delete(id);
    }
  }
}

let sharedBulletGeo = null;
function getSharedBulletGeometry() {
  if (!sharedBulletGeo) sharedBulletGeo = new THREE.SphereGeometry(2.5, 8, 8);
  return sharedBulletGeo;
}

// ---------------------------------------------------------------------------
// ЭФФЕКТ ВЫСТРЕЛА: вспышка у дула + тряска камеры
// ---------------------------------------------------------------------------
const muzzleFlashes = [];
const flashGeo = new THREE.SphereGeometry(6, 8, 8);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true });
const FLASH_LIFE_MS = 90;

function spawnMuzzleFlash(x, z) {
  if (!settingsState.effects) return;
  const mesh = new THREE.Mesh(flashGeo, flashMat.clone());
  mesh.position.set(x, 18, z);
  scene.add(mesh);
  muzzleFlashes.push({ mesh, born: performance.now() });
  muzzleLight.position.set(x, 26, z);
  muzzleLight.intensity = 3;
}

function updateMuzzleFlashes() {
  const now = performance.now();
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const f = muzzleFlashes[i];
    const age = now - f.born;
    if (age > FLASH_LIFE_MS) {
      scene.remove(f.mesh);
      f.mesh.material.dispose();
      muzzleFlashes.splice(i, 1);
      continue;
    }
    f.mesh.material.opacity = 1 - age / FLASH_LIFE_MS;
    f.mesh.scale.setScalar(1 + age * 0.06);
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity * 0.8 - 0.02);
}

let shake = 0;
let shakeTime = 0;
function addShake(amount) {
  shake = Math.min(3, shake + amount);
}

// Взрыв при попадании
const explosions = [];
const EXPLOSION_LIFE_MS = 400;
function spawnExplosion(x, z) {
  if (!settingsState.effects) return;
  const colors = [0xff8a2a, 0xffd75e, 0xff5a3d];
  const group = new THREE.Group();
  colors.forEach((c) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(5 + Math.random() * 4, 8, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true }));
    mesh.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 16);
    group.add(mesh);
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3, 4.5, 28),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  const light = new THREE.PointLight(0xff8833, 3, 300);
  group.add(light);
  group.position.set(x, 18, z);
  scene.add(group);
  explosions.push({ group, born: performance.now() });

  // Разлетающиеся искры
  spawnParticles(x, 18, z, 10, [0xff8a2a, 0xffd75e, 0xff5a3d, 0xffffff], 170, 1.2, 650, 2.2);
}

// Рикошет: снаряд не пробил преграду
function spawnSpark(x, z) {
  if (!settingsState.effects) return;
  spawnParticles(x, 18, z, 9, [0xffffff, 0xffe9a8, 0xffc24d], 280, 0.8, 380, 1.5);
}

function updateExplosions() {
  const now = performance.now();
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    const t = Math.min((now - e.born) / EXPLOSION_LIFE_MS, 1);
    e.group.scale.setScalar(1 + t * 4);
    e.group.children.forEach(c => {
      if (c.isPointLight) { c.intensity = 3 * (1 - t); return; }
      c.material.opacity = 1 - t;
    });
    if (t >= 1) {
      scene.remove(e.group);
      e.group.children.forEach(c => { if (c.isMesh) c.material.dispose(); });
      explosions.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// ЧАСТИЦЫ (искры, огонь, дым)
// ---------------------------------------------------------------------------
const particles = [];
const particleGeo = new THREE.SphereGeometry(1.8, 6, 6);

function spawnParticles(x, y, z, count, colors, speed, upBias, life, size) {
  if (!settingsState.effects) return;
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    particles.push({
      mesh,
      vx: (Math.random() - 0.5) * speed,
      vy: Math.random() * speed * upBias + speed * 0.2,
      vz: (Math.random() - 0.5) * speed,
      born: performance.now(),
      life,
    });
  }
}

function updateParticles(dt, now) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const age = now - p.born;
    if (age > p.life) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.vy -= 60 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    const t = age / p.life;
    p.mesh.material.opacity = 1 - t;
    p.mesh.scale.multiplyScalar(1 + dt * 2);
  }
}

// ---------------------------------------------------------------------------
// ВСПЛЫВАЮЩИЙ ТЕКСТ В МИРЕ (например «НЕ ПРОБИТ»)
// ---------------------------------------------------------------------------
const damageTexts = [];
function showDamageText(x, z, text, color) {
  const el = document.createElement('div');
  el.className = 'damageText';
  el.textContent = text;
  el.style.color = color || '#fff';
  document.body.appendChild(el);
  damageTexts.push({ el, x, y: 26, z, born: performance.now() });
}

function updateDamageTexts(now) {
  for (let i = damageTexts.length - 1; i >= 0; i--) {
    const d = damageTexts[i];
    const age = now - d.born;
    if (age > 1200) {
      d.el.remove();
      damageTexts.splice(i, 1);
      continue;
    }
    const v = new THREE.Vector3(d.x, d.y, d.z).project(camera);
    d.el.style.display = v.z > 1 ? 'none' : 'block';
    d.el.style.left = ((v.x + 1) / 2 * window.innerWidth) + 'px';
    d.el.style.top = ((1 - v.y) / 2 * window.innerHeight) + 'px';
    d.el.style.opacity = 1 - age / 1200;
  }
}

// Отлетающие части (дуло, башня): простейшая физика с гравитацией
const flyingBits = [];
const BIT_LIFE_MS = 6000;

function launchBit(mesh, power) {
  flyingBits.push({
    mesh,
    vx: (Math.random() - 0.5) * power,
    vy: 60 + Math.random() * power * 0.6,
    vz: (Math.random() - 0.5) * power,
    spinX: (Math.random() - 0.5) * 8,
    spinY: (Math.random() - 0.5) * 8,
    born: performance.now(),
  });
}

function updateFlyingBits(dt, now) {
  for (let i = flyingBits.length - 1; i >= 0; i--) {
    const f = flyingBits[i];
    f.vy -= 110 * dt;
    f.mesh.position.x += f.vx * dt;
    f.mesh.position.y += f.vy * dt;
    f.mesh.position.z += f.vz * dt;
    f.mesh.rotation.x += f.spinX * dt;
    f.mesh.rotation.y += f.spinY * dt;
    if (f.mesh.position.y <= 0) {
      f.mesh.position.y = 0;
      f.vy = 0; f.vx = 0; f.vz = 0;
    }
    if (now - f.born > BIT_LIFE_MS) {
      scene.remove(f.mesh);
      f.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
      flyingBits.splice(i, 1);
    }
  }
}

function breakOffPart(part) {
  part.updateWorldMatrix(true, false);
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  part.getWorldPosition(wp);
  part.getWorldQuaternion(wq);
  part.parent.remove(part);
  scene.add(part);
  part.position.copy(wp);
  part.quaternion.copy(wq);
  return part;
}

function breakOffBarrel(tankId) {
  const mesh = tankMeshes.get(tankId);
  if (!mesh || mesh.userData.wrecked) return;
  const barrel = mesh.userData.barrel;
  if (!barrel || barrel.parent !== mesh.userData.turretPivot) return;
  launchBit(breakOffPart(barrel), 40);
}

// ---------------------------------------------------------------------------
// СЛЕДЫ ГУСЕНИЦ
// ---------------------------------------------------------------------------
const trackGeo = new THREE.PlaneGeometry(3.4, 9);
const trackMarks = []; // { mesh, born }
const trackPool = [];
const TRACK_MARK_DIST = 9;
const TRACK_LIFE_MS = 8000;
const TRACK_MAX_MARKS = 600;

function placeTrackMark(x, z, angle) {
  if (!settingsState.effects) return;
  if (trackMarks.length >= TRACK_MAX_MARKS) return;
  let mesh = trackPool.pop();
  if (!mesh) {
    mesh = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ color: 0x1c1c1c, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
  }
  mesh.position.set(x, 0.06, z);
  mesh.rotation.z = Math.PI / 2 - angle;
  mesh.material.opacity = 0.34;
  mesh.visible = true;
  trackMarks.push({ mesh, born: performance.now() });
}

function updateTrackMarks(players, now) {
  for (let i = trackMarks.length - 1; i >= 0; i--) {
    const m = trackMarks[i];
    const age = now - m.born;
    if (age > TRACK_LIFE_MS) {
      m.mesh.visible = false;
      trackPool.push(m.mesh);
      trackMarks.splice(i, 1);
      continue;
    }
    m.mesh.material.opacity = 0.34 * (1 - age / TRACK_LIFE_MS);
  }

  players.forEach(p => {
    if (!p.alive) return;
    const mesh = tankMeshes.get(p.id);
    if (!mesh) return;
    const last = mesh.userData.lastTrack;
    if (!last) {
      mesh.userData.lastTrack = { x: p.x, z: p.z };
      return;
    }
    const dist = Math.hypot(p.x - last.x, p.z - last.z);
    if (dist < TRACK_MARK_DIST) return;
    mesh.userData.lastTrack = { x: p.x, z: p.z };
    const a = p.chassisAngle;
    const cos = Math.cos(a), sin = Math.sin(a);
    placeTrackMark(p.x + cos * 15, p.z - sin * 15, a);  // правая гусеница
    placeTrackMark(p.x - cos * 15, p.z + sin * 15, a);  // левая гусеница
  });
}

function destroyTank(mesh) {
  // Башня (с дулом) взлетает и падает отдельно
  launchBit(breakOffPart(mesh.userData.turretPivot), 90);
  // Корпус остаётся обломком — подпаливаем
  mesh.children.forEach(child => {
    if (child.isMesh) child.material.color.set(0x4a4a4a);
  });
  // Большой взрыв, огонь и дым
  spawnExplosion(mesh.position.x, mesh.position.z);
  spawnParticles(mesh.position.x, 22, mesh.position.z, 14, [0xff8a2a, 0xff5a3d, 0xffd75e], 230, 1.4, 900, 3);
  spawnParticles(mesh.position.x, 24, mesh.position.z, 8, [0x555555, 0x777777, 0x444444], 70, 2.2, 1600, 5.5);
}

// Звук выстрела
const shotSound = new Audio('vystrel-tanka.mp3');
shotSound.preload = 'auto';
shotSound.load();
shotSound.volume = settingsState.volume;

function unlockAudio() {
  const p = shotSound.play();
  if (p) p.then(() => { shotSound.pause(); shotSound.currentTime = 0; }).catch(() => {});
}

function playShotSound() {
  try {
    shotSound.currentTime = 0;
    const p = shotSound.play();
    if (p) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// КАМЕРА
// ---------------------------------------------------------------------------
const chaseCamOffset = new THREE.Vector3(0, 0, 0);
const camLookTarget = new THREE.Vector3(0, 12, 0);
const _camDesired = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
let currentFov = normalFov;

function updateCamera(players) {
  const me = players.find(p => p.id === selfId);
  if (!me || !me.alive) return;

  const mesh = tankMeshes.get(selfId);
  if (!mesh) return;

  // Плавный переход зума (FOV) между обычным видом и прицелом
  const targetFov = isScoped ? SCOPE_FOV : normalFov;
  currentFov = lerp(currentFov, targetFov, 0.15);
  if (Math.abs(camera.fov - currentFov) > 0.01) {
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
  }

  if (isScoped) {
    // --- Камера от первого лица: на кончике дула башни ---
    // Для своего танка используем мгновенный угол мыши, чтобы прицел не лагал
    const turretAngle = me.id === selfId ? targetTurretAngle : me.turretAngle;
    const tipWorld = new THREE.Vector3(
      me.x + Math.sin(turretAngle) * 34,
      35,
      me.z + Math.cos(turretAngle) * 34
    );

    camera.position.lerp(tipWorld, 0.5);

    const lookDir = new THREE.Vector3(
      Math.sin(turretAngle) * Math.cos(scopePitch),
      Math.sin(scopePitch),
      Math.cos(turretAngle) * Math.cos(scopePitch)
    );
    const lookTarget = camera.position.clone().add(lookDir.multiplyScalar(100));
    camera.lookAt(lookTarget);
  } else {
    // --- Камера от третьего лица: орбита вокруг танка (Q/E + колесо) ---
    if (keys.camLeft) camOrbit += 0.05;
    if (keys.camRight) camOrbit -= 0.05;
    _camDesired.set(
      me.x - Math.sin(me.chassisAngle + camOrbit) * camDist,
      camHeight,
      me.z - Math.cos(me.chassisAngle + camOrbit) * camDist
    );
    camera.position.lerp(_camDesired, 0.12);

    _camTarget.set(me.x, 12, me.z);
    camLookTarget.lerp(_camTarget, 0.15);
    camera.lookAt(camLookTarget);
  }

  // Тряска камеры: плавная синусоида, затухает со временем
  if (shake > 0.01) {
    shakeTime += 0.4;
    const k = shake;
    camera.position.x += Math.sin(shakeTime * 17) * k * 0.3;
    camera.position.y += Math.cos(shakeTime * 13) * k * 0.2;
    camera.position.z += Math.sin(shakeTime * 11 + 2) * k * 0.3;
    shake *= 0.9;
  } else {
    shake = 0;
    shakeTime = 0;
  }
}

// ---------------------------------------------------------------------------
// ГЛАВНЫЙ ЦИКЛ РЕНДЕРА
// ---------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  if (selfId) {
    const players = getInterpolatedPlayers();
    const bullets = getInterpolatedBullets();

    syncTanks(players);
    syncBullets(bullets);
    updateMuzzleFlashes();
    updateExplosions();
    updateParticles(dt, now);
    updateFlyingBits(dt, now);
    updateTrackMarks(players, now);
    updateDamageTexts(now);
    updateCamera(players);
  }

  renderer.render(scene, camera);
}

let lastFrameTime = performance.now();
animate();
