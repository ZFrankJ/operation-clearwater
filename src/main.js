import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createWorld } from './world.js';
import { EnemyDirector } from './enemies.js';
import { PlayerController } from './player.js';
import { WeaponSystem } from './weapon.js';
import { MissionDirector } from './mission.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { getDifficultyProfile, isOneLifeDifficulty } from './difficulty.js';

const canvas = document.getElementById('game-canvas');
const ui = new UI(document);
const audio = new AudioSystem();
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';
const testWeaponPose = testMode ? params.get('weapon') : null;
const testPeace = testMode && params.get('peace') === '1';
const testFreezeEnemies = testMode && params.get('freeze') === '1';
const testGod = testMode && params.get('god') === '1';
const testEnemyPose = testMode ? params.get('enemy') : null;
const testEnemyWall = testMode && params.get('enemyWall') === '1';
const testPlayerDeath = testMode && params.get('death') === '1';
const testDeathReload = testMode && params.get('deathReload') === '1';
const testPitch = testMode && params.has('pitch')
  ? THREE.MathUtils.clamp(Number(params.get('pitch')) || 0, -1.2, 1.2)
  : null;
const testPlayerHealth = testMode && params.has('health')
  ? THREE.MathUtils.clamp(Number(params.get('health')) || 1, 1, 100)
  : null;
const testLiveShot = testMode && params.get('shot') === '1';
const testShotTarget = testMode ? params.get('shotTarget') : null;
const testReloadProgress = testMode && params.has('reloadp')
  ? THREE.MathUtils.clamp(Number(params.get('reloadp')) || 0, 0, 0.999)
  : 0.35;
// Browser QA skips the cinematic unless it explicitly asks for a stable phase
// (`intro=flyby`, `intro=thermal`, `intro=insertion`) or the complete pass
// (`intro=run`). Normal players always receive the full reconnaissance beat.
const testIntroMode = testMode ? (params.get('intro') ?? 'skip') : 'run';

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x07131b, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7898a3);
scene.fog = new THREE.FogExp2(0x8da4a6, 0.0065);

// Keep the depth range tight enough that fence hardware, foundations, and the
// first-person sights remain stable instead of fighting in the depth buffer.
const camera = new THREE.PerspectiveCamera(71, 1, 0.08, 420);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Render directly to the visible canvas. Offscreen post-processing targets
// offered little at this restrained grade and could expose a stale ping-pong
// tile during one-frame muzzle/impact transients on some integrated GPUs.

let world = null;
let player = null;
let weapon = null;
let enemies = null;
let mission = null;
let gameStarted = false;
let endingMode = false;
let endingFailure = false;
let endingElapsed = 0;
let endingStats = null;
let difficulty = getDifficultyProfile(params.get('difficulty')).id;
let difficultyProfile = getDifficultyProfile(difficulty);
if (ui.difficultySelect) ui.difficultySelect.value = difficulty;
let quality = 'high';
let lastFrame = performance.now();
let footsteps = 0;
let lastAlertToast = -Infinity;
let bootComplete = false;
let fatalError = null;
let globalHawk = null;
let reconActive = false;
let reconElapsed = 0;
let reconPhase = 'idle';
let reconFreezePhase = null;
let reconGuardPositions = [];
let reconThermalTargets = null;
let reconSpawn = new THREE.Vector3(0, 0.08, 92);
let reconControlPromise = null;
let reconAudioPlayed = false;
let deferredReconRadioLine = null;
let deferredReconRadioTimer = null;

const RECON_TIMING = Object.freeze({
  flybyEnd: 3.65,
  thermalStart: 3.3,
  thermalEnd: 8.85,
  insertionEnd: 11.2,
});
const RECON_TEST_TIMES = Object.freeze({ flyby: 2.15, thermal: 8.65, insertion: 10.25 });
const RECON_HAWK_URL = './assets/models/vehicles/global-hawk.glb';
const RECON_DRACO_PATH = './vendor/three/examples/jsm/libs/draco/gltf/';
const RECON_TARGET_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'valve_vault', label: 'VALVE VAULT', code: 'V-01', symbol: '⊕', interactionId: 'close_supply_valve' }),
  Object.freeze({ id: 'poison_injection_machine', label: 'POISON INJECTION MACHINE', code: 'P-04', symbol: '◇', interactionId: 'neutralize_poison' }),
  Object.freeze({ id: 'backdoor_pipe', label: 'BACKDOOR PIPE / DEMOLITION POINT', code: 'D-03', symbol: '△', interactionId: 'demolish_backdoor_main_pipe' }),
]);

const interactionAliases = Object.freeze({
  disable_jammer: 'jammer', jammer: 'jammer',
  restore_power: 'power', power: 'power',
  transmit_ledger: 'ledger', ledger: 'ledger',
  cancel_purge: 'purge', purge: 'purge',
  neutralize_poison: 'neutralize_poison',
  stop_poison: 'neutralize_poison', poison: 'neutralize_poison',
  poison_injection: 'neutralize_poison', injection: 'neutralize_poison',
  injection_controls: 'neutralize_poison', dosing_controls: 'neutralize_poison',
  close_supply_valve: 'close_supply_valve',
  shut_supply: 'close_supply_valve', valve: 'close_supply_valve',
  supply_valve: 'close_supply_valve', supply_wheel: 'close_supply_valve',
  main_supply: 'close_supply_valve', emergency_shutoff: 'close_supply_valve',
  demolish_backdoor_main_pipe: 'demolish_backdoor_main_pipe',
  demolish_backdoor_pipe: 'demolish_backdoor_main_pipe', backdoor_pipe: 'demolish_backdoor_main_pipe',
  pipe_demolition: 'demolish_backdoor_main_pipe', sever_supply_main: 'demolish_backdoor_main_pipe',
});

const stageGroups = Object.freeze({
  disable_jammer: 'intake',
  restore_power: 'filter',
  transmit_ledger: 'atrium',
  defense: 'finale',
  rusk_surrender: 'boss',
  recon: ['intake', 'filter', 'atrium', 'finale', 'boss'],
  stop_poison: ['filter', 'atrium'],
  neutralize_poison: ['filter', 'atrium'],
  shut_supply: ['finale', 'boss'],
  close_supply_valve: ['finale', 'boss'],
});

// URL-only QA viewpoints used by the local browser smoke test. They are never
// reached during a normal launch and keep visual inspection deterministic.
const testPoses = Object.freeze({
  infiltration: { position: [0, 0.06, 90], yaw: 0, pitch: -0.025 },
  overlook: { position: [0, 0.06, 51], yaw: 0, pitch: -0.035 },
  gatehouse: { position: [4, 0.06, 38], yaw: 0.32, pitch: -0.025 },
  character: { position: [3, 0.06, 17], yaw: -0.68, pitch: -0.01 },
  characterArm: { position: [3, 0.06, 17], yaw: -0.74, pitch: -0.075 },
  characterSide: { position: [8.5, 0.06, 14], yaw: 1.57, pitch: -0.025 },
  enemyGripFront: { position: [5.5, 0.06, 16.5], yaw: 0, pitch: -0.035 },
  enemyGripSide: { position: [7.2, 0.06, 14], yaw: 1.57, pitch: -0.035 },
  unawareRear: { position: [5.5, 0.06, 10], yaw: Math.PI, pitch: -0.01 },
  unawareNearMiss: { position: [5.5, 0.06, 10], yaw: Math.PI + 0.11, pitch: -0.165 },
  engagement: { position: [-1, 0.06, 18], yaw: 0.85, pitch: -0.025 },
  fence: { position: [15, 0.06, 70], yaw: -0.231, pitch: -0.012 },
  pumpshed: { position: [-2, 0.06, -4], yaw: 0.35, pitch: -0.02 },
  machineClearance: { position: [5.6, 0.11, -13.95], yaw: 0, pitch: -0.02 },
  pumpgable: { position: [-15.5, 0.06, 13], yaw: 0, pitch: -0.03 },
  operations: { position: [0, 0.06, -36], yaw: -0.34, pitch: -0.015 },
  reservoir: { position: [14, 0.06, -104], yaw: 0, pitch: -0.16 },
  poison: { position: [0, 0.06, -2], yaw: 0, pitch: -0.02 },
  valve: { position: [14.5, 0.06, -66], yaw: 0, pitch: -0.055 },
  valveSign: { position: [7.5, 0.06, -64.4], yaw: 1.57, pitch: -0.025 },
  backdoor: { position: [3, 0.06, -86], yaw: -1.57, pitch: -0.04 },
  wall: { position: [10.35, 0.11, -10], yaw: -Math.PI / 2, pitch: -0.02 },
  enemyWall: { position: [8.1, 0.11, -10], yaw: -Math.PI / 2, pitch: -0.02 },
});

function canonicalInteraction(value) {
  const raw = typeof value === 'object' ? value?.id ?? value?.interactionId ?? value?.name : value;
  const key = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return interactionAliases[key] ?? key;
}

function safeCall(target, method, ...args) {
  if (typeof target?.[method] !== 'function') return undefined;
  try {
    return target[method](...args);
  } catch (error) {
    console.warn(`[CLEARWATER] ${method} failed`, error);
    return undefined;
  }
}

function vectorFrom(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) return new THREE.Vector3(value[0], value[1], value[2]);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback?.clone?.() ?? null;
}

function authoredEnemySpawns() {
  const source = world?.enemySpawns ?? world?.spawnPoints?.enemies ?? world?.spawns?.enemies;
  const results = [];
  const seen = new Set();
  const visit = (value, group = 'hostiles') => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, group));
      return;
    }
    const position = vectorFrom(value?.position ?? (value?.isVector3 ? value : null));
    if (position) {
      const id = String(value?.id ?? `${group}_${results.length + 1}`);
      if (!seen.has(id)) {
        seen.add(id);
        results.push({ ...value, id, group, position });
      }
      return;
    }
    if (typeof value === 'object' && !value.isVector3) {
      for (const [key, child] of Object.entries(value)) visit(child, key);
    }
  };
  visit(source);
  return results;
}

function authoredEnemyGroups() {
  const source = world?.enemySpawns ?? world?.spawnPoints?.enemies ?? world?.spawns?.enemies;
  if (!source || Array.isArray(source)) return ['hostiles'];
  return Object.entries(source)
    .filter(([, value]) => Array.isArray(value) && value.length)
    .map(([group]) => group);
}

function groundAt(x, z, fallback = 0.08) {
  const candidate = safeCall(world, 'getGroundHeight', x, z)
    ?? safeCall(world, 'groundHeightAt', x, z)
    ?? safeCall(world, 'terrainHeight', x, z);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function chooseInfiltrationSpawn(spawns = authoredEnemySpawns()) {
  const authored = vectorFrom(
    world?.infiltrationSpawn ?? world?.thermalScan?.insertion ?? world?.playerSpawn ?? world?.spawn,
    reconSpawn,
  );
  if (!spawns.length) {
    authored.y = groundAt(authored.x, authored.z, authored.y);
    return authored;
  }

  const center = spawns.reduce((sum, spec) => sum.add(spec.position), new THREE.Vector3()).multiplyScalar(1 / spawns.length);
  center.y = 0;
  const direction = authored.clone().sub(center).setY(0);
  if (direction.lengthSq() < 1) direction.set(0, 0, 1);
  direction.normalize();
  const siteRadius = Math.max(...spawns.map((spec) => spec.position.clone().setY(0).distanceTo(center)));
  const nearest = Math.min(...spawns.map((spec) => spec.position.distanceTo(authored)));
  // Keep a genuine infiltration lane between insertion and the first patrol.
  // An explicit exterior spawn is preserved when it already provides that gap.
  const result = nearest >= 27 ? authored : center.clone().addScaledVector(direction, siteRadius + 30);
  result.y = groundAt(result.x, result.z, authored.y);
  return result;
}

function placePlayerAtInsertion() {
  reconSpawn = chooseInfiltrationSpawn(reconGuardPositions);
  const facing = factoryFacingFrom(reconSpawn);
  player.yaw = facing.yaw;
  player.pitch = facing.pitch;
  player.reset(reconSpawn, { armor: difficultyProfile.startingArmor });
  saveCheckpoint(reconSpawn);
  player.yaw = facing.yaw;
  player.pitch = facing.pitch;
  player.update(0);
}

function factoryFacingFrom(position = player?.position) {
  const origin = position?.isVector3 ? position : new THREE.Vector3();
  const target = reconGuardPositions.length
    ? reconGuardPositions.reduce((sum, spec) => sum.add(spec.position), new THREE.Vector3()).multiplyScalar(1 / reconGuardPositions.length)
    : new THREE.Vector3(0, 0, -20);
  const direction = target.sub(origin);
  return {
    yaw: Math.atan2(-direction.x, -direction.z),
    pitch: -0.025,
  };
}

function saveCheckpoint(position = player?.position) {
  if (!isOneLifeDifficulty(difficulty)) player?.setCheckpoint?.(position, factoryFacingFrom(position));
}

async function loadGlobalHawk() {
  const draco = new DRACOLoader();
  draco.setDecoderPath(RECON_DRACO_PATH);
  draco.preload();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  try {
    const gltf = await loader.loadAsync(RECON_HAWK_URL);
    const asset = gltf.scene;
    // NASA's model arrives Z-up through its glTF node and its nose points along
    // local +Z after conversion. THREE.Object3D.lookAt also faces local +Z at
    // its target, so preserving the authored orientation makes the aircraft
    // cross the camera nose-first and upright.
    asset.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(asset);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    asset.position.sub(center);
    asset.traverse((child) => {
      if (!child.isMesh) return;
      // At reconnaissance altitude the aircraft cannot paint a hard shadow on
      // the compound. Keep its telephoto silhouette legible through the site's
      // low-level ground haze without implying that it is flying inside it.
      child.castShadow = false;
      child.receiveShadow = false;
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const opaque = sourceMaterials.map((material) => new THREE.MeshStandardMaterial({
        name: `${material?.name ?? 'GLOBAL_HAWK'}_FLIGHT`,
        color: material?.color?.clone?.() ?? new THREE.Color(0xd7d9d7),
        map: material?.map ?? null,
        metalness: 0.32,
        roughness: 0.58,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        side: THREE.DoubleSide,
        fog: false,
      }));
      child.material = Array.isArray(child.material) ? opaque : opaque[0];
    });
    globalHawk = new THREE.Group();
    globalHawk.name = 'RQ4_GLOBAL_HAWK_RECON_CINEMATIC';
    globalHawk.add(asset);
    globalHawk.scale.setScalar(22 / Math.max(1, size.x));
    globalHawk.visible = false;
    globalHawk.userData.forwardAxis = '+Z';
    scene.add(globalHawk);
    return globalHawk;
  } finally {
    draco.dispose();
  }
}

function createThermalTargets() {
  removeThermalTargets();
  const overlay = document.getElementById('thermal-overlay');
  if (!overlay) return;
  const layer = document.createElement('div');
  layer.className = 'thermal-contact-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const contacts = reconGuardPositions.map((spec, index) => {
    const marker = document.createElement('i');
    marker.className = 'thermal-contact-x';
    marker.dataset.contact = String(index + 1).padStart(2, '0');
    marker.hidden = true;
    layer.append(marker);
    const worldPosition = spec.position.clone();
    worldPosition.y = Math.max(worldPosition.y + 2.15, groundAt(worldPosition.x, worldPosition.z) + 2.15);
    return { marker, worldPosition, projected: new THREE.Vector3() };
  });
  const strategicLayer = document.createElement('div');
  strategicLayer.className = 'thermal-strategic-layer';
  strategicLayer.setAttribute('aria-hidden', 'true');
  strategicLayer.hidden = true;
  const strategic = authoredReconTargets().map((target) => {
    const marker = document.createElement('div');
    marker.className = `thermal-strategic-marker thermal-strategic--${target.id}`;
    marker.dataset.reconTarget = target.id;
    marker.hidden = true;
    const symbol = document.createElement('i');
    symbol.className = 'thermal-strategic-symbol';
    symbol.textContent = target.symbol;
    const label = document.createElement('span');
    label.className = 'thermal-strategic-label';
    const code = document.createElement('small');
    code.textContent = `${target.code} / STRATEGIC`;
    const title = document.createElement('strong');
    title.textContent = target.label;
    label.append(code, title);
    marker.append(symbol, label);
    strategicLayer.append(marker);
    return { ...target, marker, projected: new THREE.Vector3() };
  });
  // The layer sits above the filtered WebGL canvas but inside the EO/IR HUD,
  // so red contacts remain red while all world imagery stays white-hot.
  overlay.prepend(layer, strategicLayer);
  reconThermalTargets = { layer, strategicLayer, contacts, strategic };
}

function authoredReconTargets() {
  const source = world?.reconTargets
    ?? world?.thermalScan?.reconTargets
    ?? world?.metadata?.reconTargets
    ?? [];
  const entries = Array.isArray(source)
    ? source
    : Object.entries(source).map(([id, value]) => ({ id, ...(value ?? {}) }));
  return RECON_TARGET_DEFINITIONS.map((definition) => {
    const aliases = definition.id === 'valve_vault'
      ? /valve|supply[_\s-]?wheel/i
      : definition.id === 'poison_injection_machine'
        ? /poison|injection|dosing/i
        : /backdoor|demolition|breach|pipe/i;
    const authored = entries.find((entry) => (
      String(entry?.id ?? '').toLowerCase() === definition.id
      || aliases.test(`${entry?.id ?? ''} ${entry?.label ?? ''} ${entry?.assetId ?? ''}`)
    ));
    let position = vectorFrom(authored?.position ?? authored?.point ?? authored?.target);
    if (!position && definition.interactionId) {
      const interaction = world?.interactables?.find?.((item) => canonicalInteraction(item) === definition.interactionId);
      position = vectorFrom(interaction?.position) ?? itemPosition(interaction);
    }
    if (!position && authored?.assetId) {
      const object = scene.getObjectByName(String(authored.assetId));
      position = object?.getWorldPosition?.(new THREE.Vector3()) ?? null;
    }
    return position ? { ...definition, position, assetId: authored?.assetId ?? null } : null;
  }).filter(Boolean);
}

function removeThermalTargets() {
  reconThermalTargets?.layer?.remove?.();
  reconThermalTargets?.strategicLayer?.remove?.();
  reconThermalTargets = null;
}

function projectThermalMarker(marker, worldPosition, projected, width, height) {
  projected.copy(worldPosition).project(camera);
  const visible = projected.z >= -1 && projected.z <= 1
    && projected.x >= -1.04 && projected.x <= 1.04
    && projected.y >= -1.04 && projected.y <= 1.04;
  marker.hidden = !visible;
  if (!visible) return false;
  const x = (projected.x * 0.5 + 0.5) * width;
  const y = (-projected.y * 0.5 + 0.5) * height;
  marker.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  return true;
}

function updateThermalTargetProjection(visibleCount) {
  const targets = reconThermalTargets;
  if (!targets?.layer || reconPhase !== 'thermal') return;
  const width = Math.max(1, targets.layer.clientWidth || innerWidth);
  const height = Math.max(1, targets.layer.clientHeight || innerHeight);
  targets.contacts.forEach((contact, index) => {
    if (index >= visibleCount) {
      contact.marker.hidden = true;
      return;
    }
    projectThermalMarker(contact.marker, contact.worldPosition, contact.projected, width, height);
  });
  targets.strategic.forEach((target) => {
    projectThermalMarker(target.marker, target.position, target.projected, width, height);
  });
}

function cubicPoint(a, b, c, d, t, target = new THREE.Vector3()) {
  const u = 1 - t;
  return target.set(0, 0, 0)
    .addScaledVector(a, u * u * u)
    .addScaledVector(b, 3 * u * u * t)
    .addScaledVector(c, 3 * u * t * t)
    .addScaledVector(d, t * t * t);
}

function pointCamera(position, target, up = new THREE.Vector3(0, 1, 0)) {
  camera.position.copy(position);
  camera.up.copy(up);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

function presentRadioLine(line) {
  if (!line) return;
  audio.radio('incoming');
  audio.voice(line.speaker, line.text);
  ui.showSubtitle(`${line.speaker} / RADIO`, line.text, line.duration);
}

function deferReconRadio(line) {
  deferredReconRadioLine = line ? { ...line } : null;
}

function scheduleDeferredReconRadio(delayMs = 1000) {
  if (!deferredReconRadioLine || deferredReconRadioTimer) return false;
  const line = deferredReconRadioLine;
  deferredReconRadioLine = null;
  deferredReconRadioTimer = setTimeout(() => {
    deferredReconRadioTimer = null;
    presentRadioLine(line);
  }, Math.max(0, delayMs));
  return true;
}

function clearDeferredReconRadio() {
  if (deferredReconRadioTimer) clearTimeout(deferredReconRadioTimer);
  deferredReconRadioTimer = null;
  deferredReconRadioLine = null;
}

function setReconPhase(next) {
  if (reconPhase === next) return;
  if (next !== 'flyby') audio.aircraftStop(0.72);
  reconPhase = next;
  // Let the aircraft tail fade completely, leave a short pocket of silence,
  // then open the radio during the thermal scan. Engine and briefing never
  // compete in the same auditory moment.
  if (next === 'thermal') scheduleDeferredReconRadio(1000);
  const thermal = next === 'thermal';
  if (globalHawk) globalHawk.visible = next === 'flyby';
  if (reconThermalTargets?.layer) {
    reconThermalTargets.layer.hidden = !thermal;
    reconThermalTargets.strategicLayer.hidden = !thermal;
    if (!thermal) reconThermalTargets.contacts.forEach((contact) => { contact.marker.hidden = true; });
    if (!thermal) reconThermalTargets.strategic.forEach((target) => { target.marker.hidden = true; });
  }
  canvas.style.filter = thermal
    ? 'grayscale(1) contrast(1.85) brightness(.68)'
    : '';
}

function updateFlyby(time) {
  setReconPhase('flyby');
  const t = THREE.MathUtils.clamp(time / RECON_TIMING.flybyEnd, 0, 1);
  audio.aircraftFlyby(t);
  const eased = THREE.MathUtils.smoothstep(t, 0, 1);
  // A Global Hawk operates far above the facility. Show a compressed,
  // ground-observer telephoto track instead of flying a 22 m aircraft past the
  // player's head. The aircraft remains full scale and more than 185 m AGL in
  // this compact world-space representation of its 16.7 km mission altitude.
  const p0 = new THREE.Vector3(-162, 188, 58);
  const p1 = new THREE.Vector3(-74, 202, 28);
  const p2 = new THREE.Vector3(62, 211, -4);
  const p3 = new THREE.Vector3(172, 218, -46);
  const current = cubicPoint(p0, p1, p2, p3, eased);
  const ahead = cubicPoint(p0, p1, p2, p3, Math.min(1, eased + 0.012));
  const observerY = groundAt(reconSpawn.x, reconSpawn.z) + 1.72;
  const cameraPosition = new THREE.Vector3(reconSpawn.x + 3.5, observerY, reconSpawn.z + 1.5);
  pointCamera(cameraPosition, current);
  camera.fov = THREE.MathUtils.lerp(27, 23, Math.sin(eased * Math.PI));
  camera.updateProjectionMatrix();

  if (globalHawk) {
    globalHawk.position.copy(current);
    globalHawk.up.set(0, 1, 0);
    globalHawk.lookAt(ahead);
    globalHawk.rotateZ(Math.sin(eased * Math.PI) * -0.045);
    globalHawk.updateMatrixWorld();
  }
  safeCall(ui, 'setThermalScan', {
    visible: true,
    count: 0,
    countLabel: 'EO/IR STANDBY',
    status: 'VISUAL PASS',
    sector: 'NORTH INSERTION CORRIDOR',
    progress: t * 0.18,
    droneLabel: 'RQ-4 / PASS 01',
  });
}

function updateThermal(time) {
  setReconPhase('thermal');
  const duration = RECON_TIMING.thermalEnd - RECON_TIMING.thermalStart;
  const t = THREE.MathUtils.clamp((time - RECON_TIMING.thermalStart) / duration, 0, 1);
  const scan = THREE.MathUtils.smoothstep(t, 0, 1);
  const centerZ = reconGuardPositions.length
    ? reconGuardPositions.reduce((sum, spec) => sum + spec.position.z, 0) / reconGuardPositions.length
    : -27;
  const position = new THREE.Vector3(THREE.MathUtils.lerp(-12, 14, scan), THREE.MathUtils.lerp(238, 222, scan), centerZ + THREE.MathUtils.lerp(12, -8, scan));
  pointCamera(position, new THREE.Vector3(0, 0, centerZ - 2), new THREE.Vector3(0, 0, -1));
  camera.fov = 47;
  camera.updateProjectionMatrix();
  const detected = Math.min(reconGuardPositions.length, Math.ceil(scan * reconGuardPositions.length));
  updateThermalTargetProjection(detected);
  const sector = t < 0.28 ? 'OUTER PERIMETER' : t < 0.62 ? 'TREATMENT GALLERY' : 'RESERVOIR / VALVE HOUSE';
  safeCall(ui, 'setThermalScan', {
    visible: true,
    count: detected,
    countLabel: 'HUMAN HEAT SIGNATURES',
    status: t > 0.93 ? 'TRACKS CONFIRMED' : 'SCANNING',
    sector,
    progress: 0.18 + t * 0.68,
    complete: t > 0.93,
    droneLabel: 'RQ-4 / EO-IR WHITE HOT',
  });
}

function updateInsertion(time) {
  setReconPhase('insertion');
  const duration = RECON_TIMING.insertionEnd - RECON_TIMING.thermalEnd;
  const t = THREE.MathUtils.clamp((time - RECON_TIMING.thermalEnd) / duration, 0, 1);
  const eased = THREE.MathUtils.smootherstep(t, 0, 1);
  const centerZ = reconGuardPositions.length
    ? reconGuardPositions.reduce((sum, spec) => sum + spec.position.z, 0) / reconGuardPositions.length
    : -25;
  const sensorPosition = new THREE.Vector3(8, 222, centerZ - 5);
  const control = new THREE.Vector3(24, 19, reconSpawn.z - 28);
  const end = reconSpawn.clone().add(new THREE.Vector3(0, player?.standingEyeHeight ?? 1.62, 0));
  if (t < 0.28) {
    // Hold the high-altitude sensor view until its symbology disappears. The
    // subsequent cut is a ground-camera handoff, never an apparent UAV dive.
    pointCamera(sensorPosition, new THREE.Vector3(0, 0, centerZ - 2), new THREE.Vector3(0, 0, -1));
    camera.fov = 47;
  } else {
    const handoff = THREE.MathUtils.smootherstep((t - 0.28) / 0.72, 0, 1);
    const start = new THREE.Vector3(24, 18, reconSpawn.z - 30);
    const position = start.clone().multiplyScalar((1 - handoff) * (1 - handoff))
      .addScaledVector(control, 2 * (1 - handoff) * handoff)
      .addScaledVector(end, handoff * handoff);
    const target = new THREE.Vector3(0, THREE.MathUtils.lerp(1.1, 1.35, handoff), THREE.MathUtils.lerp(reconSpawn.z - 36, reconSpawn.z - 34, handoff));
    pointCamera(position, target);
    camera.fov = THREE.MathUtils.lerp(58, 71, handoff);
  }
  camera.updateProjectionMatrix();
  safeCall(ui, 'setThermalScan', {
    visible: t < 0.28,
    count: reconGuardPositions.length,
    countLabel: 'HOSTILES MAPPED',
    status: 'PASS COMPLETE',
    sector: 'INSERTION ROUTE CLEAR',
    progress: 1,
    complete: true,
    droneLabel: 'RQ-4 / TRACK TRANSFER',
  });
}

function cleanupReconPresentation() {
  audio.aircraftStop(0.35);
  clearDeferredReconRadio();
  setReconPhase('idle');
  camera.up.set(0, 1, 0);
  camera.fov = 71;
  camera.updateProjectionMatrix();
  canvas.style.filter = '';
  safeCall(ui, 'setThermalScan', false);
  removeThermalTargets();
  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '';
}

function completeReconIntro() {
  if (!reconActive) return;
  reconActive = false;
  cleanupReconPresentation();
  safeCall(mission, 'completeRecon');
  placePlayerAtInsertion();
  player.setEnabled(true);
  weapon.setEnabled(true);
  if (testMode) {
    player.locked = true;
    player.paused = false;
  } else if (!player.locked) {
    ui.toast('INSERTION READY / CLICK TO TAKE CONTROL', 'info', 3600);
  }
  ui.toast('THERMAL PASS / HOSTILES TAGGED', 'success', 2600);
}

function startReconIntro(deferPresentation = false) {
  reconActive = true;
  reconElapsed = 0;
  reconPhase = 'idle';
  reconFreezePhase = RECON_TEST_TIMES[testIntroMode] != null ? testIntroMode : null;
  reconGuardPositions = authoredEnemySpawns();
  reconSpawn = chooseInfiltrationSpawn(reconGuardPositions);
  createThermalTargets();
  safeCall(mission, 'setExpectedHostiles', reconGuardPositions.length || 20);
  player.setEnabled(false);
  weapon.setEnabled(false);
  if (!reconAudioPlayed) {
    reconAudioPlayed = true;
    audio.aircraftTakeoff();
  }
  const hud = document.getElementById('hud');
  if (hud) hud.style.opacity = '0';
  if (!deferPresentation) updateReconIntro(0);
}

function updateReconIntro(dt) {
  if (!reconActive) return;
  if (reconFreezePhase) reconElapsed = RECON_TEST_TIMES[reconFreezePhase];
  else reconElapsed += dt;
  if (reconElapsed < RECON_TIMING.flybyEnd) updateFlyby(reconElapsed);
  else if (reconElapsed < RECON_TIMING.thermalEnd) updateThermal(reconElapsed);
  else updateInsertion(reconElapsed);
  if (!reconFreezePhase && reconElapsed >= RECON_TIMING.insertionEnd) completeReconIntro();
}

function applyQuality(next = 'high') {
  quality = ['low', 'medium', 'high'].includes(next) ? next : 'high';
  const cap = quality === 'high' ? 2.25 : quality === 'medium' ? 1.5 : 1;
  const pixelRatio = Math.min(devicePixelRatio || 1, cap);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = quality !== 'low';
  document.body.dataset.quality = quality;
  resize();
}

function resize() {
  const width = Math.max(1, innerWidth);
  const height = Math.max(1, innerHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
addEventListener('resize', resize);
applyQuality(testMode ? (params.get('quality') ?? 'low') : 'high');

function locationFor(position) {
  if (!position) return 'RIDGEWATCH WATERWORKS';
  if (position.z > 62) return 'EXTERIOR INFILTRATION ROUTE';
  if (position.z > 22) return 'NORTH SECURITY PERIMETER';
  if (position.z > -28) return 'TREATMENT / INJECTION GALLERY';
  if (position.z > -72) return 'MUNICIPAL SUPPLY WORKS';
  return 'RESERVOIR VALVE YARD';
}

function objectiveTarget(state) {
  const wanted = canonicalInteraction(state?.interactionId);
  if (!wanted || !world?.interactables) return null;
  return world.interactables.find((item) => canonicalInteraction(item) === wanted) ?? null;
}

function itemPosition(item) {
  if (item?.position?.isVector3) return item.position;
  if (item?.mesh?.getWorldPosition) return item.mesh.getWorldPosition(new THREE.Vector3());
  if (item?.object?.getWorldPosition) return item.object.getWorldPosition(new THREE.Vector3());
  return null;
}

function updateCompass(yaw = 0) {
  const degrees = (THREE.MathUtils.radToDeg(-yaw) % 360 + 360) % 360;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cardinal = cardinals[Math.round(degrees / 45) % 8];
  const compass = document.getElementById('compass');
  if (!compass) return;
  const primary = compass.querySelector('strong');
  const bearing = compass.querySelector('b');
  if (primary) primary.textContent = cardinal;
  if (bearing) bearing.textContent = String(Math.round(degrees)).padStart(3, '0');
}

function updateHUD(playerState, weaponState, missionState) {
  if (!gameStarted || endingElapsed > 11.6) return;
  const target = objectiveTarget(missionState);
  const targetPosition = itemPosition(target);
  const distance = targetPosition && playerState?.position
    ? targetPosition.distanceTo(playerState.position)
    : null;
  const index = Math.max(0, missionState?.stageIndex ?? 0) + 1;
  ui.setHUD({
    health: playerState?.health ?? 100,
    maxHealth: playerState?.maxHealth ?? 100,
    armor: playerState?.armor ?? 0,
    ammo: weaponState?.ammo ?? 0,
    reserve: weaponState?.reserve ?? 0,
    location: locationFor(playerState?.position),
  });
  ui.setDeathVeil(playerState?.deathProgress ?? 0);
  const crosshair = document.getElementById('crosshair');
  if (crosshair) crosshair.style.opacity = String(1 - THREE.MathUtils.smoothstep(weaponState?.ads ?? 0, 0.18, 0.82));
  ui.setObjective({
    text: missionState?.objective ?? 'Stop poison transfer, close the valve, or sever the backdoor main',
    kicker: `PRIMARY / ${String(Math.min(index, 6)).padStart(2, '0')}`,
    distance,
  });
  if (missionState?.defense) ui.setDefenseTimer(missionState.defense);
  ui.setThreatTimers({
    visible: !['recon', 'hold_reinforcements', 'ending', 'failed'].includes(missionState?.stage)
      && Boolean(missionState?.poison || missionState?.vault),
    poison: missionState?.poison,
    vault: missionState?.vault,
  });
  updateCompass(playerState?.yaw ?? 0);

  const targetInteraction = playerState?.interaction;
  const allowed = targetInteraction && mission?.canInteract(canonicalInteraction(targetInteraction.id));
  if (allowed) {
    ui.setInteract(targetInteraction.prompt ?? target?.prompt ?? 'Operate control', true, targetInteraction.progress ?? 0);
  } else {
    ui.setInteract(false);
  }

  const pips = [...document.querySelectorAll('#armor-pips i')];
  const filled = Math.ceil((playerState?.armor ?? 0) / 25);
  pips.forEach((pip, index_) => { pip.style.opacity = index_ < filled ? '1' : '.15'; });
}

function handleShot(origin, direction) {
  audio.gunshot();
  // EnemyDirector already clips its target ray to the first solid world
  // surface. Use that one authoritative result before asking for a cosmetic
  // world impact so alert state can never change which ray wins.
  const rawEnemyHit = safeCall(enemies, 'raycast', origin, direction, 230) ?? null;
  const enemyHit = Array.isArray(rawEnemyHit) ? rawEnemyHit[0] : rawEnemyHit;
  const rawWorldHit = enemyHit ? null : safeCall(world, 'raycastWorld', origin, direction, 230) ?? null;
  const worldHit = Array.isArray(rawWorldHit) ? rawWorldHit[0] : rawWorldHit;
  const hit = enemyHit ?? worldHit;
  if (!hit) return null;

  const enemy = hit.enemy ?? hit.entity ?? hit.target ?? (hit.kind === 'character' ? hit.object : null);
  if (enemy) {
    const region = hit.region ?? 'torso';
    const damage = region === 'head' ? 110 : region === 'limb' ? 22 : 36;
    const result = safeCall(enemies, 'damage', enemy, damage, region, { sourcePosition: origin });
    const killed = Boolean(result?.killed || result?.down || enemy.dead || enemy.surrendered);
    ui.hitMarker(killed ? 'kill' : region === 'head' ? 'headshot' : 'hit');
    audio.impact('body');
    const bodyHit = {
      ...hit,
      point: hit.point,
      normal: hit.normal ?? direction.clone().negate(),
      material: 'body',
      enemy,
    };
    if (testMode) {
      document.body.dataset.qaShotResult = JSON.stringify({
        result: 'enemy',
        enemyId: enemy.id ?? null,
        region,
        diagnostic: safeCall(enemies, 'getLastShotDiagnostic'),
      });
    }
    return bodyHit;
  }
  if (testMode) {
    document.body.dataset.qaShotResult = JSON.stringify({
      result: hit ? 'world' : 'miss',
      enemyId: null,
      region: null,
      diagnostic: safeCall(enemies, 'getLastShotDiagnostic'),
    });
  }
  return hit;
}

function spawnGroup(group, options = {}) {
  if (!group) return;
  if (testPeace) return [];
  const result = safeCall(enemies, 'spawnGroup', group);
  if (result && !options.quiet) ui.toast(`CONTACTS / ${String(group).toUpperCase()}`, group === 'boss' ? 'warning' : 'info', 1800);
  return result ?? [];
}

function spawnAllAuthoredHostiles() {
  const groups = authoredEnemyGroups();
  const spawned = [];
  for (const group of groups) spawned.push(...spawnGroup(group, { quiet: true }));
  return { groups, spawned, expected: authoredEnemySpawns().length };
}

function buildMission() {
  return new MissionDirector({
    expectedHostiles: authoredEnemySpawns().length || 20,
    onStart: () => {
      const deployment = spawnAllAuthoredHostiles();
      safeCall(mission, 'setExpectedHostiles', deployment.expected || deployment.spawned.length || 20);
    },
    onStage: (stage, state) => {
      ui.setObjective({ text: state.objective, kicker: `PRIMARY / ${String(state.stageIndex + 1).padStart(2, '0')}` });
      // Every authored post is populated before the thermal pass. Stage changes
      // alter intent and objectives, never materialise enemies beside the player.
      if (!['recon', 'ending', 'failed'].includes(stage)) audio.objective();
    },
    onRadio: (line) => {
      if (reconActive && ['idle', 'flyby'].includes(reconPhase)) {
        deferReconRadio(line);
        return;
      }
      presentRadioLine(line);
    },
    onSubtitleEnd: () => audio.radio('end'),
    onReconStarted: (scan = {}) => {
      safeCall(ui, 'setThermalScan', {
        visible: reconActive,
        count: 0,
        status: 'RQ-4 FINAL APPROACH',
        sector: 'NORTH INSERTION CORRIDOR',
        progress: 0,
        droneLabel: 'RQ-4 / PASS 01',
      });
      safeCall(mission, 'setExpectedHostiles', scan.hostileCount ?? reconGuardPositions.length ?? 20);
    },
    onReconComplete: (scan = {}) => {
      safeCall(ui, 'setThermalScan', {
        visible: reconActive,
        count: scan.hostileCount ?? reconGuardPositions.length,
        status: 'TRACKS CONFIRMED',
        sector: 'INSERTION ROUTE CLEAR',
        progress: 1,
        complete: true,
      });
    },
    onThreatTimers: (timers) => ui.setThreatTimers(timers),
    onPoisonPrevented: () => {
      safeCall(world, 'setPoisonNeutralized', true);
      saveCheckpoint(player?.position);
      ui.toast('POISON PROCESS STOPPED / CITY MAIN CLEAN', 'success', 3200);
    },
    onPlanBActivated: () => {
      ui.toast('POISON RELEASED / SECURE THE SUPPLY VALVE', 'warning', 4200);
    },
    onVaultSecured: (event = {}) => {
      if (event.reason !== 'supply_valve_closed') {
        ui.toast('VAULT BREACH STOPPED / SUPPLY WHEEL AVAILABLE', 'success', 3000);
      }
    },
    onVaultBreached: () => {
      ui.toast('VALVE VAULT BREACHED / SUPPLY WHEEL LOST', 'error', 4200);
    },
    onFallbackActivated: () => {
      ui.toast('PLAN C / DEMOLISH THE MARKED BACKDOOR MAIN', 'error', 4800);
    },
    onSupplyShutOff: () => {
      safeCall(world, 'setSupplyValveClosed', true);
      saveCheckpoint(player?.position);
      ui.toast('CITY SUPPLY ISOLATED / ZERO OUTFLOW', 'success', 3600);
    },
    onPipeDemolished: () => {
      safeCall(world, 'setBackdoorPipeDemolished', true);
      saveCheckpoint(player?.position);
      ui.toast('BACKDOOR MAIN SEVERED / CITY FEED DRY', 'success', 3600);
    },
    onCounterattackStarted: (event = {}) => {
      safeCall(world, 'beginFinale');
      const target = world?.missionTargets?.[event.targetKey]?.position ?? player?.position;
      const retasked = safeCall(enemies, 'beginCounterattack', target, {
        waveSize: 3,
        waveInterval: 1.15,
        stagger: 0.16,
      });
      saveCheckpoint(player?.position);
      const count = Array.isArray(retasked) ? retasked.length : event.remainingHostiles;
      ui.toast(`COUNTERATTACK / HOLD FOR RESPONSE${Number.isFinite(count) ? ` / ${count} MOBILE` : ''}`, 'warning', 4400);
      audio.objective();
    },
    onOperationRecaptured: (event = {}) => {
      if (event.type === 'poison') safeCall(world, 'setPoisonNeutralized', false);
      audio.enemyAlert();
      ui.toast('HOSTILE ON DOSING CONTROLS / PROCESS RESTARTED', 'error', 4200);
    },
    onDefenseTimer: (timer) => ui.setDefenseTimer(timer),
    onReinforcementsArrived: () => ui.toast('RESPONSE FORCE ON SITE / OBJECTIVE SECURE', 'success', 3200),
    onComplete: (state) => beginEnding(state.stats, {
      outcome: state.outcome ?? state.stats?.outcome,
      reason: state.snapshots?.at?.(-1)?.reason ?? state.outcome,
    }),
  });
}

function onEnemyDamage(amountOrEvent, enemyOrDirection, options) {
  if (testGod) return;
  const event = typeof amountOrEvent === 'number'
    ? {
        ...(options && typeof options === 'object' ? options : {}),
        amount: amountOrEvent,
        source: options?.source ?? enemyOrDirection,
        direction: options?.direction ?? (enemyOrDirection?.isVector3 ? enemyOrDirection : null),
      }
    : amountOrEvent ?? {};
  const amount = event.amount ?? event.damage ?? 8;
  player?.applyDamage?.(amount, { direction: event.direction, source: event.source ?? null });
}

function beginEnding(stats, outcome = {}) {
  if (endingMode) return;
  endingMode = true;
  endingFailure = false;
  endingElapsed = 0;
  endingStats = {
    stats: stats ?? {},
    outcome: outcome?.outcome ?? stats?.outcome ?? mission?.getState?.()?.outcome,
    reason: outcome?.reason ?? mission?.getState?.()?.outcome,
  };
  reconActive = false;
  cleanupReconPresentation();
  weapon?.setEnabled?.(false);
  player?.setEnabled?.(false);
  safeCall(world, 'finishMission');
  audio.ending();
  player?.unlock?.();
  ui.setInteract(false);
  ui.setDefenseTimer(false);
  ui.setThreatTimers(false);
}

function beginHardFailure(reason = 'operator_down') {
  if (endingMode) return;
  const state = mission?.getState?.() ?? {};
  const stats = state.stats ?? {};
  const elapsed = Math.max(0, Number(state.elapsed ?? stats.elapsedSeconds) || 0);
  const elapsedDisplay = Math.ceil(elapsed);
  endingMode = true;
  endingFailure = true;
  endingElapsed = 0;
  endingStats = {
    failed: true,
    reason,
    stats: {
      ...stats,
      failed: true,
      difficulty,
      elapsedSeconds: elapsed,
      rows: [
        ['RUN', `${difficultyProfile.label} / ONE LIFE`],
        ['MISSION STATUS', 'FAILED'],
        ['HOSTILES NEUTRALIZED', Math.max(0, Math.round(Number(stats.enemiesNeutralized ?? 0)))],
        ['MISSION TIME', `${String(Math.floor(elapsedDisplay / 60)).padStart(2, '0')}:${String(elapsedDisplay % 60).padStart(2, '0')}`],
      ],
    },
  };
  reconActive = false;
  cleanupReconPresentation();
  weapon?.setEnabled?.(false);
  player?.setEnabled?.(false);
  player?.unlock?.();
  audio.ambient(false);
  audio.failure();
  ui.setInteract(false);
  ui.setDefenseTimer(false);
  ui.setThreatTimers(false);
  ui.showEnding(endingStats);
}

function updateEnding(dt) {
  if (endingFailure) return;
  endingElapsed += dt;
  const t = THREE.MathUtils.smoothstep(Math.min(1, endingElapsed / 8.5), 0, 1);
  const start = player?.position ?? new THREE.Vector3(0, 0, -104);
  const desired = new THREE.Vector3(27, 14, -68);
  const from = new THREE.Vector3(start.x, Math.max(start.y + 1.6, 3), start.z);
  camera.position.lerpVectors(from, desired, t);
  const target = new THREE.Vector3(0, 2.8, -97);
  const look = new THREE.Matrix4().lookAt(camera.position, target, new THREE.Vector3(0, 1, 0));
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(look);
  camera.quaternion.slerp(quaternion, Math.min(1, dt * 2.2));
  camera.updateMatrixWorld();
  if (endingElapsed >= 11.6 && !document.getElementById('ending-screen')?.classList.contains('is-visible')) {
    ui.showEnding(endingStats ?? { stats: {} });
  }
}

function playerCallbacks() {
  return {
    onInteractionTarget: (target) => {
      if (!target || !mission?.canInteract(canonicalInteraction(target))) ui.setInteract(false);
    },
    onInteractionProgress: (target, progress) => {
      if (mission?.canInteract(canonicalInteraction(target))) {
        ui.setInteract(target.prompt ?? 'Operate control', true, progress);
      }
    },
    onInteract: (target) => {
      const id = canonicalInteraction(target);
      if (!mission?.interact(id)) return;
      target.completed = true;
      target.enabled = false;
      ui.setInteract(false);
    },
    onDamage: (event) => {
      ui.damage(event.incoming, event.direction);
      audio.damage();
    },
    onDeath: () => {
      weapon?.setEnabled?.(false);
      audio.death();
      if (isOneLifeDifficulty(difficulty)) {
        ui.toast('MARA DOWN / ONE LIFE EXPENDED', 'error', 1800);
        // Let the camera finish the physical fall before replacing the world
        // with the hard-mode failure report.
        setTimeout(() => beginHardFailure('operator_down'), 1500);
        return;
      }
      ui.toast('MARA DOWN / RETURNING TO CHECKPOINT', 'error', 2400);
      setTimeout(() => {
        if (endingMode) return;
        player.reset();
        weapon?.resetForRespawn?.();
        weapon?.setEnabled?.(true);
        player.lock();
      }, 1850);
    },
    onFall: () => {
      if (!isOneLifeDifficulty(difficulty)) return false;
      beginHardFailure('operator_fell');
      return true;
    },
    onLand: (strength) => { if (strength > 6) audio.footstep('concrete', 1.2); },
    onPause: (paused) => {
      if (!gameStarted || endingMode || reconActive) return;
      ui.pause(paused);
      weapon?.setEnabled?.(!paused);
    },
    onLockChange: (locked) => {
      if (!gameStarted || endingMode || reconActive) return;
      ui.pause(!locked);
      weapon?.setEnabled?.(locked);
    },
  };
}

function weaponCallbacks() {
  return {
    onShoot: handleShot,
    onAmmo: (state) => {
      if (gameStarted) ui.setHUD({
        health: player?.health ?? 100,
        armor: player?.armor ?? 0,
        ammo: state.ammo,
        reserve: state.reserve,
      });
    },
    onReload: (event) => { if (event.active) audio.reload(); },
    onMagnification: (event = {}) => {
      const aimMagnification = Number(event.magnification) || 2;
      if (ui.aimSelect) ui.aimSelect.value = String(aimMagnification);
      if (gameStarted) {
        ui.setHUD({ aimMagnification });
        ui.toast(`AIM MAGNIFICATION / ${aimMagnification}×`, 'info', 900);
      }
    },
    onDry: () => ui.toast('MAGAZINE EMPTY', 'warning', 800),
    onImpact: (hit) => audio.impact(hit.material ?? hit.kind ?? 'concrete'),
    onLoadError: (error) => console.error('[CLEARWATER] M4A1 load failed', error),
  };
}

function enemyCallbacks() {
  return {
    onPlayerDamage: onEnemyDamage,
    onEnemyDown: (enemy, data = {}) => {
      mission?.enemyDown?.({
        id: data.id ?? enemy?.id,
        name: data.name ?? enemy?.name,
        isRusk: Boolean(data.isRusk ?? enemy?.isRusk),
        headshot: Boolean(data.headshot),
        surrendered: Boolean(data.surrendered ?? enemy?.surrendered),
        nonlethal: Boolean(data.nonlethal),
      });
    },
    onRuskSurrender: () => mission?.ruskSurrender?.(),
    onAlert: (enemy) => {
      audio.enemyAlert();
      const now = performance.now();
      if (now - lastAlertToast > 4200) {
        lastAlertToast = now;
        ui.toast(enemy?.isRusk ? 'RUSK HAS VISUAL' : 'SECURITY ELEMENT ALERTED', 'warning', 1800);
      }
    },
    onShot: (event = {}) => {
      audio.enemyShot(event.distance ?? 15, event.pan ?? 0);
    },
    onOperationalRecaptured: (event = {}) => {
      mission?.retakeOperation?.(event.type, event);
    },
  };
}

async function beginGame(options = ui.getStartOptions()) {
  if (!bootComplete || gameStarted) return;
  difficultyProfile = getDifficultyProfile(options.difficulty);
  difficulty = difficultyProfile.id;
  player?.setDifficulty?.(difficultyProfile);
  enemies?.setDifficulty?.(difficultyProfile);
  applyQuality(options.quality ?? 'high');
  weapon?.setMagnification?.(options.aimMagnification ?? 2);
  const muted = Boolean(options.muted || params.get('mute') === '1');
  audio.setMuted(muted);
  if (!(testMode && muted)) await audio.unlock();
  audio.ambient(true);
  gameStarted = true;
  ui.start({
    health: difficultyProfile.playerHealth,
    maxHealth: difficultyProfile.playerHealth,
    armor: difficultyProfile.startingArmor,
    ammo: 30,
    reserve: 120,
    aimMagnification: weapon?.aimMagnification ?? 2,
  });
  const playRecon = testIntroMode === 'run' || RECON_TEST_TIMES[testIntroMode] != null;

  if (playRecon) {
    // Mission onStart deploys all authored groups synchronously. Only then is
    // the first recon frame presented, so contacts never pop into an active scan.
    startReconIntro(true);
    mission.start();
    updateReconIntro(0);
    if (testMode) {
      player.locked = true;
      player.paused = false;
    } else {
      // Request pointer lock while the Start click still counts as a user
      // gesture; movement and the weapon remain disabled until insertion.
      player.setEnabled(true);
      reconControlPromise = player.lock();
      await reconControlPromise;
      if (reconActive) player.setEnabled(false);
    }
  } else {
    reconGuardPositions = authoredEnemySpawns();
    mission.start();
    safeCall(mission, 'setExpectedHostiles', reconGuardPositions.length || 20);
    safeCall(mission, 'completeRecon');
    placePlayerAtInsertion();
    player.setEnabled(true);
    weapon.setEnabled(true);
  }

  if (testMode && !playRecon) {
    player.locked = true;
    player.paused = false;
    const pose = testPoses[params.get('view')];
    if (pose) {
      player.position.fromArray(pose.position);
      player.velocity.set(0, 0, 0);
      player.yaw = pose.yaw;
      player.pitch = pose.pitch;
    }
    if (testPitch != null) player.pitch = testPitch;
    if (testEnemyWall) {
      const wallEnemy = enemies.enemies?.find((enemy) => enemy.id === 'treatment_door_guard');
      if (wallEnemy) {
        wallEnemy.root.position.set(10.35, 0.11, -10);
        wallEnemy.root.rotation.set(0, Math.PI / 2, 0);
        wallEnemy.alerted = false;
        wallEnemy.state = 'patrol';
      }
    }
    if (testShotTarget) {
      setTimeout(() => {
        const origin = camera.getWorldPosition(new THREE.Vector3());
        const target = safeCall(enemies, 'getAimPoint', testShotTarget, params.get('shotRegion') ?? 'torso');
        if (!target) return;
        const direction = target.sub(origin).normalize();
        handleShot(origin, direction);
      }, 420);
    } else if (testLiveShot) {
      setTimeout(() => {
        const origin = camera.getWorldPosition(new THREE.Vector3());
        const direction = camera.getWorldDirection(new THREE.Vector3());
        const hit = handleShot(origin, direction);
        const diagnostic = safeCall(enemies, 'getLastShotDiagnostic');
        document.body.dataset.qaShotResult = JSON.stringify({
          result: hit?.enemy ? 'enemy' : hit ? 'world' : 'miss',
          enemyId: hit?.enemy?.id ?? null,
          region: hit?.region ?? null,
          diagnostic,
        });
      }, 180);
    }
    if (testDeathReload) {
      weapon.ammo = 0;
      weapon.reserve = Math.max(weapon.magSize, weapon.reserve);
      weapon.reload();
    }
    if (testPlayerDeath) player.applyDamage(1000, { ignoreArmor: true, source: 'qa_hard_failure' });
    else if (testPlayerHealth != null) {
      player.applyDamage(player.maxHealth - testPlayerHealth, {
        ignoreArmor: true,
        source: 'qa_low_health',
      });
    }
    if (['hit', 'down'].includes(testEnemyPose)) {
      const sourcePosition = player.position.clone().add(new THREE.Vector3(0, player.standingEyeHeight ?? 1.62, 0));
      const hits = testEnemyPose === 'down' ? 3 : 1;
      for (let index = 0; index < hits; index += 1) {
        enemies.damage('treatment_door_guard', 36, 'torso', { sourcePosition });
      }
    }
    if (testWeaponPose === 'ads') weapon.handleMouseDown(2);
    if (testWeaponPose === 'fire') {
      // Exercise the real WeaponSystem callback path once for browser QA.
      weapon.handleMouseDown(0);
      setTimeout(() => weapon.handleMouseUp(0), 45);
    }
    if (testWeaponPose === 'reload') {
      weapon.ammo = Math.min(7, weapon.ammo);
      weapon.reload();
    }
    if (['ending', 'planb', 'valve', 'pipe', 'breachsafe', 'fullclear'].includes(params.get('story'))) {
      const story = params.get('story');
      if (story === 'fullclear') {
        for (const enemy of enemies.getSnapshot().enemies) {
          if (enemy.active && !enemy.dead) enemies.damage(enemy.id, 1000, 'torso', {
            sourcePosition: player.position.clone(),
          });
        }
      } else if (story === 'planb') {
        safeCall(mission, 'activatePlanB');
        mission.interact('close_supply_valve');
      } else if (story === 'valve') {
        mission.interact('close_supply_valve');
      } else if (story === 'pipe') {
        safeCall(mission, 'activatePlanB');
        mission.vaultRemaining = 0.01;
        mission.update(1);
        mission.interact('demolish_backdoor_main_pipe');
      } else if (story === 'breachsafe') {
        mission.vaultRemaining = 0.01;
        mission.update(1);
        mission.interact('neutralize_poison');
      } else {
        mission.interact('neutralize_poison');
      }
      mission.defenseRemaining = 0.01;
      mission.update(1);
      if (endingMode) endingElapsed = 12;
    }
  } else if (!playRecon) {
    await player.lock();
  }
}

function bindInput() {
  canvas.addEventListener('mousedown', (event) => {
    if (!gameStarted || endingMode || reconActive) return;
    if (!player.locked) {
      player.lock();
      return;
    }
    weapon.handleMouseDown(event);
  });
  addEventListener('mouseup', (event) => weapon?.handleMouseUp?.(event));
  ui.onStart(() => beginGame());
  ui.onResume(async () => {
    ui.pause(false);
    player.setPaused(false);
    await player.lock();
    weapon.setEnabled(true);
  });
  ui.onRestart(restartWithCurrentDifficulty);
  ui.onReplay(restartWithCurrentDifficulty);
  ui.muteToggle?.addEventListener('change', () => audio.setMuted(ui.muteToggle.checked));
  ui.aimSelect?.addEventListener('change', () => {
    const aimMagnification = weapon?.setMagnification?.(ui.aimSelect.value) ?? Number(ui.aimSelect.value);
    if (gameStarted) ui.setHUD({ aimMagnification });
  });
}

function restartWithCurrentDifficulty() {
  const restartUrl = new URL(location.href);
  restartUrl.searchParams.set('difficulty', difficulty);
  location.assign(restartUrl.href);
}

function showFatal(error) {
  fatalError = error;
  console.error('[CLEARWATER] boot failed', error);
  ui.loading(1, `Initialization failed: ${error?.message ?? error}`);
  const status = document.getElementById('loading-status');
  if (status) {
    status.style.color = '#ff8e7d';
    status.style.maxWidth = '620px';
    status.textContent = `Initialization failed — ${error?.message ?? error}. Open the developer console for details.`;
  }
}

async function boot() {
  try {
    ui.loading(0.04, 'Growing the Ridgewatch landscape…');
    world = await createWorld(scene, renderer);
    if (!world.scene) world.scene = scene;
    ui.loading(0.36, 'Preparing Global Hawk reconnaissance…');
    try {
      await loadGlobalHawk();
    } catch (error) {
      // The tactical scan remains usable even on a browser that cannot start
      // the local Draco worker; never replace the aircraft with fake geometry.
      console.error('[CLEARWATER] local Global Hawk load failed', error);
    }
    ui.loading(0.45, 'Preparing human security teams…');

    enemies = new EnemyDirector(scene, world, enemyCallbacks());
    await enemies.load((progress) => {
      const value = typeof progress === 'number' ? progress : progress?.progress ?? 0.5;
      ui.loading(0.45 + Math.min(1, value) * 0.30, 'Loading skinned human characters…');
    });

    ui.loading(0.79, 'Calibrating service carbine…');
    player = new PlayerController(camera, canvas, world, playerCallbacks());
    weapon = new WeaponSystem(camera, world, weaponCallbacks());
    await weapon.load();
    weapon.setEnabled(false);
    player.setEnabled(false);
    mission = buildMission();

    bindInput();
    bootComplete = true;
    exposeTestAPI();
    ui.loading(1, 'Operation Clearwater ready');
    setTimeout(() => ui.loading(false), testMode ? 10 : 520);

    if (params.get('autostart') === '1') {
      setTimeout(() => beginGame({
        quality: params.get('quality') ?? 'low',
        aimMagnification: Number(params.get('aim') ?? 2),
        difficulty: getDifficultyProfile(params.get('difficulty')).id,
        muted: params.get('mute') === '1',
      }), 50);
    }
  } catch (error) {
    showFatal(error);
  }
}

function exposeTestAPI() {
  globalThis.__CLEARWATER__ = {
    ready: true,
    start: (options) => beginGame(options ?? { quality: 'low', muted: true }),
    snapshot: () => ({
      ready: bootComplete,
      started: gameStarted,
      ending: endingMode,
      endingFailure,
      difficulty,
      quality,
      intro: {
        active: reconActive,
        phase: reconPhase,
        elapsed: reconElapsed,
        hostileCount: reconGuardPositions.length,
        aircraftLoaded: Boolean(globalHawk),
        aircraftForwardAxis: globalHawk?.userData?.forwardAxis ?? null,
        insertion: reconSpawn.clone(),
      },
      camera: {
        fov: camera.fov,
        position: camera.position.clone(),
        pixelRatio: renderer.getPixelRatio(),
      },
      player: player?.getState?.(),
      weapon: weapon?.getState?.(),
      mission: mission?.getState?.(),
      enemies: enemies?.getSnapshot?.() ?? [],
      world: {
        revision: world?.metadata?.revision ?? null,
        fenceContract: world?.fenceContract ?? null,
        reconTargets: world?.reconTargets ?? world?.metadata?.reconTargets ?? [],
      },
    }),
    teleport: (x, y, z) => {
      const point = x?.isVector3 ? x : Array.isArray(x) ? new THREE.Vector3(...x) : new THREE.Vector3(x, y, z);
      player.position.copy(point);
      player.velocity.set(0, 0, 0);
      return player.getState();
    },
    interact: (id) => mission.interact(canonicalInteraction(id ?? mission.getState().interactionId)),
    completeCurrentObjective: () => mission.interact(mission.getState().interactionId),
    finishDefense: () => { mission.defenseRemaining = 0.01; },
    damagePlayer: (amount = 70, options = {}) => player.applyDamage(amount, options),
    downEnemy: (id, amount = 1000) => safeCall(enemies, 'damage', id, amount, 'torso', {
      sourcePosition: player?.position?.clone?.(),
    }),
    accuracyProbe: (distance = 80, difficultyId = difficulty, movementSpeed = 0) => {
      const profile = getDifficultyProfile(difficultyId);
      return safeCall(
        enemies,
        'getAccuracyProbe',
        distance,
        movementSpeed,
        0,
        profile.enemyAccuracyMultiplier,
      );
    },
    surrenderRusk: () => mission.ruskSurrender(),
    spawnGroup,
    probeShot: (origin, direction, applyDamage = false) => {
      const start = vectorFrom(origin, camera.getWorldPosition(new THREE.Vector3()));
      const aim = vectorFrom(direction, camera.getWorldDirection(new THREE.Vector3()));
      if (!start || !aim || aim.lengthSq() < 1e-8) return { result: 'invalid' };
      aim.normalize();
      const hit = applyDamage
        ? handleShot(start, aim)
        : safeCall(enemies, 'raycast', start, aim, 230);
      return {
        result: hit?.enemy ? 'enemy' : hit ? 'world' : 'miss',
        enemyId: hit?.enemy?.id ?? null,
        region: hit?.region ?? null,
        point: hit?.point?.toArray?.() ?? null,
        diagnostic: safeCall(enemies, 'getLastRaycastDiagnostic') ?? null,
      };
    },
    handPose: () => safeCall(weapon?.hands, 'getPoseProbe') ?? null,
    beginCounterattack: (target, options = {}) => safeCall(
      enemies,
      'beginCounterattack',
      vectorFrom(target, player?.position),
      options,
    ),
    introPhase: (phase = 'thermal') => {
      if (!reconActive || RECON_TEST_TIMES[phase] == null) return false;
      reconFreezePhase = phase;
      updateReconIntro(0);
      return true;
    },
    completeIntro: () => {
      reconFreezePhase = null;
      completeReconIntro();
      return !reconActive;
    },
    cameraPose: (position, target) => {
      camera.position.fromArray(position);
      camera.lookAt(new THREE.Vector3().fromArray(target));
      camera.updateMatrixWorld();
    },
    inspectObjects: (pattern = '') => {
      const wanted = String(pattern).toLowerCase();
      const matches = [];
      scene.traverse((object) => {
        if (matches.length >= 40 || !String(object.name).toLowerCase().includes(wanted)) return;
        const bounds = object.isMesh ? new THREE.Box3().setFromObject(object) : null;
        matches.push({
          name: object.name,
          type: object.type,
          visible: object.visible,
          position: object.getWorldPosition(new THREE.Vector3()),
          size: bounds?.getSize(new THREE.Vector3()) ?? null,
          material: object.material?.name ?? null,
          color: object.material?.color?.getHexString?.() ?? null,
        });
      });
      return matches;
    },
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  if (world) safeCall(world, 'update', dt, mission?.getState?.());

  if (bootComplete) {
    if (gameStarted && reconActive && !endingMode) {
      updateReconIntro(dt);
      const heldState = { ...player.getState(), paused: true, enabled: false };
      enemies.update(0, heldState);
      weapon.update(0, heldState);
    } else if (gameStarted && !endingMode) {
      const playerState = player.update(dt);
      const simulationDt = playerState.paused ? 0 : dt;
      const operationalStatus = safeCall(enemies, 'getOperationalStatus');
      if (operationalStatus) safeCall(mission, 'setOperationalPresence', operationalStatus);
      const missionState = mission.update(simulationDt);
      const weaponPlayerState = testWeaponPose === 'sprint'
        ? { ...playerState, moving: true, sprinting: true, grounded: true }
        : playerState;
      // Hold the magazine halfway through its QA-only reload pose so browser
      // snapshots can verify the physical removal/reinsertion animation. A
      // normal launch never sets testWeaponPose and keeps real-time timing.
      if (testWeaponPose === 'reload' && weapon.reloading) {
        weapon.reloadTimer = weapon.reloadDuration * (1 - testReloadProgress);
      }
      const weaponState = weapon.update(dt, weaponPlayerState);
      // QA freeze mode holds authored actors in place so grip/pose
      // screenshots remain deterministic. Normal play always advances AI.
      enemies.update(testFreezeEnemies ? 0 : simulationDt, {
        ...playerState,
        firing: weaponState.firing,
        shotSerial: weaponState.shotSerial,
        shotOrigin: weaponState.shotOrigin,
        weapon: weaponState,
      });
      updateHUD(playerState, weaponState, missionState);

      if (playerState.moving && playerState.grounded && !playerState.paused) {
        footsteps += playerState.speed * dt;
        const stride = playerState.sprinting ? 2.7 : 2.15;
        if (footsteps >= stride) {
          footsteps = 0;
          audio.footstep('concrete', playerState.sprinting ? 1.2 : 0.82);
        }
      }
    } else if (endingMode) {
      if (!endingFailure) mission.update(dt);
      updateEnding(dt);
    } else {
      enemies.update(0, player?.getState?.());
      weapon.update(0, player?.getState?.());
    }
  }

  if (testMode && gameStarted) {
    document.body.dataset.qaAudioState = JSON.stringify(audio.getState());
    const enemyGripProbe = safeCall(enemies, 'getGripProbe', 'treatment_door_guard');
    if (enemyGripProbe) document.body.dataset.qaEnemyGrip = JSON.stringify(enemyGripProbe);
    const playerHandProbe = safeCall(weapon?.hands, 'getPoseProbe');
    if (playerHandProbe) document.body.dataset.qaPlayerHand = JSON.stringify(playerHandProbe);
    const enemyMovementProbe = safeCall(enemies, 'getSnapshot');
    if (enemyMovementProbe) document.body.dataset.qaEnemyMovement = JSON.stringify(enemyMovementProbe);
    const qaAccuracyProfiles = Object.fromEntries(['easy', 'normal', 'hard', 'extreme'].map((id) => {
      const profile = getDifficultyProfile(id);
      return [id, safeCall(enemies, 'getAccuracyProbe', 80, 0, 0, profile.enemyAccuracyMultiplier)];
    }));
    document.body.dataset.qaAccuracyProfiles = JSON.stringify(qaAccuracyProfiles);
    const qaPlayerState = player?.getState?.();
    if (qaPlayerState) document.body.dataset.qaPlayerState = JSON.stringify({
      health: qaPlayerState.health,
      maxHealth: qaPlayerState.maxHealth,
      armor: qaPlayerState.armor,
      difficulty: qaPlayerState.difficulty,
      alive: qaPlayerState.alive,
      mobility: qaPlayerState.mobility,
      lowHealth: qaPlayerState.lowHealth,
      deathProgress: qaPlayerState.deathProgress,
      yaw: qaPlayerState.yaw,
      pitch: qaPlayerState.pitch,
      checkpointYaw: qaPlayerState.checkpointYaw,
      checkpointPitch: qaPlayerState.checkpointPitch,
      cameraY: camera.position.y,
    });
    const qaWeaponState = weapon?.getState?.();
    if (qaWeaponState) document.body.dataset.qaWeaponState = JSON.stringify({
      enabled: qaWeaponState.enabled,
      ammo: qaWeaponState.ammo,
      reserve: qaWeaponState.reserve,
      chambered: qaWeaponState.chambered,
      respawnRecoveries: qaWeaponState.respawnRecoveries,
      lastRespawnRecovery: qaWeaponState.lastRespawnRecovery,
      reloading: qaWeaponState.reloading,
      reloadProgress: qaWeaponState.reloadProgress,
      ads: qaWeaponState.ads,
      wallBlend: qaWeaponState.wallBlend,
      wallDistance: qaWeaponState.wallDistance,
      viewmodelVisible: qaWeaponState.viewmodelVisible,
      handsVisible: qaWeaponState.handsVisible,
      viewPosition: qaWeaponState.viewPosition?.toArray?.() ?? null,
      viewRotation: qaWeaponState.viewRotation
        ? [qaWeaponState.viewRotation.x, qaWeaponState.viewRotation.y, qaWeaponState.viewRotation.z]
        : null,
      poseMode: qaWeaponState.poseMode,
      posePositionError: qaWeaponState.posePositionError,
      poseAngularError: qaWeaponState.poseAngularError,
      viewBounds: (() => {
        const bounds = safeCall(weapon, 'getViewmodelCameraBounds');
        return bounds ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null;
      })(),
    });
    const qaMissionState = mission?.getState?.();
    if (qaMissionState) document.body.dataset.qaMissionState = JSON.stringify({
      complete: qaMissionState.complete,
      stage: qaMissionState.stage,
      remainingHostiles: qaMissionState.remainingHostiles,
      siteCleared: qaMissionState.flags?.siteCleared,
      outcome: qaMissionState.outcome,
      reason: qaMissionState.snapshots?.at?.(-1)?.reason ?? null,
    });
  }

  renderer.render(scene, camera);
}

boot();
requestAnimationFrame(frame);
