import * as THREE from 'three';
import { AudioController } from './AudioController.js';
import { PlayerSpriteController } from './PlayerSpriteController.js';
import { SpriteSheetAnimator } from './SpriteSheetAnimator.js';

const BASE = import.meta.env.BASE_URL;
const audio = new AudioController();

// ========== GAME CONFIG ==========
const LANES = [-3, 0, 3];
const WORLD_SPEED_INIT = 0.22;
const WORLD_SPEED_MAX = 0.55;
const SPAWN_INTERVAL_INIT = 70;
const SPAWN_INTERVAL_MIN = 30;
const FIELD_LENGTH = 50;
// Pitch mesh extends past the line-wrap distance so the dark-green field
// reaches the painted stadium tier in the panorama with no panorama-grass
// strip showing through. Tuned so the far edge meets the tier line — go
// too long and the pitch overshoots into the stands.
const FIELD_MESH_LENGTH = 90;
// Single source of truth for the ball radius so the geometry size and the
// resting Y position stay in sync (Y = radius keeps the ball just touching
// the pitch instead of half-buried).
const PLAYER_BALL_RADIUS = 0.22;
const DEFENDER_Z_START = -38;

const SPRITE_RUN_FPS = 12;
const SPRITE_ACTION_FPS = 30;
const SPRITE_RAINBOW_FPS = 15; // 12 frames / 15 fps = 0.8s = BOUNCE_DURATION
const SPRITE_PASS_FPS = 20;    // 12 frames / 20 fps = 0.6s
const SPRITE_DEFENDER_FPS = 14;
const SPRITE_TEAMMATE_FPS = 14;

let defenderRunTexture = null;
let teammateRunTexture = null;

let scene, camera, renderer, clock;
// Player's base Z position. Tuned per aspect in applyCameraForAspect():
// portrait phones bring Repo closer (z=5) so he reads big enough on a
// narrow screen; landscape keeps him at z=3 so his feet stay on screen
// inside the narrower vertical FOV.
let playerBaseZ = 3;
let player, playerBall, playerGroup;
let playerSprite;
let playerSpriteController;
let defenders = [];
let fieldLines = [];
let score = 0;
let bestScore = parseInt(localStorage.getItem('footballRunnerBest') || '0', 10);
let gameRunning = false;
let gameOverFlag = false;
let worldSpeed = WORLD_SPEED_INIT;
let spawnTimer = 0;
let spawnInterval = SPAWN_INTERVAL_INIT;
let currentLane = 1;
let targetX = LANES[1];
let isBouncing = false;
let bounceTime = 0;
let isPassing = false;
let passBall = null;
let passBallLane = 1;
let passReturnBall = null;
let passReturnTarget = null;
const BOUNCE_DURATION = 0.8;
const PASS_SPEED = 0.6;
const PASS_STOP_DISTANCE = 25;
let gameTime = 0;
let nextMilestone = 25;
let fireworks = [];
let celebrationTimer = 0;
let teammates = [];
let smokeEffects = [];

const CELEBRATION_MESSAGES = [
  "\u{1F525} MAHTAVAA! \u{1F525}",
  "⚡ HUIPPUA! ⚡",
  "\u{1F31F} LOISTAVAA! \u{1F31F}",
  "\u{1F4A5} USKOMATONTA! \u{1F4A5}",
  "\u{1F3C6} LEGENDAARISTA! \u{1F3C6}",
  "\u{1F451} MESTARI! \u{1F451}",
  "\u{1F680} PYSÄYTTÄMÄTÖN! \u{1F680}",
];

const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; e.preventDefault(); });
window.addEventListener('keyup', e => { keys[e.key] = false; });

let laneChangeCooldown = 0;

// ========== INIT ==========
function init() {
  scene = new THREE.Scene();
  const stadiumLoader = new THREE.TextureLoader();
  const stadiumTexture = stadiumLoader.load(`${BASE}stadium_panorama.png`);
  stadiumTexture.wrapS = THREE.RepeatWrapping;
  stadiumTexture.wrapT = THREE.RepeatWrapping;
  scene.background = stadiumTexture;
  // Fog colour exactly matches the dark stripe of the procedural pitch
  // texture, so the far end of the play strip stays uniformly dark green
  // all the way out instead of fading toward the brighter painted grass.
  scene.fog = new THREE.Fog(0x1d4823, 14, 26);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  applyCameraForAspect();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // Ambient is dialled down so the four stadium spotlights below carry the
  // mood; field still reads in shadow because the directional sun light
  // stays warm and strong.
  const ambient = new THREE.AmbientLight(0xb0c4d0, 0.22);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffe9b4, 1.25);
  dirLight.position.set(8, 25, 5);
  dirLight.castShadow = true;
  dirLight.shadow.camera.left = -25;
  dirLight.shadow.camera.right = 25;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 80;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.002;
  scene.add(dirLight);

  // Procedural stadium grass texture: alternating dark/light stripes on a
  // base green, with a soft horizontal vignette so each "mow line" reads
  // clearly. Beats the static football-field.jpg for a stylised pitch.
  const fieldTexture = makeStripedGrassTexture();
  fieldTexture.wrapS = THREE.RepeatWrapping;
  fieldTexture.wrapT = THREE.RepeatWrapping;
  // Mow stripe density: 12 stripes / 50 units in the original tuning. Keep
  // the same look on the longer pitch by scaling proportionally.
  fieldTexture.repeat.set(1, Math.round((12 / 50) * FIELD_MESH_LENGTH));
  const fieldGeo = new THREE.PlaneGeometry(14, FIELD_MESH_LENGTH);
  const fieldMat = new THREE.MeshPhongMaterial({
    map: fieldTexture,
    shininess: 24,
    specular: 0x335533,
  });
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.rotation.x = -Math.PI / 2;
  field.position.y = -0.01;
  // Offset so the near edge sits a touch behind the camera (z>10 is camera
  // territory) and the far edge runs deep enough that fog blends it into
  // the painted stadium tier with no panorama-grass strip showing through.
  field.position.z = -FIELD_MESH_LENGTH / 2 + 6;
  field.receiveShadow = true;
  scene.add(field);

  createFieldLines();
  createLaneDividers();
  createSidelines();
  createStadiumLights();
  createPlayer();

  window.addEventListener('resize', onResize);
  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('restartBtn').addEventListener('click', restartGame);

  setupTouch();

  function unlockAudio() {
    audio.init();
    document.removeEventListener('touchstart', unlockAudio);
    document.removeEventListener('touchend', unlockAudio);
    document.removeEventListener('click', unlockAudio);
  }
  document.addEventListener('touchstart', unlockAudio);
  document.addEventListener('touchend', unlockAudio);
  document.addEventListener('click', unlockAudio);

  animate();
}

function createFieldLines() {
  // Brighter horizontal yard lines that scroll with the world.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  for (let i = 0; i < 10; i++) {
    const lineGeo = new THREE.PlaneGeometry(12, 0.18);
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.02;
    line.position.z = -i * 12;
    scene.add(line);
    fieldLines.push(line);
  }
}

function createLaneDividers() {
  // Dashed lane separators between the three lanes — much more visible than
  // the old 0.12-opacity dots so the player can read the lane geometry.
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
  for (let lane = 0; lane < 2; lane++) {
    const x = (LANES[lane] + LANES[lane + 1]) / 2;
    for (let i = 0; i < 30; i++) {
      const dotGeo = new THREE.PlaneGeometry(0.18, 1.4);
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(x, 0.02, -i * 4);
      scene.add(dot);
      fieldLines.push(dot);
    }
  }
}

function createSidelines() {
  // Continuous bright sidelines on both edges of the playable strip.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
  for (const x of [-6.6, 6.6]) {
    for (let i = 0; i < 12; i++) {
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 12), lineMat);
      seg.rotation.x = -Math.PI / 2;
      seg.position.set(x, 0.025, -i * 12);
      scene.add(seg);
      fieldLines.push(seg);
    }
  }

}

function makeStripedGrassTexture() {
  // 256-px tile, 4 horizontal mow stripes — repeat across the pitch.
  const size = 256;
  const stripeCount = 4;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < stripeCount; i++) {
    const dark = i % 2 === 0;
    const grd = ctx.createLinearGradient(0, i * size / stripeCount, size, i * size / stripeCount);
    if (dark) {
      grd.addColorStop(0, '#1d4823');
      grd.addColorStop(0.5, '#26572a');
      grd.addColorStop(1, '#1d4823');
    } else {
      grd.addColorStop(0, '#2a6332');
      grd.addColorStop(0.5, '#33773c');
      grd.addColorStop(1, '#2a6332');
    }
    ctx.fillStyle = grd;
    ctx.fillRect(0, i * size / stripeCount, size, size / stripeCount);
  }
  // Subtle noise — sells "grass" instead of "flat fill" once Phong shades it.
  const noiseCount = 1500;
  for (let i = 0; i < noiseCount; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function createTribunes() {
  // Two long, low blocks of tightly-packed cube "spectators" sitting just
  // outside the pitch sidelines. They don't scroll with the world; the
  // illusion of motion comes from yard-line + lane-divider scrolling on the
  // pitch surface itself.
  //
  // We use MeshBasicMaterial here on purpose: the tribunes sit outside the
  // directional-light shadow camera and are mostly out of the stadium-light
  // PointLight cones, so a Lambert/Phong material would render them solid
  // black — exactly the bug we hit ("just black bars on the sides"). Basic
  // materials ignore lighting and stay readable.
  const colors = [0xd6062a, 0x004d98, 0xffd600, 0xffffff, 0x9c1d3a, 0x16306b];
  const widths = 100;
  for (const sideX of [-9.5, 9.5]) {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.4, widths),
      new THREE.MeshBasicMaterial({ color: 0x3a3a48 }),
    );
    base.position.set(sideX, 0.7, -widths / 2 + 10);
    scene.add(base);

    // Pixel-style spectators packed on top of the slab. Random colours from
    // the kit palette so the crowd reads as "Barcelona vs Real Madrid".
    const peopleGeo = new THREE.BoxGeometry(0.45, 0.75, 0.45);
    for (let i = 0; i < 260; i++) {
      const z = -widths / 2 + 10 + (Math.random() - 0.5) * (widths - 2);
      const xJitter = (Math.random() - 0.5) * 2.0;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const person = new THREE.Mesh(peopleGeo, new THREE.MeshBasicMaterial({ color }));
      person.position.set(sideX + xJitter, 1.78, z);
      scene.add(person);
    }
  }
}

function createStadiumLights() {
  // Four warm match-day spotlights placed high above the playable strip.
  // We deliberately skip visible poles/housings: at this camera angle the
  // far-side poles converge near the screen centre and read as ugly black
  // verticals. The light's effect on the field is enough to sell the vibe.
  const lightConfigs = [
    { x: -12, z: 6 },
    { x:  12, z: 6 },
    { x: -12, z: -30 },
    { x:  12, z: -30 },
  ];
  for (const c of lightConfigs) {
    const lamp = new THREE.PointLight(0xffe8b8, 1.4, 70, 1.4);
    lamp.position.set(c.x, 18, c.z);
    scene.add(lamp);
  }
}

function createPlayer() {
  playerGroup = new THREE.Group();

  // Sprite-based Repo. The strip cells are 256×256 each; we expose one cell at
  // a time by setting texture.repeat / texture.offset. PlayerSpriteController
  // owns the animation state machine.
  const loader = new THREE.TextureLoader();
  const runTex = loader.load(`${BASE}sprites/repo/repo_run_8f_256.png`);
  const laneLeftTex = loader.load(`${BASE}sprites/repo/repo_lane_left_8f_256.png`);
  const laneRightTex = loader.load(`${BASE}sprites/repo/repo_lane_right_8f_256.png`);
  const rainbowTex = loader.load(`${BASE}sprites/repo/repo_rainbow_12f_256.png`);
  const passTex = loader.load(`${BASE}sprites/repo/repo_pass_12f_256.png`);

  // Load the shared defender run-cycle texture once. Each spawned defender
  // clones it so they can run with independent phase offsets.
  defenderRunTexture = loader.load(`${BASE}sprites/madrid/madrid_run_12f_256.png`);
  teammateRunTexture = loader.load(`${BASE}sprites/teammate/teammate_run_12f_256.png`);

  playerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: runTex, transparent: true }));
  // Pivot at bottom-center so the sprite's lower edge sits on the pitch
  // regardless of scale — avoids the "feet sinking into grass" bug we hit
  // when the pivot was the sprite centre and we had to recompute position.y
  // every time the scale changed.
  playerSprite.center.set(0.5, 0);
  playerSprite.scale.set(3.0, 3.0, 1);
  playerSprite.position.y = 0.02;
  playerGroup.add(playerSprite);

  playerSpriteController = new PlayerSpriteController({ sprite: playerSprite, defaultState: 'run' });
  playerSpriteController.registerState('run',        { texture: runTex,       frames: 8,  fps: SPRITE_RUN_FPS,     loop: true });
  playerSpriteController.registerState('lane_left',  { texture: laneLeftTex,  frames: 8,  fps: SPRITE_ACTION_FPS,  loop: false });
  playerSpriteController.registerState('lane_right', { texture: laneRightTex, frames: 8,  fps: SPRITE_ACTION_FPS,  loop: false });
  playerSpriteController.registerState('rainbow',    { texture: rainbowTex,   frames: 12, fps: SPRITE_RAINBOW_FPS, loop: false });
  playerSpriteController.registerState('pass',       { texture: passTex,      frames: 12, fps: SPRITE_PASS_FPS,    loop: false });
  playerSpriteController.setState('run');

  // Invisible shadow-caster so the player still drops a shadow onto the field.
  const shadowGeo = new THREE.BoxGeometry(0.6, 1.6, 0.3);
  const shadowMat = new THREE.MeshBasicMaterial({ visible: false });
  const shadowProxy = new THREE.Mesh(shadowGeo, shadowMat);
  shadowProxy.position.y = 1.0;
  shadowProxy.castShadow = true;
  playerGroup.add(shadowProxy);

  // Ball stays as a 3D mesh — the rainbow flick / pass arcs are driven by code.
  const ballGeo = new THREE.SphereGeometry(PLAYER_BALL_RADIUS, 16, 16);
  const ballMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 60 });
  playerBall = new THREE.Mesh(ballGeo, ballMat);
  playerBall.position.set(0, PLAYER_BALL_RADIUS, -0.5);
  playerBall.castShadow = true;
  playerGroup.add(playerBall);

  playerGroup.position.set(LANES[1], 0, playerBaseZ);
  playerGroup.scale.set(1.5, 1.5, 1.5);
  scene.add(playerGroup);
}

function createDefender(lane) {
  const group = new THREE.Group();

  // Each defender clones the shared run-cycle texture so its animator can
  // own an independent UV offset. Different starting phases keep the
  // defenders from looking like a synchronised marching band.
  const tex = defenderRunTexture.clone();
  tex.needsUpdate = true;
  const animator = new SpriteSheetAnimator({
    texture: tex,
    frames: 12,
    fps: SPRITE_DEFENDER_FPS,
    loop: true,
  });
  // Random phase: nudge currentFrame and elapsed so this defender starts
  // somewhere mid-cycle.
  animator.currentFrame = Math.floor(Math.random() * 12);
  animator.elapsed = Math.random() * (1 / SPRITE_DEFENDER_FPS);
  tex.offset.x = animator.currentFrame / 12;

  // fog: false so the painted-grass-tone fog can't wash these characters out
  // before the player can read their kit colour at distance.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(2.9, 2.9, 1);
  sprite.position.y = 0.02;
  group.add(sprite);

  // Invisible shadow proxy so the defender still drops a shadow on the field.
  const shadowGeo = new THREE.BoxGeometry(0.6, 1.6, 0.3);
  const shadowMat = new THREE.MeshBasicMaterial({ visible: false });
  const shadowProxy = new THREE.Mesh(shadowGeo, shadowMat);
  shadowProxy.position.y = 1.0;
  shadowProxy.castShadow = true;
  group.add(shadowProxy);

  // The sprite is already a front 3/4 view facing the camera, so unlike the
  // old box-geometry defender we don't rotate the group.
  group.scale.set(1.5, 1.5, 1.5);

  group.userData = { animator, passed: false, lane };
  group.position.set(LANES[lane], 0, DEFENDER_Z_START);
  scene.add(group);
  defenders.push(group);
}

function createTeammate(lane) {
  const group = new THREE.Group();

  // Load fresh per instance instead of cloning the shared placeholder. Cloning
  // a Texture whose `.image` hasn't finished loading can leave the clone
  // permanently blank, which is exactly the symptom we hit (defenders OK,
  // teammates invisible). THREE.Cache de-duplicates the actual fetch.
  const tex = new THREE.TextureLoader().load(`${BASE}sprites/teammate/teammate_run_12f_256.png`);
  const animator = new SpriteSheetAnimator({
    texture: tex,
    frames: 12,
    fps: SPRITE_TEAMMATE_FPS,
    loop: true,
  });
  animator.currentFrame = Math.floor(Math.random() * 12);
  animator.elapsed = Math.random() * (1 / SPRITE_TEAMMATE_FPS);
  tex.offset.x = animator.currentFrame / 12;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sprite.center.set(0.5, 0);
  sprite.scale.set(2.9, 2.9, 1);
  sprite.position.y = 0.02;
  group.add(sprite);

  const shadowGeo = new THREE.BoxGeometry(0.6, 1.6, 0.3);
  const shadowMat = new THREE.MeshBasicMaterial({ visible: false });
  const shadowProxy = new THREE.Mesh(shadowGeo, shadowMat);
  shadowProxy.position.y = 1.0;
  shadowProxy.castShadow = true;
  group.add(shadowProxy);

  group.scale.set(1.5, 1.5, 1.5);

  group.userData = { animator, passed: false, lane, isTeammate: true };
  group.position.set(LANES[lane], 0, DEFENDER_Z_START);
  scene.add(group);
  teammates.push(group);
}

function createPassBall() {
  // Sized to match the player-held dribble ball so the return pass reads
  // as the same physical ball coming back, not a bigger object.
  const ballGeo = new THREE.SphereGeometry(0.22, 16, 16);
  const ballMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const ball = new THREE.Mesh(ballGeo, ballMat);
  const patchGeo = new THREE.SphereGeometry(0.09, 6, 6);
  const patchMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  for (let i = 0; i < 4; i++) {
    const patch = new THREE.Mesh(patchGeo, patchMat);
    const angle = (i / 4) * Math.PI * 2;
    patch.position.set(Math.cos(angle) * 0.24, Math.sin(angle) * 0.12, Math.sin(angle + 1) * 0.15);
    ball.add(patch);
  }
  ball.castShadow = true;
  return ball;
}

function setupTouch() {
  // Two input flavours work side by side:
  //   1. SWIPES (kept from before): drag in any direction → arrow key.
  //   2. TAPS in screen quadrants (new): a quick tap maps to a direction so
  //      players don't always have to drag — left-half = lane left, right-half
  //      = lane right, top-third = pass, bottom-third = rainbow flick.
  const SWIPE_THRESHOLD = 28;
  const TAP_TIME_MS = 220;
  const TAP_MOVE_MAX = 18;

  let touchStartX = 0, touchStartY = 0, touchStartT = 0;

  const fireKey = (k) => {
    keys[k] = true;
    setTimeout(() => { keys[k] = false; }, 100);
  };

  const onStart = (e) => {
    const t = e.touches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchStartT = Date.now();
  };

  const onEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    const dt = Date.now() - touchStartT;
    const moved = Math.hypot(dx, dy);

    if (dt < TAP_TIME_MS && moved < TAP_MOVE_MAX) {
      // Tap-as-direction
      const w = window.innerWidth;
      const h = window.innerHeight;
      const x = t.clientX, y = t.clientY;
      if (y < h * 0.32) {
        fireKey('ArrowUp');
      } else if (y > h * 0.68) {
        fireKey('ArrowDown');
      } else if (x < w * 0.5) {
        fireKey('ArrowLeft');
      } else {
        fireKey('ArrowRight');
      }
      return;
    }

    // Swipe
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > SWIPE_THRESHOLD) fireKey('ArrowRight');
      else if (dx < -SWIPE_THRESHOLD) fireKey('ArrowLeft');
    } else {
      if (dy < -SWIPE_THRESHOLD) fireKey('ArrowUp');
      else if (dy > SWIPE_THRESHOLD) fireKey('ArrowDown');
    }
  };

  renderer.domElement.addEventListener('touchstart', onStart, { passive: true });
  renderer.domElement.addEventListener('touchend', onEnd, { passive: true });
  // Block iOS rubber-band scrolling while a finger is on the canvas.
  renderer.domElement.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
}

function createSmokeEffect(position) {
  const particleCount = 20;
  const group = new THREE.Group();
  group.position.copy(position);
  for (let i = 0; i < particleCount; i++) {
    const size = 0.15 + Math.random() * 0.2;
    const geo = new THREE.SphereGeometry(size, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.7 });
    const p = new THREE.Mesh(geo, mat);
    const angle = Math.random() * Math.PI * 2;
    const upward = 1 + Math.random() * 3;
    const outward = 0.5 + Math.random() * 1.5;
    p.userData.vx = Math.cos(angle) * outward;
    p.userData.vy = upward;
    p.userData.vz = Math.sin(angle) * outward;
    p.userData.life = 1;
    p.userData.decay = 0.8 + Math.random() * 0.6;
    p.position.y = 1.5 + Math.random() * 1.0;
    group.add(p);
  }
  group.userData.age = 0;
  scene.add(group);
  smokeEffects.push(group);
}

function updateSmokeEffects(dt) {
  for (let i = smokeEffects.length - 1; i >= 0; i--) {
    const smoke = smokeEffects[i];
    smoke.userData.age += dt;
    smoke.position.z += worldSpeed;
    let allDead = true;
    for (const p of smoke.children) {
      p.userData.life -= p.userData.decay * dt;
      if (p.userData.life > 0) {
        allDead = false;
        p.position.x += p.userData.vx * dt;
        p.position.y += p.userData.vy * dt;
        p.position.z += p.userData.vz * dt;
        p.userData.vx *= 0.95;
        p.userData.vy *= 0.96;
        p.userData.vz *= 0.95;
        p.material.opacity = Math.max(0, p.userData.life * 0.7);
        p.scale.setScalar(1 + (1 - p.userData.life) * 2);
      } else {
        p.visible = false;
      }
    }
    if (allDead || smoke.userData.age > 2.0) {
      scene.remove(smoke);
      smokeEffects.splice(i, 1);
    }
  }
}

// ========== GAME FLOW ==========
function startGame() {
  audio.init();
  audio.warmUp();             // unlock the AudioContext inside the click gesture
  audio.startCrowdAmbient();  // start ambient now so it's playing when the video ends
  const startEl = document.getElementById('startScreen');
  const videoEl = document.getElementById('startTransitionVideo');

  // Optional cinematic transition: poster → live pitch. If the asset isn't
  // available the game starts immediately as before.
  const transitionUrl = `${BASE}start_transition.mp4`;
  videoEl.src = transitionUrl;
  videoEl.style.display = 'block';
  startEl.classList.add('fading');

  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    videoEl.style.display = 'none';
    videoEl.pause();
    startEl.style.display = 'none';
    startEl.classList.remove('fading');
    audio.init();
    resetGame();
    gameRunning = true;
  };

  // Mute the transition: an unmuted <video> reliably suspends the Web Audio
  // context, and the suspend often outlives the clip on Chromium browsers,
  // killing in-game SFX and the crowd ambient. The transition is only 4s
  // and reads clearly without sound.
  videoEl.muted = true;
  videoEl.onended = begin;
  videoEl.onerror = begin;        // missing/blocked video shouldn't soft-lock the start
  // Mobile Safari needs a play() promise; ignore rejections (autoplay policy).
  videoEl.play().catch(() => { begin(); });
  // Safety net: never let the player wait longer than the clip.
  setTimeout(begin, 6000);
}

function restartGame() {
  audio.init();
  audio.warmUp();
  audio.startCrowdAmbient();
  document.getElementById('gameOver').style.display = 'none';
  resetGame();
  gameRunning = true;
  gameOverFlag = false;
}

function resetGame() {
  score = 0;
  worldSpeed = WORLD_SPEED_INIT;
  spawnInterval = SPAWN_INTERVAL_INIT;
  spawnTimer = 0;
  currentLane = 1;
  targetX = LANES[1];
  isBouncing = false;
  isPassing = false;
  gameTime = 0;
  nextMilestone = 25;
  celebrationTimer = 0;
  document.getElementById('celebration').style.display = 'none';

  if (passBall) { scene.remove(passBall); passBall = null; }
  if (passReturnBall) { scene.remove(passReturnBall); passReturnBall = null; }
  passReturnTarget = null;

  playerBall.visible = true;
  playerBall.position.set(0, PLAYER_BALL_RADIUS, -0.5);

  fireworks.forEach(fw => scene.remove(fw));
  fireworks = [];
  defenders.forEach(d => scene.remove(d));
  defenders = [];
  teammates.forEach(t => scene.remove(t));
  teammates = [];
  smokeEffects.forEach(s => scene.remove(s));
  smokeEffects = [];

  playerGroup.position.set(LANES[1], 0, playerBaseZ);
  playerSpriteController.setState('run');
  updateScoreHud();
  updateMatchClock();
}

function updateScoreHud() {
  document.getElementById('scoreVal').textContent = score;
  document.getElementById('bestScoreHud').textContent = bestScore;
}

function updateMatchClock() {
  const mins = Math.floor(gameTime / 60);
  const secs = Math.floor(gameTime % 60);
  const el = document.getElementById('matchClock');
  if (el) el.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
}

function gameOver() {
  gameRunning = false;
  gameOverFlag = true;
  audio.playCollisionSound();
  audio.stopCrowdAmbient();
  document.getElementById('finalScore').textContent = score;

  const newBestEl = document.getElementById('newBestScore');
  newBestEl.style.display = 'none';
  newBestEl.classList.remove('animate');

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('footballRunnerBest', bestScore.toString());
    newBestEl.textContent = '\u{1F3C6} Uusi ennätys! \u{1F3C6}';
    newBestEl.style.display = 'block';
    void newBestEl.offsetHeight;
    newBestEl.classList.add('animate');
  }

  document.getElementById('bestScoreEnd').textContent = bestScore;
  document.getElementById('gameOver').style.display = 'block';
}

// ========== FIREWORKS ==========
function createFirework() {
  const colors = [0xff0044, 0xffdd00, 0x00ff88, 0x4488ff, 0xff8800, 0xff00ff, 0x00ffff];
  const particleCount = 40;
  const group = new THREE.Group();
  const cx = (Math.random() - 0.5) * 12;
  const cy = 4 + Math.random() * 6;
  const cz = playerGroup.position.z - 10 - Math.random() * 15;
  group.position.set(cx, cy, cz);
  const color = colors[Math.floor(Math.random() * colors.length)];
  for (let i = 0; i < particleCount; i++) {
    const geo = new THREE.SphereGeometry(0.08 + Math.random() * 0.06, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const p = new THREE.Mesh(geo, mat);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = 2 + Math.random() * 4;
    p.userData.vx = Math.sin(phi) * Math.cos(theta) * speed;
    p.userData.vy = Math.sin(phi) * Math.sin(theta) * speed;
    p.userData.vz = Math.cos(phi) * speed;
    p.userData.life = 1;
    p.userData.decay = 0.6 + Math.random() * 0.8;
    group.add(p);
  }
  group.userData.age = 0;
  scene.add(group);
  fireworks.push(group);
}

function updateFireworks(dt) {
  for (let i = fireworks.length - 1; i >= 0; i--) {
    const fw = fireworks[i];
    fw.userData.age += dt;
    let allDead = true;
    for (const p of fw.children) {
      p.userData.life -= p.userData.decay * dt;
      if (p.userData.life > 0) {
        allDead = false;
        p.position.x += p.userData.vx * dt;
        p.position.y += p.userData.vy * dt - 2 * dt;
        p.position.z += p.userData.vz * dt;
        p.userData.vx *= 0.97;
        p.userData.vy *= 0.97;
        p.userData.vz *= 0.97;
        p.material.opacity = Math.max(0, p.userData.life);
        p.scale.setScalar(Math.max(0.1, p.userData.life));
      } else {
        p.visible = false;
      }
    }
    if (allDead || fw.userData.age > 2.5) {
      scene.remove(fw);
      fireworks.splice(i, 1);
    }
  }
  if (celebrationTimer > 0) {
    celebrationTimer -= dt;
    if (Math.random() < dt * 5) createFirework();
    if (celebrationTimer <= 0) {
      document.getElementById('celebration').style.display = 'none';
    }
  }
}

function triggerCelebration(points) {
  const msgIndex = Math.min(Math.floor((points - 25) / 50), CELEBRATION_MESSAGES.length - 1);
  const el = document.getElementById('celebration');
  el.textContent = points + " pistettä! " + CELEBRATION_MESSAGES[Math.max(0, msgIndex)];
  el.style.display = 'block';
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = 'celebPulse 0.6s ease-in-out 3';
  celebrationTimer = 2.5;
  audio.playMilestoneSound();
  audio.playCrowdRoar();
  for (let i = 0; i < 5; i++) {
    setTimeout(() => createFirework(), i * 200);
  }
}

// ========== UPDATE ==========
function update(dt) {
  if (!gameRunning) return;

  gameTime += dt;
  updateMatchClock();
  const difficulty = Math.min(gameTime / 120, 1);
  worldSpeed = WORLD_SPEED_INIT + difficulty * (WORLD_SPEED_MAX - WORLD_SPEED_INIT);
  spawnInterval = SPAWN_INTERVAL_INIT - difficulty * (SPAWN_INTERVAL_INIT - SPAWN_INTERVAL_MIN);

  laneChangeCooldown -= dt;
  if (!isBouncing && !isPassing && keys['ArrowLeft'] && laneChangeCooldown <= 0 && currentLane > 0) {
    currentLane--;
    targetX = LANES[currentLane];
    laneChangeCooldown = 0.18;
    playerSpriteController.setState('lane_left');
    audio.playLaneSwapSound();
  }
  if (!isBouncing && !isPassing && keys['ArrowRight'] && laneChangeCooldown <= 0 && currentLane < 2) {
    currentLane++;
    targetX = LANES[currentLane];
    laneChangeCooldown = 0.18;
    playerSpriteController.setState('lane_right');
    audio.playLaneSwapSound();
  }

  if (keys['ArrowDown'] && !isBouncing && !isPassing) {
    isBouncing = true;
    bounceTime = 0;
    audio.playRainbowFlickSound();
    playerSpriteController.setState('rainbow');
  }

  if (keys['ArrowUp'] && !isPassing && !isBouncing) {
    isPassing = true;
    passBallLane = currentLane;
    audio.playKickSound();
    playerBall.visible = false;
    playerSpriteController.setState('pass');
    passBall = createPassBall();
    passBall.position.set(LANES[currentLane], 0.22, playerGroup.position.z - 2);
    passBall.userData.startZ = passBall.position.z;
    passBall.userData.stopped = false;
    passBall.userData.stoppedZ = null;
    scene.add(passBall);
  }

  playerGroup.position.x += (targetX - playerGroup.position.x) * 0.15;

  if (isBouncing) {
    bounceTime += dt;
    const t = Math.min(bounceTime / BOUNCE_DURATION, 1);
    const ballZ = 0.6 - t * 1.1;
    const peakT = 0.45;
    const h = -(t - peakT) * (t - peakT) / (peakT * peakT) + 1;
    const ballY = PLAYER_BALL_RADIUS + h * 3.8;
    playerBall.position.set(0, ballY, ballZ);
    playerBall.rotation.x += dt * 14;
    if (t >= 1) {
      isBouncing = false;
      playerBall.position.set(0, PLAYER_BALL_RADIUS, -0.5);
      playerBall.visible = true;
    }
  }

  if (isPassing && passBall) {
    if (!passBall.userData.stopped) {
      passBall.position.z -= PASS_SPEED;
      passBall.rotation.x -= 0.3;
      passBall.position.y = 0.22;
      for (let i = defenders.length - 1; i >= 0; i--) {
        const def = defenders[i];
        const dx = Math.abs(def.position.x - passBall.position.x);
        const dz = Math.abs(def.position.z - passBall.position.z);
        if (dx < 1.2 && dz < 1.5) { gameOver(); return; }
      }
      let hitTeammate = false;
      for (let i = teammates.length - 1; i >= 0; i--) {
        const tm = teammates[i];
        const dx = Math.abs(tm.position.x - passBall.position.x);
        const dz = Math.abs(tm.position.z - passBall.position.z);
        if (dx < 2.0 && dz < 2.5) {
          hitTeammate = true;
          scene.remove(passBall);
          passBall = null;
          passReturnBall = createPassBall();
          passReturnBall.position.set(tm.position.x, 0.22, tm.position.z);
          passReturnTarget = new THREE.Vector3(LANES[currentLane], 0.33, playerGroup.position.z);
          scene.add(passReturnBall);
          createSmokeEffect(tm.position);
          scene.remove(tm);
          teammates.splice(i, 1);
          break;
        }
      }
      if (!hitTeammate && passBall && passBall.position.z < passBall.userData.startZ - PASS_STOP_DISTANCE) {
        passBall.userData.stopped = true;
        passBall.userData.stoppedZ = passBall.position.z;
      }
    }
    if (passBall && passBall.userData.stopped) {
      passBall.position.z += worldSpeed;
      const playerWorldZ = playerGroup.position.z;
      const dz = Math.abs(passBall.position.z - playerWorldZ);
      const dx = Math.abs(passBall.position.x - playerGroup.position.x);
      if (dz < 2.0 && dx < 1.5) {
        scene.remove(passBall);
        passBall = null;
        isPassing = false;
        playerBall.visible = true;
        playerBall.position.set(0, PLAYER_BALL_RADIUS, -0.5);
      }
      if (passBall && passBall.position.z > playerWorldZ + 3) { gameOver(); return; }
    }
  }

  if (passReturnBall) {
    // Target lands the ball just in front of the player (toward where Repo
    // can dribble it next), not behind him. Also keep it at dribble height.
    const target = new THREE.Vector3(playerGroup.position.x, PLAYER_BALL_RADIUS, playerGroup.position.z - 1);
    const dir = new THREE.Vector3().subVectors(target, passReturnBall.position);
    const dist = dir.length();
    if (dist < 2.0) {
      scene.remove(passReturnBall);
      passReturnBall = null;
      passReturnTarget = null;
      isPassing = false;
      playerBall.visible = true;
      playerBall.position.set(0, PLAYER_BALL_RADIUS, -0.5);
      score += 5;
      updateScoreHud();
      audio.playSuccessPassSound();
      const el = document.getElementById('celebration');
      el.textContent = '⚽ Jes! +5 pistettä!';
      el.style.display = 'block';
      el.style.animation = 'none';
      void el.offsetHeight;
      el.style.animation = 'celebPulse 0.6s ease-in-out 2';
      setTimeout(() => { if (celebrationTimer <= 0) el.style.display = 'none'; }, 1200);
      if (score >= nextMilestone) {
        triggerCelebration(score);
        if (nextMilestone === 25) nextMilestone = 50;
        else nextMilestone += 50;
      }
    } else {
      dir.normalize().multiplyScalar(PASS_SPEED * 0.8);
      passReturnBall.position.add(dir);
      passReturnBall.position.z += worldSpeed;
      passReturnBall.rotation.x += 0.3;
      if (passReturnBall.position.z > playerGroup.position.z + 10) { gameOver(); return; }
    }
  }

  // Sprite animation: PlayerSpriteController owns the per-frame UV update.
  // The lean tilt that the old code applied via material.rotation is now
  // baked into the lane_left / lane_right sprite sheets; we still nudge the
  // group's z-rotation slightly so big lane jumps feel weighty.
  playerSpriteController.update(dt);
  const leanTarget = (targetX - playerGroup.position.x) * 0.05;
  playerGroup.rotation.z += (leanTarget - playerGroup.rotation.z) * 0.1;

  if (!isBouncing && !isPassing) {
    const runPhase = Date.now() * 0.008;
    const stepCycle = (runPhase % Math.PI) / Math.PI;
    const kickCurve = Math.pow(stepCycle, 0.4) * (1 - stepCycle);
    playerBall.position.z = -0.4 - kickCurve * 4.0;
    const foot = Math.sin(runPhase) > 0 ? 1 : -1;
    playerBall.position.x = foot * (0.1 + kickCurve * 0.4);
    playerBall.position.y = PLAYER_BALL_RADIUS + Math.pow(Math.abs(Math.sin(runPhase)), 8) * 0.2;
    playerBall.rotation.x -= worldSpeed * 4;
    playerBall.rotation.z = foot * 0.1;
  }

  spawnTimer++;
  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;
    const wallChance = difficulty * 0.20;
    const twoChance = 0.35 + difficulty * 0.15;
    const roll = Math.random();
    let numDefs;
    if (roll < wallChance) numDefs = 3;
    else if (roll < wallChance + twoChance) numDefs = 2;
    else numDefs = 1;
    const usedLanes = [];
    for (let i = 0; i < numDefs; i++) {
      let lane;
      do { lane = Math.floor(Math.random() * 3); } while (usedLanes.includes(lane));
      usedLanes.push(lane);
      createDefender(lane);
    }
    if (numDefs < 3 && Math.random() < 0.30) {
      const freeLanes = [0, 1, 2].filter(l => !usedLanes.includes(l));
      if (freeLanes.length > 0) {
        const tmLane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
        createTeammate(tmLane);
      }
    }
  }

  for (let i = defenders.length - 1; i >= 0; i--) {
    const def = defenders[i];
    const defenderRunSpeed = 0.08 + difficulty * 0.06;
    def.position.z += worldSpeed + defenderRunSpeed;
    def.userData.animator.update(dt);
    // Silhouette tint: far defenders are rendered noticeably darker so the
    // player can read their position before they emerge from the fog.
    const distance = playerGroup.position.z - def.position.z;
    const tint = Math.max(0.7, 1 - Math.min(0.3, Math.max(0, (distance - 10) / 35)));
    def.children[0].material.color.setRGB(tint, tint, tint);
    if (!def.userData.passed && def.position.z > playerGroup.position.z + 1) {
      def.userData.passed = true;
      score++;
      updateScoreHud();
      if (score >= nextMilestone) {
        triggerCelebration(score);
        if (nextMilestone === 25) nextMilestone = 50;
        else nextMilestone += 50;
      }
    }
    const ballWorldPos = new THREE.Vector3();
    playerBall.getWorldPosition(ballWorldPos);
    const defCenterPos = new THREE.Vector3();
    def.getWorldPosition(defCenterPos);
    defCenterPos.y += 1.2 * 1.5;
    const dx = Math.abs(defCenterPos.x - ballWorldPos.x);
    const dz = Math.abs(defCenterPos.z - ballWorldPos.z);
    const dy = Math.abs(defCenterPos.y - ballWorldPos.y);
    if (dx < 1.2 && dz < 1.5 && dy < 2.0) { gameOver(); return; }
    if (def.position.z > 20) {
      scene.remove(def);
      defenders.splice(i, 1);
    }
  }

  for (let i = teammates.length - 1; i >= 0; i--) {
    const tm = teammates[i];
    const defenderRunSpeed = 0.08 + difficulty * 0.06;
    tm.position.z += worldSpeed + defenderRunSpeed;
    tm.userData.animator.update(dt);
    const distance = playerGroup.position.z - tm.position.z;
    const tint = Math.max(0.7, 1 - Math.min(0.3, Math.max(0, (distance - 10) / 35)));
    tm.children[0].material.color.setRGB(tint, tint, tint);
    if (!tm.userData.passed && tm.position.z > playerGroup.position.z + 1) tm.userData.passed = true;
    const dx = Math.abs(tm.position.x - playerGroup.position.x);
    const dz = Math.abs(tm.position.z - playerGroup.position.z);
    if (dx < 1.5 && dz < 1.8) { gameOver(); return; }
    if (tm.position.z > 20) {
      scene.remove(tm);
      teammates.splice(i, 1);
    }
  }

  fieldLines.forEach(line => {
    line.position.z += worldSpeed;
    if (line.position.z > 15) line.position.z -= FIELD_LENGTH;
  });

  updateFireworks(dt);
  updateSmokeEffects(dt);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}

function applyCameraForAspect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  // Portrait phones (aspect < 0.8) need a wider FOV and a pulled-back camera
  // so that all three lanes (x = ±3) stay inside the frustum. The original
  // tuning was for landscape ~1.78 and clipped the player out the sides on
  // a phone. We also bring Repo closer to the camera in portrait so he reads
  // big enough on a narrow screen — landscape can't do this without losing
  // his feet off the bottom inside its narrower 60° vertical FOV.
  if (aspect < 0.8) {
    camera.fov = 78;
    camera.position.set(0, 6, 12);
    playerBaseZ = 5;
  } else {
    camera.fov = 60;
    camera.position.set(0, 4, 9);
    playerBaseZ = 3;
  }
  camera.aspect = aspect;
  camera.lookAt(0, 1, -28);
  camera.updateProjectionMatrix();
  if (playerGroup) playerGroup.position.z = playerBaseZ;
}

function onResize() {
  applyCameraForAspect();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

init();
