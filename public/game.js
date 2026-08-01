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

// ---------------------------------------------------------------------------
// ОБЛАКА НА НЕБЕ (медленно плывут, зациклены)
// ---------------------------------------------------------------------------
const clouds = [];

function createClouds() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 8; i++) {
    const group = new THREE.Group();
    const puffs = 2 + Math.floor(Math.random() * 3);
    for (let j = 0; j < puffs; j++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(50 + Math.random() * 45, 8, 6), mat);
      mesh.position.set((j - puffs / 2) * 60 + (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 30);
      mesh.scale.y = 0.45;
      group.add(mesh);
    }
    group.position.set(Math.random() * 2000, 750 + Math.random() * 250, Math.random() * 2000);
    scene.add(group);
    clouds.push({ group, speed: 3 + Math.random() * 6 });
  }
}
createClouds();

function updateClouds(dt) {
  clouds.forEach(c => {
    c.group.position.x += c.speed * dt;
    if (c.group.position.x > 2200) c.group.position.x = -200;
  });
}

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
// громкость не может быть нулевой по умолчанию — иначе «нет звука»
if (!(settingsState.volume > 0)) settingsState.volume = 0.7;
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
    explosionSound.volume = settingsState.volume;
    penetrationSound.volume = settingsState.volume;
    engineIdleSound.volume = settingsState.volume * 0.25;
    engineMoveSound.volume = settingsState.volume * 0.5;
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
// БАТУТЫ (4 штуки): подкидывают танк вверх
// ---------------------------------------------------------------------------
let trampolineGroup = null;

function ensureTrampolines(trampolines) {
  if (!trampolines || trampolineGroup) return;
  trampolineGroup = new THREE.Group();
  trampolines.forEach(t => {
    const g = new THREE.Group();
    // Ножки и каркас
    const base = new THREE.Mesh(new THREE.CylinderGeometry(30, 34, 4, 20), new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.5, roughness: 0.6 }));
    base.position.y = 2;
    base.castShadow = true;
    g.add(base);
    // Прыжковое полотно
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(27, 27, 5, 20), new THREE.MeshStandardMaterial({ color: 0xe74c3c, metalness: 0.3, roughness: 0.7 }));
    pad.position.y = 6.5;
    pad.castShadow = true;
    g.add(pad);
    // Пружинный обод
    const rim = new THREE.Mesh(new THREE.TorusGeometry(27, 2.2, 8, 24), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.7, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 9;
    g.add(rim);
    // Внутренняя сетка
    const inner = new THREE.Mesh(new THREE.CircleGeometry(25, 20), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 9.1;
    g.add(inner);
    g.position.set(t.x, 0, t.z);
    trampolineGroup.add(g);
  });
  scene.add(trampolineGroup);
}

// ---------------------------------------------------------------------------
// ФАБРИКА ТАНКА (корпус + независимо вращаемая башня + дуло)
// ---------------------------------------------------------------------------
function createTankMesh(color) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.28 }); // блик от солнца
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.5 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.1, roughness: 0.95 });

  // --- Гусеницы и ходовая часть ---
  [-1, 1].forEach(side => {
    // Резиновая лента
    const band = new THREE.Mesh(new THREE.BoxGeometry(7, 11.5, 47), rubberMat);
    band.position.set(side * 15, 7, 0);
    band.castShadow = true;
    band.receiveShadow = true;
    group.add(band);

    // Опорные катки (5 штук)
    for (let i = 0; i < 5; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 7.6, 14), darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 15, 7, -18 + i * 9);
      wheel.castShadow = true;
      group.add(wheel);
    }
    // Ведущее колесо (спереди) и ленивец (сзади)
    [-20, 20].forEach((z, i) => {
      const big = new THREE.Mesh(new THREE.CylinderGeometry(i === 1 ? 5.4 : 4.8, i === 1 ? 5.4 : 4.8, 7.6, 14), darkMat);
      big.rotation.z = Math.PI / 2;
      big.position.set(side * 15, 7, z);
      big.castShadow = true;
      group.add(big);
    });

    // Бортовой экран (тонкая пластина над гусеницей)
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5.5, 44), darkMat);
    skirt.position.set(side * 12.2, 10, 0);
    skirt.castShadow = true;
    group.add(skirt);

    // Надгусеничная полка
    const fender = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 44), bodyMat);
    fender.position.set(side * 13.5, 12.9, 0);
    fender.castShadow = true;
    group.add(fender);
  });

  // --- Корпус ---
  // Нижняя часть
  const hull = new THREE.Mesh(new THREE.BoxGeometry(28, 9, 40), bodyMat);
  hull.position.y = 7.5;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  // Верхняя плита
  const upper = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 30), bodyMat);
  upper.position.y = 13;
  upper.castShadow = true;
  group.add(upper);

  // Наклонный лобовой лист (гласис)
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(24, 5, 8), bodyMat);
  glacis.rotation.x = -0.45;
  glacis.position.set(0, 12.8, 16.5);
  glacis.castShadow = true;
  group.add(glacis);

  // Наклонная кормовая плита
  const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 6), bodyMat);
  rearPlate.rotation.x = 0.3;
  rearPlate.position.set(0, 13.2, -16);
  rearPlate.castShadow = true;
  group.add(rearPlate);

  // Выхлопные трубы (корма)
  [-6, 6].forEach(x => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3, 8), darkMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, 9, -20.5);
    pipe.castShadow = true;
    group.add(pipe);
  });

  // Фары (перед)
  [-8, 8].forEach(x => {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe28a, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.4 })
    );
    lamp.position.set(x, 12.5, 20.5);
    group.add(lamp);
  });

  // Буксирные крюки
  [-9, 9].forEach(x => {
    const hook = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), darkMat);
    hook.position.set(x, 4.5, 20.8);
    group.add(hook);
  });

  // --- Башня (вращается независимо от корпуса) ---
  const turretPivot = new THREE.Group();
  turretPivot.position.y = 17;
  group.add(turretPivot);

  // Основание башни — скошенный цилиндр
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(11, 13, 8, 16), bodyMat);
  turretBase.castShadow = true;
  turretPivot.add(turretBase);

  // Скошенная средняя часть
  const turretMid = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 11, 5, 16), bodyMat);
  turretMid.position.y = 6.5;
  turretMid.castShadow = true;
  turretPivot.add(turretMid);

  // Купол башни
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10.5, 14, 10), bodyMat);
  dome.scale.y = 0.5;
  dome.position.y = 10;
  dome.castShadow = true;
  turretPivot.add(dome);

  // Командирская башенка и люк
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 3, 10), darkMat);
  cupola.position.y = 13.5;
  cupola.castShadow = true;
  turretPivot.add(cupola);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.9, 10), bodyMat);
  hatch.position.y = 15.4;
  turretPivot.add(hatch);

  // Пулемёт на башенке
  const mg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 5, 8), darkMat);
  mg.rotation.x = Math.PI / 2;
  mg.position.set(4, 14, 4);
  turretPivot.add(mg);

  // Антенна
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 13, 6), darkMat);
  antenna.position.set(-6, 16, -4);
  turretPivot.add(antenna);

  // ЗИП-ящик на корме башни
  const stowage = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 5), darkMat);
  stowage.position.set(0, 7.5, -12);
  stowage.castShadow = true;
  turretPivot.add(stowage);

  // --- Дуло (группа: ствол + дульный тормоз + казённик) ---
  const barrel = new THREE.Group();
  barrel.position.set(0, 1, 20); // дуло смотрит по +Z (вперёд), сдвинуто вперёд от центра

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 26, 12), darkMat);
  tube.rotation.x = Math.PI / 2;
  tube.castShadow = true;
  barrel.add(tube);

  // Дульный тормоз на конце ствола
  const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(3, 2.8, 4.5, 10), darkMat);
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.z = 14.5;
  barrel.add(muzzleBrake);

  // Казённик у башни
  const breech = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 4, 12), darkMat);
  breech.rotation.x = Math.PI / 2;
  breech.position.z = -10;
  barrel.add(breech);

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
const tankPrevY = new Map();    // id -> последняя высота (для пыли при приземлении)
const bulletMeshes = new Map(); // id -> THREE.Mesh

let wasAlive = true;

// ---------------------------------------------------------------------------
// ЭКРАН ВВОДА НИКА
// ---------------------------------------------------------------------------
const nicknameOverlay = document.getElementById('nicknameOverlay');
const nicknameInput = document.getElementById('nicknameInput');
const startBtn = document.getElementById('startBtn');

const TANK_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6fa4',
  '#34495e', '#16a085', '#d35400', '#7f8c8d', '#8e44ad', '#ffffff'];
let selectedColor = null;

// ---------------------------------------------------------------------------
// ОПЫТ: сохраняется между сессиями, открывает цвета и звания
// ---------------------------------------------------------------------------
let xpTotal = 0;
try { xpTotal = Math.max(0, Number(localStorage.getItem('tanksXp') || 0)); } catch (e) { /* ignore */ }

// Уровень и прогресс до следующего
function levelInfo(xp) {
  let level = 1, need = 400, rest = xp;
  while (rest >= need) {
    rest -= need;
    level++;
    need = 400 + (level - 1) * 100;
  }
  return { level, cur: rest, need };
}

function addXp(amount) {
  xpTotal += amount;
  try { localStorage.setItem('tanksXp', String(xpTotal)); } catch (e) { /* ignore */ }
  updateXpUI();
}

const xpBarWrapEl = document.getElementById('xpBarWrap');
const xpBarFillEl = document.getElementById('xpBarFill');
const xpTextEl = document.getElementById('xpText');

function updateXpUI() {
  const info = levelInfo(xpTotal);
  const pct = Math.round(info.cur / info.need * 100);
  xpBarFillEl.style.width = pct + '%';
  xpTextEl.textContent = `Ур. ${info.level} · Опыт ${info.cur}/${info.need}`;
}

// Цвета, открываемые уровнем (первые 8 — базовые)
const LOCKED_COLORS = {
  '#34495e': 2,   // графит
  '#16a085': 3,   // морской
  '#d35400': 4,   // медь
  '#7f8c8d': 5,   // серебро
  '#8e44ad': 7,   // фиолет
  '#ffffff': 10,  // белый
};

function colorAvailable(color) {
  return !(color in LOCKED_COLORS) || levelInfo(xpTotal).level >= LOCKED_COLORS[color];
}

function buildColorPicker() {
  const wrap = document.getElementById('colorSwatches');
  TANK_COLORS.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch' + (colorAvailable(c) ? '' : ' locked');
    s.style.background = c;
    s.dataset.color = c;
    const needLevel = LOCKED_COLORS[c];
    if (needLevel) s.title = `Уровень ${needLevel}`;
    s.addEventListener('click', () => {
      if (!colorAvailable(c)) return;
      selectedColor = c;
      wrap.querySelectorAll('.swatch').forEach(x => x.classList.toggle('selected', x === s));
    });
    wrap.appendChild(s);
  });
}
buildColorPicker();
updateXpUI();

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
    ensureTrampolines(state.trampolines);
  });

  socket.on('bounce', () => {
    // подброс своего танка: лёгкий экранный отклик
    shake = Math.max(shake, 0.7);
  });

  socket.on('roulette', (data) => {
    spinRoulette(data.ability);
  });

  socket.on('hit', (data) => {
    spawnExplosion(data.x, data.z);
    spawnSpark(data.x, data.z); // искры металла при попадании по танку
    // 3D-звук: панорама взрыва относительно камеры
    playSound3D(explosionSound, data.x, data.z);
    // звук пробития слышит только тот, кто попал
    if (data.ownerId === selfId) playPenetrationSound();
    // всплывающий урон у танка
    if (data.damage > 0) showDamageText(data.x + (Math.random() - 0.5) * 24, data.z + (Math.random() - 0.5) * 24, '-' + data.damage, '#ff5a4d', 21);
    if (data.barrel) breakOffBarrel(data.id);
  });

  socket.on('bulletBlocked', (data) => {
    spawnSpark(data.x, data.z);
    if (data.ownerId === selfId) showDamageText(data.x, data.z, 'НЕ ПРОБИТ', '#ffb84d');
  });

  socket.on('pickup', (data) => {
    const me = currentState.players.find(p => p.id === selfId);
    if (!me) return;
    const label = data.type === 'heal' ? '+30 HP' : data.type === 'speed' ? 'УСКОРЕНИЕ!' : 'СКОРОСТРЕЛ!';
    const color = data.type === 'heal' ? '#2ecc71' : data.type === 'speed' ? '#f1c40f' : '#e74c3c';
    showDamageText(me.x, me.z, label, color);
  });

  socket.on('latencyRes', () => {
    pingMs = Date.now() - pingSentAt;
  });

  socket.on('xp', (data) => {
    addXp(data.amount);
    const me = currentState.players.find(p => p.id === selfId);
    if (me) showDamageText(me.x, me.z, '+' + data.amount + ' XP', '#9b59b6');
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
    case 'Digit1': setAmmo('ap'); break;
    case 'Digit2': setAmmo('he'); break;
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
  if (isTouchGhost()) return;
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
  if (isTouchGhost()) return;
  if (e.target.closest('#settingsPanel, #settingsBtn')) return;
  if (e.button === 0) keys.shooting = true;
  if (e.button === 2) enterScope();
});
window.addEventListener('mouseup', (e) => {
  if (isTouchGhost()) return;
  if (e.target.closest('#settingsPanel, #settingsBtn')) return;
  if (e.button === 0) keys.shooting = false;
  if (e.button === 2) exitScope();
});
window.addEventListener('contextmenu', (e) => e.preventDefault()); // отключаем контекстное меню ПКМ

// ---------------------------------------------------------------------------
// МОБИЛЬНОЕ УПРАВЛЕНИЕ: джойстик (движение) + кнопки «Выстрел» и «Зум»
// ---------------------------------------------------------------------------
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const joyBaseEl = document.getElementById('joyBase');
const joyKnobEl = document.getElementById('joyKnob');
const fireBtnEl = document.getElementById('fireBtn');
const zoomBtnEl = document.getElementById('zoomBtn');

const joy = { active: false, id: -1, dx: 0, dy: 0 };
const JOY_MAX = 44;   // радиус хода джойстика
const JOY_DEAD = 12;  // мёртвая зона

joyBaseEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joy.active = true;
  joy.id = t.identifier;
  joy.dx = 0;
  joy.dy = 0;
}, { passive: false });

joyBaseEl.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joy.id) continue;
    const rect = joyBaseEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = t.clientX - cx;
    let dy = t.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > JOY_MAX) { dx = dx / len * JOY_MAX; dy = dy / len * JOY_MAX; }
    joy.dx = dx;
    joy.dy = dy;
  }
}, { passive: false });

function endJoy(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; }
  }
}
joyBaseEl.addEventListener('touchend', endJoy);
joyBaseEl.addEventListener('touchcancel', endJoy);

// Выстрел: держим кнопку — танк стреляет
fireBtnEl.addEventListener('touchstart', (e) => { e.preventDefault(); keys.shooting = true; }, { passive: false });
fireBtnEl.addEventListener('touchend', (e) => { e.preventDefault(); keys.shooting = false; }, { passive: false });
fireBtnEl.addEventListener('touchcancel', () => { keys.shooting = false; });

// Зум: переключает режим прицела от первого лица
zoomBtnEl.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (isScoped) exitScope(); else enterScope();
  zoomBtnEl.classList.toggle('active', isScoped);
}, { passive: false });

// Прицеливание касанием: правый палец по экрану — башня следует за точкой
let touchAimId = -1;
let lastAimX = 0;
let lastAimY = 0;
let lastTouchEndAt = 0;

document.addEventListener('touchstart', (e) => {
  document.body.classList.add('touch');
  for (const t of e.changedTouches) {
    if (t.target.closest('#joyBase, #touchBtns, #settingsPanel, #settingsBtn, #leaderboard, #minimap, #nicknameOverlay')) continue;
    touchAimId = t.identifier;
    lastAimX = t.clientX;
    lastAimY = t.clientY;
  }
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier !== touchAimId) continue;
    if (isScoped) {
      // в прицеле вращаем башню свайпом, как мышью при pointer lock
      targetTurretAngle -= (t.clientX - lastAimX) * 0.005;
      scopePitch -= (t.clientY - lastAimY) * 0.005;
      scopePitch = Math.max(-0.35, Math.min(0.45, scopePitch));
    } else {
      // обычный режим: рейкаст из точки касания на землю
      mouseNDC.x = (t.clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(t.clientY / window.innerHeight) * 2 + 1;
    }
    lastAimX = t.clientX;
    lastAimY = t.clientY;
  }
}, { passive: true });

document.addEventListener('touchend', (e) => {
  lastTouchEndAt = Date.now();
  for (const t of e.changedTouches) {
    if (t.identifier === touchAimId) touchAimId = -1;
  }
});

// Подавляем синтетические mouse-события после касаний (чтобы не стрелять зря)
function isTouchGhost() { return Date.now() - lastTouchEndAt < 700; }

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
  zoomBtnEl.classList.add('active');
  if (!isTouchDevice) renderer.domElement.requestPointerLock();
}

function exitScope() {
  isScoped = false;
  scopeOverlay.classList.add('hidden');
  zoomBtnEl.classList.remove('active');
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

document.addEventListener('pointerlockchange', () => {
  // Если браузер сам снял pointer lock (например, Esc) — выходим из прицела визуально
  if (document.pointerLockElement !== renderer.domElement && isScoped) {
    isScoped = false;
    scopeOverlay.classList.add('hidden');
    zoomBtnEl.classList.remove('active');
  }
});

// На телефоне блокируем скролл/зум страницы (кроме панели настроек)
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest('#settingsPanel')) e.preventDefault();
}, { passive: false });

// Отправка ввода на сервер с фиксированной частотой
setInterval(() => {
  if (!socket || !selfId) return;

  // Джойстик: движение и поворот, клавиатура — поверх
  joyKnobEl.style.transform = `translate(${joy.dx}px, ${joy.dy}px)`;
  const joyFwd = joy.dy < -JOY_DEAD;
  const joyBack = joy.dy > JOY_DEAD;
  const joyLeft = joy.dx < -JOY_DEAD;
  const joyRight = joy.dx > JOY_DEAD;

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
    forward: keys.forward || joyFwd,
    back: keys.back || joyBack,
    left: keys.left || joyLeft,
    right: keys.right || joyRight,
    targetTurretAngle,
    shooting: keys.shooting,
    ammo: currentAmmo,
  });
}, 1000 / 60);

// ---------------------------------------------------------------------------
// Тип снаряда: 1 — бронебойный (ap), 2 — фугас (he)
// ---------------------------------------------------------------------------
let currentAmmo = 'ap';
const ammoApBtn = document.getElementById('ammoAp');
const ammoHeBtn = document.getElementById('ammoHe');

function setAmmo(type) {
  if (currentAmmo === type) return;
  currentAmmo = type;
  ammoApBtn.classList.toggle('active', type === 'ap');
  ammoHeBtn.classList.toggle('active', type === 'he');
}

ammoApBtn.addEventListener('click', () => setAmmo('ap'));
ammoHeBtn.addEventListener('click', () => setAmmo('he'));

// ---------------------------------------------------------------------------
// БОНУСЫ НА КАРТЕ (аптечка / ускорение / скорострельность)
// ---------------------------------------------------------------------------
const pickupMeshes = new Map();

function createPickupMesh(type) {
  const group = new THREE.Group();
  if (type === 'heal') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 18), new THREE.MeshBasicMaterial({ color: 0x27ae60 }));
    base.position.y = 3;
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(5, 12, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m1.position.y = 11;
    m2.position.y = 11;
    group.add(base, m1, m2);
  } else if (type === 'speed') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 20, 6), new THREE.MeshBasicMaterial({ color: 0xf1c40f }));
    cone.position.y = 16;
    group.add(cone);
  } else {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 18, 8), new THREE.MeshBasicMaterial({ color: 0xe74c3c }));
    cyl.position.y = 15;
    group.add(cyl);
  }
  return group;
}

function syncPickups(pickupsList, now) {
  const seen = new Set();
  (pickupsList || []).forEach(pk => {
    seen.add(pk.id);
    let mesh = pickupMeshes.get(pk.id);
    if (!mesh) {
      mesh = createPickupMesh(pk.type);
      pickupMeshes.set(pk.id, mesh);
      scene.add(mesh);
    }
    mesh.position.set(pk.x, 3 + Math.sin(now / 350 + pk.id) * 4, pk.z);
    mesh.rotation.y += 0.02;
  });
  for (const [id, mesh] of pickupMeshes) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      pickupMeshes.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// МИНИ-КАРТА
// ---------------------------------------------------------------------------
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
const MM_SCALE = 10; // 2000 юнитов мира / 200 px карты
let lastMMDraw = 0;

function drawMinimap() {
  const now = Date.now();
  if (now - lastMMDraw < 50) return; // ~20 кадров/сек
  lastMMDraw = now;

  const W = minimap.width, H = minimap.height;
  mmCtx.clearRect(0, 0, W, H);
  mmCtx.fillStyle = 'rgba(10, 16, 10, 0.85)';
  mmCtx.fillRect(0, 0, W, H);

  // Препятствия
  mmCtx.fillStyle = 'rgba(150, 150, 150, 0.9)';
  obstaclesData.forEach(o => mmCtx.fillRect(o.x / MM_SCALE, o.z / MM_SCALE, o.w / MM_SCALE, o.d / MM_SCALE));

  // Бонусы
  (currentState.pickups || []).forEach(pk => {
    mmCtx.fillStyle = pk.type === 'heal' ? '#27ae60' : pk.type === 'speed' ? '#f1c40f' : '#e74c3c';
    mmCtx.fillRect(pk.x / MM_SCALE - 2, pk.z / MM_SCALE - 2, 4, 4);
  });

  // Игроки
  currentState.players.forEach(p => {
    const sx = p.x / MM_SCALE, sz = p.z / MM_SCALE;
    mmCtx.fillStyle = p.id === selfId ? '#ffffff' : p.color;
    mmCtx.beginPath();
    mmCtx.arc(sx, sz, p.id === selfId ? 3.5 : 3, 0, Math.PI * 2);
    mmCtx.fill();
    if (p.id === selfId) {
      mmCtx.strokeStyle = '#ffffff';
      mmCtx.lineWidth = 1.5;
      mmCtx.beginPath();
      mmCtx.moveTo(sx, sz);
      mmCtx.lineTo(sx + Math.sin(p.chassisAngle) * 9, sz + Math.cos(p.chassisAngle) * 9);
      mmCtx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// ПРИЦЕЛ ОТ ПЕРВОГО ЛИЦА: сетка и дистанция до цели
// ---------------------------------------------------------------------------
const scopeDistance = document.getElementById('scopeDistance');
const _scopeDir = new THREE.Vector3();

function updateScopeInfo() {
  if (!isScoped || !selfId) return;
  camera.getWorldDirection(_scopeDir);
  const t = -camera.position.y / Math.max(0.01, _scopeDir.y);
  if (t <= 0) return;
  const gx = camera.position.x + _scopeDir.x * t;
  const gz = camera.position.z + _scopeDir.z * t;

  let dist = Math.hypot(gx - camera.position.x, gz - camera.position.z);
  let onTank = false;
  for (const p of currentState.players) {
    if (!p.alive || p.id === selfId) continue;
    if (Math.hypot(p.x - gx, p.z - gz) < 26) {
      dist = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      onTank = true;
      break;
    }
  }
  scopeDistance.textContent = Math.round(dist) + ' м';
  scopeDistance.style.color = onTank ? '#ff5a4d' : '#ddd';
}

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

  updateActiveEffects(me.effects || []);
  updateMyRank(me);
  drawMinimap();
}

// ---------------------------------------------------------------------------
// Ранги за килы
// ---------------------------------------------------------------------------
const RANKS_C = [
  [0, 'Рядовой'], [3, 'Ефрейтор'], [6, 'Сержант'], [10, 'Лейтенант'], [15, 'Капитан'],
  [21, 'Майор'], [28, 'Полковник'], [40, 'Генерал'], [60, 'Легенда'],
];

function rankName(kills) {
  let name = RANKS_C[0][1];
  for (const [k, n] of RANKS_C) if (kills >= k) name = n;
  return name;
}

const myRankEl = document.getElementById('myRank');

function updateMyRank(me) {
  myRankEl.textContent = `${rankName(me.kills)} · ${me.kills} килов · ${me.deaths} смертей`;
}

// ---------------------------------------------------------------------------
// ПЫЛЬ ПОД ГУСЕНИЦАМИ — ВИДНА ВСЕМ ИГРОКАМ
// ---------------------------------------------------------------------------
const playerDustTimers = new Map();
const playerExhaustTimers = new Map();
const playerPrevMoving = new Map();
const prevPlayerPos = new Map();

// Дым из выхлопа (постоянно при движении, клуб при старте)
function emitExhaust(players, dt) {
  if (!settingsState.effects) return;
  players.forEach(p => {
    if (!p.alive) return;
    const prev = prevPlayerPos.get(p.id);
    let speed = 0;
    if (prev) speed = Math.hypot(p.x - prev.x, p.z - prev.z) / Math.max(dt, 0.001);
    const moving = speed > 25;
    const wasMoving = playerPrevMoving.get(p.id) || false;
    playerPrevMoving.set(p.id, moving);

    // клуб дыма при старте движения
    if (moving && !wasMoving) {
      for (let i = 0; i < 3; i++) spawnExhaustPuff(p, i * 90);
    }

    // в движении дымит гуще и чаще
    let interval = moving ? 0.18 : 0.65;
    let t = playerExhaustTimers.get(p.id) || 0;
    t -= dt;
    if (t > 0) { playerExhaustTimers.set(p.id, t); return; }
    playerExhaustTimers.set(p.id, interval);
    spawnExhaustPuff(p, 0, moving);
  });
}

function spawnExhaustPuff(p, delayMs, moving) {
  const a = p.chassisAngle;
  const rx = -Math.sin(a);
  const rz = -Math.cos(a);
  for (const side of [-1, 1]) {
    // дым из выхлопных труб на корме (модель: x=±6, y=9, z=-20.5)
    const tx = p.x + rx * 20.5 + Math.cos(a) * side * 6;
    const tz = p.z + rz * 20.5 - Math.sin(a) * side * 6;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9c9c9c, transparent: true });
    const mesh = new THREE.Mesh(particleGeo, mat);
    const size = moving ? 2.5 + Math.random() * 2 : 1.8 + Math.random() * 1.4;
    mesh.scale.setScalar(size);
    mesh.position.set(tx, 9.5, tz);
    scene.add(mesh);
    particles.push({
      mesh,
      vx: rx * (moving ? 40 : 20) + (Math.random() - 0.5) * 10,
      vy: 14 + Math.random() * 12,
      vz: rz * (moving ? 40 : 20) + (Math.random() - 0.5) * 10,
      grav: 28,   // дым поднимается
      grow: moving ? 0.9 : 0.7,
      born: performance.now() + delayMs,
      life: 900 + Math.random() * 400,
    });
  }
}

function emitTrackDust(players, dt) {
  if (!settingsState.effects) return;
  players.forEach(p => {
    if (!p.alive) return;
    const prev = prevPlayerPos.get(p.id);
    let speed = 0;
    if (prev) speed = Math.hypot(p.x - prev.x, p.z - prev.z) / Math.max(dt, 0.001);
    prevPlayerPos.set(p.id, { x: p.x, z: p.z });
    if (speed < 25) return;

    let t = playerDustTimers.get(p.id) || 0;
    t -= dt;
    if (t > 0) { playerDustTimers.set(p.id, t); return; }
    playerDustTimers.set(p.id, 0.1);

    // пыль вылетает назад от движения
    const bx = -Math.sin(p.chassisAngle);
    const bz = -Math.cos(p.chassisAngle);

    for (const side of [-1, 1]) {
      const tx = p.x + Math.cos(p.chassisAngle) * side * 15;
      const tz = p.z - Math.sin(p.chassisAngle) * side * 15;
      const mat = new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xb8a888 : 0xa59078, transparent: true });
      const mesh = new THREE.Mesh(particleGeo, mat);
      mesh.scale.setScalar(2 + Math.random() * 2.5);
      mesh.position.set(tx + (Math.random() - 0.5) * 4, 1 + Math.random() * 2, tz + (Math.random() - 0.5) * 4);
      scene.add(mesh);
      particles.push({
        mesh,
        vx: bx * 70 + (Math.random() - 0.5) * 30,
        vy: 15 + Math.random() * 25,
        vz: bz * 70 + (Math.random() - 0.5) * 30,
        born: performance.now(),
        life: 600 + Math.random() * 300,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Бейджи активных способностей
// ---------------------------------------------------------------------------
const activeEffectsEl = document.getElementById('activeEffects');
let activeEffectsCache = '';

function updateActiveEffects(effects) {
  const key = effects.map(e => e.id + ':' + Math.ceil(e.remainingMs / 1000)).join(',');
  if (key === activeEffectsCache) return;
  activeEffectsCache = key;
  activeEffectsEl.innerHTML = effects.map(e => {
    const card = ABILITY_CARDS.find(c => c[0] === e.id);
    if (!card) return '';
    const sec = e.remainingMs < 0 ? '' : Math.ceil(e.remainingMs / 1000) + 'с';
    return `<div class="effectBadge" style="background:${card[2]}"><span>${ABILITY_ICONS[card[0]] || '?'}</span><b>${sec}</b></div>`;
  }).join('');
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
      <div class="lbRow">
        <span class="name">${escapeHtml(p.nickname)}</span>
        <span>${p.kills}/${p.deaths}</span>
      </div>
      <div class="lbRank">${rankName(p.kills)}</div>
    </li>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// РУЛЕТКА СПОСОБНОСТЕЙ
// ---------------------------------------------------------------------------
const ABILITY_CARDS = [
  ['speed', 'Турбо', '#f39c12'], ['damage', 'Бронебойный', '#e74c3c'], ['reload', 'Скорострел', '#2ecc71'],
  ['bulletsp', 'Быстрые пули', '#3498db'], ['triple', 'Веер', '#9b59b6'], ['heal', 'Ремнабор', '#27ae60'],
  ['regen', 'Регенерация', '#1abc9c'], ['shield', 'Неуязвимость', '#f1c40f'], ['invis', 'Невидимость', '#95a5a6'],
  ['fastturret', 'Острая башня', '#e67e22'], ['blast', 'Фугас', '#d35400'], ['freeze', 'Мороз', '#85c1e9'],
  ['burn', 'Зажигательный', '#e74c3c'], ['lifesteal', 'Вампир', '#c0392b'], ['crit', 'Критик', '#f1c40f'],
  ['pierce', 'Пробой', '#2980b9'], ['nuke', 'Ядерный удар', '#ff5722'], ['kamikaze', 'Камikадзе', '#c0392b'],
  ['second', 'Второй шанс', '#16a085'], ['thorn', 'Шипы', '#7f8c8d'], ['rage', 'Ярость', '#e74c3c'],
  ['emp', 'ЭМИ', '#8e44ad'], ['teleport', 'Телепорт', '#2c3e50'], ['storm', 'Гроза', '#3498db'],
  ['jam', 'Глушитель', '#7d3c98'], ['armor', 'Броня', '#bdc3c7'], ['ricochet', 'Рикошет', '#48c9b0'],
  ['overdrive', 'Перегрузка', '#f5b041'], ['sharp', 'Острота', '#d7bde2'], ['spin', 'Волчок', '#aed6f1'],
  ['protect', 'Защита', '#f1c40f'],
];
const ABILITY_ICONS = {
  speed: '»', damage: '✖', reload: '≈', bulletsp: '→', triple: '⋀', heal: '+', regen: '✚',
  shield: '⬢', invis: '◌', fastturret: '⟳', blast: '◉', freeze: '❄', burn: '🔥', lifesteal: '♥',
  crit: '★', pierce: '↦', nuke: '☢', kamikaze: '☠', second: '✝', thorn: '♧', rage: '⚡',
  emp: '〰', teleport: '⇤', storm: 'ϟ', jam: '✕', armor: '◆', ricochet: '⇄', overdrive: '⚙', sharp: '▲', spin: '⟲',
  protect: '⛨',
};

const rouletteOverlay = document.getElementById('rouletteOverlay');
const rouletteStrip = document.getElementById('rouletteStrip');
const rouletteResult = document.getElementById('rouletteResult');
const rouletteResultName = document.getElementById('rouletteResultName');
const rouletteResultDesc = document.getElementById('rouletteResultDesc');
const rouletteOkBtn = document.getElementById('rouletteOkBtn');
const CELL_W = 128;

let rouletteSpinning = false;
let roulettePos = 0;

// Лента из 12 повторов всех карточек — никогда не заканчивается при прокрутке
function buildRouletteStrip() {
  rouletteStrip.innerHTML = '';
  for (let rep = 0; rep < 12; rep++) {
    ABILITY_CARDS.forEach((card, idx) => {
      const cell = document.createElement('div');
      cell.className = 'rouletteCell';
      cell.style.background = `linear-gradient(180deg, ${card[2]}, ${card[2]}88)`;
      cell.innerHTML = `<div class="rouletteIcon">${ABILITY_ICONS[card[0]] || '?'}</div><div class="rouletteLabel">${card[1]}</div>`;
      cell.dataset.id = card[0];
      cell.dataset.index = idx;
      rouletteStrip.appendChild(cell);
    });
  }
}
buildRouletteStrip();

function spinRoulette(ability) {
  if (rouletteSpinning) return;
  rouletteSpinning = true;
  rouletteResult.classList.add('hidden');
  rouletteOverlay.classList.remove('hidden');

  const N = ABILITY_CARDS.length;
  const cycle = N * CELL_W;
  const targetIdx = Math.max(0, ABILITY_CARDS.findIndex(c => c[0] === ability.id));
  // докручиваем ровно до целевой карточки от текущей позиции
  const delta = ((targetIdx * CELL_W - roulettePos) % cycle + cycle) % cycle;
  const finalPos = roulettePos + 5 * cycle + delta; // 5 полных оборотов

  const startPos = roulettePos;
  const duration = 4200;
  const start = performance.now();

  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 4); // easeOutQuart
    roulettePos = startPos + (finalPos - startPos) * ease;
    rouletteStrip.style.transform = `translateX(${-roulettePos}px)`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      rouletteSpinning = false;
      roulettePos %= cycle;
      rouletteStrip.style.transform = `translateX(${-roulettePos}px)`;
      showRouletteResult(ability);
    }
  }
  requestAnimationFrame(frame);
}

function showRouletteResult(ability) {
  rouletteResultName.textContent = ability.name;
  rouletteResultName.style.color = ability.color;
  rouletteResultDesc.textContent = ability.desc;
  rouletteResult.classList.remove('hidden');
}

rouletteOkBtn.addEventListener('click', () => {
  rouletteOverlay.classList.add('hidden');
});

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
    const remaining = Math.max(0, Math.ceil(3.5 - elapsed));
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
      y: lerp(prev.y || 0, cur.y || 0, t),
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

// Отдача: дуло плавно возвращается в исходное положение
// Пыль при приземлении после подброса батутом
function spawnLandingDust(x, z) {
  if (!settingsState.effects) return;
  spawnParticles(x, 4, z, 7, [0xa8906c, 0x8a7560, 0xb5a181], 40, 1.2, 450, 1.6, 1.2);
}

function updateTankRecoils(dt) {
  tankMeshes.forEach(mesh => {
    if (mesh.userData.recoil > 0.05) {
      mesh.userData.recoil *= Math.pow(0.02, dt);
      mesh.userData.barrel.position.z = 20 - mesh.userData.recoil;
    } else if (mesh.userData.recoil !== 0) {
      mesh.userData.recoil = 0;
      mesh.userData.barrel.position.z = 20;
    }
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
      mesh.position.set(p.x, 0, p.z);
      return;
    }

    // Возродился — обломок остаётся на карте, создаём новый танк
    if (mesh.userData.wrecked) {
      keepAsWreck(mesh);
      tankMeshes.delete(p.id);
      mesh = createTankMesh(p.color);
      scene.add(mesh);
      tankMeshes.set(p.id, mesh);
    }

    // Высота: батуты подбрасывают, обломок — на земле
    const y = Math.max(0, p.y || 0);
    if (tankPrevY.get(p.id) > 2 && y <= 0.5) spawnLandingDust(mesh.position.x, mesh.position.z);
    tankPrevY.set(p.id, y);
    mesh.position.set(p.x, y, p.z);
    mesh.rotation.y = p.chassisAngle;
    mesh.userData.turretPivot.rotation.y = p.turretAngle - p.chassisAngle;
    // «Невидимость» — полупрозрачный танк
    const invis = (p.effects || []).some(e => e.id === 'invis');
    if (invis && mesh.userData.invisible !== true) {
      mesh.userData.invisible = true;
      mesh.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = 0.15; } });
    } else if (!invis && mesh.userData.invisible === true) {
      mesh.userData.invisible = false;
      mesh.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = 1; } });
    }
  });

  // Удаляем меши отключившихся игроков и их эффекты
  for (const [id, mesh] of tankMeshes) {
    if (!seenIds.has(id)) {
      if (mesh.userData.wrecked) {
        // обломок разорвавшегося игрока остаётся на карте
        keepAsWreck(mesh);
      } else {
        scene.remove(mesh);
        mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
      }
      tankMeshes.delete(id);
      playerDustTimers.delete(id);
      prevPlayerPos.delete(id);
      playerExhaustTimers.delete(id);
      playerPrevMoving.delete(id);
      wreckedTimers.delete(id);
      tankPrevY.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// ОБЛОМКИ ВЗОРВАННЫХ ТАНКОВ (не исчезают)
// ---------------------------------------------------------------------------
const wrecks = [];
const MAX_WRECKS = 15;

function keepAsWreck(mesh) {
  // Старые обломки убираем, чтобы карта не засорялась
  while (wrecks.length >= MAX_WRECKS) {
    const old = wrecks.shift();
    scene.remove(old);
    old.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
  }
  wrecks.push(mesh);
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
      spawnMuzzleSmoke(b); // дым поднимается вокруг танка — видят все
      if (b.ownerId === selfId) {
        addShake(0.35); // отдача при своём выстреле
        playShotSound();
        lastShotAt = Date.now();
        const me = tankMeshes.get(selfId);
        if (me) me.userData.recoil = 7; // дуло отталкивается назад
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

// Дым поднимается вокруг танка после выстрела (виден всем)
function spawnMuzzleSmoke(b) {
  if (!settingsState.effects) return;
  const shooter = currentState.players.find(pl => pl.id === b.ownerId);
  const cx = shooter ? shooter.x : b.x;
  const cz = shooter ? shooter.z : b.z;

  for (let i = 0; i < 9; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xc8c8c8, transparent: true });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.scale.setScalar(5 + Math.random() * 5);
    const ang = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 18;
    mesh.position.set(cx + Math.cos(ang) * r, 8 + Math.random() * 14, cz + Math.sin(ang) * r);
    scene.add(mesh);
    particles.push({
      mesh,
      vx: (Math.random() - 0.5) * 20,
      vy: 25 + Math.random() * 25,
      vz: (Math.random() - 0.5) * 20,
      grav: 18, // дым лёгкий — поднимается вверх
      grow: 0.55,
      born: performance.now(),
      life: 1500 + Math.random() * 800,
    });
  }
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
  // Пылевая волна по земле
  spawnDustWave(x, z);
}

// Рикошет: снаряд не пробил преграду
function spawnSpark(x, z) {
  if (!settingsState.effects) return;
  spawnParticles(x, 18, z, 9, [0xffffff, 0xffe9a8, 0xffc24d], 280, 0.8, 380, 1.5);
}

// Пылевая волна от взрыва — разлетается по земле радиально
function spawnDustWave(x, z) {
  if (!settingsState.effects) return;
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const mat = new THREE.MeshBasicMaterial({ color: 0xa8906c, transparent: true });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.scale.setScalar(2 + Math.random() * 1.5);
    mesh.position.set(x, 2 + Math.random() * 2, z);
    scene.add(mesh);
    particles.push({
      mesh,
      vx: Math.cos(ang) * (35 + Math.random() * 25),
      vy: 8 + Math.random() * 8,
      vz: Math.sin(ang) * (35 + Math.random() * 25),
      grav: 40,
      grow: 0.35,
      born: performance.now(),
      life: 700 + Math.random() * 350,
    });
  }
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

function spawnParticles(x, y, z, count, colors, speed, upBias, life, size, grow) {
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
      grow: grow || 2,
      born: performance.now(),
      life,
    });
  }
}

// Лимит частиц: старые удаляются, чтобы не накапливались
const MAX_PARTICLES = 400;

function updateParticles(dt, now) {
  if (particles.length > MAX_PARTICLES) {
    const over = particles.length - MAX_PARTICLES;
    for (let i = 0; i < over; i++) {
      const p = particles[i];
      scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    particles.splice(0, over);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const age = now - p.born;
    if (age > p.life) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
      particles.splice(i, 1);
      continue;
    }
    p.vy -= (p.grav || 60) * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    const t = age / p.life;
    p.mesh.material.opacity = 1 - t;
    p.mesh.scale.multiplyScalar(1 + (p.grow || 2) * dt);
  }
}

// ---------------------------------------------------------------------------
// ВСПЛЫВАЮЩИЙ ТЕКСТ В МИРЕ (например «НЕ ПРОБИТ»)
// ---------------------------------------------------------------------------
const damageTexts = [];
function showDamageText(x, z, text, color, size) {
  const el = document.createElement('div');
  el.className = 'damageText';
  el.textContent = text;
  el.style.color = color || '#fff';
  if (size) el.style.fontSize = size + 'px';
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
const TRACK_LIFE_MS = 25000;   // следы держатся долго
const TRACK_MAX_MARKS = 1200;

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
    mesh.material.opacity = 0.45;
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
    m.mesh.material.opacity = 0.45 * (1 - age / TRACK_LIFE_MS);
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
  // Звук взрыва танка — с панорамой относительно камеры
  playSound3D(explosionSound, mesh.position.x, mesh.position.z);
  // Башня (с дулом) взлетает и падает отдельно
  launchBit(breakOffPart(mesh.userData.turretPivot), 90);
  // Корпус остаётся обломком — подпаливаем
  mesh.children.forEach(child => {
    if (child.isMesh) child.material.color.set(0x4a4a4a);
  });
  // Большой взрыв, огонь и дым
  spawnExplosion(mesh.position.x, mesh.position.z);
  spawnParticles(mesh.position.x, 22, mesh.position.z, 14, [0xff8a2a, 0xff5a3d, 0xffd75e], 230, 1.4, 900, 3);
  spawnParticles(mesh.position.x, 24, mesh.position.z, 8, [0x555555, 0x777777, 0x444444], 45, 2.2, 1600, 5.5, 0.5);
  // Обломки корпуса разлетаются
  spawnDebris(mesh.position.x, mesh.position.z);
}

// Мелкие обломки корпуса с физикой полёта
const debrisColors = [0x3a3a3a, 0x555555, 0x2e2e2e, 0x4a4a4a];

function spawnDebris(x, z) {
  if (!settingsState.effects) return;
  for (let i = 0; i < 7; i++) {
    const s = 3 + Math.random() * 5;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color: debrisColors[i % debrisColors.length] }));
    mesh.position.set(x + (Math.random() - 0.5) * 12, 10 + Math.random() * 12, z + (Math.random() - 0.5) * 12);
    scene.add(mesh);
    flyingBits.push({
      mesh,
      vx: (Math.random() - 0.5) * 230,
      vy: 90 + Math.random() * 170,
      vz: (Math.random() - 0.5) * 230,
      spinX: (Math.random() - 0.5) * 14,
      spinY: (Math.random() - 0.5) * 14,
      born: performance.now(),
    });
  }
}

// Огонь и дым из подбитого танка, пока лежит обломком
const wreckedTimers = new Map();

function updateWreckedFires(now, dt) {
  if (!settingsState.effects) return;
  const sources = [];
  tankMeshes.forEach(m => { if (m.userData.wrecked) sources.push(m); });
  wrecks.forEach(m => sources.push(m));

  for (const mesh of sources) {
    let t = wreckedTimers.get(mesh.id) || 0;
    t -= dt;
    if (t > 0) { wreckedTimers.set(mesh.id, t); continue; }
    wreckedTimers.set(mesh.id, 0.12);

    const px = mesh.position.x + (Math.random() - 0.5) * 10;
    const pz = mesh.position.z + (Math.random() - 0.5) * 10;

    // дым
    const mat = new THREE.MeshBasicMaterial({ color: 0x666666, transparent: true });
    const smoke = new THREE.Mesh(particleGeo, mat);
    smoke.scale.setScalar(3 + Math.random() * 3);
    smoke.position.set(px, 12 + Math.random() * 6, pz);
    scene.add(smoke);
    particles.push({
      mesh: smoke,
      vx: (Math.random() - 0.5) * 12,
      vy: 20 + Math.random() * 18,
      vz: (Math.random() - 0.5) * 12,
      grav: 15,
      born: performance.now(),
      life: 1200 + Math.random() * 500,
    });

    // языки огня
    if (Math.random() < 0.4) {
      const fmat = new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff8a2a : 0xff5a3d, transparent: true });
      const fire = new THREE.Mesh(particleGeo, fmat);
      fire.scale.setScalar(2 + Math.random() * 2.5);
      fire.position.set(px, 8 + Math.random() * 6, pz);
      scene.add(fire);
      particles.push({
        mesh: fire,
        vx: (Math.random() - 0.5) * 10,
        vy: 14 + Math.random() * 12,
        vz: (Math.random() - 0.5) * 10,
        grav: 5,
        born: performance.now(),
        life: 350 + Math.random() * 200,
      });
    }
  }
}

// Звук выстрела
const shotSound = new Audio('vystrel-tanka.mp3');
shotSound.preload = 'auto';
shotSound.load();
shotSound.volume = settingsState.volume;

// Звук мотора: холостой ход и езда
const engineIdleSound = new Audio('engine-idle.mp3');
engineIdleSound.loop = true;
engineIdleSound.preload = 'auto';
engineIdleSound.load();
engineIdleSound.volume = settingsState.volume * 0.25;

const engineMoveSound = new Audio('engine-move.mp3');
engineMoveSound.loop = true;
engineMoveSound.preload = 'auto';
engineMoveSound.load();
engineMoveSound.volume = settingsState.volume * 0.5;

// Звук взрыва танка
const explosionSound = new Audio('explosion.mp3');
explosionSound.preload = 'auto';
explosionSound.load();
explosionSound.volume = settingsState.volume;

// Звук пробития танка
const penetrationSound = new Audio('penetration.mp3');
penetrationSound.preload = 'auto';
penetrationSound.load();
penetrationSound.volume = settingsState.volume;

function playPenetrationSound() {
  try {
    penetrationSound.currentTime = 0;
    const p = penetrationSound.play();
    if (p) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

function unlockAudio() {
  // Прогреваем ВСЕ звуки по жесту пользователя — иначе браузер блокирует их
  initAudioCtx();
  [shotSound, explosionSound, penetrationSound, engineIdleSound, engineMoveSound].forEach(s => {
    try {
      s.currentTime = 0;
      const p = s.play();
      if (p) p.then(() => {
        if (s !== engineIdleSound) { s.pause(); s.currentTime = 0; }
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  });
}

function playShotSound() {
  try {
    shotSound.currentTime = 0;
    const p = shotSound.play();
    if (p) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

let engineMoving = false;
function updateEngineSound() {
  if (!selfId) return;
  const moving = keys.forward || keys.back;
  if (moving && !engineMoving) {
    engineMoving = true;
    const p = engineMoveSound.play();
    if (p) p.catch(() => {});
  } else if (!moving && engineMoving) {
    engineMoving = false;
    engineMoveSound.pause();
  }
}

// ---------------------------------------------------------------------------
// 3D-звук: панорама и громкость по расстоянию от камеры
// ---------------------------------------------------------------------------
let audioCtx = null;

function initAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

function preparePannable(audio) {
  if (audio._panned) return;
  const ctx = initAudioCtx();
  if (!ctx) return;
  try {
    const src = ctx.createMediaElementSource(audio);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const gain = ctx.createGain();
    src.connect(panner || gain);
    if (panner) panner.connect(gain);
    gain.connect(ctx.destination);
    audio._panned = { ctx, panner, gain };
  } catch (e) { /* ignore */ }
}

const _soundDir = new THREE.Vector3();

function playSound3D(audio, x, z) {
  try {
    if (!audio._panned) preparePannable(audio);
    if (!audio._panned) {
      audio.currentTime = 0;
      const p = audio.play();
      if (p) p.catch(() => {});
      return;
    }
    const ctx = audio._panned.ctx;
    if (ctx.state === 'suspended') ctx.resume();

    // Азимут источника относительно направления камеры
    camera.getWorldDirection(_soundDir);
    const dx = x - camera.position.x, dz = z - camera.position.z;
    const cross = _soundDir.x * dz - _soundDir.z * dx;
    const dot = _soundDir.x * dx + _soundDir.z * dz;
    const angle = Math.atan2(cross, dot);
    if (audio._panned.panner) {
      audio._panned.panner.pan.value = Math.max(-1, Math.min(1, Math.sin(angle) * 1.2));
    }
    // Громкость падает с расстоянием
    const dist = Math.hypot(dx, dz);
    audio._panned.gain.gain.value = Math.max(0.3, Math.min(1, 400 / Math.max(60, dist)));

    audio.currentTime = 0;
    const p = audio.play();
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
    const myY = Math.max(0, me.y || 0);
    const tipWorld = new THREE.Vector3(
      me.x + Math.sin(turretAngle) * 34,
      35 + myY,
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
    const myY = Math.max(0, me.y || 0);
    _camDesired.set(
      me.x - Math.sin(me.chassisAngle + camOrbit) * camDist,
      camHeight + myY,
      me.z - Math.cos(me.chassisAngle + camOrbit) * camDist
    );
    camera.position.lerp(_camDesired, 0.12);

    _camTarget.set(me.x, 12 + myY, me.z);
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
    updateTankRecoils(dt);
    syncPickups(currentState.pickups, now);
    updateMuzzleFlashes();
    updateExplosions();
    updateParticles(dt, now);
    updateFlyingBits(dt, now);
    updateTrackMarks(players, now);
    updateDamageTexts(now);
    updateEngineSound();
    emitTrackDust(players, dt);
    emitExhaust(players, dt);
    updateWreckedFires(now, dt);
    updateClouds(dt);
    updateScopeInfo();
    updateCamera(players);
  }

  renderer.render(scene, camera);
}

let lastFrameTime = performance.now();
animate();
