import * as THREE from 'three';
import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';

const MODEL_URL = new URL('../assets/models/hands/military-male-04-arms.fbx', import.meta.url).href;
const BODY_COLOR_URL = new URL('../assets/models/hands/sm005_body_color_acu.jpg', import.meta.url).href;
const BODY_NORMAL_URL = new URL('../assets/models/hands/sm005_body_normal.png', import.meta.url).href;
const BODY_SPECULAR_URL = new URL('../assets/models/hands/sm005_body_specular.jpg', import.meta.url).href;

const ARM_WEIGHT_THRESHOLD = 0.25;
// Rocketbox is authored in centimetres. Keep the shoulders just behind the
// camera plane, like a real shouldered rifle, so only forearms/hands enter the
// view instead of a sleeve starting centimetres in front of the player's eye.
const MODEL_SCALE = 0.01;
const MODEL_POSITION = new THREE.Vector3(0.18, -1.65, -0.183);
// ADS centres the rifle about 25 cm left of its hip pose. Shift only the
// hidden shoulder armature left with it so the firing arm remains within its
// real 55 cm two-bone reach instead of stretching 4+ cm short of the grip.
const ADS_ARMATURE_X = 0.04;
const ADS_ARMATURE_Z = -0.223;
const SPRINT_ARMATURE_X = 0.25;
const SPRINT_ARMATURE_Y = -1.7;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

// These are reachable wrist seats in the normalized rifle's local space, not
// the centres of the parts being held. The firing wrist sits above/behind the
// pistol grip; the support wrist seats against the handguard's left flank.
// Keep the firing hand in the shoulder-side/rear seat of the rifle. The lower
// wrist position compensates for the upright palm-plane turn, keeping the
// knuckles and trigger finger on the grip instead of opening away from it. The
// analytic elbow solve below still drops the rear elbow into a natural bend.
const TRIGGER_GRIP = new THREE.Vector3(0.024, -0.029, -0.015);
// Seat the support wrist beneath the forward handguard. Its upward-facing palm
// rises into the rail while the glove crosses it on a slight forward diagonal,
// instead of producing a vertical stack of fingers on the handguard's side.
const SUPPORT_GRIP = new THREE.Vector3(-0.058, 0.008, -0.288);
// Measured from the normalized CC0 M4's Trigger mesh (centre y=.0041,
// z=-.1363). Both index joints converge on this point, placing the modeled
// distal glove pad on the trigger without a generic curl pulling it away.
const TRIGGER_CONTACT = new THREE.Vector3(-0.001, 0.004, -0.137);
// Bend the index leftward in two visible stages instead of aiming both bones
// at one point. The distal bone then aims directly at the real trigger centre,
// so the glove pad closes onto it instead of stretching sideways past it.
const TRIGGER_FINGER_GUIDE = new THREE.Vector3(-0.012, 0.005, -0.116);
const TRIGGER_FINGER_PAD = new THREE.Vector3(-0.001, 0.004, -0.137);
// Rocketbox's hand local X runs wrist-to-knuckles, local Y is the palm normal,
// and local Z crosses thumb-to-pinky. The firing knuckles descend almost
// vertically into the pistol grip; the support knuckles travel mostly across
// the rail (+X) with a small forward component (-Z). Keeping its local Y aimed
// upward lays the support palm beneath the handguard.
// The firing hand's wrist-to-knuckle line follows the rifle when viewed from
// above, producing `|` rather than `\`. Its palm faces inward from the right;
// the support palm faces upward beneath the rail, so the two hands occupy
// distinct, anatomically plausible grip planes.
const FIRING_HAND_AXIS = new THREE.Vector3(0, 0, -1);
const FIRING_HAND_TILT = 0;
const FIRING_PALM_NORMAL = new THREE.Vector3(-1, 0, 0);
const SUPPORT_HAND_AXIS = new THREE.Vector3(0.985, 0, -0.174);
const SUPPORT_PALM_NORMAL = new THREE.Vector3(0, 1, 0);
// The firing thumb needs a visible hook around the rear/top contour of the
// pistol grip. Its first two joints stay behind the grip's rear edge while
// crossing toward the far side, then the pad closes forward onto that face.
// From overhead this produces a `]` wrap instead of a hidden `-|` silhouette.
const FIRING_THUMB_BRIDGE = new THREE.Vector3(0.018, 0.022, -0.058);
const FIRING_THUMB_CONTACT = new THREE.Vector3(-0.014, 0.02, -0.062);
const FIRING_THUMB_PAD = new THREE.Vector3(-0.024, 0.012, -0.102);
const PISTOL_GRIP_REAR_Z = -0.08;
// The support thumb is not another curled finger. These three points steer the
// real thumb inward and forward, then turn its pad downward around the lower
// handguard edge, visibly opposing the four fingers wrapped underneath it.
const SUPPORT_THUMB_BRIDGE = new THREE.Vector3(-0.04, 0.03, -0.32);
const SUPPORT_THUMB_CONTACT = new THREE.Vector3(-0.01, 0.025, -0.33);
const SUPPORT_THUMB_PAD = new THREE.Vector3(0.02, 0.015, -0.34);
const MAGAZINE_HAND_AXIS = new THREE.Vector3(0.08, -0.96, -0.26);
const MAGAZINE_FALLBACK = new THREE.Vector3(-0.018, -0.145, -0.205);
const MAGAZINE_POUCH = new THREE.Vector3(-0.04, -0.22, -0.235);
const CHARGING_HANDLE_FALLBACK = new THREE.Vector3(-0.02, 0.072, -0.07);
const COMPACT_RELOAD_TRAVEL_LIMIT = 0.235;
const MAX_RELOAD_SUPPORT_RISE = 0.025;

// Added local-Z flex, in radians, for [knuckle, middle, tip]. Rocketbox's
// bind pose already contains a small positive anatomical bend. The previous
// negative offsets cancelled that bend and made the gloves look straight.
// Finger 1 is the index finger and receives an explicit three-bone trigger
// contact below. The other firing fingers close into one compact circular grip
// around the pistol handle rather than resting in a partially open pose. The
// support hand closes progressively around the forward handguard.
const FINGER_CURL_POSES = Object.freeze({
  right: Object.freeze({
    0: Object.freeze([0.2, 0.48, 0.54]),
    1: Object.freeze([0.64, 0.48, 0.42]),
    2: Object.freeze([0.94, 1.08, 1.02]),
    3: Object.freeze([0.94, 1.08, 1.02]),
    4: Object.freeze([0.94, 1.08, 1.02]),
  }),
  left: Object.freeze({
    0: Object.freeze([0.24, 0.55, 0.6]),
    1: Object.freeze([0.56, 0.68, 0.62]),
    2: Object.freeze([0.64, 0.76, 0.7]),
    3: Object.freeze([0.7, 0.82, 0.74]),
    4: Object.freeze([0.76, 0.88, 0.8]),
  }),
});

function clamp01(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function dampAndSnap(current, target, lambda, dt, epsilon = 1e-5) {
  const next = THREE.MathUtils.damp(current, target, lambda, Math.max(0, dt));
  return Math.abs(next - target) <= epsilon ? target : next;
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function phase(value, start, end) {
  return smooth01((value - start) / Math.max(1e-5, end - start));
}

function normalizedBoneName(name) {
  return String(name ?? '').replace(/[\s:_-]/g, '').toLowerCase();
}

function isArmBoneName(name) {
  return /bip01[lr](?:upperarm|forearm|hand|finger)/.test(normalizedBoneName(name));
}

function findBone(root, aliases) {
  const wanted = aliases.map(normalizedBoneName);
  let match = null;
  root.traverse((object) => {
    if (match || !object.isBone) return;
    const clean = normalizedBoneName(object.name);
    if (wanted.some((alias) => clean === alias || clean.endsWith(alias))) match = object;
  });
  return match;
}

/**
 * Keep triangles whose three vertices are genuinely controlled by arm bones.
 * Rocketbox is authored as one body mesh, so this preserves the source mesh's
 * UVs, normals, skin weights and modeled gloves while removing torso/head/legs.
 */
function extractArmGeometry(source, skeleton, threshold = ARM_WEIGHT_THRESHOLD) {
  const skinIndex = source.getAttribute('skinIndex');
  const skinWeight = source.getAttribute('skinWeight');
  const position = source.getAttribute('position');
  if (!skinIndex || !skinWeight || !position || !skeleton) {
    throw new Error('Rocketbox arm extraction requires position and skin attributes.');
  }

  const armIndices = new Set();
  skeleton.bones.forEach((bone, index) => {
    if (isArmBoneName(bone.name)) armIndices.add(index);
  });
  if (armIndices.size === 0) throw new Error('Rocketbox arm bones were not found.');

  const sourceIndex = source.index;
  const vertexAt = (drawIndex) => sourceIndex ? sourceIndex.getX(drawIndex) : drawIndex;
  const armWeightAt = (vertex) => {
    let weight = 0;
    for (let channel = 0; channel < skinIndex.itemSize; channel += 1) {
      const boneIndex = skinIndex.array[vertex * skinIndex.itemSize + channel];
      if (armIndices.has(boneIndex)) {
        weight += skinWeight.array[vertex * skinWeight.itemSize + channel];
      }
    }
    return weight;
  };

  const sourceGroups = source.groups.length > 0
    ? source.groups
    : [{ start: 0, count: sourceIndex?.count ?? position.count, materialIndex: 0 }];
  const selectedGroups = [];
  const selectedVertices = [];
  for (const group of sourceGroups) {
    const groupStart = selectedVertices.length;
    const end = group.start + group.count;
    for (let draw = group.start; draw + 2 < end; draw += 3) {
      const triangle = [vertexAt(draw), vertexAt(draw + 1), vertexAt(draw + 2)];
      if (triangle.every((vertex) => armWeightAt(vertex) >= threshold)) {
        selectedVertices.push(...triangle);
      }
    }
    const count = selectedVertices.length - groupStart;
    if (count > 0) selectedGroups.push({
      start: groupStart,
      count,
      materialIndex: group.materialIndex ?? 0,
    });
  }

  if (selectedVertices.length === 0) throw new Error('Rocketbox arm extraction produced no triangles.');

  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const ArrayType = attribute.array.constructor;
    const array = new ArrayType(selectedVertices.length * attribute.itemSize);
    for (let output = 0; output < selectedVertices.length; output += 1) {
      const input = selectedVertices[output];
      for (let component = 0; component < attribute.itemSize; component += 1) {
        array[output * attribute.itemSize + component] =
          attribute.array[input * attribute.itemSize + component];
      }
    }
    const copy = new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized);
    copy.name = attribute.name;
    copy.setUsage(attribute.usage);
    geometry.setAttribute(name, copy);
  }
  selectedGroups.forEach((group) => geometry.addGroup(group.start, group.count, group.materialIndex));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.source = 'Microsoft Rocketbox Military_Male_04';
  geometry.userData.armWeightThreshold = threshold;
  geometry.userData.armTriangleCount = selectedVertices.length / 3;
  return geometry;
}

function collectMaterialResources(materials) {
  const materialSet = new Set();
  const textureSet = new Set();
  for (const material of materials) {
    if (!material || materialSet.has(material)) continue;
    materialSet.add(material);
    for (const value of Object.values(material)) {
      if (value?.isTexture) textureSet.add(value);
    }
  }
  return { materialSet, textureSet };
}

/**
 * Camera-space, skinned first-person arms for the M4 viewmodel.
 *
 * Integration:
 *   const hands = new FirstPersonHands(camera, weapon.viewRoot);
 *   await hands.load();
 *   hands.bindWeapon({
 *     root: weapon.viewRoot,
 *     magazine: weapon.magazine,
 *     chargingHandle: weapon.chargingHandle,
 *   });
 *   hands.update(dt, {
 *     enabled: weapon.enabled,
 *     ads: weapon.ads,
 *     sprint: weapon.sprintBlend,
 *     reloading: weapon.reloading,
 *     reloadProgress: weapon.getState().reloadProgress,
 *   });
 *   hands.dispose();
 */
export class FirstPersonHands {
  constructor(camera, weaponRoot = null, options = {}) {
    if (!camera?.isCamera) throw new TypeError('FirstPersonHands requires a THREE camera.');
    if (weaponRoot && !weaponRoot.isObject3D && typeof weaponRoot === 'object') {
      options = weaponRoot;
      weaponRoot = options.weaponRoot ?? null;
    }

    this.camera = camera;
    this.weaponRoot = weaponRoot;
    this.magazine = options.magazine ?? null;
    this.chargingHandle = options.chargingHandle ?? null;
    this.enabled = options.enabled !== false;
    this.loaded = false;
    this.disposed = false;
    this.loadingPromise = null;

    this.root = new THREE.Group();
    this.root.name = 'Rocketbox_FirstPerson_Arms_Root';
    this.root.userData.noHit = true;
    this.root.userData.sourceAsset = 'Microsoft Rocketbox Military_Male_04';
    this.root.userData.poseContract = {
      version: 11,
      coordinateSpace: 'weapon-local metres',
      rocketboxPalmPlane: 'local X/Z',
      rocketboxPalmNormal: 'local +Y',
      firingWrist: TRIGGER_GRIP.toArray(),
      supportWrist: SUPPORT_GRIP.toArray(),
      triggerContact: TRIGGER_CONTACT.toArray(),
      triggerFingerGuide: TRIGGER_FINGER_GUIDE.toArray(),
      triggerFingerPad: TRIGGER_FINGER_PAD.toArray(),
      firingHandAxis: FIRING_HAND_AXIS.toArray(),
      firingPalmNormal: FIRING_PALM_NORMAL.toArray(),
      rearHandBoneAlignment: 'weapon_parallel_from_above',
      rearHandDownturnDegrees: 0,
      rearHandTiltDegrees: THREE.MathUtils.radToDeg(FIRING_HAND_TILT),
      rearElbowPose: 'lowered_camera_local',
      firingThumbBridge: FIRING_THUMB_BRIDGE.toArray(),
      firingThumbContact: FIRING_THUMB_CONTACT.toArray(),
      firingThumbPad: FIRING_THUMB_PAD.toArray(),
      supportHandAxis: SUPPORT_HAND_AXIS.toArray(),
      supportPalmNormal: SUPPORT_PALM_NORMAL.toArray(),
      supportThumbBridge: SUPPORT_THUMB_BRIDGE.toArray(),
      supportThumbContact: SUPPORT_THUMB_CONTACT.toArray(),
      supportThumbPad: SUPPORT_THUMB_PAD.toArray(),
      supportGripMode: 'horizontal_cross_barrel_handguard',
      magazinePouch: MAGAZINE_POUCH.toArray(),
      adsArmatureX: ADS_ARMATURE_X,
      adsArmatureZ: ADS_ARMATURE_Z,
      sprintArmatureX: SPRINT_ARMATURE_X,
      sprintArmatureY: SPRINT_ARMATURE_Y,
      sprintRearGrip: 'same_as_hip_weapon_local',
      sprintElbowBranch: 'continuous_nearest_previous_pole',
      triggerIndexSolve: 'excluded from generic curl; final absolute three-bone leftward hook',
      firingThumbSolve: 'excluded from generic curl; final absolute three-bone surface wrap',
      supportThumbSolve: 'excluded from generic curl; final absolute opposed three-bone aim',
      supportThumbOpposition: 'dot(thumb base-to-pad, middle tip-to-knuckle); negative is opposed',
      compactReloadTravelLimit: COMPACT_RELOAD_TRAVEL_LIMIT,
      maxReloadSupportRise: MAX_RELOAD_SUPPORT_RISE,
      expectedFingerBones: 30,
    };
    this.root.visible = false;
    camera.add(this.root);

    this.model = null;
    this.armMeshes = [];
    this.material = null;
    this.ownedTextures = [];
    this.rig = null;
    this.fingerRest = new Map();
    this.supportMode = 'support';
    this.reloadProgress = 0;
    this.sprintBlend = 0;
    this.firingHandTilt = FIRING_HAND_TILT;

    this._triggerWorld = new THREE.Vector3();
    this._triggerContactWorld = new THREE.Vector3();
    this._triggerFingerGuideWorld = new THREE.Vector3();
    this._triggerFingerPadWorld = new THREE.Vector3();
    this._firingThumbBridgeWorld = new THREE.Vector3();
    this._firingThumbContactWorld = new THREE.Vector3();
    this._firingThumbPadWorld = new THREE.Vector3();
    this._supportWorld = new THREE.Vector3();
    this._supportThumbBridgeWorld = new THREE.Vector3();
    this._supportThumbContactWorld = new THREE.Vector3();
    this._supportThumbPadWorld = new THREE.Vector3();
    this._magazineWorld = new THREE.Vector3();
    this._magazinePouchWorld = new THREE.Vector3();
    this._chargingWorld = new THREE.Vector3();
    this._rightAxisWorld = new THREE.Vector3();
    this._leftAxisWorld = new THREE.Vector3();
    this._rightPalmWorld = new THREE.Vector3();
    this._leftPalmWorld = new THREE.Vector3();
    this._elbowDirection = new THREE.Vector3();
    this._elbowAlternate = new THREE.Vector3();
    this._rightElbowPoleWorld = new THREE.Vector3();
    this._rightElbowPoleValid = false;
    this._towardTarget = new THREE.Vector3();
    this._shoulder = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._wrist = new THREE.Vector3();
    this._boneOrigin = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._worldQuaternion = new THREE.Quaternion();
    this._poseQuaternion = new THREE.Quaternion();
    this._parentQuaternion = new THREE.Quaternion();
    this._correction = new THREE.Quaternion();
    this._desiredQuaternion = new THREE.Quaternion();
    this._curlQuaternion = new THREE.Quaternion();
    this._rollQuaternion = new THREE.Quaternion();
    this._basisMatrix = new THREE.Matrix4();
    this._cameraUpWorld = new THREE.Vector3();
    this._basisY = new THREE.Vector3();
    this._basisZ = new THREE.Vector3();
  }

  async load() {
    if (this.loaded) return this.root;
    if (this.loadingPromise) return this.loadingPromise;
    if (this.disposed) throw new Error('Cannot load disposed FirstPersonHands.');

    // The source FBX still names its original TGA maps. Redirect every one to
    // an equivalent packaged map so parsing produces no missing-file requests;
    // the arm mesh then receives one explicit body material below.
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const clean = decodeURIComponent(String(url)).toLowerCase();
      if (!/\.tga(?:$|[?#])/.test(clean)) return url;
      if (clean.includes('normal')) return BODY_NORMAL_URL;
      if (clean.includes('specular')) return BODY_SPECULAR_URL;
      return BODY_COLOR_URL;
    });
    const textureLoader = new THREE.TextureLoader(manager);

    this.loadingPromise = Promise.all([
      new FBXLoader(manager).loadAsync(MODEL_URL),
      textureLoader.loadAsync(BODY_COLOR_URL),
      textureLoader.loadAsync(BODY_NORMAL_URL),
      textureLoader.loadAsync(BODY_SPECULAR_URL),
    ]).then(([model, colorMap, normalMap, specularMap]) => {
      if (this.disposed) {
        colorMap.dispose();
        normalMap.dispose();
        specularMap.dispose();
        throw new Error('FirstPersonHands was disposed while loading.');
      }

      colorMap.colorSpace = THREE.SRGBColorSpace;
      for (const texture of [colorMap, normalMap, specularMap]) {
        texture.anisotropy = 8;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
      }
      this.ownedTextures.push(colorMap, normalMap, specularMap);

      const material = new THREE.MeshPhysicalMaterial({
        name: 'Rocketbox_Military04_ACU_Gloved_Arms',
        map: colorMap,
        normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        specularIntensityMap: specularMap,
        color: 0xffffff,
        roughness: 0.57,
        metalness: 0.025,
        specularIntensity: 0.46,
        depthTest: true,
        depthWrite: true,
      });
      this.material = material;

      const oldMaterials = [];
      const oldGeometries = [];
      const removable = [];
      model.traverse((object) => {
        object.userData.noHit = true;
        if (object.isLight) {
          removable.push(object);
          return;
        }
        if (!object.isMesh) return;
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        oldMaterials.push(...sourceMaterials.filter(Boolean));
        if (!object.isSkinnedMesh) {
          removable.push(object);
          return;
        }
        const armGeometry = extractArmGeometry(object.geometry, object.skeleton);
        oldGeometries.push(object.geometry);
        object.geometry = armGeometry;
        object.material = material;
        object.name = 'Rocketbox_Military04_Skinned_Gloved_Arms';
        object.castShadow = false;
        object.receiveShadow = false;
        object.frustumCulled = false;
        object.renderOrder = 1999;
        this.armMeshes.push(object);
      });
      removable.forEach((object) => object.removeFromParent());
      oldGeometries.forEach((geometry) => geometry.dispose());
      const oldResources = collectMaterialResources(oldMaterials);
      oldResources.materialSet.forEach((oldMaterial) => oldMaterial.dispose());
      oldResources.textureSet.forEach((texture) => {
        if (!this.ownedTextures.includes(texture)) texture.dispose();
      });

      if (this.armMeshes.length === 0) throw new Error('Military Male 04 contains no skinned arm mesh.');
      const triangleCount = this.armMeshes.reduce(
        (sum, mesh) => sum + (mesh.geometry.getAttribute('position')?.count ?? 0) / 3,
        0,
      );
      this.root.userData.armTriangleCount = triangleCount;
      this.root.userData.armWeightThreshold = ARM_WEIGHT_THRESHOLD;

      model.name = 'Rocketbox_Military04_FirstPerson_Armature';
      model.animations.length = 0;
      model.scale.setScalar(MODEL_SCALE);
      model.rotation.set(0, Math.PI, 0);
      model.position.copy(MODEL_POSITION);
      this.root.add(model);
      this.model = model;
      this._prepareRig(model);
      model.updateMatrixWorld(true);

      this.loaded = true;
      this.root.visible = this.enabled;
      return this.root;
    }).catch((error) => {
      this.loadingPromise = null;
      throw error;
    });

    return this.loadingPromise;
  }

  bindWeapon(binding = {}) {
    if (binding?.isObject3D) binding = { root: binding };
    if (binding.root?.isObject3D) this.weaponRoot = binding.root;
    if ('magazine' in binding) this.magazine = binding.magazine;
    if ('chargingHandle' in binding) this.chargingHandle = binding.chargingHandle;
    return this;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this._rightElbowPoleValid = false;
    this.root.visible = this.enabled && this.loaded;
  }

  update(dt, state = {}) {
    if (!this.loaded || this.disposed || !this.rig) return this;
    if (state.weaponRoot || state.magazine || state.chargingHandle) {
      this.bindWeapon({
        root: state.weaponRoot ?? this.weaponRoot,
        magazine: state.magazine ?? this.magazine,
        chargingHandle: state.chargingHandle ?? this.chargingHandle,
      });
    }
    if ('enabled' in state) this.setEnabled(state.enabled);
    if (!this.enabled) return this;
    // A zero-delta update is an authored teleport/reset used by respawn and
    // deterministic pose inspection. Start a fresh elbow branch there; normal
    // gameplay frames retain the prior pole for continuous sprint blending.
    if (dt <= 0) this._rightElbowPoleValid = false;

    const ads = clamp01(state.ads);
    const sprint = clamp01(state.sprint ?? state.sprintBlend);
    this.sprintBlend = sprint;
    const reloading = Boolean(state.reloading);
    const reloadProgress = reloading ? clamp01(state.reloadProgress) : 0;
    const response = dt > 0 ? 1 - Math.exp(-dt * (reloading ? 28 : 36)) : 1;
    const armatureX = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(MODEL_POSITION.x, ADS_ARMATURE_X, ads),
      SPRINT_ARMATURE_X,
      sprint,
    );
    this.model.position.x = dt > 0
      ? dampAndSnap(this.model.position.x, armatureX, 24, dt)
      : armatureX;
    const armatureY = THREE.MathUtils.lerp(MODEL_POSITION.y, SPRINT_ARMATURE_Y, sprint);
    this.model.position.y = dt > 0
      ? dampAndSnap(this.model.position.y, armatureY, 24, dt)
      : armatureY;
    const armatureZ = THREE.MathUtils.lerp(MODEL_POSITION.z, ADS_ARMATURE_Z, ads);
    this.model.position.z = dt > 0
      ? dampAndSnap(this.model.position.z, armatureZ, 24, dt)
      : armatureZ;

    this.camera.updateMatrixWorld(true);
    this.weaponRoot?.updateWorldMatrix(true, true);
    this.model.updateMatrixWorld(true);

    this._weaponPoint(TRIGGER_GRIP, this._triggerWorld);
    this._weaponPoint(TRIGGER_CONTACT, this._triggerContactWorld);
    this._weaponPoint(TRIGGER_FINGER_GUIDE, this._triggerFingerGuideWorld);
    this._weaponPoint(TRIGGER_FINGER_PAD, this._triggerFingerPadWorld);
    this._weaponPoint(FIRING_THUMB_BRIDGE, this._firingThumbBridgeWorld);
    this._weaponPoint(FIRING_THUMB_CONTACT, this._firingThumbContactWorld);
    this._weaponPoint(FIRING_THUMB_PAD, this._firingThumbPadWorld);
    this._weaponPoint(SUPPORT_GRIP, this._supportWorld);
    this._weaponPoint(SUPPORT_THUMB_BRIDGE, this._supportThumbBridgeWorld);
    this._weaponPoint(SUPPORT_THUMB_CONTACT, this._supportThumbContactWorld);
    this._weaponPoint(SUPPORT_THUMB_PAD, this._supportThumbPadWorld);
    this._weaponPoint(MAGAZINE_FALLBACK, this._magazineWorld);
    this._weaponPoint(MAGAZINE_POUCH, this._magazinePouchWorld);
    this._weaponPoint(CHARGING_HANDLE_FALLBACK, this._chargingWorld);

    if (this.magazine?.isObject3D) {
      this.magazine.updateWorldMatrix(true, false);
      this.magazine.getWorldPosition(this._magazineWorld);
      this._magazineWorld.y -= 0.035;
    }
    if (this.chargingHandle?.isObject3D) {
      this.chargingHandle.updateWorldMatrix(true, false);
      this.chargingHandle.getWorldPosition(this._chargingWorld);
      this._chargingWorld.x -= 0.018;
    }

    let leftMode = 'support';
    if (reloading) {
      if (reloadProgress < 0.16) {
        this._supportWorld.lerp(this._magazineWorld, phase(reloadProgress, 0.05, 0.16));
        leftMode = 'magazine';
      } else if (reloadProgress < 0.44) {
        this._supportWorld.copy(this._magazineWorld);
        leftMode = 'magazine';
      } else if (reloadProgress < 0.5) {
        this._supportWorld.copy(this._magazineWorld)
          .lerp(this._magazinePouchWorld, phase(reloadProgress, 0.44, 0.5));
        leftMode = 'magazine';
      } else if (reloadProgress < 0.56) {
        this._supportWorld.copy(this._magazinePouchWorld)
          .lerp(this._magazineWorld, phase(reloadProgress, 0.5, 0.56));
        leftMode = 'magazine';
      } else if (reloadProgress < 0.73) {
        this._supportWorld.copy(this._magazineWorld);
        leftMode = 'magazine';
      } else {
        // Once the fresh magazine is seated, return straight to the forward
        // handguard and hold it. Do not climb to the charging handle and arc
        // back down; the rifle's bolt-release animation is mechanical.
        const returnProgress = phase(reloadProgress, 0.73, 0.86);
        this._supportWorld.copy(this._magazineWorld)
          .lerp(this._weaponPoint(SUPPORT_GRIP, this._target), returnProgress);
        leftMode = returnProgress < 1 ? 'return' : 'support';
      }
    }
    this.supportMode = leftMode;
    this.reloadProgress = reloadProgress;

    // The support wrist never leaves a compact working envelope around the
    // handguard. This keeps the elbow bent while the magazine remains visibly
    // removable, instead of stretching the whole arm toward a belt-level pose.
    this._weaponPoint(SUPPORT_GRIP, this._target);
    this._towardTarget.copy(this._supportWorld).sub(this._target);
    if (this._towardTarget.length() > COMPACT_RELOAD_TRAVEL_LIMIT) {
      this._supportWorld.copy(this._target).add(
        this._towardTarget.setLength(COMPACT_RELOAD_TRAVEL_LIMIT),
      );
    }
    this._weaponDirection(UP, this._basisY);
    const upwardTravel = this._towardTarget.copy(this._supportWorld).sub(this._target).dot(this._basisY);
    if (upwardTravel > MAX_RELOAD_SUPPORT_RISE) {
      this._supportWorld.addScaledVector(this._basisY, MAX_RELOAD_SUPPORT_RISE - upwardTravel);
    }

    this._solveArm(this.rig.right, this._triggerWorld, 1, response, sprint);
    this._solveArm(this.rig.left, this._supportWorld, -1, response, sprint);

    // Like the support hand, the firing hand owns one immutable weapon-local
    // grip pose. Sprinting may move and rotate the rifle, but it must never
    // slide or re-roll the glove relative to the pistol grip.
    this._weaponDirection(FIRING_HAND_AXIS, this._rightAxisWorld);
    this._weaponDirection(FIRING_PALM_NORMAL, this._rightPalmWorld);
    if (leftMode === 'magazine') {
      this._weaponDirection(MAGAZINE_HAND_AXIS, this._leftAxisWorld);
      this._weaponDirection(SUPPORT_PALM_NORMAL, this._leftPalmWorld);
    } else {
      this._weaponDirection(SUPPORT_HAND_AXIS, this._leftAxisWorld);
      this._weaponDirection(SUPPORT_PALM_NORMAL, this._leftPalmWorld);
    }
    this.firingHandTilt = FIRING_HAND_TILT;
    this._orientHand(
      this.rig.right.hand,
      this._rightAxisWorld,
      this._rightPalmWorld,
      response,
      this.firingHandTilt,
      Y_AXIS,
    );
    this._orientHand(this.rig.left.hand, this._leftAxisWorld, this._leftPalmWorld, response);

    const relaxed = reloading ? Math.sin(Math.PI * phase(reloadProgress, 0.36, 0.76)) : 0;
    this._poseFingers('right', 1, response, true);
    this._poseFingers(
      'left',
      THREE.MathUtils.lerp(1, 0.44, relaxed),
      response,
      leftMode === 'support',
    );
    // Solve the real Rocketbox index chain onto the authored M4 trigger after
    // applying the grip curl. Its knuckle first travels inward/left, its middle
    // reaches the trigger, and its distal pad closes across the trigger face.
    this._aimBoneXAxis(this.rig.right.indexBase, this._triggerFingerGuideWorld, 1);
    this.rig.right.indexBase.updateWorldMatrix(true, true);
    this._aimBoneXAxis(this.rig.right.indexMiddle, this._triggerContactWorld, 1);
    this.rig.right.indexMiddle.updateWorldMatrix(true, true);
    this._aimBoneXAxis(this.rig.right.indexDistal, this._triggerFingerPadWorld, 1);
    this.rig.right.indexDistal.updateWorldMatrix(true, true);

    // Route the real three-bone firing thumb around the outside of the pistol
    // grip after the hand and other fingers are posed. Keeping it out of the
    // generic curl prevents the pad from rotating back through the handle.
    this._aimBoneXAxis(this.rig.right.thumbBase, this._firingThumbBridgeWorld, 1);
    this.rig.right.thumbBase.updateWorldMatrix(true, true);
    this._aimBoneXAxis(this.rig.right.thumbMiddle, this._firingThumbContactWorld, 1);
    this.rig.right.thumbMiddle.updateWorldMatrix(true, true);
    this._aimBoneXAxis(this.rig.right.thumbDistal, this._firingThumbPadWorld, 1);
    this.rig.right.thumbDistal.updateWorldMatrix(true, true);

    // On the foregrip the thumb closes from the opposite side of the four
    // fingers. Three absolute bone aims keep the modeled pad on the far rail
    // instead of letting the generic curl point it forward with the fingers.
    if (leftMode === 'support') {
      this._aimBoneXAxis(this.rig.left.thumbBase, this._supportThumbBridgeWorld, 1);
      this.rig.left.thumbBase.updateWorldMatrix(true, true);
      this._aimBoneXAxis(this.rig.left.thumbMiddle, this._supportThumbContactWorld, 1);
      this.rig.left.thumbMiddle.updateWorldMatrix(true, true);
      this._aimBoneXAxis(this.rig.left.thumbDistal, this._supportThumbPadWorld, 1);
      this.rig.left.thumbDistal.updateWorldMatrix(true, true);
    }

    // ADS and sprint are mainly inherited from the weapon root. These small
    // shoulder shifts retain a shouldered stance without making arms slide.
    this.root.position.x = dampAndSnap(this.root.position.x, -0.012 * ads + 0.018 * sprint, 18, dt);
    this.root.position.y = dampAndSnap(this.root.position.y, -0.012 * sprint, 18, dt);
    this.root.rotation.z = dampAndSnap(this.root.rotation.z, -0.035 * sprint, 18, dt);
    return this;
  }

  /**
   * Deterministic weapon-space evidence for automated and browser QA. Values
   * come from the live Rocketbox bones, not from duplicated expected poses.
   */
  getPoseProbe() {
    const contract = { ...this.root.userData.poseContract };
    if (!this.loaded || !this.rig || !this.model) return { ready: false, contract };

    const reference = this.weaponRoot?.isObject3D ? this.weaponRoot : this.camera;
    reference.updateWorldMatrix(true, true);
    this.model.updateMatrixWorld(true);
    const referenceWorldQuaternion = reference.getWorldQuaternion(new THREE.Quaternion());
    const inverseReference = referenceWorldQuaternion.clone().invert();
    const inverseCamera = this.camera.getWorldQuaternion(new THREE.Quaternion()).invert();
    const localPosition = (object) => reference.worldToLocal(
      object.getWorldPosition(new THREE.Vector3()),
    );
    const localDirection = (object, axis) => axis.clone()
      .applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()))
      .applyQuaternion(inverseReference)
      .normalize();
    const firingWrist = localPosition(this.rig.right.hand);
    const firingElbow = localPosition(this.rig.right.forearm);
    const firingShoulder = localPosition(this.rig.right.upperArm);
    const firingForearmAxis = firingWrist.clone().sub(firingElbow).normalize();
    const firingUpperArmAxis = firingElbow.clone().sub(firingShoulder).normalize();
    const firingPalmNormal = localDirection(this.rig.right.hand, new THREE.Vector3(0, 1, 0));
    const firingHandAxis = localDirection(this.rig.right.hand, X_AXIS);
    const firingSilhouetteAxis = localDirection(this.rig.right.hand, Z_AXIS);
    const firingHandCameraAxis = firingHandAxis.clone()
      .applyQuaternion(referenceWorldQuaternion).applyQuaternion(inverseCamera).normalize();
    const firingSilhouetteCameraAxis = firingSilhouetteAxis.clone()
      .applyQuaternion(referenceWorldQuaternion).applyQuaternion(inverseCamera).normalize();
    const firingForearmCameraAxis = firingForearmAxis.clone()
      .applyQuaternion(referenceWorldQuaternion).applyQuaternion(inverseCamera).normalize();
    const firingUpperArmCameraAxis = firingUpperArmAxis.clone()
      .applyQuaternion(referenceWorldQuaternion).applyQuaternion(inverseCamera).normalize();
    const indexBase = localPosition(this.rig.right.indexBase);
    const indexMiddle = localPosition(this.rig.right.indexMiddle);
    const indexDistal = localPosition(this.rig.right.indexDistal);
    const indexDistalAxis = localDirection(this.rig.right.indexDistal, X_AXIS);
    const indexSegment = indexDistal.clone().sub(indexMiddle);
    const contactOffset = TRIGGER_CONTACT.clone().sub(indexMiddle);
    const contactT = THREE.MathUtils.clamp(
      contactOffset.dot(indexSegment) / Math.max(1e-8, indexSegment.lengthSq()),
      0,
      1,
    );
    const middleClosestContact = indexMiddle.clone().addScaledVector(indexSegment, contactT);
    const distalLength = Math.max(1e-6, indexSegment.length());
    const distalContactOffset = TRIGGER_CONTACT.clone().sub(indexDistal);
    const distalContactDistance = THREE.MathUtils.clamp(
      distalContactOffset.dot(indexDistalAxis),
      0,
      distalLength,
    );
    const distalClosestContact = indexDistal.clone()
      .addScaledVector(indexDistalAxis, distalContactDistance);
    const closestContact = middleClosestContact.distanceToSquared(TRIGGER_CONTACT) <=
      distalClosestContact.distanceToSquared(TRIGGER_CONTACT)
      ? middleClosestContact
      : distalClosestContact;
    const firingMiddleBase = localPosition(this.rig.right.middleBase);
    const firingMiddleDistal = localPosition(this.rig.right.middleDistal);
    const firingThumbBase = localPosition(this.rig.right.thumbBase);
    const firingThumbMiddle = localPosition(this.rig.right.thumbMiddle);
    const firingThumbDistal = localPosition(this.rig.right.thumbDistal);

    const supportWrist = localPosition(this.rig.left.hand);
    const supportPalmNormal = localDirection(this.rig.left.hand, new THREE.Vector3(0, 1, 0));
    const supportHandAxis = localDirection(this.rig.left.hand, X_AXIS);
    const supportMiddleBase = localPosition(this.rig.left.middleBase);
    const supportMiddleDistal = localPosition(this.rig.left.middleDistal);
    const supportThumbBase = localPosition(this.rig.left.thumbBase);
    const supportThumbMiddle = localPosition(this.rig.left.thumbMiddle);
    const supportThumbDistal = localPosition(this.rig.left.thumbDistal);
    const supportPinky = localPosition(this.rig.left.pinkyBase);
    const supportThumbAxis = supportThumbDistal.clone().sub(supportThumbBase).normalize();
    const supportOpposingFingerAxis = supportMiddleBase.clone()
      .sub(supportMiddleDistal)
      .normalize();

    return {
      ready: true,
      contract,
      fingerBoneCount: this.fingerRest.size,
      firing: {
        wrist: firingWrist.toArray(),
        elbow: firingElbow.toArray(),
        shoulder: firingShoulder.toArray(),
        wristError: firingWrist.distanceTo(TRIGGER_GRIP),
        handAxis: firingHandAxis.toArray(),
        silhouetteAxis: firingSilhouetteAxis.toArray(),
        forearmAxis: firingForearmAxis.toArray(),
        handCameraAxis: firingHandCameraAxis.toArray(),
        silhouetteCameraAxis: firingSilhouetteCameraAxis.toArray(),
        forearmCameraAxis: firingForearmCameraAxis.toArray(),
        upperArmCameraAxis: firingUpperArmCameraAxis.toArray(),
        uprightApproach: -firingHandAxis.y,
        rearwardRake: firingHandAxis.z,
        handBoneAlignment: 'weapon_parallel_from_above',
        rearViewSilhouetteSlope: Math.abs(firingSilhouetteCameraAxis.x) /
          Math.max(1e-6, Math.abs(firingSilhouetteCameraAxis.y)),
        handForearmAlignmentDot: firingHandAxis.dot(firingForearmAxis),
        handPairAlignmentDot: firingHandAxis.dot(supportHandAxis),
        forearmVerticalDelta: firingWrist.y - firingElbow.y,
        elbowLowered: firingWrist.y > firingElbow.y,
        handDownturnDegrees: 0,
        handTiltDegrees: THREE.MathUtils.radToDeg(this.firingHandTilt),
        palmNormal: firingPalmNormal.toArray(),
        palmVerticality: 1 - Math.min(1, Math.abs(firingPalmNormal.y)),
        topViewSlope: Math.abs(firingHandAxis.x) /
          Math.max(1e-6, Math.abs(firingHandAxis.z)),
        indexBase: indexBase.toArray(),
        indexMiddle: indexMiddle.toArray(),
        indexDistal: indexDistal.toArray(),
        indexDistalAxis: indexDistalAxis.toArray(),
        indexKnuckleLeft: indexMiddle.x - indexBase.x,
        indexOverallLeft: indexDistal.x - indexBase.x,
        indexLateralClosure: indexDistal.x - indexMiddle.x,
        indexPadAlignment: indexDistalAxis.dot(
          TRIGGER_FINGER_PAD.clone().sub(indexDistal).normalize(),
        ),
        triggerContactDistance: closestContact.distanceTo(TRIGGER_CONTACT),
        triggerContactT: contactT,
        triggerDistalContactT: distalContactDistance / distalLength,
        gripWrap: firingMiddleBase.x - firingMiddleDistal.x,
        middleBase: firingMiddleBase.toArray(),
        middleDistal: firingMiddleDistal.toArray(),
        visibleGripSlope: Math.abs(firingMiddleBase.x - firingMiddleDistal.x) /
          Math.max(1e-6, Math.abs(firingMiddleBase.y - firingMiddleDistal.y)),
        thumbBase: firingThumbBase.toArray(),
        thumbMiddle: firingThumbMiddle.toArray(),
        thumbDistal: firingThumbDistal.toArray(),
        thumbRearClearance: firingThumbMiddle.z - PISTOL_GRIP_REAR_Z,
        thumbHooksAcrossGrip: firingThumbDistal.x < firingThumbMiddle.x,
      },
      support: {
        wrist: supportWrist.toArray(),
        wristError: supportWrist.distanceTo(SUPPORT_GRIP),
        handAxis: supportHandAxis.toArray(),
        palmNormal: supportPalmNormal.toArray(),
        palmVerticality: 1 - Math.min(1, Math.abs(supportPalmNormal.y)),
        palmUpAlignment: supportPalmNormal.y,
        crossBarrelAlignment: supportHandAxis.x,
        forwardAlignment: -supportHandAxis.z,
        inwardWrap: supportMiddleDistal.x - supportMiddleBase.x,
        upwardWrap: supportMiddleDistal.y - supportMiddleBase.y,
        middleBase: supportMiddleBase.toArray(),
        middleDistal: supportMiddleDistal.toArray(),
        thumbBase: supportThumbBase.toArray(),
        thumbMiddle: supportThumbMiddle.toArray(),
        thumbDistal: supportThumbDistal.toArray(),
        thumbFarSide: supportThumbDistal.x,
        thumbInwardWrap: supportThumbDistal.x - supportThumbBase.x,
        thumbBarrelHeight: supportThumbDistal.y,
        thumbDownwardCurl: supportThumbDistal.y - supportThumbMiddle.y,
        thumbForwardLean: supportThumbDistal.z - supportThumbBase.z,
        thumbOppositionDot: supportThumbAxis.dot(supportOpposingFingerAxis),
        thumbPinkySeparation: supportThumbBase.y - supportPinky.y,
        verticalSpread: supportThumbBase.y - supportPinky.y,
      },
      reload: {
        progress: this.reloadProgress,
        supportMode: this.supportMode,
        supportTravel: supportWrist.distanceTo(SUPPORT_GRIP),
        compactTravelLimit: COMPACT_RELOAD_TRAVEL_LIMIT,
        supportRise: supportWrist.y - SUPPORT_GRIP.y,
        maxSupportRise: MAX_RELOAD_SUPPORT_RISE,
      },
      sprint: {
        blend: this.sprintBlend,
        rearHandTurnsWithWeapon: firingHandAxis.dot(supportHandAxis),
        rearArmCameraTurn: Math.min(
          firingHandCameraAxis.y,
          firingForearmCameraAxis.y,
          firingUpperArmCameraAxis.y,
        ),
        handPose: 'same_as_hip_weapon_local',
      },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.armMeshes.forEach((mesh) => mesh.geometry?.dispose());
    this.material?.dispose();
    this.ownedTextures.forEach((texture) => texture.dispose());
    this.armMeshes.length = 0;
    this.ownedTextures.length = 0;
    this.fingerRest.clear();
    this.rig = null;
    this.model = null;
    this.loaded = false;
  }

  _prepareRig(model) {
    const side = (letter) => ({
      upperArm: findBone(model, [`bip01${letter}upperarm`]),
      forearm: findBone(model, [`bip01${letter}forearm`]),
      hand: findBone(model, [`bip01${letter}hand`]),
      indexBase: findBone(model, [`bip01${letter}finger1`]),
      indexMiddle: findBone(model, [`bip01${letter}finger11`]),
      indexDistal: findBone(model, [`bip01${letter}finger12`]),
      middleBase: findBone(model, [`bip01${letter}finger2`]),
      middleDistal: findBone(model, [`bip01${letter}finger22`]),
      thumbBase: findBone(model, [`bip01${letter}finger0`]),
      thumbMiddle: findBone(model, [`bip01${letter}finger01`]),
      thumbDistal: findBone(model, [`bip01${letter}finger02`]),
      pinkyBase: findBone(model, [`bip01${letter}finger4`]),
    });
    this.rig = { right: side('r'), left: side('l') };
    for (const [name, rig] of Object.entries(this.rig)) {
      if (!rig.upperArm || !rig.forearm || !rig.hand || !rig.indexBase ||
          !rig.indexMiddle || !rig.indexDistal || !rig.middleBase ||
          !rig.middleDistal || !rig.thumbBase || !rig.thumbMiddle ||
          !rig.thumbDistal || !rig.pinkyBase) {
        throw new Error(`Rocketbox ${name} arm chain is incomplete.`);
      }
    }
    model.traverse((bone) => {
      if (!bone.isBone || !/bip01[lr]finger/.test(normalizedBoneName(bone.name))) return;
      this.fingerRest.set(bone, bone.quaternion.clone());
    });
    this.root.userData.poseContract.fingerBoneCount = this.fingerRest.size;
  }

  _solveArm(rig, target, outwardSign, weight, sprint) {
    this.model.updateMatrixWorld(true);
    rig.upperArm.getWorldPosition(this._shoulder);
    rig.forearm.getWorldPosition(this._elbow);
    rig.hand.getWorldPosition(this._wrist);
    const upperLength = this._shoulder.distanceTo(this._elbow);
    const lowerLength = this._elbow.distanceTo(this._wrist);
    this._towardTarget.copy(target).sub(this._shoulder);
    const rawDistance = this._towardTarget.length();
    if (rawDistance < 1e-5 || upperLength < 1e-5 || lowerLength < 1e-5) return;
    this._towardTarget.multiplyScalar(1 / rawDistance);
    const distance = THREE.MathUtils.clamp(
      rawDistance,
      Math.abs(upperLength - lowerLength) + 0.004,
      upperLength + lowerLength - 0.006,
    );

    const along = (
      upperLength * upperLength + distance * distance - lowerLength * lowerLength
    ) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));

    if (outwardSign > 0 && bend > 1e-5) {
      // At rest, solve the elbow against camera-local up to preserve the exact
      // lowered firing pose while looking uphill or downhill. During sprint,
      // blend that solve plane into weapon space so the upper arm, forearm and
      // rear glove all follow the rifle's left-fold turn as one chain.
      this.camera.getWorldQuaternion(this._worldQuaternion);
      this._cameraUpWorld.copy(UP).applyQuaternion(this._worldQuaternion);
      if (this.weaponRoot?.isObject3D && sprint > 0) {
        this.weaponRoot.getWorldQuaternion(this._poseQuaternion);
        this._worldQuaternion.slerp(this._poseQuaternion, smooth01(sprint));
      }
      this._basisY.copy(UP).applyQuaternion(this._worldQuaternion);
      this._basisY.addScaledVector(this._towardTarget, -this._basisY.dot(this._towardTarget));
      if (this._basisY.lengthSq() < 1e-6) this._basisY.set(0, 0, 1).applyQuaternion(this._worldQuaternion);
      this._basisY.normalize();
      this._basisZ.crossVectors(this._towardTarget, this._basisY).normalize();
      this._elbowDirection.set(1, 0, 0).applyQuaternion(this._worldQuaternion);
      if (!this._rightElbowPoleValid && this._basisZ.dot(this._elbowDirection) < 0) {
        this._basisZ.negate();
      }
      this._elbow.copy(this._shoulder).addScaledVector(this._towardTarget, along);
      const verticalShare = THREE.MathUtils.clamp(
        (this._target.copy(target).sub(this._elbow).dot(this._cameraUpWorld) - 0.075) /
          Math.max(1e-5, bend * this._basisY.dot(this._cameraUpWorld)),
        -0.98,
        0.98,
      );
      const lateralShare = Math.sqrt(Math.max(0, 1 - verticalShare * verticalShare));
      this._elbowDirection.copy(this._basisY).multiplyScalar(verticalShare)
        .addScaledVector(this._basisZ, lateralShare)
        .normalize();
      if (this._rightElbowPoleValid) {
        // The elbow circle has two equally valid lateral solutions. Choosing
        // their sign from a moving camera/weapon basis can cross zero during
        // Shift and swap the rear arm to the opposite side for one frame.
        // Compare both candidates to the last solved pole and stay on the
        // closest hemisphere, preserving the lowered vertical component.
        this._elbowAlternate.copy(this._basisY).multiplyScalar(verticalShare)
          .addScaledVector(this._basisZ, -lateralShare)
          .normalize();
        if (this._elbowAlternate.dot(this._rightElbowPoleWorld) >
            this._elbowDirection.dot(this._rightElbowPoleWorld)) {
          this._elbowDirection.copy(this._elbowAlternate);
        }
      }
      if (this.weaponRoot?.isObject3D && sprint > 0) {
        // On the reachable elbow circle, choose the point closest to a forearm
        // aimed along the folded rifle. This rotates the complete rear arm,
        // rather than twisting only the glove after the elbow has stayed put.
        this._weaponDirection(FIRING_HAND_AXIS, this._rightAxisWorld);
        this._target.copy(target)
          .addScaledVector(this._rightAxisWorld, -lowerLength)
          .sub(this._elbow);
        this._target.addScaledVector(this._towardTarget, -this._target.dot(this._towardTarget));
        if (this._target.lengthSq() > 1e-8) {
          this._target.normalize();
          // This projected sprint pole is also sign-ambiguous. Keep it on the
          // same hemisphere as the last solved rear elbow before blending;
          // otherwise the projection reverses near the early sprint crossing
          // and defeats the continuous base-circle choice above.
          if (this._rightElbowPoleValid && this._target.dot(this._rightElbowPoleWorld) < 0) {
            this._target.negate();
          }
          // Preserve part of the lowered-elbow solve while folding the arm
          // toward the rifle. A full replacement made the sprint elbow rise
          // level with the wrist even though the glove stayed attached.
          this._elbowDirection.lerp(this._target, 0.78 * smooth01(sprint)).normalize();
        }
      }
      this._rightElbowPoleWorld.copy(this._elbowDirection);
      this._rightElbowPoleValid = true;
    } else {
      // The support elbow retains its lower, relaxed bend around the handguard.
      const elbowVertical = -0.2 - 0.12 * sprint;
      this._elbowDirection.set(outwardSign, elbowVertical, 0.08);
      this._elbowDirection.applyQuaternion(this.camera.getWorldQuaternion(this._worldQuaternion));
      this._elbowDirection.addScaledVector(
        this._towardTarget,
        -this._elbowDirection.dot(this._towardTarget),
      );
      if (this._elbowDirection.lengthSq() < 1e-6) {
        this._elbowDirection.crossVectors(this._towardTarget, UP);
        if (outwardSign < 0) this._elbowDirection.negate();
      }
      this._elbowDirection.normalize();
    }
    this._target.copy(this._shoulder)
      .addScaledVector(this._towardTarget, along)
      .addScaledVector(this._elbowDirection, bend);

    this._aimBoneXAxis(rig.upperArm, this._target, weight);
    rig.upperArm.updateWorldMatrix(true, true);
    this._aimBoneXAxis(rig.forearm, target, weight);
    rig.forearm.updateWorldMatrix(true, true);
  }

  _aimBoneXAxis(bone, target, weight) {
    bone.getWorldPosition(this._boneOrigin);
    this._towardTarget.copy(target).sub(this._boneOrigin);
    if (this._towardTarget.lengthSq() < 1e-8) return;
    this._towardTarget.normalize();
    bone.getWorldQuaternion(this._worldQuaternion);
    this._elbowDirection.copy(X_AXIS).applyQuaternion(this._worldQuaternion).normalize();
    this._correction.setFromUnitVectors(this._elbowDirection, this._towardTarget);
    this._desiredQuaternion.copy(this._correction).multiply(this._worldQuaternion);
    bone.parent?.getWorldQuaternion(this._parentQuaternion) ?? this._parentQuaternion.identity();
    this._parentQuaternion.invert();
    this._desiredQuaternion.premultiply(this._parentQuaternion);
    bone.quaternion.slerp(this._desiredQuaternion, clamp01(weight));
  }

  _orientHand(hand, axisWorld, palmNormalWorld, weight, rotation = 0, rotationAxis = X_AXIS) {
    if (!hand) return;
    const x = this._towardTarget.copy(axisWorld).normalize();
    // Rocketbox's palm surface is local X/Z, not X/Y. Orient local Y toward
    // the rifle as the palm normal, then derive local Z. The old camera-up Y
    // basis made the X/Z surface horizontal and produced the flat-hand look.
    this._basisY.copy(palmNormalWorld);
    this._basisY.addScaledVector(x, -this._basisY.dot(x));
    if (this._basisY.lengthSq() < 1e-6) {
      this.camera.getWorldQuaternion(this._worldQuaternion);
      this._basisY.copy(UP).applyQuaternion(this._worldQuaternion);
      this._basisY.addScaledVector(x, -this._basisY.dot(x));
    }
    this._basisY.normalize();
    this._basisZ.crossVectors(x, this._basisY);
    if (this._basisZ.lengthSq() < 1e-6) this._basisZ.set(0, 0, 1);
    this._basisZ.normalize();
    this._basisY.crossVectors(this._basisZ, x).normalize();
    this._basisMatrix.makeBasis(x, this._basisY, this._basisZ);
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

  _poseFingers(side, curl, weight, excludeThumb = false) {
    const sideToken = side === 'right' ? 'bip01rfinger' : 'bip01lfinger';
    const pose = FINGER_CURL_POSES[side];
    for (const [bone, rest] of this.fingerRest) {
      const clean = normalizedBoneName(bone.name);
      if (!clean.startsWith(sideToken)) continue;
      const suffix = clean.slice(sideToken.length);
      const finger = Number.parseInt(suffix[0] ?? '0', 10);
      // The firing index is an authored contact chain, not a generic grip
      // curl. Re-curling it here and partially aiming it afterward produced a
      // stable but incorrect 17 mm miss at normal 60 Hz response weights.
      if (side === 'right' && finger === 1) continue;
      if (finger === 0 && excludeThumb) continue;
      // Rocketbox names the three segments Finger1, Finger11, Finger12 (and
      // equivalently 0/2/3/4). Length-based parsing collapsed the latter two
      // onto one segment; read the final digit so every real phalanx is posed.
      const segment = suffix.length === 1
        ? 0
        : THREE.MathUtils.clamp(Number.parseInt(suffix.slice(1), 10) || 1, 1, 2);
      const angle = (pose?.[finger]?.[segment] ?? 0.6) * clamp01(curl);
      this._curlQuaternion.setFromAxisAngle(Z_AXIS, angle);
      this._desiredQuaternion.copy(rest).multiply(this._curlQuaternion);
      bone.quaternion.slerp(this._desiredQuaternion, clamp01(weight));
    }
  }

  _weaponPoint(localPoint, out) {
    out.copy(localPoint);
    if (this.weaponRoot?.isObject3D) return this.weaponRoot.localToWorld(out);
    return this.camera.localToWorld(out);
  }

  _weaponDirection(localDirection, out) {
    const source = this.weaponRoot?.isObject3D ? this.weaponRoot : this.camera;
    source.getWorldQuaternion(this._worldQuaternion);
    return out.copy(localDirection).applyQuaternion(this._worldQuaternion).normalize();
  }
}

export default FirstPersonHands;
