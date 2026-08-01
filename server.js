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
const WORLD = { width: 2000, depth: 2000 }; // размеры карты по X и Z
const TICK_RATE = 60;
const TANK_RADIUS = 20;
const TANK_BASE_SPEED = 160;        // px(units)/сек вперёд-назад
const TANK_TURN_SPEED = 2.6;        // рад/сек поворота корпуса
const TURRET_TURN_SPEED = 6.0;      // рад/сек доворота башни к цели (сглаживание)
const BULLET_SPEED = 520;
const BULLET_RADIUS = 5;
const BULLET_BASE_DAMAGE = 34;
const BASE_RELOAD_MS = 2000;
const RESPAWN_DELAY_MS = 2500;
const MAX_HP = 100;
const KILLS_FOR_UPGRADE = 3;
const OBSTACLES = generateObstacles();

const UPGRADE_POOL = [
  { id: 'speed',    name: '+30% к скорости танка',        apply: p => { p.speedMult *= 1.3; } },
  { id: 'triple',   name: 'Стрельба тремя пулями веером',  apply: p => { p.tripleShot = true; } },
  { id: 'damage',   name: '+40% урона снаряда',            apply: p => { p.damageMult *= 1.4; } },
  { id: 'reload',   name: 'Перезарядка в 2 раза быстрее',  apply: p => { p.reloadMult *= 0.5; } },
  { id: 'hp',       name: '+50 максимального HP',          apply: p => { p.maxHp += 50; p.hp += 50; } },
  { id: 'bulletsp', name: 'Снаряды летят на 25% быстрее',  apply: p => { p.bulletSpeedMult *= 1.25; } },
];

function generateObstacles() {
  const list = [];

  // Крупные блоки и скалы (сетка 7x7, шахматный порядок)
  const cols = 7, rows = 7;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if ((i + j) % 2 === 0) continue;
      if (i === 3 && j === 3) continue; // центр свободен
      const w = 80 + Math.random() * 50;
      const d = 80 + Math.random() * 50;
      const x = 150 + i * (WORLD.width - 300) / (cols - 1) - w / 2;
      const z = 150 + j * (WORLD.depth - 300) / (rows - 1) - d / 2;
      list.push({ x, z, w, d, type: Math.random() < 0.5 ? 'box' : 'rock' });
    }
  }

  // Разбросанные ящики
  for (let k = 0; k < 30; k++) {
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
  let trees = 0, attempts = 500;
  while (trees < 60 && attempts-- > 0) {
    const s = 14;
    const x = 120 + Math.random() * (WORLD.width - 240);
    const z = 120 + Math.random() * (WORLD.depth - 240);
    const overlaps = list.some(o =>
      x < o.x + o.w + 20 && x + s > o.x - 20 &&
      z < o.z + o.d + 20 && z + s > o.z - 20
    );
    if (overlaps) continue;
    list.push({ x, z, w: s, d: s, type: 'tree' });
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

function randomColor() {
  const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6fa4'];
  return colors[Math.floor(Math.random() * colors.length)];
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

function getSafeSpawnPoint() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = TANK_RADIUS + Math.random() * (WORLD.width - TANK_RADIUS * 2);
    const z = TANK_RADIUS + Math.random() * (WORLD.depth - TANK_RADIUS * 2);

    const hitsObstacle = OBSTACLES.some(o => circleRectCollision(x, z, TANK_RADIUS + 10, o));
    if (hitsObstacle) continue;

    const tooClose = Object.values(players).some(p => {
      const dx = p.x - x, dz = p.z - z;
      return Math.sqrt(dx * dx + dz * dz) < 250;
    });
    if (tooClose) continue;

    return { x, z };
  }
  return { x: WORLD.width / 2, z: WORLD.depth / 2 };
}

function createPlayer(id, nickname) {
  const spawn = getSafeSpawnPoint();
  return {
    id,
    nickname: nickname && nickname.trim() ? nickname.trim().slice(0, 16) : randomNickname(),
    x: spawn.x,
    z: spawn.z,
    chassisAngle: 0,   // направление корпуса / движения (рад, вокруг Y)
    turretAngle: 0,    // направление башни (рад, вокруг Y) — независимо от корпуса
    color: randomColor(),
    hp: MAX_HP,
    maxHp: MAX_HP,
    alive: true,
    kills: 0,
    deaths: 0,
    speedMult: 1,
    damageMult: 1,
    reloadMult: 1,
    bulletSpeedMult: 1,
    tripleShot: false,
    input: { forward: false, back: false, left: false, right: false, targetTurretAngle: 0, shooting: false },
    lastShotTime: 0,
    respawnAt: 0,
    pendingUpgradeChoice: false,
    killsSinceUpgrade: 0,
  };
}

// ---------------------------------------------------------------------------
// SOCKET.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {

  socket.on('join', (data) => {
    const nickname = data && data.nickname ? String(data.nickname) : '';
    const player = createPlayer(socket.id, nickname);
    players[socket.id] = player;

    socket.emit('init', {
      selfId: socket.id,
      world: WORLD,
      obstacles: OBSTACLES,
      maxHp: MAX_HP,
    });

    console.log(`Игрок подключился: ${player.nickname} (${socket.id})`);
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
  });

  socket.on('chooseUpgrade', (upgradeId) => {
    const p = players[socket.id];
    if (!p || !p.pendingUpgradeChoice) return;
    const upgrade = UPGRADE_POOL.find(u => u.id === upgradeId);
    if (upgrade) upgrade.apply(p);
    p.pendingUpgradeChoice = false;
  });

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
        const spawn = getSafeSpawnPoint();
        p.x = spawn.x;
        p.z = spawn.z;
        p.hp = p.maxHp;
        p.alive = true;
      }
      continue;
    }

    if (p.pendingUpgradeChoice) continue;

    updatePlayerMovement(p, dt);
    updatePlayerShooting(p, now);
  }

  updateBullets(dt, now);
  broadcastState();
}

function updatePlayerMovement(p, dt) {
  // Поворот корпуса (A/D)
  if (p.input.left) p.chassisAngle += TANK_TURN_SPEED * dt;
  if (p.input.right) p.chassisAngle -= TANK_TURN_SPEED * dt;

  // Движение вперёд/назад по направлению корпуса (W/S)
  const speed = TANK_BASE_SPEED * p.speedMult;
  let dir = 0;
  if (p.input.forward) dir += 1;
  if (p.input.back) dir -= 1;

  if (dir !== 0) {
    const dx = Math.sin(p.chassisAngle) * dir * speed * dt;
    const dz = Math.cos(p.chassisAngle) * dir * speed * dt;
    tryMove(p, p.x + dx, p.z + dz);
  }

  // Башня плавно доворачивается к углу, присланному клиентом
  p.turretAngle = lerpAngle(p.turretAngle, p.input.targetTurretAngle, TURRET_TURN_SPEED * dt);
}

function tryMove(p, newX, newZ) {
  newX = Math.max(TANK_RADIUS, Math.min(WORLD.width - TANK_RADIUS, newX));
  newZ = Math.max(TANK_RADIUS, Math.min(WORLD.depth - TANK_RADIUS, newZ));

  const collidesX = OBSTACLES.some(o => circleRectCollision(newX, p.z, TANK_RADIUS, o));
  if (!collidesX) p.x = newX;

  const collidesZ = OBSTACLES.some(o => circleRectCollision(p.x, newZ, TANK_RADIUS, o));
  if (!collidesZ) p.z = newZ;
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
  const reloadTime = BASE_RELOAD_MS * p.reloadMult;
  if (now - p.lastShotTime < reloadTime) return;

  p.lastShotTime = now;
  fireBullet(p);
}

function fireBullet(p) {
  const angles = p.tripleShot
    ? [p.turretAngle - 0.18, p.turretAngle, p.turretAngle + 0.18]
    : [p.turretAngle];

  for (const angle of angles) {
    const spawnDist = TANK_RADIUS + 14;
    bullets.push({
      id: bulletIdCounter++,
      ownerId: p.id,
      x: p.x + Math.sin(angle) * spawnDist,
      z: p.z + Math.cos(angle) * spawnDist,
      vx: Math.sin(angle) * BULLET_SPEED * p.bulletSpeedMult,
      vz: Math.cos(angle) * BULLET_SPEED * p.bulletSpeedMult,
      damage: BULLET_BASE_DAMAGE * p.damageMult,
      ownerColor: p.color,
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

    const hitObstacle = OBSTACLES.some(o => circleRectCollision(b.x, b.z, BULLET_RADIUS, o));
    if (hitObstacle) {
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
        applyDamage(p, b, now);
        hit = true;
        break;
      }
    }

    if (hit) bullets.splice(i, 1);
  }
}

function applyDamage(target, bullet, now) {
  target.hp -= bullet.damage;
  io.emit('hit', { x: target.x, z: target.z, color: bullet.ownerColor });
  if (target.hp <= 0) {
    target.alive = false;
    target.deaths += 1;
    target.respawnAt = now + RESPAWN_DELAY_MS;

    const killer = players[bullet.ownerId];
    if (killer) {
      killer.kills += 1;
      killer.killsSinceUpgrade += 1;

      if (killer.killsSinceUpgrade >= KILLS_FOR_UPGRADE) {
        killer.killsSinceUpgrade = 0;
        killer.pendingUpgradeChoice = true;

        const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5);
        const offered = shuffled.slice(0, 3).map(u => ({ id: u.id, name: u.name }));
        io.to(killer.id).emit('offerUpgrade', offered);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// РАССЫЛКА СОСТОЯНИЯ
// ---------------------------------------------------------------------------
function broadcastState() {
  const playersState = Object.values(players).map(p => ({
    id: p.id,
    nickname: p.nickname,
    x: p.x,
    z: p.z,
    chassisAngle: p.chassisAngle,
    turretAngle: p.turretAngle,
    color: p.color,
    hp: p.hp,
    maxHp: p.maxHp,
    reloadMs: Math.round(BASE_RELOAD_MS * p.reloadMult),
    alive: p.alive,
    kills: p.kills,
    deaths: p.deaths,
  }));

  const bulletsState = bullets.map(b => ({
    id: b.id,
    x: b.x,
    z: b.z,
    color: b.ownerColor,
    ownerId: b.ownerId,
  }));

  io.emit('state', { players: playersState, bullets: bulletsState });
}

setInterval(tick, 1000 / TICK_RATE);

// ---------------------------------------------------------------------------
// ЗАПУСК
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`3D-сервер танчиков запущен: http://localhost:${PORT}`);
});
