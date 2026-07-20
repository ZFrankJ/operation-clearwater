import * as THREE from 'three';
import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';
import { FirstPersonHands } from './first-person-hands.js';

const MODEL_URL = new URL('../assets/models/weapons/m4a1-pbr.fbx', import.meta.url).href;
const BASE_COLOR_URL = new URL('../assets/models/weapons/M4A1_Base_Color.png', import.meta.url).href;
const HEIGHT_URL = new URL('../assets/models/weapons/M4A1_Height.png', import.meta.url).href;
const METALLIC_URL = new URL('../assets/models/weapons/M4A1_Metallic.png', import.meta.url).href;
const NORMAL_URL = new URL('../assets/models/weapons/M4A1_Normal.png', import.meta.url).href;
const ROUGHNESS_URL = new URL('../assets/models/weapons/M4A1_Roughness.png', import.meta.url).href;
const MODEL_LENGTH = 0.86;
const MODEL_LONGITUDINAL_OFFSET = -0.27;
const XPS2_WIDTH = 0.0533;
const XPS2_HEIGHT = 0.0635;
const XPS2_LENGTH = 0.0965;
const XPS2_WINDOW_CENTER_Y = 0.0435;
const BOLT_CYCLE_DURATION = 0.092;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UP_VECTOR = new THREE.Vector3(0, 1, 0);

function smooth01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function dampAndSnap(current, target, lambda, dt, epsilon = 1e-5) {
  const next = THREE.MathUtils.damp(current, target, lambda, Math.max(0, dt));
  return Math.abs(next - target) <= epsilon ? target : next;
}

function phase(value, start, end) {
  return smooth01((value - start) / Math.max(1e-5, end - start));
}

function isEditableTarget(target) {
  return Boolean(
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
  );
}

function callbackLike(value) {
  return value && !value.isScene && !value.scene &&
    ['onShoot', 'onAmmo', 'onReload', 'onDry', 'onImpact', 'onMagnification'].some((key) => typeof value[key] === 'function');
}

function roundedRectShape(width, height, radius, hole = false, y = 0) {
  const x0 = -width / 2;
  const x1 = width / 2;
  const y0 = y;
  const y1 = y + height;
  const r = Math.min(radius, width / 2, height / 2);
  const path = hole ? new THREE.Path() : new THREE.Shape();
  if (hole) {
    path.moveTo(x0 + r, y0);
    path.lineTo(x0, y0 + r);
    path.lineTo(x0, y1 - r);
    path.quadraticCurveTo(x0, y1, x0 + r, y1);
    path.lineTo(x1 - r, y1);
    path.quadraticCurveTo(x1, y1, x1, y1 - r);
    path.lineTo(x1, y0 + r);
    path.quadraticCurveTo(x1, y0, x1 - r, y0);
    path.lineTo(x0 + r, y0);
  } else {
    path.moveTo(x0 + r, y0);
    path.lineTo(x1 - r, y0);
    path.quadraticCurveTo(x1, y0, x1, y0 + r);
    path.lineTo(x1, y1 - r);
    path.quadraticCurveTo(x1, y1, x1 - r, y1);
    path.lineTo(x0 + r, y1);
    path.quadraticCurveTo(x0, y1, x0, y1 - r);
    path.lineTo(x0, y0 + r);
    path.quadraticCurveTo(x0, y0, x0 + r, y0);
  }
  return path;
}

function extrudeShape(shape, depth, material, bevel = 0.001) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

/**
 * Detailed first-person M4A1 viewmodel and automatic hitscan weapon.
 * The second constructor argument may be a THREE.Scene, a world object with a
 * `scene`/`raycastWorld` API, or the callbacks object itself.
 */
export class WeaponSystem {
  constructor(camera, sceneOrWorld = null, callbacks = {}) {
    if (!camera?.isCamera) throw new TypeError('WeaponSystem requires a THREE camera.');
    if (callbackLike(sceneOrWorld) && (!callbacks || Object.keys(callbacks).length === 0)) {
      callbacks = sceneOrWorld;
      sceneOrWorld = null;
    }

    this.camera = camera;
    this.world = sceneOrWorld?.scene || sceneOrWorld?.raycastWorld ? sceneOrWorld : null;
    this.scene = sceneOrWorld?.isScene ? sceneOrWorld : sceneOrWorld?.scene ?? null;
    this.callbacks = callbacks ?? {};

    this.magSize = 30;
    this.ammo = 30;
    this.reserve = 120;
    this.maxReserve = 240;
    this.respawnRecoveries = 0;
    this.lastRespawnRecovery = null;
    this.roundsPerMinute = 780;
    this.shotInterval = 60 / this.roundsPerMinute;
    this.reloadDuration = 2.15;
    this.range = 230;

    this.enabled = true;
    this.loaded = false;
    this.loadingPromise = null;
    this.fireHeld = false;
    this.adsHeld = false;
    this.adsMouseHeld = false;
    this.adsKeyHeld = false;
    this.ads = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.shotCooldown = 0;
    this.dryCooldown = 0;
    this.recoil = 0;
    this.recoilStack = 0;
    this.muzzleTimer = 0;
    this.boltTimer = 0;
    this.shotSerial = 0;
    this.lastShotOrigin = new THREE.Vector3();
    this.time = 0;
    this.playerState = null;

    // Keep the world camera wide while moving, then make iron-sight aiming
    // optically meaningful. Moving only the viewmodel never produced a clear
    // sense of magnification on a normal-sized display.
    this.baseFov = Number.isFinite(camera.fov) ? camera.fov : 71;
    // The XPS2 window remains the physical sight picture. The mission loadout
    // adds a selectable digital crop behind it for close, medium, or long
    // observation without changing the weapon model.
    this.aimMagnification = 2;
    this.adsFov = this._fovForMagnification(this.aimMagnification);
    this.sprintBlend = 0;
    this.wallBlend = 0;
    this.wallDistance = null;

    this.hipPosition = new THREE.Vector3(0.255, -0.255, -0.37);
    // load() refines this from the normalized receiver rail measurement.
    this.adsPosition = new THREE.Vector3(0, -(0.0965 + XPS2_WINDOW_CENTER_Y), -0.405);
    // A compact low-ready carry: the stock is tucked in, muzzle lowered and
    // the rifle rolled across the chest rather than continuing to point ahead.
    this.sprintPosition = new THREE.Vector3(0.08, -0.24, -0.3);
    // Clearance retracts the rifle straight back and slightly down. It must
    // never fold sideways across the operator's body: players using a machine
    // or wall as cover still need the barrel aligned with the camera when they
    // lean far enough to expose a genuine firing lane.
    this.wallPosition = new THREE.Vector3(0.18, -0.185, 0.2);
    this.wallRotation = new THREE.Euler(-0.055, 0, -0.035, 'YXZ');
    this._poseTargetPosition = this.hipPosition.clone();
    this._poseTargetEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._poseTargetQuaternion = new THREE.Quaternion();
    this.poseMode = 'hip';
    this.viewRoot = new THREE.Group();
    this.viewRoot.name = 'M4A1_FirstPerson_Viewmodel';
    this.viewRoot.position.copy(this.hipPosition);
    this.viewRoot.rotation.order = 'YXZ';
    this.viewRoot.visible = false;
    this.viewRoot.userData.noHit = true;
    camera.add(this.viewRoot);

    // Real skinned Rocketbox arms live beside the rifle in camera space. They
    // remain hidden until both the weapon and the extracted tactical-glove
    // mesh have loaded, then solve onto the rifle's physical grip points.
    this.hands = new FirstPersonHands(this.camera, this.viewRoot, { enabled: false });

    this.aimSight = this._createAimSight();
    // The optic is rifle hardware, so it must inherit hip sway, sprint carry,
    // recoil and reload motion from the same viewmodel transform as the M4.
    this.viewRoot.add(this.aimSight);

    this.modelPivot = new THREE.Group();
    this.modelPivot.name = 'M4A1_Model_Pivot';
    // The PBR asset's barrel already points camera-forward along -Z.
    this.modelPivot.rotation.y = 0;
    this.viewRoot.add(this.modelPivot);

    this.muzzleAnchor = new THREE.Group();
    this.muzzleAnchor.name = 'M4A1_Muzzle';
    this.muzzleAnchor.position.set(0, 0.02, -0.69);
    this.viewRoot.add(this.muzzleAnchor);

    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd17a,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.14, 8, 1, true), flashMaterial);
    this.muzzleFlash.rotation.x = -Math.PI / 2;
    this.muzzleFlash.position.z = -0.065;
    this.muzzleFlash.visible = false;
    this.muzzleFlash.renderOrder = 2001;
    this.muzzleAnchor.add(this.muzzleFlash);

    this.muzzleLight = new THREE.PointLight(0xffb45c, 0, 2.8, 2);
    this.muzzleAnchor.add(this.muzzleLight);

    this.casingGeometry = new THREE.CylinderGeometry(0.0042, 0.0042, 0.018, 8);
    this.casingMaterial = new THREE.MeshStandardMaterial({
      color: 0xb88a39,
      metalness: 0.78,
      roughness: 0.28,
    });
    this.tracerMaterial = new THREE.LineBasicMaterial({
      color: 0xffd68a,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.impactGeometry = new THREE.CircleGeometry(0.032, 10);
    this.impactMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc879,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.casings = [];
    this.tracers = [];
    this.impacts = [];

    this._raycaster = new THREE.Raycaster();
    this._origin = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._wallOrigin = new THREE.Vector3();
    this._wallDirection = new THREE.Vector3();
    this._wallProbeWorld = new THREE.Vector3();
    this._wallProbeLocals = Object.freeze([
      new THREE.Vector3(0, 0, -1.08),
      new THREE.Vector3(0.26, -0.18, -1.03),
      new THREE.Vector3(-0.16, -0.3, -0.75),
      new THREE.Vector3(0.42, -0.32, -0.65),
    ]);
    this._reloadOffset = new THREE.Vector3();
    this._reloadRotation = new THREE.Quaternion();

    this.magazine = null;
    this.magazineMesh = null;
    this.magazineHome = null;
    this.magazineRounds = null;
    this.topRounds = [];
    this.chargingHandle = null;
    this.chargingHandleHome = null;
    this.boltCarrier = null;
    this.boltCarrierHome = null;
    this.chamberRound = null;
    this.ejectionPort = null;
    this.reloadNeedsCharge = false;
    this.detailMaterial = null;

    this._onKeyDown = (event) => {
      if (isEditableTarget(event.target)) return;
      const directMagnification = ({ Digit2: 2, Digit4: 4, Digit8: 8 })[event.code];
      if (directMagnification && !event.repeat && this.enabled) {
        event.preventDefault();
        this.setMagnification(directMagnification);
        return;
      }
      if (event.code === 'KeyX') {
        event.preventDefault();
        this.adsKeyHeld = this.enabled;
        this._syncAdsHeld();
        return;
      }
      if (event.repeat || event.code !== 'KeyR') return;
      if (this.enabled) {
        event.preventDefault();
        this.reload();
      }
    };
    this._onKeyUp = (event) => {
      if (event.code !== 'KeyX') return;
      event.preventDefault();
      this.adsKeyHeld = false;
      this._syncAdsHeld();
    };
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    this._onInputLost = () => {
      this.fireHeld = false;
      this.adsMouseHeld = false;
      this.adsKeyHeld = false;
      this.adsHeld = false;
    };
    this._onPointerLockChange = () => {
      if (!document.pointerLockElement) this._onInputLost();
    };
    window.addEventListener('blur', this._onInputLost);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    this._emitAmmo();
  }

  async load() {
    if (this.loaded) return this.viewRoot;
    if (this.loadingPromise) return this.loadingPromise;

    const manager = new THREE.LoadingManager();
    const textureLoader = new THREE.TextureLoader(manager);
    this.loadingPromise = Promise.all([
      new FBXLoader(manager).loadAsync(MODEL_URL),
      textureLoader.loadAsync(BASE_COLOR_URL),
      textureLoader.loadAsync(HEIGHT_URL),
      textureLoader.loadAsync(METALLIC_URL),
      textureLoader.loadAsync(NORMAL_URL),
      textureLoader.loadAsync(ROUGHNESS_URL),
    ]).then(async ([model, baseColor, height, metallic, normal, roughness]) => {
      baseColor.colorSpace = THREE.SRGBColorSpace;
      for (const texture of [baseColor, height, metallic, normal, roughness]) {
        texture.anisotropy = 8;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
      }

      const weaponMaterial = new THREE.MeshStandardMaterial({
        name: 'M4A1_CC0_PBR_Viewmodel_Material',
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

      model.traverse((child) => {
        child.userData.noHit = true;
        if (!child.isMesh) return;
        if (/^(Sight(?:_2)?|Switch[12])$/i.test(child.name)) {
          child.visible = false;
          return;
        }
        child.material = weaponMaterial;
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = false;
        child.renderOrder = 2000;
        // Opaque viewmodel surfaces participate in depth normally. Disabling
        // both tests made receiver polygons and magazine faces intermittently
        // draw over one another as large flashing rectangles.
        child.material.depthTest = true;
        child.material.depthWrite = true;
        child.geometry?.computeVertexNormals?.();
      });

      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z, 1e-6);
      const scale = MODEL_LENGTH / longest;
      const baseMesh = model.getObjectByName('Base');
      const rawBaseBounds = baseMesh ? new THREE.Box3().setFromObject(baseMesh) : bounds;
      const rawBaseCenter = rawBaseBounds.getCenter(new THREE.Vector3());
      model.scale.setScalar(scale);
      model.position.copy(center).multiplyScalar(-scale);
      model.position.z += MODEL_LONGITUDINAL_OFFSET;
      model.name = 'CC0_M4A1_PBR_Viewmodel';
      this.modelPivot.add(model);
      this.model = model;
      this.weaponMaterial = weaponMaterial;
      const railY = (rawBaseBounds.max.y - center.y) * scale;
      const railZ = (rawBaseCenter.z - center.z) * scale + MODEL_LONGITUDINAL_OFFSET;
      this._seatAimSight(railY, railZ);
      this._prepareReloadParts(model);
      await this.hands.load();
      this.hands.bindWeapon({
        root: this.viewRoot,
        magazine: this.magazine,
        chargingHandle: this.chargingHandle,
      });
      this.loaded = true;
      this.viewRoot.visible = this.enabled;
      this.hands.setEnabled(this.enabled);
      this._emit('onLoaded', model);
      return this.viewRoot;
    }).catch((error) => {
      this.loadingPromise = null;
      this._emit('onLoadError', error);
      throw error;
    });

    return this.loadingPromise;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.fireHeld = false;
    this.adsMouseHeld = false;
    this.adsKeyHeld = false;
    this.adsHeld = false;
    this.viewRoot.visible = this.enabled && this.loaded;
    this.hands?.setEnabled(this.enabled && this.loaded);
    if (!this.enabled && this.reloading) this._cancelReload();
    if (!this.enabled) {
      this.ads = 0;
      this.sprintBlend = 0;
      this._restoreReloadParts();
      this._setCameraFov(this.baseFov, true);
    }
    if (!this.enabled) this.aimSight.visible = false;
  }

  setMagnification(value = 2) {
    const requested = Number(value);
    this.aimMagnification = [2, 4, 8].includes(requested) ? requested : 2;
    this.adsFov = this._fovForMagnification(this.aimMagnification);
    this._emit('onMagnification', {
      magnification: this.aimMagnification,
      adsFov: this.adsFov,
    });
    return this.aimMagnification;
  }

  /**
   * Respawning is a new playable life, so it must not inherit a half-finished
   * reload or an empty chamber from the death animation. Preserve ammunition
   * accounting, but immediately seat a fresh magazine when the rifle is empty.
   */
  resetForRespawn() {
    if (this.reloading) this._cancelReload();
    const ammoBefore = this.ammo;
    const reserveBefore = this.reserve;
    let loaded = 0;
    if (this.ammo <= 0 && this.reserve > 0) {
      loaded = Math.min(this.magSize, this.reserve);
      this.ammo = loaded;
      this.reserve -= loaded;
    }
    this.reloadNeedsCharge = false;
    this.reloadTimer = 0;
    this.boltTimer = 0;
    this.shotCooldown = 0;
    this.dryCooldown = 0;
    this.recoil = 0;
    this.recoilStack = 0;
    this._restoreReloadParts();
    this.lastRespawnRecovery = {
      ammoBefore,
      reserveBefore,
      loaded,
      ammo: this.ammo,
      reserve: this.reserve,
      chambered: this.ammo > 0,
    };
    this.respawnRecoveries += 1;
    this._emitAmmo();
    return this.getState();
  }

  handleMouseDown(eventOrButton) {
    const button = typeof eventOrButton === 'number' ? eventOrButton : eventOrButton?.button;
    if (button === 2) {
      eventOrButton?.preventDefault?.();
      this.adsMouseHeld = this.enabled;
      // Retain the explicit assignment for the input contract, then reconcile
      // it with KeyX so releasing either control does not cancel the other.
      this.adsHeld = this.enabled;
      this._syncAdsHeld();
    } else if (button === 0) {
      eventOrButton?.preventDefault?.();
      this.fireHeld = this.enabled;
    }
  }

  handleMouseUp(eventOrButton) {
    const button = typeof eventOrButton === 'number' ? eventOrButton : eventOrButton?.button;
    if (button === 2) this.adsHeld = false;
    if (button === 2) {
      this.adsMouseHeld = false;
      this._syncAdsHeld();
    }
    else if (button === 0) this.fireHeld = false;
  }

  _syncAdsHeld() {
    this.adsHeld = this.enabled && (this.adsMouseHeld || this.adsKeyHeld);
  }

  _createAimSight() {
    const sight = new THREE.Group();
    sight.name = 'M4A1_Rail_Mounted_XPS2_Holographic_Sight';
    // Official XPS2 envelope: 96.5 x 53.3 x 63.5 mm. load() measures the
    // normalized receiver and updates this exact rail-contact transform.
    sight.position.set(0, 0.0965, -0.145);
    sight.visible = false;
    sight.userData.noHit = true;

    const housingMaterial = new THREE.MeshStandardMaterial({
      name: 'XPS2_Anodized_Protective_Hood',
      color: 0x181b1b,
      roughness: 0.36,
      metalness: 0.82,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    const edgeMaterial = new THREE.MeshStandardMaterial({
      name: 'XPS2_Rail_Hardware',
      color: 0x3d4445,
      roughness: 0.28,
      metalness: 0.9,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    const glassMaterial = new THREE.MeshBasicMaterial({
      name: 'XPS2_Recessed_Rectangular_Glass',
      color: 0x63aaa5,
      transparent: true,
      opacity: 0.085,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const reticleMaterial = new THREE.MeshBasicMaterial({
      name: 'XPS2_Collimated_Dot_Ring',
      color: 0xff5a38,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.aimSightMaterials = [housingMaterial, edgeMaterial, glassMaterial, reticleMaterial];

    // The 53.3 mm base spans the official housing width and contacts the rail.
    const railPad = new THREE.Mesh(
      new THREE.BoxGeometry(XPS2_WIDTH, 0.012, XPS2_LENGTH),
      housingMaterial,
    );
    railPad.position.set(0, 0.006, 0);
    railPad.name = 'XPS2_Receiver_Contact_Base';
    sight.add(railPad);

    for (const x of [-0.023, 0.023]) {
      const clampEar = new THREE.Mesh(
        new THREE.BoxGeometry(0.007, 0.018, 0.062),
        housingMaterial,
      );
      clampEar.position.set(x, -0.003, 0);
      clampEar.name = x < 0 ? 'XPS2_Captive_Rail_Clamp' : 'XPS2_Fixed_Rail_Jaw';
      sight.add(clampEar);
    }

    const crossBolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0037, 0.0037, 0.062, 12),
      edgeMaterial,
    );
    crossBolt.rotation.z = Math.PI / 2;
    crossBolt.position.set(0, 0.002, 0.022);
    crossBolt.name = 'XPS2_Rail_Cross_Bolt';
    sight.add(crossBolt);

    // Compact supports carry the electronics body without filling the window.
    for (const x of [-0.023, 0.023]) {
      const riser = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, 0.018, 0.074),
        housingMaterial,
      );
      riser.position.set(x, 0.015, 0);
      riser.name = x < 0 ? 'XPS2_Left_Body_Support' : 'XPS2_Right_Body_Support';
      sight.add(riser);
    }

    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.049, 0.012, 0.082),
      housingMaterial,
    );
    bridge.position.set(0, 0.016, 0);
    bridge.name = 'XPS2_Electronics_Body';
    sight.add(bridge);

    // One beveled extrusion forms the protective hood around a real 38 x 27
    // mm rectangular opening. This replaces the former circular torus sight.
    const hoodShape = roundedRectShape(XPS2_WIDTH, XPS2_HEIGHT - 0.016, 0.006);
    hoodShape.holes.push(roundedRectShape(0.038, 0.027, 0.0038, true, 0.0125));
    const aperture = extrudeShape(hoodShape, 0.067, housingMaterial, 0.00115);
    aperture.position.set(0, 0.016, 0);
    aperture.name = 'XPS2_Beveled_Hood_With_Rectangular_Aperture';
    sight.add(aperture);

    // The rectangular pane sits 10 mm inside the rear hood face; it is rifle
    // hardware, never a detached camera-space circle.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.037, 0.026),
      glassMaterial,
    );
    glass.position.set(0, XPS2_WINDOW_CENTER_Y, 0.0235);
    glass.name = 'XPS2_Recessed_Rectangular_View_Window';
    sight.add(glass);

    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.00052, 16),
      reticleMaterial,
    );
    dot.position.set(0, XPS2_WINDOW_CENTER_Y, 0.025);
    dot.name = 'XPS2_Bore_Aligned_Centre_Dot';
    sight.add(dot);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.0062, 0.00024, 6, 48),
      reticleMaterial,
    );
    ring.position.set(0, XPS2_WINDOW_CENTER_Y, 0.025);
    ring.name = 'XPS2_Bore_Aligned_Outer_Ring';
    sight.add(ring);

    sight.traverse((child) => {
      child.userData.noHit = true;
      if (!child.isMesh) return;
      child.frustumCulled = false;
      child.renderOrder = 2200;
    });
    return sight;
  }

  _seatAimSight(railY, railZ) {
    const safeRailY = Number.isFinite(railY) ? railY : 0.0965;
    const safeRailZ = Number.isFinite(railZ) ? railZ : -0.145;
    this.aimSight.position.set(0, safeRailY, safeRailZ);
    this.aimSight.userData.officialDimensionsMm = [53.3, 63.5, 96.5];
    this.aimSight.userData.railSeatY = safeRailY;
    this.aimSight.userData.railSeatZ = safeRailZ;
    this.aimSight.userData.opticalCenterY = safeRailY + XPS2_WINDOW_CENTER_Y;
    this.adsPosition.y = -this.aimSight.userData.opticalCenterY;
  }

  _updateAimSight() {
    const fade = smooth01((this.ads - 0.08) / 0.72);
    // The optic is always present on the rifle. Only the collimated dot blooms
    // with eye alignment; the housing and glass cannot detach between hip and
    // ADS poses.
    this.aimSight.visible = this.enabled && this.loaded;
    if (!this.aimSight.visible) return;
    this.aimSightMaterials[0].opacity = 1;
    this.aimSightMaterials[1].opacity = 1;
    this.aimSightMaterials[2].opacity = THREE.MathUtils.lerp(0.055, 0.1, fade);
    this.aimSightMaterials[3].opacity = THREE.MathUtils.lerp(0.12, 0.98, fade);
  }

  reload() {
    if (!this.enabled || !this.loaded || this.reloading || this.ammo >= this.magSize || this.reserve <= 0) {
      return false;
    }
    this.reloading = true;
    this.reloadNeedsCharge = this.ammo <= 0;
    this.reloadTimer = this.reloadDuration;
    this.fireHeld = false;
    this._emit('onReload', { active: true, duration: this.reloadDuration, state: this.getState() });
    return true;
  }

  addAmmo(amount) {
    const before = this.reserve;
    this.reserve = THREE.MathUtils.clamp(this.reserve + Math.max(0, Math.floor(amount || 0)), 0, this.maxReserve);
    this._emitAmmo();
    return this.reserve - before;
  }

  update(dt, playerState = null) {
    dt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    this.playerState = playerState ?? this.playerState;
    const paused = Boolean(this.playerState?.paused || !this.playerState?.alive);
    const activeDt = paused ? 0 : dt;
    this.time += activeDt;
    this.shotCooldown = Math.max(-this.shotInterval, this.shotCooldown - activeDt);
    this.dryCooldown = Math.max(0, this.dryCooldown - activeDt);
    this.boltTimer = Math.max(0, this.boltTimer - activeDt);
    this._updateWallClearance(activeDt || dt);
    this._syncViewmodelVisibility();

    if (this.reloading && activeDt > 0) {
      this.reloadTimer -= activeDt;
      if (this.reloadTimer <= 0) this._finishReload();
    }

    const sprinting = Boolean(this.playerState?.sprinting && this.playerState?.moving);
    const wantsADS = this.enabled && this.loaded && this.adsHeld && !sprinting && !this.reloading &&
      !paused && this.wallBlend < 0.12;
    this.ads = dampAndSnap(this.ads, wantsADS ? 1 : 0, wantsADS ? 19 : 13, activeDt || dt);
    this.sprintBlend = dampAndSnap(
      this.sprintBlend,
      sprinting && !this.reloading && !paused ? 1 : 0,
      sprinting ? 12 : 16,
      activeDt || dt,
    );
    this._updateCameraFov(activeDt || dt, paused);

    if (this.enabled && this.loaded && this.fireHeld && !paused && !sprinting && !this.reloading) {
      let safety = 0;
      while (this.shotCooldown <= 0 && safety < 3) {
        if (!this._fireOne()) break;
        this.shotCooldown += this.shotInterval;
        safety += 1;
      }
    }

    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 22, activeDt || dt);
    this.recoilStack = THREE.MathUtils.damp(this.recoilStack, 0, 7.5, activeDt || dt);
    this._updateViewmodel(dt, sprinting, paused);
    this.hands?.update(dt, {
      enabled: this.enabled && this.loaded,
      ads: this.ads,
      sprint: this.sprintBlend,
      reloading: this.reloading,
      reloadProgress: this.reloading
        ? 1 - Math.max(0, this.reloadTimer) / this.reloadDuration
        : 0,
    });
    this._updateAimSight();
    this._updateEffects(activeDt);
    return this.getState();
  }

  getState() {
    return {
      loaded: this.loaded,
      enabled: this.enabled,
      ammo: this.ammo,
      reserve: this.reserve,
      magSize: this.magSize,
      reloading: this.reloading,
      reloadProgress: this.reloading ? 1 - Math.max(0, this.reloadTimer) / this.reloadDuration : 0,
      ads: this.ads,
      cameraFov: this.camera.fov,
      adsFov: this.adsFov,
      aimMagnification: this.aimMagnification,
      opticalZoom: Math.tan(THREE.MathUtils.degToRad(this.baseFov * 0.5)) /
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)),
      firing: this.fireHeld,
      boltCycle: THREE.MathUtils.clamp(this.boltTimer / BOLT_CYCLE_DURATION, 0, 1),
      chambered: this.ammo > 0,
      respawnRecoveries: this.respawnRecoveries,
      lastRespawnRecovery: this.lastRespawnRecovery ? { ...this.lastRespawnRecovery } : null,
      shotSerial: this.shotSerial,
      shotOrigin: this.lastShotOrigin.clone(),
      recoil: this.recoil,
      wallBlend: this.wallBlend,
      wallDistance: this.wallDistance,
      viewmodelVisible: this.viewRoot.visible,
      handsVisible: Boolean(this.hands?.root?.visible),
      viewPosition: this.viewRoot.position.clone(),
      viewRotation: this.viewRoot.rotation.clone(),
      poseMode: this.poseMode,
      posePositionError: this.viewRoot.position.distanceTo(this._poseTargetPosition),
      poseAngularError: this.viewRoot.quaternion.angleTo(this._poseTargetQuaternion),
    };
  }

  getViewmodelCameraBounds() {
    if (!this.model) return null;
    this.camera.updateWorldMatrix(true, false);
    this.model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().makeEmpty();
    const point = new THREE.Vector3();
    this.model.traverse((part) => {
      if (!part.isMesh || !part.geometry) return;
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      const box = part.geometry.boundingBox;
      if (!box || box.isEmpty()) return;
      for (let x = 0; x < 2; x += 1) {
        for (let y = 0; y < 2; y += 1) {
          for (let z = 0; z < 2; z += 1) {
            point.set(
              x ? box.max.x : box.min.x,
              y ? box.max.y : box.min.y,
              z ? box.max.z : box.min.z,
            ).applyMatrix4(part.matrixWorld).applyMatrix4(this.camera.matrixWorldInverse);
            bounds.expandByPoint(point);
          }
        }
      }
    });
    return bounds.isEmpty() ? null : {
      min: bounds.min.clone(),
      max: bounds.max.clone(),
    };
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onInputLost);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this._setCameraFov(this.baseFov, true);
    this.hands?.dispose();
    this.camera.remove(this.viewRoot);
    this.viewRoot.traverse((child) => {
      if (!child.isMesh || child === this.muzzleFlash) return;
      child.geometry?.dispose?.();
    });
    for (const mapName of ['map', 'bumpMap', 'metalnessMap', 'normalMap', 'roughnessMap']) {
      this.weaponMaterial?.[mapName]?.dispose?.();
    }
    this.weaponMaterial?.dispose?.();
    for (const material of this.mechanicalMaterials ?? []) material?.dispose?.();
    for (const material of this.aimSightMaterials) material.dispose();
    this.muzzleFlash.geometry.dispose();
    this.muzzleFlash.material.dispose();
    this.casingGeometry.dispose();
    this.casingMaterial.dispose();
    this.tracerMaterial.dispose();
    this.impactGeometry.dispose();
    this.impactMaterial.dispose();
    for (const effect of this.impacts) effect.object?.material?.dispose?.();
    for (const effect of [...this.casings, ...this.tracers, ...this.impacts]) effect.object?.removeFromParent();
    this.casings.length = 0;
    this.tracers.length = 0;
    this.impacts.length = 0;
  }

  _fireOne() {
    if (this.ammo <= 0) {
      if (this.dryCooldown <= 0) {
        this.dryCooldown = 0.28;
        this._emit('onDry', this.getState());
      }
      this.fireHeld = false;
      return false;
    }

    this.ammo -= 1;
    this.boltTimer = BOLT_CYCLE_DURATION;
    this.recoil = Math.min(1, this.recoil + 0.72);
    this.recoilStack = Math.min(1, this.recoilStack + 0.115);
    this.muzzleTimer = 0.045;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    this.muzzleFlash.scale.setScalar(0.82 + Math.random() * 0.45);
    this.muzzleLight.intensity = 5.2;

    this.camera.getWorldPosition(this._origin);
    this.lastShotOrigin.copy(this._origin);
    this.shotSerial += 1;
    this.camera.getWorldDirection(this._direction);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    this._up.copy(UP_VECTOR).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    const spread = THREE.MathUtils.lerp(0.0042, 0.00105, this.ads) + this.recoilStack * 0.0013;
    this._direction
      .addScaledVector(this._right, (Math.random() - 0.5) * spread)
      .addScaledVector(this._up, (Math.random() - 0.5) * spread)
      .normalize();

    let callbackHit = this._emit('onShoot', this._origin.clone(), this._direction.clone());
    if (Array.isArray(callbackHit)) callbackHit = callbackHit[0];
    const hit = this._normaliseHit(callbackHit) ?? this._raycast(this._origin, this._direction);
    const endpoint = hit?.point?.clone?.() ?? this._origin.clone().addScaledVector(this._direction, this.range);

    this.muzzleAnchor.getWorldPosition(this._muzzleWorld);
    this._spawnTracer(this._muzzleWorld, endpoint);
    this._spawnCasing();
    this._updateAmmoVisuals();
    // Character hits already receive a HUD marker, body audio and a physical
    // reaction in EnemyDirector. Drawing the additive hard-surface decal on
    // their uniform/weapon made a successful hit look exactly like a blocked
    // shot against concrete.
    const hardSurfaceHit = hit?.point && !hit.enemy && hit.material !== 'body';
    if (hardSurfaceHit) {
      this._spawnImpact(hit);
      this._emit('onImpact', hit);
    }
    this._emitAmmo();
    return true;
  }

  _raycast(origin, direction) {
    if (typeof this.world?.raycastWorld === 'function') {
      const result = this.world.raycastWorld(origin.clone(), direction.clone(), this.range);
      const hit = this._normaliseHit(Array.isArray(result) ? result[0] : result);
      if (hit) return hit;
    }

    let targets = this.world?.shootables ?? this.world?.targets ?? null;
    if (!targets && this.scene) targets = this.scene.children;
    if (!targets?.length) return null;
    this._raycaster.set(origin, direction);
    this._raycaster.near = 0.08;
    this._raycaster.far = this.range;
    return this._raycaster.intersectObjects(targets, true).find((hit) => !this._isIgnoredHit(hit.object)) ?? null;
  }

  _normaliseHit(hit) {
    if (!hit || !hit.point) return null;
    if (!hit.point.isVector3) hit.point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    return hit;
  }

  _isIgnoredHit(object) {
    let current = object;
    while (current) {
      if (current === this.viewRoot || current.userData?.noHit) return true;
      current = current.parent;
    }
    return false;
  }

  _spawnTracer(start, end) {
    const scene = this._getScene();
    if (!scene) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
    const line = new THREE.Line(geometry, this.tracerMaterial);
    line.frustumCulled = false;
    line.userData.noHit = true;
    scene.add(line);
    this.tracers.push({ object: line, life: 0.055, maxLife: 0.055 });
  }

  _spawnCasing() {
    const scene = this._getScene();
    if (!scene) return;
    const casing = new THREE.Mesh(this.casingGeometry, this.casingMaterial);
    casing.userData.noHit = true;
    const ejectPoint = new THREE.Vector3(0.075, 0.035, -0.16);
    this.viewRoot.localToWorld(ejectPoint);
    casing.position.copy(ejectPoint);
    const quaternion = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const velocity = new THREE.Vector3(1.7 + Math.random() * 0.7, 1.15 + Math.random() * 0.45, 0.25 - Math.random() * 0.5)
      .applyQuaternion(quaternion);
    casing.quaternion.random();
    scene.add(casing);
    this.casings.push({
      object: casing,
      velocity,
      spin: new THREE.Vector3(8 + Math.random() * 7, 12 + Math.random() * 8, 5 + Math.random() * 6),
      life: 1.35,
    });
  }

  _spawnImpact(hit) {
    const scene = this._getScene();
    if (!scene) return;
    const normal = this._impactNormal(hit);
    // Each short-lived mark needs its own opacity state. Sharing one material
    // made every active impact pulse whenever the newest mark faded.
    const mark = new THREE.Mesh(this.impactGeometry, this.impactMaterial.clone());
    mark.userData.noHit = true;
    mark.position.copy(hit.point).addScaledVector(normal, 0.006);
    mark.quaternion.setFromUnitVectors(Z_AXIS, normal);
    scene.add(mark);
    this.impacts.push({ object: mark, life: 0.24, maxLife: 0.24 });
  }

  _impactNormal(hit) {
    if (hit.normal?.isVector3) return hit.normal.clone().normalize();
    if (hit.face?.normal?.isVector3 && hit.object) {
      return hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    }
    return this._direction.clone().negate();
  }

  _prepareReloadParts(model) {
    this.detailMaterial = new THREE.MeshStandardMaterial({
      name: 'M4A1_Reload_Detail',
      color: 0x15191b,
      roughness: 0.38,
      metalness: 0.72,
    });
    this.brassMaterial = new THREE.MeshStandardMaterial({
      name: 'M4A1_Visible_Cartridge_Brass',
      color: 0xc59a46,
      roughness: 0.25,
      metalness: 0.84,
    });
    this.copperMaterial = new THREE.MeshStandardMaterial({
      name: 'M4A1_Visible_Cartridge_Projectile',
      color: 0x9c5030,
      roughness: 0.34,
      metalness: 0.68,
    });
    this.followerMaterial = new THREE.MeshStandardMaterial({
      name: 'M4A1_Magazine_Follower',
      color: 0x4b513d,
      roughness: 0.72,
      metalness: 0.06,
    });
    this.portMaterial = new THREE.MeshStandardMaterial({
      name: 'M4A1_Ejection_Port_Interior',
      color: 0x080a0a,
      roughness: 0.52,
      metalness: 0.58,
    });
    this.boltMaterial = new THREE.MeshStandardMaterial({
      name: 'M4A1_Phosphate_Bolt_Carrier',
      color: 0x363d3e,
      roughness: 0.28,
      metalness: 0.9,
    });
    this.mechanicalMaterials = [
      this.detailMaterial,
      this.brassMaterial,
      this.copperMaterial,
      this.followerMaterial,
      this.portMaterial,
      this.boltMaterial,
    ];

    model.updateWorldMatrix(true, true);
    this.modelPivot.updateWorldMatrix(true, true);

    // Detach the authored magazine into a metre-scale assembly before moving
    // it. Animating the original FBX-local coordinates was reduced by the
    // model's 0.01 normalization scale and was effectively invisible.
    this.magazineMesh = model.getObjectByName('M4A1_magazine') ?? model.getObjectByName('Magazine') ?? null;
    if (this.magazineMesh) {
      const bounds = new THREE.Box3().setFromObject(this.magazineMesh);
      const feedWorld = bounds.getCenter(new THREE.Vector3());
      feedWorld.y = bounds.max.y - 0.004;
      const feedLocal = this.modelPivot.worldToLocal(feedWorld.clone());
      const assembly = new THREE.Group();
      assembly.name = 'M4A1_Detachable_Magazine_Assembly';
      assembly.position.copy(feedLocal);
      assembly.userData.noHit = true;
      this.modelPivot.add(assembly);
      assembly.updateWorldMatrix(true, false);
      assembly.attach(this.magazineMesh);
      this.magazine = assembly;
      this.magazineHome = {
        position: assembly.position.clone(),
        quaternion: assembly.quaternion.clone(),
        scale: assembly.scale.clone(),
      };

      const follower = new THREE.Mesh(
        new THREE.BoxGeometry(0.017, 0.0024, 0.035),
        this.followerMaterial,
      );
      follower.name = 'M4A1_Visible_Magazine_Follower';
      follower.position.set(0, 0.001, 0.001);
      assembly.add(follower);

      this.magazineRounds = new THREE.Group();
      this.magazineRounds.name = 'M4A1_Staggered_Visible_Top_Rounds';
      this.magazineRounds.position.y = 0.004;
      assembly.add(this.magazineRounds);
      const leftRound = this._createCartridge('M4A1_Magazine_Top_Round_Left');
      leftRound.position.set(-0.0042, 0, -0.002);
      const rightRound = this._createCartridge('M4A1_Magazine_Top_Round_Right');
      rightRound.position.set(0.0042, -0.0022, 0.007);
      this.magazineRounds.add(leftRound, rightRound);
      this.topRounds = [leftRound, rightRound];
    }

    // Open service rifles expose the bolt carrier and a brass cartridge
    // through the ejection port instead of presenting an empty black slot.
    const modelEjectionLid = model.getObjectByName('Ejector_Lid');
    if (modelEjectionLid) modelEjectionLid.visible = false;
    this.ejectionPort = new THREE.Mesh(
      new THREE.BoxGeometry(0.0022, 0.018, 0.076),
      this.portMaterial,
    );
    this.ejectionPort.name = 'M4A1_Open_Ejection_Port_Cavity';
    this.ejectionPort.position.set(0.026, 0.057, -0.207);
    this.modelPivot.add(this.ejectionPort);

    this.boltCarrier = new THREE.Mesh(
      new THREE.BoxGeometry(0.0032, 0.014, 0.061),
      this.boltMaterial,
    );
    this.boltCarrier.name = 'M4A1_Visible_Reciprocating_Bolt_Carrier';
    this.boltCarrier.position.set(0.0275, 0.061, -0.204);
    this.modelPivot.add(this.boltCarrier);
    this.boltCarrierHome = this.boltCarrier.position.clone();

    this.chamberRound = this._createCartridge('M4A1_Visible_Chambered_Round');
    this.chamberRound.scale.setScalar(0.9);
    this.chamberRound.position.set(0.0305, 0.055, -0.229);
    this.modelPivot.add(this.chamberRound);

    const modelChargingHandle = model.getObjectByName('Charging_Handle') ?? null;
    if (modelChargingHandle) {
      this.modelPivot.updateWorldMatrix(true, true);
      this.modelPivot.attach(modelChargingHandle);
      this.chargingHandle = modelChargingHandle;
      this.chargingHandle.name = 'M4A1_Animated_Charging_Handle';
    } else {
      // Compatibility fallback for weapon assets without a separate handle.
      this.chargingHandle = new THREE.Group();
      this.chargingHandle.name = 'M4A1_Animated_Charging_Handle';
      this.chargingHandle.position.set(0, 0.087, -0.148);

      const stem = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 0.012, 0.064),
        this.detailMaterial,
      );
      stem.position.z = 0.018;
      const latch = new THREE.Mesh(
        new THREE.BoxGeometry(0.066, 0.011, 0.018),
        this.detailMaterial,
      );
      latch.position.z = -0.012;
      for (const part of [stem, latch]) {
        part.name = 'M4A1_Charging_Handle_Part';
        this.chargingHandle.add(part);
      }
      this.modelPivot.add(this.chargingHandle);
    }
    this.chargingHandleHome = this.chargingHandle.position.clone();

    for (const object of [this.magazine, this.ejectionPort, this.boltCarrier, this.chamberRound, this.chargingHandle]) {
      object?.traverse?.((part) => this._configureMechanicalPart(part));
    }
    this._updateAmmoVisuals();
  }

  _createCartridge(name) {
    const cartridge = new THREE.Group();
    cartridge.name = name;
    cartridge.userData.noHit = true;

    const casing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.00275, 0.00275, 0.031, 12),
      this.brassMaterial,
    );
    casing.name = `${name}_Brass_Case`;
    casing.rotation.x = -Math.PI / 2;
    casing.position.z = 0.012;
    cartridge.add(casing);

    const projectile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.00055, 0.00272, 0.014, 12),
      this.copperMaterial,
    );
    projectile.name = `${name}_Copper_Projectile`;
    projectile.rotation.x = -Math.PI / 2;
    projectile.position.z = -0.0105;
    cartridge.add(projectile);
    return cartridge;
  }

  _configureMechanicalPart(part) {
    part.userData.noHit = true;
    if (!part.isMesh) return;
    part.castShadow = false;
    part.receiveShadow = false;
    part.frustumCulled = false;
    part.renderOrder = 2001;
    if (part.material) {
      part.material.depthTest = true;
      part.material.depthWrite = true;
    }
  }

  _updateAmmoVisuals(forceFreshMagazine = false) {
    const visibleRounds = forceFreshMagazine ? Math.min(this.magSize, this.reserve) : this.ammo;
    if (this.magazineRounds) this.magazineRounds.visible = visibleRounds > 0;
    if (this.topRounds[0]) this.topRounds[0].visible = visibleRounds > 0;
    if (this.topRounds[1]) this.topRounds[1].visible = visibleRounds > 1;
    if (this.chamberRound && !this.reloading && this.boltTimer <= 0) {
      this.chamberRound.visible = this.ammo > 0;
    }
  }

  _restoreReloadParts() {
    if (this.magazine && this.magazineHome) {
      this.magazine.visible = true;
      this.magazine.position.copy(this.magazineHome.position);
      this.magazine.quaternion.copy(this.magazineHome.quaternion);
      this.magazine.scale.copy(this.magazineHome.scale);
    }
    if (this.chargingHandle && this.chargingHandleHome) {
      this.chargingHandle.position.copy(this.chargingHandleHome);
    }
    if (this.boltCarrier && this.boltCarrierHome) {
      this.boltCarrier.position.copy(this.boltCarrierHome);
    }
    this._updateAmmoVisuals();
  }

  _animateReloadParts(progress) {
    if (!this.reloading) {
      this._restoreReloadParts();
      const cycle = 1 - THREE.MathUtils.clamp(this.boltTimer / BOLT_CYCLE_DURATION, 0, 1);
      const travel = Math.sin(Math.PI * cycle);
      if (this.boltCarrier && this.boltCarrierHome) {
        this.boltCarrier.position.z = this.boltCarrierHome.z + travel * 0.044;
      }
      if (this.chamberRound) {
        this.chamberRound.visible = this.ammo > 0 && (cycle < 0.14 || cycle > 0.68 || this.boltTimer <= 0);
        if (this.chamberRound.visible) this.chamberRound.position.z = -0.229 + Math.max(0, 1 - cycle) * 0.003;
      }
      return;
    }

    const p = THREE.MathUtils.clamp(progress, 0, 1);
    if (this.magazine && this.magazineHome) {
      this.magazine.visible = p < 0.47 || p >= 0.5;
      this.magazine.position.copy(this.magazineHome.position);
      this.magazine.quaternion.copy(this.magazineHome.quaternion);

      let drop = 0;
      let back = 0;
      let side = 0;
      let twist = 0;
      if (p >= 0.16 && p < 0.47) {
        const t = phase(p, 0.16, 0.47);
        drop = 0.24 * t;
        back = 0.045 * t;
        side = 0.07 * t;
        twist = 0.24 * t;
      } else if (p >= 0.5 && p < 0.73) {
        const t = phase(p, 0.5, 0.73);
        drop = THREE.MathUtils.lerp(0.24, 0, t);
        back = THREE.MathUtils.lerp(0.045, 0, t);
        side = THREE.MathUtils.lerp(-0.07, 0, t);
        twist = THREE.MathUtils.lerp(-0.18, 0, t);
      }

      this.magazine.position.add(this._reloadOffset.set(side, -drop, -back));
      this._reloadRotation.setFromEuler(new THREE.Euler(0.08 * Math.abs(twist), 0, twist));
      this.magazine.quaternion.multiply(this._reloadRotation);
      this._updateAmmoVisuals(p >= 0.5);
    }

    if (this.chargingHandle && this.chargingHandleHome) {
      this.chargingHandle.position.copy(this.chargingHandleHome);
      // A tactical reload retains the chambered round. Only an empty reload
      // requires pulling and releasing the charging handle.
      const pull = phase(p, 0.755, 0.835);
      const release = phase(p, 0.865, 0.925);
      const chargeTravel = this.reloadNeedsCharge ? pull * (1 - release) : 0;
      this.chargingHandle.position.z += 0.072 * chargeTravel;
      if (this.boltCarrier && this.boltCarrierHome) {
        this.boltCarrier.position.copy(this.boltCarrierHome);
        this.boltCarrier.position.z += 0.052 * chargeTravel;
      }
      if (this.chamberRound) {
        this.chamberRound.visible = this.reloadNeedsCharge ? p >= 0.9 : this.ammo > 0;
      }
    }
  }

  _setCameraFov(value, force = false) {
    if (!Number.isFinite(value) || !Number.isFinite(this.camera.fov)) return;
    if (!force && Math.abs(this.camera.fov - value) < 0.015) return;
    this.camera.fov = value;
    this.camera.updateProjectionMatrix();
  }

  _fovForMagnification(magnification) {
    const zoom = Math.max(1, Number(magnification) || 1);
    const halfAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.baseFov * 0.5)) / zoom);
    return THREE.MathUtils.radToDeg(halfAngle * 2);
  }

  _updateCameraFov(dt, paused) {
    const target = THREE.MathUtils.lerp(this.baseFov, this.adsFov, this.ads);
    if (paused || dt <= 0) return;
    this._setCameraFov(THREE.MathUtils.damp(this.camera.fov, target, 17, dt));
  }

  _updateViewmodel(dt, sprinting, paused) {
    // Reload owns the weapon during its functional animation. Mask stale ADS
    // and sprint tails so simultaneous R/X/movement inputs cannot compose a
    // third, unintended orientation before their blends settle.
    const poseAds = this.reloading ? 0 : this.ads;
    const poseSprint = this.reloading ? 0 : this.sprintBlend;
    const target = this._poseTargetPosition.copy(this.hipPosition).lerp(this.adsPosition, poseAds);
    target.lerp(this.sprintPosition, poseSprint);
    const moveSpeed = this.playerState?.speed ?? 0;
    const moving = Boolean(this.playerState?.moving && this.playerState?.grounded);
    const bob = moving ? Math.min(1, moveSpeed / 7.2) : 0;
    const sprintPace = THREE.MathUtils.lerp(9.2, 12.8, this.sprintBlend);
    const bobX = Math.sin(this.time * sprintPace) * THREE.MathUtils.lerp(0.008, 0.018, this.sprintBlend)
      * bob * (1 - this.ads * 0.72);
    const bobY = Math.abs(Math.cos(this.time * sprintPace)) * THREE.MathUtils.lerp(0.006, 0.014, this.sprintBlend)
      * bob * (1 - this.ads * 0.75);
    target.x += bobX;
    target.y += bobY;
    target.z += this.recoil * 0.075;
    // Clearance has priority and interpolates toward one complete transform.
    // Its authored yaw is zero, so simultaneous movement/aim inputs can only
    // retract the rifle and can never rotate the muzzle into the operator.
    target.lerp(this.wallPosition, this.wallBlend);

    const reloadProgress = this.reloading
      ? 1 - Math.max(0, this.reloadTimer) / this.reloadDuration
      : 0;
    // Keep the shouldered receiver stationary during the magazine exchange.
    // The support hand owns the reload movement; lifting and rolling the whole
    // weapon made that hand overshoot the handguard and then visibly turn back.
    this._animateReloadParts(reloadProgress);

    const smoothingDt = paused ? 0 : dt;
    this.viewRoot.position.x = dampAndSnap(this.viewRoot.position.x, target.x, 17, smoothingDt);
    this.viewRoot.position.y = dampAndSnap(this.viewRoot.position.y, target.y, 17, smoothingDt);
    this.viewRoot.position.z = dampAndSnap(this.viewRoot.position.z, target.z, 24, smoothingDt);

    const functionalPitch = -0.42 * poseSprint - this.recoil * 0.11;
    const functionalYaw = 0.3 * poseSprint;
    const functionalRoll = 0.55 * poseSprint - bobX * 0.7;
    this._poseTargetEuler.set(
      THREE.MathUtils.lerp(functionalPitch, this.wallRotation.x, this.wallBlend),
      THREE.MathUtils.lerp(functionalYaw, this.wallRotation.y, this.wallBlend),
      THREE.MathUtils.lerp(functionalRoll, this.wallRotation.z, this.wallBlend),
      'YXZ',
    );
    this._poseTargetQuaternion.setFromEuler(this._poseTargetEuler);
    const turnResponse = smoothingDt > 0 ? 1 - Math.exp(-smoothingDt * 18) : 1;
    this.viewRoot.quaternion.slerp(this._poseTargetQuaternion, turnResponse);
    if (this.viewRoot.quaternion.angleTo(this._poseTargetQuaternion) <= 1e-4) {
      this.viewRoot.quaternion.copy(this._poseTargetQuaternion);
    }
    this.poseMode = this.wallBlend > 0.02
      ? 'clearance'
      : this.reloading ? 'reload' : poseSprint > 0.02 ? 'sprint' : poseAds > 0.02 ? 'ads' : 'hip';
  }

  _syncViewmodelVisibility() {
    if (!this.enabled || !this.loaded) return;
    // Reload and keyboard ADS change pose state only. Reassert the visible
    // contract every frame so a transient input/visibility edge cannot leave
    // the rifle or its skinned hands hidden while control remains enabled.
    this.viewRoot.visible = true;
    this.hands?.setEnabled(true);
  }

  _updateWallClearance(dt) {
    let target = 0;
    this.wallDistance = null;
    if (this.enabled && this.loaded && typeof this.world?.raycastWorld === 'function') {
      this.camera.getWorldPosition(this._wallOrigin);
      this.camera.updateWorldMatrix(true, false);
      // Probe the complete authored hip-fire envelope in camera space. These
      // rays do not fold with the clearance animation, preventing a machine
      // from disappearing from the detector merely because the rifle has
      // already started turning sideways.
      const probePoints = [];
      for (const localPoint of this._wallProbeLocals) {
        probePoints.push(this.camera.localToWorld(this._wallProbeWorld.copy(localPoint)).clone());
      }
      try {
        for (const probePoint of probePoints) {
          this._wallDirection.copy(probePoint).sub(this._wallOrigin);
          const probeLength = this._wallDirection.length();
          if (probeLength < 0.08) continue;
          this._wallDirection.multiplyScalar(1 / probeLength);
          const result = this.world.raycastWorld(
            this._wallOrigin.clone(),
            this._wallDirection.clone(),
            probeLength + 0.08,
          );
          const hit = Array.isArray(result) ? result[0] : result;
          if (!hit) continue;
          const point = hit.point?.isVector3
            ? hit.point
            : hit.point ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : null;
          const distance = Number.isFinite(Number(hit.distance))
            ? Number(hit.distance)
            : point?.distanceTo(this._wallOrigin);
          if (Number.isFinite(distance)) {
            this.wallDistance = this.wallDistance == null ? distance : Math.min(this.wallDistance, distance);
            target = Math.max(
              target,
              THREE.MathUtils.clamp((probeLength + 0.12 - distance) / 0.5, 0, 1),
            );
          }
        }
      } catch (error) {
        console.warn('WeaponSystem wall-clearance raycast failed', error);
      }
    }
    this.wallBlend = dampAndSnap(
      this.wallBlend,
      target,
      target > this.wallBlend ? 26 : 12,
      Math.max(0, dt),
    );
  }

  _updateEffects(dt) {
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 150);
      if (this.muzzleTimer <= 0) {
        this.muzzleFlash.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    for (let index = this.casings.length - 1; index >= 0; index -= 1) {
      const effect = this.casings[index];
      effect.life -= dt;
      effect.velocity.y -= 9.81 * dt;
      effect.object.position.addScaledVector(effect.velocity, dt);
      effect.object.rotation.x += effect.spin.x * dt;
      effect.object.rotation.y += effect.spin.y * dt;
      effect.object.rotation.z += effect.spin.z * dt;
      if (effect.life <= 0) {
        effect.object.removeFromParent();
        this.casings.splice(index, 1);
      }
    }

    for (let index = this.tracers.length - 1; index >= 0; index -= 1) {
      const effect = this.tracers[index];
      effect.life -= dt;
      if (effect.life <= 0) {
        effect.object.geometry.dispose();
        effect.object.removeFromParent();
        this.tracers.splice(index, 1);
      }
    }

    for (let index = this.impacts.length - 1; index >= 0; index -= 1) {
      const effect = this.impacts[index];
      effect.life -= dt;
      const t = Math.max(0, effect.life / effect.maxLife);
      effect.object.scale.setScalar(0.7 + (1 - t) * 0.9);
      effect.object.material.opacity = 0.8 * t;
      if (effect.life <= 0) {
        effect.object.material.dispose();
        effect.object.removeFromParent();
        this.impacts.splice(index, 1);
      }
    }
  }

  _finishReload() {
    const needed = this.magSize - this.ammo;
    const loaded = Math.min(needed, this.reserve);
    this.ammo += loaded;
    this.reserve -= loaded;
    this.reloading = false;
    this.reloadNeedsCharge = false;
    this.reloadTimer = 0;
    this._restoreReloadParts();
    this._emit('onReload', { active: false, loaded, state: this.getState() });
    this._emitAmmo();
  }

  _cancelReload() {
    this.reloading = false;
    this.reloadNeedsCharge = false;
    this.reloadTimer = 0;
    this._restoreReloadParts();
    this._emit('onReload', { active: false, cancelled: true, state: this.getState() });
  }

  _getScene() {
    if (this.scene?.isScene) return this.scene;
    if (this.world?.scene?.isScene) return this.world.scene;
    let current = this.camera.parent;
    while (current && !current.isScene) current = current.parent;
    return current ?? null;
  }

  _emitAmmo() {
    this._emit('onAmmo', this.getState());
  }

  _emit(name, ...args) {
    const callback = this.callbacks?.[name];
    if (typeof callback !== 'function') return undefined;
    try {
      return callback(...args);
    } catch (error) {
      console.error(`WeaponSystem ${name} callback failed`, error);
      return undefined;
    }
  }
}

export default WeaponSystem;
