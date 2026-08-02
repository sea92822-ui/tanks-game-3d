// ============================================================================
// TANKS MULTIPLAYER 3D — CLIENT (Three.js)
// Камера от третьего лица следует за танком. При зажатой ПКМ включается
// прицел от первого лица: камера переезжает на башню, FOV сужается (зум),
// мышь напрямую вращает башню через Pointer Lock API.
// ============================================================================

// Ошибки JavaScript показываются на экране (для отладки)
function showFatalError(msg) {
  let el = document.getElementById('fatalError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatalError';
    el.style.cssText = 'position:fixed;top:8px;left:8px;right:8px;z-index:9999;background:rgba(140,10,10,0.93);color:#fff;font:12px/1.5 monospace;padding:10px;border-radius:6px;white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.textContent += msg + '\n';
}
window.addEventListener('error', (e) => showFatalError(e.message + ' @ ' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => showFatalError('Promise: ' + ((e.reason && e.reason.message) || e.reason)));

// ---------------------------------------------------------------------------
// СЦЕНА, КАМЕРА, РЕНДЕРЕР
// ---------------------------------------------------------------------------
const sceneContainer = document.getElementById('sceneContainer');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb8e8);

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
    group.position.set(200 + Math.random() * 5800, 750 + Math.random() * 250, 200 + Math.random() * 5800);
    scene.add(group);
    clouds.push({ group, speed: 3 + Math.random() * 6 });
  }
}
createClouds();

function updateClouds(dt) {
  clouds.forEach(c => {
    c.group.position.x += c.speed * dt;
    if (c.group.position.x > 6100) c.group.position.x = -200;
  });
}

const NORMAL_FOV = 65;
const SCOPE_FOV = 20;
const camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 9000);

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
const ambientLight = new THREE.AmbientLight(0xcfe4ff, 0.3);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xffd9b0, 0x2f5a2f, 0.45);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffb070, 1.3);
sunLight.position.set(300, 500, 200);
sunLight.castShadow = true;
sunLight.shadow.bias = -0.0008;
sunLight.shadow.normalBias = 1.5; // чистая самотень без артефактов
sunLight.shadow.radius = 6; // мягкие края теней
sunLight.shadow.camera.near = 50;
sunLight.shadow.camera.far = 1500;
sunLight.shadow.camera.left = -800;
sunLight.shadow.camera.right = 800;
sunLight.shadow.camera.top = 800;
sunLight.shadow.camera.bottom = -800;
sunLight.shadow.mapSize.set(2048, 2048);
scene.add(sunLight);
scene.add(sunLight.target); // тени следуют за игроком

// ---------------------------------------------------------------------------
// НЕБО: градиент от зенита к горизонту, следует за камерой
// ---------------------------------------------------------------------------
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(7000, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1e4fa0) },
      midColor: { value: new THREE.Color(0x8fb8e8) },
      botColor: { value: new THREE.Color(0xf5b87e) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 botColor;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col;
        if (h > 0.0) col = mix(midColor, topColor, smoothstep(0.0, 0.6, h));
        else col = mix(botColor, midColor, smoothstep(-0.12, 0.0, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
);
scene.add(skyDome);

// Лёгкая тёплая дымка: дальние объекты и край карты мягко растворяются (создаёт масштаб)
scene.fog = new THREE.Fog(0xf2c9a0, 2500, 6200);

// Вспышка у дула (общий свет для всех выстрелов)
const muzzleLight = new THREE.PointLight(0xffaa44, 0, 240);
muzzleLight.position.set(0, 30, 0);
scene.add(muzzleLight);

// ---------------------------------------------------------------------------
// ОТРАЖЕНИЯ: окружающая карта для блеска металла (не на «Низкой»)
// ---------------------------------------------------------------------------
function setupEnvironment() {
  if (!THREE.PMREMGenerator || !THREE.RoomEnvironment || settingsState.quality === 'low') return;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  } catch (e) { /* ignore */ }
}

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
    hitMeSound.volume = settingsState.volume;
    deathSound.volume = settingsState.volume;
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
setupEnvironment();

// ---------------------------------------------------------------------------
// МИР (заполняется после получения init от сервера)
// ---------------------------------------------------------------------------
let world = { width: 6000, depth: 6000 };
let obstaclesData = [];
let maxHp = 100;

// Детерминированный шум для процедурной текстуры травы
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeValueNoise(size, cells) {
  const rnd = mulberry32(1337);
  const n = cells + 2;
  const vals = new Float32Array(n * n);
  for (let i = 0; i < vals.length; i++) vals[i] = rnd();
  const out = new Float32Array(size * size);
  const g = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * g, fy = y * g;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const i00 = vals[y0 * n + x0], i10 = vals[y0 * n + x0 + 1];
      const i01 = vals[(y0 + 1) * n + x0], i11 = vals[(y0 + 1) * n + x0 + 1];
      const a = i00 + (i10 - i00) * sx;
      const b = i01 + (i11 - i01) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

// Процедурная трава: несколько слоёв шума, проплешины и светлые пятна
// Процедурная трава через CanvasTexture: пятна оттенков + штрихи травинок.
// Без внешних файлов — не зависит от загрузки JPEG.
function makeGrassTexture() {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#3f7a33';
  ctx.fillRect(0, 0, size, size);

  const rnd = mulberry32(20260702);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * size, y = rnd() * size, r = 18 + rnd() * 60;
    const g = 56 + Math.floor(rnd() * 34);
    ctx.fillStyle = 'rgba(' + Math.floor(g * 0.6) + ',' + g + ',' + Math.floor(g * 0.42) + ',' + (0.05 + rnd() * 0.12) + ')';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * size, y = rnd() * size;
    const l = 2 + rnd() * 4.5;
    const v = 0.3 + rnd() * 0.5;
    ctx.strokeStyle = 'rgba(' + Math.floor(70 * v) + ',' + Math.floor(150 * v) + ',' + Math.floor(42 * v) + ',' + (0.3 + rnd() * 0.5) + ')';
    ctx.lineWidth = 0.8 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 2.5, y - l);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Высота ландшафта: пологие холмы (только визуально, физика остаётся 2D)
function terrainHeight(x, z) {
  return Math.sin(x * 0.0038) * Math.cos(z * 0.0035) * 1.2
       + Math.sin(x * 0.011 + 1.7) * Math.cos(z * 0.009 + 0.5) * 0.8
       + Math.sin((x + z) * 0.0055) * Math.cos((x - z) * 0.007 + 2.1) * 0.6;
}

function buildGround() {
  const seg = settingsState.quality === 'low' ? 64 : 128;
  const geo = new THREE.PlaneGeometry(world.width, world.depth, seg, seg);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // ВАЖНО: у PlaneGeometry ось "вдоль плоскости" — Y, а высота — Z (после rotation.x=-PI/2 становится мировой Y).
    // setY схлопывает плоскость в вырожденную ленту — земля не рендерится!
    pos.setZ(i, terrainHeight(pos.getX(i), pos.getY(i)));
  }
  geo.computeVertexNormals();

  // Земля: насыщенный зелёный + процедурная CanvasTexture-трава (без внешних файлов)
  const mat = new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 1, metalness: 0 });
  mat.map = makeGrassTexture();
  mat.needsUpdate = true;
  console.log('[ground] texture ready, WebGL2 =', !!renderer.capabilities.isWebGL2);
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(world.width / 2, 0, world.depth / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // Стены-границы карты: текстура из texture/images.jpg
  const wallTex = new THREE.TextureLoader().load('texture/images.jpg');
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(15, 1);
  wallTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.1 });
  const wallHeight = 50, wallThickness = 12;
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
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
}

// ---------------------------------------------------------------------------
// ДЕРЕВЬЯ: сносятся танком, следят за состоянием с сервера
// ---------------------------------------------------------------------------
const treeMeshes = new Map();   // index -> { group, fallen }
const fallingTrees = [];        // { group, born, dur, ax } — анимация падения

function startTreeFall(i) {
  const t = treeMeshes.get(i);
  if (!t || t.fallen) return;
  t.fallen = true;
  fallingTrees.push({ group: t.group, born: performance.now(), dur: 700, ax: (Math.random() < 0.5 ? -1 : 1) * (1.45 + Math.random() * 0.2) });
  // пыль и листья у основания
  spawnParticles(t.group.position.x, 4, t.group.position.z, 6, [0xa8906c, 0x7a9c5a, 0x2f8a3c], 40, 1.2, 600, 1.8, 1.2);
}

function updateFallingTrees(now) {
  for (let i = fallingTrees.length - 1; i >= 0; i--) {
    const f = fallingTrees[i];
    const t = Math.min(1, (now - f.born) / f.dur);
    f.group.rotation.z = f.ax * easeOutBack(t);
    if (t >= 1) fallingTrees.splice(i, 1);
  }
}

function easeOutBack(t) {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function syncTrees(trees) {
  (trees || []).forEach(t => {
    if (!t.standing) startTreeFall(t.i);
  });
}

// Модель дерева (low_poly_tree_1.glb): грузится асинхронно,
// пока не загрузилась — используются процедурные деревья
let treeModel = null;
let treeModelScale = 1;
let treeBaseLift = 0;

function preloadTreeModel() {
  if (!THREE.GLTFLoader) return;
  new THREE.GLTFLoader().load('low_poly_tree_1.glb', (gltf) => {
    const bb = new THREE.Box3().setFromObject(gltf.scene);
    const h = bb.max.y - bb.min.y;
    treeModelScale = 62 / h;                 // высота дерева ~62 юнита
    treeBaseLift = -bb.min.y * treeModelScale; // основание ставим на землю
    treeModel = gltf.scene;
    rebuildTrees();
  }, undefined, (err) => console.warn('Не удалось загрузить модель дерева:', err));
}
preloadTreeModel();

// Перестроить только деревья (после загрузки модели)
function rebuildTrees() {
  if (!obstaclesData.length) return;
  treeMeshes.forEach(t => scene.remove(t.group));
  treeMeshes.clear();
  obstaclesData.forEach((o, i) => { if (o.type === 'tree') createTreeMesh(o, i); });
}

function createTreeMesh(o, i) {
  let tree;
  if (treeModel) {
    tree = new THREE.Group();
    const m = treeModel.clone(true);
    m.scale.setScalar(treeModelScale);
    m.position.y = treeBaseLift;
    m.rotation.y = Math.random() * Math.PI * 2;
    tree.add(m);
  } else {
    tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(5, 8, 44, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }));
    trunk.position.y = 22;
    tree.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(30, 8, 8), new THREE.MeshStandardMaterial({ color: 0x2f8a3c, roughness: 0.85 }));
    crown.position.y = 64;
    tree.add(crown);
  }
  tree.position.set(o.x + o.w / 2, 0, o.z + o.d / 2);
  tree.castShadow = true; // группа тоже помечаем — надёжнее
  tree.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  scene.add(tree);
  treeMeshes.set(i, { group: tree, fallen: !o.standing });
  if (!o.standing) tree.rotation.z = -1.55; // уже срубленное (старый сервер)
  return tree;
}

function buildObstacles() {
  obstaclesData.forEach((o, i) => {
    let mesh;

    if (o.type === 'rock') {
      const r = Math.max(o.w, o.d) * 0.45;
      mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9, metalness: 0.08 }));
      mesh.position.set(o.x + o.w / 2, r * 0.7, o.z + o.d / 2);
      mesh.rotation.y = Math.random() * Math.PI;
      mesh.scale.y = 0.75;
    } else if (o.type === 'crate') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 16, o.d), new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.85, metalness: 0.05 }));
      mesh.position.set(o.x + o.w / 2, 8, o.z + o.d / 2);
    } else if (o.type === 'tree') {
      mesh = createTreeMesh(o, i);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, 40, o.d), new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.9, metalness: 0.1 }));
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
// ---------------------------------------------------------------------------
// МОДЕЛИ ТАНКОВ (косметика, открываются уровнями)
// ---------------------------------------------------------------------------
const TANK_MODELS = [
  { id: 'medium', name: 'Тигр II', level: 1 },
  { id: 'light',  name: 'Лёгкий',  level: 1 },
  { id: 'heavy',  name: 'Т-90',    level: 1 },
];

const TANK_MODEL_CFG = {
  medium: {
    hullW: 30, hullH: 12, hullL: 44, hullY: 9,
    upperW: 26, upperH: 5, upperL: 32, upperY: 16.5,
    glacisW: 26, glacisH: 6, glacisL: 9, glacisRot: -0.42, glacisY: 16.4, glacisZ: 17.5,
    rearW: 26, rearH: 5, rearL: 6.5, rearRot: 0.32, rearY: 16.8, rearZ: -15.8,
    bandW: 9, bandH: 13, bandL: 50, bandY: 9, trackOff: 19,
    wheelR: 4.4, wheelW: 8.5, wheelN: 8, bigR: 5.6, bigRearR: 5,
    skirtW: 0.8, skirtH: 5, skirtL: 46, skirtX: 16.4, skirtY: 11.5,
    fenderW: 5.5, fenderH: 1.1, fenderL: 46, fenderX: 17.4, fenderY: 16,
    pipeX: 6, pipeY: 10, pipeZ: -21.5,
    lampX: 9.5, lampY: 15.5, lampZ: 22.5,
    hookX: 10.5, hookY: 5.5, hookZ: 22.8,
    turretY: 21.5,
    baseR1: 13, baseR2: 15, baseH: 8,
    midR1: 11.5, midR2: 13, midH: 5.5, midY: 7,
    domeR: 12.5, domeY: 12,
    cupolaR1: 3.6, cupolaR2: 4.2, cupolaH: 3, cupolaY: 15.5, hatchY: 17.4,
    mgX: 5, mgY: 16, mgZ: 5, mgR: 0.55, mgL: 5.5,
    antX: -6.5, antY: 17.5, antZ: -4, antH: 14,
    stowW: 9, stowH: 4.5, stowL: 7, stowY: 8, stowZ: -13,
    barY: 1, barZ: 18,
    tubeR1: 1.7, tubeR2: 2, tubeL: 25,
    brakeR1: 3.6, brakeR2: 3.3, brakeH: 4.5, brakeZ: 14,
    breechR1: 3.8, breechR2: 4.2, breechH: 3.8, breechZ: -9,
    tipY: 38,
  },
  light: {
    hullW: 23, hullH: 8, hullL: 34, hullY: 6.5,
    upperW: 20, upperH: 3.5, upperL: 25, upperY: 11.5,
    glacisW: 20, glacisH: 4, glacisL: 7, glacisRot: -0.4, glacisY: 11.4, glacisZ: 14,
    rearW: 20, rearH: 3.5, rearL: 5, rearRot: 0.25, rearY: 11.8, rearZ: -13.5,
    bandW: 5.5, bandH: 9.5, bandL: 39, bandY: 6, trackOff: 12.5,
    wheelR: 3.4, wheelW: 6, wheelN: 4, bigR: 4.4, bigRearR: 3.9,
    skirtW: 0.7, skirtH: 4.5, skirtL: 36, skirtX: 10.3, skirtY: 8.5,
    fenderW: 4, fenderH: 0.8, fenderL: 36, fenderX: 11.5, fenderY: 11,
    pipeX: 5, pipeY: 8, pipeZ: -17.2,
    lampX: 6.5, lampY: 10.8, lampZ: 17.4,
    hookX: 7.5, hookY: 4, hookZ: 17.6,
    turretY: 15,
    baseR1: 9, baseR2: 10.5, baseH: 6.5,
    midR1: 7.8, midR2: 9, midH: 4, midY: 5.2,
    domeR: 8.5, domeY: 8,
    cupolaR1: 2.5, cupolaR2: 3, cupolaH: 2.5, cupolaY: 11, hatchY: 12.6,
    mgX: 3.5, mgY: 11.5, mgZ: 3, mgR: 0.45, mgL: 4,
    antX: -5, antY: 13, antZ: -3, antH: 11,
    stowW: 5.5, stowH: 3, stowL: 4, stowY: 6, stowZ: -10,
    barY: 0.8, barZ: 16,
    tubeR1: 1.8, tubeR2: 2.1, tubeL: 21,
    brakeR1: 2.4, brakeR2: 2.3, brakeH: 3.5, brakeZ: 12,
    breechR1: 3.4, breechR2: 3.8, breechH: 3.5, breechZ: -8,
    tipY: 30,
  },
  heavy: {
    hullW: 33, hullH: 9.5, hullL: 46, hullY: 7.5,
    upperW: 29, upperH: 4, upperL: 34, upperY: 13.5,
    glacisW: 29, glacisH: 5.5, glacisL: 9, glacisRot: -0.55, glacisY: 13.4, glacisZ: 18,
    rearW: 29, rearH: 4, rearL: 6.5, rearRot: 0.3, rearY: 13.8, rearZ: -17.5,
    bandW: 8.5, bandH: 13, bandL: 52, bandY: 7.5, trackOff: 18.5,
    wheelR: 4.8, wheelW: 8.5, wheelN: 6, bigR: 6, bigRearR: 5.4,
    skirtW: 1, skirtH: 6.5, skirtL: 48, skirtX: 14.8, skirtY: 10.5,
    fenderW: 6, fenderH: 1.1, fenderL: 48, fenderX: 16.8, fenderY: 13.2,
    pipeX: 7, pipeY: 9.5, pipeZ: -23.5,
    lampX: 10, lampY: 13, lampZ: 23.5,
    hookX: 11, hookY: 4.5, hookZ: 23.8,
    turretY: 18.5,
    baseR1: 13, baseR2: 14.5, baseH: 5,
    midR1: 11.5, midR2: 13, midH: 3.5, midY: 4.2,
    domeR: 12, domeY: 6.5,
    cupolaR1: 3, cupolaR2: 3.6, cupolaH: 2.5, cupolaY: 9.5, hatchY: 11,
    mgX: 4.5, mgY: 10.5, mgZ: 4, mgR: 0.5, mgL: 5,
    antX: -6.5, antY: 12.5, antZ: -4, antH: 15,
    stowW: 6, stowH: 3.5, stowL: 5, stowY: 5, stowZ: -9.5,
    barY: 1, barZ: 22,
    tubeR1: 1.8, tubeR2: 2.1, tubeL: 30,
    brakeR1: 2.4, brakeR2: 2.3, brakeH: 3, brakeZ: 17,
    breechR1: 4, breechR2: 4.4, breechH: 4, breechZ: -9,
    tipY: 42,
    eraHull: [
      { x: -8, y: 13.6, z: 17.2, w: 5.5, h: 4.5, d: 2.2 },
      { x: 8, y: 13.6, z: 17.2, w: 5.5, h: 4.5, d: 2.2 },
      { x: 0, y: 13.6, z: 17.2, w: 5, h: 4.5, d: 2.2 },
    ],
    eraTurret: [
      { x: -6, y: 9, z: 10.5, w: 5, h: 3.4, d: 2.2 },
      { x: 6, y: 9, z: 10.5, w: 5, h: 3.4, d: 2.2 },
      { x: 0, y: 9, z: 11, w: 4.5, h: 3.4, d: 2.2 },
    ],
  },
};

// ---------------------------------------------------------------------------
// ФАБРИКА ТАНКА (корпус + независимо вращаемая башня + дуло)
// ---------------------------------------------------------------------------
function createTankMesh(color, modelId) {
  const c = TANK_MODEL_CFG[modelId] || TANK_MODEL_CFG.medium;
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.28 }); // блик от солнца
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.5 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.1, roughness: 0.95 });

  // --- Гусеницы и ходовая часть ---
  [-1, 1].forEach(side => {
    // Резиновая лента
    const band = new THREE.Mesh(new THREE.BoxGeometry(c.bandW, c.bandH, c.bandL), rubberMat);
    band.position.set(side * c.trackOff, c.bandY, 0);
    band.castShadow = true;
    band.receiveShadow = true;
    group.add(band);

    // Опорные катки
    const spacing = c.bandL * 0.38 * 2 / (c.wheelN - 1);
    for (let i = 0; i < c.wheelN; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(c.wheelR, c.wheelR, c.wheelW, 14), darkMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * c.trackOff, c.bandY, -c.bandL * 0.38 + i * spacing);
      wheel.castShadow = true;
      group.add(wheel);
    }
    // Ведущее колесо (спереди) и ленивец (сзади)
    [-1, 1].forEach((dir, i) => {
      const r = dir === 1 ? c.bigR : c.bigRearR;
      const big = new THREE.Mesh(new THREE.CylinderGeometry(r, r, c.wheelW, 14), darkMat);
      big.rotation.z = Math.PI / 2;
      big.position.set(side * c.trackOff, c.bandY, dir * (c.bandL / 2 - 2));
      big.castShadow = true;
      group.add(big);
    });

    // Бортовой экран (тонкая пластина над гусеницей)
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(c.skirtW, c.skirtH, c.skirtL), darkMat);
    skirt.position.set(side * c.skirtX, c.skirtY, 0);
    skirt.castShadow = true;
    group.add(skirt);

    // Надгусеничная полка
    const fender = new THREE.Mesh(new THREE.BoxGeometry(c.fenderW, c.fenderH, c.fenderL), bodyMat);
    fender.position.set(side * c.fenderX, c.fenderY, 0);
    fender.castShadow = true;
    group.add(fender);
  });

  // --- Корпус ---
  // Нижняя часть
  const hull = new THREE.Mesh(new THREE.BoxGeometry(c.hullW, c.hullH, c.hullL), bodyMat);
  hull.position.y = c.hullY;
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);

  // Верхняя плита
  const upper = new THREE.Mesh(new THREE.BoxGeometry(c.upperW, c.upperH, c.upperL), bodyMat);
  upper.position.y = c.upperY;
  upper.castShadow = true;
  group.add(upper);

  // Наклонный лобовой лист (гласис)
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(c.glacisW, c.glacisH, c.glacisL), bodyMat);
  glacis.rotation.x = c.glacisRot;
  glacis.position.set(0, c.glacisY, c.glacisZ);
  glacis.castShadow = true;
  group.add(glacis);

  // Наклонная кормовая плита
  const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(c.rearW, c.rearH, c.rearL), bodyMat);
  rearPlate.rotation.x = c.rearRot;
  rearPlate.position.set(0, c.rearY, c.rearZ);
  rearPlate.castShadow = true;
  group.add(rearPlate);

  // Выхлопные трубы (корма)
  [-c.pipeX, c.pipeX].forEach(x => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 3, 8), darkMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, c.pipeY, c.pipeZ);
    pipe.castShadow = true;
    group.add(pipe);
  });

  // Фары (перед)
  [-c.lampX, c.lampX].forEach(x => {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe28a, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.4 })
    );
    lamp.position.set(x, c.lampY, c.lampZ);
    group.add(lamp);
  });

  // Буксирные крюки
  [-c.hookX, c.hookX].forEach(x => {
    const hook = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), darkMat);
    hook.position.set(x, c.hookY, c.hookZ);
    group.add(hook);
  });

  // --- Башня (вращается независимо от корпуса) ---
  const turretPivot = new THREE.Group();
  turretPivot.position.y = c.turretY;
  group.add(turretPivot);

  // Основание башни — скошенный цилиндр
  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(c.baseR1, c.baseR2, c.baseH, 16), bodyMat);
  turretBase.castShadow = true;
  turretPivot.add(turretBase);

  // Скошенная средняя часть
  const turretMid = new THREE.Mesh(new THREE.CylinderGeometry(c.midR1, c.midR2, c.midH, 16), bodyMat);
  turretMid.position.y = c.midY;
  turretMid.castShadow = true;
  turretPivot.add(turretMid);

  // Купол башни
  const dome = new THREE.Mesh(new THREE.SphereGeometry(c.domeR, 14, 10), bodyMat);
  dome.scale.y = 0.5;
  dome.position.y = c.domeY;
  dome.castShadow = true;
  turretPivot.add(dome);

  // Командирская башенка и люк
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(c.cupolaR1, c.cupolaR2, c.cupolaH, 10), darkMat);
  cupola.position.y = c.cupolaY;
  cupola.castShadow = true;
  turretPivot.add(cupola);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(c.cupolaR1 * 0.8, c.cupolaR1 * 0.8, 0.9, 10), bodyMat);
  hatch.position.y = c.hatchY;
  turretPivot.add(hatch);

  // Пулемёт на башенке
  const mg = new THREE.Mesh(new THREE.CylinderGeometry(c.mgR, c.mgR, c.mgL, 8), darkMat);
  mg.rotation.x = Math.PI / 2;
  mg.position.set(c.mgX, c.mgY, c.mgZ);
  turretPivot.add(mg);

  // Антенна
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, c.antH, 6), darkMat);
  antenna.position.set(c.antX, c.antY, c.antZ);
  turretPivot.add(antenna);

  // ЗИП-ящик на корме башни
  const stowage = new THREE.Mesh(new THREE.BoxGeometry(c.stowW, c.stowH, c.stowL), darkMat);
  stowage.position.set(0, c.stowY, c.stowZ);
  stowage.castShadow = true;
  turretPivot.add(stowage);

  // Блоки динамической защиты на лобовой плите корпуса
  if (c.eraHull) {
    c.eraHull.forEach(e => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(e.w, e.h, e.d), bodyMat);
      block.rotation.x = c.glacisRot;
      block.position.set(e.x, e.y, e.z);
      block.castShadow = true;
      group.add(block);
    });
  }

  // Блоки динамической защиты на башне
  if (c.eraTurret) {
    c.eraTurret.forEach(e => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(e.w, e.h, e.d), bodyMat);
      block.position.set(e.x, e.y, e.z);
      block.castShadow = true;
      turretPivot.add(block);
    });
  }

  // --- Дуло (группа: ствол + дульный тормоз + казённик) ---
  const barrel = new THREE.Group();
  barrel.position.set(0, c.barY, c.barZ); // дуло смотрит по +Z (вперёд), сдвинуто вперёд от центра

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(c.tubeR1, c.tubeR2, c.tubeL, 12), darkMat);
  tube.rotation.x = Math.PI / 2;
  tube.castShadow = true;
  barrel.add(tube);

  // Дульный тормоз на конце ствола
  const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(c.brakeR1, c.brakeR2, c.brakeH, 10), darkMat);
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.z = c.brakeZ;
  barrel.add(muzzleBrake);

  // Казённик у башни
  const breech = new THREE.Mesh(new THREE.CylinderGeometry(c.breechR1, c.breechR2, c.breechH, 12), darkMat);
  breech.rotation.x = Math.PI / 2;
  breech.position.z = c.breechZ;
  barrel.add(breech);

  turretPivot.add(barrel);

  // Тени: танк отбрасывает тень на себя и на другие танки
  group.traverse(c => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  group.userData.turretPivot = turretPivot;
  group.userData.barrel = barrel;
  group.userData.model = modelId || 'medium';
  group.userData.color = color;
  group.userData.turretY = c.turretY;
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
const chatInput = document.getElementById('chatInput');
const chatLog = document.getElementById('chatLog');
const botsCheckbox = document.getElementById('botsCheckbox');
const botDifficultySelect = document.getElementById('botDifficultySelect');

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

let selectedModel = 'medium';
try { selectedModel = localStorage.getItem('tanksModel') || 'medium'; } catch (e) { /* ignore */ }

// ---------------------------------------------------------------------------
// КОМАНДЫ: 0 — красные, 1 — синие, null — авто-баланс на сервере
// ---------------------------------------------------------------------------
const TEAM_NAMES_C = ['Красные', 'Синие'];
const TEAM_COLORS_C = ['#e74c3c', '#3498db'];
let selectedTeam = null;
try {
  const saved = localStorage.getItem('tanksTeam');
  selectedTeam = (saved === '0' || saved === '1') ? Number(saved) : null;
} catch (e) { /* ignore */ }
let myTeam = null; // команда, выданная сервером после join

function buildTeamPicker() {
  const wrap = document.getElementById('teamButtons');
  wrap.querySelectorAll('.teamBtn').forEach(btn => {
    const team = btn.dataset.team === '' ? null : Number(btn.dataset.team);
    if (selectedTeam === team) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      selectedTeam = team;
      try { localStorage.setItem('tanksTeam', team === null ? '' : String(team)); } catch (e) { /* ignore */ }
      wrap.querySelectorAll('.teamBtn').forEach(x => x.classList.toggle('selected', x === btn));
    });
  });
}
buildTeamPicker();

function buildModelPicker() {
  const wrap = document.getElementById('modelButtons');
  TANK_MODELS.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'modelBtn' + (selectedModel === m.id ? ' selected' : '');
    if (!modelAvailable(m.id)) b.classList.add('locked');
    b.textContent = m.name + (m.level > 1 ? ` · Ур. ${m.level}` : '');
    b.dataset.model = m.id;
    b.addEventListener('click', () => {
      if (!modelAvailable(m.id)) return;
      selectedModel = m.id;
      try { localStorage.setItem('tanksModel', m.id); } catch (e) { /* ignore */ }
      wrap.querySelectorAll('.modelBtn').forEach(x => x.classList.toggle('selected', x === b));
      updateTankPreview();
    });
    wrap.appendChild(b);
  });
}

function modelAvailable(modelId) {
  const m = TANK_MODELS.find(x => x.id === modelId);
  return !m || levelInfo(xpTotal).level >= m.level;
}
buildModelPicker();

// ---------------------------------------------------------------------------
// ПРЕВЬЮ ВЫБРАННОГО ТАНКА В МЕНЮ (цвет + модель, та же фабрика, что в игре)
// ---------------------------------------------------------------------------
const tankPreviewEl = document.getElementById('tankPreview');
const previewScene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(45, 1, 1, 600);
previewCamera.position.set(36, 30, 52);
previewCamera.lookAt(0, 16, 0);
const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
previewRenderer.setSize(170, 170);
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
tankPreviewEl.appendChild(previewRenderer.domElement);
previewScene.add(new THREE.AmbientLight(0xffffff, 0.55));
const previewLight = new THREE.DirectionalLight(0xffffff, 1.15);
previewLight.position.set(35, 55, 30);
previewScene.add(previewLight);

let previewTank = null;

function updateTankPreview() {
  if (previewTank) {
    previewScene.remove(previewTank);
    previewTank.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
    previewTank = null;
  }
  previewTank = createTankMesh(selectedColor || '#e74c3c', selectedModel);
  previewTank.rotation.y = -0.6;
  previewScene.add(previewTank);
}
updateTankPreview();

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
      updateTankPreview();
    });
    wrap.appendChild(s);
  });
}
buildColorPicker();
updateXpUI();

nicknameInput.focus();
startBtn.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

// Запоминаем выбор «играть с ботами»
if (localStorage.getItem('tanksBots') === '0') botsCheckbox.checked = false;
// Запоминаем сложность ботов
const savedDiff = localStorage.getItem('tanksDifficulty');
if (savedDiff === 'easy' || savedDiff === 'hard' || savedDiff === 'expert') botDifficultySelect.value = savedDiff;

function startGame() {
  const nickname = nicknameInput.value.trim();
  unlockAudio(); // разблокируем звук по жесту пользователя
  nicknameOverlay.classList.add('hidden');
  localStorage.setItem('tanksBots', botsCheckbox.checked ? '1' : '0');
  localStorage.setItem('tanksDifficulty', botDifficultySelect.value);
  connectToServer(nickname, selectedColor);
}

// ---------------------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К СЕРВЕРУ
// ---------------------------------------------------------------------------
function connectToServer(nickname, color) {
  socket = io({ transports: ['websocket', 'polling'] }); // WebSocket — низкая задержка

  socket.on('connect', () => {
    socket.emit('join', { nickname, color, model: selectedModel, team: selectedTeam, withBots: botsCheckbox.checked, botDifficulty: botDifficultySelect.value });
  });

  socket.on('init', (data) => {
    selfId = data.selfId;
    world = data.world;
    obstaclesData = data.obstacles;
    maxHp = data.maxHp;
    myTeam = data.team;
    buildGround();
    buildObstacles();
  });

  socket.on('matchEnd', (data) => {
    const win = data.winner === myTeam;
    const banner = document.getElementById('matchBanner');
    banner.className = win ? 'show win' : 'show lose';
    banner.textContent = win
      ? '🏆 ПОБЕДА! Ваша команда выиграла ' + data.score[0] + ' : ' + data.score[1]
      : '💥 Поражение ' + data.score[0] + ' : ' + data.score[1] + ' — победили ' + (data.names ? data.names[data.winner] : 'соперники');
  });

  socket.on('matchReset', () => {
    document.getElementById('matchBanner').className = 'hidden';
  });

  socket.on('state', (state) => {
    stateBuffer.push({ time: Date.now(), state });
    const cutoff = Date.now() - RENDER_DELAY;
    while (stateBuffer.length > 2 && stateBuffer[1].time <= cutoff) stateBuffer.shift();
    currentState = state;
    // База предикции своего танка от последнего подтверждённого сервером состояния
    const meState = state.players.find(p => p.id === selfId);
    if (meState) {
      if (meState.alive) updateSelfPrediction(meState);
      else selfPred = null;
    }
    downTreeIdx = new Set((state.trees || []).filter(t => !t.standing).map(t => t.i));
    updateHUD();
    updateLeaderboard();
    checkDeathScreen();
    ensureTrampolines(state.trampolines);
    syncTrees(state.trees);
  });

  socket.on('treeDown', (data) => {
    startTreeFall(data.i);
  });

  socket.on('bounce', () => {
    // подброс своего танка: лёгкий экранный отклик
    shake = Math.max(shake, 0.7);
  });

  socket.on('artillery', (data) => {
    showArtilleryStrike(data);
  });

  socket.on('roulette', (data) => {
    spinRoulette(data.ability);
  });

  socket.on('hit', (data) => {
    spawnImpact(data.x, data.z);
    // 3D-звук: панорама взрыва относительно камеры
    playSound3D(explosionSound, data.x, data.z);
    // звук пробития слышит только тот, кто попал
    if (data.ownerId === selfId) playPenetrationSound();
    // попадание по моему танку
    if (data.id === selfId) playHitMeSound();
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

  socket.on('chatMsg', (data) => {
    addChatMsg(data);
  });

  socket.on('xp', (data) => {
    addXp(data.amount);
    const me = currentState.players.find(p => p.id === selfId);
    if (me) showDamageText(me.x, me.z, '+' + data.amount + ' XP', '#9b59b6');
  });
}

// ---------------------------------------------------------------------------
// ОБЩИЙ ЧАТ
// ---------------------------------------------------------------------------
function addChatMsg(data) {
  if (!data || !data.text) return;
  const line = document.createElement('div');
  line.className = 'chatMsg' + (data.system ? ' chatSystem' : '') + (data.bot ? ' chatBot' : '');
  if (data.system) {
    line.textContent = data.text;
  } else {
    const name = document.createElement('span');
    name.className = 'chatName';
    name.style.color = data.color || '#fff';
    name.textContent = (data.bot ? '🤖 ' : '') + data.from;
    line.appendChild(name);
    line.appendChild(document.createTextNode(data.text));
  }
  chatLog.appendChild(line);
  while (chatLog.children.length > 50) chatLog.removeChild(chatLog.firstChild);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function chatActive() {
  return document.activeElement === chatInput;
}

function sendChat() {
  const text = chatInput.value.trim();
  chatInput.value = '';
  if (text && socket && socket.connected) socket.emit('chat', { text });
  chatInput.blur();
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  else if (e.key === 'Escape') { e.preventDefault(); chatInput.blur(); }
  e.stopPropagation();
});
chatInput.addEventListener('focus', () => {
  // не едем, пока печатаем (если клавиши движения были зажаты)
  keys.forward = keys.back = keys.left = keys.right = false;
});

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
  if (chatActive()) return; // пока печатаем — клавиши игры не работают
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': keys.forward = true; break;
    case 'KeyS': case 'ArrowDown': keys.back = true; break;
    case 'KeyA': case 'ArrowLeft': keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'KeyQ': keys.camLeft = true; break;
    case 'KeyE': keys.camRight = true; break;
    case 'Digit1': setAmmo('ap'); break;
    case 'Digit2': setAmmo('he'); break;
    case 'KeyX': callArtillery(); break;
    case 'KeyT': chatInput.focus(); break;
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
  if (chatActive()) return; // не дёргаем башню, пока печатаем в чат
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
  if (chatActive()) return; // клики при вводе текста в чат не стреляют
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
// МИНИ-КАРТА: вся карта сверху — препятствия, бонусы, батуты и все танки
// ---------------------------------------------------------------------------
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
const MM_SIZE = 220;   // размер канваса в px
let lastMMDraw = 0;

function drawMinimap(now) {
  if (now - lastMMDraw < 50) return; // ~20 кадров/сек
  lastMMDraw = now;

  const scale = world.width / MM_SIZE; // юниты мира на пиксель
  mmCtx.clearRect(0, 0, MM_SIZE, MM_SIZE);

  // фон
  mmCtx.fillStyle = 'rgba(8, 20, 10, 0.75)';
  mmCtx.fillRect(0, 0, MM_SIZE, MM_SIZE);

  // границы мира
  mmCtx.strokeStyle = 'rgba(255, 90, 77, 0.8)';
  mmCtx.lineWidth = 2;
  mmCtx.strokeRect(1, 1, MM_SIZE - 2, MM_SIZE - 2);

  // препятствия и деревья
  obstaclesData.forEach((o, i) => {
    if (o.type === 'tree') {
      const tm = treeMeshes.get(i);
      if (tm && tm.fallen) return; // упавшее дерево не показываем
      mmCtx.fillStyle = 'rgba(47, 138, 60, 0.85)';
      mmCtx.fillRect(o.x / scale - 1.5, o.z / scale - 1.5, 3, 3);
      return;
    }
    mmCtx.fillStyle = 'rgba(150, 150, 150, 0.9)';
    mmCtx.fillRect(o.x / scale, o.z / scale, o.w / scale, o.d / scale);
  });

  // батуты
  (currentState.trampolines || []).forEach(t => {
    mmCtx.strokeStyle = 'rgba(120, 255, 160, 0.9)';
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath();
    mmCtx.arc(t.x / scale, t.z / scale, 3, 0, Math.PI * 2);
    mmCtx.stroke();
  });

  // бонусы
  (currentState.pickups || []).forEach(pk => {
    mmCtx.fillStyle = pk.type === 'heal' ? '#27ae60' : pk.type === 'speed' ? '#f1c40f' : '#e74c3c';
    mmCtx.fillRect(pk.x / scale - 2, pk.z / scale - 2, 4, 4);
  });

  // игроки: цвет точки = команда (красные/синие), своя — белая
  currentState.players.forEach(p => {
    if (!p.alive) return;
    const px = p.x / scale, pz = p.z / scale;
    const isMe = p.id === selfId;
    mmCtx.fillStyle = isMe ? '#ffffff' : (TEAM_COLORS_C[p.team] || p.color);
    mmCtx.beginPath();
    mmCtx.arc(px, pz, isMe ? 4 : 3, 0, Math.PI * 2);
    mmCtx.fill();
    if (isMe) {
      // стрелка по направлению башни
      mmCtx.strokeStyle = '#ffffff';
      mmCtx.lineWidth = 1.5;
      mmCtx.beginPath();
      mmCtx.moveTo(px, pz);
      mmCtx.lineTo(px + Math.sin(p.turretAngle) * 9, pz + Math.cos(p.turretAngle) * 9);
      mmCtx.stroke();
    }
  });
}

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

// Артиллерия (мобильная кнопка)
document.getElementById('artyBtn').addEventListener('touchstart', (e) => {
  e.preventDefault();
  callArtillery();
}, { passive: false });

// Прицеливание касанием: правый палец по экрану — башня следует за точкой
let touchAimId = -1;
let lastAimX = 0;
let lastAimY = 0;
let lastTouchEndAt = 0;

document.addEventListener('touchstart', (e) => {
  document.body.classList.add('touch');
  for (const t of e.changedTouches) {
    if (t.target.closest('#joyBase, #touchBtns, #settingsPanel, #settingsBtn, #leaderboard, #nicknameOverlay')) continue;
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

// ---------------------------------------------------------------------------
// АРТИЛЛЕРИЯ: раз в минуту удар по прицельной точке
// ---------------------------------------------------------------------------
const artilleryIncoming = []; // { x, z, impactAt, ring, shell }

function callArtillery() {
  if (!socket || !selfId) return;
  const me = currentState.players.find(p => p.id === selfId);
  if (!me || !me.alive) return;
  if ((me.artilleryReadyAt || 0) > Date.now()) return;
  raycaster.setFromCamera(mouseNDC, camera);
  const hitPoint = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;
  socket.emit('artillery', { x: hitPoint.x, z: hitPoint.z });
}

// Падающий снаряд + метка зоны поражения (видят все)
function showArtilleryStrike(data) {
  if (!settingsState.effects) return;
  const delay = Math.max(300, data.impactAt - Date.now());

  // красное кольцо зоны поражения
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(126, 132, 48),
    new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(data.x, 0.6, data.z);
  scene.add(ring);

  // падающий снаряд из неба
  const shell = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5522 }));
  shell.position.set(data.x, 420, data.z);
  scene.add(shell);

  artilleryIncoming.push({ x: data.x, z: data.z, impactAt: Date.now() + delay, ring, shell, born: Date.now(), delayMs: delay });
}

function updateArtilleryVisuals(now) {
  for (let i = artilleryIncoming.length - 1; i >= 0; i--) {
    const a = artilleryIncoming[i];
    const t = Math.min(1, (now - a.born) / a.delayMs); // 0..1 по ходу полёта
    a.shell.position.y = 420 * (1 - t * t); // падение с ускорением
    a.ring.material.opacity = 0.65 * (1 - t * 0.5);
    if (t >= 1) {
      scene.remove(a.ring);
      scene.remove(a.shell);
      a.ring.material.dispose();
      a.shell.material.dispose();
      spawnArtilleryImpact(a.x, a.z);
      artilleryIncoming.splice(i, 1);
    }
  }
}

function spawnArtilleryImpact(x, z) {
  if (!settingsState.effects) return;
  // вспышка-прожектор
  const flash = new THREE.PointLight(0xff8833, 6, 520);
  flash.position.set(x, 26, z);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 700);

  spawnExplosion(x, z);
  setTimeout(() => spawnExplosion(x + 24, z + 24), 120);
  setTimeout(() => spawnExplosion(x - 22, z + 16), 240);
  spawnDustWave(x, z);
  setTimeout(() => spawnDustWave(x, z), 350); // двойная волна
  spawnParticles(x, 22, z, 14, [0xff8a2a, 0xffd75e, 0xff5a3d, 0xffffff], 120, 1.5, 800, 3.2, 1.2);
  spawnParticles(x, 30, z, 10, [0x666666, 0x888888, 0x555555], 60, 2.4, 1800, 6, 0.5); // столб дыма
  // тряска и звук для своего экрана
  playSound3D(explosionSound, x, z);
  const me = currentState.players.find(p => p.id === selfId);
  if (me && Math.hypot(me.x - x, me.z - z) < 260) addShake(1.6);
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
  let onTank = null; // null — нет танка, 'enemy' / 'ally'
  for (const p of currentState.players) {
    if (!p.alive || p.id === selfId) continue;
    if (Math.hypot(p.x - gx, p.z - gz) < 26) {
      dist = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      onTank = p.team === myTeam ? 'ally' : 'enemy';
      break;
    }
  }
  scopeDistance.textContent = Math.round(dist) + ' м';
  scopeDistance.style.color = onTank === 'enemy' ? '#ff5a4d' : onTank === 'ally' ? '#2ecc71' : '#ddd';
}

// ---------------------------------------------------------------------------
// HUD: полоса здоровья
// ---------------------------------------------------------------------------
const hpBarFill = document.getElementById('hpBarFill');
const hpText = document.getElementById('hpText');
const reloadBarFill = document.getElementById('reloadBarFill');
const reloadText = document.getElementById('reloadText');
const artilleryFill = document.getElementById('artilleryFill');
const artilleryText = document.getElementById('artilleryText');
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

  // Артиллерия: кулдаун минута
  const artyRem = Math.max(0, (me.artilleryReadyAt || 0) - Date.now());
  if (artyRem <= 0) {
    artilleryFill.style.width = '100%';
    artilleryText.textContent = 'АРТИЛЛЕРИЯ ГОТОВА · X';
  } else {
    artilleryFill.style.width = (100 - artyRem / 60000 * 100) + '%';
    artilleryText.textContent = 'АРТИЛЛЕРИЯ ' + Math.ceil(artyRem / 1000) + 'с';
  }

  updateActiveEffects(me.effects || []);
  updateMyRank(me);
  updateTeamScore();
}

// ---------------------------------------------------------------------------
// Командный счёт (Team Deathmatch): красные : синие, до KILLS_TO_WIN
// ---------------------------------------------------------------------------
let lastTeamScoreRender = 0;
function updateTeamScore() {
  const now = Date.now();
  if (now - lastTeamScoreRender < 150) return;
  lastTeamScoreRender = now;
  const teams = currentState.teams;
  if (!teams) return;
  const red = document.getElementById('tsRed');
  const blue = document.getElementById('tsBlue');
  const toWin = document.getElementById('tsToWin');
  if (!red || !blue) return;
  red.textContent = `🔴 Красные ${teams.score[0]}`;
  blue.textContent = `${teams.score[1]} Синие 🔵`;
  if (myTeam === 0) red.classList.add('my');
  else red.classList.remove('my');
  if (myTeam === 1) blue.classList.add('my');
  else blue.classList.remove('my');
  toWin.textContent = `до ${teams.toWin}`;
  const ts = document.getElementById('teamScore');
  if (ts) ts.style.display = teams.score ? 'flex' : 'none';
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
const myModelEl = document.getElementById('myModel');

function updateMyRank(me) {
  myRankEl.textContent = `${rankName(me.kills)} · ${me.kills} килов · ${me.deaths} смертей`;
  const m = TANK_MODELS.find(x => x.id === me.model);
  if (myModelEl) myModelEl.textContent = '🛡 ' + (m ? m.name : 'Средний');
}

// ---------------------------------------------------------------------------
// ПЫЛЬ ПОД ГУСЕНИЦАМИ — ВИДНА ВСЕМ ИГРОКАМ
// ---------------------------------------------------------------------------
const playerDustTimers = new Map();
const playerExhaustTimers = new Map();
const exhaustPrevPos = new Map(); // позиции для расчёта скорости (у выхлопа свои, не путать с dust)
const playerPrevMoving = new Map();
const prevPlayerPos = new Map();
const prevChassisAngles = new Map(); // для расчёта резкости поворота (комки грязи)
const prevSpeeds = new Map();        // для определения разгона
const playerClodTimers = new Map();  // таймер комков грязи из-под гусениц

// Дым из выхлопа (постоянно при движении, клуб при старте)
function emitExhaust(players, dt) {
  if (!settingsState.effects) return;
  players.forEach(p => {
    if (!p.alive) return;
    const prev = exhaustPrevPos.get(p.id);
    let speed = 0;
    if (prev) speed = Math.hypot(p.x - prev.x, p.z - prev.z) / Math.max(dt, 0.001);
    exhaustPrevPos.set(p.id, { x: p.x, z: p.z });
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
  const c = TANK_MODEL_CFG[p.model] || TANK_MODEL_CFG.medium;
  for (const side of [-1, 1]) {
    // дым из выхлопных труб на корме (зависит от модели танка)
    const tx = p.x + rx * -c.pipeZ + Math.cos(a) * side * c.pipeX;
    const tz = p.z + rz * -c.pipeZ - Math.sin(a) * side * c.pipeX;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9c9c9c, transparent: true });
    const mesh = new THREE.Mesh(particleGeo, mat);
    const size = moving ? 2.5 + Math.random() * 2 : 1.8 + Math.random() * 1.4;
    mesh.scale.setScalar(size);
    mesh.position.set(tx, (p.y || 0) + c.pipeY, tz);
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
      ph: Math.random() * Math.PI * 2,
      fr: 1.2 + Math.random() * 1.8,
      am: 6 + Math.random() * 10,
      startOpacity: 0.8,
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

    // Резкость поворота (рад/с) с учётом перехода через ±PI
    const prevA = prevChassisAngles.get(p.id);
    let turnSign = 0;
    let turnRate = 0;
    if (prevA !== undefined) {
      let d = p.chassisAngle - prevA;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turnSign = d > 0 ? 1 : -1;
      turnRate = Math.abs(d) / Math.max(dt, 0.001);
    }
    prevChassisAngles.set(p.id, p.chassisAngle);

    // Разгон: скорость выросла заметно за кадр
    const prevSp = prevSpeeds.get(p.id);
    const accel = prevSp !== undefined && speed > prevSp + 35;
    prevSpeeds.set(p.id, speed);

    const hardTurn = turnRate > 1.4; // резкий поворот/разворот на месте

    // Пыль назад от движения (интенсивнее при повороте/разгоне)
    let t = playerDustTimers.get(p.id) || 0;
    t -= dt;
    if (t <= 0) {
      playerDustTimers.set(p.id, hardTurn || accel ? 0.05 : 0.1);
      const bx = -Math.sin(p.chassisAngle);
      const bz = -Math.cos(p.chassisAngle);
      const bursts = hardTurn ? 2 : 1;
      for (let b = 0; b < bursts; b++) {
        for (const side of [-1, 1]) {
          const tx = p.x + Math.cos(p.chassisAngle) * side * 15;
          const tz = p.z - Math.sin(p.chassisAngle) * side * 15;
          const mat = new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0x8a7a55 : 0x6b5b3f, transparent: true });
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
      }
    } else {
      playerDustTimers.set(p.id, t);
    }

    // Комки грязи/травы: при движении, особенно при резком повороте или разгоне
    if (!hardTurn && !accel && speed < 25) return;
    let ct = playerClodTimers.get(p.id) || 0;
    ct -= dt;
    if (ct > 0) { playerClodTimers.set(p.id, ct); return; }
    playerClodTimers.set(p.id, hardTurn ? 0.08 : 0.16);

    const bx = -Math.sin(p.chassisAngle);
    const bz = -Math.cos(p.chassisAngle);
    // при повороте комки вылетают наружу поворота, при разгоне — назад
    const latX = Math.cos(p.chassisAngle) * turnSign;
    const latZ = -Math.sin(p.chassisAngle) * turnSign;
    const clodCount = hardTurn ? 4 : 2;
    for (let i = 0; i < clodCount; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const tx = p.x + Math.cos(p.chassisAngle) * side * (13 + Math.random() * 5);
      const tz = p.z - Math.sin(p.chassisAngle) * side * (13 + Math.random() * 5);
      const mat = new THREE.MeshBasicMaterial({ color: [0x5a4630, 0x6b5233, 0x4a3826, 0x557a3a][Math.floor(Math.random() * 4)], transparent: true });
      const mesh = new THREE.Mesh(particleGeo, mat);
      mesh.scale.setScalar(1.6 + Math.random() * 1.6);
      mesh.position.set(tx, 0.6 + Math.random() * 1.5, tz);
      scene.add(mesh);
      const latPow = hardTurn ? 1 : 0.35; // при повороте грязь летит сильнее вбок
      particles.push({
        mesh,
        vx: -bx * (40 + Math.random() * 60) + latX * (30 + Math.random() * 90) * latPow,
        vy: 45 + Math.random() * 60,
        vz: -bz * (40 + Math.random() * 60) + latZ * (30 + Math.random() * 90) * latPow,
        grav: 150, // комки тяжёлые — быстро падают
        grow: 0.3,
        born: performance.now(),
        life: 450 + Math.random() * 350,
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
        <span class="lbTeam lbTeam${p.team === 0 ? 'Red' : 'Blue'}"></span>
        <span class="name">${escapeHtml(p.nickname)}${p.bot ? ' 🤖' : ''}</span>
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
    playDeathSound();
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

// ---------------------------------------------------------------------------
// ПРЕДИКЦИЯ СВОЕГО ТАНКА: мгновенный отклик на клавиши при высоком пинге.
// От базовой позиции последнего state мы сами просчитываем движение локально
// (те же константы физики, что на сервере), сервер потом подтверждает.
// ---------------------------------------------------------------------------
const PRED_TURN = 2.6, PRED_TURRET = 12, PRED_SPEED = 160, PRED_RADIUS = 20;
let selfPred = null;   // { baseTime, x, z, chassisAngle, turretAngle } — база от последнего state
let selfVisX = 0, selfVisZ = 0, selfVisInit = false; // сглаженная позиция (прыжки при рассинхроне)
let downTreeIdx = new Set(); // индексы поваленных деревьев

function updateSelfPrediction(me) {
  selfPred = { baseTime: Date.now(), x: me.x, z: me.z, chassisAngle: me.chassisAngle, turretAngle: me.turretAngle };
}

function selfBuffActiveC(id) {
  const me = currentState.players.find(p => p.id === selfId);
  if (!me) return false;
  return (me.effects || []).some(e => e.id === id);
}

function circleRectClient(cx, cz, r, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestZ = Math.max(rect.z, Math.min(cz, rect.z + rect.d));
  const dx = cx - closestX, dz = cz - closestZ;
  return (dx * dx + dz * dz) < r * r;
}

function clientBlocked(x, z) {
  if (x < PRED_RADIUS || x > 6000 - PRED_RADIUS || z < PRED_RADIUS || z > 6000 - PRED_RADIUS) return true;
  for (let i = 0; i < obstaclesData.length; i++) {
    const o = obstaclesData[i];
    if (o.type === 'tree' && downTreeIdx.has(i)) continue;
    if (circleRectClient(x, z, PRED_RADIUS, o)) return true;
  }
  return false;
}

function lerpAngleAdvance(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= t) return b;
  return a + Math.sign(diff) * t;
}

function predictedSelf() {
  if (!selfPred) return null;
  const dt = Math.min((Date.now() - selfPred.baseTime) / 1000, 1.5);
  let x = selfPred.x, z = selfPred.z;
  let ch = selfPred.chassisAngle;
  let tur = selfPred.turretAngle;

  // Башня доворачивается к мыши (та же скорость, что на сервере)
  let turretMult = 1;
  if (selfBuffActiveC('fastturret')) turretMult *= 2;
  if (selfBuffActiveC('overdrive')) turretMult *= 1.4;
  tur = lerpAngleAdvance(tur, targetTurretAngle, PRED_TURRET * turretMult * dt);

  // Поворот корпуса
  let turnMult = 1;
  if (selfBuffActiveC('spin')) turnMult *= 1.8;
  if (selfBuffActiveC('overdrive')) turnMult *= 1.15;
  if (selfBuffActiveC('emp')) turnMult *= 0.7;
  if (selfBuffActiveC('slow')) turnMult *= 0.6;
  if (keys.left) ch += PRED_TURN * turnMult * dt;
  if (keys.right) ch -= PRED_TURN * turnMult * dt;

  // Движение с локальной проверкой препятствий
  let speedMult = 1;
  if (selfBuffActiveC('speed')) speedMult *= 1.35;
  if (selfBuffActiveC('overdrive')) speedMult *= 1.15;
  if (selfBuffActiveC('emp')) speedMult *= 0.7;
  if (selfBuffActiveC('slow')) speedMult *= 0.6;
  let dir = 0;
  if (keys.forward) dir += 1;
  if (keys.back) dir -= 1;
  if (dir !== 0) {
    const step = PRED_SPEED * speedMult * dt * dir;
    const nx = x + Math.sin(ch) * step;
    const nz = z + Math.cos(ch) * step;
    if (!clientBlocked(nx, z)) x = nx;
    if (!clientBlocked(x, nz)) z = nz;
  }
  return { x, z, chassisAngle: ch, turretAngle: tur };
}

// Наложить предсказанную позицию своего танка на список для рендера
function applySelfPrediction(players, dt) {
  const pred = predictedSelf();
  if (!pred) return players;
  const i = players.findIndex(p => p.id === selfId);
  if (i < 0) return players;
  if (!selfVisInit) {
    selfVisX = pred.x; selfVisZ = pred.z;
    selfVisInit = true;
  }
  const dx = pred.x - selfVisX, dz = pred.z - selfVisZ;
  const jump = Math.hypot(dx, dz);
  const k = jump > 8 ? 1 - Math.exp(-6 * dt) : 1; // прыжок — плавно догоняем сервер
  selfVisX += dx * k;
  selfVisZ += dz * k;
  players[i] = {
    ...players[i],
    x: selfVisX,
    z: selfVisZ,
    chassisAngle: pred.chassisAngle,
    turretAngle: pred.turretAngle,
  };
  return players;
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
      mesh = createTankMesh(p.color, p.model);
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
      mesh = createTankMesh(p.color, p.model);
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
      prevChassisAngles.delete(id);
      prevSpeeds.delete(id);
      playerClodTimers.delete(id);
      playerExhaustTimers.delete(id);
      exhaustPrevPos.delete(id);
      playerPrevMoving.delete(id);
      wreckedTimers.delete(id);
      tankPrevY.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// МЕТКИ КОМАНД НАД ТАНКАМИ: имя + HP в цвете команды (DOM-слой)
// ---------------------------------------------------------------------------
const tankLabelEls = new Map(); // id -> { root, name, hpFill, hpWrap }
const labelProjV = new THREE.Vector3();

function getTankLabelEl(p) {
  let el = tankLabelEls.get(p.id);
  if (el) return el;
  const root = document.createElement('div');
  root.className = 'tankLabel';
  root.innerHTML = '<div class="tlName"></div><div class="tlHp"><div class="tlHpFill"></div></div>';
  document.getElementById('tankLabels').appendChild(root);
  el = { root, name: root.querySelector('.tlName'), hpFill: root.querySelector('.tlHpFill') };
  tankLabelEls.set(p.id, el);
  return el;
}

function updateTankLabels(players) {
  const labelsEl = document.getElementById('tankLabels');
  if (!labelsEl) return;
  const w = renderer.domElement.clientWidth || window.innerWidth;
  const h = renderer.domElement.clientHeight || window.innerHeight;

  players.forEach(p => {
    const el = tankLabelEls.get(p.id);
    if (p.id === selfId || !p.alive) {
      if (el) el.root.style.display = 'none'; // мёртвый или свой — метку прячем
      return;
    }
    const st = currentState.players.find(x => x.id === p.id);
    const invis = st && (st.effects || []).some(e => e.id === 'invis');
    if (invis) {
      if (el) el.root.style.display = 'none';
      return;
    }

    const label = getTankLabelEl(p);
    const teamColor = TEAM_COLORS_C[p.team] || '#ffffff';
    label.name.textContent = (p.bot ? '🤖 ' : '') + p.nickname;
    label.name.style.color = teamColor;
    const pct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
    label.hpFill.style.width = pct + '%';
    label.hpFill.style.background = teamColor;
    label.root.classList.toggle('enemy', p.team !== myTeam);
    label.root.classList.toggle('ally', p.team === myTeam);

    labelProjV.set(p.x, 46, p.z);
    const dist = labelProjV.distanceTo(camera.position);
    labelProjV.project(camera);
    if (labelProjV.z > 1 || dist > 1500) {
      label.root.style.display = 'none';
      return;
    }
    const px = (labelProjV.x * 0.5 + 0.5) * w;
    const py = (-labelProjV.y * 0.5 + 0.5) * h;
    label.root.style.left = px + 'px';
    label.root.style.top = py + 'px';
    label.root.style.display = '';
  });

  // убираем метки пропавших игроков
  for (const [id, el] of tankLabelEls) {
    if (!players.some(p => p.id === id)) {
      el.root.remove();
      tankLabelEls.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// ОБЛОМКИ ВЗОРВАННЫХ ТАНКОВ (не исчезают, но живут 30 сек)
// ---------------------------------------------------------------------------
const wrecks = [];
const MAX_WRECKS = 15;
const WRECK_LIFE_MS = 30000;

function keepAsWreck(mesh) {
  wrecks.push({ mesh, born: performance.now() });
}

function removeWreck(i) {
  const w = wrecks[i];
  scene.remove(w.mesh);
  w.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose?.(); o.material.dispose?.(); } });
  wreckedTimers.delete(w.mesh.id);
  wrecks.splice(i, 1);
}

// Старые обломки убираем раз в кадр: по времени и по лимиту
function updateWreckCleanup() {
  const now = performance.now();
  while (wrecks.length && now - wrecks[0].born > WRECK_LIFE_MS) removeWreck(0);
  while (wrecks.length > MAX_WRECKS) removeWreck(0);
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

  for (let i = 0; i < 14; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xc8c8c8, transparent: true });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.scale.setScalar(5 + Math.random() * 6);
    const ang = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 20;
    mesh.position.set(cx + Math.cos(ang) * r, 8 + Math.random() * 14, cz + Math.sin(ang) * r);
    scene.add(mesh);
    particles.push({
      mesh,
      vx: (Math.random() - 0.5) * 22,
      vy: 28 + Math.random() * 26,
      vz: (Math.random() - 0.5) * 22,
      grav: 16, // дым лёгкий — поднимается вверх
      grow: 0.55,
      born: performance.now(),
      life: 1500 + Math.random() * 900,
      ph: Math.random() * Math.PI * 2,
      fr: 1.2 + Math.random() * 1.8,
      am: 10 + Math.random() * 18,
      startOpacity: 0.75,
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

// Взрыв при попадании (крупный огненный шар, быстро растёт и гаснет)
const explosions = [];
const EXPLOSION_LIFE_MS = 450;
function spawnExplosion(x, z) {
  if (!settingsState.effects) return;
  const colors = [0xff8a2a, 0xffd75e, 0xff5a3d];
  const group = new THREE.Group();
  colors.forEach((c) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(6 + Math.random() * 5, 8, 8), new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.position.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 18);
    group.add(mesh);
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4, 7, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  const light = new THREE.PointLight(0xff8833, 8, 420, 1.6);
  light.userData.base = 8;
  group.add(light);
  group.position.set(x, 18, z);
  scene.add(group);
  explosions.push({ group, born: performance.now() });

  // Огненные частицы + искры + пылевая волна
  spawnParticles(x, 18, z, 18, [0xff8a2a, 0xffd75e, 0xff5a3d, 0xffffff], 200, 1.4, 700, 2.4, 2);
  spawnSparkBurst(x, 16, z, 18, 0xffd75e, 320, 420);
  spawnDustWave(x, z);
}

// Попадание снаряда в броню: искры с гравитацией, вспышка света, осколки, дым
function spawnImpact(x, z) {
  if (!settingsState.effects) return;
  spawnSparkBurst(x, 16, z, 26, 0xffd75e, 380, 450);
  spawnFlashLight(x, 18, z, 16, 380, 220);
  spawnImpactDebris(x, z);
  spawnImpactSmoke(x, z);
}

// Быстро гаснущая вспышка света — освещает окружение в момент удара
const lightFlashes = [];
function spawnFlashLight(x, y, z, intensity, distance, lifeMs) {
  if (!settingsState.effects) return;
  const light = new THREE.PointLight(0xffcc77, intensity, distance, 1.6);
  light.position.set(x, y, z);
  scene.add(light);
  lightFlashes.push({ light, base: intensity, born: performance.now(), lifeMs });
}

function updateLightFlashes(now) {
  for (let i = lightFlashes.length - 1; i >= 0; i--) {
    const f = lightFlashes[i];
    const t = (now - f.born) / f.lifeMs;
    if (t >= 1) { scene.remove(f.light); lightFlashes.splice(i, 1); continue; }
    f.light.intensity = f.base * Math.pow(1 - t, 2);
  }
}

// Множество мелких ярких горящих искр с гравитацией — разлетаются и падают на землю
function spawnSparkBurst(x, y, z, count, color, speed, life) {
  if (!settingsState.effects) return;
  const sparkColors = [0xffffff, 0xfff3c4, 0xffd75e, 0xff9d3d];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: sparkColors[i % sparkColors.length], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(particleGeo, mat);
    mesh.scale.setScalar(1.2 + Math.random() * 1.4);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const el = Math.random() * Math.PI;
    const sp = speed * (0.5 + Math.random() * 0.7);
    particles.push({
      mesh,
      vx: Math.cos(a) * Math.sin(el) * sp,
      vy: Math.abs(Math.cos(el)) * sp + 40,
      vz: Math.sin(a) * Math.sin(el) * sp,
      grav: 170, // сильная гравитация — искры дугой падают на землю
      grow: -1.2, // искры сгорают и уменьшаются
      born: performance.now(),
      life: life * (0.6 + Math.random() * 0.6),
      startOpacity: 1,
    });
  }
}

// Мелкие осколки брони в точке попадания
function spawnImpactDebris(x, z) {
  if (!settingsState.effects) return;
  for (let i = 0; i < 6; i++) {
    const s = 1.6 + Math.random() * 2.4;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * 0.7, s * 0.5),
      new THREE.MeshBasicMaterial({ color: [0x2a2a2a, 0x444444, 0x333333][i % 3] })
    );
    mesh.position.set(x + (Math.random() - 0.5) * 6, 14 + Math.random() * 6, z + (Math.random() - 0.5) * 6);
    scene.add(mesh);
    flyingBits.push({
      mesh,
      vx: (Math.random() - 0.5) * 260,
      vy: 80 + Math.random() * 140,
      vz: (Math.random() - 0.5) * 260,
      spinX: (Math.random() - 0.5) * 16,
      spinY: (Math.random() - 0.5) * 16,
      born: performance.now(),
    });
  }
}

// Дымные следы от точки соприкосновения снаряда с бронёй
function spawnImpactSmoke(x, z) {
  if (!settingsState.effects) return;
  spawnParticles(x, 14, z, 5, [0x444444, 0x555555, 0x666666], 30, 1.6, 900, 3, 1.5, { grav: 10, startOpacity: 0.8 });
}

// Рикошет: снаряд не пробил преграду
function spawnSpark(x, z) {
  if (!settingsState.effects) return;
  spawnSparkBurst(x, 16, z, 14, 0xffd75e, 300, 380);
  spawnFlashLight(x, 16, z, 6, 220, 160);
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
    e.group.scale.setScalar(1 + t * 6);
    e.group.children.forEach(c => {
      if (c.isPointLight) { c.intensity = c.userData.base * (1 - t); return; }
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

function spawnParticles(x, y, z, count, colors, speed, upBias, life, size, grow, opts) {
  if (!settingsState.effects) return;
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true });
    if (opts && opts.blend) { mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; }
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
      // турбулентность: клубящаяся анимация дыма
      ph: Math.random() * Math.PI * 2,
      fr: 1.2 + Math.random() * 1.8,
      am: 8 + Math.random() * 14,
      startOpacity: opts && opts.startOpacity !== undefined ? opts.startOpacity : 1,
      grav: opts && opts.grav !== undefined ? opts.grav : 60,
    });
  }
}

// Лимит частиц: старые удаляются, чтобы не накапливались
const MAX_PARTICLES = 800;

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
    // клубящийся дым: турбулентность растёт со временем
    if (p.ph !== undefined) {
      const k = p.am * t * dt;
      p.mesh.position.x += Math.sin(now * 0.004 * p.fr + p.ph) * k * 3;
      p.mesh.position.z += Math.cos(now * 0.004 * p.fr + p.ph * 1.3) * k * 3;
      p.mesh.position.y += Math.sin(now * 0.005 * p.fr + p.ph) * k * 1.2;
    }
    // мягкое затухание: сначала долго держится, в конце тает
    p.mesh.material.opacity = (p.startOpacity || 1) * Math.pow(1 - t, 1.5);
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
// Объёмный след гусеницы: коробка с высотой (3.2 ширина, 9 длина, 0.22 высота).
// Ориентация: после rotation.x=-PI/2 длина ложится вдоль Z, высота — в мировую Y.
const trackGeo = new THREE.BoxGeometry(3.2, 9, 0.22);
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
    // тёмно-землистый цвет протектора, слегка возвышается над травой
    mesh = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ color: 0x171310, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
  }
    mesh.position.set(x, 0.13, z); // верх следа над травой — «объёмный» протектор
    mesh.rotation.z = Math.PI / 2 - angle;
    mesh.material.opacity = 0.55;
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
    m.mesh.material.opacity = 0.55 * (1 - age / TRACK_LIFE_MS);
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
  const tankColor = mesh.userData.color || 0x555555;
  // Башня (с дулом) взлетает и падает отдельно
  launchBit(breakOffPart(mesh.userData.turretPivot), 90);
  // Остов НЕ чернеет — сохраняет цвет танка (обгоревший вид даёт огонь и дым)
  // Первичная вспышка + вторичный взрыв с задержкой
  spawnExplosion(mesh.position.x, mesh.position.z);
  setTimeout(() => spawnExplosion(mesh.position.x + (Math.random() - 0.5) * 20, mesh.position.z + (Math.random() - 0.5) * 20), 140);
  // Густой клубящийся чёрно-серый дым
  spawnParticles(mesh.position.x, 24, mesh.position.z, 16, [0x1a1a1a, 0x2e2e2e, 0x444444, 0x666666], 50, 2.4, 2000, 7, 0.7, { startOpacity: 0.9 });
  // Огненный шар
  spawnParticles(mesh.position.x, 20, mesh.position.z, 14, [0xff8a2a, 0xff5a3d, 0xffd75e], 230, 1.4, 950, 3.2);
  // Искры во все стороны
  spawnSparkBurst(mesh.position.x, 16, mesh.position.z, 30, 0xffd75e, 400, 500);
  // Обломки корпуса в цвет танка
  spawnDebris(mesh.position.x, mesh.position.z, tankColor);
}

// Мелкие обломки корпуса с физикой полёта (часть — в цвет танка, часть — гусеницы)
const debrisColors = [0x3a3a3a, 0x555555, 0x2e2e2e, 0x4a4a4a];

function spawnDebris(x, z, tankColor) {
  if (!settingsState.effects) return;
  for (let i = 0; i < 13; i++) {
    let mesh;
    if (i % 4 === 0) {
      // кусок гусеницы — вытянутая тёмная пластина
      mesh = new THREE.Mesh(new THREE.BoxGeometry(2 + Math.random() * 2, 1.2, 6 + Math.random() * 5), new THREE.MeshBasicMaterial({ color: 0x101010 }));
    } else {
      // кусок брони: первые — в цвет танка, остальные — тёмный металл
      const col = i < 7 && tankColor ? tankColor : debrisColors[i % debrisColors.length];
      const s = 2.5 + Math.random() * 4.5;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s * 0.7), new THREE.MeshBasicMaterial({ color: col }));
    }
    mesh.position.set(x + (Math.random() - 0.5) * 16, 12 + Math.random() * 14, z + (Math.random() - 0.5) * 16);
    scene.add(mesh);
    flyingBits.push({
      mesh,
      vx: (Math.random() - 0.5) * 300,
      vy: 110 + Math.random() * 200,
      vz: (Math.random() - 0.5) * 300,
      spinX: (Math.random() - 0.5) * 18,
      spinY: (Math.random() - 0.5) * 18,
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
  wrecks.forEach(w => sources.push(w.mesh));

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

// Звук попадания по моему танку
const hitMeSound = new Audio('1.mp3');
hitMeSound.preload = 'auto';
hitMeSound.load();
hitMeSound.volume = settingsState.volume;

function playHitMeSound() {
  try {
    hitMeSound.currentTime = 0;
    const p = hitMeSound.play();
    if (p) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

// Звук уничтожения моего танка
const deathSound = new Audio('tank-unichtozhen.mp3');
deathSound.preload = 'auto';
deathSound.load();
deathSound.volume = settingsState.volume;

function playDeathSound() {
  try {
    deathSound.currentTime = 0;
    const p = deathSound.play();
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

  // Солнце и его тени следуют за игроком
  sunLight.position.set(me.x + 300, 500, me.z + 200);
  sunLight.target.position.set(me.x, 0, me.z);

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
    const turretY = (tankMeshes.get(selfId) || {}).userData?.turretY || 17;
    const tipWorld = new THREE.Vector3(
      me.x + Math.sin(turretAngle) * 34,
      turretY + 18 + myY,
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
    applySelfPrediction(players, dt);

    syncTanks(players);
    syncBullets(bullets);
    updateTankRecoils(dt);
    syncPickups(currentState.pickups, now);
    updateMuzzleFlashes();
    updateExplosions();
    updateParticles(dt, now);
    updateLightFlashes(now);
    updateFlyingBits(dt, now);
    updateTrackMarks(players, now);
    updateDamageTexts(now);
    updateEngineSound();
    emitTrackDust(players, dt);
    emitExhaust(players, dt);
    updateWreckedFires(now, dt);
    updateWreckCleanup();
    updateClouds(dt);
    updateScopeInfo();
    updateArtilleryVisuals(now);
    updateFallingTrees(now);
    drawMinimap(now);
    updateCamera(players);
    updateTankLabels(players);
    skyDome.position.copy(camera.position);
  }

  // Превью танка в меню: крутится, пока открыт экран ника
  if (!nicknameOverlay.classList.contains('hidden') && previewTank) {
    previewTank.rotation.y += 0.008;
    previewRenderer.render(previewScene, previewCamera);
  }

  renderer.render(scene, camera);
}

let lastFrameTime = performance.now();
animate();
