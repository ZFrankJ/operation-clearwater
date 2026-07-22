import * as THREE from 'three';
import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from '../vendor/three/examples/jsm/utils/SkeletonUtils.js';

const CHARACTER_URL = new URL('../assets/models/characters/security-male.fbx', import.meta.url).href;
const IDLE_URL = new URL('../assets/models/characters/security-idle.fbx', import.meta.url).href;
const WALK_URL = new URL('../assets/models/characters/security-walk.fbx', import.meta.url).href;
const RUN_URL = new URL('../assets/models/characters/security-run.fbx', import.meta.url).href;
// Enemies use the exact same CC0/PBR rifle source as the player. The rendered
// geometry, scale, grip spacing and material response therefore share one
// reference instead of trying to imitate the viewmodel with an archived asset.
const WEAPON_URL = new URL('../assets/models/weapons/m4a1-pbr.fbx', import.meta.url).href;
const WEAPON_BASE_COLOR_URL = new URL('../assets/models/weapons/M4A1_Base_Color.png', import.meta.url).href;
const WEAPON_HEIGHT_URL = new URL('../assets/models/weapons/M4A1_Height.png', import.meta.url).href;
const WEAPON_METALLIC_URL = new URL('../assets/models/weapons/M4A1_Metallic.png', import.meta.url).href;
const WEAPON_NORMAL_URL = new URL('../assets/models/weapons/M4A1_Normal.png', import.meta.url).href;
const WEAPON_ROUGHNESS_URL = new URL('../assets/models/weapons/M4A1_Roughness.png', import.meta.url).href;
const TEXTURE_ROOT = new URL('../assets/models/characters/', import.meta.url);

const CHARACTER_TEXTURES = Object.freeze({
  body: ['m171_body_color.jpg', 'm171_body_normal.jpg', 'm171_body_specular.jpg'],
  head: ['m171_head_color.jpg', 'm171_head_normal.jpg', 'm171_head_specular.jpg'],
  equipment: ['m171_equipment_color.jpg', 'm171_equipment_normal.jpg', 'm171_equipment_specular.jpg'],
});

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
// Enemy rifles point along +Z. Their Rocketbox hands use the same anatomical
// contract as the first-person arms: the firing hand follows its live forearm,
// and the palm rolls around that axis toward the weapon.
const ENEMY_FIRING_HAND_AXIS = new THREE.Vector3(0, 0, 1);
const ENEMY_FIRING_PALM_NORMAL = new THREE.Vector3(0, 0, -1);
const ENEMY_FIRING_HAND_TILT = THREE.MathUtils.degToRad(-7);
const ENEMY_SUPPORT_HAND_AXIS = new THREE.Vector3(0, 0.25, 0.968);
const ENEMY_SUPPORT_PALM_NORMAL = new THREE.Vector3(-1, 0, 0);
const ENEMY_FINGER_CURL = Object.freeze({
  right: Object.freeze({
    0: Object.freeze([0.2, 0.48, 0.54]),
    1: Object.freeze([0.64, 0.1, 0.16]),
    2: Object.freeze([0.7, 0.5, 0.45]),
    3: Object.freeze([0.7, 0.5, 0.45]),
    4: Object.freeze([0.7, 0.5, 0.45]),
  }),
  left: Object.freeze({
    0: Object.freeze([0.24, 0.55, 0.6]),
    1: Object.freeze([0.56, 0.68, 0.62]),
    2: Object.freeze([0.64, 0.76, 0.7]),
    3: Object.freeze([0.7, 0.82, 0.74]),
    4: Object.freeze([0.76, 0.88, 0.8]),
  }),
});
const BODY_HEIGHT = 1.8;
const BODY_RADIUS = 0.39;
const BODY_SKIN = 0.04;
const BODY_STEP_HEIGHT = 0.34;
const DEFAULT_TORSO_DAMAGE = 34;
const MAX_FRAME_STEP = 0.075;
const SIGHT_RANGE = 54;
const ALERTED_SIGHT_RANGE = 110;
const ENEMY_BALLISTIC_RANGE = 140;
const BASE_SHOT_SPREAD = 0.0036;
const RANGE_SPREAD_START = 18;
const RANGE_SPREAD_PER_METER = 0.000025;
const MAX_RANGE_SPREAD = 0.0014;
const MOVEMENT_SPREAD_PER_MPS = 0.00018;
const MAX_MOVEMENT_SPREAD = 0.0014;
const SUPPRESSION_SPREAD = 0.012;
const HEARING_RANGE = 52;
const FOV_COSINE = Math.cos(THREE.MathUtils.degToRad(72));
const ALERTED_FOV_COSINE = Math.cos(THREE.MathUtils.degToRad(150));
const FIRE_LANE_FAILURE_LIMIT = 3;
const LOST_LOS_COVER_GRACE = 0.58;
const EXTERIOR_SECURITY_GROUPS = new Set(['intake', 'filter']);
const OPERATION_RADIUS = 1.35;
const OPERATOR_REPLACEMENT_RANGE = 34;
const CASUALTY_ALERT_RANGE = 58;
const CASUALTY_IMMEDIATE_RANGE = 22;
const FALLEN_BODY_LENGTH = 1.72;
const FALLEN_BODY_RADIUS = 0.26;
const FALLEN_BODY_HEIGHT = 0.52;
const FALLEN_BODY_SURFACE_CLEARANCE = 0.16;
const WEAPON_WALL_RETRACT = 0.72;
const WEAPON_WALL_LOWER = 0.18;
const WEAPON_VISUAL_REACH = 0.9;
const LOW_VAULT_MAX_HEIGHT = 1.18;
const LOW_VAULT_MAX_DEPTH = 1.5;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function asVector3(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) {
    return new THREE.Vector3(finite(value[0]), finite(value[1]), finite(value[2]));
  }
  if (value?.position && value.position !== value) return asVector3(value.position, fallback);
  if (value && Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) && Number.isFinite(Number(value.z))) {
    return new THREE.Vector3(Number(value.x), Number(value.y), Number(value.z));
  }
  return fallback?.clone?.() ?? null;
}

function hashString(value) {
  // Keep the original null-seed hash so a branding-only rename cannot change
  // deterministic encounter behavior for callers that omit a seed.
  if (value == null) return 0xa6a90a3b;
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const a = Math.max(1e-6, random());
  const b = random();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(Math.PI * 2 * b);
}

function collectionForGroup(source, groupId) {
  if (!source) return null;
  if (source instanceof Map) return source.get(groupId) ?? source.get('all') ?? null;
  if (Array.isArray(source)) {
    const filtered = source.filter((entry) => {
      const key = entry?.group ?? entry?.groupId ?? entry?.zone ?? entry?.stage;
      return key == null || String(key) === String(groupId);
    });
    return filtered.length ? filtered : null;
  }
  if (typeof source === 'object') {
    return source[groupId] ?? source.groups?.[groupId] ?? source.all ?? null;
  }
  return null;
}

function plainVector(vector) {
  return vector ? { x: vector.x, y: vector.y, z: vector.z } : null;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp01(value), 3);
}

/**
 * Authored, human-scale enemy encounters for Operation Clearwater. The world supplies all
 * spatial decisions (spawn routes, cover, collision and ballistic blockers);
 * this director supplies perception, animation, combat and damage state.
 */
export class EnemyDirector {
  constructor(scene, world = {}, callbacks = {}) {
    if (!scene?.isScene && !scene?.isObject3D) {
      throw new TypeError('EnemyDirector requires a THREE scene or Object3D.');
    }

    this.scene = scene;
    this.world = world ?? {};
    this.callbacks = callbacks ?? {};
    this.root = new THREE.Group();
    this.root.name = 'CLEARWATER_EnemyDirector';
    this.root.userData.noHit = true;
    scene.add(this.root);

    this.loaded = false;
    this.loadingPromise = null;
    this.disposed = false;
    this.characterTemplate = null;
    this.weaponTemplate = null;
    this.characterScale = 1;
    this.clips = {};
    this.sharedMaterials = [];
    this.ownedTextures = [];

    this.enemies = [];
    this.enemyById = new Map();
    this.spawnedGroups = new Map();
    this.hitProxies = [];
    this.proxyData = new WeakMap();
    this.damageMeshes = [];
    this.damageMeshData = new WeakMap();
    this.coverReservations = new Map();
    this.operationalSites = new Map([
      ['poison', { type: 'poison', position: null, facing: null, operatorId: null }],
      ['vault', { type: 'vault', position: null, facing: null, operatorId: null }],
    ]);
    this.operationCoordinationTimer = 0;
    this.facilityAlerted = false;
    this.facilityAlertCount = 0;
    this.facilityAlertPosition = new THREE.Vector3();
    this.facilityAlertReason = null;
    // The director remains neutral until beginGame applies the selected
    // profile; the actual menu/default route resolves to Normal.
    this.difficulty = 'easy';
    this.enemyHealthMultiplier = 1;
    this.enemyAccuracyMultiplier = 1.2;
    this.concealedVests = false;
    this.tracers = [];
    this.elapsed = 0;
    this.nextId = 1;
    // Weapon shot serials start at zero. Matching that baseline prevents the
    // first idle gameplay frame from being mistaken for a gunshot at (0,0,0).
    this.lastNoiseToken = 0;
    this.playerWasFiring = false;
    this.movementNoiseTimer = 0;
    this.raycastSerial = 0;
    this.lastRaycastDiagnostic = null;
    this.lastDamageDiagnostic = null;
    this.pendingDamageRaycast = null;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0.02;
    this.worldRaycaster = new THREE.Raycaster();
    this.worldRaycaster.near = 0.02;
    this.headGeometry = new THREE.SphereGeometry(0.19, 12, 8);
    this.torsoGeometry = new THREE.BoxGeometry(0.58, 0.86, 0.42);
    this.armProxyGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1, 8, 1);
    this.weaponProxyGeometry = new THREE.BoxGeometry(0.18, 0.26, 0.82);
    // The old target only covered y=.73..1.86, leaving the entire visible
    // lower 40% of a standing/patrolling guard immune to bullets.  A player
    // approaching unseen usually sees legs below cover first, so an accurately
    // placed pre-alert shot appeared to pass straight through the character.
    this.lowerBodyGeometry = new THREE.BoxGeometry(0.5, 0.84, 0.38);
    this.proxyMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.tracerMaterial = new THREE.LineBasicMaterial({
      color: 0xffc56d,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._basisX = new THREE.Vector3();
    this._basisY = new THREE.Vector3();
    this._basisZ = new THREE.Vector3();
    this._basisMatrix = new THREE.Matrix4();
    this._desiredQuaternion = new THREE.Quaternion();
    this._parentQuaternion = new THREE.Quaternion();
    this._rollQuaternion = new THREE.Quaternion();
    this._fingerQuaternion = new THREE.Quaternion();
    this._fingerDesiredQuaternion = new THREE.Quaternion();
  }

  async load(onProgress = null) {
    if (this.disposed) throw new Error('EnemyDirector has been disposed.');
    if (this.loaded) return this;
    if (this.loadingPromise) return this.loadingPromise;

    const manager = new THREE.LoadingManager();
    const fbxLoader = new FBXLoader(manager);
    const textureLoader = new THREE.TextureLoader(manager);
    const jobs = [
      ['character', fbxLoader, CHARACTER_URL],
      ['idle', fbxLoader, IDLE_URL],
      ['walk', fbxLoader, WALK_URL],
      ['run', fbxLoader, RUN_URL],
      ['weapon', fbxLoader, WEAPON_URL],
      ['weapon-base', textureLoader, WEAPON_BASE_COLOR_URL],
      ['weapon-height', textureLoader, WEAPON_HEIGHT_URL],
      ['weapon-metallic', textureLoader, WEAPON_METALLIC_URL],
      ['weapon-normal', textureLoader, WEAPON_NORMAL_URL],
      ['weapon-roughness', textureLoader, WEAPON_ROUGHNESS_URL],
    ];
    for (const [part, files] of Object.entries(CHARACTER_TEXTURES)) {
      files.forEach((file, index) => {
        jobs.push([`${part}-${['color', 'normal', 'specular'][index]}`, textureLoader, new URL(file, TEXTURE_ROOT).href]);
      });
    }

    const partial = new Array(jobs.length).fill(0);
    const report = (index, ratio, label) => {
      partial[index] = clamp01(ratio);
      const progress = partial.reduce((sum, value) => sum + value, 0) / partial.length;
      if (typeof onProgress === 'function') onProgress(progress, label);
    };
    const loadOne = ([label, loader, url], index) => new Promise((resolve, reject) => {
      loader.load(
        url,
        (asset) => {
          report(index, 1, label);
          resolve(asset);
        },
        (event) => {
          if (event?.lengthComputable && event.total > 0) report(index, event.loaded / event.total, label);
        },
        reject,
      );
    });

    this.loadingPromise = Promise.all(jobs.map(loadOne)).then((assets) => {
      if (this.disposed) throw new Error('EnemyDirector was disposed while loading.');
      const byName = Object.fromEntries(jobs.map((job, index) => [job[0], assets[index]]));
      this._prepareCharacter(byName);
      this._prepareWeapon(byName.weapon, {
        baseColor: byName['weapon-base'],
        height: byName['weapon-height'],
        metallic: byName['weapon-metallic'],
        normal: byName['weapon-normal'],
        roughness: byName['weapon-roughness'],
      });
      this.loaded = true;
      if (typeof onProgress === 'function') onProgress(1, 'ready');
      return this;
    }).catch((error) => {
      this.loadingPromise = null;
      this._emit('onLoadError', error);
      throw error;
    });

    return this.loadingPromise;
  }

  spawnGroup(group) {
    if (!this.loaded || this.disposed) return [];
    const spec = typeof group === 'object' && group ? group : { id: group };
    const groupId = String(spec.id ?? spec.group ?? spec.groupId ?? spec.zone ?? 'default');
    if (this.spawnedGroups.has(groupId)) {
      return this.spawnedGroups.get(groupId).map((id) => this.enemyById.get(id)).filter(Boolean);
    }

    const authored = spec.spawns ?? spec.points ?? this._getSpawnPoints(groupId);
    const points = Array.isArray(authored) ? authored : authored ? [authored] : [];
    const requested = Number.isFinite(Number(spec.count)) ? Math.max(0, Math.floor(spec.count)) : points.length;
    const spawned = [];
    for (const point of points.slice(0, requested || points.length)) {
      const position = asVector3(point?.position ?? point);
      if (!position) continue;
      spawned.push(this._spawnEnemy(groupId, point, position, spec));
    }
    this.spawnedGroups.set(groupId, spawned.map((enemy) => enemy.id));
    return spawned;
  }

  setDifficulty(profile = {}) {
    const previousMultiplier = Math.max(0.01, finite(this.enemyHealthMultiplier, 1));
    this.difficulty = String(profile.id ?? 'normal');
    this.enemyHealthMultiplier = Math.max(0.1, finite(profile.enemyHealthMultiplier, 1));
    this.enemyAccuracyMultiplier = THREE.MathUtils.clamp(
      finite(profile.enemyAccuracyMultiplier, 0.92),
      0.2,
      2,
    );
    this.concealedVests = Boolean(profile.concealedVests);
    for (const enemy of this.enemies) {
      const healthRatio = enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 1;
      enemy.baseMaxHealth = Math.max(1, finite(
        enemy.baseMaxHealth,
        enemy.maxHealth / previousMultiplier,
      ));
      enemy.maxHealth = enemy.baseMaxHealth * this.enemyHealthMultiplier;
      if (!enemy.dead) enemy.health = THREE.MathUtils.clamp(enemy.maxHealth * healthRatio, 1, enemy.maxHealth);
      enemy.concealedVest = this.concealedVests;
    }
    return {
      id: this.difficulty,
      enemyHealthMultiplier: this.enemyHealthMultiplier,
      enemyAccuracyMultiplier: this.enemyAccuracyMultiplier,
      concealedVests: this.concealedVests,
    };
  }

  getAccuracyProbe(
    distance = 60,
    movementSpeed = 0,
    suppression = 0,
    multiplier = this.enemyAccuracyMultiplier,
  ) {
    const shotDistance = Math.max(0, finite(distance, 60));
    const angularSpread = this._shotSpread(
      shotDistance,
      movementSpeed,
      suppression,
      multiplier,
    );
    return {
      difficulty: this.difficulty,
      distance: shotDistance,
      multiplier,
      angularSpread,
      horizontalSigma: shotDistance * angularSpread,
      verticalSigma: shotDistance * angularSpread * 0.72,
      ballisticRange: ENEMY_BALLISTIC_RANGE,
    };
  }

  /**
   * Commit remaining guards to a deterministic, staggered assault on a world
   * position. Guards with live LOS break staging to aim/fire; otherwise each
   * wave physically advances toward the supplied objective.
   */
  beginCounterattack(targetValue, options = {}) {
    const target = asVector3(targetValue);
    if (!target || this.disposed) return [];
    const group = options.group == null ? null : String(options.group);
    const waveSize = Math.max(1, Math.floor(finite(options.waveSize, 3)));
    const waveInterval = Math.max(0.2, finite(options.waveInterval, 1.15));
    const withinWaveStagger = Math.max(0, finite(options.stagger, 0.16));
    const eligible = this.enemies
      .filter((enemy) => (
        enemy.active && !enemy.dead && !enemy.surrendered && !enemy.technician &&
        (group == null || enemy.group === group)
      ))
      .sort((a, b) => (
        a.root.position.distanceToSquared(target) - b.root.position.distanceToSquared(target) ||
        String(a.id).localeCompare(String(b.id))
      ));

    if (eligible[0]) this._raiseLocalAlert(eligible[0], target, 'counterattack');

    const committed = eligible.map((enemy, index) => {
      const wave = Math.floor(index / waveSize);
      const slot = index % waveSize;
      const delay = wave * waveInterval + slot * withinWaveStagger;
      enemy.alerted = true;
      enemy.pendingAlert = null;
      enemy.reaction = 0;
      enemy.lastKnownPlayer.copy(target);
      enemy.assaultTarget = target.clone();
      enemy.assaultActive = true;
      enemy.assaultDelay = delay;
      this._releaseCover(enemy);
      this._setState(enemy, 'investigate');
      enemy.lastCombatAction = delay > 0 ? 'counterattack_staging' : 'counterattack_advance';
      return { enemy, id: enemy.id, wave, delay };
    });
    this._emit('onCounterattack', {
      target: target.clone(),
      count: committed.length,
      waves: committed.length ? Math.ceil(committed.length / waveSize) : 0,
      committed,
    });
    return committed;
  }

  update(dt, playerState = {}) {
    if (!this.loaded || this.disposed) return;
    const seconds = THREE.MathUtils.clamp(finite(dt), 0, MAX_FRAME_STEP);
    this.elapsed += seconds;
    this._updateTracers(seconds);

    const feet = asVector3(playerState.feetPosition ?? playerState.position);
    let playerEye = asVector3(playerState.eyePosition ?? playerState.camera?.position);
    if (!playerEye && feet) playerEye = feet.clone().add(new THREE.Vector3(0, playerState.crouched ? 1.02 : 1.62, 0));
    const playerVelocity = asVector3(playerState.velocity, new THREE.Vector3()) ?? new THREE.Vector3();
    const active = Boolean(feet && playerEye && playerState.alive !== false && !playerState.paused);

    if (active) this._ingestPlayerNoise(playerState, playerEye, seconds);
    if (seconds > 0) {
      this.operationCoordinationTimer -= seconds;
      if (this.operationCoordinationTimer <= 0) {
        this.operationCoordinationTimer = 0.18;
        this._coordinateOperationalSites();
      }
    }
    for (const enemy of this.enemies) {
      enemy.mixer.update(seconds);
      if (enemy.dead) {
        this._updateDeath(enemy, seconds);
        continue;
      }
      if (enemy.surrendered) {
        this._updateSurrender(enemy, seconds);
        continue;
      }
      if (!active || seconds <= 0) {
        this._setMotion(enemy, 'idle');
        this._updateCombatPose(enemy, seconds, null);
        this._updateHitProxies(enemy);
        continue;
      }
      // State logic must opt into movement each frame. This stays true even
      // when collision handling selects the idle animation, allowing the
      // progress watchdog to catch a guard turning or bracing in one place.
      enemy.movementIntent = false;
      this._updateEnemy(enemy, seconds, playerEye, feet, playerVelocity, playerState);
      this._watchMovementProgress(enemy, seconds);
      // AnimationMixer owns locomotion; the procedural pass runs afterwards so
      // its two-hand rifle pose cannot be overwritten by the unarmed FBX clip.
      this._updateCombatPose(enemy, seconds, playerEye);
      this._updateHitProxies(enemy);
    }
  }

  raycast(origin, direction, maxDistance = 230) {
    const serial = ++this.raycastSerial;
    this.pendingDamageRaycast = null;
    const requestedDistance = Math.max(0, finite(maxDistance, 230));
    if (!this.loaded || this.disposed) {
      this.lastRaycastDiagnostic = {
        serial,
        accepted: false,
        result: 'rejected',
        reason: this.disposed ? 'director_disposed' : 'director_not_loaded',
        enemyId: null,
        region: null,
        distance: null,
        requestedDistance,
        proxyHits: 0,
        rejectedProxyHits: 0,
        worldDistance: null,
        permeableWorldHitIgnored: false,
        damageAccepted: null,
      };
      return null;
    }
    const start = asVector3(origin);
    const dir = asVector3(direction);
    if (!start || !dir || dir.lengthSq() < 1e-8) {
      this.lastRaycastDiagnostic = {
        serial,
        accepted: false,
        result: 'rejected',
        reason: !start ? 'invalid_origin' : 'invalid_direction',
        enemyId: null,
        region: null,
        distance: null,
        requestedDistance,
        proxyHits: 0,
        rejectedProxyHits: 0,
        worldDistance: null,
        permeableWorldHitIgnored: false,
        damageAccepted: null,
      };
      return null;
    }
    dir.normalize();

    let far = requestedDistance;
    const worldHit = this._raycastWorld(start, dir, far);
    // Treat explicitly permeable fencing as non-ballistic even if an alternate
    // world implementation accidentally returns its visual/collider as the
    // nearest hit. The Clearwater world already observes this contract; this
    // defensive check keeps combat correct for both direct and fallback users.
    const broadPhaseWorldHit = this._isBallisticPermeableHit(worldHit) ? null : worldHit;
    const refinedWorld = this._refineWorldOcclusion(start, dir, broadPhaseWorldHit, requestedDistance);
    const blockingWorldHit = refinedWorld.hit;
    if (blockingWorldHit?.distance != null) {
      far = Math.min(far, Math.max(0, blockingWorldHit.distance - 0.015));
    }
    // A shot may land between simulation updates (including the first playable
    // frame). Refresh every live proxy from the current animated skeleton before
    // intersecting so patrol, cover and aim poses never leave stale targets.
    this.root.updateMatrixWorld(true);
    for (const enemy of this.enemies) this._updateHitProxies(enemy);
    this.root.updateMatrixWorld(true);
    this.raycaster.set(start, dir);
    this.raycaster.far = far;
    const hits = this.raycaster.intersectObjects(this.hitProxies, false);
    const hasWorldBallisticRaycast = typeof this.world?.raycastWorld === 'function';
    const rejectedProxies = [];
    for (const hit of hits) {
      const data = this.proxyData.get(hit.object);
      if (!data) {
        rejectedProxies.push({ enemyId: null, region: null, reason: 'unmapped_proxy', distance: hit.distance });
        continue;
      }
      if (data.enemy.dead || data.enemy.surrendered || !data.enemy.active) {
        const reason = data.enemy.dead
          ? 'enemy_dead'
          : data.enemy.surrendered ? 'enemy_surrendered' : 'enemy_inactive';
        rejectedProxies.push({ enemyId: data.enemy.id, region: data.region, reason, distance: hit.distance });
        continue;
      }
      // raycastWorld already shortened `far` to the first solid ballistic
      // surface. A second segmentBlocked query was redundant and could disagree
      // on chain-link, converting a valid proxy hit into a false miss.
      // Retain segmentBlocked only for legacy worlds that provide no ballistic
      // raycast at all.
      if (!hasWorldBallisticRaycast && this._segmentBlocked(start, hit.point)) {
        rejectedProxies.push({
          enemyId: data.enemy.id,
          region: data.region,
          reason: 'legacy_segment_blocked',
          distance: hit.distance,
        });
        continue;
      }
      const result = {
        ...hit,
        enemy: data.enemy,
        region: data.region,
        headshot: data.region === 'head',
      };
      this.lastRaycastDiagnostic = {
        serial,
        accepted: true,
        result: 'enemy',
        reason: 'live_enemy_proxy_hit',
        enemyId: data.enemy.id,
        region: data.region,
        distance: hit.distance,
        requestedDistance,
        proxyHits: hits.length,
        rejectedProxyHits: rejectedProxies.length,
        rejectedProxies,
        worldDistance: blockingWorldHit?.distance ?? null,
        worldBroadPhaseDistance: broadPhaseWorldHit?.distance ?? null,
        worldBroadPhaseRejected: refinedWorld.rejected,
        permeableWorldHitIgnored: Boolean(worldHit && !broadPhaseWorldHit),
        enemyState: data.enemy.state,
        enemyAlerted: Boolean(data.enemy.alerted),
        enemyHasLOS: Boolean(data.enemy.hasLOS),
        enemyHasFired: Boolean(data.enemy.hasFired),
        technician: Boolean(data.enemy.technician),
        damageAccepted: null,
      };
      this.pendingDamageRaycast = { serial, enemy: data.enemy };
      return result;
    }
    // Resolve the actual rendered hostile triangles as well as the analytic
    // volumes. This makes the visible uniform, gloves and rifle authoritative:
    // if the player can put the reticle on a hostile triangle, it cannot fall
    // through to a yellow world decal. A small collider tolerance recovers
    // actors authored flush against a doorway without allowing wall shots.
    const visibleFar = blockingWorldHit?.distance != null
      ? Math.min(requestedDistance, blockingWorldHit.distance + 0.32)
      : requestedDistance;
    this.raycaster.far = visibleFar;
    const renderedHits = this.raycaster.intersectObjects(this.damageMeshes, false);
    for (const hit of renderedHits) {
      const data = this.damageMeshData.get(hit.object);
      if (!data?.enemy?.active || data.enemy.dead || data.enemy.surrendered) continue;
      const result = {
        ...hit,
        enemy: data.enemy,
        region: data.region,
        headshot: false,
        renderedMeshHit: true,
      };
      this.lastRaycastDiagnostic = {
        serial,
        accepted: true,
        result: 'enemy',
        reason: 'live_enemy_render_mesh_hit',
        enemyId: data.enemy.id,
        region: data.region,
        distance: hit.distance,
        requestedDistance,
        proxyHits: hits.length,
        renderedMeshHits: renderedHits.length,
        rejectedProxyHits: rejectedProxies.length,
        rejectedProxies,
        worldDistance: blockingWorldHit?.distance ?? null,
        worldBroadPhaseDistance: broadPhaseWorldHit?.distance ?? null,
        worldBroadPhaseRejected: refinedWorld.rejected,
        worldColliderId: blockingWorldHit?.collider?.id ?? blockingWorldHit?.object?.name ?? null,
        permeableWorldHitIgnored: Boolean(worldHit && !broadPhaseWorldHit),
        enemyState: data.enemy.state,
        enemyAlerted: Boolean(data.enemy.alerted),
        enemyHasLOS: Boolean(data.enemy.hasLOS),
        enemyHasFired: Boolean(data.enemy.hasFired),
        technician: Boolean(data.enemy.technician),
        damageAccepted: null,
      };
      this.pendingDamageRaycast = { serial, enemy: data.enemy };
      return result;
    }
    // A patrol silhouette contains small gaps between skinned clothing, hands,
    // weapon and the analytic proxies. At range, normal weapon spread could
    // pass through one of those gaps and make an unaware guard appear immune
    // until he moved into an attack pose. Use one state-independent capsule
    // fallback around the visible standing body, still clipped by `far` so a
    // wall always wins. Alert, LOS, reaction and hasFired are never consulted.
    const silhouetteHit = this._raycastEnemySilhouettes(start, dir, visibleFar);
    if (silhouetteHit) {
      const enemy = silhouetteHit.enemy;
      this.lastRaycastDiagnostic = {
        serial,
        accepted: true,
        result: 'enemy',
        reason: 'live_enemy_silhouette_fallback',
        enemyId: enemy.id,
        region: silhouetteHit.region,
        distance: silhouetteHit.distance,
        requestedDistance,
        proxyHits: hits.length,
        rejectedProxyHits: rejectedProxies.length,
        rejectedProxies,
        worldDistance: blockingWorldHit?.distance ?? null,
        worldBroadPhaseDistance: broadPhaseWorldHit?.distance ?? null,
        worldBroadPhaseRejected: refinedWorld.rejected,
        worldColliderId: blockingWorldHit?.collider?.id ?? blockingWorldHit?.object?.name ?? null,
        permeableWorldHitIgnored: Boolean(worldHit && !broadPhaseWorldHit),
        enemyState: enemy.state,
        enemyAlerted: Boolean(enemy.alerted),
        enemyHasLOS: Boolean(enemy.hasLOS),
        enemyHasFired: Boolean(enemy.hasFired),
        technician: Boolean(enemy.technician),
        damageAccepted: null,
      };
      this.pendingDamageRaycast = { serial, enemy };
      return silhouetteHit;
    }
    this.lastRaycastDiagnostic = {
      serial,
      accepted: false,
      result: blockingWorldHit ? 'world_blocked' : 'miss',
      reason: blockingWorldHit
        ? 'solid_world_occlusion'
        : rejectedProxies[0]?.reason ?? 'no_enemy_proxy_intersection',
      enemyId: null,
      region: null,
      distance: null,
      requestedDistance,
      proxyHits: hits.length,
      rejectedProxyHits: rejectedProxies.length,
      rejectedProxies,
      worldDistance: blockingWorldHit?.distance ?? null,
      worldBroadPhaseDistance: broadPhaseWorldHit?.distance ?? null,
      worldBroadPhaseRejected: refinedWorld.rejected,
      worldColliderId: blockingWorldHit?.collider?.id ?? blockingWorldHit?.object?.name ?? null,
      permeableWorldHitIgnored: Boolean(worldHit && !broadPhaseWorldHit),
      damageAccepted: null,
    };
    return null;
  }

  getLastRaycastDiagnostic() {
    if (!this.lastRaycastDiagnostic) return null;
    return {
      ...this.lastRaycastDiagnostic,
      rejectedProxies: this.lastRaycastDiagnostic.rejectedProxies?.map((entry) => ({ ...entry })) ?? [],
    };
  }

  _raycastEnemySilhouettes(start, direction, far) {
    const ray = new THREE.Ray(start, direction);
    const segmentStart = new THREE.Vector3();
    const segmentEnd = new THREE.Vector3();
    const pointOnRay = new THREE.Vector3();
    const pointOnBody = new THREE.Vector3();
    let nearest = null;
    for (const enemy of this.enemies) {
      if (!enemy.active || enemy.dead || enemy.surrendered) continue;
      enemy.root.updateWorldMatrix(true, false);
      segmentStart.set(0, 0.18, 0);
      segmentEnd.set(0, 1.62, 0);
      enemy.root.localToWorld(segmentStart);
      enemy.root.localToWorld(segmentEnd);
      const distanceSq = ray.distanceSqToSegment(segmentStart, segmentEnd, pointOnRay, pointOnBody);
      if (distanceSq > 0.48 * 0.48) continue;
      const distance = start.distanceTo(pointOnRay);
      if (distance < this.raycaster.near || distance > far) continue;
      if (nearest && nearest.distance <= distance) continue;
      const normal = pointOnRay.clone().sub(pointOnBody);
      if (normal.lengthSq() < 1e-7) normal.copy(direction).negate();
      else normal.normalize();
      nearest = {
        distance,
        point: pointOnRay.clone(),
        normal,
        object: enemy.torsoProxy,
        enemy,
        region: 'torso',
        headshot: false,
        silhouetteFallback: true,
      };
    }
    return nearest;
  }

  getLastDamageDiagnostic() {
    return this.lastDamageDiagnostic ? { ...this.lastDamageDiagnostic } : null;
  }

  getLastShotDiagnostic() {
    return {
      raycast: this.getLastRaycastDiagnostic(),
      damage: this.getLastDamageDiagnostic(),
    };
  }

  _recordDamageDiagnostic(diagnostic, enemy = null) {
    const matchingRaycast = Boolean(
      enemy &&
      this.pendingDamageRaycast?.enemy === enemy &&
      this.lastRaycastDiagnostic?.serial === this.pendingDamageRaycast.serial
    );
    this.lastDamageDiagnostic = {
      ...diagnostic,
      raycastSerial: matchingRaycast ? this.pendingDamageRaycast.serial : null,
    };
    if (
      matchingRaycast &&
      this.lastRaycastDiagnostic?.accepted
    ) {
      Object.assign(this.lastRaycastDiagnostic, {
        damageAccepted: diagnostic.accepted,
        damageReason: diagnostic.reason,
        requestedDamage: diagnostic.requestedDamage,
        appliedDamage: diagnostic.appliedDamage,
        healthBefore: diagnostic.healthBefore,
        healthAfter: diagnostic.healthAfter,
        killed: diagnostic.killed,
      });
    }
    this.pendingDamageRaycast = null;
  }

  damage(target, amount = DEFAULT_TORSO_DAMAGE, region = 'torso', context = {}) {
    const requestedRegion = String(target?.region ?? region ?? 'torso').toLowerCase();
    const hitRegion = requestedRegion === 'head' ? 'head' : requestedRegion === 'limb' ? 'limb' : 'torso';
    const raw = Math.max(0, finite(amount, DEFAULT_TORSO_DAMAGE));
    if (this.disposed) {
      const diagnostic = {
        accepted: false,
        reason: 'director_disposed',
        enemyId: null,
        region: hitRegion,
        requestedDamage: raw,
        appliedDamage: 0,
        healthBefore: null,
        healthAfter: null,
        killed: false,
      };
      this._recordDamageDiagnostic(diagnostic);
      return { hit: false, accepted: false, killed: false, reason: diagnostic.reason };
    }
    const enemy = this._resolveEnemy(target);
    if (!enemy || enemy.dead || enemy.surrendered || !enemy.active) {
      const reason = !enemy
        ? 'enemy_not_resolved'
        : enemy.dead ? 'enemy_dead' : enemy.surrendered ? 'enemy_surrendered' : 'enemy_inactive';
      const diagnostic = {
        accepted: false,
        reason,
        enemyId: enemy?.id ?? null,
        region: hitRegion,
        requestedDamage: raw,
        appliedDamage: 0,
        healthBefore: enemy?.health ?? null,
        healthAfter: enemy?.health ?? null,
        killed: Boolean(enemy?.dead),
      };
      this._recordDamageDiagnostic(diagnostic, enemy);
      return { hit: false, accepted: false, killed: false, reason, enemy: enemy ?? null };
    }
    if (raw <= 0) {
      const diagnostic = {
        accepted: false,
        reason: 'non_positive_damage',
        enemyId: enemy.id,
        region: hitRegion,
        requestedDamage: raw,
        appliedDamage: 0,
        healthBefore: enemy.health,
        healthAfter: enemy.health,
        killed: false,
      };
      this._recordDamageDiagnostic(diagnostic, enemy);
      return { hit: false, accepted: false, killed: false, reason: diagnostic.reason, enemy };
    }

    const healthBefore = enemy.health;
    const firstHit = finite(enemy.damageTaken) <= 0;
    const unawareAtImpact = !enemy.alerted && !enemy.hasLOS && !enemy.hasFired;
    const stateAtImpact = enemy.state;
    const alertedAtImpact = Boolean(enemy.alerted);
    const hasLOSAtImpact = Boolean(enemy.hasLOS);
    const hasFiredAtImpact = Boolean(enemy.hasFired);
    const reactionAtImpact = finite(enemy.reaction);
    const standardGuard = !enemy.isRusk && !enemy.isCellLeader;
    let applied;
    let balanceRule;
    if (this.concealedVests && hitRegion === 'head') {
      // Extreme difficulty treats helmet/face placement as the decisive shot.
      // The vest is concealed beneath the same uniform, so there is no visual
      // silhouette change and players must deliberately aim for the head.
      applied = enemy.health;
      balanceRule = 'extreme_head_lethal';
    } else if (this.concealedVests) {
      const vestScale = hitRegion === 'limb' ? 0.16 : 0.1;
      applied = Math.max(1, raw * vestScale);
      balanceRule = hitRegion === 'limb'
        ? 'extreme_limb_reduced'
        : 'extreme_concealed_vest_reduced';
    } else if (hitRegion === 'head') {
      applied = standardGuard ? enemy.health : Math.max(raw * 2.2, enemy.maxHealth * 0.43);
      balanceRule = standardGuard ? 'standard_head_lethal' : 'armored_head_multiplier';
    } else if (hitRegion === 'torso' && standardGuard && unawareAtImpact && firstHit) {
      // An accurate opening centre-mass shot must visibly work before the
      // target detects or fires at the player. Standard guards go down; elite
      // technicians and the cell leader retain their authored durability.
      applied = enemy.health;
      balanceRule = 'unaware_standard_torso_lethal';
    } else if (hitRegion === 'limb') {
      // The arm silhouette is a large part of a rifleman's visible profile.
      // An opening arm hit must therefore give unmistakable damage feedback,
      // while still rewarding centre-mass and head placement more strongly.
      const limbFloor = standardGuard && unawareAtImpact
        ? enemy.maxHealth / 2
        : enemy.maxHealth / 4;
      applied = Math.max(raw, limbFloor);
      balanceRule = standardGuard && unawareAtImpact
        ? 'unaware_standard_limb_half_health_floor'
        : 'limb_quarter_health_floor';
    } else {
      // Alerted targets and armored specialists retain normal torso durability.
      applied = Math.max(raw, enemy.maxHealth / 3);
      balanceRule = 'torso_third_health_floor';
    }
    applied = Math.min(enemy.health, applied);
    enemy.health = Math.max(0, enemy.health - applied);
    enemy.damageTaken = finite(enemy.damageTaken) + applied;
    enemy.lastDamageTime = this.elapsed;
    enemy.suppression = Math.min(1, enemy.suppression + (hitRegion === 'head' ? 0.8 : 0.38));
    const incomingOrigin = asVector3(
      context?.sourcePosition ?? context?.origin ?? target?.sourcePosition,
      enemy.lastSeenPlayer ?? enemy.root.position,
    );
    enemy.lastKnownPlayer.copy(incomingOrigin);

    const killed = enemy.health <= 0;
    if (killed) this._downEnemy(enemy, hitRegion);
    else {
      const localIncoming = enemy.root.worldToLocal(incomingOrigin.clone());
      enemy.hitReact = 0.34;
      enemy.hitReactSide = localIncoming.x >= 0 ? -1 : 1;
      // Incoming fire is an immediate combat cue, not a request to run toward
      // a pre-reserved cover point. Snap the guard onto the shooter bearing so
      // the next rendered frame shows a rifle response instead of his back.
      this._raiseLocalAlert(enemy, enemy.lastKnownPlayer, 'incoming_fire');
      enemy.reaction = 0;
      enemy.lastSeenTime = this.elapsed;
      enemy.losTimer = 0;
      // A surviving guard struck while unaware needs a short physical recovery
      // before returning fire. This is only an opening-hit delay; established
      // post-alert cadence and burst logic remain unchanged.
      if (unawareAtImpact) {
        enemy.aimSettle = 0;
        enemy.shotTimer = Math.max(finite(enemy.shotTimer), 0.24);
      }
      this._face(enemy, incomingOrigin, 1);
      this._setState(enemy, 'attack');
    }
    const diagnostic = {
      accepted: true,
      reason: killed ? 'damage_applied_lethal' : 'damage_applied',
      enemyId: enemy.id,
      region: hitRegion,
      requestedDamage: raw,
      appliedDamage: applied,
      healthBefore,
      healthAfter: enemy.health,
      killed,
      firstHit,
      balanceRule,
      stateAtImpact,
      alertedAtImpact,
      hasLOSAtImpact,
      hasFiredAtImpact,
      reactionAtImpact,
      technician: Boolean(enemy.technician),
    };
    this._recordDamageDiagnostic(diagnostic, enemy);
    return {
      hit: true,
      accepted: true,
      reason: diagnostic.reason,
      killed,
      surrendered: false,
      headshot: hitRegion === 'head',
      region: hitRegion,
      damage: applied,
      health: enemy.health,
      enemy,
      openingShot: firstHit,
      balanceRule,
    };
  }

  surrenderRusk() {
    // Compatibility-only surface for older mission/UI integrations. CLEARWATER
    // has no surrender objective: every terrorist, including the cell leader,
    // must pass through the ordinary lethal damage/downed-character path.
    return false;
  }

  getActiveCount(group = null) {
    const groupId = group == null ? null : String(typeof group === 'object' ? group.id ?? group.group ?? '' : group);
    return this.enemies.reduce((count, enemy) => (
      count + Number(enemy.active && !enemy.dead && !enemy.surrendered && (groupId == null || enemy.group === groupId))
    ), 0);
  }

  getOperationalStatus() {
    const status = { radius: OPERATION_RADIUS };
    for (const [type, site] of this.operationalSites) {
      const position = site.position;
      const operators = position
        ? this.enemies.filter((enemy) => (
          enemy.active && !enemy.dead && !enemy.surrendered &&
          enemy.root.position.distanceToSquared(position) <= OPERATION_RADIUS * OPERATION_RADIUS
        ))
        : [];
      status[type] = {
        operating: operators.length > 0,
        position: plainVector(position),
        assignedOperatorId: site.operatorId,
        operatorIds: operators.map((enemy) => enemy.id),
      };
    }
    return status;
  }

  getAimPoint(target, region = 'torso') {
    const enemy = this._resolveEnemy(target);
    if (!enemy || !enemy.active || enemy.dead || enemy.surrendered) return null;
    this._updateHitProxies(enemy);
    const proxy = String(region).toLowerCase() === 'head' ? enemy.headProxy : enemy.torsoProxy;
    return proxy?.getWorldPosition?.(new THREE.Vector3()) ?? null;
  }

  getGripProbe(target = 'treatment_door_guard') {
    const enemy = this._resolveEnemy(target);
    const rig = enemy?.combatRig;
    if (!enemy || !rig || !enemy.weaponMount) return null;
    enemy.root.updateMatrixWorld(true);
    const point = (object) => object?.getWorldPosition?.(new THREE.Vector3()) ?? null;
    const rightHand = point(rig.rightHand);
    const rightGrip = point(rig.rightGrip);
    const leftHand = point(rig.leftHand);
    const leftGrip = point(rig.leftGrip);
    const rightShoulder = point(rig.rightUpperArm);
    const rightElbow = point(rig.rightForearm);
    const leftShoulder = point(rig.leftUpperArm);
    const leftElbow = point(rig.leftForearm);
    const weaponBounds = enemy.weapon
      ? new THREE.Box3().setFromObject(enemy.weapon)
      : null;
    const torsoBounds = enemy.torsoProxy
      ? new THREE.Box3().setFromObject(enemy.torsoProxy)
      : null;
    const local = (value) => value ? enemy.root.worldToLocal(value.clone()) : null;
    return {
      enemyId: enemy.id,
      mount: plainVector(enemy.weaponMount.position),
      weaponWallBlend: enemy.weaponWallBlend,
      rightHand: plainVector(rightHand),
      rightShoulder: plainVector(rightShoulder),
      rightShoulderLocal: plainVector(local(rightShoulder)),
      rightElbow: plainVector(rightElbow),
      rightForearmVerticalDelta: rightHand && rightElbow ? rightHand.y - rightElbow.y : null,
      rightGrip: plainVector(rightGrip),
      rightGripLocal: plainVector(local(rightGrip)),
      rightContactDistance: rightHand && rightGrip ? rightHand.distanceTo(rightGrip) : null,
      leftHand: plainVector(leftHand),
      leftShoulder: plainVector(leftShoulder),
      leftShoulderLocal: plainVector(local(leftShoulder)),
      leftElbow: plainVector(leftElbow),
      leftGrip: plainVector(leftGrip),
      leftGripLocal: plainVector(local(leftGrip)),
      leftContactDistance: leftHand && leftGrip ? leftHand.distanceTo(leftGrip) : null,
      gripSeparation: rightGrip && leftGrip ? rightGrip.distanceTo(leftGrip) : null,
      weaponBounds: weaponBounds ? {
        min: plainVector(weaponBounds.min),
        max: plainVector(weaponBounds.max),
      } : null,
      torsoBounds: torsoBounds ? {
        min: plainVector(torsoBounds.min),
        max: plainVector(torsoBounds.max),
      } : null,
    };
  }

  getSnapshot() {
    const groups = {};
    for (const group of this.spawnedGroups.keys()) groups[group] = this.getActiveCount(group);
    return {
      loaded: this.loaded,
      active: this.getActiveCount(),
      total: this.enemies.length,
      difficulty: this.difficulty,
      enemyHealthMultiplier: this.enemyHealthMultiplier,
      enemyAccuracyMultiplier: this.enemyAccuracyMultiplier,
      concealedVests: this.concealedVests,
      facilityAlerted: this.facilityAlerted,
      facilityAlertCount: this.facilityAlertCount,
      facilityAlertReason: this.facilityAlertReason,
      facilityAlertPosition: plainVector(this.facilityAlertPosition),
      groups,
      operations: this.getOperationalStatus(),
      enemies: this.enemies.map((enemy) => ({
        id: enemy.id,
        name: enemy.name,
        group: enemy.group,
        role: enemy.role,
        state: enemy.state,
        motion: enemy.motion,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
        active: enemy.active,
        dead: enemy.dead,
        death: enemy.death ? {
          collisionFree: enemy.death.collisionFree,
          clearance: enemy.death.clearance,
          fallDirection: plainVector(enemy.death.fallDirection),
          targetPosition: plainVector(enemy.death.targetPosition),
        } : null,
        surrendered: enemy.surrendered,
        isRusk: enemy.isRusk,
        technician: enemy.technician,
        specialty: enemy.specialty,
        missionAssetId: enemy.missionAssetId,
        operationAssignment: enemy.operationAssignment,
        casualtyAlertsReceived: enemy.casualtyAlertsReceived,
        lastCasualtyId: enemy.lastCasualtyId,
        alerted: enemy.alerted,
        hasLOS: enemy.hasLOS,
        hasFired: enemy.hasFired,
        combatShotsFired: enemy.combatShotsFired,
        fireLaneFailures: enemy.fireLaneFailures,
        weaponWallBlend: enemy.weaponWallBlend,
        lastCombatAction: enemy.lastCombatAction,
        movementIntent: enemy.movementIntent,
        stuckReplans: enemy.stuckReplans,
        progressRecoveries: enemy.progressRecoveries,
        vaulting: Boolean(enemy.vault),
        vaultObstacleId: enemy.vault?.obstacleId ?? null,
        vaultsCompleted: enemy.vaultsCompleted,
        assaultActive: enemy.assaultActive,
        assaultDelay: enemy.assaultDelay,
        assaultTarget: plainVector(enemy.assaultTarget),
        reinforcingCasualtyId: enemy.reinforcingCasualtyId,
        workPosition: plainVector(enemy.workPosition),
        position: plainVector(enemy.root.position),
      })),
    };
  }

  resetForReplay() {
    if (!this.loaded || this.disposed) return false;
    for (const enemy of this.enemies) {
      enemy.mixer.stopAllAction();
      enemy.mixer.uncacheRoot(enemy.visual);
      enemy.root.removeFromParent();
      enemy.weaponMount?.removeFromParent?.();
    }
    for (const tracer of this.tracers) {
      tracer.line.geometry.dispose();
      tracer.line.removeFromParent();
    }
    // Keep parsed FBX templates, animation clips, shared materials, textures,
    // and proxy geometries alive. Only per-run actor clones and combat state
    // are discarded, so Replay never downloads or parses the asset pack again.
    this.root.clear();
    this.enemies.length = 0;
    this.enemyById.clear();
    this.spawnedGroups.clear();
    this.hitProxies.length = 0;
    this.damageMeshes.length = 0;
    this.coverReservations.clear();
    this.tracers.length = 0;
    this.proxyData = new WeakMap();
    this.damageMeshData = new WeakMap();
    for (const site of this.operationalSites.values()) {
      site.position = null;
      site.facing = null;
      site.operatorId = null;
    }
    this.operationCoordinationTimer = 0;
    this.facilityAlerted = false;
    this.facilityAlertCount = 0;
    this.facilityAlertPosition.set(0, 0, 0);
    this.facilityAlertReason = null;
    this.elapsed = 0;
    this.nextId = 1;
    this.lastNoiseToken = 0;
    this.playerWasFiring = false;
    this.movementNoiseTimer = 0;
    this.raycastSerial = 0;
    this.lastRaycastDiagnostic = null;
    this.lastDamageDiagnostic = null;
    this.pendingDamageRaycast = null;
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const enemy of this.enemies) {
      enemy.mixer.stopAllAction();
      enemy.mixer.uncacheRoot(enemy.visual);
      enemy.root.removeFromParent();
    }
    for (const tracer of this.tracers) {
      tracer.line.geometry.dispose();
      tracer.line.removeFromParent();
    }
    this.tracers.length = 0;
    this.root.removeFromParent();

    const geometries = new Set();
    const materials = new Set(this.sharedMaterials);
    for (const template of [this.characterTemplate, this.weaponTemplate]) {
      template?.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) geometries.add(child.geometry);
          const list = Array.isArray(child.material) ? child.material : [child.material];
          list.filter(Boolean).forEach((material) => materials.add(material));
        }
      });
    }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.ownedTextures.forEach((texture) => texture.dispose());
    this.headGeometry.dispose();
    this.torsoGeometry.dispose();
    this.lowerBodyGeometry.dispose();
    this.armProxyGeometry.dispose();
    this.weaponProxyGeometry.dispose();
    this.proxyMaterial.dispose();
    this.tracerMaterial.dispose();

    this.enemies.length = 0;
    this.enemyById.clear();
    this.spawnedGroups.clear();
    this.hitProxies.length = 0;
    this.damageMeshes.length = 0;
    this.coverReservations.clear();
  }

  _prepareCharacter(assets) {
    const model = assets.character;
    model.name = 'Rocketbox_Security_Male_Template';
    model.traverse((child) => {
      if (child.isLight) child.removeFromParent();
    });

    const textureSets = {};
    for (const part of Object.keys(CHARACTER_TEXTURES)) {
      const map = assets[`${part}-color`];
      const normalMap = assets[`${part}-normal`];
      const specularIntensityMap = assets[`${part}-specular`];
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      normalMap.anisotropy = 8;
      specularIntensityMap.anisotropy = 8;
      this.ownedTextures.push(map, normalMap, specularIntensityMap);
      textureSets[part] = { map, normalMap, specularIntensityMap };
    }

    const materialFor = (name) => {
      const clean = String(name ?? '').toLowerCase();
      const part = clean.includes('head') ? 'head' : clean.includes('equipment') ? 'equipment' : 'body';
      const material = new THREE.MeshPhysicalMaterial({
        name: `Rocketbox_${part}`,
        ...textureSets[part],
        color: 0xffffff,
        roughness: part === 'equipment' ? 0.49 : part === 'head' ? 0.7 : 0.62,
        metalness: part === 'equipment' ? 0.14 : 0.015,
        specularIntensity: part === 'head' ? 0.34 : 0.48,
        normalScale: new THREE.Vector2(part === 'head' ? 0.7 : 0.9, part === 'head' ? 0.7 : 0.9),
      });
      this.sharedMaterials.push(material);
      return material;
    };
    const materialCache = new Map();
    model.traverse((child) => {
      child.userData.noHit = true;
      if (!child.isMesh) return;
      const source = Array.isArray(child.material) ? child.material : [child.material];
      const assigned = source.map((material) => {
        const key = material?.name ?? 'body';
        if (!materialCache.has(key)) materialCache.set(key, materialFor(key));
        return materialCache.get(key);
      });
      child.material = Array.isArray(child.material) ? assigned : assigned[0];
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
    });

    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    const height = Math.max(1e-6, bounds.max.y - bounds.min.y);
    this.characterScale = BODY_HEIGHT / height;
    model.scale.multiplyScalar(this.characterScale);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= bounds.min.y;
    model.updateMatrixWorld(true);

    this.characterTemplate = model;
    const bindNames = new Set();
    model.traverse((child) => bindNames.add(child.name));
    this.clips.idle = this._sanitizeClip(assets.idle.animations?.[0], bindNames, 'idle');
    this.clips.walk = this._sanitizeClip(assets.walk.animations?.[0], bindNames, 'walk');
    this.clips.run = this._sanitizeClip(assets.run.animations?.[0], bindNames, 'run');
  }

  _prepareWeapon(model, textures) {
    const { baseColor, height, metallic, normal, roughness } = textures;
    baseColor.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [baseColor, height, metallic, normal, roughness]) {
      texture.anisotropy = 8;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      this.ownedTextures.push(texture);
    }
    const material = new THREE.MeshStandardMaterial({
      name: 'M4A1_CC0_PBR_Enemy_Material',
      map: baseColor,
      bumpMap: height,
      bumpScale: 0.012,
      metalnessMap: metallic,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughnessMap: roughness,
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.92,
      emissive: 0x030405,
      emissiveIntensity: 0.1,
    });
    this.sharedMaterials.push(material);
    model.traverse((child) => {
      if (child.isLight) child.removeFromParent();
      child.userData.noHit = true;
      if (!child.isMesh) return;
      if (/^(Sight(?:_2)?|Switch[12])$/i.test(child.name)) {
        child.visible = false;
        return;
      }
      child.material = material;
      child.castShadow = true;
      child.receiveShadow = true;
      child.geometry?.computeVertexNormals?.();
    });
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 0.86 / Math.max(size.x, size.y, size.z, 1e-6);
    model.scale.setScalar(scale);
    model.position.copy(center).multiplyScalar(-scale);
    // The player source points down local -Z. Rotate only the centered render
    // model so an enemy mount, its grip markers and its muzzle all use +Z.
    model.rotation.y = Math.PI;
    const wrapper = new THREE.Group();
    wrapper.name = 'M4A1_Enemy_Template';
    wrapper.userData.noHit = true;
    wrapper.add(model);
    this.weaponTemplate = wrapper;
  }

  _sanitizeClip(source, bindNames, name) {
    if (!source) return new THREE.AnimationClip(name, -1, []);
    const clip = source.clone();
    clip.name = name;
    clip.tracks = clip.tracks.filter((track) => {
      try {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        return !parsed.nodeName || bindNames.has(parsed.nodeName);
      } catch {
        return true;
      }
    });
    for (const track of clip.tracks) {
      let parsed;
      try {
        parsed = THREE.PropertyBinding.parseTrackName(track.name);
      } catch {
        continue;
      }
      const rootName = String(parsed.nodeName ?? '').replace(/[\s_:-]/g, '').toLowerCase();
      if (rootName !== 'bip01' || parsed.propertyName !== 'position' || track.getValueSize() < 3) continue;
      const stride = track.getValueSize();
      const firstX = track.values[0];
      const firstZ = track.values[2];
      for (let index = 0; index < track.values.length; index += stride) {
        track.values[index] = firstX;
        track.values[index + 2] = firstZ;
      }
    }
    clip.resetDuration().optimize();
    return clip;
  }

  _spawnEnemy(groupId, point, position, spec) {
    const authoredId = point?.id ?? point?.name;
    const id = String(authoredId ?? `${groupId}-${this.nextId++}`);
    const role = String(point?.role ?? spec.role ?? 'security');
    const authoredName = String(point?.displayName ?? point?.name ?? '').trim();
    // A group named "boss" or a commander role describes encounter placement,
    // not the retired Ridgewatch Rusk character. Only an explicit/Rusk-named
    // legacy spawn receives that compatibility flag.
    const isRusk = Boolean(point?.isRusk ?? spec.isRusk) || /rusk/i.test(`${id} ${authoredName}`);
    const isCellLeader = Boolean(point?.isCellLeader ?? spec.isCellLeader) ||
      /cell[_\s-]?leader|nadir/i.test(`${id} ${authoredName}`);
    const technician = Boolean(point?.technician ?? spec.technician);
    const specialty = String(point?.specialty ?? spec.specialty ?? '');
    const missionAssetId = String(point?.missionAssetId ?? spec.missionAssetId ?? '');
    const operationAssignment = /poison/i.test(specialty)
      ? 'poison'
      : /vault/i.test(specialty)
        ? 'vault'
        : null;
    const workPosition = asVector3(point?.workPosition ?? spec.workPosition);
    const workFacing = asVector3(point?.workFacing ?? spec.workFacing);
    const baseMaxHealth = Math.max(1, finite(
      point?.maxHealth ?? point?.health ?? spec.maxHealth ?? spec.health,
      isCellLeader ? 165 : isRusk ? 180 : 100,
    ));
    const maxHealth = baseMaxHealth * this.enemyHealthMultiplier;
    const root = new THREE.Group();
    root.name = `Enemy_${id}`;
    root.position.copy(position);
    root.rotation.y = finite(point?.yaw ?? point?.rotationY ?? spec.yaw, 0);
    root.userData.noHit = true;

    const visual = SkeletonUtils.clone(this.characterTemplate);
    visual.name = `Rocketbox_${id}`;
    root.add(visual);
    const mixer = new THREE.AnimationMixer(visual);
    const actions = {};
    for (const [name, clip] of Object.entries(this.clips)) {
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopRepeat, Infinity);
      actions[name] = action;
    }

    const random = seededRandom(hashString(id));
    const enemy = {
      id,
      // Authored names take precedence so the mission's leader is presented as
      // "Cell Leader Nadir" rather than being relabeled by his commander role.
      name: authoredName || (isRusk ? 'Commander Rusk' : `Clearwater Hostile ${id}`),
      group: groupId,
      role,
      isRusk,
      isCellLeader,
      technician,
      specialty,
      missionAssetId,
      operationAssignment,
      operationRetakePending: false,
      operationPosition: workPosition?.clone() ?? null,
      operationFacing: workFacing?.clone() ?? null,
      workPosition: workPosition?.clone() ?? (technician ? position.clone() : null),
      workFacing: workFacing?.clone() ?? null,
      root,
      visual,
      mixer,
      actions,
      motion: null,
      state: 'patrol',
      stateTime: 0,
      active: true,
      dead: false,
      surrendered: false,
      maxHealth,
      health: maxHealth,
      baseMaxHealth,
      concealedVest: this.concealedVests,
      damageTaken: 0,
      speed: finite(point?.speed, role.includes('heavy') ? 2.0 : 2.38),
      random,
      spawnPosition: position.clone(),
      patrol: this._resolveRoute(point?.patrol ?? point?.route ?? spec.patrol, groupId),
      patrolIndex: 0,
      wait: random() * 0.8,
      lastKnownPlayer: position.clone(),
      lastSeenPlayer: null,
      lastSeenTime: -Infinity,
      losTimer: random() * 0.07,
      hasLOS: false,
      alerted: false,
      reaction: 0.055 + random() * 0.09,
      pendingAlert: null,
      coverPoint: null,
      burstRemaining: 0,
      shotTimer: 0.14 + random() * 0.18,
      burstCooldown: 0.8 + random(),
      hasFired: false,
      combatShotsFired: 0,
      fireLaneFailures: 0,
      fireLaneBlockedSince: null,
      lastCombatAction: 'patrol',
      assaultTarget: null,
      assaultActive: false,
      assaultDelay: 0,
      aimSettle: 0,
      suppression: 0,
      flankCooldown: 3 + random() * 4,
      blockedTime: 0,
      immobileTime: 0,
      avoidanceSide: random() < 0.5 ? -1 : 1,
      escapeTarget: null,
      stuckReplans: 0,
      escapeFailures: 0,
      progressAnchor: position.clone(),
      progressTime: 0,
      progressRecoveries: 0,
      progressRecoveryUntil: 0,
      movementIntent: false,
      movementIntentTarget: position.clone(),
      blockedPatrolUntil: new Map(),
      rejectedCoverUntil: new Map(),
      casualtyAlertsReceived: 0,
      lastCasualtyId: null,
      reinforcingCasualtyId: null,
      lastDamageTime: -Infinity,
      hitReact: 0,
      hitReactSide: 1,
      death: null,
      surrender: null,
      combatRig: null,
      weaponWallBlend: 0,
      weaponAimPitch: null,
      weaponAimYaw: null,
      vault: null,
      vaultsCompleted: 0,
    };
    if (operationAssignment) {
      const site = this.operationalSites.get(operationAssignment);
      if (site) {
        site.position = (workPosition ?? position).clone();
        site.facing = workFacing?.clone() ?? null;
        site.operatorId = id;
      }
    }
    enemy.coverPoint = this._chooseCover(enemy, enemy.lastKnownPlayer, false, point?.coverId);
    this._attachWeapon(enemy);
    this._registerDamageMeshes(enemy);
    this._createHitProxies(enemy);
    this._setMotion(enemy, 'idle', true);

    root.userData.enemy = enemy;
    this.root.add(root);
    // Prime skeleton-derived targets immediately. The player can never hit a
    // model whose proxies are waiting for its first AI/animation update.
    this._updateHitProxies(enemy);
    root.updateMatrixWorld(true);
    this.enemies.push(enemy);
    this.enemyById.set(id, enemy);
    return enemy;
  }

  _attachWeapon(enemy) {
    if (!this.weaponTemplate) {
      enemy.weapon = null;
      enemy.weaponMount = null;
      enemy.muzzle = null;
      return;
    }
    const weapon = this.weaponTemplate.clone(true);
    weapon.name = `M4A1_${enemy.id}`;
    const mount = new THREE.Group();
    mount.name = `WeaponMount_${enemy.id}`;
    mount.userData.noHit = true;
    // The centered player M4 is mirrored to point along local +Z. Mounting that
    // axis in character space makes the visible barrel and ballistics agree.
    enemy.root.add(mount);
    // Use the player's shoulder-pocket offset and wrist seats, mirrored around
    // Y for the full-character +Z weapon. The stock touches the right shoulder
    // at z≈0 without passing through the torso.
    mount.position.set(-0.14, 1.38, 0.38);
    mount.rotation.set(0.13, 0, -0.018);
    mount.userData.homePosition = mount.position.clone();
    mount.add(weapon);
    enemy.weapon = weapon;
    enemy.weaponMount = mount;

    // Grip markers are invisible children of the aimed weapon mount. Solving
    // each two-bone chain to these points keeps the trigger and support hands
    // attached even while the locomotion mixer continues underneath.
    const rightGrip = new THREE.Object3D();
    rightGrip.name = `M4A1_RightGrip_${enemy.id}`;
    // Exact mirrored counterpart of player TRIGGER_GRIP relative to the
    // centered rifle (player model offset is z=-.27).
    rightGrip.position.set(-0.06, -0.03, -0.197);
    rightGrip.userData.noHit = true;
    const leftGrip = new THREE.Object3D();
    leftGrip.name = `M4A1_LeftGrip_${enemy.id}`;
    // Exact mirrored counterpart of player SUPPORT_GRIP. It remains forward
    // on the handguard and preserves the player's 16 cm two-hand separation.
    leftGrip.position.set(0.048, -0.015, -0.065);
    leftGrip.userData.noHit = true;
    mount.add(rightGrip, leftGrip);

    // The centered weapon template spans roughly -0.42..+0.42 on Z, so this
    // marker sits at the actual barrel tip rather than at character head level.
    const muzzle = new THREE.Object3D();
    muzzle.name = `M4A1_Muzzle_${enemy.id}`;
    muzzle.userData.noHit = true;
    muzzle.position.set(0, 0.015, 0.42);
    weapon.add(muzzle);
    enemy.muzzle = muzzle;

    enemy.combatRig = {
      rightGrip,
      leftGrip,
      rightUpperArm: this._findBone(enemy.visual, ['bip01rupperarm', 'rupperarm', 'rightupperarm']),
      rightForearm: this._findBone(enemy.visual, ['bip01rforearm', 'rforearm', 'rightforearm']),
      rightHand: this._findBone(enemy.visual, ['bip01rhand', 'rhand', 'righthand']),
      leftUpperArm: this._findBone(enemy.visual, ['bip01lupperarm', 'lupperarm', 'leftupperarm']),
      leftForearm: this._findBone(enemy.visual, ['bip01lforearm', 'lforearm', 'leftforearm']),
      leftHand: this._findBone(enemy.visual, ['bip01lhand', 'lhand', 'lefthand']),
      rearHandBoneAlignment: 'slight_diagonal',
      rearHandDownturnDegrees: 0,
      rearHandTiltDegrees: THREE.MathUtils.radToDeg(ENEMY_FIRING_HAND_TILT),
      fingers: [],
      poseWeight: 0,
    };
    enemy.visual.traverse((bone) => {
      if (!bone.isBone) return;
      const clean = String(bone.name).replace(/[\s_:-]/g, '').toLowerCase();
      const match = clean.match(/bip01([lr])finger([0-4])([12])?$/);
      if (!match) return;
      enemy.combatRig.fingers.push({
        bone,
        side: match[1] === 'r' ? 'right' : 'left',
        finger: Number(match[2]),
        segment: Number(match[3] ?? 0),
        restQuaternion: bone.quaternion.clone(),
      });
    });
    enemy.combatRig.fingerBoneCount = enemy.combatRig.fingers.length;
  }

  _registerDamageMeshes(enemy) {
    enemy.damageMeshes = [];
    const register = (root, region) => {
      root?.traverse((object) => {
        if (!object.isMesh) return;
        object.userData.enemyOwnerId = enemy.id;
        object.userData.enemyDamageRegion = region;
        enemy.damageMeshes.push(object);
        this.damageMeshes.push(object);
        this.damageMeshData.set(object, { enemy, region });
      });
    };
    register(enemy.visual, 'torso');
    register(enemy.weapon, 'limb');
  }

  _createHitProxies(enemy) {
    const torso = new THREE.Mesh(this.torsoGeometry, this.proxyMaterial);
    torso.name = `TorsoHit_${enemy.id}`;
    torso.position.set(0, 1.14, 0);
    torso.userData.enemyHitProxy = true;
    torso.frustumCulled = false;
    const head = new THREE.Mesh(this.headGeometry, this.proxyMaterial);
    head.name = `HeadHit_${enemy.id}`;
    head.position.set(0, 1.64, 0);
    head.userData.enemyHitProxy = true;
    head.frustumCulled = false;
    const lowerBody = new THREE.Mesh(this.lowerBodyGeometry, this.proxyMaterial);
    lowerBody.name = `LowerBodyHit_${enemy.id}`;
    lowerBody.position.set(0, 0.4, 0);
    lowerBody.userData.enemyHitProxy = true;
    lowerBody.frustumCulled = false;
    enemy.root.add(torso, head, lowerBody);
    enemy.torsoProxy = torso;
    enemy.headProxy = head;
    enemy.lowerBodyProxy = lowerBody;
    enemy.limbProxies = [];
    const rig = enemy.combatRig;
    const limbSegments = [
      ['RIGHT_UPPER_ARM', rig?.rightUpperArm, rig?.rightForearm],
      ['RIGHT_FOREARM', rig?.rightForearm, rig?.rightHand],
      ['LEFT_UPPER_ARM', rig?.leftUpperArm, rig?.leftForearm],
      ['LEFT_FOREARM', rig?.leftForearm, rig?.leftHand],
    ];
    for (const [label, startBone, endBone] of limbSegments) {
      if (!startBone || !endBone) continue;
      const proxy = new THREE.Mesh(this.armProxyGeometry, this.proxyMaterial);
      proxy.name = `${label}_HIT_${enemy.id}`;
      proxy.userData.enemyHitProxy = true;
      proxy.frustumCulled = false;
      enemy.root.add(proxy);
      enemy.limbProxies.push({ proxy, startBone, endBone });
      this.proxyData.set(proxy, { enemy, region: 'limb' });
      this.hitProxies.push(proxy);
    }
    // The rifle occupies a large part of an unaware guard's front silhouette.
    // Treat a round through that shouldered weapon as a weapon-side limb hit,
    // rather than letting it fall through to a glowing wall impact behind him.
    if (enemy.weaponMount) {
      const weaponProxy = new THREE.Mesh(this.weaponProxyGeometry, this.proxyMaterial);
      weaponProxy.name = `WEAPON_HIT_${enemy.id}`;
      weaponProxy.userData.enemyHitProxy = true;
      weaponProxy.frustumCulled = false;
      enemy.weaponMount.add(weaponProxy);
      enemy.weaponProxy = weaponProxy;
      this.proxyData.set(weaponProxy, { enemy, region: 'limb' });
      this.hitProxies.push(weaponProxy);
    }
    enemy.headBone = this._findBone(enemy.visual, ['bip01head', 'head']);
    enemy.torsoBone = this._findBone(enemy.visual, ['bip01spine1', 'bip01spine2', 'spine1', 'spine2']);
    this.proxyData.set(head, { enemy, region: 'head' });
    this.proxyData.set(torso, { enemy, region: 'torso' });
    this.proxyData.set(lowerBody, { enemy, region: 'limb' });
    this.hitProxies.push(head, torso, lowerBody);
  }

  _updateHitProxies(enemy) {
    if (!enemy.active || enemy.dead || enemy.surrendered) return;
    enemy.visual.updateMatrixWorld(true);
    if (enemy.headBone) {
      enemy.headBone.getWorldPosition(this._a);
      enemy.root.worldToLocal(this._a);
      enemy.headProxy.position.copy(this._a).addScaledVector(UP, 0.055);
    }
    if (enemy.torsoBone) {
      enemy.torsoBone.getWorldPosition(this._a);
      enemy.root.worldToLocal(this._a);
      enemy.torsoProxy.position.x = this._a.x;
      enemy.torsoProxy.position.z = this._a.z;
      enemy.torsoProxy.position.y = THREE.MathUtils.clamp(this._a.y - 0.04, 0.92, 1.32);
    }
    for (const segment of enemy.limbProxies ?? []) {
      segment.startBone.getWorldPosition(this._a);
      segment.endBone.getWorldPosition(this._b);
      enemy.root.worldToLocal(this._a);
      enemy.root.worldToLocal(this._b);
      this._c.copy(this._b).sub(this._a);
      const length = this._c.length();
      if (length < 1e-4) continue;
      segment.proxy.position.copy(this._a).add(this._b).multiplyScalar(0.5);
      segment.proxy.scale.set(1, length, 1);
      segment.proxy.quaternion.setFromUnitVectors(UP, this._c.multiplyScalar(1 / length));
      segment.proxy.updateMatrixWorld(true);
    }
  }

  _updateCombatPose(enemy, dt, playerEye) {
    const rig = enemy.combatRig;
    if (!rig || !enemy.weaponMount) return;

    const engaged = enemy.alerted || enemy.hasLOS || ['attack', 'cover', 'flank'].includes(enemy.state);
    const response = 1 - Math.exp(-Math.max(0, dt) * (engaged ? 18 : 9));
    // The locomotion mixer reapplies an unarmed clip before this pass every
    // frame, so a partial IK weight always leaves a visible gap. Weapon hands
    // use the player's exact-contact rule at full weight in every AI state.
    rig.poseWeight = 1;
    const hitReact = clamp01(enemy.hitReact / 0.34);
    enemy.visual.rotation.z = THREE.MathUtils.lerp(
      enemy.visual.rotation.z,
      enemy.hitReactSide * 0.1 * hitReact,
      response || 1,
    );

    // A guard with current LOS tracks the live eye position. Otherwise the
    // rifle covers the last honest contact/noise location; it never uses an
    // omniscient player coordinate while searching.
    const aimPoint = engaged
      ? asVector3(enemy.hasLOS && playerEye ? playerEye : enemy.lastKnownPlayer)
      : null;
    let desiredYaw = 0;
    let desiredPitch = enemy.technician ? 0.42 : 0.2;
    if (aimPoint) {
      const localPoint = enemy.root.worldToLocal(aimPoint);
      const dx = localPoint.x - enemy.weaponMount.position.x;
      const dy = localPoint.y - enemy.weaponMount.position.y;
      const dz = localPoint.z - enemy.weaponMount.position.z;
      const horizontal = Math.max(1e-5, Math.hypot(dx, dz));
      // The torso already turns toward a live target. Keep only a modest
      // shoulder-pocket fine aim here; swinging the rifle 49 degrees inside
      // the arms pulled the support grip beyond the Rocketbox reach and made
      // the left glove detach during alert transitions.
      desiredYaw = THREE.MathUtils.clamp(Math.atan2(dx, dz), -0.34, 0.34);
      // With the authored +Z barrel, negative X rotation elevates the muzzle.
      desiredPitch = THREE.MathUtils.clamp(-Math.atan2(dy, horizontal), -0.48, 0.34);
    }
    enemy.weaponAimPitch = THREE.MathUtils.lerp(
      Number.isFinite(enemy.weaponAimPitch) ? enemy.weaponAimPitch : enemy.weaponMount.rotation.x,
      desiredPitch + 0.14 * hitReact,
      response || 1,
    );
    enemy.weaponAimYaw = THREE.MathUtils.lerp(
      Number.isFinite(enemy.weaponAimYaw) ? enemy.weaponAimYaw : enemy.weaponMount.rotation.y,
      desiredYaw,
      response || 1,
    );
    enemy.weaponMount.rotation.set(enemy.weaponAimPitch, enemy.weaponAimYaw, -0.018);
    this._updateWeaponWallClearance(enemy, dt);
    enemy.root.updateMatrixWorld(true);

    // Rocketbox limb bones extend along local +X. Two analytic reaches put the
    // trigger hand and support hand on their named weapon markers after every
    // locomotion-mixer update, producing a stable shouldered silhouette.
    this._solveArmReach(
      enemy,
      rig.rightUpperArm,
      rig.rightForearm,
      rig.rightHand,
      rig.rightGrip,
      -1,
      rig.poseWeight,
    );
    this._solveArmReach(
      enemy,
      rig.leftUpperArm,
      rig.leftForearm,
      rig.leftHand,
      rig.leftGrip,
      1,
      rig.poseWeight,
    );
    // Mirror the first-person firing-hand contract. Convert the live lowered
    // elbow-to-wrist direction into weapon-local space, then use it as the
    // hand's anatomical X axis without an arbitrary quarter-turn.
    if (rig.rightForearm && rig.rightHand) {
      rig.rightForearm.getWorldPosition(this._a);
      rig.rightHand.getWorldPosition(this._b);
      this._c.copy(this._b).sub(this._a);
      if (this._c.lengthSq() < 1e-8) this._c.copy(ENEMY_FIRING_HAND_AXIS);
      else this._c.normalize();
    } else {
      this._c.copy(ENEMY_FIRING_HAND_AXIS);
    }
    enemy.weaponMount.getWorldQuaternion(this._q).invert();
    this._c.applyQuaternion(this._q).normalize();
    this._orientCombatHand(
      enemy,
      rig.rightHand,
      this._c,
      ENEMY_FIRING_PALM_NORMAL,
      rig.poseWeight,
      ENEMY_FIRING_HAND_TILT,
      Y_AXIS,
    );
    this._orientCombatHand(
      enemy,
      rig.leftHand,
      ENEMY_SUPPORT_HAND_AXIS,
      ENEMY_SUPPORT_PALM_NORMAL,
      rig.poseWeight,
    );
    this._poseCombatFingers(rig, rig.poseWeight);
  }

  _updateWeaponWallClearance(enemy, dt) {
    const mount = enemy.weaponMount;
    const home = mount?.userData?.homePosition;
    if (!mount || !home || !enemy.muzzle) return;

    mount.position.copy(home);
    enemy.root.updateMatrixWorld(true);
    enemy.root.localToWorld(this._a.set(0, 1.38, 0.02));
    const probes = [
      enemy.muzzle.getWorldPosition(this._b).clone(),
      enemy.combatRig?.rightGrip?.getWorldPosition(this._c).clone(),
      enemy.combatRig?.leftGrip?.getWorldPosition(this._d).clone(),
      mount.localToWorld(new THREE.Vector3(-0.3, -0.2, 0.58)),
      mount.localToWorld(new THREE.Vector3(0.3, -0.2, 0.48)),
    ].filter(Boolean);
    let obstruction = 0;
    for (const probe of probes) {
      this._c.copy(probe).sub(this._a);
      const probeLength = this._c.length();
      if (probeLength <= 1e-4) continue;
      this._c.multiplyScalar(1 / probeLength);
      const clearanceLength = Math.max(probeLength, probe === probes[0] ? WEAPON_VISUAL_REACH : probeLength);
      const hit = this._raycastWorld(this._a, this._c, clearanceLength + 0.05);
      if (hit && Number.isFinite(hit.distance)) {
        obstruction = Math.max(
          obstruction,
          THREE.MathUtils.clamp((clearanceLength + 0.12 - hit.distance) / 0.5, 0, 1),
        );
      }
    }
    enemy.weaponWallBlend = THREE.MathUtils.damp(
      Number(enemy.weaponWallBlend) || 0,
      obstruction,
      obstruction > enemy.weaponWallBlend ? 24 : 11,
      dt > 0 ? dt : 1,
    );
    const retract = WEAPON_WALL_RETRACT * enemy.weaponWallBlend;
    mount.position.x -= Math.sin(mount.rotation.y) * retract;
    mount.position.y -= WEAPON_WALL_LOWER * enemy.weaponWallBlend;
    mount.position.z -= Math.cos(mount.rotation.y) * retract;
    // Retract along the rifle axis without folding the gun through the torso.
    // A small pitch keeps the visual envelope compact while preserving aim.
    mount.rotation.x += 0.12 * enemy.weaponWallBlend;
    mount.updateMatrixWorld(true);
  }

  _poseCombatFingers(rig, weight) {
    for (const entry of rig.fingers ?? []) {
      const curl = ENEMY_FINGER_CURL[entry.side]?.[entry.finger]?.[entry.segment] ?? 0.65;
      this._fingerQuaternion.setFromAxisAngle(Z_AXIS, curl);
      this._fingerDesiredQuaternion.copy(entry.restQuaternion).multiply(this._fingerQuaternion);
      // Start from the authored bind grip every frame. Multiplying the live
      // quaternion accumulated curl on clips without finger tracks, eventually
      // twisting both enemy gloves into impossible shapes.
      entry.bone.quaternion.slerp(this._fingerDesiredQuaternion, clamp01(weight));
      entry.bone.updateWorldMatrix(false, true);
    }
  }

  _orientCombatHand(enemy, hand, localAxis, localPalmNormal, weight, rotation = 0, rotationAxis = X_AXIS) {
    if (!hand || !enemy.weaponMount) return;
    enemy.weaponMount.getWorldQuaternion(this._q);
    this._basisX.copy(localAxis).applyQuaternion(this._q).normalize();
    this._basisY.copy(localPalmNormal).applyQuaternion(this._q);
    this._basisY.addScaledVector(this._basisX, -this._basisY.dot(this._basisX));
    if (this._basisY.lengthSq() < 1e-6) this._basisY.copy(UP);
    this._basisY.normalize();
    this._basisZ.crossVectors(this._basisX, this._basisY).normalize();
    this._basisY.crossVectors(this._basisZ, this._basisX).normalize();
    this._basisMatrix.makeBasis(this._basisX, this._basisY, this._basisZ);
    this._desiredQuaternion.setFromRotationMatrix(this._basisMatrix);
    if (Math.abs(rotation) > 1e-5) {
      this._rollQuaternion.setFromAxisAngle(rotationAxis, rotation);
      this._desiredQuaternion.multiply(this._rollQuaternion);
    }
    hand.parent?.getWorldQuaternion(this._parentQuaternion) ?? this._parentQuaternion.identity();
    this._parentQuaternion.invert();
    this._desiredQuaternion.premultiply(this._parentQuaternion);
    hand.quaternion.slerp(this._desiredQuaternion, clamp01(weight));
    hand.updateWorldMatrix(true, true);
  }

  _solveArmReach(enemy, upperArm, forearm, hand, grip, outwardSign, weight) {
    if (!upperArm || !forearm || !hand || !grip) return;
    enemy.visual.updateMatrixWorld(true);
    const shoulder = upperArm.getWorldPosition(new THREE.Vector3());
    const currentElbow = forearm.getWorldPosition(new THREE.Vector3());
    const currentWrist = hand.getWorldPosition(new THREE.Vector3());
    const target = grip.getWorldPosition(new THREE.Vector3());
    const upperLength = shoulder.distanceTo(currentElbow);
    const lowerLength = currentElbow.distanceTo(currentWrist);
    if (upperLength < 1e-4 || lowerLength < 1e-4) return;

    const towardTarget = target.clone().sub(shoulder);
    const rawDistance = towardTarget.length();
    if (rawDistance < 1e-5) return;
    towardTarget.multiplyScalar(1 / rawDistance);
    const distance = THREE.MathUtils.clamp(
      rawDistance,
      Math.abs(upperLength - lowerLength) + 0.004,
      upperLength + lowerLength - 0.004,
    );

    // Keep elbows just outside and below the torso. Projecting a character-local
    // bend vector onto the reach plane avoids elbow flips while preserving the
    // same lowered rear-elbow silhouette used by the first-person rig.
    const rootQuaternion = enemy.root.getWorldQuaternion(new THREE.Quaternion());
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    let bendDirection;
    if (outwardSign < 0 && bend > 1e-5) {
      const rootUp = UP.clone().applyQuaternion(rootQuaternion);
      const verticalBasis = rootUp.clone().addScaledVector(towardTarget, -rootUp.dot(towardTarget));
      if (verticalBasis.lengthSq() < 1e-6) verticalBasis.set(0, 0, 1).applyQuaternion(rootQuaternion);
      verticalBasis.normalize();
      const sideBasis = new THREE.Vector3().crossVectors(towardTarget, verticalBasis).normalize();
      const characterRight = new THREE.Vector3(outwardSign, 0, 0).applyQuaternion(rootQuaternion);
      if (sideBasis.dot(characterRight) < 0) sideBasis.negate();
      const elbowBase = shoulder.clone().addScaledVector(towardTarget, along);
      const verticalShare = THREE.MathUtils.clamp(
        (target.clone().sub(elbowBase).dot(rootUp) - 0.075) /
          Math.max(1e-5, bend * verticalBasis.dot(rootUp)),
        -0.98,
        0.98,
      );
      bendDirection = verticalBasis.multiplyScalar(verticalShare)
        .addScaledVector(sideBasis, Math.sqrt(Math.max(0, 1 - verticalShare * verticalShare)))
        .normalize();
    } else {
      bendDirection = new THREE.Vector3(outwardSign, -0.2, 0.08).applyQuaternion(rootQuaternion);
      bendDirection.addScaledVector(towardTarget, -bendDirection.dot(towardTarget));
      if (bendDirection.lengthSq() < 1e-6) {
        bendDirection.crossVectors(towardTarget, UP);
        if (outwardSign < 0) bendDirection.negate();
      }
      bendDirection.normalize();
    }
    const elbowTarget = shoulder.clone()
      .addScaledVector(towardTarget, along)
      .addScaledVector(bendDirection, bend);

    this._aimBoneXAxis(upperArm, elbowTarget, weight);
    upperArm.updateWorldMatrix(true, true);
    this._aimBoneXAxis(forearm, target, weight);
    forearm.updateWorldMatrix(true, true);
  }

  _aimBoneXAxis(bone, target, weight) {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const desiredAxis = target.clone().sub(origin);
    if (desiredAxis.lengthSq() < 1e-8) return;
    desiredAxis.normalize();

    const worldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
    const currentAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuaternion).normalize();
    const worldCorrection = new THREE.Quaternion().setFromUnitVectors(currentAxis, desiredAxis);
    const desiredWorldQuaternion = worldCorrection.multiply(worldQuaternion);
    const parentWorldQuaternion = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    const desiredLocalQuaternion = parentWorldQuaternion.invert().multiply(desiredWorldQuaternion);
    bone.quaternion.slerp(desiredLocalQuaternion, clamp01(weight));
  }

  _updateEnemy(enemy, dt, playerEye, playerFeet, playerVelocity, playerState) {
    enemy.stateTime += dt;
    enemy.hitReact = Math.max(0, enemy.hitReact - dt);
    enemy.suppression = Math.max(0, enemy.suppression - dt * 0.17);
    enemy.flankCooldown -= dt;
    enemy.shotTimer -= dt;
    enemy.losTimer -= dt;

    if (enemy.pendingAlert) {
      enemy.pendingAlert.delay -= dt;
      if (enemy.pendingAlert.delay <= 0) {
        const alertPosition = enemy.pendingAlert.position.clone();
        const alertReason = enemy.pendingAlert.reason ?? 'radio';
        enemy.pendingAlert = null;
        this._raiseLocalAlert(enemy, alertPosition, alertReason);
      }
    }

    if (enemy.losTimer <= 0) {
      enemy.losTimer = 0.055 + enemy.random() * 0.06;
      enemy.hasLOS = this._canSee(enemy, playerEye);
      if (enemy.hasLOS) {
        enemy.lastKnownPlayer.copy(playerEye);
        enemy.lastSeenPlayer = playerEye.clone();
        enemy.lastSeenTime = this.elapsed;
        if (enemy.state === 'patrol' || enemy.state === 'investigate') {
          enemy.reaction = Math.min(enemy.reaction, 0.045 + enemy.random() * 0.065);
          this._raiseLocalAlert(enemy, playerEye, 'visual');
        }
      }
    }

    if (enemy.hasLOS) {
      enemy.reaction -= dt;
      if (enemy.reaction <= 0 && (enemy.state === 'patrol' || enemy.state === 'investigate')) {
        // Fire from the current shouldered stance first. Running to a reserved
        // cover point before returning a visible threat made guards appear to
        // hesitate for seconds despite already having the player in sight.
        this._releaseCover(enemy);
        enemy.shotTimer = Math.min(enemy.shotTimer, 0.08 + enemy.random() * 0.07);
        this._setState(enemy, 'attack');
      }
    }

    if (this._updateLowVault(enemy, dt)) return;

    // A named specialist or a replacement guard physically assigned to an
    // objective must reach its controls before that operation can progress.
    if (
      (enemy.technician || enemy.operationAssignment) &&
      !enemy.assaultActive &&
      !enemy.hasLOS
    ) {
      this._updateTechnician(enemy, dt);
      return;
    }

    if (enemy.assaultActive) {
      if (enemy.hasLOS) {
        // Contact supersedes the objective waypoint: engage the live player,
        // then pursue the honest last-seen position if sight is later lost.
        enemy.assaultActive = false;
        enemy.assaultDelay = 0;
      } else if (enemy.assaultDelay > 0) {
        enemy.assaultDelay = Math.max(0, enemy.assaultDelay - dt);
        this._face(enemy, enemy.assaultTarget, dt * 6);
        this._setMotion(enemy, 'idle');
        enemy.lastCombatAction = 'counterattack_staging';
        return;
      }
    }

    if (enemy.state === 'patrol') this._patrol(enemy, dt);
    else if (enemy.state === 'investigate') this._investigate(enemy, dt);
    else if (enemy.state === 'cover') this._takeCover(enemy, dt, playerEye);
    else if (enemy.state === 'flank') this._flank(enemy, dt, playerEye);
    else this._attack(enemy, dt, playerEye, playerFeet, playerVelocity, playerState);
  }

  _coordinateOperationalSites() {
    for (const [type, site] of this.operationalSites) {
      if (!site.position) continue;
      const current = site.operatorId ? this.enemyById.get(site.operatorId) : null;
      if (current?.active && !current.dead && !current.surrendered) continue;

      const replacement = this.enemies
        .filter((enemy) => (
          enemy.active && !enemy.dead && !enemy.surrendered &&
          (!enemy.operationAssignment || enemy.operationAssignment === type) &&
          (
            this.facilityAlerted ||
            enemy.root.position.distanceToSquared(site.position) <= OPERATOR_REPLACEMENT_RANGE * OPERATOR_REPLACEMENT_RANGE
          )
        ))
        .sort((left, right) => {
          const leftCombatPenalty = Number(left.hasLOS || left.assaultActive) * 500;
          const rightCombatPenalty = Number(right.hasLOS || right.assaultActive) * 500;
          return leftCombatPenalty - rightCombatPenalty ||
            left.root.position.distanceToSquared(site.position) - right.root.position.distanceToSquared(site.position) ||
            String(left.id).localeCompare(String(right.id));
        })[0] ?? null;
      site.operatorId = replacement?.id ?? null;
      if (!replacement) continue;
      replacement.operationAssignment = type;
      replacement.operationRetakePending = true;
      replacement.operationPosition = site.position.clone();
      replacement.operationFacing = site.facing?.clone() ?? null;
      replacement.assaultActive = false;
      replacement.assaultDelay = 0;
      this._releaseCover(replacement);
      this._setState(replacement, 'investigate');
      replacement.lastCombatAction = `replace_${type}_operator`;
      this._emit('onOperationalReplacement', {
        type,
        operatorId: replacement.id,
        position: site.position.clone(),
        radius: OPERATION_RADIUS,
      });
    }
  }

  _updateTechnician(enemy, dt) {
    const station = enemy.operationPosition ?? enemy.workPosition ?? enemy.spawnPosition;
    if (enemy.root.position.distanceToSquared(station) > 0.32 * 0.32) {
      this._moveTowards(enemy, station, enemy.speed * (this.facilityAlerted ? 0.86 : 0.58), dt);
      enemy.lastCombatAction = enemy.operationAssignment
        ? `move_to_${enemy.operationAssignment}_controls`
        : 'return_to_technical_station';
      return;
    }
    this._setMotion(enemy, 'idle');
    enemy.assaultActive = false;
    enemy.assaultDelay = 0;
    enemy.aimSettle = 0;
    enemy.lastCombatAction = enemy.operationAssignment
      ? `operate_${enemy.operationAssignment}`
      : enemy.alerted ? 'technical_work_under_alert' : 'technical_work';
    if (enemy.operationAssignment && enemy.operationRetakePending) {
      enemy.operationRetakePending = false;
      this._emit('onOperationalRecaptured', {
        type: enemy.operationAssignment,
        operatorId: enemy.id,
        position: station.clone(),
        radius: OPERATION_RADIUS,
      });
    }
    const facing = this.facilityAlerted ? enemy.lastKnownPlayer : enemy.operationFacing ?? enemy.workFacing;
    if (facing) this._face(enemy, facing, dt * 3.2);
  }

  _patrol(enemy, dt) {
    if (!enemy.patrol.length) {
      this._setMotion(enemy, 'idle');
      return;
    }
    if (enemy.wait > 0) {
      enemy.wait -= dt;
      this._setMotion(enemy, 'idle');
      return;
    }
    enemy.blockedPatrolUntil ??= new Map();
    let skipped = 0;
    while (skipped < enemy.patrol.length) {
      const rejectedUntil = enemy.blockedPatrolUntil.get(enemy.patrolIndex) ?? -Infinity;
      if (rejectedUntil <= this.elapsed) {
        enemy.blockedPatrolUntil.delete(enemy.patrolIndex);
        break;
      }
      enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrol.length;
      skipped += 1;
    }
    if (skipped >= enemy.patrol.length) {
      this._setMotion(enemy, 'idle');
      enemy.lastCombatAction = 'patrol_routes_cooling_down';
      enemy.wait = 0.3;
      return;
    }
    const target = enemy.patrol[enemy.patrolIndex];
    if (this._moveTowards(enemy, target, enemy.speed * 0.72, dt)) {
      enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrol.length;
      enemy.wait = 0.7 + enemy.random() * 1.5;
    }
  }

  _investigate(enemy, dt) {
    const investigateTarget = enemy.assaultActive && enemy.assaultTarget
      ? enemy.assaultTarget
      : enemy.lastKnownPlayer;
    const arrived = this._moveTowards(enemy, investigateTarget, enemy.speed * 0.82, dt);
    if (!arrived && enemy.alerted && enemy.immobileTime > 0.72) {
      this._repositionForFireLane(enemy, investigateTarget, 'blocked_investigation');
      return;
    }
    if (arrived) {
      this._setMotion(enemy, 'idle');
      enemy.lastCombatAction = enemy.assaultActive
        ? 'counterattack_hold_objective'
        : enemy.alerted ? 'hold_last_known' : 'observe';
      if (enemy.assaultActive) {
        this._face(enemy, enemy.assaultTarget, dt * 5);
        return;
      }
      if (enemy.stateTime > 2.2 + enemy.random() * 1.2) {
        this._setState(enemy, enemy.hasLOS ? 'attack' : 'patrol');
      }
    }
  }

  _takeCover(enemy, dt, playerEye) {
    if (!enemy.coverPoint) {
      this._setState(enemy, 'attack');
      return;
    }
    const arrived = this._moveTowards(enemy, enemy.coverPoint.position, enemy.speed * 1.05, dt);
    if (!arrived) {
      enemy.lastCombatAction = enemy.immobileTime > 0.12 ? 'blocked_reposition' : 'advance_to_cover';
      if (enemy.immobileTime > 0.72) {
        this._repositionForFireLane(enemy, enemy.lastKnownPlayer, 'blocked_cover_path');
      }
      return;
    }
    const aimPoint = enemy.hasLOS ? playerEye : enemy.lastKnownPlayer;
    this._face(enemy, aimPoint, dt * 5.5);
    this._setMotion(enemy, 'idle');
    if (enemy.hasLOS) {
      enemy.lastCombatAction = 'aim';
      this._fireControl(enemy, dt, playerEye, null);
    } else if (this.elapsed - enemy.lastSeenTime > LOST_LOS_COVER_GRACE) {
      // An occupied firing position without sight or a muzzle lane is not a
      // permanent waiting state. Move laterally, then investigate if no valid
      // combat step exists.
      if (!this._repositionForFireLane(enemy, enemy.lastKnownPlayer, 'lost_los_in_cover')) {
        this._setState(enemy, 'investigate');
      }
      return;
    }
    if (enemy.flankCooldown <= 0 && enemy.stateTime > 3.4 && enemy.random() < 0.012) {
      const flank = this._chooseCover(enemy, playerEye, true, null, enemy.coverPoint?.id);
      if (flank) {
        this._releaseCover(enemy);
        enemy.coverPoint = flank;
        this._setState(enemy, 'flank');
      }
    }
  }

  _flank(enemy, dt, playerEye) {
    if (!enemy.coverPoint) {
      this._setState(enemy, enemy.hasLOS ? 'attack' : 'investigate');
      return;
    }
    const arrived = this._moveTowards(enemy, enemy.coverPoint.position, enemy.speed * 1.18, dt);
    if (!arrived) {
      enemy.lastCombatAction = enemy.immobileTime > 0.12 ? 'blocked_reposition' : 'reposition';
      if (enemy.immobileTime > 0.72) {
        if (!this._repositionForFireLane(enemy, enemy.lastKnownPlayer, 'blocked_flank_path')) {
          this._setState(enemy, enemy.hasLOS ? 'attack' : 'investigate');
        }
      }
      return;
    }
    if (arrived) {
      enemy.flankCooldown = 4 + enemy.random() * 4;
      this._setState(enemy, 'attack');
      this._face(enemy, enemy.hasLOS ? playerEye : enemy.lastKnownPlayer, 1);
    }
  }

  _attack(enemy, dt, playerEye, playerFeet, playerVelocity, playerState) {
    this._setMotion(enemy, 'idle');
    if (enemy.hasLOS) {
      this._face(enemy, playerEye, dt * 7);
      enemy.lastCombatAction = 'aim';
      this._fireControl(enemy, dt, playerEye, { playerFeet, playerVelocity, playerState });
    } else if (this.elapsed - enemy.lastSeenTime > 0.78) {
      this._face(enemy, enemy.lastKnownPlayer, dt * 7);
      this._setState(enemy, 'investigate');
    } else {
      this._face(enemy, enemy.lastKnownPlayer, dt * 7);
      enemy.lastCombatAction = 'hold_last_known';
    }
  }

  _fireControl(enemy, dt, playerEye, context) {
    enemy.aimSettle += dt;
    if (enemy.aimSettle < 0.16 || enemy.shotTimer > 0) {
      enemy.lastCombatAction = 'aim';
      return false;
    }
    if (enemy.burstRemaining <= 0) {
      enemy.burstRemaining = 2 + Math.floor(enemy.random() * (enemy.isRusk ? 3 : 2));
    }
    const fired = this._fire(
      enemy,
      playerEye,
      context?.playerVelocity ?? new THREE.Vector3(),
      context?.playerState ?? {},
    );
    if (!fired) {
      // The eyes may be above cover while the rifle is still occluded. Wait for
      // a genuine muzzle lane instead of creating a through-wall bullet.
      enemy.shotTimer = 0.14 + enemy.random() * 0.12;
      enemy.aimSettle = Math.min(enemy.aimSettle, 0.2);
      enemy.fireLaneFailures += 1;
      enemy.fireLaneBlockedSince ??= this.elapsed;
      enemy.lastCombatAction = 'blocked_muzzle';
      if (
        enemy.fireLaneFailures >= FIRE_LANE_FAILURE_LIMIT ||
        this.elapsed - enemy.fireLaneBlockedSince >= 0.62
      ) {
        this._repositionForFireLane(enemy, playerEye, 'blocked_muzzle');
      }
      return false;
    }
    enemy.fireLaneFailures = 0;
    enemy.fireLaneBlockedSince = null;
    enemy.lastCombatAction = 'fire';
    enemy.burstRemaining -= 1;
    if (enemy.burstRemaining > 0) {
      enemy.shotTimer = 0.105 + enemy.random() * 0.055;
    } else {
      enemy.shotTimer = (enemy.isRusk ? 0.72 : 1.05) + enemy.random() * 1.05;
      enemy.aimSettle = 0.08;
    }
    return true;
  }

  _fire(enemy, playerEye, playerVelocity, playerState) {
    const origin = this._getMuzzleOrigin(enemy);
    const distance = origin.distanceTo(playerEye);
    const travel = Math.min(0.16, distance / 420);
    const target = playerEye.clone()
      .addScaledVector(playerVelocity, travel)
      .add(new THREE.Vector3(0, -0.28, 0));

    // Visibility from the face is not enough: ballistics always require a
    // clear path from the mounted weapon itself.
    if (this._segmentBlocked(origin, target)) return false;

    // This records an actual emitted round, not merely visual detection or an
    // attempted shot from behind cover. Damage uses it to distinguish a true
    // unanswered opening hit from the invisible internal LOS transition.
    enemy.hasFired = true;
    enemy.combatShotsFired += 1;

    const direction = target.clone().sub(origin).normalize();
    const right = new THREE.Vector3().crossVectors(direction, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, direction).normalize();
    const spread = this._shotSpread(
      distance,
      playerVelocity.length(),
      enemy.suppression,
      this.enemyAccuracyMultiplier,
    );
    direction
      .addScaledVector(right, gaussian(enemy.random) * spread)
      .addScaledVector(up, gaussian(enemy.random) * spread * 0.72)
      .normalize();

    const worldHit = this._raycastWorld(origin, direction, ENEMY_BALLISTIC_RANGE);
    const end = worldHit?.point?.clone?.() ?? origin.clone().addScaledVector(direction, ENEMY_BALLISTIC_RANGE);
    const bodyCenter = playerEye.clone().add(new THREE.Vector3(0, -0.42, 0));
    const toBody = bodyCenter.clone().sub(origin);
    const along = THREE.MathUtils.clamp(toBody.dot(direction), 0, origin.distanceTo(end));
    const closest = origin.clone().addScaledVector(direction, along);
    const hitRadius = playerState.crouched ? 0.43 : 0.47;
    const clearToPlayer = !this._segmentBlocked(origin, bodyCenter);
    const hitPlayer = clearToPlayer && along > 0 && closest.distanceTo(bodyCenter) <= hitRadius;
    if (hitPlayer) {
      const damage = enemy.isRusk ? 12 + enemy.random() * 3 : 8 + enemy.random() * 4;
      const incoming = direction.clone().negate();
      this._emit('onPlayerDamage', damage, enemy, {
        amount: damage,
        source: enemy,
        direction: incoming,
        armorRatio: 0.62,
      });
    }
    const tracerEnd = hitPlayer ? closest : end;
    this._spawnTracer(origin, tracerEnd);
    this._emit('onShot', {
      enemy,
      origin: origin.clone(),
      direction: direction.clone(),
      point: tracerEnd.clone(),
      distance,
      hitPlayer,
    });
    this._raiseLocalAlert(enemy, origin, 'gunshot', false);
    return true;
  }

  _shotSpread(
    distance,
    movementSpeed = 0,
    suppression = 0,
    multiplier = this.enemyAccuracyMultiplier,
  ) {
    const rangePenalty = Math.min(
      MAX_RANGE_SPREAD,
      Math.max(0, finite(distance, 0) - RANGE_SPREAD_START) * RANGE_SPREAD_PER_METER,
    );
    const movementPenalty = Math.min(
      MAX_MOVEMENT_SPREAD,
      Math.max(0, finite(movementSpeed, 0)) * MOVEMENT_SPREAD_PER_MPS,
    );
    const suppressionPenalty = Math.max(0, finite(suppression, 0)) * SUPPRESSION_SPREAD;
    return (
      BASE_SHOT_SPREAD + rangePenalty + movementPenalty + suppressionPenalty
    ) * THREE.MathUtils.clamp(finite(multiplier, 1), 0.2, 2);
  }

  _getMuzzleOrigin(enemy) {
    if (enemy.weapon && enemy.muzzle?.parent) {
      enemy.weapon.updateWorldMatrix(true, true);
      return enemy.muzzle.getWorldPosition(new THREE.Vector3());
    }

    // Defensive fallback for a failed/missing weapon asset. It deliberately
    // sits at the forward shoulder rather than the old head-height origin.
    enemy.root.updateWorldMatrix(true, false);
    return enemy.root.localToWorld(new THREE.Vector3(0.17, 1.25, 0.38));
  }

  _spawnTracer(start, end) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, this.tracerMaterial);
    line.name = 'EnemyTracer';
    line.frustumCulled = false;
    line.userData.noHit = true;
    this.scene.add(line);
    this.tracers.push({ line, life: 0.065 });
  }

  _updateTracers(dt) {
    for (let index = this.tracers.length - 1; index >= 0; index -= 1) {
      const tracer = this.tracers[index];
      tracer.life -= dt;
      if (tracer.life > 0) continue;
      tracer.line.geometry.dispose();
      tracer.line.removeFromParent();
      this.tracers.splice(index, 1);
    }
  }

  _canSee(enemy, playerEye) {
    const eye = enemy.root.position.clone().add(new THREE.Vector3(0, 1.58, 0));
    const toward = playerEye.clone().sub(eye);
    const distance = toward.length();
    const sightRange = enemy.alerted
      ? ALERTED_SIGHT_RANGE * (enemy.isRusk ? 1.08 : 1)
      : SIGHT_RANGE * (enemy.isRusk ? 1.16 : 1);
    if (distance > sightRange) return false;
    toward.normalize();
    enemy.root.getWorldDirection(this._a).setY(0).normalize();
    const horizontal = toward.clone().setY(0).normalize();
    const peripheralRange = enemy.alerted ? 13 : 7.5;
    const fovThreshold = enemy.alerted ? ALERTED_FOV_COSINE : FOV_COSINE;
    if (distance > peripheralRange && this._a.dot(horizontal) < fovThreshold) return false;
    return !this._segmentBlocked(eye, playerEye);
  }

  _moveTowards(enemy, targetValue, speed, dt) {
    const originalTarget = asVector3(targetValue);
    let target = originalTarget?.clone?.() ?? null;
    if (!target) return true;
    const originalDistance = enemy.root.position.distanceTo(originalTarget);
    if (originalDistance > 0.22) {
      enemy.movementIntent = true;
      enemy.movementIntentTarget ??= originalTarget.clone();
      enemy.movementIntentTarget.copy(originalTarget);
    }
    let escaping = false;
    if (enemy.escapeTarget) {
      if (enemy.root.position.distanceToSquared(enemy.escapeTarget) <= 0.22 * 0.22) {
        enemy.escapeTarget = null;
        enemy.escapeFailures = 0;
        enemy.immobileTime = 0;
        enemy.blockedTime = 0;
      } else {
        target.copy(enemy.escapeTarget);
        escaping = true;
      }
    }
    const delta = target.sub(enemy.root.position);
    delta.y = 0;
    const distance = delta.length();
    if (distance <= 0.22) return true;
    delta.multiplyScalar(Math.min(distance, speed * dt) / distance);
    const current = enemy.root.position.clone();
    let next = this._collisionAwareStep(enemy, current, delta);
    let displacement = next?.clone().sub(current) ?? new THREE.Vector3();
    const minimumUsefulStep = Math.max(0.004, speed * dt * 0.16);
    const usefulStep = () => displacement.lengthSq() >= minimumUsefulStep * minimumUsefulStep;

    if (!next || !usefulStep()) {
      if (this._startLowVault(enemy, current, originalTarget)) {
        enemy.blockedTime = 0;
        enemy.immobileTime = 0;
        return false;
      }
      enemy.blockedTime += dt;
      const direction = delta.clone().normalize();
      const side = new THREE.Vector3(-direction.z, 0, direction.x)
        .multiplyScalar(enemy.avoidanceSide * Math.min(speed * dt, 0.18));
      next = this._collisionAwareStep(enemy, current, side);
      displacement = next?.clone().sub(current) ?? new THREE.Vector3();
      if (!usefulStep() && enemy.blockedTime > 0.36) {
        enemy.avoidanceSide *= -1;
        enemy.blockedTime = 0.12;
      }
    } else {
      enemy.blockedTime = Math.max(0, enemy.blockedTime - dt * 3);
    }

    if (!next || !usefulStep()) {
      enemy.immobileTime += dt;
      this._setMotion(enemy, 'idle');
      if (enemy.alerted) enemy.lastCombatAction = 'blocked_reposition';
      if (enemy.immobileTime >= 0.46) {
        // A detour can become invalid when another guard, a door, or a moving
        // combat target changes the local lane. Never keep running toward that
        // failed escape point. Flip the sampling side and cap retries before
        // abandoning the authored route.
        if (enemy.escapeTarget) {
          enemy.escapeTarget = null;
          enemy.escapeFailures += 1;
          enemy.avoidanceSide *= -1;
        }
        const escape = this._findEscapePoint(enemy, current, originalTarget, enemy.progressRecoveries);
        if (escape && enemy.escapeFailures < 3) {
          enemy.escapeTarget = escape;
          enemy.stuckReplans += 1;
          enemy.avoidanceSide *= -1;
          enemy.immobileTime = 0;
          enemy.blockedTime = 0;
          enemy.lastCombatAction = 'obstacle_escape';
        } else if (enemy.immobileTime >= 1.1 || enemy.escapeFailures >= 3) {
          // Do not animate against an impossible route forever. Patrols skip
          // the blocked node; combatants discard the invalid cover choice and
          // let their state logic select another approach on the next frame.
          if (enemy.state === 'patrol' && enemy.patrol.length > 1) {
            enemy.blockedPatrolUntil ??= new Map();
            enemy.blockedPatrolUntil.set(enemy.patrolIndex, this.elapsed + 8);
            enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrol.length;
            enemy.wait = 0.35;
          } else {
            if (enemy.coverPoint?.id != null) {
              enemy.rejectedCoverUntil ??= new Map();
              enemy.rejectedCoverUntil.set(String(enemy.coverPoint.id), this.elapsed + 8);
              this._releaseCover(enemy);
            }
            enemy.coverPoint = null;
          }
          enemy.immobileTime = 0;
          enemy.blockedTime = 0;
          enemy.escapeTarget = null;
          enemy.escapeFailures = 0;
          enemy.lastCombatAction = 'blocked_route_abandoned';
        }
      }
      return false;
    }

    enemy.immobileTime = 0;
    enemy.root.position.copy(next);
    this._groundEnemy(enemy);
    this._face(enemy, enemy.root.position.clone().add(displacement), 1);
    const actualSpeed = displacement.length() / Math.max(dt, 1e-5);
    this._setMotion(enemy, actualSpeed > enemy.speed * 0.92 ? 'run' : 'walk');
    if (escaping) {
      if (enemy.root.position.distanceToSquared(enemy.escapeTarget) <= 0.22 * 0.22) {
        enemy.escapeTarget = null;
        enemy.escapeFailures = 0;
        enemy.blockedTime = 0;
      }
      return false;
    }
    return distance <= speed * dt + 0.22;
  }

  _startLowVault(enemy, current, targetValue) {
    if (enemy.vault) return true;
    const target = asVector3(targetValue);
    if (!target) return false;
    const direction = target.clone().sub(current).setY(0);
    if (direction.lengthSq() < 0.12 * 0.12) return false;
    direction.normalize();

    const lowObstacles = [];
    for (const collider of this.world?.colliders ?? []) {
      if (!collider || collider.blocking === false) continue;
      if (!['pipe', 'pipe_support', 'main_pipe'].includes(String(collider.kind))) continue;
      const box = collider.box?.isBox3 ? collider.box : null;
      if (!box) continue;
      const obstacleHeight = box.max.y - current.y;
      if (obstacleHeight <= BODY_STEP_HEIGHT + 0.02 || obstacleHeight > LOW_VAULT_MAX_HEIGHT) continue;
      if (box.min.y > current.y + LOW_VAULT_MAX_HEIGHT) continue;
      const interval = this._rayIntervalAgainstBox2D(current, direction, box, BODY_RADIUS + BODY_SKIN);
      if (!interval || interval.exit < 0 || interval.entry > 0.95) continue;
      const entry = Math.max(0, interval.entry);
      const depth = interval.exit - entry;
      if (depth > LOW_VAULT_MAX_DEPTH) continue;
      lowObstacles.push({ collider, box, entry, exit: interval.exit });
    }
    lowObstacles.sort((left, right) => left.entry - right.entry || left.exit - right.exit);
    const firstObstacle = lowObstacles[0];
    if (!firstObstacle) return false;
    const chosen = {
      entry: firstObstacle.entry,
      exit: firstObstacle.exit,
      colliders: new Set([firstObstacle.collider]),
    };
    for (const obstacle of lowObstacles.slice(1)) {
      if (obstacle.entry > chosen.exit + 0.22) break;
      if (Math.max(chosen.exit, obstacle.exit) - chosen.entry > LOW_VAULT_MAX_DEPTH) break;
      chosen.exit = Math.max(chosen.exit, obstacle.exit);
      chosen.colliders.add(obstacle.collider);
    }

    const landingDistance = Math.max(0.72, chosen.exit + BODY_RADIUS + 0.24);
    if (landingDistance > 2.25) return false;
    const landing = current.clone().addScaledVector(direction, landingDistance);
    const ground = this._groundHeightAt(landing.x, landing.z, current.y);
    if (Number.isFinite(ground)) landing.y = ground;
    if (!this._bodyPositionClear(enemy, landing, current)) return false;

    // A low pipe may be vaulted, but a wall, tank, machine or second actor at
    // the landing point remains authoritative. Check the complete corridor and
    // ignore only the selected low obstacle.
    for (const collider of this.world?.colliders ?? []) {
      if (!collider || chosen.colliders.has(collider) || collider.blocking === false) continue;
      const box = collider.box?.isBox3 ? collider.box : null;
      if (!box || box.max.y <= current.y + BODY_STEP_HEIGHT) continue;
      if (box.min.y >= current.y + BODY_HEIGHT) continue;
      const interval = this._rayIntervalAgainstBox2D(current, direction, box, BODY_RADIUS + BODY_SKIN);
      if (!interval) continue;
      if (interval.exit >= 0 && interval.entry <= landingDistance) return false;
    }

    enemy.vault = {
      start: current.clone(),
      end: landing,
      progress: 0,
      duration: THREE.MathUtils.clamp(0.38 + landingDistance * 0.09, 0.44, 0.62),
      obstacleId: [...chosen.colliders].map((collider) => collider.id ?? 'pipe').join('+'),
    };
    enemy.escapeTarget = null;
    enemy.lastCombatAction = 'vault_low_pipe';
    this._setMotion(enemy, 'run');
    this._face(enemy, landing, 1);
    return true;
  }

  _updateLowVault(enemy, dt) {
    const vault = enemy.vault;
    if (!vault) return false;
    vault.progress = Math.min(1, vault.progress + Math.max(0, dt) / Math.max(0.01, vault.duration));
    const t = vault.progress;
    enemy.root.position.lerpVectors(vault.start, vault.end, t);
    enemy.root.position.y += Math.sin(Math.PI * t) * 0.66;
    enemy.movementIntent = true;
    enemy.movementIntentTarget.copy(vault.end);
    enemy.lastCombatAction = 'vault_low_pipe';
    this._setMotion(enemy, 'run');
    this._face(enemy, vault.end, 1);
    if (t >= 1) {
      enemy.root.position.copy(vault.end);
      this._groundEnemy(enemy);
      enemy.vault = null;
      enemy.vaultsCompleted += 1;
      enemy.lastCombatAction = 'vault_landed';
    }
    return true;
  }

  _rayIntervalAgainstBox2D(origin, direction, box, padding = 0) {
    let entry = -Infinity;
    let exit = Infinity;
    for (const axis of ['x', 'z']) {
      const component = direction[axis];
      const minimum = box.min[axis] - padding;
      const maximum = box.max[axis] + padding;
      if (Math.abs(component) < 1e-8) {
        if (origin[axis] < minimum || origin[axis] > maximum) return null;
        continue;
      }
      let near = (minimum - origin[axis]) / component;
      let far = (maximum - origin[axis]) / component;
      if (near > far) [near, far] = [far, near];
      entry = Math.max(entry, near);
      exit = Math.min(exit, far);
      if (entry > exit) return null;
    }
    return { entry, exit };
  }

  _watchMovementProgress(enemy, dt) {
    const pursuingMovement = Boolean(enemy.movementIntent);
    if (!pursuingMovement) {
      enemy.progressAnchor.copy(enemy.root.position);
      enemy.progressTime = 0;
      if (this.elapsed > enemy.progressRecoveryUntil) enemy.progressRecoveries = 0;
      return;
    }

    const dx = enemy.root.position.x - enemy.progressAnchor.x;
    const dz = enemy.root.position.z - enemy.progressAnchor.z;
    if (dx * dx + dz * dz >= 0.18 * 0.18) {
      enemy.progressAnchor.copy(enemy.root.position);
      enemy.progressTime = 0;
      if (this.elapsed > enemy.progressRecoveryUntil) enemy.progressRecoveries = 0;
      return;
    }

    enemy.progressTime += dt;
    if (enemy.progressTime < 0.85) return;

    // A guard can make millimetre-scale slide/turn steps that satisfy the
    // per-frame collision solver yet still look like running in place. This
    // longer-window watchdog stops the animation, abandons that local target,
    // and forces a different authored or sampled route.
    this._setMotion(enemy, 'idle');
    enemy.escapeTarget = null;
    enemy.escapeFailures = 0;
    enemy.blockedTime = 0;
    enemy.immobileTime = 0;
    enemy.avoidanceSide *= -1;
    enemy.progressRecoveries = this.elapsed <= enemy.progressRecoveryUntil
      ? enemy.progressRecoveries + 1
      : 1;
    enemy.progressRecoveryUntil = this.elapsed + 5;
    enemy.stuckReplans += 1;
    let target = enemy.movementIntentTarget?.clone?.() ?? enemy.lastKnownPlayer.clone();
    if (enemy.state === 'patrol' && enemy.patrol.length > 1) {
      enemy.blockedPatrolUntil ??= new Map();
      enemy.blockedPatrolUntil.set(enemy.patrolIndex, this.elapsed + 8);
      for (let attempt = 0; attempt < enemy.patrol.length; attempt += 1) {
        enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrol.length;
        if ((enemy.blockedPatrolUntil.get(enemy.patrolIndex) ?? -Infinity) <= this.elapsed) break;
      }
      target = enemy.patrol[enemy.patrolIndex]?.clone?.() ?? target;
      enemy.wait = 0.18;
    } else {
      if (enemy.coverPoint?.id != null) {
        enemy.rejectedCoverUntil ??= new Map();
        enemy.rejectedCoverUntil.set(String(enemy.coverPoint.id), this.elapsed + 8);
      }
      this._releaseCover(enemy);
      target = enemy.assaultTarget?.clone?.() ?? enemy.lastKnownPlayer.clone();
    }

    const escape = this._findEscapePoint(
      enemy,
      enemy.root.position,
      target,
      Math.max(0, enemy.progressRecoveries - 1),
    );
    if (escape) {
      enemy.escapeTarget = escape;
      // Separate an overlapped/stalled guard immediately with one fully swept,
      // collision-validated step. Subsequent frames follow the escape target.
      const rescueDelta = escape.clone().sub(enemy.root.position).setY(0);
      rescueDelta.setLength(Math.min(0.3, rescueDelta.length()));
      const rescued = this._collisionAwareStep(enemy, enemy.root.position, rescueDelta);
      if (rescued && rescued.distanceToSquared(enemy.root.position) >= 0.04 * 0.04) {
        const previous = enemy.root.position.clone();
        enemy.root.position.copy(rescued);
        this._groundEnemy(enemy);
        this._face(enemy, rescued.clone().add(rescued).sub(previous), 1);
      }
    } else if (!enemy.technician && enemy.state !== 'patrol') {
      this._setState(enemy, 'investigate');
    }
    enemy.lastCombatAction = 'watchdog_repath';
    enemy.movementIntent = false;
    enemy.progressAnchor.copy(enemy.root.position);
    enemy.progressTime = 0;
  }

  _findEscapePoint(enemy, current, target, recoveryLevel = 0) {
    const baseAngle = Math.atan2(target.z - current.z, target.x - current.x);
    let best = null;
    let bestScore = -Infinity;
    const radii = recoveryLevel > 0 ? [1.12, 1.65, 2.3, 0.72] : [0.72, 1.12];
    const preferredSide = new THREE.Vector3(
      -Math.sin(baseAngle) * enemy.avoidanceSide,
      0,
      Math.cos(baseAngle) * enemy.avoidanceSide,
    );
    for (const radius of radii) {
      for (let index = 0; index < 24; index += 1) {
        const angle = baseAngle + (index / 24) * Math.PI * 2;
        const candidate = current.clone().add(new THREE.Vector3(
          Math.cos(angle) * radius,
          0,
          Math.sin(angle) * radius,
        ));
        if (!this._bodyPositionClear(enemy, candidate, current)) continue;
        if (this._bodySweepBlocked(current, candidate)) continue;
        const progress = current.distanceTo(target) - candidate.distanceTo(target);
        if (progress < -radius * 0.32) continue;
        let neighborClearance = 2.5;
        for (const other of this.enemies) {
          if (other === enemy || !other.active || other.dead || other.surrendered) continue;
          neighborClearance = Math.min(neighborClearance, candidate.distanceTo(other.root.position));
        }
        const lateralPreference = candidate.clone().sub(current).dot(preferredSide) * 0.08;
        const score = progress * 1.35 + lateralPreference + neighborClearance * 0.12 + radius * 0.025;
        if (score <= bestScore) continue;
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  _collisionAwareStep(enemy, current, delta) {
    if (delta.lengthSq() < 1e-9) return current.clone();
    const desiredDirection = delta.clone().normalize();
    const candidates = [];
    const resolved = this._resolveMovement(enemy, current, delta);
    if (resolved) candidates.push(resolved);
    candidates.push(
      current.clone().add(delta),
      current.clone().add(new THREE.Vector3(delta.x, 0, 0)),
      current.clone().add(new THREE.Vector3(0, 0, delta.z)),
    );

    let best = null;
    let bestProgress = -Infinity;
    for (const candidate of candidates) {
      candidate.y = current.y;
      const displacement = candidate.clone().sub(current);
      if (displacement.lengthSq() < 1e-9) continue;
      if (!this._bodyPositionClear(enemy, candidate, current)) continue;
      if (this._bodySweepBlocked(current, candidate)) continue;
      const progress = displacement.dot(desiredDirection) - Math.abs(displacement.dot(
        new THREE.Vector3(-desiredDirection.z, 0, desiredDirection.x),
      )) * 0.08;
      if (progress > bestProgress) {
        bestProgress = progress;
        best = candidate;
      }
    }
    return best ?? current.clone();
  }

  _bodyPositionClear(enemy, position, current = null) {
    const colliders = Array.isArray(this.world?.colliders) ? this.world.colliders : [];
    for (const collider of colliders) {
      if (!collider || collider.blocking === false) continue;
      const box = collider.box?.isBox3
        ? collider.box
        : collider.min && collider.max
          ? new THREE.Box3(asVector3(collider.min), asVector3(collider.max))
          : null;
      if (!box) continue;
      if (box.max.y <= position.y + BODY_STEP_HEIGHT && box.min.y <= position.y + BODY_SKIN) continue;
      if (box.min.y >= position.y + BODY_HEIGHT - BODY_SKIN) continue;
      const penetration = this._circleBoxPenetration(position, box, BODY_RADIUS + BODY_SKIN);
      if (penetration <= 0) continue;
      const previousPenetration = current
        ? this._circleBoxPenetration(current, box, BODY_RADIUS + BODY_SKIN)
        : 0;
      // Authored spawn points may touch an expanded collider. They may move
      // outward, but can never maintain or deepen that overlap.
      if (previousPenetration > penetration + 1e-4) continue;
      return false;
    }

    for (const other of this.enemies) {
      if (other === enemy || !other.active || other.dead || other.surrendered) continue;
      if (Math.abs(other.root.position.y - position.y) > BODY_HEIGHT * 0.72) continue;
      const dx = position.x - other.root.position.x;
      const dz = position.z - other.root.position.z;
      const minimum = BODY_RADIUS * 1.72;
      const nextDistanceSq = dx * dx + dz * dz;
      if (nextDistanceSq >= minimum * minimum) continue;
      if (current) {
        const oldDx = current.x - other.root.position.x;
        const oldDz = current.z - other.root.position.z;
        if (nextDistanceSq > oldDx * oldDx + oldDz * oldDz + 1e-5) continue;
      }
      return false;
    }
    return true;
  }

  _circleBoxPenetration(position, box, radius) {
    const nearestX = THREE.MathUtils.clamp(position.x, box.min.x, box.max.x);
    const nearestZ = THREE.MathUtils.clamp(position.z, box.min.z, box.max.z);
    const dx = position.x - nearestX;
    const dz = position.z - nearestZ;
    const distance = Math.hypot(dx, dz);
    if (distance > 1e-7) return Math.max(0, radius - distance);
    const edgeDistance = Math.min(
      Math.abs(position.x - box.min.x),
      Math.abs(box.max.x - position.x),
      Math.abs(position.z - box.min.z),
      Math.abs(box.max.z - position.z),
    );
    return radius + edgeDistance;
  }

  _bodySweepBlocked(current, next) {
    if (typeof this.world?.segmentBlocked !== 'function') return false;
    const travel = next.clone().sub(current).setY(0);
    if (travel.lengthSq() < 1e-9) return false;
    const perpendicular = new THREE.Vector3(-travel.z, 0, travel.x)
      .normalize()
      .multiplyScalar(BODY_RADIUS * 0.88);
    const offsets = [new THREE.Vector3(), perpendicular, perpendicular.clone().negate()];
    for (const offset of offsets) {
      const start = current.clone().add(offset).addScaledVector(UP, 0.82);
      const end = next.clone().add(offset).addScaledVector(UP, 0.82);
      if (this._segmentBlocked(start, end)) return true;
    }
    return false;
  }

  _face(enemy, targetValue, amount = 1) {
    const target = asVector3(targetValue);
    if (!target) return;
    target.y = enemy.root.position.y;
    if (target.distanceToSquared(enemy.root.position) < 1e-6) return;
    const desired = new THREE.Object3D();
    desired.position.copy(enemy.root.position);
    desired.lookAt(target);
    enemy.root.quaternion.slerp(desired.quaternion, clamp01(amount));
  }

  _setState(enemy, state) {
    if (enemy.state === state) return;
    enemy.state = state;
    enemy.stateTime = 0;
    enemy.aimSettle = 0;
    if (state === 'attack') {
      enemy.lastCombatAction = 'aim';
      this._setMotion(enemy, 'idle');
    } else if (state === 'cover') {
      enemy.lastCombatAction = 'advance_to_cover';
    } else if (state === 'flank') {
      enemy.lastCombatAction = 'reposition';
    } else if (state === 'investigate') {
      enemy.lastCombatAction = enemy.assaultActive ? 'counterattack_advance' : 'advance_to_contact';
    } else if (state === 'patrol') {
      enemy.lastCombatAction = 'patrol';
    }
    if (state === 'cover' || state === 'flank' || state === 'investigate') {
      enemy.fireLaneFailures = 0;
      enemy.fireLaneBlockedSince = null;
    }
  }

  _repositionForFireLane(enemy, threatValue, reason = 'blocked_muzzle') {
    const threat = asVector3(threatValue, enemy.lastKnownPlayer ?? enemy.root.position);
    const currentCoverId = enemy.coverPoint?.id ?? null;
    const authored = this._chooseCover(enemy, threat, true, null, currentCoverId);
    if (authored) {
      this._releaseCover(enemy);
      enemy.coverPoint = authored;
      enemy.avoidanceSide *= -1;
      this._setState(enemy, 'flank');
      enemy.stateTime = 0;
      enemy.aimSettle = 0;
      enemy.immobileTime = 0;
      enemy.fireLaneFailures = 0;
      enemy.fireLaneBlockedSince = null;
      enemy.lastCombatAction = reason === 'blocked_muzzle' ? 'reposition_for_fire_lane' : 'reposition';
      return true;
    }

    const toward = threat.clone().sub(enemy.root.position).setY(0);
    if (toward.lengthSq() < 1e-6) toward.copy(FORWARD);
    toward.normalize();
    const lateral = new THREE.Vector3(-toward.z, 0, toward.x);
    const distances = [1.65, -1.65, 2.35, -2.35];
    for (const signedDistance of distances) {
      const side = signedDistance * enemy.avoidanceSide;
      const desiredCandidate = enemy.root.position.clone()
        .addScaledVector(lateral, side)
        .addScaledVector(toward, 0.32);
      const desiredDelta = desiredCandidate.clone().sub(enemy.root.position);
      const resolved = this._resolveMovement(enemy, enemy.root.position, desiredDelta);
      const candidate = resolved ?? desiredCandidate;
      if (candidate.distanceToSquared(enemy.root.position) < desiredDelta.lengthSq() * 0.32) continue;
      if (!this._bodyPositionClear(enemy, candidate, enemy.root.position)) continue;
      if (this._bodySweepBlocked(enemy.root.position, candidate)) continue;
      this._releaseCover(enemy);
      enemy.coverPoint = {
        id: `combat_reposition_${enemy.id}`,
        position: candidate,
        dynamic: true,
        reason,
      };
      enemy.avoidanceSide *= -1;
      this._setState(enemy, 'flank');
      enemy.stateTime = 0;
      enemy.aimSettle = 0;
      enemy.immobileTime = 0;
      enemy.fireLaneFailures = 0;
      enemy.fireLaneBlockedSince = null;
      enemy.lastCombatAction = reason === 'blocked_muzzle' ? 'reposition_for_fire_lane' : 'reposition';
      return true;
    }

    enemy.fireLaneFailures = 0;
    enemy.fireLaneBlockedSince = null;
    enemy.immobileTime = 0;
    enemy.avoidanceSide *= -1;
    enemy.lastCombatAction = 'advance_to_contact';
    this._setState(enemy, 'investigate');
    return false;
  }

  _setMotion(enemy, name, immediate = false) {
    if (enemy.motion === name || !enemy.actions[name]) return;
    const next = enemy.actions[name];
    const previous = enemy.motion ? enemy.actions[enemy.motion] : null;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (previous && previous !== next) {
      if (immediate) previous.stop();
      else previous.crossFadeTo(next, 0.18, true);
    }
    enemy.motion = name;
  }

  _raiseLocalAlert(source, positionValue, reason = 'visual', notifySource = true) {
    const position = asVector3(positionValue, source.root.position);
    if (!position) return;
    // An emitted enemy round is already downstream of a visual alert. Do not
    // replace the facility's last-known player position with the shooter's own
    // muzzle when _fire() records the sound.
    if (this.facilityAlerted && reason === 'gunshot' && !notifySource) return;

    const firstFacilityAlert = !this.facilityAlerted;
    this.facilityAlerted = true;
    this.facilityAlertPosition.copy(position);
    this.facilityAlertReason = reason;
    if (firstFacilityAlert) {
      this.facilityAlertCount += 1;
      this._emit('onAlert', source, { reason, position: position.clone() });
    }

    // The Clearwater guards share one radio net. The first credible visual,
    // gunshot or casualty cue wakes the complete roster once; authored squads
    // no longer remain on patrol because they happen to use another group id.
    for (const enemy of this.enemies) {
      if (!enemy.active || enemy.dead || enemy.surrendered) continue;
      enemy.pendingAlert = null;
      enemy.alerted = true;
      enemy.lastKnownPlayer.copy(position);
      enemy.reaction = Math.min(enemy.reaction, enemy === source ? 0 : 0.045 + enemy.random() * 0.045);
      enemy.shotTimer = Math.min(enemy.shotTimer, 0.12 + enemy.random() * 0.08);
      this._face(enemy, position, 1);
      if (enemy.technician || enemy.operationAssignment) {
        enemy.lastCombatAction = 'guard_controls_under_facility_alert';
        continue;
      }
      if (firstFacilityAlert && enemy.state === 'patrol') {
        this._releaseCover(enemy);
        this._setState(enemy, 'investigate');
      }
      enemy.lastCombatAction = enemy.hasLOS ? 'facility_alert_contact' : 'facility_alert_reinforce';
    }
  }

  _ingestPlayerNoise(playerState, position, dt = 0) {
    this.movementNoiseTimer -= Math.max(0, dt);
    const firing = Boolean(playerState.firing ?? playerState.weapon?.firing ?? playerState.shot);
    const token = playerState.shotSerial ?? playerState.shotCounter ?? playerState.lastShotTime ?? null;
    const fresh = token != null ? token !== this.lastNoiseToken : firing && !this.playerWasFiring;
    this.playerWasFiring = firing;
    if (token != null) this.lastNoiseToken = token;

    if (fresh) {
      const noisePosition = asVector3(playerState.shotOrigin ?? playerState.noisePosition, position);
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.surrendered || enemy.hasLOS) continue;
        const distance = enemy.root.position.distanceTo(noisePosition);
        if (distance > HEARING_RANGE) continue;
        this._queueAlert(
          enemy,
          noisePosition,
          0.08 + distance / 72 + enemy.random() * 0.14,
          'player_gunshot',
        );
      }
    }

    const moving = Boolean(playerState.moving) && finite(playerState.speed) > 0.35;
    if (!moving || this.movementNoiseTimer > 0) return;
    const sprinting = Boolean(playerState.sprinting);
    const crouched = Boolean(playerState.crouched);
    const footstepRange = crouched ? 3.2 : sprinting ? 15.5 : 7.5;
    this.movementNoiseTimer = crouched ? 0.72 : sprinting ? 0.28 : 0.48;
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.surrendered || enemy.hasLOS) continue;
      const distance = enemy.root.position.distanceTo(position);
      if (distance > footstepRange) continue;
      const ear = enemy.root.position.clone().addScaledVector(UP, 1.55);
      const occluded = this._segmentBlocked(ear, position);
      if (occluded && distance > footstepRange * 0.58) continue;
      this._queueAlert(
        enemy,
        position,
        0.12 + distance / 42 + (occluded ? 0.2 : 0) + enemy.random() * 0.12,
        sprinting ? 'sprint' : crouched ? 'crouch_step' : 'footstep',
      );
    }
  }

  _queueAlert(enemy, positionValue, delay, reason) {
    const position = asVector3(positionValue);
    if (!position || enemy.dead || enemy.surrendered) return;
    const queued = {
      position,
      delay: Math.max(0.02, finite(delay, 0.2)),
      reason: String(reason ?? 'noise'),
    };
    if (!enemy.pendingAlert || queued.delay < enemy.pendingAlert.delay) {
      enemy.pendingAlert = queued;
    } else if (queued.reason === 'player_gunshot') {
      // Even if the earlier cue resolves first, keep the newest, most useful
      // search location from a loud player weapon.
      enemy.pendingAlert.position.copy(position);
      enemy.pendingAlert.reason = queued.reason;
    }
  }

  _chooseCover(enemy, threatValue, flank = false, preferredId = null, excludeId = null) {
    const points = this._getCoverPoints(enemy.group);
    if (!points.length) return null;
    const threat = asVector3(threatValue, enemy.root.position);
    let best = null;
    let bestScore = Infinity;
    for (const source of points) {
      const position = asVector3(source?.position ?? source);
      if (!position) continue;
      const id = String(source?.id ?? `${position.x},${position.y},${position.z}`);
      if (excludeId != null && id === String(excludeId)) continue;
      enemy.rejectedCoverUntil ??= new Map();
      const rejectedUntil = enemy.rejectedCoverUntil.get(id) ?? -Infinity;
      if (rejectedUntil > this.elapsed) continue;
      enemy.rejectedCoverUntil.delete(id);
      const reserved = this.coverReservations.get(id);
      if (reserved && reserved !== enemy.id) continue;
      if (preferredId && id !== String(preferredId)) continue;
      const travel = position.distanceTo(enemy.root.position);
      if (travel > 24) continue;
      const lateral = Math.abs(
        (position.x - threat.x) * (enemy.root.position.z - threat.z) -
        (position.z - threat.z) * (enemy.root.position.x - threat.x),
      );
      let score = travel + (flank ? -Math.min(8, lateral * 0.08) : 0);
      if (source?.zone && String(source.zone) !== enemy.group) score += 7;
      if (typeof this.world?.isCoverValid === 'function' && !this.world.isCoverValid(source, threat, enemy)) continue;
      if (score < bestScore) {
        bestScore = score;
        best = { ...source, id, position };
      }
    }
    if (best) this.coverReservations.set(best.id, enemy.id);
    return best;
  }

  _releaseCover(enemy) {
    if (!enemy.coverPoint) return;
    if (this.coverReservations.get(enemy.coverPoint.id) === enemy.id) {
      this.coverReservations.delete(enemy.coverPoint.id);
    }
    enemy.coverPoint = null;
  }

  _fallenBodyClearance(rootPosition, direction) {
    const colliders = Array.isArray(this.world?.colliders) ? this.world.colliders : [];
    let overlap = 0;
    let minimumClearance = 3;
    for (const collider of colliders) {
      if (!collider || collider.blocking === false) continue;
      const box = collider.box?.isBox3
        ? collider.box
        : collider.min && collider.max
          ? new THREE.Box3(asVector3(collider.min), asVector3(collider.max))
          : null;
      if (!box) continue;
      // Ignore floors and high overhead fixtures; only geometry crossing the
      // final torso volume can invalidate a landing direction.
      if (box.max.y <= rootPosition.y + 0.18 || box.min.y >= rootPosition.y + FALLEN_BODY_HEIGHT) continue;
      for (let sampleIndex = 0; sampleIndex <= 8; sampleIndex += 1) {
        const sample = rootPosition.clone().addScaledVector(
          direction,
          FALLEN_BODY_LENGTH * (sampleIndex / 8),
        );
        const nearestX = THREE.MathUtils.clamp(sample.x, box.min.x, box.max.x);
        const nearestZ = THREE.MathUtils.clamp(sample.z, box.min.z, box.max.z);
        const clearance = Math.hypot(sample.x - nearestX, sample.z - nearestZ) - FALLEN_BODY_RADIUS;
        minimumClearance = Math.min(minimumClearance, clearance);
        overlap += this._circleBoxPenetration(sample, box, FALLEN_BODY_RADIUS);
      }
    }
    return {
      clear: overlap <= 1e-5,
      overlap,
      minimumClearance,
    };
  }

  _fallenBodySurfaceHeight(rootPosition, direction) {
    let supportHeight = rootPosition.y;
    // A prone character spans far more than its standing footprint. Sample the
    // complete landing lane and use its highest walkable surface so a body
    // crossing a road edge cannot sink into the higher slab.
    for (let sampleIndex = 0; sampleIndex <= 8; sampleIndex += 1) {
      const sample = rootPosition.clone().addScaledVector(
        direction,
        FALLEN_BODY_LENGTH * (sampleIndex / 8),
      );
      const height = this._groundHeightAt(sample.x, sample.z, rootPosition.y + 0.55);
      if (Number.isFinite(height)) supportHeight = Math.max(supportHeight, height);
    }
    return supportHeight;
  }

  _chooseDeathPose(enemy) {
    const start = enemy.root.position.clone();
    enemy.root.getWorldDirection(this._a).setY(0);
    if (this._a.lengthSq() < 1e-6) this._a.copy(FORWARD);
    this._a.normalize().negate();
    const preferredAngle = Math.atan2(this._a.z, this._a.x);
    let best = null;
    for (const shiftRadius of [0, 0.18, 0.34]) {
      const shiftCount = shiftRadius === 0 ? 1 : 8;
      for (let shiftIndex = 0; shiftIndex < shiftCount; shiftIndex += 1) {
        const shiftAngle = preferredAngle + (shiftIndex / shiftCount) * Math.PI * 2;
        const targetPosition = start.clone().add(new THREE.Vector3(
          Math.cos(shiftAngle) * shiftRadius,
          0,
          Math.sin(shiftAngle) * shiftRadius,
        ));
        if (shiftRadius > 0 && this._bodySweepBlocked(start, targetPosition)) continue;
        for (let directionIndex = 0; directionIndex < 16; directionIndex += 1) {
          const angle = preferredAngle + (directionIndex / 16) * Math.PI * 2;
          const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
          const supportedPosition = targetPosition.clone().setY(
            this._fallenBodySurfaceHeight(targetPosition, direction),
          );
          const clearance = this._fallenBodyClearance(supportedPosition, direction);
          const preference = direction.dot(this._a) * 0.18;
          const score = (clearance.clear ? 100 : 0) - clearance.overlap * 38 +
            clearance.minimumClearance + preference - shiftRadius * 0.7;
          if (best && score <= best.score) continue;
          best = { score, targetPosition: supportedPosition, direction, ...clearance };
        }
      }
    }
    const direction = best?.direction ?? this._a.clone();
    const targetPosition = best?.targetPosition ?? start;
    // Build a supine basis: local +Y runs feet-to-head along the chosen clear
    // lane while local +Z (the character's chest/face) points upward.
    const xAxis = direction.clone().cross(UP).normalize();
    const matrix = new THREE.Matrix4().makeBasis(xAxis, direction, UP);
    return {
      targetPosition,
      targetQuaternion: new THREE.Quaternion().setFromRotationMatrix(matrix),
      direction,
      collisionFree: Boolean(best?.clear),
      clearance: best?.minimumClearance ?? null,
    };
  }

  _downEnemy(enemy, region) {
    enemy.dead = true;
    enemy.active = false;
    enemy.state = 'dead';
    enemy.health = 0;
    this._releaseCover(enemy);
    // Freeze the last shouldered arm pose; fading an unarmed clip here would
    // reopen both arms into a T-pose during the fall.
    enemy.mixer.stopAllAction();
    this._disableProxies(enemy);
    const side = enemy.random() < 0.5 ? -1 : 1;
    const deathPose = this._chooseDeathPose(enemy);
    let weaponDrop = null;
    if (enemy.weaponMount?.parent) {
      enemy.weaponMount.updateWorldMatrix(true, true);
      const worldPosition = enemy.weaponMount.getWorldPosition(new THREE.Vector3());
      const worldQuaternion = enemy.weaponMount.getWorldQuaternion(new THREE.Quaternion());
      enemy.weaponMount.removeFromParent();
      this.root.add(enemy.weaponMount);
      enemy.weaponMount.position.copy(this.root.worldToLocal(worldPosition));
      const parentQuaternion = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      enemy.weaponMount.quaternion.copy(parentQuaternion.multiply(worldQuaternion));
      weaponDrop = {
        startPosition: enemy.weaponMount.position.clone(),
        startQuaternion: enemy.weaponMount.quaternion.clone(),
        targetPosition: deathPose.targetPosition.clone()
          .add(new THREE.Vector3(-deathPose.direction.z, 0, deathPose.direction.x).multiplyScalar(side * 0.48))
          .addScaledVector(deathPose.direction, 0.62)
          .setY(deathPose.targetPosition.y + 0.105),
        targetQuaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(
          0.04,
          enemy.root.rotation.y + side * 0.28,
          side * 1.18,
          'YXZ',
        )),
      };
    }
    enemy.death = {
      time: 0,
      duration: 0.78 + enemy.random() * 0.16,
      startPosition: enemy.root.position.clone(),
      targetPosition: deathPose.targetPosition.clone(),
      startQuaternion: enemy.root.quaternion.clone(),
      settleHeight: FALLEN_BODY_SURFACE_CLEARANCE,
      targetQuaternion: deathPose.targetQuaternion,
      fallDirection: deathPose.direction.clone(),
      collisionFree: deathPose.collisionFree,
      clearance: deathPose.clearance,
      weaponDrop,
    };
    if (enemy.operationAssignment) {
      const site = this.operationalSites.get(enemy.operationAssignment);
      if (site?.operatorId === enemy.id) site.operatorId = null;
    }
    this._alertAlliesToCasualty(enemy);
    this._coordinateOperationalSites();
    this._dispatchCasualtyReinforcement(enemy);
    this._emit('onEnemyDown', enemy, {
      id: enemy.id,
      name: enemy.name,
      isRusk: false,
      technician: enemy.technician,
      specialty: enemy.specialty,
      missionAssetId: enemy.missionAssetId,
      headshot: region === 'head',
      region,
    });
  }

  _alertAlliesToCasualty(downed) {
    const shooter = downed.lastKnownPlayer?.clone?.() ?? downed.root.position.clone();
    this._raiseLocalAlert(downed, shooter, 'ally_casualty');
    for (const ally of this.enemies) {
      if (ally === downed || !ally.active || ally.dead || ally.surrendered) continue;
      const distance = ally.root.position.distanceTo(downed.root.position);
      if (distance > CASUALTY_ALERT_RANGE) continue;
      ally.casualtyAlertsReceived += 1;
      ally.lastCasualtyId = downed.id;
      const occluded = this._segmentBlocked(
        downed.root.position.clone().addScaledVector(UP, 1.15),
        ally.root.position.clone().addScaledVector(UP, 1.5),
      );
      if (distance <= CASUALTY_IMMEDIATE_RANGE) {
        ally.pendingAlert = null;
        ally.alerted = true;
        ally.reaction = 0;
        ally.lastKnownPlayer.copy(shooter);
        ally.lastSeenTime = this.elapsed;
        ally.aimSettle = Math.min(ally.aimSettle, 0.08);
        ally.shotTimer = Math.min(ally.shotTimer, 0.16 + ally.random() * 0.08);
        this._face(ally, shooter, 1);
        if (!ally.technician && !ally.operationAssignment) {
          this._releaseCover(ally);
          const cover = this._chooseCover(ally, shooter, false);
          if (cover) {
            ally.coverPoint = cover;
          }
          this._setState(ally, cover ? 'cover' : 'attack');
          ally.lastCombatAction = cover ? 'react_to_casualty_cover' : 'react_to_casualty';
        } else {
          ally.lastCombatAction = 'operation_under_fire';
        }
      } else {
        this._queueAlert(
          ally,
          shooter,
          0.035 + distance / 120 + (occluded ? 0.09 : 0) + ally.random() * 0.06,
          'ally_casualty',
        );
      }
    }
  }

  _dispatchCasualtyReinforcement(downed) {
    // Intake and treatment-apron posts form the exposed exterior screen. When
    // one goes quiet, a surviving indoor rifleman physically moves to the
    // casualty position instead of every room continuing its patrol as if
    // nothing happened. Specialists and the cell leader retain their jobs.
    if (!EXTERIOR_SECURITY_GROUPS.has(downed.group)) return null;
    const target = downed.root.position.clone();
    const responder = this.enemies
      .filter((enemy) => (
        enemy.active && !enemy.dead && !enemy.surrendered &&
        enemy.group !== 'intake' && !enemy.technician && !enemy.isCellLeader &&
        !enemy.reinforcingCasualtyId && !enemy.assaultActive
      ))
      .sort((left, right) => (
        left.root.position.distanceToSquared(target) - right.root.position.distanceToSquared(target) ||
        String(left.id).localeCompare(String(right.id))
      ))[0] ?? null;
    if (!responder) return null;
    responder.reinforcingCasualtyId = downed.id;
    responder.alerted = true;
    responder.pendingAlert = null;
    responder.reaction = 0;
    responder.lastKnownPlayer.copy(target);
    responder.assaultTarget = target;
    responder.assaultActive = true;
    responder.assaultDelay = 0.18 + responder.random() * 0.22;
    this._releaseCover(responder);
    this._setState(responder, 'investigate');
    responder.lastCombatAction = 'reinforce_fallen_guard';
    this._emit('onReinforcementDispatch', {
      casualtyId: downed.id,
      responderId: responder.id,
      target: target.clone(),
    });
    return responder;
  }

  _updateDeath(enemy, dt) {
    if (!enemy.death) return;
    enemy.death.time += dt;
    const t = easeOutCubic(enemy.death.time / enemy.death.duration);
    enemy.root.quaternion.slerpQuaternions(enemy.death.startQuaternion, enemy.death.targetQuaternion, t);
    enemy.root.position.lerpVectors(enemy.death.startPosition, enemy.death.targetPosition, t);
    // Lift the rotated rig through the fall, then retain a measured prone-body
    // clearance above the highest road/foundation/terrain sample below it.
    enemy.root.position.y += Math.sin(Math.PI * t) * 0.035 + enemy.death.settleHeight * t;
    const drop = enemy.death.weaponDrop;
    if (drop && enemy.weaponMount) {
      enemy.weaponMount.position.lerpVectors(drop.startPosition, drop.targetPosition, t);
      enemy.weaponMount.position.y += Math.sin(Math.PI * t) * 0.16;
      enemy.weaponMount.quaternion.slerpQuaternions(drop.startQuaternion, drop.targetQuaternion, t);
    }
  }

  _surrenderRusk(enemy) {
    if (enemy.surrendered) return;
    enemy.surrendered = true;
    enemy.active = false;
    enemy.state = 'surrender';
    enemy.burstRemaining = 0;
    this._releaseCover(enemy);
    this._disableProxies(enemy);
    enemy.mixer.stopAllAction();
    const leftArm = this._findBone(enemy.visual, ['bip01lupperarm', 'lupperarm', 'leftarm']);
    const rightArm = this._findBone(enemy.visual, ['bip01rupperarm', 'rupperarm', 'rightarm']);
    enemy.surrender = {
      time: 0,
      weaponDropped: false,
      leftArm,
      rightArm,
      leftStart: leftArm?.quaternion.clone(),
      rightStart: rightArm?.quaternion.clone(),
      leftTarget: leftArm?.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.05))),
      rightTarget: rightArm?.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.05))),
    };
    this._emit('onRuskSurrender', enemy, {
      id: enemy.id,
      name: enemy.name,
      isRusk: true,
      surrendered: true,
      nonlethal: true,
    });
  }

  _updateSurrender(enemy, dt) {
    if (!enemy.surrender) return;
    enemy.surrender.time += dt;
    const t = easeOutCubic(enemy.surrender.time / 1.15);
    if (enemy.surrender.leftArm) {
      enemy.surrender.leftArm.quaternion.slerpQuaternions(enemy.surrender.leftStart, enemy.surrender.leftTarget, t);
    }
    if (enemy.surrender.rightArm) {
      enemy.surrender.rightArm.quaternion.slerpQuaternions(enemy.surrender.rightStart, enemy.surrender.rightTarget, t);
    }
    if (!enemy.surrender.weaponDropped && enemy.surrender.time >= 0.52) {
      enemy.surrender.weaponDropped = true;
      if (enemy.weaponMount) {
        const worldPosition = enemy.weaponMount.getWorldPosition(new THREE.Vector3());
        const worldQuaternion = enemy.weaponMount.getWorldQuaternion(new THREE.Quaternion());
        enemy.weaponMount.removeFromParent();
        this.root.add(enemy.weaponMount);
        enemy.weaponMount.position.copy(this.root.worldToLocal(worldPosition));
        enemy.weaponMount.quaternion.copy(worldQuaternion);
        enemy.weaponMount.rotation.x += 1.1;
        enemy.weaponMount.position.y = Math.max(enemy.root.position.y + 0.06, enemy.weaponMount.position.y - 0.8);
      }
    }
  }

  _disableProxies(enemy) {
    const proxies = [
      enemy.headProxy,
      enemy.torsoProxy,
      enemy.lowerBodyProxy,
      enemy.weaponProxy,
      ...(enemy.limbProxies ?? []).map((segment) => segment.proxy),
    ].filter(Boolean);
    for (const proxy of proxies) {
      const index = this.hitProxies.indexOf(proxy);
      if (index >= 0) this.hitProxies.splice(index, 1);
      proxy.removeFromParent();
    }
    for (const mesh of enemy.damageMeshes ?? []) {
      const index = this.damageMeshes.indexOf(mesh);
      if (index >= 0) this.damageMeshes.splice(index, 1);
    }
    enemy.damageMeshes = [];
  }

  _resolveEnemy(target) {
    if (!target) return null;
    if (typeof target === 'string') return this.enemyById.get(target) ?? null;
    if (target.enemy) return target.enemy;
    if (target.userData?.enemy) return target.userData.enemy;
    const proxy = target.object ? this.proxyData.get(target.object) : this.proxyData.get(target);
    return proxy?.enemy ?? (this.enemies.includes(target) ? target : null);
  }

  _findBone(root, candidates) {
    const wanted = candidates.map((name) => String(name).replace(/[\s_:-]/g, '').toLowerCase());
    let found = null;
    root.traverse((child) => {
      if (found || !child.isBone) return;
      const clean = child.name.replace(/[\s_:-]/g, '').toLowerCase();
      if (wanted.some((candidate) => clean === candidate || clean.endsWith(candidate))) found = child;
    });
    return found;
  }

  _resolveRoute(route, groupId) {
    let source = route;
    if (typeof route === 'string') {
      source = collectionForGroup(this.world.patrolRoutes ?? this.world.routes, route);
    }
    if (!source) source = collectionForGroup(this.world.patrolRoutes, groupId);
    if (!Array.isArray(source)) return [];
    return source.map((point) => asVector3(point?.position ?? point)).filter(Boolean);
  }

  _getSpawnPoints(groupId) {
    if (typeof this.world?.getEnemySpawnPoints === 'function') {
      const points = this.world.getEnemySpawnPoints(groupId);
      if (points) return points;
    }
    if (typeof this.world?.getEnemySpawns === 'function') {
      const points = this.world.getEnemySpawns(groupId);
      if (points) return points;
    }
    return collectionForGroup(
      this.world.enemySpawns ?? this.world.spawnPoints?.enemies ?? this.world.spawns?.enemies,
      groupId,
    ) ?? [];
  }

  _getCoverPoints(groupId) {
    let points = null;
    if (typeof this.world?.getCoverPoints === 'function') points = this.world.getCoverPoints(groupId);
    points ??= collectionForGroup(this.world.coverPoints ?? this.world.enemyCoverPoints, groupId);
    if (!points && Array.isArray(this.world.coverPoints)) points = this.world.coverPoints;
    return Array.isArray(points) ? points : [];
  }

  _segmentBlocked(start, end) {
    if (typeof this.world?.segmentBlocked !== 'function') return false;
    try {
      return Boolean(this.world.segmentBlocked(start.clone(), end.clone()));
    } catch (error) {
      console.warn('EnemyDirector world.segmentBlocked failed', error);
      return false;
    }
  }

  _isBallisticPermeableHit(hit) {
    if (!hit) return false;
    if (
      hit.ballistic === false ||
      hit.ballisticPermeable === true ||
      hit.collider?.ballistic === false ||
      hit.collider?.ballisticPermeable === true
    ) return true;
    let object = hit.object ?? hit.mesh ?? null;
    while (object) {
      if (object.userData?.ballisticPermeable === true) return true;
      object = object.parent;
    }
    return false;
  }

  _refineWorldOcclusion(origin, direction, hit, maxDistance) {
    if (!hit) return { hit: null, rejected: false };
    const visualRoot = hit.object;
    if (!visualRoot?.isObject3D) return { hit, rejected: false };

    // World movement uses conservative axis-aligned collider boxes. Those
    // boxes can extend in front of a rotated door, pipe or prop and report a
    // wall hit even when the reticle is visibly on a guard. Validate the broad
    // phase against the collider's real rendered triangles before allowing it
    // to shorten the enemy ray. Double-sided testing is temporary and ensures
    // walls remain solid when shot from inside a building.
    const materialSides = new Map();
    visualRoot.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material || materialSides.has(material)) continue;
        materialSides.set(material, material.side);
        material.side = THREE.DoubleSide;
      }
    });

    let visualHit = null;
    try {
      visualRoot.updateWorldMatrix(true, true);
      this.worldRaycaster.set(origin, direction);
      this.worldRaycaster.far = Math.max(0, finite(maxDistance, 230));
      visualHit = this.worldRaycaster.intersectObject(visualRoot, true)
        .find((candidate) => candidate.distance >= this.worldRaycaster.near) ?? null;
    } finally {
      for (const [material, side] of materialSides) material.side = side;
    }

    if (!visualHit) {
      return {
        hit: null,
        rejected: true,
        broadPhaseDistance: hit.distance ?? null,
      };
    }
    return {
      hit: {
        ...hit,
        ...visualHit,
        collider: hit.collider,
        material: hit.material,
        broadPhaseDistance: hit.distance ?? null,
      },
      rejected: false,
      broadPhaseDistance: hit.distance ?? null,
    };
  }

  _raycastWorld(origin, direction, maxDistance) {
    if (typeof this.world?.raycastWorld !== 'function') return null;
    try {
      const result = this.world.raycastWorld(origin.clone(), direction.clone(), maxDistance);
      const hit = Array.isArray(result) ? result[0] : result;
      if (!hit) return null;
      const point = asVector3(hit.point);
      const distance = Number.isFinite(Number(hit.distance))
        ? Number(hit.distance)
        : point?.distanceTo(origin);
      return { ...hit, point, distance };
    } catch (error) {
      console.warn('EnemyDirector world.raycastWorld failed', error);
      return null;
    }
  }

  _resolveMovement(enemy, position, delta) {
    const methods = ['resolveEnemyMovement', 'resolveActorMovement', 'resolveMovement'];
    for (const name of methods) {
      if (typeof this.world?.[name] !== 'function') continue;
      try {
        const result = this.world[name](position.clone(), delta.clone(), BODY_RADIUS + BODY_SKIN, enemy);
        const next = asVector3(result?.position ?? result);
        if (next) return next;
      } catch {
        // Fall through to the director's conservative segment test.
      }
    }
    return null;
  }

  _groundEnemy(enemy) {
    const y = this._groundHeightAt(
      enemy.root.position.x,
      enemy.root.position.z,
      enemy.root.position.y,
    );
    if (Number.isFinite(y)) enemy.root.position.y = y;
  }

  _groundHeightAt(x, z, currentY = 0) {
    const methods = ['groundHeightAt', 'getGroundHeight', 'heightAt'];
    for (const name of methods) {
      if (typeof this.world?.[name] !== 'function') continue;
      const y = this.world[name](x, z, currentY);
      if (y == null) continue;
      if (Number.isFinite(Number(y))) return Number(y);
    }
    return currentY;
  }

  _emit(name, ...args) {
    const callback = this.callbacks?.[name];
    if (typeof callback !== 'function') return undefined;
    try {
      return callback(...args);
    } catch (error) {
      console.error(`EnemyDirector ${name} callback failed`, error);
      return undefined;
    }
  }
}

export default EnemyDirector;
