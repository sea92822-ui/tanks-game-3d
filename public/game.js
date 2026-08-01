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
scene.fog = new THREE.Fog(0x8fc1e0, 400, 1600);

const NORMAL_FOV = 65;
const SCOPE_FOV = 20;
const camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 3000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
sceneContainer.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// СВЕТ
// ---------------------------------------------------------------------------
const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff4e0, 0.9);
sunLight.position.set(300, 500, 200);
sunLight.castShadow = true;
sunLight.shadow.camera.left = -600;
sunLight.shadow.camera.right = 600;
sunLight.shadow.camera.top = 600;
sunLight.shadow.camera.bottom = -600;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);

// ---------------------------------------------------------------------------
// МИР (заполняется после получения init от сервера)
// ---------------------------------------------------------------------------
let world = { width: 2000, depth: 2000 };
let obstaclesData = [];
let maxHp = 100;

function buildGround() {
  const geo = new THREE.PlaneGeometry(world.width, world.depth);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a6b3d });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(world.width / 2, 0, world.depth / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(Math.max(world.width, world.depth), 40, 0x000000, 0x000000);
  grid.material.opacity = 0.08;
  grid.material.transparent = true;
  grid.position.set(world.width / 2, 0.1, world.depth / 2);
  scene.add(grid);

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
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b });
  const height = 40;
  obstaclesData.forEach(o => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, height, o.d), mat);
    mesh.position.set(o.x + o.w / 2, height / 2, o.z + o.d / 2);
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
  group.userData.barrelTipLocal = new THREE.Vector3(0, 18, 34); // точка для камеры прицела

  return group;
}

// ---------------------------------------------------------------------------
// СОСТОЯНИЕ КЛИЕНТА / СЕТИ
// ---------------------------------------------------------------------------
let socket = null;
let selfId = null;

let currentState = { players: [], bullets: [] };
let previousState = { players: [], bullets: [] };
let lastStateTime = Date.now();
let prevStateTime = Date.now();

const tankMeshes = new Map();   // id -> THREE.Group
const bulletMeshes = new Map(); // id -> THREE.Mesh

let wasAlive = true;

// ---------------------------------------------------------------------------
// ЭКРАН ВВОДА НИКА
// ---------------------------------------------------------------------------
const nicknameOverlay = document.getElementById('nicknameOverlay');
const nicknameInput = document.getElementById('nicknameInput');
const startBtn = document.getElementById('startBtn');

nicknameInput.focus();
startBtn.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

function startGame() {
  const nickname = nicknameInput.value.trim();
  nicknameOverlay.classList.add('hidden');
  connectToServer(nickname);
}

// ---------------------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К СЕРВЕРУ
// ---------------------------------------------------------------------------
function connectToServer(nickname) {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join', { nickname });
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
    previousState = currentState;
    prevStateTime = lastStateTime;
    currentState = state;
    lastStateTime = Date.now();
    updateHUD();
    updateLeaderboard();
    checkDeathScreen();
  });

  socket.on('offerUpgrade', (options) => {
    showUpgradeChoice(options);
  });
}

// ---------------------------------------------------------------------------
// ВВОД: клавиатура
// ---------------------------------------------------------------------------
const keys = { forward: false, back: false, left: false, right: false, shooting: false };

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = true; break;
    case 'KeyS': case 'ArrowDown': keys.back = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = false; break;
    case 'KeyS': case 'ArrowDown': keys.back = false; break;
    case 'KeyA': case 'ArrowLeft': keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
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
  if (e.button === 0) keys.shooting = true;
  if (e.button === 2) enterScope();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) keys.shooting = false;
  if (e.button === 2) exitScope();
});
window.addEventListener('contextmenu', (e) => e.preventDefault()); // отключаем контекстное меню ПКМ

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

function updateHUD() {
  const me = currentState.players.find(p => p.id === selfId);
  if (!me) return;

  const pct = Math.max(0, me.hp / me.maxHp) * 100;
  hpBarFill.style.width = pct + '%';
  hpText.textContent = `${Math.max(0, Math.round(me.hp))} / ${me.maxHp}`;

  if (pct > 50) hpBarFill.style.background = 'linear-gradient(90deg, #27ae60, #2ecc71)';
  else if (pct > 20) hpBarFill.style.background = 'linear-gradient(90deg, #f39c12, #f1c40f)';
  else hpBarFill.style.background = 'linear-gradient(90deg, #c0392b, #e74c3c)';
}

// ---------------------------------------------------------------------------
// Лидерборд
// ---------------------------------------------------------------------------
const leaderboardList = document.getElementById('leaderboardList');

function updateLeaderboard() {
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
  const now = Date.now();
  const span = Math.max(lastStateTime - prevStateTime, 1);
  let t = (now - lastStateTime) / span + 1;
  t = Math.max(0, Math.min(2, t));

  return currentState.players.map(cur => {
    const prev = previousState.players.find(p => p.id === cur.id) || cur;
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
  const now = Date.now();
  const span = Math.max(lastStateTime - prevStateTime, 1);
  let t = (now - lastStateTime) / span + 1;
  t = Math.max(0, Math.min(2, t));

  return currentState.bullets.map(cur => {
    const prev = previousState.bullets.find(b => b.id === cur.id) || cur;
    return { ...cur, x: lerp(prev.x, cur.x, t), z: lerp(prev.z, cur.z, t) };
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

    mesh.visible = p.alive;
    if (!p.alive) return;

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
    }

    mesh.position.set(b.x, 18, b.z);
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
  if (!sharedBulletGeo) sharedBulletGeo = new THREE.SphereGeometry(5, 8, 8);
  return sharedBulletGeo;
}

// ---------------------------------------------------------------------------
// КАМЕРА
// ---------------------------------------------------------------------------
const chaseCamOffset = new THREE.Vector3(0, 0, 0);
let currentFov = NORMAL_FOV;

function updateCamera(players) {
  const me = players.find(p => p.id === selfId);
  if (!me || !me.alive) return;

  const mesh = tankMeshes.get(selfId);
  if (!mesh) return;

  // Плавный переход зума (FOV) между обычным видом и прицелом
  const targetFov = isScoped ? SCOPE_FOV : NORMAL_FOV;
  currentFov = lerp(currentFov, targetFov, 0.15);
  if (Math.abs(camera.fov - currentFov) > 0.01) {
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
  }

  if (isScoped) {
    // --- Камера от первого лица: на кончике дула башни ---
    const tipLocal = mesh.userData.barrelTipLocal;
    const tipWorld = tipLocal.clone();
    mesh.userData.turretPivot.localToWorld(tipWorld);

    camera.position.lerp(tipWorld, 0.5);

    const lookDir = new THREE.Vector3(
      Math.sin(me.turretAngle) * Math.cos(scopePitch),
      Math.sin(scopePitch),
      Math.cos(me.turretAngle) * Math.cos(scopePitch)
    );
    const lookTarget = camera.position.clone().add(lookDir.multiplyScalar(100));
    camera.lookAt(lookTarget);
  } else {
    // --- Камера от третьего лица: позади и выше танка ---
    const behindDist = 75, height = 40;
    const desired = new THREE.Vector3(
      me.x - Math.sin(me.chassisAngle) * behindDist,
      height,
      me.z - Math.cos(me.chassisAngle) * behindDist
    );
    camera.position.lerp(desired, 0.12);

    const lookAt = new THREE.Vector3(me.x, 12, me.z);
    camera.lookAt(lookAt);
  }
}

// ---------------------------------------------------------------------------
// ГЛАВНЫЙ ЦИКЛ РЕНДЕРА
// ---------------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);

  if (selfId) {
    const players = getInterpolatedPlayers();
    const bullets = getInterpolatedBullets();

    syncTanks(players);
    syncBullets(bullets);
    updateCamera(players);
  }

  renderer.render(scene, camera);
}

animate();
