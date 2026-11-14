import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeaponSet, WEAPON_DEFS, GRENADE_DEF } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;
const TAU = Math.PI * 2;
const raycaster = new THREE.Raycaster();
const aimDirection = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();
const shotEnd = new THREE.Vector3();
const grenadeDirection = new THREE.Vector3();
const grenadeDelta = new THREE.Vector3();
const explosionLight = new THREE.PointLight(0xffa743, 0, 20);
const tracerPositions = new Float32Array(8 * 6);
const hitPoint = new THREE.Vector3();
const colorScratch = new THREE.Color();

const root = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE?.canvas || '#14161a');

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.add(explosionLight);

const world = createWorld(scene);
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement);
const weapons = createWeaponSet(camera);
const audio = createAudio();
const hud = createHud();

const tracerGeometry = new THREE.BufferGeometry();
tracerGeometry.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3));
const tracerMaterial = new THREE.LineBasicMaterial({
  color: '#f0a830',
  transparent: true,
  opacity: 0.85,
  depthWrite: false
});
const tracerLines = [];
for (let i = 0; i < 8; i += 1) {
  const line = new THREE.Line(tracerGeometry, tracerMaterial);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  tracerLines.push(line);
}

const G = {
  phase: 'buy',
  health: 100,
  armour: 0,
  grenade: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, alive: false },
  bomb: { planted: false, site: null, fuse: 0, carrier: 'player', defused: false, exploded: false },
  playerChannel: '',
  channelProgress: 0,
  time: 0,
  shotCooldown: 0,
  tracerCursor: 0,
  playerAlive: true,
  lastInputFire: false,
  rounds: null,
  bots: null
};

function setPlayerPosition(x, y, z) {
  if (player.state?.position) player.state.position.set(x, y, z);
  else if (player.state?.pos) player.state.pos.set(x, y, z);
  else player.state && Object.assign(player.state, { x, y, z });
  camera.position.set(x, y + 1.62, z);
}

function getPlayerPosition(out) {
  if (player.state?.position) return out.copy(player.state.position);
  if (player.state?.pos) return out.copy(player.state.pos);
  return out.set(camera.position.x, Math.max(0, camera.position.y - 1.62), camera.position.z);
}

function playerTeam() {
  return 'ember';
}

function addFeed(text) {
  hud.addKill(text);
}

function applyPlayerDamage(amount) {
  if (!G.playerAlive || amount <= 0) return;
  const absorbed = Math.min(G.armour, amount * 0.25);
  G.armour = Math.max(0, G.armour - absorbed);
  G.health = Math.max(0, G.health - (amount - absorbed));
  hud.setHealth(G.health, G.armour);
  hud.damageFlash();
  audio.hurt();
  if (G.health <= 0) {
    G.playerAlive = false;
    G.playerChannel = '';
    G.channelProgress = 0;
    camera.position.y = Math.max(0.6, camera.position.y - 0.35);
  }
}

function botHooks() {
  return {
    los(from, to) {
      grenadeDirection.subVectors(to, from);
      const distance = grenadeDirection.length();
      if (distance <= 0.05) return true;
      raycaster.set(from, grenadeDirection.multiplyScalar(1 / distance));
      raycaster.far = distance;
      return raycaster.intersectObjects(world.shootables, false).length === 0;
    },
    damagePlayer: applyPlayerDamage,
    onKill(victimTeam, killerTeam, killerName, victimName, headshot) {
      addFeed(`${killerName}  >  ${victimName}${headshot ? '  [HS]' : ''}`);
      if (killerTeam === 'ember' && killerName === 'Player') G.rounds.addKillReward();
    },
    hearNoise(pos, radius, team) {
      if (team === 'ember') return;
      G.bots.hearNoise?.(pos, radius, team);
    },
    onPlant(site) {
      if (G.bomb.planted) return;
      G.bomb.site = site;
      G.playerChannel = '';
      audio.plantBeep();
    },
    onPlanted(site) {
      G.bomb.planted = true;
      G.bomb.site = site;
      G.bomb.fuse = 35;
      G.rounds.addPlantReward();
      G.rounds.state.bomb.planted = true;
      G.rounds.state.bomb.site = site;
      hud.setBomb(`BOMB PLANTED · SITE ${site}`, 1);
      audio.plantBeep();
    },
    onDefuseStart() {
      audio.defuseTick();
    },
    onDefused(site) {
      G.bomb.defused = true;
      G.rounds.addDefuseReward();
      G.rounds.state.bomb.site = site;
      audio.defuseTick();
    }
  };
}

const roundEvents = {
  onPhase(phase) {
    G.phase = phase;
    if (phase === 'buy') hud.showBanner(`ROUND ${G.rounds?.state.round || 1}`, 'BUY PHASE', 1800);
    if (phase === 'live') {
      hud.hideBuy();
      G.bomb.carrier = 'player';
    }
  },
  onRoundEnd(winner, reason, round) {
    const label = winner === 'ember' ? 'EMBER' : 'KESTREL';
    hud.showBanner(`${label} WINS`, reason === 'elimination' ? 'ELIMINATION' : reason.toUpperCase(), 2400);
    if (winner === 'ember') audio.roundWin();
    else audio.roundLose();
    if (G.rounds.isMatchOver()) {
      hud.showOverlay('matchEnd', { winner: G.rounds.matchWinner(), score: G.rounds.state.score });
    } else {
      hud.showOverlay('roundEnd', { winner: label, reason, score: G.rounds.state.score, round });
    }
  },
  onMoney(value) { hud.setMoney(value); },
  onScore(score) { hud.setScore(score.ember, score.kestrel); },
  onBombPlanted(site) { hud.setBomb(`BOMB PLANTED · SITE ${site}`, 1); },
  onBombExploded() { G.bomb.exploded = true; audio.explosion(); },
  onBombDefused() { G.bomb.defused = true; }
};

G.rounds = createRounds(roundEvents);
G.bots = createBots(scene, world, botHooks());

function setLoadoutHud() {
  const ammo = weapons.state.weapons[weapons.state.current];
  const definition = WEAPON_DEFS[weapons.state.current];
  if (ammo && definition) hud.setAmmo(ammo.mag, ammo.reserve, definition.name);
}

function addTracer(from, to, color = '#f0a830') {
  const index = G.tracerCursor++ % tracerLines.length;
  const offset = index * 6;
  tracerPositions[offset] = from.x;
  tracerPositions[offset + 1] = from.y;
  tracerPositions[offset + 2] = from.z;
  tracerPositions[offset + 3] = to.x;
  tracerPositions[offset + 4] = to.y;
  tracerPositions[offset + 5] = to.z;
  tracerGeometry.attributes.position.needsUpdate = true;
  const line = tracerLines[index];
  colorScratch.set(color);
  tracerMaterial.color.copy(colorScratch);
  line.visible = true;
  line.userData.life = 0.075;
}

function traceShot() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = weapons.def().range;
  const objects = world.shootables.concat(G.bots.hitMeshes);
  const intersections = raycaster.intersectObjects(objects, false);
  const hit = intersections.length ? intersections[0] : null;
  shotOrigin.copy(camera.position);
  if (hit) shotEnd.copy(hit.point);
  else shotEnd.copy(raycaster.ray.direction).multiplyScalar(raycaster.far).add(shotOrigin);

  if (hit?.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part;
    const head = part === 'head';
    const damage = weapons.def().damage * (head ? weapons.def().headMult : 1);
    const killed = G.bots.damage(bot, damage, part);
    if (killed) {
      G.rounds.addKillReward();
      addFeed(`Player  >  ${bot.name}${head ? '  [HS]' : ''}`);
    }
    hud.hitMarker(killed);
  }

  addTracer(shotOrigin, shotEnd, weapons.def().tracer);
  const muzzle = weapons.muzzle();
  if (muzzle?.flash) {
    muzzle.flash.visible = true;
    muzzle.light.intensity = 2.3;
  }
  player.recoil?.(weapons.def().recoilPitch, weapons.def().recoilYaw * (Math.random() * 2 - 1));
  G.bots.hearNoise?.(shotOrigin, 28, 'ember');
}

function tryFire() {
  if (!input.state.locked || !G.playerAlive || !['live', 'planted'].includes(G.phase)) return;
  if (!input.state.firing && !input.state.keys?.has('Space')) return;
  const definition = weapons.def();
  if (!weapons.ready()) return;
  if (!weapons.takeRound()) {
    audio.dryFire();
    return;
  }
  traceShot();
  audio.shot(0);
  setLoadoutHud();
}

function reloadWeapon() {
  if (weapons.reload()) audio.reload();
}

function selectWeapon(id) {
  if (weapons.select(id)) setLoadoutHud();
}

function throwGrenade() {
  if (!G.playerAlive || G.phase !== 'live' || G.bomb.planted || weapons.state.grenades <= 0 || G.grenade.alive) return;
  weapons.state.grenades -= 1;
  G.grenade.alive = true;
  G.grenade.fuse = GRENADE_DEF.fuse;
  G.grenade.pos.copy(camera.position);
  camera.getWorldDirection(grenadeDirection);
  G.grenade.vel.copy(grenadeDirection).multiplyScalar(11);
  G.grenade.vel.y += 3.3;
  audio.shot(0);
}

function explodeGrenade() {
  G.grenade.alive = false;
  explosionLight.position.copy(G.grenade.pos);
  explosionLight.intensity = 8;
  explosionLight.userData.life = 0.35;
  audio.explosion();
  const radiusSq = GRENADE_DEF.radius * GRENADE_DEF.radius;
  for (const bot of G.bots.list) {
    if (!bot.alive) continue;
    const distanceSq = bot.pos.distanceToSquared(G.grenade.pos);
    if (distanceSq > radiusSq) continue;
    const amount = GRENADE_DEF.damage * (1 - Math.sqrt(distanceSq) / GRENADE_DEF.radius);
    const died = G.bots.damage(bot, amount, 'torso');
    if (died) {
      G.rounds.addKillReward();
      addFeed(`Player  >  ${bot.name}`);
    }
  }
  getPlayerPosition(hitPoint);
  const playerDistanceSq = hitPoint.distanceToSquared(G.grenade.pos);
  if (playerDistanceSq <= radiusSq) {
    applyPlayerDamage(GRENADE_DEF.damage * (1 - Math.sqrt(playerDistanceSq) / GRENADE_DEF.radius));
  }
}

function startPlayerChannel() {
  if (!input.state.keys?.has('KeyE') || !G.playerAlive) {
    if (G.playerChannel === 'player') {
      G.playerChannel = '';
      G.channelProgress = 0;
    }
    return;
  }

  getPlayerPosition(hitPoint);
  if (playerTeam() === 'ember' && G.phase === 'live' && !G.bomb.planted) {
    let nearest = null;
    let nearestDistance = 2.25 * 2.25;
    for (const site of ['A', 'B']) {
      const distance = hitPoint.distanceToSquared(world.plantSpots[site]);
      if (distance < nearestDistance) {
        nearest = site;
        nearestDistance = distance;
      }
    }
    if (nearest) {
      G.playerChannel = 'player';
      G.bomb.site = nearest;
      G.channelProgress += FIXED_DT;
      hud.setBomb(`PLANTING ${nearest} · ${Math.floor(G.channelProgress / 3.2 * 100)}%`);
      if (G.channelProgress >= 3.2) {
        G.bomb.planted = true;
        G.bomb.fuse = 35;
        G.bomb.carrier = null;
        G.channelProgress = 0;
        G.playerChannel = '';
        G.rounds.addPlantReward();
        audio.plantBeep();
        hud.setBomb(`BOMB PLANTED · SITE ${nearest}`, 1);
      }
      return;
    }
  }

  if (G.phase === 'planted' && G.bomb.planted) {
    const plant = world.plantSpots[G.bomb.site];
    if (plant && hitPoint.distanceToSquared(plant) < 2.25 * 2.25) {
      G.playerChannel = 'player';
      G.channelProgress += FIXED_DT;
      hud.setBomb(`DEFUSING · ${Math.floor(G.channelProgress / 5 * 100)}%`, 1 - G.bomb.fuse / 35);
      if (G.channelProgress >= 5) {
        G.bomb.defused = true;
        G.channelProgress = 0;
        G.playerChannel = '';
        G.rounds.addDefuseReward();
        audio.defuseTick();
      }
      return;
    }
  }

  if (G.playerChannel === 'player') {
    G.playerChannel = '';
    G.channelProgress = 0;
  }
}

function buyItems() {
  return [
    { key: '1', name: 'P9', price: WEAPON_DEFS.p9.price, desc: '12 / 36 · sidearm', owned: Boolean(weapons.state.weapons.p9) },
    { key: '2', name: 'VK-7', price: WEAPON_DEFS.vk7.price, desc: '30 / 90 · rifle', owned: Boolean(weapons.state.weapons.vk7) },
    { key: '3', name: 'KX-9', price: WEAPON_DEFS.kx9.price, desc: '32 / 96 · SMG', owned: Boolean(weapons.state.weapons.kx9) },
    { key: '4', name: 'LR-88', price: WEAPON_DEFS.lr88.price, desc: '5 / 15 · marksman', owned: Boolean(weapons.state.weapons.lr88) },
    { key: '5', name: 'Spark frag', price: GRENADE_DEF.price, desc: 'Explosive · max 1', owned: weapons.state.grenades > 0 },
    { key: '6', name: 'Kevlar vest', price: 650, desc: 'Damage reduction', owned: weapons.state.kevlar }
  ];
}

function buyItem(item) {
  let price = -1;
  if (item.key === '5') price = weapons.buyGrenade(G.rounds.state.money);
  else if (item.key === '6') price = weapons.buyKevlar(G.rounds.state.money);
  else {
    const ids = { '1': 'p9', '2': 'vk7', '3': 'kx9', '4': 'lr88' };
    price = weapons.buy(ids[item.key], G.rounds.state.money);
  }
  if (price < 0 || !G.rounds.spend(price)) {
    audio.denied();
    return;
  }
  audio.buy();
  setLoadoutHud();
  hud.showBuy(buyItems(), G.rounds.state.money, buyItem);
}

function toggleBuy() {
  if (G.phase !== 'buy') return;
  if (hud.buyVisible()) {
    hud.hideBuy();
    input.requestLock();
  } else {
    hud.showBuy(buyItems(), G.rounds.state.money, buyItem);
    document.exitPointerLock?.();
  }
}

function updateHud() {
  hud.setHealth(G.health, G.armour);
  hud.setMoney(G.rounds.state.money);
  hud.setScore(G.rounds.state.score.ember, G.rounds.state.score.kestrel);
  hud.setAlive(G.bots.aliveCount('ember') + (G.playerAlive ? 1 : 0), G.bots.aliveCount('kestrel'));
  hud.setTimer(G.rounds.state.timer, G.phase);
  setLoadoutHud();
  const dots = [];
  getPlayerPosition(hitPoint);
  dots.push({ x: hitPoint.x, z: hitPoint.z, team: 'ember', me: true });
  for (const bot of G.bots.list) {
    if (bot.alive) dots.push({ x: bot.pos.x, z: bot.pos.z, team: bot.team });
  }
  hud.drawMinimap(world, dots);
}

function step(dt) {
  G.time += dt;
  G.phase = G.rounds.state.phase;
  input.takeLook?.();
  player.step(dt, input.state.keys);
  weapons.step(dt);
  startPlayerChannel();

  if (G.grenade.alive) {
    G.grenade.fuse -= dt;
    G.grenade.vel.y -= 9.8 * dt;
    G.grenade.pos.addScaledVector(G.grenade.vel, dt);
    if (G.grenade.pos.y < 0.12) {
      G.grenade.pos.y = 0.12;
      G.grenade.vel.y *= -0.42;
      G.grenade.vel.x *= 0.72;
      G.grenade.vel.z *= 0.72;
    }
    if (G.grenade.fuse <= 0) explodeGrenade();
  }

  G.bots.step(dt, {
    time: G.time,
    playerPos: getPlayerPosition(hitPoint),
    playerAlive: G.playerAlive,
    playerCrouching: Boolean(input.state.keys?.has('ControlLeft')),
    playerSpeed: player.groundSpeed?.() || 0,
    bombPlanted: G.bomb.planted,
    bombSite: G.bomb.site,
    phase: G.phase
  });

  if (G.bomb.planted && G.phase === 'planted' && !G.bomb.defused) {
    G.bomb.fuse = Math.max(0, G.bomb.fuse - dt);
    if (G.bomb.fuse <= 0) G.bomb.exploded = true;
    hud.setBomb(`BOMB ACTIVE · SITE ${G.bomb.site}`, G.bomb.fuse / 35);
  }

  G.rounds.step(dt, {
    emberAlive: G.bots.aliveCount('ember') + (G.playerAlive ? 1 : 0),
    kestrelAlive: G.bots.aliveCount('kestrel'),
    playerAlive: G.playerAlive,
    bombPlanted: G.bomb.planted,
    bombSite: G.bomb.site,
    bombDefused: G.bomb.defused,
    bombExploded: G.bomb.exploded,
    timeUp: G.phase === 'live' && G.rounds.state.timer <= 0
  });

  if (G.phase === 'buy' && G.rounds.state.timer <= 0) G.phase = G.rounds.state.phase;
  tryFire();
  updateHud();
}

function render(dt) {
  for (const line of tracerLines) {
    if (!line.visible) continue;
    line.userData.life -= dt;
    if (line.userData.life <= 0) line.visible = false;
  }
  if (explosionLight.userData.life > 0) {
    explosionLight.userData.life -= dt;
    explosionLight.intensity = Math.max(0, explosionLight.userData.life * 22);
  }
  renderer.render(scene, camera);
}

function onKeyDown(event) {
  if (event.repeat) return;
  if (event.code === 'KeyB') toggleBuy();
  if (event.code === 'KeyR') reloadWeapon();
  if (event.code === 'Digit1') selectWeapon('p9');
  if (event.code === 'Digit2') selectWeapon('vk7');
  if (event.code === 'Digit3') selectWeapon('kx9');
  if (event.code === 'Digit4') selectWeapon('lr88');
  if (event.code === 'KeyG') throwGrenade();
}
document.addEventListener('keydown', onKeyDown);

input.state.keys ||= {};
document.addEventListener('pointerlockchange', () => {
  if (!input.state.locked && G.phase !== 'over' && !hud.buyVisible() && G.playerAlive) {
    hud.showOverlay('paused');
  }
});

hud.onPlay(() => {
  audio.unlock();
  hud.hideOverlay();
  if (G.phase === 'over') {
    if (G.rounds.isMatchOver()) { G.rounds.startMatch(); weapons.resetLoadout(); }
    else G.rounds.startRound();
    G.playerAlive = true;
    G.health = 100;
    G.armour = 0;
    G.bomb.planted = false;
    G.bomb.defused = false;
    G.bomb.exploded = false;
    G.bots.resetRound();
    setPlayerPosition(0, 0, 16);
  }
  input.requestLock();
});

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}
window.addEventListener('resize', onResize);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function stageShot(mode, seed) {
  const random = seededRandom(seed);
  Math.random = random;
  G.rounds.startMatch();
  G.bots.spawnAll();
  setPlayerPosition(0, 0, 6);
  camera.lookAt(0, 1.5, -14);
  const stagedLive = mode === 'play' || mode === 'buy' || mode === 'end';
  if (stagedLive) hud.hideOverlay();

  if (mode === 'play') {
    G.rounds.state.phase = 'live';
    G.rounds.state.timer = 87;
    G.phase = 'live';
    G.rounds.state.money = 800;
    weapons.give('vk7');
    weapons.state.weapons.vk7.mag = 24;
    G.health = 100;
    G.armour = 0;
    const enemies = G.bots.list.filter(bot => bot.team === 'kestrel');
    for (let i = 0; i < enemies.length; i += 1) {
      enemies[i].pos.set((i - 1) * 2.5, 0, -8 - i);
      enemies[i].alive = i < 2;
      enemies[i].group.visible = i < 2;
    }
    G.bots.damage(enemies[2], 1000);
    G.bots.list.find(bot => bot.team === 'ember').pos.set(-18, 0, 12);
    addTracer(camera.position, new THREE.Vector3(0, 1.45, -8));
    hud.hitMarker(false);
    hud.showBanner('', '', 0);
  } else if (mode === 'buy') {
    G.rounds.state.phase = 'buy';
    G.rounds.state.timer = 12;
    G.phase = 'buy';
    hud.showBuy(buyItems(), G.rounds.state.money, buyItem);
  } else if (mode === 'end') {
    G.rounds.state.phase = 'over';
    G.rounds.state.round = 1;
    G.rounds.state.score.ember = 1;
    G.rounds.state.score.kestrel = 0;
    G.rounds.state.timer = 4.5;
    G.phase = 'over';
    hud.showOverlay('roundEnd', {
      winner: 'EMBER',
      reason: 'Elimination',
      score: G.rounds.state.score
    });
    hud.showBanner('EMBER WINS', 'ELIMINATION');
  }

  updateHud();
}

const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const shotSeed = Number(params.get('seed')) || 1;

if (shotMode) {
  stageShot(shotMode, shotSeed);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
} else {
  G.rounds.startMatch();
  G.bots.spawnAll();
  setPlayerPosition(0, 0, 16);
  hud.showOverlay('start');
  hud.setCrosshairGap(6);

  let previous = performance.now();
  let accumulator = 0;
  function frame(now) {
    const elapsed = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
      step(FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }
    render(elapsed);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}