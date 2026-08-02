// ============================================================================
// TANKS MULTIPLAYER 3D — SERVER
// Авторитетный сервер: физика в горизонтальной плоскости X/Z (Y — высота,
// используется только на клиенте для 3D-рендера). Классическое танковое
// управление: W/S — вперёд/назад по направлению корпуса, A/D — поворот
// корпуса. Башня вращается независимо (её угол присылает клиент).
// ============================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// НАСТРОЙКИ ИГРЫ
// ---------------------------------------------------------------------------
const WORLD = { width: 6000, depth: 6000 }; // размеры карты по X и Z
const TICK_RATE = 60;
const TANK_RADIUS = 20;
const TANK_BASE_SPEED = 160;        // px(units)/сек вперёд-назад
const TANK_TURN_SPEED = 2.6;        // рад/сек поворота корпуса
const TURRET_TURN_SPEED = 12.0;      // рад/сек доворота башни к цели (сглаживание)
const BULLET_SPEED = 520;
const BULLET_RADIUS = 5;
const BULLET_BASE_DAMAGE = 34;
const BASE_RELOAD_MS = 2000;
const RESPAWN_DELAY_MS = 3500;
const SPAWN_PROTECT_MS = 3000;
const MAX_HP = 100;
const KILLS_FOR_ROULETTE = 3;
const OBSTACLES = generateObstacles();

// Артиллерия: удар по точке раз в минуту (с задержкой падения снаряда)
const ARTILLERY_COOLDOWN_MS = 60000;
const ARTILLERY_RADIUS = 130;
const ARTILLERY_DAMAGE = 65;
const ARTILLERY_DELAY_MS = 1400;
const artilleryStrikes = []; // { x, z, impactAt, ownerId }

// Ранги за килы
const RANKS = [
  { kills: 0, name: 'Рядовой' },
  { kills: 3, name: 'Ефрейтор' },
  { kills: 6, name: 'Сержант' },
  { kills: 10, name: 'Лейтенант' },
  { kills: 15, name: 'Капитан' },
  { kills: 21, name: 'Майор' },
  { kills: 28, name: 'Полковник' },
  { kills: 40, name: 'Генерал' },
  { kills: 60, name: 'Легенда' },
];

function rankFor(kills) {
  let rank = RANKS[0];
  for (const r of RANKS) if (kills >= r.kills) rank = r;
  return rank;
}

// Типы снарядов: 'ap' — бронебойный (сильнее, без разлёта), 'he' — фугас (слабее, по площади)
const AMMO_AP_DAMAGE = 1.3;
const AMMO_HE_DAMAGE = 0.7;
const AMMO_HE_BLAST_RADIUS = 80;
const AMMO_HE_BLAST_FACTOR = 0.6;

// Бонусы на карте
const PICKUP_TYPES = [
  { type: 'heal',  color: '#27ae60', radius: 32 },
  { type: 'speed', color: '#f1c40f', radius: 32 },
  { type: 'rapid', color: '#e74c3c', radius: 32 },
];
const PICKUP_COUNT = 14;
const PICKUP_RESPAWN_MS = 10000;
const PICKUP_POSITIONS = generatePickupPositions();

// Батуты: 4 штуки на карте, подкидывают танк вверх
const TRAMPOLINE_RADIUS = 34;
const TRAMPOLINE_BOUNCE = 150;   // начальная вертикальная скорость при подбросе
const TRAMPOLINE_GRAVITY = 380;  // гравитация при прыжке
const TRAMPOLINE_COOLDOWN_MS = 1200;
const TRAMPOLINES = generateTrampolines();

function generateTrampolines() {
  const positions = [];
  let attempts = 0;
  while (positions.length < 6 && attempts < 500) {
    attempts++;
    const x = 250 + Math.random() * (WORLD.width - 500);
    const z = 250 + Math.random() * (WORLD.depth - 500);
    const hitsObstacle = OBSTACLES.some(o => circleRectCollision(x, z, 45, o));
    if (!hitsObstacle) positions.push({ x, z });
  }
  return positions;
}

function generatePickupPositions() {
  const positions = [];
  for (let k = 0; k < PICKUP_COUNT; k++) {
    const x = 200 + Math.random() * (WORLD.width - 400);
    const z = 200 + Math.random() * (WORLD.depth - 400);
    const hitsObstacle = OBSTACLES.some(o => circleRectCollision(x, z, 30, o));
    positions.push({ x, z, hitsObstacle });
  }
  return positions;
}

function getPickupSpot(idx) {
  const spot = PICKUP_POSITIONS[idx];
  if (!spot.hitsObstacle) return { x: spot.x, z: spot.z };
  // перепроверяем и ищем свободное место
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = 200 + Math.random() * (WORLD.width - 400);
    const z = 200 + Math.random() * (WORLD.depth - 400);
    const hitsObstacle = OBSTACLES.some(o => circleRectCollision(x, z, 30, o));
    if (!hitsObstacle) return { x, z };
  }
  return { x: WORLD.width / 2, z: WORLD.depth / 2 };
}

// ---------------------------------------------------------------------------
// РУЛЕТКА СПОСОБНОСТЕЙ (30 штук)
// instant — срабатывает мгновенно при выпадении
// passive — действует до конца жизни танка
// остальные — временный бафф на dur мс
// ---------------------------------------------------------------------------
const ABILITY_POOL = [
  { id: 'speed',      name: 'Турбо',           desc: '+35% скорости танка на 12 сек',                     color: '#f39c12', dur: 12000 },
  { id: 'damage',     name: 'Бронебойный',     desc: '+50% урона снарядов на 12 сек',                      color: '#e74c3c', dur: 12000 },
  { id: 'reload',     name: 'Скорострел',      desc: 'Перезарядка в 2 раза быстрее на 12 сек',             color: '#2ecc71', dur: 12000 },
  { id: 'bulletsp',   name: 'Быстрые пули',    desc: 'Снаряды летят на 30% быстрее на 12 сек',             color: '#3498db', dur: 12000 },
  { id: 'triple',     name: 'Веер',            desc: 'Тройной выстрел веером на 10 сек',                   color: '#9b59b6', dur: 10000 },
  { id: 'heal',       name: 'Ремнабор',        desc: '+60 HP мгновенно',                                   color: '#27ae60', instant: true },
  { id: 'regen',      name: 'Регенерация',     desc: '+3 HP в секунду на 10 сек',                          color: '#1abc9c', dur: 10000 },
  { id: 'shield',     name: 'Неуязвимость',    desc: 'Полная защита на 4 сек',                             color: '#f1c40f', dur: 4000 },
  { id: 'invis',      name: 'Невидимость',     desc: 'Почти невидимый на 8 сек',                           color: '#95a5a6', dur: 8000 },
  { id: 'fastturret', name: 'Острая башня',    desc: 'Башня вращается в 2 раза быстрее на 12 сек',         color: '#e67e22', dur: 12000 },
  { id: 'blast',      name: 'Фугас',           desc: 'Снаряды взрываются по площади на 12 сек',            color: '#d35400', dur: 12000 },
  { id: 'freeze',     name: 'Мороз',           desc: 'Попадания замедляют цель на 40% на 12 сек',          color: '#85c1e9', dur: 12000 },
  { id: 'burn',       name: 'Зажигательный',   desc: 'Попадания поджигают: 2 HP/с на 12 сек',              color: '#e74c3c', dur: 12000 },
  { id: 'lifesteal',  name: 'Вампир',          desc: 'Лечит 25% нанесённого урона на 12 сек',              color: '#c0392b', dur: 12000 },
  { id: 'crit',       name: 'Критик',          desc: '25% шанс двойного урона на 15 сек',                  color: '#f1c40f', dur: 15000 },
  { id: 'pierce',     name: 'Пробой',          desc: 'Снаряд пробивает 1 врага насквозь на 12 сек',        color: '#2980b9', dur: 12000 },
  { id: 'nuke',       name: 'Ядерный удар',    desc: 'Взрыв вокруг себя: 50 урона всем рядом',             color: '#ff5722', instant: true },
  { id: 'kamikaze',   name: 'Камikадзе',       desc: 'При гибели взрыв 60 урона всем рядом',               color: '#c0392b', passive: true },
  { id: 'second',     name: 'Второй шанс',     desc: 'При смертельном ударе остаётся 5 HP',                color: '#16a085', passive: true },
  { id: 'thorn',      name: 'Шипы',            desc: '25% полученного урона возвращается стрелку',         color: '#7f8c8d', passive: true },
  { id: 'rage',       name: 'Ярость',          desc: '+15% урона за каждый кил (до конца жизни)',          color: '#e74c3c', passive: true },
  { id: 'emp',        name: 'ЭМИ',             desc: 'Все враги замедлены на 30% на 4 сек',                color: '#8e44ad', instant: true },
  { id: 'teleport',   name: 'Телепорт',        desc: 'Мгновенный прыжок вперёд на 200',                    color: '#2c3e50', instant: true },
  { id: 'storm',      name: 'Гроза',           desc: 'Молнии бьют по врагам каждые 1.5 сек (8 сек)',       color: '#3498db', dur: 8000 },
  { id: 'jam',        name: 'Глушитель',       desc: 'Попадания сбивают перезарядку цели на 12 сек',       color: '#7d3c98', dur: 12000 },
  { id: 'armor',      name: 'Броня',           desc: '−25% получаемого урона на 12 сек',                   color: '#bdc3c7', dur: 12000 },
  { id: 'ricochet',   name: 'Рикошет',         desc: 'Снаряд отскакивает от стены 1 раз (15 сек)',         color: '#48c9b0', dur: 15000 },
  { id: 'overdrive',  name: 'Перегрузка',      desc: 'Всё на 15% быстрее: движение, выстрелы, башня (8 сек)', color: '#f5b041', dur: 8000 },
  { id: 'sharp',      name: 'Острота',         desc: '+15% урона навсегда',                                color: '#d7bde2', passive: true },
  { id: 'spin',       name: 'Волчок',          desc: 'Корпус поворачивается в 1.8 раза быстрее на 12 сек', color: '#aed6f1', dur: 12000 },
];

function generateObstacles() {
  const list = [];

  // Крупные блоки и скалы (сетка 19x19, шахматный порядок)
  const cols = 19, rows = 19;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if ((i + j) % 2 === 0) continue;
      if (i === 9 && j === 9) continue; // центр свободен
      const w = 80 + Math.random() * 50;
      const d = 80 + Math.random() * 50;
      const x = 150 + i * (WORLD.width - 300) / (cols - 1) - w / 2;
      const z = 150 + j * (WORLD.depth - 300) / (rows - 1) - d / 2;
      list.push({ x, z, w, d, type: Math.random() < 0.5 ? 'box' : 'rock' });
    }
  }

  // Разбросанные ящики
  for (let k = 0; k < 90; k++) {
    const w = 28 + Math.random() * 18;
    const d = 28 + Math.random() * 18;
    const x = 150 + Math.random() * (WORLD.width - 300 - w);
    const z = 150 + Math.random() * (WORLD.depth - 300 - d);
    const overlaps = list.some(o =>
      x < o.x + o.w + 6 && x + w > o.x - 6 &&
      z < o.z + o.d + 6 && z + d > o.z - 6
    );
    if (overlaps) continue;
    list.push({ x, z, w, d, type: 'crate' });
  }

  // Деревья (с коллизией)
  let trees = 0, attempts = 1500;
  while (trees < 180 && attempts-- > 0) {
    const s = 28;
    const x = 120 + Math.random() * (WORLD.width - 240);
    const z = 120 + Math.random() * (WORLD.depth - 240);
    const overlaps = list.some(o =>
      x < o.x + o.w + 20 && x + s > o.x - 20 &&
      z < o.z + o.d + 20 && z + s > o.z - 20
    );
    if (overlaps) continue;
    list.push({ x, z, w: s, d: s, type: 'tree', standing: true });
    trees++;
  }

  return list;
}

// ---------------------------------------------------------------------------
// СОСТОЯНИЕ ИГРЫ
// ---------------------------------------------------------------------------
const players = {};
const bullets = [];
let bulletIdCounter = 1;

// Бонусы на карте
const pickups = [];
for (let i = 0; i < PICKUP_COUNT; i++) {
  const p = getPickupSpot(i);
  pickups.push({ id: i, type: PICKUP_TYPES[i % PICKUP_TYPES.length].type, x: p.x, z: p.z, active: true, respawnAt: 0 });
}

const TANK_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6fa4',
  '#34495e', '#16a085', '#d35400', '#7f8c8d', '#8e44ad', '#ffffff'];
const TANK_MODELS = ['medium', 'light', 'heavy'];
const XP_PER_KILL = 100;

function randomColor() {
  return TANK_COLORS[Math.floor(Math.random() * TANK_COLORS.length)];
}

function randomNickname() {
  const adjectives = ['Быстрый', 'Стальной', 'Дикий', 'Тихий', 'Грозный', 'Ловкий', 'Танковый'];
  const nouns = ['Волк', 'Тигр', 'Ёж', 'Барсук', 'Сокол', 'Медведь', 'Лис'];
  return adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)] + Math.floor(Math.random() * 100);
}

function circleRectCollision(cx, cz, r, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestZ = Math.max(rect.z, Math.min(cz, rect.z + rect.d));
  const dx = cx - closestX;
  const dz = cz - closestZ;
  return (dx * dx + dz * dz) < r * r;
}

// Два конца карты: северо-запад и юго-восток, танки спавнятся по командам
const SPAWN_ZONES = [
  { x: 300, z: 300 },                            // северо-запад
  { x: WORLD.width - 300, z: WORLD.depth - 300 }, // юго-восток
];
let nextSpawnSide = 0; // 0 / 1 чередуются

function getSafeSpawnPoint(side) {
  const zone = SPAWN_ZONES[side];
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = zone.x + (Math.random() - 0.5) * 500;
    const z = zone.z + (Math.random() - 0.5) * 500;

    if (x < TANK_RADIUS || x > WORLD.width - TANK_RADIUS || z < TANK_RADIUS || z > WORLD.depth - TANK_RADIUS) continue;

    const hitsObstacle = OBSTACLES.some(o => circleRectCollision(x, z, TANK_RADIUS + 10, o));
    if (hitsObstacle) continue;

    const tooClose = Object.values(players).some(p => {
      const dx = p.x - x, dz = p.z - z;
      return Math.sqrt(dx * dx + dz * dz) < 250;
    });
    if (tooClose) continue;

    return { x, z };
  }
  return { x: zone.x, z: zone.z };
}

function createPlayer(id, nickname, color, model) {
  const side = nextSpawnSide;
  nextSpawnSide = 1 - nextSpawnSide;
  const spawn = getSafeSpawnPoint(side);
  return {
    id,
    side,
    nickname: nickname && nickname.trim() ? nickname.trim().slice(0, 16) : randomNickname(),
    x: spawn.x,
    z: spawn.z,
    y: 0,             // высота при подбросе батутом
    vy: 0,            // вертикальная скорость
    bounceCooldown: 0,
    model: TANK_MODELS.includes(model) ? model : 'medium',
    chassisAngle: 0,   // направление корпуса / движения (рад, вокруг Y)
    turretAngle: 0,    // направление башни (рад, вокруг Y) — независимо от корпуса
    color: color || randomColor(),
    hp: MAX_HP,
    maxHp: MAX_HP,
    alive: true,
    kills: 0,
    deaths: 0,
    ammo: 'ap',       // тип снаряда: ap / he
    damageMult: 1,
    buffs: {},        // временные способности: id -> { until }
    flags: {},        // пассивные способности: id -> true
    rageKills: 0,     // килы с активной «Яростью»
    jamUntil: 0,      // «Глушитель»: до этого момента нельзя стрелять
    spawnProtectUntil: Date.now() + SPAWN_PROTECT_MS,
    input: { forward: false, back: false, left: false, right: false, targetTurretAngle: 0, shooting: false, ammo: 'ap' },
    lastShotTime: 0,
    respawnAt: 0,
    killsSinceUpgrade: 0,
    artilleryReadyAt: 0, // раз в минуту можно вызвать артиллерию
  };
}

function buffActive(p, id) {
  return p.buffs[id] && p.buffs[id].until > Date.now();
}

// ---------------------------------------------------------------------------
// SOCKET.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {

  socket.on('join', (data) => {
    const nickname = data && data.nickname ? String(data.nickname) : '';
    const color = data && TANK_COLORS.includes(data.color) ? data.color : null;
    const player = createPlayer(socket.id, nickname, color, data && data.model);
    players[socket.id] = player;

    socket.emit('init', {
      selfId: socket.id,
      world: WORLD,
      obstacles: OBSTACLES,
      maxHp: MAX_HP,
    });

    console.log(`Игрок подключился: ${player.nickname} (${socket.id})`);
  });

  socket.on('artillery', (data) => {
    const p = players[socket.id];
    const now = Date.now();
    if (!p || !p.alive || now < p.artilleryReadyAt) return;
    const x = Math.max(0, Math.min(WORLD.width, Number(data && data.x) || 0));
    const z = Math.max(0, Math.min(WORLD.depth, Number(data && data.z) || 0));
    p.artilleryReadyAt = now + ARTILLERY_COOLDOWN_MS;
    artilleryStrikes.push({ x, z, impactAt: now + ARTILLERY_DELAY_MS, ownerId: p.id });
    io.emit('artillery', { x, z, impactAt: now + ARTILLERY_DELAY_MS, ownerId: p.id });
  });

  socket.on('input', (input) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    p.input.forward = !!input.forward;
    p.input.back = !!input.back;
    p.input.left = !!input.left;
    p.input.right = !!input.right;
    if (typeof input.targetTurretAngle === 'number') p.input.targetTurretAngle = input.targetTurretAngle;
    p.input.shooting = !!input.shooting;
    if (input.ammo === 'he' || input.ammo === 'ap') p.input.ammo = input.ammo;
  });

  socket.on('latencyReq', () => socket.emit('latencyRes'));

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) console.log(`Игрок отключился: ${p.nickname}`);
    delete players[socket.id];
  });
});

// ---------------------------------------------------------------------------
// ИГРОВОЙ ЦИКЛ
// ---------------------------------------------------------------------------
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.05);
  lastTick = now;

  for (const id in players) {
    const p = players[id];

    if (!p.alive) {
      if (now >= p.respawnAt) {
        const spawn = getSafeSpawnPoint(p.side);
        p.x = spawn.x;
        p.z = spawn.z;
        p.hp = p.maxHp;
        p.alive = true;
        p.spawnProtectUntil = now + SPAWN_PROTECT_MS; // защита на старте
        p.y = 0;
        p.vy = 0;
      }
      continue;
    }

    processBuffs(p, dt, now);
    updatePlayerMovement(p, dt);
    updatePlayerShooting(p, now);
    applyTrampolines(p, now, dt);
  }

  updateBullets(dt, now);
  updatePickups(now);
  updateArtillery(now);
  broadcastState();
}

// Артиллерия: снаряд падает через задержку, наносит урон по площади
function updateArtillery(now) {
  for (let i = artilleryStrikes.length - 1; i >= 0; i--) {
    const s = artilleryStrikes[i];
    if (now < s.impactAt) continue;
    artilleryStrikes.splice(i, 1);
    for (const id in players) {
      const t = players[id];
      if (!t.alive || t.id === s.ownerId) continue;
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      if (d < ARTILLERY_RADIUS) {
        const dmg = Math.round(ARTILLERY_DAMAGE * (1 - 0.65 * d / ARTILLERY_RADIUS));
        if (dmg > 0) dealDamage(t, dmg, s.ownerId, s.x, s.z, null, now);
      }
    }
  }
}

// Бонусы на карте: появление и подбор
function updatePickups(now) {
  for (const pk of pickups) {
    if (!pk.active) {
      if (now >= pk.respawnAt) {
        const spot = getPickupSpot(pk.id);
        pk.x = spot.x;
        pk.z = spot.z;
        pk.active = true;
      }
      continue;
    }

    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      const dx = p.x - pk.x, dz = p.z - pk.z;
      if (Math.sqrt(dx * dx + dz * dz) < 32) {
        applyPickup(p, pk.type, now);
        pk.active = false;
        pk.respawnAt = now + PICKUP_RESPAWN_MS;
        io.to(p.id).emit('pickup', { type: pk.type });
        break;
      }
    }
  }
}

function applyPickup(p, type, now) {
  if (type === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + 30);
  } else if (type === 'speed') {
    p.buffs.speed = { until: now + 5000 };
  } else if (type === 'rapid') {
    p.buffs.reload = { until: now + 3000 };
  }
}

function updatePlayerMovement(p, dt) {
  // Поворот корпуса (A/D) — «Волчок» ускоряет, «ЭМИ»/«Мороз» замедляют
  let turnMult = 1;
  if (buffActive(p, 'spin')) turnMult *= 1.8;
  if (buffActive(p, 'overdrive')) turnMult *= 1.15;
  if (buffActive(p, 'emp')) turnMult *= 0.7;
  if (buffActive(p, 'slow')) turnMult *= 0.6;
  if (p.input.left) p.chassisAngle += TANK_TURN_SPEED * turnMult * dt;
  if (p.input.right) p.chassisAngle -= TANK_TURN_SPEED * turnMult * dt;

  // Движение вперёд/назад по направлению корпуса (W/S)
  let speedMult = 1;
  if (buffActive(p, 'speed')) speedMult *= 1.35;
  if (buffActive(p, 'overdrive')) speedMult *= 1.15;
  if (buffActive(p, 'emp')) speedMult *= 0.7;
  if (buffActive(p, 'slow')) speedMult *= 0.6;
  const speed = TANK_BASE_SPEED * speedMult;
  let dir = 0;
  if (p.input.forward) dir += 1;
  if (p.input.back) dir -= 1;

  if (dir !== 0) {
    const dx = Math.sin(p.chassisAngle) * dir * speed * dt;
    const dz = Math.cos(p.chassisAngle) * dir * speed * dt;
    tryMove(p, p.x + dx, p.z + dz, dt);
  }

  // Башня плавно доворачивается к углу, присланному клиентом
  let turretMult = 1;
  if (buffActive(p, 'fastturret')) turretMult *= 2;
  if (buffActive(p, 'overdrive')) turretMult *= 1.4;
  p.turretAngle = lerpAngle(p.turretAngle, p.input.targetTurretAngle, TURRET_TURN_SPEED * turretMult * dt);
}

// Обработка временных способностей (регенерация, гроза, поджог, истечение)
function processBuffs(p, dt, now) {
  for (const id in p.buffs) {
    const b = p.buffs[id];
    if (b.until <= now) {
      delete p.buffs[id];
      continue;
    }
    if (id === 'regen') {
      p.hp = Math.min(p.maxHp, p.hp + 3 * dt);
    }
    if (id === 'burn') {
      p.hp -= 2 * dt;
      if (p.hp <= 0) {
        p.alive = false;
        p.deaths += 1;
        p.respawnAt = now + RESPAWN_DELAY_MS;
        p.buffs = {};
        p.flags = {};
        p.rageKills = 0;
        p.damageMult = 1;
      }
    }
    if (id === 'storm') {
      if (now >= b.next) {
        b.next = now + 1500;
        const targets = Object.values(players).filter(v => v.alive && v.id !== p.id);
        if (targets.length) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          dealDamage(target, 15, p.id, target.x, target.z);
        }
      }
    }
  }
}

function applyTrampolines(p, now, dt) {
  // Вертикальный полёт после подброса
  if (p.y > 0 || p.vy > 0) {
    p.y += p.vy * dt;
    p.vy -= TRAMPOLINE_GRAVITY * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
    }
  }
  // Наезд на батут — подброс
  if (p.y <= 0 && now >= p.bounceCooldown) {
    const tramp = TRAMPOLINES.find(t => Math.hypot(p.x - t.x, p.z - t.z) < TRAMPOLINE_RADIUS);
    if (tramp) {
      p.vy = TRAMPOLINE_BOUNCE;
      p.bounceCooldown = now + TRAMPOLINE_COOLDOWN_MS;
      io.to(p.id).emit('bounce', {});
    }
  }
}

// Деревья: сносятся под напором танка, но замедляют его
const TREE_PUSH_RATE = 90;  // накопление «ломки» в секунду при контакте
const TREE_HP = 45;         // ~0.5 сек напора, чтобы снести

// solid — жёсткое препятствие, tree — стоящее дерево (сносится), null — свободно
function obstacleAt(x, z) {
  for (const o of OBSTACLES) {
    if (!circleRectCollision(x, z, TANK_RADIUS, o)) continue;
    if (o.type === 'tree') {
      if (o.standing) return 'tree';
      continue; // срубленное дерево не мешает
    }
    return 'solid';
  }
  return null;
}

function tryMove(p, newX, newZ, dt) {
  newX = Math.max(TANK_RADIUS, Math.min(WORLD.width - TANK_RADIUS, newX));
  newZ = Math.max(TANK_RADIUS, Math.min(WORLD.depth - TANK_RADIUS, newZ));

  // По X
  const cX = obstacleAt(newX, p.z);
  if (cX === 'tree') {
    // дерево мешает: едем медленно и ломаем его
    p.x += (newX - p.x) * 0.25;
    pushTree(p, newX, p.z, dt);
  } else if (!cX) {
    p.x = newX;
  }

  // По Z
  const cZ = obstacleAt(p.x, newZ);
  if (cZ === 'tree') {
    p.z += (newZ - p.z) * 0.25;
    pushTree(p, p.x, newZ, dt);
  } else if (!cZ) {
    p.z = newZ;
  }
}

function pushTree(p, x, z, dt) {
  const tree = OBSTACLES.find(o => o.type === 'tree' && o.standing && circleRectCollision(x, z, TANK_RADIUS, o));
  if (!tree) return;
  tree.hp = (tree.hp || 0) + TREE_PUSH_RATE * dt;
  if (tree.hp >= TREE_HP) {
    tree.standing = false;
    io.emit('treeDown', { i: OBSTACLES.indexOf(tree), x: tree.x + tree.w / 2, z: tree.z + tree.d / 2 });
  }
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= t) return b;
  return a + Math.sign(diff) * t;
}

function updatePlayerShooting(p, now) {
  if (!p.input.shooting) return;
  if (now < p.jamUntil) return; // «Глушитель» — цель не может стрелять
  let reloadMult = 1;
  if (buffActive(p, 'reload')) reloadMult *= 0.5;
  if (buffActive(p, 'overdrive')) reloadMult *= 0.85;
  const reloadTime = BASE_RELOAD_MS * reloadMult;
  if (now - p.lastShotTime < reloadTime) return;

  p.lastShotTime = now;
  fireBullet(p);
}

function fireBullet(p) {
  const angles = buffActive(p, 'triple')
    ? [p.turretAngle - 0.18, p.turretAngle, p.turretAngle + 0.18]
    : [p.turretAngle];

  let speedMult = 1;
  if (buffActive(p, 'bulletsp')) speedMult *= 1.3;
  if (buffActive(p, 'overdrive')) speedMult *= 1.15;

  // Тип снаряда: 'ap' — бронебойный, 'he' — фугас
  const ammo = p.input.ammo || 'ap';

  for (const angle of angles) {
    let dmg = BULLET_BASE_DAMAGE * p.damageMult;
    if (buffActive(p, 'damage')) dmg *= 1.5;
    if (buffActive(p, 'overdrive')) dmg *= 1.15;
    if (p.flags.rage) dmg *= 1 + 0.15 * p.rageKills;
    if (buffActive(p, 'crit') && Math.random() < 0.25) dmg *= 2;
    if (ammo === 'ap') dmg *= AMMO_AP_DAMAGE;
    if (ammo === 'he') dmg *= AMMO_HE_DAMAGE;

    const spawnDist = TANK_RADIUS + 14;
    bullets.push({
      id: bulletIdCounter++,
      ownerId: p.id,
      x: p.x + Math.sin(angle) * spawnDist,
      z: p.z + Math.cos(angle) * spawnDist,
      vx: Math.sin(angle) * BULLET_SPEED * speedMult,
      vz: Math.cos(angle) * BULLET_SPEED * speedMult,
      damage: dmg,
      ownerColor: p.color,
      ricochet: buffActive(p, 'ricochet') ? 1 : 0,
      pierce: buffActive(p, 'pierce') ? 1 : 0,
      hitIds: [],
      freeze: buffActive(p, 'freeze'),
      burn: buffActive(p, 'burn'),
      jam: buffActive(p, 'jam'),
      blast: buffActive(p, 'blast') || ammo === 'he',
    });
  }
}

function updateBullets(dt, now) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.z += b.vz * dt;

    if (b.x < 0 || b.x > WORLD.width || b.z < 0 || b.z > WORLD.depth) {
      bullets.splice(i, 1);
      continue;
    }

    const hitObstacle = OBSTACLES.some(o => (o.type === 'tree' && !o.standing) ? false : circleRectCollision(b.x, b.z, BULLET_RADIUS, o));
    if (hitObstacle) {
      if (b.ricochet > 0) {
        // «Рикошет»: снаряд отскакивает от препятствия 1 раз
        b.ricochet--;
        b.x -= b.vx * dt;
        b.z -= b.vz * dt;
        b.vx = -b.vx;
        b.vz = -b.vz;
        continue;
      }
      io.emit('bulletBlocked', { x: b.x, z: b.z, ownerId: b.ownerId });
      bullets.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const id in players) {
      const p = players[id];
      if (!p.alive || p.id === b.ownerId) continue;

      const dx = p.x - b.x, dz = p.z - b.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < TANK_RADIUS + BULLET_RADIUS) {
        if (b.pierce > 0 && b.hitIds.includes(p.id)) continue;
        dealDamage(p, b.damage, b.ownerId, b.x, b.z, b, now);
        if (b.pierce > 0 && p.hp > 0) {
          // «Пробой»: снаряд летит дальше и не может дважды задеть эту цель
          b.hitIds.push(p.id);
          continue;
        }
        hit = true;
        break;
      }
    }

    if (hit) bullets.splice(i, 1);
  }
}

// Мгновенные способности из рулетки
function applyInstantAbility(ab, p, now) {
  switch (ab.id) {
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + 60);
      break;
    case 'nuke': {
      for (const id in players) {
        const t = players[id];
        if (t.alive && t.id !== p.id && Math.hypot(t.x - p.x, t.z - p.z) < 150) {
          dealDamage(t, 50, p.id, t.x, t.z, null, now);
        }
      }
      break;
    }
    case 'emp': {
      for (const id in players) {
        const t = players[id];
        if (t.alive && t.id !== p.id) t.buffs.emp = { until: now + 4000 };
      }
      break;
    }
    case 'teleport': {
      const nx = p.x + Math.sin(p.chassisAngle) * 200;
      const nz = p.z + Math.cos(p.chassisAngle) * 200;
      tryMove(p, nx, nz);
      break;
    }
  }
}

// Выдать случайную способность и запустить рулетку на клиенте
function grantAbility(p, now) {
  const candidates = ABILITY_POOL.filter(a => !(p.buffs[a.id] && p.buffs[a.id].until > now));
  if (!candidates.length) return;
  const ab = candidates[Math.floor(Math.random() * candidates.length)];

  if (ab.instant) {
    applyInstantAbility(ab, p, now);
  } else if (ab.passive) {
    p.flags[ab.id] = true;
  } else {
    p.buffs[ab.id] = { until: now + ab.dur, next: 0 };
  }

  io.to(p.id).emit('roulette', {
    ability: { id: ab.id, name: ab.name, desc: ab.desc, color: ab.color }
  });
}

function dealDamage(target, amount, attackerId, x, z, bullet, now) {
  if (!target.alive) return;
  if (now < target.spawnProtectUntil) {
    // защита после возрождения — урон не проходит
    io.emit('hit', { x: target.x, z: target.z, color: target.color, id: target.id, barrel: false, ownerId: attackerId, damage: 0 });
    return;
  }
  if (buffActive(target, 'shield')) {
    // «Неуязвимость» — урон не проходит, но попадание видно
    io.emit('hit', { x, z, color: target.color, id: target.id, barrel: false, ownerId: attackerId, damage: 0 });
    return;
  }

  let dmg = amount;

  // Зоны попадания: лоб бронирован, корма слабая, башня — уязвимое место
  if (bullet) {
    const hitAng = Math.atan2(bullet.x - target.x, bullet.z - target.z);
    let diff = Math.abs(hitAng - target.chassisAngle);
    while (diff > Math.PI) diff -= Math.PI * 2;
    diff = Math.abs(diff);

    let zoneMult = 1;
    if (diff < 1.0) zoneMult = 0.8;        // лоб — броня
    else if (diff < 2.4) zoneMult = 1.0;   // борт
    else zoneMult = 1.35;                  // корма — пробивается легче

    // Попадание в башню (уязвимое место)
    const turretX = target.x + Math.sin(target.turretAngle) * 6;
    const turretZ = target.z + Math.cos(target.turretAngle) * 6;
    if (Math.hypot(bullet.x - turretX, bullet.z - turretZ) < 13) zoneMult *= 1.2;

    dmg = Math.min(amount * 1.6, dmg * zoneMult);
  }

  if (buffActive(target, 'armor')) dmg *= 0.75;
  target.hp -= dmg;

  const attacker = players[attackerId];
  if (attacker) {
    if (buffActive(attacker, 'lifesteal')) attacker.hp = Math.min(attacker.maxHp, attacker.hp + dmg * 0.25);
    if (target.flags.thorn && attacker.id !== target.id) {
      dealDamage(attacker, dmg * 0.25, target.id, attacker.x, attacker.z, null, now);
    }
    if (bullet && bullet.freeze) target.buffs.slow = { until: now + 3000 };
    if (bullet && bullet.burn) target.buffs.burn = { until: now + 3000 };
    if (bullet && bullet.jam) target.jamUntil = now + 2000;
    if (bullet && bullet.blast) {
      // «Фугас»: взрыв по площади вокруг точки попадания
      for (const id in players) {
        const t = players[id];
        if (t.alive && t.id !== target.id && t.id !== attacker.id && Math.hypot(t.x - x, t.z - z) < 80) {
          dealDamage(t, amount * 0.6, attackerId, t.x, t.z, null, now);
        }
      }
    }
  }

  // Попадание в дуло? (кончик дула в 34 юнитах по направлению башни)
  const tipX = target.x + Math.sin(target.turretAngle) * 34;
  const tipZ = target.z + Math.cos(target.turretAngle) * 34;
  const hx = bullet ? bullet.x : x;
  const hz = bullet ? bullet.z : z;
  const barrelHit = Math.hypot(hx - tipX, hz - tipZ) < 16;

  io.emit('hit', { x: target.x, z: target.z, color: attacker ? attacker.color : '#ffffff', id: target.id, barrel: barrelHit, ownerId: attackerId, damage: Math.round(dmg) });

  if (target.hp <= 0) {
    if (target.flags.second) {
      // «Второй шанс» — выживание с 5 HP
      target.hp = 5;
      target.flags.second = false;
      return;
    }

    const wasKamikaze = target.flags.kamikaze;

    target.alive = false;
    target.deaths += 1;
    target.respawnAt = now + RESPAWN_DELAY_MS;
    // Способности сбрасываются при гибели
    target.buffs = {};
    target.flags = {};
    target.rageKills = 0;
    target.damageMult = 1;
    target.jamUntil = 0;

    // «Камikадзе» — взрыв при гибели
    if (wasKamikaze) {
      for (const id in players) {
        const t = players[id];
        if (t.alive && t.id !== target.id && Math.hypot(t.x - target.x, t.z - target.z) < 150) {
          dealDamage(t, 60, target.id, t.x, t.z, null, now);
        }
      }
    }

    if (attacker) {
      attacker.kills += 1;
      if (attacker.flags.rage) attacker.rageKills += 1;
      attacker.killsSinceUpgrade += 1;
      io.to(attacker.id).emit('xp', { amount: XP_PER_KILL }); // опыт за кил

      if (attacker.killsSinceUpgrade >= KILLS_FOR_ROULETTE) {
        attacker.killsSinceUpgrade = 0;
        grantAbility(attacker, now);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// РАССЫЛКА СОСТОЯНИЯ
// ---------------------------------------------------------------------------
function broadcastState() {
  const now = Date.now();
  const playersState = Object.values(players).map(p => {
    const effects = [];
    for (const id in p.buffs) {
      if (p.buffs[id].until > now) effects.push({ id, remainingMs: p.buffs[id].until - now });
    }
    for (const id in p.flags) {
      effects.push({ id, remainingMs: -1 }); // до конца жизни
    }
    if (p.alive && now < p.spawnProtectUntil) {
      effects.push({ id: 'protect', remainingMs: p.spawnProtectUntil - now });
    }
    return {
      id: p.id,
      nickname: p.nickname,
      x: p.x,
      z: p.z,
      y: p.y,
      chassisAngle: p.chassisAngle,
      turretAngle: p.turretAngle,
      color: p.color,
      model: p.model,
      hp: p.hp,
      maxHp: p.maxHp,
      reloadMs: Math.round(BASE_RELOAD_MS),
      alive: p.alive,
      kills: p.kills,
      deaths: p.deaths,
      ammo: p.input.ammo,
      effects,
      artilleryReadyAt: p.artilleryReadyAt,
    };
  });

  const bulletsState = bullets.map(b => ({
    id: b.id,
    x: b.x,
    z: b.z,
    color: b.ownerColor,
    ownerId: b.ownerId,
  }));

  const pickupsState = pickups.filter(pk => pk.active).map(pk => ({ id: pk.id, type: pk.type, x: pk.x, z: pk.z }));

  const treesState = OBSTACLES
    .map((o, i) => (o.type === 'tree' ? { i, standing: o.standing } : null))
    .filter(Boolean);

  io.emit('state', { players: playersState, bullets: bulletsState, pickups: pickupsState, trampolines: TRAMPOLINES, trees: treesState });
}

setInterval(tick, 1000 / TICK_RATE);

// ---------------------------------------------------------------------------
// ЗАПУСК
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`3D-сервер танчиков запущен: http://localhost:${PORT}`);
});
