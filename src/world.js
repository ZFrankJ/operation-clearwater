import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const URLS = Object.freeze({
  concrete: new URL('../assets/textures/concrete-diff.jpg', import.meta.url).href,
  concreteNormal: new URL('../assets/textures/concrete-normal.jpg', import.meta.url).href,
  concreteRough: new URL('../assets/textures/concrete-rough.jpg', import.meta.url).href,
  environment: new URL('../assets/textures/docklands_02_1k.hdr', import.meta.url).href,
  grass: new URL('../assets/nature/surfaces/mud_forest/mud_forest_diff_1k.jpg', import.meta.url).href,
  grassNormal: new URL('../assets/nature/surfaces/mud_forest/mud_forest_nor_gl_1k.jpg', import.meta.url).href,
  grassRough: new URL('../assets/nature/surfaces/mud_forest/mud_forest_rough_1k.jpg', import.meta.url).href,
  grassAO: new URL('../assets/nature/surfaces/mud_forest/mud_forest_ao_1k.jpg', import.meta.url).href,
  gravel: new URL('../assets/nature/surfaces/dry_ground_rocks/dry_ground_rocks_diff_1k.jpg', import.meta.url).href,
  gravelNormal: new URL('../assets/nature/surfaces/dry_ground_rocks/dry_ground_rocks_nor_gl_1k.jpg', import.meta.url).href,
  gravelRough: new URL('../assets/nature/surfaces/dry_ground_rocks/dry_ground_rocks_rough_1k.jpg', import.meta.url).href,
  gravelAO: new URL('../assets/nature/surfaces/dry_ground_rocks/dry_ground_rocks_ao_1k.jpg', import.meta.url).href,
  pine: new URL('../assets/nature/models/pine_sapling_small/pine_sapling_small_1k.gltf', import.meta.url).href,
  shrub02: new URL('../assets/nature/models/shrub_02/shrub_02_1k.gltf', import.meta.url).href,
  shrub04: new URL('../assets/nature/models/shrub_04/shrub_04_1k.gltf', import.meta.url).href,
  grassClump: new URL('../assets/nature/models/grass_medium_02/grass_medium_02_1k.gltf', import.meta.url).href,
  boulder: new URL('../assets/nature/models/boulder_01/boulder_01_1k.gltf', import.meta.url).href,
  rock: new URL('../assets/nature/models/rock_07/rock_07_1k.gltf', import.meta.url).href,
});

const EPSILON = 0.0001;
const UP = new THREE.Vector3(0, 1, 0);
// The rendered land continues well past every authored prop and the actor
// boundary.  Earlier grass reached z=106.5 while the terrain stopped at z=98,
// exposing a literal strip of vegetation over the void from the insertion
// camera.  The playable ridge now sits 18-50 m inside these true mesh edges.
const TERRAIN_MIN_X = -132;
const TERRAIN_MAX_X = 132;
const TERRAIN_MIN_Z = -188;
const TERRAIN_MAX_Z = 164;

// Static contract for build-time QA. Runtime createWorld() exposes the same
// contract alongside the fully measured graph in world.pipeNetwork.
export const PIPE_NETWORK_CONTRACT = Object.freeze({
  revision: 'clearwater-connected-waterworks-v1',
  graphKind: 'directed_hydraulic_network',
  sourceNodeIds: Object.freeze([
    'PROCESS_TANK_A_OUTLET',
    'PROCESS_TANK_B_OUTLET',
    'PROCESS_TANK_C_OUTLET',
  ]),
  pumpEquipmentIds: Object.freeze(['PROCESS_PUMP_1', 'PROCESS_PUMP_2']),
  poisonInjectionNodeId: 'POST_PUMP_POISON_INJECTION_PORT',
  valveEquipmentId: 'SUPPLY_VALVE_BODY_HYDRAULICS',
  sinkNodeId: 'BACKDOOR_CITY_MAIN_BURIED_CONNECTION',
  hydraulicFlowPath: Object.freeze([
    'PROCESS_TANK_OUTLETS',
    'PROCESS_SUCTION_MANIFOLD',
    'PROCESS_PUMPS',
    'PROCESS_CITY_FEED_HEADER',
    'POST_PUMP_POISON_INJECTION_PORT',
    'INTERBUILDING_CLEAN_WATER_HEADER',
    'SUPPLY_VALVE_BODY_HYDRAULICS',
    'CITY_SUPPLY_MAIN_DOWNSTREAM',
    'BACKDOOR_MAIN_PIPE',
    'BACKDOOR_CITY_MAIN_BURIED_CONNECTION',
  ]),
  requiredRunIds: Object.freeze([
    'PROCESS_SUCTION_MANIFOLD',
    'PROCESS_PUMP_1_SUCTION',
    'PROCESS_PUMP_1_OVERHEAD_DISCHARGE',
    'PROCESS_PUMP_2_SUCTION',
    'PROCESS_PUMP_2_OVERHEAD_DISCHARGE',
    'PROCESS_CITY_FEED_HEADER',
    'PROCESS_POST_PUMP_HEADER',
    'POISON_DOSING_SINGLE_TRUNK',
    'POISON_INJECTION_QUILL',
    'INTERBUILDING_CLEAN_WATER_HEADER',
    'CITY_SUPPLY_MAIN',
    'CITY_SUPPLY_MAIN_DOWNSTREAM',
    'BACKDOOR_MAIN_PIPE',
    'BACKDOOR_CITY_MAIN_BURIED_DROP',
  ]),
  wallPenetrationIds: Object.freeze([
    'PROCESS_SOUTH_WALL_PIPE_COLLAR_PENETRATION',
    'VALVE_NORTH_WALL_PIPE_COLLAR_PENETRATION',
    'VALVE_VAULT_PARTITION_PIPE_COLLAR_PENETRATION',
    'BACKDOOR_PIPE_WALL_COLLAR_PENETRATION',
  ]),
  invariants: Object.freeze({
    allRunEndpointsTerminated: true,
    allExposedHorizontalRunsSupported: true,
    noCoincidentRuns: true,
    pumpDischargePrecedesPoisonInjection: true,
    poisonFeedsSingleInjectionPort: true,
    cityMainPassesThroughValve: true,
    backdoorIsSoleDownstreamPath: true,
    everyTankReachesSinkThroughPumpInjectionValveAndBackdoor: true,
  }),
});

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

// One deterministic terrain profile drives both rendering and collision. The
// playable compound is deliberately graded flat; its authored side hills and
// reservoir berm are fixed rather than noise-generated.
export function terrainHeight(x, z) {
  const side = Math.max(0, Math.abs(x) - 34);
  let height = side > 0 ? 0.032 * side + 1.15 * (1 - Math.exp(-side / 16)) : 0;
  // A few fixed, broad landforms beyond the fence break the artificial
  // bilateral berm silhouette without putting procedural noise under any
  // playable route, foundation, spawn, or collision test.
  const outerBlend = smooth01(side / 12);
  height += outerBlend * (
    1.45 * Math.exp(-(((x - 62) ** 2) / 1050 + ((z - 18) ** 2) / 3200))
    + 1.05 * Math.exp(-(((x + 68) ** 2) / 1350 + ((z + 52) ** 2) / 2500))
    + 0.7 * Math.exp(-(((x - 72) ** 2) / 1800 + ((z + 92) ** 2) / 1900))
  );
  // Keep the central insertion corridor level with the authored service track;
  // northern rise only belongs to the distant side shoulders.
  if (z > 68) height += outerBlend * smooth01((z - 68) / 30) * 1.15;
  if (z < -112 && z >= -126) height += smooth01((-112 - z) / 14) * 1.65;
  if (z < -126 && z >= -143) {
    height += THREE.MathUtils.lerp(1.65, -3.65, smooth01((-126 - z) / 17));
  }
  if (z < -143) height += -3.65;
  // Broad forested shoulders rise before the actor boundary, so the playable
  // world finishes as believable hills and a far reservoir bank rather than
  // at the rectangular edge of the ground mesh.
  const sideBoundary = smooth01((Math.abs(x) - 74) / 42);
  height += sideBoundary * (11.8 + 1.4 * Math.exp(-((z - 42) ** 2) / 6200));
  const northBoundary = smooth01((z - 118) / 34);
  height += northBoundary * (12.4 + 1.2 * Math.exp(-(x ** 2) / 5200));
  const farReservoirBank = smooth01((-160 - z) / 24);
  height += farReservoirBank * (12.2 + 0.8 * Math.exp(-(x ** 2) / 6400));
  return height;
}

function asVector3(value, fallback = null) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3) return new THREE.Vector3(value[0], value[1], value[2]);
  if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) {
    return new THREE.Vector3(value.x, value.y, value.z);
  }
  return fallback?.clone?.() ?? null;
}

function configureTexture(texture, anisotropy, color, repeat) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = anisotropy;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeTerrainGeometry(columns = 80, rows = 92) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    const z = THREE.MathUtils.lerp(TERRAIN_MAX_Z, TERRAIN_MIN_Z, row / rows);
    for (let column = 0; column <= columns; column += 1) {
      const x = THREE.MathUtils.lerp(TERRAIN_MIN_X, TERRAIN_MAX_X, column / columns);
      positions.push(x, terrainHeight(x, z), z);
      uvs.push(column / columns, 1 - row / rows);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      // Counter-clockwise from above so the walkable face and its normals
      // point upward. Reversing this winding makes the ground disappear.
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const uv = new THREE.Float32BufferAttribute(uvs, 2);
  geometry.setAttribute('uv', uv);
  geometry.setAttribute('uv1', uv.clone());
  geometry.setAttribute('uv2', uv.clone());
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'RidgewatchGoldenSky',
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x557d9a) },
      horizon: { value: new THREE.Color(0xe7caa4) },
      ground: { value: new THREE.Color(0x82929a) },
      sunDirection: { value: new THREE.Vector3(-0.55, 0.42, 0.32).normalize() },
    },
    vertexShader: `varying vec3 vDirection;
      void main(){ vDirection=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDirection;
      varying vec3 vDirection;
      void main(){
        float h=clamp(vDirection.y*.5+.5,0.,1.);
        vec3 sky=mix(ground,horizon,smoothstep(.08,.46,h));
        sky=mix(sky,zenith,smoothstep(.48,.96,h));
        float glow=pow(max(dot(normalize(vDirection),sunDirection),0.),24.);
        float disk=pow(max(dot(normalize(vDirection),sunDirection),0.),760.);
        sky+=vec3(.42,.19,.06)*glow*.36+vec3(1.,.72,.38)*disk*2.5;
        gl_FragColor=vec4(sky,1.);
      }`,
  });
}

function makeLabelTexture(title, subtitle, accent = '#55b9c8') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const code = String(title).split(/\s+/).map((word) => word[0]).join('').slice(0, 3).toUpperCase();
  context.fillStyle = '#d9ddd8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#163642';
  context.fillRect(0, 0, canvas.width, 54);
  context.fillStyle = accent;
  context.fillRect(0, 54, 128, canvas.height - 54);
  context.fillStyle = '#eef5f2';
  context.font = '800 30px ui-monospace, monospace';
  context.fillText('RIDGEWATCH MUNICIPAL WATER', 28, 37, 760);
  context.fillStyle = '#0d2831';
  context.font = '850 54px system-ui, sans-serif';
  context.fillText(title, 158, 132, 815);
  context.fillStyle = '#536268';
  context.font = '650 25px system-ui, sans-serif';
  context.fillText(subtitle, 160, 177, 810);
  context.fillStyle = '#f5fbf8';
  context.font = '900 42px ui-monospace, monospace';
  context.textAlign = 'center';
  context.fillText(code, 64, 137, 100);
  context.font = '750 17px ui-monospace, monospace';
  context.fillText('OW-04', 64, 172, 100);
  context.textAlign = 'left';
  context.strokeStyle = '#31474d';
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  context.fillStyle = '#79878a';
  context.font = '600 16px ui-monospace, monospace';
  context.fillText('AUTHORIZED FACILITY IDENTIFICATION', 160, 218, 700);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function makeChainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  // A dark galvanized edge under a narrow highlight preserves the wire at
  // oblique angles against either bright sky or dark foliage. The holes remain
  // genuinely transparent; this is not a grey opacity card masquerading as a
  // fence. The 64 px pitch divides the 512 px tile exactly. The previous
  // 84 px pitch did not divide its 512 px canvas, so every texture repeat cut
  // and restarted the lattice in the middle of a link.
  const linkPitch = 64;
  for (const [lineWidth, strokeStyle] of [
    [10, 'rgba(39,52,50,.82)'],
    [4, 'rgba(205,218,214,.98)'],
  ]) {
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (let offset = -canvas.width; offset <= canvas.width * 2; offset += linkPitch) {
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset + canvas.height, canvas.height);
      context.stroke();
      context.beginPath();
      context.moveTo(offset, canvas.height);
      context.lineTo(offset + canvas.height, 0);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Alpha-tested wire loses coverage in distant mip levels. Sampling the
  // authored high-contrast lattice directly keeps the silhouette legible.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Builds the compact, fully authored Ridgewatch reservoir compound.
 * Structures, routes, encounters, vegetation, and terrain are deterministic.
 */
export async function createWorld(scene, renderer) {
  if (!scene?.isScene) throw new TypeError('createWorld requires a THREE.Scene.');

  const root = new THREE.Group();
  root.name = 'RIDGEWATCH_RESERVOIR_AUTHORED_WORLD';
  scene.add(root);

  const colliders = [];
  const floors = [];
  const interactables = [];
  const coverPoints = [];
  const raycastMeshes = [];
  const pumpRotors = [];
  const poweredFixtures = [];
  const warningFixtures = [];
  const colliderById = new Map();
  const pipeNodeMap = new Map();
  const pipeRuns = [];
  const pipeFittings = [];
  const pipeSupports = [];
  const pipeWallPenetrations = [];
  const pipeEquipmentLinks = [];
  const tmpRay = new THREE.Ray();
  const tmpDirection = new THREE.Vector3();
  const tmpHit = new THREE.Vector3();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
  const anisotropy = Math.min(12, renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);

  const textureLoader = new THREE.TextureLoader();
  const textureJobs = [
    URLS.concrete, URLS.concreteNormal, URLS.concreteRough,
    URLS.grass, URLS.grassNormal, URLS.grassRough, URLS.grassAO,
    URLS.gravel, URLS.gravelNormal, URLS.gravelRough, URLS.gravelAO,
  ];
  const loadedTextures = await Promise.all(textureJobs.map((url) => textureLoader.loadAsync(url)));
  const [concreteMap, concreteNormal, concreteRough, grassMap, grassNormal, grassRough, grassAO,
    gravelMap, gravelNormal, gravelRough, gravelAO] = loadedTextures;
  configureTexture(concreteMap, anisotropy, true, [5, 7]);
  configureTexture(concreteNormal, anisotropy, false, [5, 7]);
  configureTexture(concreteRough, anisotropy, false, [5, 7]);
  configureTexture(grassMap, anisotropy, true, [18, 22]);
  configureTexture(grassNormal, anisotropy, false, [18, 22]);
  configureTexture(grassRough, anisotropy, false, [18, 22]);
  configureTexture(grassAO, anisotropy, false, [18, 22]);
  configureTexture(gravelMap, anisotropy, true, [3, 26]);
  configureTexture(gravelNormal, anisotropy, false, [3, 26]);
  configureTexture(gravelRough, anisotropy, false, [3, 26]);
  configureTexture(gravelAO, anisotropy, false, [3, 26]);

  try {
    const environment = await new HDRLoader().loadAsync(URLS.environment);
    environment.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = environment;
    scene.environmentIntensity = 0.34;
  } catch (error) {
    console.warn('Ridgewatch environment map unavailable; authored lights remain active.', error);
  }

  const materials = {
    grass: new THREE.MeshStandardMaterial({
      name: 'Dark wet reservoir meadow soil', map: grassMap, normalMap: grassNormal,
      roughnessMap: grassRough, aoMap: grassAO, color: 0x78836f, roughness: 0.74,
      normalScale: new THREE.Vector2(0.78, 0.78),
    }),
    gravel: new THREE.MeshStandardMaterial({
      name: 'Compacted damp service aggregate', map: gravelMap, normalMap: gravelNormal,
      roughnessMap: gravelRough, aoMap: gravelAO, color: 0x615e54, roughness: 0.82,
      normalScale: new THREE.Vector2(0.64, 0.64),
    }),
    concrete: new THREE.MeshStandardMaterial({
      name: 'Weathered foundation concrete', map: concreteMap, normalMap: concreteNormal,
      roughnessMap: concreteRough, color: 0xa4a49b, roughness: 0.9, metalness: 0.015,
    }),
    darkConcrete: new THREE.MeshStandardMaterial({
      name: 'Reservoir parapet concrete', map: concreteMap, normalMap: concreteNormal,
      roughnessMap: concreteRough, color: 0x666b66, roughness: 0.94,
    }),
    stucco: new THREE.MeshStandardMaterial({ map: concreteMap, normalMap: concreteNormal, roughnessMap: concreteRough, color: 0xb0a891, roughness: 0.92, metalness: 0 }),
    stuccoDark: new THREE.MeshStandardMaterial({ map: concreteMap, normalMap: concreteNormal, roughnessMap: concreteRough, color: 0x77766c, roughness: 0.94 }),
    // Weathered coated steel: deliberately rough enough not to mirror the sky
    // as a bright blue polygon when a long roof slope catches the low sun.
    roof: new THREE.MeshStandardMaterial({ color: 0x394240, roughness: 0.86, metalness: 0.2 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x455156, roughness: 0.38, metalness: 0.76 }),
    galvanized: new THREE.MeshStandardMaterial({ color: 0x909c9d, roughness: 0.44, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x69503a, roughness: 0.88 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9b392b, roughness: 0.5, metalness: 0.34 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xc79b32, roughness: 0.5, metalness: 0.36 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x7fa5aa, roughness: 0.15, transmission: 0.2, opacity: 0.54, transparent: true, depthWrite: true }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x315f68, roughness: 0.22, metalness: 0.04, clearcoat: 0.35, transparent: true, opacity: 0.9, depthWrite: true }),
    screen: new THREE.MeshStandardMaterial({ color: 0x102226, emissive: 0x238795, emissiveIntensity: 0.72, roughness: 0.24 }),
  };

  function addCollider(id, minValue, maxValue, options = {}) {
    const min = asVector3(minValue);
    const max = asVector3(maxValue);
    const collider = {
      id,
      kind: options.kind ?? 'structure',
      blocking: options.blocking !== false,
      ballistic: options.ballistic !== false,
      min,
      max,
      box: new THREE.Box3(min, max),
      mesh: options.mesh ?? null,
    };
    colliders.push(collider);
    colliderById.set(id, collider);
    if (options.mesh) options.mesh.userData.worldCollider = collider;
    return collider;
  }

  function addMeshCollider(id, mesh, options = {}) {
    if (!mesh?.isObject3D) return null;
    mesh.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    if (bounds.isEmpty()) return null;
    return addCollider(id, bounds.min, bounds.max, { ...options, mesh });
  }

  function addFloor(id, x, z, width, depth, y, extra = {}) {
    const floor = {
      id,
      minX: x - width * 0.5,
      maxX: x + width * 0.5,
      minZ: z - depth * 0.5,
      maxZ: z + depth * 0.5,
      y,
      enabled: true,
      ...extra,
    };
    floors.push(floor);
    return floor;
  }

  function boxMesh(name, x, y, z, width, height, depth, material, options = {}) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.surface = options.surface ?? material.name ?? 'structure';
    root.add(mesh);
    let collider = null;
    if (options.collider) {
      collider = addCollider(
        options.colliderId ?? `${name}_COLLIDER`,
        [x - width * 0.5, y - height * 0.5, z - depth * 0.5],
        [x + width * 0.5, y + height * 0.5, z + depth * 0.5],
        { ...options, mesh },
      );
    }
    if (options.raycast || options.collider) raycastMeshes.push(mesh);
    return { mesh, collider };
  }

  function cylinderMesh(name, x, y, z, radius, height, material, options = {}) {
    const mesh = new THREE.Mesh(unitCylinder, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = true;
    root.add(mesh);
    if (options.collider) {
      addCollider(
        options.colliderId ?? `${name}_COLLIDER`,
        [x - radius, y - height * 0.5, z - radius],
        [x + radius, y + height * 0.5, z + radius],
        { ...options, mesh },
      );
      raycastMeshes.push(mesh);
    }
    return mesh;
  }

  function beamBetween(name, startValue, endValue, thickness, material = materials.galvanized) {
    const start = asVector3(startValue);
    const end = asVector3(endValue);
    const direction = end.clone().sub(start);
    const mesh = new THREE.Mesh(unitCylinder, material);
    mesh.name = name;
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.scale.set(thickness, direction.length(), thickness);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    raycastMeshes.push(mesh);
    // Pipe runs, their hanger rods, rack posts, cradles and longitudinal
    // members are solid steel. Register their conservative body bounds while
    // retaining the real mesh so bullet occlusion is refined against rendered
    // triangles rather than an invisible AABB face.
    addMeshCollider(`${name}_SOLID_COLLIDER`, mesh, {
      kind: /PIPE|MAIN|HEADER|HOSE|LINE|TRUNK|QUILL|SLEEVE|RISER/i.test(name)
        ? 'pipe'
        : 'pipe_support',
      blocking: true,
      ballistic: true,
    });
    return mesh;
  }

  const registerPipeNode = (id, kind, positionValue, extra = {}) => {
    const position = asVector3(positionValue);
    if (!id || !position) throw new TypeError('Pipe nodes require an id and a finite position.');
    const existing = pipeNodeMap.get(id);
    if (existing) {
      if (existing.position.distanceTo(position) > 0.025) {
        throw new Error(`Pipe node ${id} was authored at two different positions.`);
      }
      return existing;
    }
    const node = { id, kind, position, ...extra };
    pipeNodeMap.set(id, node);
    return node;
  };

  const pipeRing = (name, positionValue, axisValue, radius, tube, material = materials.galvanized) => {
    const position = asVector3(positionValue);
    const axis = asVector3(axisValue)?.normalize();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 28), material);
    ring.name = name;
    ring.position.copy(position);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    ring.castShadow = true;
    ring.receiveShadow = true;
    root.add(ring);
    raycastMeshes.push(ring);
    return ring;
  };

  const addPipeFlange = (name, nodeId, position, axis, radius, material = materials.galvanized) => {
    const mesh = pipeRing(name, position, axis, radius * 1.34, Math.max(0.026, radius * 0.16), material);
    pipeFittings.push({ id: name, kind: 'flange', nodeId, meshName: mesh.name });
    return mesh;
  };

  const addPipeFitting = (name, kind, nodeId, positionValue, axes, radius, material = materials.galvanized) => {
    const position = asVector3(positionValue);
    const casting = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.16, 16, 12), material);
    casting.name = name;
    casting.position.copy(position);
    casting.scale.set(1, kind === 'tee' ? 1.04 : 0.96, 1);
    casting.castShadow = true;
    casting.receiveShadow = true;
    root.add(casting);
    raycastMeshes.push(casting);
    pipeFittings.push({ id: name, kind, nodeId, meshName: casting.name });
    axes.forEach((axisValue, index) => {
      const axis = asVector3(axisValue).normalize();
      const flangePosition = position.clone().addScaledVector(axis, radius * 1.22);
      addPipeFlange(`${name}_FLANGE_${index + 1}`, nodeId, flangePosition, axis, radius, material);
    });
    return casting;
  };

  const addPipeEndCap = (name, nodeId, positionValue, axisValue, radius, material = materials.galvanized) => {
    const position = asVector3(positionValue);
    const axis = asVector3(axisValue).normalize();
    const end = position.clone().addScaledVector(axis, radius * 0.1);
    const start = position.clone().addScaledVector(axis, -radius * 0.1);
    const cap = beamBetween(name, start, end, radius * 1.18, material);
    pipeFittings.push({ id: name, kind: 'end_cap', nodeId, meshName: cap.name });
    addPipeFlange(`${name}_FLANGE`, nodeId, position, axis, radius, material);
    return cap;
  };

  const addWallPipeCollar = (name, nodeId, wallId, position, axis, radius) => {
    const collar = pipeRing(name, position, axis, radius * 1.5, Math.max(0.045, radius * 0.2), materials.galvanized);
    pipeFittings.push({ id: name, kind: 'collar', nodeId, meshName: collar.name, wallId });
    pipeWallPenetrations.push({ id: `${name}_PENETRATION`, nodeId, wallId, collarId: name });
    return collar;
  };

  const addPipeSupport = (run, index, positionValue, axisValue, radius, kind) => {
    const position = asVector3(positionValue);
    const axis = asVector3(axisValue).normalize();
    const cross = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
    const id = `${run.id}_${kind.toUpperCase()}_${index + 1}`;
    const clampId = `${id}_CLAMP`;
    if (kind === 'hanger') {
      const half = radius + 0.11;
      // The treatment hall roof soffit is y=4.22. A transverse Unistrut-style
      // channel touches that soffit and owns both drop rods; the previous rods
      // stopped at y=4.12 with a visible air gap and looked like floating pipe
      // scaffold inside the poison building.
      const anchorY = 4.18;
      const cradleY = position.y - radius - 0.035;
      // Continue both rods down beside the pipe and into the cradle. Ending at
      // the pipe crown produced `| |` over `o`; the full-height drops visibly
      // capture the pipe between them as `|o|`.
      const lowerY = cradleY;
      beamBetween(
        `${id}_CEILING_CHANNEL`,
        position.clone().addScaledVector(cross, -(half + 0.09)).setY(anchorY),
        position.clone().addScaledVector(cross, half + 0.09).setY(anchorY),
        0.04,
        materials.galvanized,
      );
      for (const side of [-1, 1]) {
        const offset = cross.clone().multiplyScalar(half * side);
        boxMesh(
          `${id}_ANCHOR_PLATE_${side < 0 ? 'A' : 'B'}`,
          position.x + offset.x,
          4.205,
          position.z + offset.z,
          0.22,
          0.03,
          0.22,
          materials.galvanized,
          { castShadow: true },
        );
        beamBetween(
          `${id}_ROD_${side < 0 ? 'A' : 'B'}`,
          [position.x + offset.x, anchorY, position.z + offset.z],
          [position.x + offset.x, lowerY, position.z + offset.z],
          0.022,
          materials.galvanized,
        );
      }
      beamBetween(
        `${id}_CRADLE`,
        position.clone().addScaledVector(cross, -(radius + 0.17)).setY(cradleY),
        position.clone().addScaledVector(cross, radius + 0.17).setY(cradleY),
        0.035,
        materials.galvanized,
      );
    } else {
      const half = radius + (kind === 'rack' ? 0.19 : 0.12);
      const surfaceY = getGroundHeight(position.x, position.z, position.y)
        ?? terrainHeight(position.x, position.z);
      const footTopY = surfaceY + 0.1;
      const cradleY = position.y - radius - 0.055;
      const postTop = Math.max(footTopY + 0.02, cradleY);
      const sides = kind === 'rack' ? [-1, 1] : [0];
      sides.forEach((side) => {
        const offset = cross.clone().multiplyScalar(half * side);
        beamBetween(
          `${id}_POST_${side < 0 ? 'A' : side > 0 ? 'B' : 'C'}`,
          [position.x + offset.x, footTopY, position.z + offset.z],
          [position.x + offset.x, postTop, position.z + offset.z],
          kind === 'rack' ? 0.045 : 0.038,
          materials.galvanized,
        );
      });
      beamBetween(
        `${id}_CRADLE`,
        position.clone().addScaledVector(cross, -(radius + 0.17)).setY(cradleY),
        position.clone().addScaledVector(cross, radius + 0.17).setY(cradleY),
        0.04,
        materials.galvanized,
      );
      boxMesh(`${id}_FOOT`, position.x, surfaceY + 0.05, position.z, 0.42, 0.1, 0.42, materials.darkConcrete, { castShadow: true });
    }
    pipeRing(clampId, position, axis, radius * 1.08, Math.max(0.018, radius * 0.09), materials.galvanized);
    const support = { id, kind, runId: run.id, position };
    pipeSupports.push(support);
    run.supportIds.push(id);
    return support;
  };

  const pipeRun = (name, startValue, endValue, radius, material = materials.steel, options = {}) => {
    const start = asVector3(startValue);
    const end = asVector3(endValue);
    const direction = end.clone().sub(start);
    const length = direction.length();
    const horizontal = Math.abs(direction.y) <= 0.015;
    const from = options.from ?? `${name}_START`;
    const to = options.to ?? `${name}_END`;
    registerPipeNode(from, options.fromKind ?? 'junction', start);
    registerPipeNode(to, options.toKind ?? 'junction', end);
    const mesh = beamBetween(name, start, end, radius, material);
    const run = {
      id: name,
      from,
      to,
      start,
      end,
      radius,
      horizontal,
      supportKind: horizontal ? (options.support ?? (start.y >= 2.2 ? 'hanger' : 'floor')) : 'vertical_riser',
      supportIds: [],
      meshName: mesh.name,
    };
    pipeRuns.push(run);
    if (horizontal) {
      const supportKind = run.supportKind;
      if (supportKind === 'embedded' || supportKind === 'equipment') {
        const support = { id: `${name}_${supportKind.toUpperCase()}`, kind: supportKind, runId: name, position: start.clone().add(end).multiplyScalar(0.5) };
        pipeSupports.push(support);
        run.supportIds.push(support.id);
      } else {
        const spacing = Math.max(1.4, options.supportSpacing ?? (supportKind === 'rack' ? 4.2 : 3.6));
        const count = Math.max(1, Math.ceil(length / spacing) - 1);
        const axis = direction.clone().normalize();
        const placedSupports = [];
        for (let index = 0; index < count; index += 1) {
          const position = start.clone().lerp(end, (index + 1) / (count + 1));
          placedSupports.push(addPipeSupport(run, index, position, axis, radius, supportKind));
        }
        // A pipe rack is a continuous scaffold, not isolated goalposts. Join
        // consecutive frames with two longitudinal rails directly beneath the
        // cradles so exterior supports cannot look broken or free-floating.
        if (supportKind === 'rack' && placedSupports.length > 1) {
          const cross = new THREE.Vector3(-axis.z, 0, axis.x).normalize();
          const half = radius + 0.19;
          for (let index = 1; index < placedSupports.length; index += 1) {
            const previous = placedSupports[index - 1].position;
            const current = placedSupports[index].position;
            const railY = Math.min(previous.y, current.y) - radius - 0.055;
            for (const side of [-1, 1]) {
              const offset = cross.clone().multiplyScalar(half * side);
              beamBetween(
                `${name}_RACK_LONGITUDINAL_${index}_${side < 0 ? 'A' : 'B'}`,
                previous.clone().add(offset).setY(railY),
                current.clone().add(offset).setY(railY),
                0.032,
                materials.galvanized,
              );
            }
          }
        }
      }
    }
    return mesh;
  };

  function slab(name, x, z, width, depth, top = 0.09, material = materials.concrete) {
    const thickness = 0.28;
    const result = boxMesh(name, x, top - thickness * 0.5, z, width, thickness, depth, material, {
      collider: true, kind: 'floor', raycast: true, surface: material.name,
    });
    addFloor(`${name}_FLOOR`, x, z, width, depth, top, { box: result.collider.box });
    return result;
  }

  function gableRoof(name, x, z, width, depth, wallTop = 3.36, rise = 1.05, endMaterial = materials.stucco) {
    const pitch = Math.atan2(rise, width * 0.5);
    const panelWidth = Math.hypot(width * 0.5 + 0.42, rise);
    for (const side of [-1, 1]) {
      const roof = boxMesh(
        `${name}_ROOF_${side < 0 ? 'WEST' : 'EAST'}`,
        x + side * width * 0.25,
        wallTop + rise * 0.5,
        z,
        panelWidth,
        0.18,
        depth + 0.72,
        materials.roof,
        { rotation: [0, 0, side < 0 ? pitch : -pitch], castShadow: true },
      ).mesh;
      roof.userData.groundedArchitecture = true;
    }
    // Close both gable ends. The first revision left a sky-coloured triangle
    // visible below each ridge, which made otherwise grounded cottages read
    // like disconnected floating roof panels from the access road.
    for (const end of [-1, 1]) {
      const zFace = z + end * (depth * 0.5 + 0.012);
      const positions = end > 0
        ? [-width * 0.5, 0, 0, width * 0.5, 0, 0, 0, rise, 0]
        : [-width * 0.5, 0, 0, 0, rise, 0, width * 0.5, 0, 0];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      geometry.computeVertexNormals();
      const gableMaterial = endMaterial.clone();
      gableMaterial.name = `${name}_Gable_Finish`;
      gableMaterial.side = THREE.DoubleSide;
      const gable = new THREE.Mesh(geometry, gableMaterial);
      gable.name = `${name}_GABLE_${end > 0 ? 'NORTH' : 'SOUTH'}`;
      gable.position.set(x, wallTop, zFace);
      gable.castShadow = true;
      gable.receiveShadow = true;
      gable.userData.groundedArchitecture = true;
      root.add(gable);
      raycastMeshes.push(gable);
    }
    addCollider(`${name}_ROOF_COLLIDER`, [x - width * 0.52, wallTop - 0.04, z - depth * 0.52], [x + width * 0.52, wallTop + rise + 0.22, z + depth * 0.52], { kind: 'roof' });
  }

  function mountedSign(name, title, subtitle, position, width = 4.8, height = 1.8, rotationY = 0) {
    // Compact direct-mounted enamel plaques share the facility's real-world
    // municipal identity. They no longer read as freestanding HUD billboards
    // or add long posts through the building facades.
    const material = new THREE.MeshBasicMaterial({ map: makeLabelTexture(title, subtitle), toneMapped: false });
    const board = boxMesh(name, position.x, position.y, position.z, width, height, 0.12, material, { raycast: true, castShadow: true }).mesh;
    board.rotation.y = rotationY;
    board.userData.facilitySignStyle = 'ridgewatch_municipal_enamel';
    return board;
  }

  function openDoorFrame(name, x, z, width = 4.4, axis = 'x', height = 3.25, swing = -1) {
    const half = width * 0.5;
    const alongX = axis === 'x';
    const postA = new THREE.Vector3(x + (alongX ? -half : 0), 0.1, z + (alongX ? 0 : -half));
    const postB = new THREE.Vector3(x + (alongX ? half : 0), 0.1, z + (alongX ? 0 : half));
    const topA = postA.clone().setY(height);
    const topB = postB.clone().setY(height);
    const first = beamBetween(`${name}_FRAME_A`, postA, topA, 0.085, materials.galvanized);
    const second = beamBetween(`${name}_FRAME_B`, postB, topB, 0.085, materials.galvanized);
    const lintel = beamBetween(`${name}_FRAME_LINTEL`, topA, topB, 0.095, materials.galvanized);
    for (const member of [first, second, lintel]) {
      member.userData.doorFrame = true;
      member.userData.noActorCollider = true;
    }
    // A real steel leaf is visibly parked against the wall rather than omitted.
    // It remains outside the clear opening and has no hidden actor collider.
    const leafPivot = new THREE.Group();
    leafPivot.name = `${name}_OPEN_LEAF_PIVOT`;
    leafPivot.position.copy(postA);
    const leafYaw = (alongX ? 0 : -Math.PI * 0.5) + Math.PI * 0.44 * swing;
    leafPivot.rotation.y = leafYaw;
    const leaf = new THREE.Mesh(unitBox, materials.steel);
    leaf.name = `${name}_OPEN_DOOR_LEAF`;
    leaf.position.set(width * 0.47, height * 0.47, 0);
    leaf.scale.set(width * 0.94, height * 0.9, 0.09);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    leaf.userData.openDoor = true;
    leaf.userData.noActorCollider = true;
    leafPivot.add(leaf);
    root.add(leafPivot);
    raycastMeshes.push(leaf);
    const halfLeafLength = width * 0.47;
    const leafCenterX = postA.x + Math.cos(leafYaw) * halfLeafLength;
    const leafCenterZ = postA.z - Math.sin(leafYaw) * halfLeafLength;
    const leafExtentX = Math.abs(Math.cos(leafYaw)) * halfLeafLength + Math.abs(Math.sin(leafYaw)) * 0.06;
    const leafExtentZ = Math.abs(Math.sin(leafYaw)) * halfLeafLength + Math.abs(Math.cos(leafYaw)) * 0.06;
    addCollider(`${name}_OPEN_LEAF_COLLIDER`,
      [leafCenterX - leafExtentX, 0.1, leafCenterZ - leafExtentZ],
      [leafCenterX + leafExtentX, height * 0.92, leafCenterZ + leafExtentZ],
      { kind: 'open_door_leaf', blocking: true, ballistic: true, mesh: leaf });
    return Object.freeze({
      id: name, position: new THREE.Vector3(x, 0.11, z), width, axis, usable: true,
      clearOpening: true, leafName: leaf.name, openAngle: Math.PI * 0.44 * swing,
    });
  }

  function fenceSegment(name, x1, z1, x2, z2, baseY = 0, height = 2.35, options = {}) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const centerX = (x1 + x2) * 0.5;
    const centerZ = (z1 + z2) * 0.5;
    const texture = makeChainTexture();
    // Fit an integer number of complete tiles along every span, then derive
    // the vertical repeat from that same physical pitch. This keeps diamonds
    // square and guarantees that both terminal edges have the same UV phase;
    // posts/rails can therefore mask a clean whole-link termination.
    const horizontalTiles = Math.max(1, Math.round(length / 1.28));
    const tileMeters = length / horizontalTiles;
    texture.repeat.set(horizontalTiles, height / tileMeters);
    texture.anisotropy = anisotropy;
    const material = new THREE.MeshStandardMaterial({
      name: 'Two-sided galvanized chain-link',
      map: texture, color: 0xe0e6e3, alphaTest: 0.18, transparent: false,
      side: THREE.DoubleSide, shadowSide: THREE.DoubleSide, depthWrite: true,
      roughness: 0.52, metalness: 0.62, alphaToCoverage: true,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(length, height), material);
    panel.name = `${name}_CHAINLINK`;
    panel.position.set(centerX, baseY + height * 0.5, centerZ);
    // PlaneGeometry's local X axis follows the fence. An explicit yaw keeps
    // local Y vertical at all cardinal directions and avoids the ambiguous
    // 180-degree quaternion case at reversed/connected segments.
    panel.rotation.y = -Math.atan2(dz, dx);
    panel.receiveShadow = true;
    panel.castShadow = true;
    // Chain-link is an actor barrier, not an opaque wall.  Keep it out of the
    // ballistic raycast list and mark both contracts explicitly for gameplay,
    // enemy vision, and regression probes.
    panel.userData.bodyBlocking = true;
    panel.userData.ballisticPermeable = true;
    panel.userData.lineOfSightPermeable = true;
    panel.userData.noHit = true;
    root.add(panel);

    // Long texture-only spans disappeared almost completely when viewed along
    // the fence. Real waterworks fencing has line posts and tension members,
    // which supply a readable silhouette without filling the chain-link holes.
    // They are deliberately visual-only/noHit so the established body-blocking
    // collider and bullet-pass-through contract remain unchanged.
    const addVisualMember = (memberName, startValue, endValue, radius) => {
      const start = asVector3(startValue);
      const end = asVector3(endValue);
      const memberDirection = end.clone().sub(start);
      const member = new THREE.Mesh(unitCylinder, materials.galvanized);
      member.name = memberName;
      member.position.copy(start).add(end).multiplyScalar(0.5);
      member.scale.set(radius, memberDirection.length(), radius);
      member.quaternion.setFromUnitVectors(UP, memberDirection.normalize());
      member.castShadow = false;
      member.receiveShadow = true;
      member.userData.noHit = true;
      member.userData.ballisticPermeable = true;
      root.add(member);
      return member;
    };
    const terminalPosts = [
      [0, x1, z1, options.startPost !== false],
      [1, x2, z2, options.endPost !== false],
    ];
    for (const [index, x, z, enabled] of terminalPosts) {
      if (!enabled) continue;
      const post = cylinderMesh(`${name}_POST_${index}`, x, baseY + height * 0.51, z, 0.075, height + 0.22, materials.galvanized);
      post.userData.noHit = true;
      post.userData.ballisticPermeable = true;
    }
    const linePostCount = Math.max(1, Math.ceil(length / 3.2));
    for (let index = 1; index < linePostCount; index += 1) {
      const t = index / linePostCount;
      const x = THREE.MathUtils.lerp(x1, x2, t);
      const z = THREE.MathUtils.lerp(z1, z2, t);
      const post = cylinderMesh(`${name}_LINE_POST_${index}`, x, baseY + height * 0.5, z, 0.043, height, materials.galvanized, { castShadow: false });
      post.userData.noHit = true;
      post.userData.ballisticPermeable = true;
    }
    addVisualMember(`${name}_TOP_RAIL`, [x1, baseY + height - 0.035, z1], [x2, baseY + height - 0.035, z2], 0.035);
    addVisualMember(`${name}_BOTTOM_TENSION_WIRE`, [x1, baseY + 0.17, z1], [x2, baseY + 0.17, z2], 0.014);
    const thickness = 0.13;
    const collider = addCollider(
      `${name}_BARRIER`,
      [Math.min(x1, x2) - thickness, baseY, Math.min(z1, z2) - thickness],
      [Math.max(x1, x2) + thickness, baseY + height, Math.max(z1, z2) + thickness],
      {
        kind: options.kind ?? 'fence',
        blocking: true,
        ballistic: options.ballistic ?? false,
        mesh: panel,
      },
    );
    collider.ballisticPermeable = collider.ballistic === false;
    collider.lineOfSightPermeable = collider.ballistic === false;
    return { panel, collider };
  }

  function consoleStation({ id, label, prompt, x, z, accent = 0x4fcbd1, holdDuration = 0.9, aliases = [] }) {
    const group = new THREE.Group();
    group.name = `INTERACTABLE_${id.toUpperCase()}`;
    group.position.set(x, 0.09, z);
    root.add(group);
    const pedestal = new THREE.Mesh(unitBox, materials.steel);
    pedestal.position.y = 0.69;
    pedestal.scale.set(1.05, 1.38, 0.72);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    group.add(pedestal);
    const hood = new THREE.Mesh(unitBox, materials.galvanized);
    hood.position.set(0, 1.48, 0.015);
    hood.rotation.x = -0.2;
    hood.scale.set(1.14, 0.22, 0.76);
    hood.castShadow = true;
    group.add(hood);
    const screenMaterial = materials.screen.clone();
    screenMaterial.emissive.setHex(accent);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.38), screenMaterial);
    screen.name = `${id}_SCREEN`;
    screen.position.set(0, 1.52, 0.405);
    screen.rotation.x = -0.2;
    screen.renderOrder = 2;
    group.add(screen);
    const labelMaterial = new THREE.MeshBasicMaterial({ map: makeLabelTexture(label, 'AUTHORIZED OPERATORS', `#${accent.toString(16).padStart(6, '0')}`), toneMapped: false });
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.36), labelMaterial);
    badge.position.set(0, 0.66, 0.386);
    badge.renderOrder = 2;
    group.add(badge);
    addCollider(`${id}_CONSOLE_COLLIDER`, [x - 0.56, 0.06, z - 0.4], [x + 0.56, 1.78, z + 0.4], { kind: 'equipment' });
    raycastMeshes.push(pedestal, hood, screen);
    const item = {
      id,
      name: id,
      interactionId: id,
      aliases: Object.freeze([...aliases]),
      prompt,
      label: prompt,
      position: new THREE.Vector3(x, 1.3, z + 0.48),
      radius: 2.7,
      holdDuration,
      mesh: group,
      object: group,
      enabled: true,
      completed: false,
      setCompleted(completed = true) {
        this.completed = Boolean(completed);
        screenMaterial.emissive.setHex(this.completed ? 0x4ee397 : accent);
        screenMaterial.emissiveIntensity = this.completed ? 2.2 : 0.72;
      },
    };
    interactables.push(item);
    return item;
  }

  function addCover(id, x, z, nx, nz, zone, colliderId = null) {
    coverPoints.push({ id, position: new THREE.Vector3(x, getGroundHeight(x, z, 1), z), normal: new THREE.Vector3(nx, 0, nz).normalize(), zone, stance: 'crouch', colliderId });
  }

  scene.background = new THREE.Color(0x7894a2);
  scene.fog = new THREE.Fog(0x9aa9a5, 115, 315);
  if (renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 0.84;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  // Keep the sky dome centred on the active camera. A fixed 390 m sphere could
  // cross the camera's 420 m far plane near either end of the compound,
  // revealing a giant low-poly patch of the flat scene background.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 36, 18), makeSkyMaterial());
  sky.name = 'RIDGEWATCH_SKY';
  sky.frustumCulled = false;
  root.add(sky);
  const activeCamera = scene.children.find((child) => child.isCamera) ?? null;
  const hemisphere = new THREE.HemisphereLight(0xd3e0df, 0x4c4d37, 0.96);
  hemisphere.name = 'HIGHLAND_HEMISPHERE';
  root.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffd2a0, 2.15);
  sun.name = 'LOW_HIGHLAND_SUN';
  sun.position.set(-68, 92, 52);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -84;
  sun.shadow.camera.right = 84;
  sun.shadow.camera.top = 104;
  sun.shadow.camera.bottom = -122;
  sun.shadow.camera.near = 18;
  sun.shadow.camera.far = 230;
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.035;
  root.add(sun);

  const terrain = new THREE.Mesh(makeTerrainGeometry(), materials.grass);
  terrain.name = 'CONTINUOUS_AUTHORED_HIGHLAND_TERRAIN';
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  root.add(terrain);
  raycastMeshes.push(terrain);
  floors.push({
    id: 'CONTINUOUS_TERRAIN_FLOOR', minX: TERRAIN_MIN_X, maxX: TERRAIN_MAX_X,
    minZ: TERRAIN_MIN_Z, maxZ: TERRAIN_MAX_Z, enabled: true,
    heightAt: (x, z) => terrainHeight(x, z),
  });
  addCollider('TERRAIN_BALLISTIC_SURFACE', [TERRAIN_MIN_X, -0.36, -112], [TERRAIN_MAX_X, 0, TERRAIN_MAX_Z], { kind: 'ground', blocking: false, ballistic: true, mesh: terrain });

  // Actor limits are buried inside the forested shoulders and reservoir edge,
  // with another 22-40 m of rendered terrain behind them.  A player therefore
  // meets a physical hillside/tree-line boundary before any mesh edge can be
  // seen or reached.
  const naturalBoundaryColliderIds = Object.freeze([
    'NATURAL_BOUNDARY_WEST_RIDGE',
    'NATURAL_BOUNDARY_EAST_RIDGE',
    'NATURAL_BOUNDARY_NORTH_RIDGE',
    'NATURAL_BOUNDARY_RESERVOIR_BANK',
  ]);
  addCollider(naturalBoundaryColliderIds[0], [-98, -8, -128], [-94, 30, 144], { kind: 'natural_boundary', blocking: true, ballistic: true });
  addCollider(naturalBoundaryColliderIds[1], [94, -8, -128], [98, 30, 144], { kind: 'natural_boundary', blocking: true, ballistic: true });
  addCollider(naturalBoundaryColliderIds[2], [-98, -8, 140], [98, 30, 145], { kind: 'natural_boundary', blocking: true, ballistic: true });
  addCollider(naturalBoundaryColliderIds[3], [-98, -8, -128], [98, 30, -123], { kind: 'natural_boundary', blocking: true, ballistic: true });

  // A real earth berm and inaccessible reservoir replace the old floating
  // factory decks. The south barrier is visibly continuous and actor-solid.
  const reservoir = new THREE.Mesh(new THREE.PlaneGeometry(126, 52), materials.water);
  reservoir.name = 'RIDGEWATCH_INACCESSIBLE_RESERVOIR';
  reservoir.rotation.x = -Math.PI * 0.5;
  reservoir.position.set(0, -3.55, -147);
  reservoir.receiveShadow = true;
  root.add(reservoir);
  boxMesh('RESERVOIR_CONCRETE_PARAPET', 0, 0.52, -112, 64.4, 1.2, 0.85, materials.darkConcrete, { collider: true, colliderId: 'RESERVOIR_PARAPET_BARRIER', kind: 'reservoir_barrier', raycast: true });
  // The elevated safety mesh terminates into the west/east perimeter posts.
  // Its old +/-32 m endpoints overhung those corners by two metres and placed
  // near-coincident hardware across the parapet, reading as broken geometry.
  fenceSegment('RESERVOIR_SAFETY_FENCE', -30, -112, 30, -112, 1.1, 1.25, {
    kind: 'reservoir_barrier', ballistic: false, startPost: false, endPost: false,
  });

  // The approach is a staggered maintenance route rather than a sightline from
  // spawn through gate and both objective doors. Mud separates the compacted
  // strips, making the two ninety-degree route changes readable from ground
  // level while the continuous terrain remains the collision floor.
  slab('EXTERIOR_INFILTRATION_TRACK', -34, 80, 5.2, 34, 0.045, materials.gravel);
  slab('EXTERIOR_GATE_DOGLEG', -26, 63.5, 21, 5.2, 0.05, materials.gravel);
  slab('COMPOUND_MAINTENANCE_APRON', -10, 44, 36, 22, 0.07, materials.gravel);
  slab('TREATMENT_HALL_CONCRETE_APPROACH', 5.5, 14, 8.2, 10, 0.085, materials.concrete);
  slab('WEST_PROCESS_SERVICE_LANE', -25, -10, 7.5, 56, 0.065, materials.gravel);
  slab('CROSS_YARD_SERVICE_LANE', -5, -43, 48, 7.5, 0.065, materials.gravel);
  slab('VALVE_HOUSE_CONCRETE_APPROACH', 18, -48, 8.5, 10, 0.085, materials.concrete);
  slab('VALVE_BACKDOOR_SERVICE_PAD', 3, -86, 12, 10, 0.075, materials.concrete);

  // The deliberately open north gate sits on the west shoulder. Its centre is
  // twenty-three metres off the process-hall main door, so neither the player
  // nor a sentry gets a door-to-door firing tunnel.
  fenceSegment('WEST_PERIMETER', -30, -112, -30, 60, 0, 2.5);
  fenceSegment('EAST_PERIMETER', 30, 60, 30, -112, 0, 2.5);
  // Corner and gate posts are owned once: side spans own the outer corners and
  // the dedicated heavy gate posts own the opening. This removes stacked
  // cylinders and z-fighting caps while keeping rails joined at their centres.
  fenceSegment('NORTH_PERIMETER_W', -30, 60, -22.5, 60, 0, 2.5, { startPost: false, endPost: false });
  fenceSegment('NORTH_PERIMETER_E', -12.5, 60, 30, 60, 0, 2.5, { startPost: false, endPost: false });
  cylinderMesh('NORTH_GATE_POST_W', -22.5, 1.55, 60, 0.18, 3.1, materials.galvanized);
  cylinderMesh('NORTH_GATE_POST_E', -12.5, 1.55, 60, 0.18, 3.1, materials.galvanized);
  // The entrance identity sits on its own solid masonry monument outside the
  // fence. Mounting text on chain-link made the letters disappear into the
  // wire pattern and left the plaque hard to read from the approach road.
  boxMesh('FACILITY_ENTRY_SIGN_MONUMENT', -6.8, 1.25, 61.0, 5.8, 2.5, 0.38, materials.darkConcrete, {
    collider: true,
    kind: 'sign_monument',
  });
  const facilityEntrySign = mountedSign(
    'FACILITY_ENTRY_SIGN',
    'ORIS WATER 04',
    'AUTHORIZED PERSONNEL ONLY',
    new THREE.Vector3(-6.8, 1.55, 61.22),
    5.15,
    1.18,
    0,
  );
  facilityEntrySign.userData.signMount = 'solid_masonry_monument';
  facilityEntrySign.userData.occlusionClearance = 'north_approach';

  // Indoor space 1/2: a dry municipal process gallery. Both the north control
  // entry and west service door are physically open and independently usable.
  // There is deliberately no exposed indoor water surface: enclosed pressure
  // vessels, pump skids and overhead manifolds carry the reservoir feed.
  slab('TREATMENT_HALL_FOUNDATION', -5, -12, 32, 42, 0.11, materials.concrete);
  boxMesh('TREATMENT_HALL_WEST_SOUTH', -21, 2.15, -28.6, 0.44, 4.3, 8.8, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_WEST_NORTH', -21, 2.15, -5.4, 0.44, 4.3, 28.8, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_WEST_DOOR_LINTEL', -21, 3.78, -22, 0.44, 1.04, 4.4, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_EAST_WALL', 11, 2.15, -12, 0.44, 4.3, 42, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_SOUTH_WALL', -5, 2.15, -33, 32, 4.3, 0.44, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_NORTH_WEST', -8.9, 2.15, 9, 24.2, 4.3, 0.44, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_NORTH_EAST', 9.4, 2.15, 9, 3.2, 4.3, 0.44, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_NORTH_DOOR_LINTEL', 5.5, 3.78, 9, 4.6, 1.04, 0.44, materials.stucco, { collider: true });
  boxMesh('TREATMENT_HALL_FLAT_ROOF', -5, 4.38, -12, 33, 0.32, 43, materials.roof, { collider: true, colliderId: 'TREATMENT_HALL_ROOF_COLLIDER', kind: 'roof' });
  const treatmentNorthDoor = openDoorFrame('TREATMENT_NORTH_ENTRY', 5.5, 9, 4.6, 'x');
  const treatmentWestDoor = openDoorFrame('TREATMENT_WEST_SERVICE_DOOR', -21, -22, 4.4, 'z');
  mountedSign('TREATMENT_HALL_SIGN', 'RESERVOIR PROCESS', 'ENCLOSED FILTERS / DOSING', new THREE.Vector3(-7.8, 3.0, 9.25), 6.4, 1.18, 0);

  const tankCapGeometry = new THREE.SphereGeometry(1, 20, 12);
  const addProcessTank = (name, x, z, scale = 1) => {
    const radius = 1.34 * scale;
    const body = cylinderMesh(name, x, 1.64, z, radius, 2.72 * scale, materials.galvanized, {
      collider: true, colliderId: `${name}_COLLIDER`, kind: 'process_tank', castShadow: true,
    });
    const cap = new THREE.Mesh(tankCapGeometry, materials.galvanized);
    cap.name = `${name}_DOMED_HEAD`;
    cap.position.set(x, 3.02 * scale, z);
    cap.scale.set(radius, 0.34 * scale, radius);
    cap.castShadow = true;
    cap.receiveShadow = true;
    root.add(cap);
    raycastMeshes.push(cap);
    const gaugeBack = new THREE.Mesh(new THREE.CircleGeometry(0.22, 18), materials.screen);
    gaugeBack.name = `${name}_PRESSURE_GAUGE`;
    gaugeBack.position.set(x, 2.22, z + radius + 0.03);
    gaugeBack.castShadow = false;
    root.add(gaugeBack);
    raycastMeshes.push(gaugeBack);
    return body;
  };
  const processTankSpecs = Object.freeze([
    Object.freeze({ id: 'PROCESS_TANK_A', x: -15.5, z: 2.1, scale: 1.0 }),
    Object.freeze({ id: 'PROCESS_TANK_B', x: -15.3, z: -9.7, scale: 1.06 }),
    Object.freeze({ id: 'PROCESS_TANK_C', x: -15.1, z: -21.8, scale: 0.96 }),
  ]);
  processTankSpecs.forEach((tank) => addProcessTank(tank.id, tank.x, tank.z, tank.scale));

  // Enclosed tanks discharge from real low-level nozzles into one supported
  // suction manifold. Each branch terminates at a flanged tee rather than
  // crossing a riser or ending in mid-air.
  const suctionX = -11.45;
  const suctionY = 0.92;
  const waterBranchRadius = 0.17;
  const suctionRadius = 0.22;
  const processHeaderX = 8.2;
  const processHeaderY = 3.1;
  const processHeaderRadius = 0.24;
  const suctionJunctions = [
    { id: 'SUCTION_MANIFOLD_NORTH_CAP', z: 2.9, kind: 'blind_end' },
    { id: 'SUCTION_TEE_TANK_A', z: 2.1, kind: 'tee' },
    { id: 'SUCTION_TEE_PUMP_1', z: -3.2, kind: 'tee' },
    { id: 'SUCTION_TEE_TANK_B', z: -9.7, kind: 'tee' },
    { id: 'SUCTION_TEE_PUMP_2', z: -18.1, kind: 'tee' },
    { id: 'SUCTION_TEE_TANK_C', z: -21.8, kind: 'tee' },
    { id: 'SUCTION_MANIFOLD_SOUTH_CAP', z: -22.6, kind: 'blind_end' },
  ];
  suctionJunctions.forEach((junction) => registerPipeNode(
    junction.id,
    junction.kind,
    [suctionX, suctionY, junction.z],
  ));
  suctionJunctions.slice(0, -1).forEach((junction, index) => {
    const next = suctionJunctions[index + 1];
    pipeRun(
      index === 0 ? 'PROCESS_SUCTION_MANIFOLD' : `PROCESS_SUCTION_MANIFOLD_${index + 1}`,
      [suctionX, suctionY, junction.z],
      [suctionX, suctionY, next.z],
      suctionRadius,
      materials.steel,
      { from: junction.id, to: next.id, support: 'floor', supportSpacing: 3.4 },
    );
  });
  addPipeEndCap('PROCESS_SUCTION_NORTH_BLIND_FLANGE', 'SUCTION_MANIFOLD_NORTH_CAP', [suctionX, suctionY, 2.9], [0, 0, 1], suctionRadius);
  addPipeEndCap('PROCESS_SUCTION_SOUTH_BLIND_FLANGE', 'SUCTION_MANIFOLD_SOUTH_CAP', [suctionX, suctionY, -22.6], [0, 0, -1], suctionRadius);
  processTankSpecs.forEach((tank, index) => {
    const radius = 1.34 * tank.scale;
    const outletNodeId = `${tank.id}_OUTLET`;
    const teeNodeId = `SUCTION_TEE_TANK_${String.fromCharCode(65 + index)}`;
    const outlet = new THREE.Vector3(tank.x + radius, suctionY, tank.z);
    const tee = new THREE.Vector3(suctionX, suctionY, tank.z);
    pipeRun(`PROCESS_TANK_OUTLET_${index + 1}`, outlet, tee, waterBranchRadius, materials.steel, {
      from: outletNodeId,
      to: teeNodeId,
      fromKind: 'tank_outlet',
      support: 'floor',
    });
    addPipeFlange(`${tank.id}_OUTLET_FLANGE`, outletNodeId, outlet, [1, 0, 0], waterBranchRadius);
    addPipeFitting(`${tank.id}_SUCTION_TEE`, 'tee', teeNodeId, tee, [[-1, 0, 0], [0, 0, 1], [0, 0, -1]], suctionRadius);
    pipeEquipmentLinks.push({
      id: `${tank.id}_HYDRAULIC_OUTLET`, kind: 'tank', assetId: tank.id,
      inletNodeIds: [], outletNodeIds: [outletNodeId],
    });
  });

  const processPumpSpecs = Object.freeze([
    Object.freeze({ index: 0, x: -8.6, z: -3.2, suctionTeeId: 'SUCTION_TEE_PUMP_1', dischargeTeeId: 'DISCHARGE_TEE_PUMP_1' }),
    Object.freeze({ index: 1, x: -8.2, z: -18.1, suctionTeeId: 'SUCTION_TEE_PUMP_2', dischargeTeeId: 'DISCHARGE_TEE_PUMP_2' }),
  ]);
  for (const [index, x, z] of [[0, -8.6, -3.2], [1, -8.2, -18.1]]) {
    boxMesh(`PROCESS_PUMP_SKID_${index + 1}`, x, 0.35, z, 3.8, 0.48, 2.5, materials.darkConcrete, { collider: true, kind: 'equipment', raycast: true });
    cylinderMesh(`PROCESS_PUMP_BODY_${index + 1}`, x, 0.92, z, 0.64, 2.4, materials.steel, { rotation: [0, 0, Math.PI * 0.5] });
    const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 10, 24), materials.yellow);
    rotor.name = `PROCESS_PUMP_COUPLING_${index + 1}`;
    rotor.position.set(x + 1.25, 0.92, z);
    rotor.rotation.y = Math.PI * 0.5;
    rotor.castShadow = true;
    root.add(rotor);
    raycastMeshes.push(rotor);
    pumpRotors.push(rotor);
  }

  processPumpSpecs.forEach(({ index, x, z, suctionTeeId, dischargeTeeId }) => {
    const pumpNumber = index + 1;
    const inletNodeId = `PROCESS_PUMP_${pumpNumber}_INLET`;
    const outletNodeId = `PROCESS_PUMP_${pumpNumber}_OUTLET`;
    const dischargeNozzleElbowId = `PROCESS_PUMP_${pumpNumber}_DISCHARGE_NOZZLE_ELBOW`;
    const dischargeBaseId = `PROCESS_PUMP_${pumpNumber}_DISCHARGE_BASE_ELBOW`;
    const dischargeTopId = `PROCESS_PUMP_${pumpNumber}_DISCHARGE_TOP_ELBOW`;
    const inlet = new THREE.Vector3(x - 1.2, suctionY, z);
    const outlet = new THREE.Vector3(x, 1.56, z);
    const dischargeNozzleElbow = new THREE.Vector3(x, 1.86, z);
    const suctionTee = new THREE.Vector3(suctionX, suctionY, z);
    const dischargeBase = new THREE.Vector3(-5.45, 1.86, z);
    const dischargeTop = new THREE.Vector3(-5.45, processHeaderY, z);
    const dischargeTee = new THREE.Vector3(processHeaderX, processHeaderY, z);
    pipeRun(`PROCESS_PUMP_${pumpNumber}_SUCTION`, suctionTee, inlet, waterBranchRadius, materials.steel, {
      from: suctionTeeId, to: inletNodeId, toKind: 'pump_inlet', support: 'floor',
    });
    addPipeFitting(`PROCESS_PUMP_${pumpNumber}_SUCTION_TEE`, 'tee', suctionTeeId, suctionTee, [[1, 0, 0], [0, 0, 1], [0, 0, -1]], suctionRadius);
    addPipeFlange(`PROCESS_PUMP_${pumpNumber}_INLET_FLANGE`, inletNodeId, inlet, [-1, 0, 0], waterBranchRadius);
    addPipeFlange(`PROCESS_PUMP_${pumpNumber}_OUTLET_FLANGE`, outletNodeId, outlet, [0, 1, 0], waterBranchRadius);
    pipeRun(`PROCESS_PUMP_${pumpNumber}_DISCHARGE_NOZZLE`, outlet, dischargeNozzleElbow, waterBranchRadius, materials.steel, {
      from: outletNodeId, to: dischargeNozzleElbowId, fromKind: 'pump_outlet',
    });
    addPipeFitting(`PROCESS_PUMP_${pumpNumber}_DISCHARGE_NOZZLE_ELBOW_CASTING`, 'elbow', dischargeNozzleElbowId, dischargeNozzleElbow, [[0, -1, 0], [1, 0, 0]], waterBranchRadius);
    pipeRun(`PROCESS_PUMP_${pumpNumber}_DISCHARGE_LOW`, dischargeNozzleElbow, dischargeBase, waterBranchRadius, materials.steel, {
      from: dischargeNozzleElbowId, to: dischargeBaseId, support: 'floor',
    });
    addPipeFitting(`PROCESS_PUMP_${pumpNumber}_LOW_ELBOW`, 'elbow', dischargeBaseId, dischargeBase, [[-1, 0, 0], [0, 1, 0]], waterBranchRadius);
    pipeRun(`PROCESS_PUMP_${pumpNumber}_DISCHARGE_RISER`, dischargeBase, dischargeTop, waterBranchRadius, materials.steel, {
      from: dischargeBaseId, to: dischargeTopId,
    });
    addPipeFitting(`PROCESS_PUMP_${pumpNumber}_TOP_ELBOW`, 'elbow', dischargeTopId, dischargeTop, [[0, -1, 0], [1, 0, 0]], waterBranchRadius);
    pipeRun(`PROCESS_PUMP_${pumpNumber}_OVERHEAD_DISCHARGE`, dischargeTop, dischargeTee, waterBranchRadius, materials.steel, {
      from: dischargeTopId, to: dischargeTeeId, toKind: 'tee', support: 'hanger', supportSpacing: 3.2,
    });
    addPipeFitting(`PROCESS_PUMP_${pumpNumber}_HEADER_TEE`, 'tee', dischargeTeeId, dischargeTee, [[-1, 0, 0], [0, 0, 1], [0, 0, -1]], processHeaderRadius);
    pipeEquipmentLinks.push({
      id: `PROCESS_PUMP_${pumpNumber}`, kind: 'pump', assetId: `PROCESS_PUMP_BODY_${pumpNumber}`,
      inletNodeIds: [inletNodeId], outletNodeIds: [outletNodeId],
    });
  });

  const poisonInjectionNodeId = 'POST_PUMP_POISON_INJECTION_PORT';
  const processTransferInsideNodeId = 'PROCESS_TRANSFER_HEADER_INSIDE';
  const processHeaderJunctions = Object.freeze([
    Object.freeze({ id: 'PROCESS_HEADER_NORTH_CAP', z: 4.5, kind: 'blind_end' }),
    Object.freeze({ id: 'DISCHARGE_TEE_PUMP_1', z: -3.2, kind: 'tee' }),
    Object.freeze({ id: 'DISCHARGE_TEE_PUMP_2', z: -18.1, kind: 'tee' }),
    Object.freeze({ id: poisonInjectionNodeId, z: -24.5, kind: 'injection_tee' }),
    Object.freeze({ id: processTransferInsideNodeId, z: -32.72, kind: 'wall_approach' }),
  ]);
  processHeaderJunctions.forEach((junction) => registerPipeNode(
    junction.id,
    junction.kind,
    [processHeaderX, processHeaderY, junction.z],
  ));
  const processHeaderRunNames = Object.freeze([
    'PROCESS_CITY_FEED_HEADER',
    'PROCESS_OVERHEAD_MANIFOLD',
    'PROCESS_POST_PUMP_HEADER',
    'PROCESS_TREATED_WATER_OUTLET',
  ]);
  processHeaderJunctions.slice(0, -1).forEach((junction, index) => {
    const next = processHeaderJunctions[index + 1];
    pipeRun(
      processHeaderRunNames[index],
      [processHeaderX, processHeaderY, junction.z],
      [processHeaderX, processHeaderY, next.z],
      processHeaderRadius,
      materials.steel,
      { from: junction.id, to: next.id, support: 'hanger', supportSpacing: 3.4 },
    );
  });
  addPipeEndCap('PROCESS_HEADER_NORTH_BLIND_FLANGE', 'PROCESS_HEADER_NORTH_CAP', [processHeaderX, processHeaderY, 4.5], [0, 0, 1], processHeaderRadius);

  // The disguised cell has bolted a dedicated dosing machine between chemical
  // totes and one post-pump injection quill. Separate pump laterals join a
  // small red manifold, eliminating the old overlapping lines and ensuring
  // poison enters at exactly one downstream port.
  const poisonMachinePosition = new THREE.Vector3(5.6, 1.2, -15.6);
  const poisonMachine = boxMesh('POISON_INJECTION_MACHINE', poisonMachinePosition.x, 1.18, poisonMachinePosition.z, 3.15, 2.15, 2.3, materials.steel, {
    collider: true, colliderId: 'POISON_INJECTION_MACHINE_COLLIDER', kind: 'objective_machine', raycast: true,
  }).mesh;
  boxMesh('POISON_INJECTION_MACHINE_PANEL', 5.6, 1.45, -14.42, 2.35, 0.82, 0.12, materials.screen, { raycast: true, castShadow: false });
  const dosingPumpOutletNodes = [];
  for (const [index, x] of [[1, 4.72], [2, 6.48]]) {
    cylinderMesh(`POISON_DOSING_PUMP_${index}`, x, 2.48, -15.6, 0.26, 0.9, materials.red);
    const outletNodeId = `POISON_DOSING_PUMP_${index}_OUTLET`;
    const lateralNodeId = `POISON_DOSING_LATERAL_${index}_ELBOW`;
    const lateralZ = index === 1 ? -15.15 : -16.05;
    dosingPumpOutletNodes.push(outletNodeId);
    pipeRun(`POISON_DOSING_PUMP_${index}_NOZZLE`, [x, 2.76, -15.6], [x, 2.76, lateralZ], 0.055, materials.red, {
      from: outletNodeId, to: lateralNodeId, fromKind: 'dosing_pump_outlet', support: 'equipment',
    });
    addPipeFlange(`POISON_DOSING_PUMP_${index}_OUTLET_FLANGE`, outletNodeId, [x, 2.76, -15.6], [0, 0, lateralZ > -15.6 ? 1 : -1], 0.055, materials.red);
    addPipeFitting(`POISON_DOSING_PUMP_${index}_LATERAL_ELBOW`, 'elbow', lateralNodeId, [x, 2.76, lateralZ], [[0, 0, lateralZ > -15.6 ? -1 : 1], [1, 0, 0]], 0.055, materials.red);
    pipeRun(`POISON_DOSING_LINE_${index}`, [x, 2.76, lateralZ], [7.25, 2.76, lateralZ], 0.055, materials.red, {
      from: lateralNodeId, to: `POISON_DOSING_MANIFOLD_TEE_${index}`, toKind: 'tee', support: 'hanger',
    });
  }
  pipeRun('POISON_DOSING_MANIFOLD', [7.25, 2.76, -16.05], [7.25, 2.76, -15.15], 0.065, materials.red, {
    from: 'POISON_DOSING_MANIFOLD_TEE_2', to: 'POISON_DOSING_MANIFOLD_TEE_1', support: 'hanger',
  });
  addPipeFitting('POISON_DOSING_MANIFOLD_NORTH_ELBOW', 'elbow', 'POISON_DOSING_MANIFOLD_TEE_1', [7.25, 2.76, -15.15], [[-1, 0, 0], [0, 0, -1]], 0.065, materials.red);
  addPipeFitting('POISON_DOSING_MANIFOLD_TEE_SOUTH', 'tee', 'POISON_DOSING_MANIFOLD_TEE_2', [7.25, 2.76, -16.05], [[-1, 0, 0], [0, 0, -1], [0, 0, 1]], 0.065, materials.red);
  const dosingTrunkElbowId = 'POISON_DOSING_TRUNK_ELBOW';
  pipeRun('POISON_DOSING_SINGLE_TRUNK', [7.25, 2.76, -16.05], [7.25, 2.76, -24.5], 0.065, materials.red, {
    from: 'POISON_DOSING_MANIFOLD_TEE_2', to: dosingTrunkElbowId, support: 'hanger', supportSpacing: 3,
  });
  addPipeFitting('POISON_DOSING_TRUNK_ELBOW_CASTING', 'elbow', dosingTrunkElbowId, [7.25, 2.76, -24.5], [[0, 0, 1], [1, 0, 0]], 0.065, materials.red);
  const injectionQuillBaseId = 'POISON_INJECTION_QUILL_BASE';
  pipeRun('POISON_INJECTION_QUILL_LATERAL', [7.25, 2.76, -24.5], [processHeaderX, 2.76, -24.5], 0.065, materials.red, {
    from: dosingTrunkElbowId, to: injectionQuillBaseId, support: 'hanger',
  });
  addPipeFitting('POISON_INJECTION_QUILL_ELBOW', 'elbow', injectionQuillBaseId, [processHeaderX, 2.76, -24.5], [[-1, 0, 0], [0, 1, 0]], 0.065, materials.red);
  pipeRun('POISON_INJECTION_QUILL', [processHeaderX, 2.76, -24.5], [processHeaderX, processHeaderY, -24.5], 0.065, materials.red, {
    from: injectionQuillBaseId, to: poisonInjectionNodeId,
  });
  addPipeFitting('POST_PUMP_POISON_INJECTION_TEE', 'tee', poisonInjectionNodeId, [processHeaderX, processHeaderY, -24.5], [[0, 0, 1], [0, 0, -1], [0, -1, 0]], processHeaderRadius);
  const poisonToteSpecs = Object.freeze([
    Object.freeze({ x: 0.2, z: -27.2 }), Object.freeze({ x: 4.0, z: -27.1 }), Object.freeze({ x: 7.8, z: -26.9 }),
  ]);
  const toteFeedTeeNodes = [];
  poisonToteSpecs.forEach(({ x, z }, index) => {
    boxMesh(`POISON_TOTE_${index}`, x, 0.72, z, 2.2, 1.35, 2.2, materials.stuccoDark, { collider: true, kind: 'equipment', raycast: true });
    boxMesh(`POISON_TOTE_CAGE_${index}`, x, 1.43, z, 2.4, 0.12, 2.4, materials.galvanized, { raycast: true });
    const toteOutletNodeId = `POISON_TOTE_${index + 1}_OUTLET`;
    const toteFeedTeeNodeId = `POISON_TOTE_FEED_TEE_${index + 1}`;
    toteFeedTeeNodes.push(toteFeedTeeNodeId);
    pipeRun(`POISON_FEED_HOSE_${index}`, [x, 1.08, z + 1.1], [x, 1.08, -25], 0.075, materials.red, {
      from: toteOutletNodeId, to: toteFeedTeeNodeId, fromKind: 'chemical_tote_outlet', toKind: 'tee', support: 'floor',
    });
    addPipeFlange(`POISON_TOTE_${index + 1}_OUTLET_FLANGE`, toteOutletNodeId, [x, 1.08, z + 1.1], [0, 0, 1], 0.075, materials.red);
    const fittingAxes = index === 0
      ? [[0, 0, -1], [1, 0, 0]]
      : index === 1
        ? [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]
        : [[0, 0, -1], [-1, 0, 0]];
    addPipeFitting(
      `POISON_TOTE_FEED_TEE_${index + 1}_CASTING`,
      index === 1 ? 'cross' : 'elbow',
      toteFeedTeeNodeId,
      [x, 1.08, -25],
      fittingAxes,
      0.075,
      materials.red,
    );
  });
  pipeRun('POISON_TOTE_FEED_MANIFOLD_1', [0.2, 1.08, -25], [4.0, 1.08, -25], 0.075, materials.red, {
    from: toteFeedTeeNodes[0], to: toteFeedTeeNodes[1], support: 'floor',
  });
  pipeRun('POISON_TOTE_FEED_MANIFOLD_2', [4.0, 1.08, -25], [7.8, 1.08, -25], 0.075, materials.red, {
    from: toteFeedTeeNodes[1], to: toteFeedTeeNodes[2], support: 'floor',
  });
  const poisonMachineFeedOffsetElbowId = 'POISON_MACHINE_FEED_OFFSET_ELBOW';
  pipeRun('POISON_MACHINE_FEED_OFFSET', [4.0, 1.08, -25], [4.0, 1.08, -24.2], 0.075, materials.red, {
    from: toteFeedTeeNodes[1], to: poisonMachineFeedOffsetElbowId, support: 'floor',
  });
  addPipeFitting('POISON_MACHINE_FEED_OFFSET_ELBOW_CASTING', 'elbow', poisonMachineFeedOffsetElbowId, [4.0, 1.08, -24.2], [[0, 0, -1], [1, 0, 0]], 0.075, materials.red);
  const poisonMachineFeedElbowId = 'POISON_MACHINE_FEED_ELBOW';
  pipeRun('POISON_MACHINE_FEED_LATERAL', [4.0, 1.08, -24.2], [5.6, 1.08, -24.2], 0.075, materials.red, {
    from: poisonMachineFeedOffsetElbowId, to: poisonMachineFeedElbowId, support: 'floor',
  });
  addPipeFitting('POISON_MACHINE_FEED_ELBOW_CASTING', 'elbow', poisonMachineFeedElbowId, [5.6, 1.08, -24.2], [[-1, 0, 0], [0, 0, 1]], 0.075, materials.red);
  const poisonMachineInletNodeId = 'POISON_MACHINE_INLET';
  pipeRun('POISON_MACHINE_FEED_TRUNK', [5.6, 1.08, -24.2], [5.6, 1.08, -16.8], 0.075, materials.red, {
    from: poisonMachineFeedElbowId, to: poisonMachineInletNodeId, toKind: 'poison_machine_inlet', support: 'floor', supportSpacing: 2.8,
  });
  addPipeFlange('POISON_MACHINE_INLET_FLANGE', poisonMachineInletNodeId, [5.6, 1.08, -16.8], [0, 0, 1], 0.075, materials.red);
  pipeEquipmentLinks.push({
    id: 'POISON_INJECTION_MACHINE_HYDRAULICS', kind: 'dosing_machine', assetId: 'POISON_INJECTION_MACHINE',
    inletNodeIds: [poisonMachineInletNodeId], outletNodeIds: dosingPumpOutletNodes,
  });
  const jammerBeaconMaterial = new THREE.MeshStandardMaterial({ color: 0x61231c, emissive: 0xf0442e, emissiveIntensity: 3.2 });
  cylinderMesh('INJECTION_ALARM_BEACON', 5.6, 2.48, -15.6, 0.18, 0.34, jammerBeaconMaterial);
  warningFixtures.push({ material: jammerBeaconMaterial, phase: 0.2, base: 3.2 });
  const poisonInteraction = consoleStation({
    id: 'neutralize_poison',
    aliases: ['disable_jammer', 'transmit_ledger', 'stop_poison_injection', 'poison', 'poison_injection_machine'],
    label: 'INJECTION CUTOFF P-04',
    prompt: 'CLOSE POISON INJECTION MANIFOLD',
    x: 5.6,
    z: -11.8,
    accent: 0xe16447,
    holdDuration: 1.35,
  });
  poisonInteraction.assetId = 'POISON_INJECTION_MACHINE';
  poisonInteraction.targetPosition = poisonMachinePosition.clone();
  const jammerInteraction = poisonInteraction;
  const ledgerInteraction = poisonInteraction;

  for (const [x, z] of [[-3, 3], [7, 3], [-3, -28], [7, -28]]) {
    const light = new THREE.PointLight(0xff9c70, 0.2, 13, 2);
    light.position.set(x, 3.55, z);
    root.add(light);
    const fixtureMaterial = new THREE.MeshStandardMaterial({ color: 0xaaa89d, emissive: 0xff6f3f, emissiveIntensity: 0.36 });
    boxMesh(`TREATMENT_LIGHT_${x}_${z}`, x, 4.15, z, 1.25, 0.1, 0.34, fixtureMaterial, { castShadow: false });
    poweredFixtures.push({ light, material: fixtureMaterial });
  }
  const powerInteraction = { setCompleted() {} };

  // Indoor space 2/2: a secured municipal valve vault. Its north control door,
  // south backdoor and internal vault threshold form an offset S-route rather
  // than continuing the process-hall entrance axis.
  slab('SUPPLY_VALVE_HOUSE_FOUNDATION', 11, -67, 26, 28, 0.11, materials.concrete);
  boxMesh('VALVE_HOUSE_WEST_WALL', -2, 2.15, -67, 0.44, 4.3, 28, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_EAST_WALL', 24, 2.15, -67, 0.44, 4.3, 28, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_SOUTH_WEST', -0.6, 2.15, -81, 2.8, 4.3, 0.44, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_SOUTH_EAST', 14.5, 2.15, -81, 19, 4.3, 0.44, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_SOUTH_DOOR_LINTEL', 2.9, 3.78, -81, 4.2, 1.04, 0.44, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_NORTH_WEST', 6.9, 2.15, -53, 17.8, 4.3, 0.44, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_NORTH_EAST', 22.1, 2.15, -53, 3.8, 4.3, 0.44, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_NORTH_DOOR_LINTEL', 18, 3.78, -53, 4.4, 1.04, 0.44, materials.stuccoDark, { collider: true });
  boxMesh('VALVE_HOUSE_FLAT_ROOF', 11, 4.38, -67, 27, 0.32, 29, materials.roof, { collider: true, colliderId: 'VALVE_HOUSE_ROOF_COLLIDER', kind: 'roof' });
  const valveNorthDoor = openDoorFrame('VALVE_HOUSE_NORTH_ENTRY', 18, -53, 4.4, 'x');
  const valveBackdoor = openDoorFrame('VALVE_HOUSE_SOUTH_BACKDOOR', 2.9, -81, 4.2, 'x', 3.25, 1);
  // Keep the north-facade plaque west of the overhead clean-water header. The
  // previous x=8.4 position placed the live pipe directly across its lettering.
  const valveHouseSign = mountedSign('VALVE_HOUSE_SIGN', 'CITY VALVE VAULT', 'SECURED MANUAL ISOLATION', new THREE.Vector3(3.0, 3.0, -52.74), 5.4, 1.18, 0);
  valveHouseSign.userData.signMount = 'solid_north_facade';
  valveHouseSign.userData.occlusionClearance = 'west_of_clean_water_header';

  // A masonry security partition makes the wheel a distinct vault objective.
  // The open steel threshold at x=14 is the only north-side passage, while the
  // rear door reaches the south chamber from the opposite side.
  boxMesh('VALVE_VAULT_PARTITION_WEST', 4.9, 2.15, -68, 13.8, 4.3, 0.44, materials.darkConcrete, { collider: true, kind: 'vault_wall' });
  boxMesh('VALVE_VAULT_PARTITION_EAST', 20.1, 2.15, -68, 7.8, 4.3, 0.44, materials.darkConcrete, { collider: true, kind: 'vault_wall' });
  boxMesh('VALVE_VAULT_DOOR_LINTEL', 14, 3.78, -68, 4.4, 1.04, 0.44, materials.darkConcrete, { collider: true, kind: 'vault_wall' });
  const valveVaultDoor = openDoorFrame('VALVE_VAULT_SECURITY_THRESHOLD', 14, -68, 4.4, 'x');
  // The city main crosses the partition at working height, so the security
  // label moves onto the clear interior face of the solid west wall.
  const valveSecuritySign = mountedSign('VALVE_VAULT_SECURITY_SIGN', 'SECURED VALVE VAULT', 'CITY MAIN / AUTHORIZED CREW', new THREE.Vector3(-1.74, 1.3, -64.4), 4.7, 1.0, Math.PI / 2);
  valveSecuritySign.userData.signMount = 'solid_west_interior_wall';
  valveSecuritySign.userData.occlusionClearance = 'clear_of_city_main';

  // The treated-water header leaves the process hall through a collared sleeve,
  // crosses the yard on a real rack, enters the valve house through a second
  // collar, and passes the secured partition through a third. All wall runs
  // are split at their collar nodes so no pipe merely clips through masonry.
  const processWallCenterNodeId = 'PROCESS_SOUTH_WALL_COLLAR_NODE';
  const processWallOutsideNodeId = 'PROCESS_TRANSFER_HEADER_OUTSIDE';
  pipeRun('PROCESS_SOUTH_WALL_SLEEVE_INNER', [processHeaderX, processHeaderY, -32.72], [processHeaderX, processHeaderY, -33], processHeaderRadius, materials.steel, {
    from: processTransferInsideNodeId, to: processWallCenterNodeId, toKind: 'wall_penetration', support: 'embedded',
  });
  pipeRun('PROCESS_SOUTH_WALL_SLEEVE_OUTER', [processHeaderX, processHeaderY, -33], [processHeaderX, processHeaderY, -33.28], processHeaderRadius, materials.steel, {
    from: processWallCenterNodeId, to: processWallOutsideNodeId, toKind: 'wall_approach', support: 'embedded',
  });
  addWallPipeCollar('PROCESS_SOUTH_WALL_PIPE_COLLAR', processWallCenterNodeId, 'TREATMENT_HALL_SOUTH_WALL', [processHeaderX, processHeaderY, -33], [0, 0, 1], processHeaderRadius);

  const valveWallOutsideNodeId = 'VALVE_TRANSFER_HEADER_OUTSIDE';
  pipeRun('INTERBUILDING_CLEAN_WATER_HEADER', [processHeaderX, processHeaderY, -33.28], [processHeaderX, processHeaderY, -52.72], processHeaderRadius, materials.steel, {
    from: processWallOutsideNodeId, to: valveWallOutsideNodeId, support: 'rack', supportSpacing: 3.8,
  });
  const valveWallCenterNodeId = 'VALVE_NORTH_WALL_COLLAR_NODE';
  const valveWallInsideNodeId = 'VALVE_TRANSFER_HEADER_INSIDE';
  pipeRun('VALVE_NORTH_WALL_SLEEVE_OUTER', [processHeaderX, processHeaderY, -52.72], [processHeaderX, processHeaderY, -53], processHeaderRadius, materials.steel, {
    from: valveWallOutsideNodeId, to: valveWallCenterNodeId, toKind: 'wall_penetration', support: 'embedded',
  });
  pipeRun('VALVE_NORTH_WALL_SLEEVE_INNER', [processHeaderX, processHeaderY, -53], [processHeaderX, processHeaderY, -53.28], processHeaderRadius, materials.steel, {
    from: valveWallCenterNodeId, to: valveWallInsideNodeId, toKind: 'wall_approach', support: 'embedded',
  });
  addWallPipeCollar('VALVE_NORTH_WALL_PIPE_COLLAR', valveWallCenterNodeId, 'VALVE_HOUSE_NORTH_WEST', [processHeaderX, processHeaderY, -53], [0, 0, 1], processHeaderRadius);

  const valveHeaderTurnNodeId = 'VALVE_INLET_HEADER_TURN';
  pipeRun('VALVE_INLET_OVERHEAD_HEADER', [processHeaderX, processHeaderY, -53.28], [processHeaderX, processHeaderY, -60], processHeaderRadius, materials.steel, {
    from: valveWallInsideNodeId, to: valveHeaderTurnNodeId, support: 'hanger', supportSpacing: 3.2,
  });
  addPipeFitting('VALVE_INLET_HEADER_DROP_ELBOW', 'elbow', valveHeaderTurnNodeId, [processHeaderX, processHeaderY, -60], [[0, 0, 1], [0, -1, 0]], processHeaderRadius);
  const valveHeaderLowTurnNodeId = 'VALVE_INLET_HEADER_LOW_TURN';
  const valveMainY = 2.62;
  pipeRun('VALVE_INLET_HEADER_DROP', [processHeaderX, processHeaderY, -60], [processHeaderX, valveMainY, -60], processHeaderRadius, materials.steel, {
    from: valveHeaderTurnNodeId, to: valveHeaderLowTurnNodeId,
  });
  addPipeFitting('VALVE_INLET_HEADER_LOW_ELBOW', 'elbow', valveHeaderLowTurnNodeId, [processHeaderX, valveMainY, -60], [[0, 1, 0], [-1, 0, 0]], processHeaderRadius);
  const upstreamCrossoverTurnId = 'VALVE_UPSTREAM_CROSSOVER_TURN';
  pipeRun('VALVE_UPSTREAM_CROSSOVER', [processHeaderX, valveMainY, -60], [0, valveMainY, -60], processHeaderRadius, materials.steel, {
    from: valveHeaderLowTurnNodeId, to: upstreamCrossoverTurnId, support: 'hanger', supportSpacing: 3.4,
  });
  addPipeFitting('VALVE_UPSTREAM_CROSSOVER_ELBOW', 'elbow', upstreamCrossoverTurnId, [0, valveMainY, -60], [[1, 0, 0], [0, 0, -1]], processHeaderRadius);

  const vaultPartitionNorthNodeId = 'VAULT_PARTITION_PIPE_NORTH';
  pipeRun('VALVE_UPSTREAM_NORTH_CHAMBER', [0, valveMainY, -60], [0, valveMainY, -67.72], processHeaderRadius, materials.steel, {
    from: upstreamCrossoverTurnId, to: vaultPartitionNorthNodeId, support: 'hanger', supportSpacing: 3.2,
  });
  const vaultPartitionCenterNodeId = 'VAULT_PARTITION_PIPE_COLLAR_NODE';
  const vaultPartitionSouthNodeId = 'VAULT_PARTITION_PIPE_SOUTH';
  pipeRun('VALVE_VAULT_PARTITION_SLEEVE_NORTH', [0, valveMainY, -67.72], [0, valveMainY, -68], processHeaderRadius, materials.steel, {
    from: vaultPartitionNorthNodeId, to: vaultPartitionCenterNodeId, toKind: 'wall_penetration', support: 'embedded',
  });
  pipeRun('VALVE_VAULT_PARTITION_SLEEVE_SOUTH', [0, valveMainY, -68], [0, valveMainY, -68.28], processHeaderRadius, materials.steel, {
    from: vaultPartitionCenterNodeId, to: vaultPartitionSouthNodeId, toKind: 'wall_approach', support: 'embedded',
  });
  addWallPipeCollar('VALVE_VAULT_PARTITION_PIPE_COLLAR', vaultPartitionCenterNodeId, 'VALVE_VAULT_PARTITION_WEST', [0, valveMainY, -68], [0, 0, 1], processHeaderRadius);
  const cityMainInletNodeId = 'CITY_MAIN_INLET_ELBOW';
  pipeRun('VALVE_UPSTREAM_TO_CITY_MAIN', [0, valveMainY, -68.28], [0, valveMainY, -74], processHeaderRadius, materials.steel, {
    from: vaultPartitionSouthNodeId, to: cityMainInletNodeId, support: 'hanger', supportSpacing: 3,
  });
  addPipeFitting('CITY_MAIN_INLET_ELBOW_CASTING', 'elbow', cityMainInletNodeId, [0, valveMainY, -74], [[0, 0, 1], [1, 0, 0]], 0.42);

  const valveUpstreamNodeId = 'SUPPLY_VALVE_UPSTREAM_FLANGE';
  const valveDownstreamNodeId = 'SUPPLY_VALVE_DOWNSTREAM_FLANGE';
  const citySupplyMain = pipeRun('CITY_SUPPLY_MAIN', [0, valveMainY, -74], [10.2, valveMainY, -74], 0.42, materials.steel, {
    from: cityMainInletNodeId, to: valveUpstreamNodeId, toKind: 'valve_inlet', support: 'hanger', supportSpacing: 3.2,
  });
  addPipeFlange('SUPPLY_VALVE_UPSTREAM_BODY_FLANGE', valveUpstreamNodeId, [10.2, valveMainY, -74], [1, 0, 0], 0.42);
  const supplyValveBody = cylinderMesh('SUPPLY_VALVE_BODY', 11, valveMainY, -74, 0.7, 1.5, materials.steel, { rotation: [0, 0, Math.PI * 0.5] });
  addPipeFlange('SUPPLY_VALVE_DOWNSTREAM_BODY_FLANGE', valveDownstreamNodeId, [11.8, valveMainY, -74], [1, 0, 0], 0.42);
  pipeEquipmentLinks.push({
    id: 'SUPPLY_VALVE_BODY_HYDRAULICS', kind: 'isolation_valve', assetId: 'SUPPLY_VALVE',
    inletNodeIds: [valveUpstreamNodeId], outletNodeIds: [valveDownstreamNodeId],
  });
  addCollider('CITY_SUPPLY_MAIN_COLLIDER', [-0.5, 2.08, -74.5], [22.5, 3.16, -73.5], { kind: 'main_pipe', blocking: true, ballistic: true, mesh: citySupplyMain });

  const valveWheel = new THREE.Group();
  valveWheel.name = 'SUPPLY_VALVE';
  valveWheel.position.set(11, valveMainY, -72.95);
  valveWheel.userData.assetId = 'SUPPLY_VALVE';
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.105, 12, 36), materials.red);
  wheelRing.castShadow = true;
  valveWheel.add(wheelRing);
  for (let spoke = 0; spoke < 4; spoke += 1) {
    const spokeMesh = new THREE.Mesh(unitBox, materials.red);
    spokeMesh.rotation.z = spoke * Math.PI * 0.25;
    spokeMesh.scale.set(1.72, 0.085, 0.085);
    spokeMesh.castShadow = true;
    valveWheel.add(spokeMesh);
  }
  const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 18), materials.yellow);
  wheelHub.rotation.x = Math.PI * 0.5;
  wheelHub.castShadow = true;
  valveWheel.add(wheelHub);
  root.add(valveWheel);
  raycastMeshes.push(wheelRing, wheelHub);
  beamBetween('SUPPLY_VALVE_STEM', [11, valveMainY, -74], [11, valveMainY, -73.02], 0.16, materials.galvanized);
  boxMesh('SUPPLY_VALVE_GEARBOX', 11, valveMainY, -73.62, 0.92, 0.92, 0.72, materials.steel, { raycast: true });
  supplyValveBody.userData.hydraulicPath = Object.freeze({
    inletNodeId: valveUpstreamNodeId,
    outletNodeId: valveDownstreamNodeId,
  });
  const valveInteraction = {
    id: 'close_supply_valve',
    name: 'close_supply_valve',
    interactionId: 'close_supply_valve',
    assetId: 'SUPPLY_VALVE',
    stateKey: 'supplyValveClosed',
    aliases: Object.freeze(['cancel_purge', 'restore_power', 'stop_water_supply', 'valve', 'supply_valve']),
    prompt: 'ROTATE WHEEL / ISOLATE CITY SUPPLY',
    label: 'ROTATE WHEEL / ISOLATE CITY SUPPLY',
    position: new THREE.Vector3(11, 2.05, -71.95),
    radius: 2.8,
    holdDuration: 2.1,
    mesh: valveWheel,
    object: valveWheel,
    enabled: true,
    completed: false,
    setCompleted(completed = true) {
      this.completed = Boolean(completed);
      materials.red.emissive?.setHex?.(this.completed ? 0x184c31 : 0x000000);
    },
  };
  interactables.push(valveInteraction);
  const purgeInteraction = valveInteraction;

  // The valve's downstream flange now owns the only city path. It turns around
  // the east side of the vault, returns west on hangers, passes the south wall
  // through a collared sleeve, and drops onto the exterior demolition cradle.
  // There is no pre-valve tee that could bypass either isolation method.
  const cityMainEastElbowId = 'CITY_MAIN_EAST_ELBOW';
  pipeRun('CITY_SUPPLY_MAIN_DOWNSTREAM', [11.8, valveMainY, -74], [22, valveMainY, -74], 0.42, materials.steel, {
    from: valveDownstreamNodeId, to: cityMainEastElbowId, fromKind: 'valve_outlet', support: 'hanger', supportSpacing: 3.2,
  });
  addPipeFitting('CITY_MAIN_EAST_ELBOW_CASTING', 'elbow', cityMainEastElbowId, [22, valveMainY, -74], [[-1, 0, 0], [0, 0, -1]], 0.42);
  const cityMainReturnElbowId = 'CITY_MAIN_RETURN_ELBOW';
  pipeRun('CITY_MAIN_DOWNSTREAM_SOUTH_LEG', [22, valveMainY, -74], [22, valveMainY, -78.4], 0.42, materials.steel, {
    from: cityMainEastElbowId, to: cityMainReturnElbowId, support: 'hanger',
  });
  addPipeFitting('CITY_MAIN_RETURN_ELBOW_CASTING', 'elbow', cityMainReturnElbowId, [22, valveMainY, -78.4], [[0, 0, 1], [-1, 0, 0]], 0.42);
  const backdoorApproachElbowId = 'BACKDOOR_MAIN_APPROACH_ELBOW';
  pipeRun('CITY_MAIN_DOWNSTREAM_RETURN', [22, valveMainY, -78.4], [8.2, valveMainY, -78.4], 0.42, materials.steel, {
    from: cityMainReturnElbowId, to: backdoorApproachElbowId, support: 'hanger', supportSpacing: 3.2,
  });
  addPipeFitting('BACKDOOR_MAIN_APPROACH_ELBOW_CASTING', 'elbow', backdoorApproachElbowId, [8.2, valveMainY, -78.4], [[1, 0, 0], [0, 0, -1]], 0.42);
  const backdoorWallInsideNodeId = 'BACKDOOR_WALL_PIPE_INSIDE';
  pipeRun('BACKDOOR_MAIN_PIPE_OVERHEAD', [8.2, valveMainY, -78.4], [8.2, valveMainY, -80.72], 0.42, materials.steel, {
    from: backdoorApproachElbowId, to: backdoorWallInsideNodeId, support: 'hanger',
  });
  const backdoorWallCenterNodeId = 'BACKDOOR_WALL_PIPE_COLLAR_NODE';
  const backdoorWallOutsideNodeId = 'BACKDOOR_WALL_PIPE_OUTSIDE';
  pipeRun('BACKDOOR_SOUTH_WALL_SLEEVE_INNER', [8.2, valveMainY, -80.72], [8.2, valveMainY, -81], 0.42, materials.steel, {
    from: backdoorWallInsideNodeId, to: backdoorWallCenterNodeId, toKind: 'wall_penetration', support: 'embedded',
  });
  pipeRun('BACKDOOR_SOUTH_WALL_SLEEVE_OUTER', [8.2, valveMainY, -81], [8.2, valveMainY, -81.28], 0.42, materials.steel, {
    from: backdoorWallCenterNodeId, to: backdoorWallOutsideNodeId, toKind: 'wall_approach', support: 'embedded',
  });
  const backdoorWallCollar = addWallPipeCollar(
    'BACKDOOR_PIPE_WALL_COLLAR',
    backdoorWallCenterNodeId,
    'VALVE_HOUSE_SOUTH_EAST',
    [8.2, valveMainY, -81],
    [0, 0, 1],
    0.42,
  );
  const backdoorDropTopNodeId = 'BACKDOOR_MAIN_DROP_TOP_ELBOW';
  pipeRun('BACKDOOR_MAIN_PIPE_EXTERIOR_OVERHEAD', [8.2, valveMainY, -81.28], [8.2, valveMainY, -83.5], 0.42, materials.steel, {
    from: backdoorWallOutsideNodeId, to: backdoorDropTopNodeId, support: 'rack',
  });
  addPipeFitting('BACKDOOR_MAIN_DROP_TOP_ELBOW_CASTING', 'elbow', backdoorDropTopNodeId, [8.2, valveMainY, -83.5], [[0, 0, 1], [0, -1, 0]], 0.42);
  const backdoorDropBottomNodeId = 'BACKDOOR_MAIN_DROP_BOTTOM_ELBOW';
  pipeRun('BACKDOOR_MAIN_PIPE_DROP', [8.2, valveMainY, -83.5], [8.2, 1.15, -83.5], 0.42, materials.steel, {
    from: backdoorDropTopNodeId, to: backdoorDropBottomNodeId,
  });
  addPipeFitting('BACKDOOR_MAIN_DROP_BOTTOM_ELBOW_CASTING', 'elbow', backdoorDropBottomNodeId, [8.2, 1.15, -83.5], [[0, 1, 0], [0, 0, -1]], 0.42);
  const breachPipeMaterial = materials.steel.clone();
  breachPipeMaterial.name = 'Backdoor city-main demolition section';
  const buriedDropTopNodeId = 'BACKDOOR_BURIED_DROP_TOP_ELBOW';
  const backdoorMainPipe = pipeRun('BACKDOOR_MAIN_PIPE', [8.2, 1.15, -83.5], [8.2, 1.15, -89.2], 0.42, breachPipeMaterial, {
    from: backdoorDropBottomNodeId, to: buriedDropTopNodeId, support: 'floor', supportSpacing: 3.2,
  });
  backdoorMainPipe.userData.assetId = 'BACKDOOR_MAIN_PIPE';
  const backdoorPipeCollider = addCollider('BACKDOOR_MAIN_PIPE_COLLIDER', [7.72, 0.66, -89.25], [8.68, 1.64, -83.45], {
    kind: 'main_pipe', blocking: true, ballistic: true, mesh: backdoorMainPipe,
  });
  addPipeFitting('BACKDOOR_BURIED_DROP_TOP_ELBOW_CASTING', 'elbow', buriedDropTopNodeId, [8.2, 1.15, -89.2], [[0, 0, 1], [0, -1, 0]], 0.42);
  const buriedCityConnectionNodeId = 'BACKDOOR_CITY_MAIN_BURIED_CONNECTION';
  pipeRun('BACKDOOR_CITY_MAIN_BURIED_DROP', [8.2, 1.15, -89.2], [8.2, 0.18, -89.2], 0.42, materials.steel, {
    from: buriedDropTopNodeId, to: buriedCityConnectionNodeId, toKind: 'city_buried_connection',
  });
  const groundSleeve = pipeRing('BACKDOOR_CITY_MAIN_GROUND_SLEEVE', [8.2, 0.18, -89.2], [0, 1, 0], 0.58, 0.08, materials.galvanized);
  pipeFittings.push({
    id: groundSleeve.name,
    kind: 'ground_sleeve',
    nodeId: buriedCityConnectionNodeId,
    meshName: groundSleeve.name,
  });
  const breachBandMaterial = new THREE.MeshStandardMaterial({ color: 0xb44530, roughness: 0.46, metalness: 0.48, emissive: 0x3b0803, emissiveIntensity: 0.25 });
  const breachBands = [-85.25, -86.35].map((z, index) => {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.065, 10, 24), breachBandMaterial);
    band.name = `BACKDOOR_PIPE_CHARGE_BAND_${index + 1}`;
    band.position.set(8.2, 1.15, z);
    band.castShadow = true;
    root.add(band);
    raycastMeshes.push(band);
    return band;
  });
  const backdoorPipeInteraction = {
    id: 'demolish_backdoor_main_pipe',
    name: 'demolish_backdoor_main_pipe',
    interactionId: 'demolish_backdoor_main_pipe',
    assetId: 'BACKDOOR_MAIN_PIPE',
    stateKey: 'backdoorPipeDemolished',
    aliases: Object.freeze(['backdoor_pipe', 'demolish_pipe', 'pipe_demolished']),
    prompt: 'PLACE CHARGE / SEVER CITY MAIN',
    label: 'PLACE CHARGE / SEVER CITY MAIN',
    position: new THREE.Vector3(8.2, 1.2, -85.75),
    radius: 2.7,
    holdDuration: 1.7,
    mesh: backdoorMainPipe,
    object: backdoorMainPipe,
    enabled: true,
    completed: false,
    setCompleted(completed = true) {
      this.completed = Boolean(completed);
      backdoorPipeCollider.blocking = !this.completed;
      backdoorPipeCollider.ballistic = !this.completed;
      backdoorMainPipe.visible = !this.completed;
      breachBands.forEach((band) => { band.visible = !this.completed; });
      breachPipeMaterial.emissive.setHex(this.completed ? 0x4d1608 : 0x000000);
      breachPipeMaterial.emissiveIntensity = this.completed ? 1.2 : 0;
    },
  };
  interactables.push(backdoorPipeInteraction);

  const facilityDoors = Object.freeze({
    treatmentHall: Object.freeze([treatmentNorthDoor, treatmentWestDoor]),
    supplyValveHouse: Object.freeze([valveNorthDoor, valveBackdoor]),
    securedValveVault: Object.freeze([valveVaultDoor]),
  });
  const finalBeaconMaterial = new THREE.MeshStandardMaterial({ color: 0x612319, emissive: 0xff3f25, emissiveIntensity: 0.25 });
  cylinderMesh('VALVE_HOUSE_ALARM', 11, 3.75, -80.65, 0.18, 0.36, finalBeaconMaterial);
  warningFixtures.push({ material: finalBeaconMaterial, phase: 0.7, base: 3.8, finaleOnly: true });

  // Grounded tactical cover defines readable exterior guard posts without
  // turning the maintained yard back into a cluttered factory maze.
  for (const spec of [
    ['ENTRY_DOGLEG_BARRIER_A', -10.5, 0.66, 50, 6.2, 1.25, 0.92, 'intake', -10.5, 49.02, 0, -1],
    ['ENTRY_DOGLEG_BARRIER_B', -19, 0.66, 38, 0.92, 1.25, 6.4, 'intake', -18.02, 38, 1, 0],
    ['PROCESS_APPROACH_COVER', -1, 0.66, 23, 6.0, 1.25, 0.92, 'filter', -1, 22.02, 0, -1],
    ['TREATMENT_COVER_N', -4, 0.66, 14, 5.4, 1.25, 0.92, 'filter', -4, 13.02, 0, -1],
    ['TREATMENT_COVER_E', 17, 0.66, -5, 0.92, 1.25, 5.4, 'filter', 16.02, -5, -1, 0],
    ['WEST_SERVICE_COVER', -25, 0.67, -4, 0.86, 1.27, 4.8, 'atrium', -24.06, -4, 1, 0],
    ['PROCESS_AISLE_COVER', 0.4, 0.67, -18.4, 4.4, 1.27, 0.86, 'atrium', 0.4, -19.34, 0, -1],
    ['CROSS_YARD_COVER', -12, 0.66, -43, 5.6, 1.25, 0.92, 'finale', -12, -43.98, 0, -1],
    ['VALVE_APPROACH_COVER', 8, 0.66, -48, 5.6, 1.25, 0.92, 'finale', 8, -48.98, 0, -1],
    ['VALVE_YARD_COVER', 26, 0.66, -62, 0.92, 1.25, 5.4, 'finale', 25.02, -62, -1, 0],
    ['VALVE_ROOM_COVER', 18.8, 0.66, -64.5, 4.2, 1.25, 0.9, 'boss', 18.8, -65.45, 0, -1],
    ['BACKDOOR_COVER', 15, 0.66, -88, 5.2, 1.25, 0.9, 'boss', 15, -88.95, 0, -1],
  ]) {
    const [name, x, y, z, width, height, depth, zone, cx, cz, nx, nz] = spec;
    boxMesh(name, x, y, z, width, height, depth, materials.darkConcrete, { collider: true, colliderId: `${name}_COLLIDER`, kind: 'cover', raycast: true });
    addCover(`${name}_POINT`, cx, cz, nx, nz, zone, `${name}_COLLIDER`);
  }

  // Real Poly Haven nature, placed from fixed authored transform tables.
  const gltfLoader = new GLTFLoader();
  const natureResults = await Promise.allSettled([
    ['pine', URLS.pine], ['shrub02', URLS.shrub02], ['shrub04', URLS.shrub04],
    ['grassClump', URLS.grassClump], ['boulder', URLS.boulder], ['rock', URLS.rock],
  ].map(async ([name, url]) => [name, await gltfLoader.loadAsync(url)]));
  const nature = {};
  for (const result of natureResults) {
    if (result.status === 'fulfilled') nature[result.value[0]] = result.value[1];
    else console.warn('A local Ridgewatch nature model could not be loaded; no primitive substitute was used.', result.reason);
  }

  function prepareNature(object, includeRaycast = true) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
      const materials_ = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials_) {
        if (!material) continue;
        if (material.map) material.map.anisotropy = anisotropy;
        if (material.normalMap) material.normalMap.anisotropy = anisotropy;
        if (material.transparent || material.alphaTest > 0) {
          material.transparent = false;
          material.alphaTest = Math.max(0.42, material.alphaTest || 0);
          material.depthWrite = true;
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
        }
      }
      if (includeRaycast) raycastMeshes.push(child);
    });
  }

  function natureVariant(assetName, variant, name, x, z, scale = 1, rotationY = 0, collider = null) {
    const gltf = nature[assetName];
    if (!gltf?.scene?.children?.length) return null;
    if (x <= TERRAIN_MIN_X + 2 || x >= TERRAIN_MAX_X - 2 || z <= TERRAIN_MIN_Z + 2 || z >= TERRAIN_MAX_Z - 2) {
      throw new RangeError(`${name} must remain over the continuous terrain mesh.`);
    }
    const source = gltf.scene.children[Math.abs(variant) % gltf.scene.children.length];
    const object = source.clone(true);
    object.name = name;
    object.position.set(x, terrainHeight(x, z) - 0.14, z);
    object.rotation.y = rotationY;
    object.scale.setScalar(scale);
    object.userData.terrainSupported = true;
    object.userData.authoredPlacement = true;
    object.userData.assetSource = `Poly Haven ${assetName}`;
    // Foliage, shrubs and tree trunks do not stop rifle rounds or line of
    // sight. Stone remains genuine ballistic cover. Tree trunks may still own
    // a movement collider below, but that contract is deliberately separate.
    const ballisticSolid = assetName === 'boulder' || assetName === 'rock';
    prepareNature(object, ballisticSolid);
    root.add(object);
    if (collider) {
      const radius = collider.radius * scale;
      const height = collider.height * scale;
      const stone = assetName === 'boulder' || assetName === 'rock';
      object.userData.ballisticPermeable = !stone;
      addCollider(
        `${name}_COLLIDER`,
        [x - radius, object.position.y, z - radius],
        [x + radius, object.position.y + height, z + radius],
        {
          kind: collider.kind ?? 'nature',
          blocking: true,
          ballistic: stone,
          ballisticPermeable: !stone,
          mesh: object,
        },
      );
    }
    return object;
  }

  // Dense, fertile exterior verges built from the actual Poly Haven grass
  // meshes. Candidate cells are fully jittered, deterministically re-ordered,
  // and passed through a spatial minimum-distance filter. Authored moisture
  // centres vary both density and separation, producing repeatable blue-noise
  // clusters instead of visible rows. There is no runtime random seed,
  // billboard card, or primitive stand-in. The maintained treatment compound
  // inside x +/-30 and z<60 intentionally stays clear.
  function buildExteriorGrassField() {
    // The first three variants are the lighter meadow clumps; the larger two
    // remain as individually authored accents below.
    const sources = (nature.grassClump?.scene?.children ?? []).filter((child) => child.isMesh).slice(0, 2);
    if (!sources.length) return;
    const sourceSizes = sources.map((source) => {
      source.geometry.computeBoundingBox();
      return source.geometry.boundingBox.getSize(new THREE.Vector3());
    });
    const buckets = sources.map(() => []);
    const dummy = new THREE.Object3D();
    let serial = 0;

    const hashUnit = (value, salt = 0) => {
      let hash = Math.imul((value + 1) ^ salt, 0x45d9f3b);
      hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
      hash ^= hash >>> 16;
      return (hash >>> 0) / 4294967296;
    };
    const clusterStrengthAt = (x, z, clusters) => clusters.reduce((strongest, cluster) => {
      const dx = (x - cluster.x) / cluster.radiusX;
      const dz = (z - cluster.z) / cluster.radiusZ;
      return Math.max(strongest, Math.exp(-(dx * dx + dz * dz) * 1.45));
    }, 0);
    const candidateZones = [];
    const collectCandidate = (zone, row, column, xBase, zBase) => {
      const key = zone.seed + row * 4099 + column * 131;
      const x = THREE.MathUtils.clamp(
        xBase + (hashUnit(key, 0x71c3) - 0.5) * zone.spacing * 0.98,
        zone.minX + 0.08, zone.maxX - 0.08,
      );
      const z = THREE.MathUtils.clamp(
        zBase + (hashUnit(key, 0x9e37) - 0.5) * zone.spacing * 0.98,
        zone.minZ + 0.08, zone.maxZ - 0.08,
      );
      if (zone.trackClearance > 0 && Math.abs(x) < zone.trackClearance) return;
      const clusterStrength = clusterStrengthAt(x, z, zone.clusters);
      const density = THREE.MathUtils.lerp(zone.baseDensity, zone.clusterDensity, clusterStrength);
      if (hashUnit(key, 0xb529) > density) return;
      candidateZones[zone.index].push({
        key, x, z, clusterStrength,
        priority: hashUnit(key, 0x68e3),
        separation: zone.minSeparation * THREE.MathUtils.lerp(1.12, 0.82, clusterStrength)
          * THREE.MathUtils.lerp(0.9, 1.1, hashUnit(key, 0x1b87)),
      });
    };

    const zones = Object.freeze([
      Object.freeze({
        id: 'north_meadow', index: 0, seed: 13007,
        minX: -82, maxX: 82, minZ: 62.5, maxZ: 132.5,
        spacing: 1.18, minSeparation: 0.86, targetCount: 4200,
        baseDensity: 0.72, clusterDensity: 0.96, trackClearance: 3.65,
        clusters: Object.freeze([
          Object.freeze({ x: -72, z: 101, radiusX: 19, radiusZ: 24 }),
          Object.freeze({ x: -35, z: 122, radiusX: 23, radiusZ: 17 }),
          Object.freeze({ x: 8, z: 78, radiusX: 28, radiusZ: 13 }),
          Object.freeze({ x: 42, z: 106, radiusX: 25, radiusZ: 21 }),
          Object.freeze({ x: 73, z: 127, radiusX: 18, radiusZ: 16 }),
        ]),
      }),
      Object.freeze({
        id: 'west_wet_verge', index: 1, seed: 27011,
        minX: -82, maxX: -32.6, minZ: -108, maxZ: 59,
        spacing: 1.78, minSeparation: 1.24, targetCount: 1050,
        baseDensity: 0.61, clusterDensity: 0.94, trackClearance: 0,
        clusters: Object.freeze([
          Object.freeze({ x: -48, z: 43, radiusX: 15, radiusZ: 27 }),
          Object.freeze({ x: -69, z: -12, radiusX: 13, radiusZ: 31 }),
          Object.freeze({ x: -49, z: -72, radiusX: 16, radiusZ: 28 }),
        ]),
      }),
      Object.freeze({
        id: 'east_wet_verge', index: 2, seed: 39019,
        minX: 32.6, maxX: 82, minZ: -108, maxZ: 59,
        spacing: 1.78, minSeparation: 1.24, targetCount: 1050,
        baseDensity: 0.61, clusterDensity: 0.94, trackClearance: 0,
        clusters: Object.freeze([
          Object.freeze({ x: 51, z: 39, radiusX: 17, radiusZ: 29 }),
          Object.freeze({ x: 69, z: -25, radiusX: 13, radiusZ: 30 }),
          Object.freeze({ x: 48, z: -84, radiusX: 15, radiusZ: 25 }),
        ]),
      }),
    ]);
    zones.forEach(() => candidateZones.push([]));

    // Dense northern meadow candidate cells. Full-cell jitter plus shuffled
    // acceptance prevents the iteration rows from surviving into the image.
    for (let row = 0, zBase = 62.5; zBase <= 132.5; row += 1, zBase += 1.18) {
      for (let column = 0, xBase = -82; xBase <= 82; column += 1, xBase += 1.18) {
        collectCandidate(zones[0], row, column, xBase, zBase);
      }
    }
    for (let zoneIndex = 1; zoneIndex < zones.length; zoneIndex += 1) {
      const zone = zones[zoneIndex];
      for (let row = 0, zBase = zone.minZ; zBase <= zone.maxZ; row += 1, zBase += zone.spacing) {
        for (let column = 0, xBase = zone.minX; xBase <= zone.maxX; column += 1, xBase += zone.spacing) {
          collectCandidate(zone, row, column, xBase, zBase);
        }
      }
    }

    const queueGrassClump = (candidate, sequence) => {
      const variant = Math.floor(hashUnit(candidate.key, 0xd1b5) * sources.length) % sources.length;
      const widthVariation = hashUnit(candidate.key, 0xa4f1);
      const heightVariation = hashUnit(candidate.key, 0xc6ef);
      const targetWidth = THREE.MathUtils.lerp(0.66, 1.18, widthVariation)
        * THREE.MathUtils.lerp(0.94, 1.08, candidate.clusterStrength);
      const targetHeight = THREE.MathUtils.lerp(0.5, 0.92, heightVariation);
      const sourceSize = sourceSizes[variant];
      const horizontalScale = targetWidth / Math.max(0.01, sourceSize.x, sourceSize.z);
      const verticalScale = targetHeight / Math.max(0.01, sourceSize.y);
      dummy.position.set(candidate.x, terrainHeight(candidate.x, candidate.z) - 0.11, candidate.z);
      dummy.rotation.set(0, hashUnit(candidate.key, 0x5bd1) * Math.PI * 2, 0);
      dummy.scale.set(
        horizontalScale * THREE.MathUtils.lerp(0.86, 1.14, hashUnit(candidate.key, 0x88ab)),
        verticalScale,
        horizontalScale * THREE.MathUtils.lerp(0.84, 1.16, hashUnit(candidate.key, 0x3c6d)),
      );
      dummy.updateMatrix();
      buckets[variant].push(dummy.matrix.clone());
      serial = sequence + 1;
    };

    for (const zone of zones) {
      const candidates = candidateZones[zone.index].sort((a, b) => a.priority - b.priority);
      const spatial = new Map();
      const accepted = [];
      const cellSize = zone.minSeparation;
      for (const candidate of candidates) {
        if (accepted.length >= zone.targetCount) break;
        const cellX = Math.floor((candidate.x - zone.minX) / cellSize);
        const cellZ = Math.floor((candidate.z - zone.minZ) / cellSize);
        let clear = true;
        for (let dz = -2; dz <= 2 && clear; dz += 1) {
          for (let dx = -2; dx <= 2 && clear; dx += 1) {
            const neighbours = spatial.get(`${cellX + dx}:${cellZ + dz}`) ?? [];
            for (const neighbour of neighbours) {
              const minimum = Math.max(candidate.separation, neighbour.separation);
              if ((candidate.x - neighbour.x) ** 2 + (candidate.z - neighbour.z) ** 2 < minimum ** 2) {
                clear = false;
                break;
              }
            }
          }
        }
        if (!clear) continue;
        accepted.push(candidate);
        const key = `${cellX}:${cellZ}`;
        const residents = spatial.get(key) ?? [];
        residents.push(candidate);
        spatial.set(key, residents);
      }
      accepted.forEach((candidate) => queueGrassClump(candidate, serial));
      root.userData[`${zone.id}GrassCount`] = accepted.length;
    }

    buckets.forEach((matrices, variant) => {
      if (!matrices.length) return;
      const source = sources[variant];
      const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
      const material = sourceMaterial.clone();
      material.name = `Poly Haven exterior grass ${variant + 1}`;
      material.color.setHex(0x719762);
      material.transparent = false;
      material.alphaTest = Math.max(0.42, material.alphaTest || 0);
      material.depthWrite = true;
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
      const field = new THREE.InstancedMesh(source.geometry, material, matrices.length);
      field.name = `AUTHORED_EXTERIOR_GRASS_FIELD_${variant + 1}`;
      field.castShadow = false;
      field.receiveShadow = true;
      field.userData.softVegetation = true;
      field.userData.terrainSupported = true;
      field.userData.authoredBounds = Object.freeze({
        minX: -82.5, maxX: 82.5, minZ: -108.5, maxZ: 133,
      });
      field.userData.exteriorOnly = true;
      field.userData.hydrology = 'fertile_reservoir_verge';
      matrices.forEach((matrix, index) => field.setMatrixAt(index, matrix));
      field.instanceMatrix.needsUpdate = true;
      field.computeBoundingBox();
      field.computeBoundingSphere();
      root.add(field);
    });
    root.userData.exteriorGrassClumpCount = serial;
    root.userData.exteriorGrassDistribution = 'deterministic_blue_noise_moisture_clusters';
  }

  const pinePlacements = [
    [-52, 91, 0, 9.1, 0.1], [-38, 94, 1, 8.4, 2.1], [-22, 82, 2, 7.7, 4.4],
    [21, 84, 0, 7.9, 1.4], [38, 93, 1, 8.8, 3.2], [53, 78, 2, 9.2, 5.1],
    [-46, 70, 2, 8.6, 0.5], [45, 66, 1, 8.2, 3.6], [-43, 53, 2, 8.9, 1.2],
    [44, 45, 1, 8.5, 4.7], [-47, 24, 0, 9.1, 2.9], [46, 12, 2, 8.7, 1.8],
    [-48, -8, 1, 9.0, 4.6], [47, -20, 0, 8.4, 2.8], [-45, -39, 2, 9.3, 0.7],
    [48, -54, 1, 8.8, 5.5], [-47, -73, 0, 9.2, 2.1], [46, -89, 2, 8.6, 3.9],
    [-44, -104, 1, 9.0, 1.3], [43, -108, 0, 8.5, 4.9], [-38, -121, 2, 9.2, 3.3],
    [-58, 58, 0, 8.7, 5.8], [57, 39, 1, 8.9, 2.6], [-56, -30, 2, 9.1, 0.4],
    [56, -76, 1, 8.8, 4.2], [-53, -98, 2, 9.0, 1.5],
  ];
  pinePlacements.forEach(([x, z, variant, scale, rotation], index) => {
    natureVariant('pine', variant, `AUTHORED_PINE_${index}`, x, z, scale, rotation, Math.abs(x) < 32 ? { radius: 0.12, height: 1.35, kind: 'tree' } : null);
  });

  // The northwest insertion begins inside a real tree-and-rock pocket rather
  // than on the exposed service-road centreline.  Trunks are body-solid; soft
  // shrub crowns and grass remain permeable.
  const insertionPines = Object.freeze([
    [-67, 124, 1, 8.8, 0.4], [-59, 120, 2, 9.4, 2.0], [-62, 106, 0, 8.5, 4.2],
    [-52, 99, 1, 9.1, 1.2], [-47, 87, 2, 8.7, 3.8], [-34, 75, 0, 8.9, 5.0],
    [-23, 67, 1, 8.3, 2.7],
  ]);
  insertionPines.forEach(([x, z, variant, scale, rotation], index) => {
    natureVariant('pine', variant, `INSERTION_PINE_${index + 1}`, x, z, scale, rotation, { radius: 0.075, height: 1.35, kind: 'tree' });
  });

  // Tree lines sit in front of the invisible actor limits while continuous
  // terrain rises and carries on behind them.  The edge therefore reads as a
  // closed highland basin from every playable exterior angle.
  const boundaryPines = Object.freeze([
    [-86, 130, 0, 9.6, 0.2], [-70, 135, 1, 10.1, 1.8], [-50, 138, 2, 9.2, 3.1],
    [-28, 137, 0, 9.8, 4.4], [-6, 139, 1, 9.4, 5.2], [18, 137, 2, 10.0, 2.5],
    [42, 139, 0, 9.3, 0.8], [65, 135, 1, 9.9, 3.7], [85, 130, 2, 9.5, 5.5],
    [-87, 108, 1, 9.2, 2.2], [-87, 76, 2, 9.8, 4.0], [-87, 42, 0, 9.4, 0.7],
    [-87, 6, 1, 10.0, 5.0], [-87, -34, 2, 9.6, 2.8], [-87, -78, 0, 9.8, 1.2],
    [87, 108, 2, 9.4, 4.8], [87, 73, 0, 10.0, 1.6], [87, 36, 1, 9.5, 3.4],
    [87, -4, 2, 9.9, 5.4], [87, -46, 0, 9.3, 2.1], [87, -86, 1, 9.8, 0.5],
  ]);
  boundaryPines.forEach(([x, z, variant, scale, rotation], index) => {
    natureVariant('pine', variant, `BOUNDARY_RIDGE_PINE_${index + 1}`, x, z, scale, rotation);
  });

  // Uneven secondary woodland pockets thicken the outskirts without closing
  // the northwest infiltration lane or the compacted north service track.
  // These are explicit compositions rather than a mirrored perimeter array;
  // every trunk is actor-solid and supplies believable optional flank cover.
  const outerWoodlandPines = Object.freeze([
    [-79, 121, 2, 8.1, 5.7], [-75, 96, 0, 9.4, 1.1], [-68, 68, 1, 7.8, 3.9],
    [-76, 39, 2, 9.7, 0.3], [-65, 11, 0, 8.6, 4.8], [-72, -19, 1, 10.0, 2.4],
    [-66, -51, 2, 8.3, 5.2], [-78, -79, 0, 9.1, 1.7], [-67, -107, 1, 8.8, 3.5],
    [80, 119, 1, 9.0, 0.8], [69, 101, 2, 8.2, 4.5], [76, 77, 0, 9.6, 2.0],
    [65, 52, 1, 8.5, 5.5], [74, 23, 2, 9.8, 1.4], [67, -9, 0, 8.0, 3.2],
    [78, -38, 1, 9.3, 0.1], [66, -67, 2, 8.7, 4.1], [74, -101, 0, 9.9, 2.7],
    [-30, 129, 1, 8.4, 5.0], [-8, 124, 2, 9.2, 1.6], [17, 128, 0, 8.1, 3.7],
    [35, 118, 1, 9.5, 0.5], [59, 126, 2, 8.9, 4.9],
  ]);
  outerWoodlandPines.forEach(([x, z, variant, scale, rotation], index) => {
    natureVariant('pine', variant, `OUTER_WOODLAND_PINE_${index + 1}`, x, z, scale, rotation, {
      radius: 0.075, height: 1.35, kind: 'tree',
    });
  });
  root.userData.authoredExteriorTreeCount = pinePlacements.length + insertionPines.length
    + boundaryPines.length + outerWoodlandPines.length;

  const shrubPlacements = [
    [-29, 94, 0, 1.08, .2], [-18, 89, 1, 1.15, 1.4], [-9, 81, 2, 1.0, 2.7],
    [10, 91, 3, 1.16, 4.1], [19, 79, 1, 1.12, .8], [29, 87, 2, 1.05, 2.2],
    [-34, 72, 3, 1.15, 3.7], [35, 70, 0, 1.08, 5.2], [-36, 50, 1, 1.1, 1.8],
    [37, 39, 2, 1.04, 4.7], [-35, 18, 3, 1.12, .5], [36, -4, 0, 1.1, 3.1],
    [-36, -29, 2, 1.08, .7], [37, -48, 0, 1.14, 2.3], [-36, -72, 3, 1.12, 4.2],
    [36, -95, 1, 1.16, 1.8], [-34, -108, 2, 1.1, 3.5], [34, -109, 0, 1.08, 5.1],
  ];
  shrubPlacements.forEach(([x, z, variant, scale, rotation], index) => natureVariant(index % 3 ? 'shrub02' : 'shrub04', variant, `AUTHORED_SHRUB_${index}`, x, z, scale * 1.55, rotation));
  // Moist unmanaged verges carry denser broadleaf growth than the maintained
  // aggregate apron. Their fixed spacing avoids the synthetic random scatter
  // associated with generated landscapes, while alternating species and scale
  // prevents a repeated hedge silhouette.
  const wetVergeShrubs = Object.freeze([
    [-48, 53, 0, 1.62, 0.4], [-61, 39, 1, 1.45, 2.2], [-48, 21, 2, 1.74, 4.6],
    [-63, 2, 3, 1.52, 1.3], [-50, -18, 0, 1.68, 3.8], [-64, -42, 1, 1.48, 5.1],
    [-49, -66, 2, 1.7, 2.7], [-62, -91, 3, 1.56, 0.8],
    [48, 51, 1, 1.58, 3.2], [62, 34, 2, 1.72, 5.4], [49, 15, 3, 1.5, 1.1],
    [64, -7, 0, 1.66, 4.0], [50, -29, 1, 1.46, 2.5], [62, -51, 2, 1.7, 0.5],
    [49, -73, 3, 1.54, 4.8], [63, -96, 0, 1.64, 1.8],
  ]);
  wetVergeShrubs.forEach(([x, z, variant, scale, rotation], index) => {
    natureVariant(index % 2 ? 'shrub02' : 'shrub04', variant, `WET_VERGE_SHRUB_${index + 1}`, x, z, scale, rotation);
  });
  const insertionShrubs = Object.freeze([
    [-57, 116, 0, 1.9, 0.4], [-53, 109, 1, 1.7, 2.1], [-46, 102, 2, 1.85, 4.4],
    [-43, 95, 3, 1.65, 1.2], [-35, 88, 0, 1.8, 3.6], [-31, 78, 1, 1.72, 5.0],
    [-20, 73, 2, 1.68, 2.8], [-12, 66, 3, 1.58, 0.7],
  ]);
  insertionShrubs.forEach(([x, z, variant, scale, rotation], index) => {
    natureVariant(index % 2 ? 'shrub02' : 'shrub04', variant, `INSERTION_SHRUB_${index + 1}`, x, z, scale, rotation);
  });

  const grassPlacements = [
    [-32.4, 98.1], [-26.7, 91.9], [-20.8, 96.4], [-15.1, 87.6], [-8.7, 94.8],
    [-3.8, 84.7], [6.9, 97.2], [13.6, 88.1], [18.4, 95.5], [25.7, 89.3],
    [31.8, 97.8], [-35.2, 83.6], [-27.9, 78.4], [-19.8, 85.9], [-13.2, 76.7],
    [-6.5, 82.1], [5.7, 75.2], [11.9, 83.8], [19.6, 77.1], [27.4, 85.2],
    [34.6, 79.2], [-37.1, 70.8], [-29.3, 65.4], [-20.4, 72.6], [-11.1, 64.1],
    [-2.9, 70.6], [8.3, 64.8], [15.7, 72.3], [24.1, 66.1], [36.2, 68.9],
    [-41.5, 55.6], [43.1, 50.8], [-35.7, 37.2], [40.2, 29.1], [-43.6, 15.7],
    [35.4, 4.9], [-39.1, -8.6], [42.7, -18.2], [-34.8, -31.4], [38.6, -45.9],
    [-42.2, -57.1], [34.3, -70.6], [-37.8, -82.9], [41.4, -94.2],
    [-33.5, -106.7], [44.1, -103.4], [-51.8, -36.2], [55.6, -63.8],
  ];
  grassPlacements.forEach(([x, z], index) => natureVariant('grassClump', index, `AUTHORED_GRASS_${index}`, x, z, 2.35 + (index % 4) * 0.24, index * 1.37));
  buildExteriorGrassField();

  const boulderPlacements = [[-25, 88, 1.1, .5], [25, 82, .92, 2.2], [-35, 63, .95, 4.1], [35, 55, 1.05, 1.5], [-38, -92, 1.15, 3.4]];
  boulderPlacements.forEach(([x, z, scale, rotation], index) => natureVariant('boulder', 0, `AUTHORED_BOULDER_${index}`, x, z, scale, rotation, { radius: 1.2, height: 1.55, kind: 'rock' }));

  // Large stones anchor asymmetrical side-verge groups. They sit well outside
  // the main gate approach, leaving its authored cover rhythm unchanged while
  // making exploratory flanks feel like fertile highland terrain.
  const outerBoulderPlacements = Object.freeze([
    [-76, 108, 1.12, 5.4], [-61, 81, 0.94, 1.2], [-70, 46, 1.26, 3.7],
    [-54, 5, 0.88, 0.4], [-68, -41, 1.18, 4.8], [-56, -84, 1.04, 2.1],
    [73, 110, 1.2, 0.9], [58, 75, 0.9, 4.4], [69, 35, 1.28, 2.6],
    [55, -7, 0.96, 5.8], [71, -53, 1.14, 1.7], [59, -94, 1.08, 3.9],
  ]);
  outerBoulderPlacements.forEach(([x, z, scale, rotation], index) => {
    natureVariant('boulder', index, `OUTER_BOULDER_${index + 1}`, x, z, scale, rotation, {
      radius: 1.2, height: 1.55, kind: 'rock',
    });
  });

  // Four substantial Poly Haven boulders form an offset cover chain from the
  // concealed spawn toward the gate.  Their AABBs are used for actors, rounds,
  // enemy line-of-sight and AI cover validation—not decorative fake cover.
  const insertionCoverSpecs = Object.freeze([
    Object.freeze({ id: 'INSERTION_COVER_BOULDER_ALPHA', x: -49, z: 107, scale: 1.58, rotation: 0.6, routeSide: 'northwest' }),
    Object.freeze({ id: 'INSERTION_COVER_BOULDER_BRAVO', x: -40, z: 94, scale: 1.78, rotation: 2.4, routeSide: 'west' }),
    Object.freeze({ id: 'INSERTION_COVER_BOULDER_CHARLIE', x: -30, z: 82, scale: 1.62, rotation: 4.5, routeSide: 'west' }),
    Object.freeze({ id: 'INSERTION_COVER_BOULDER_DELTA', x: -18, z: 71, scale: 1.42, rotation: 1.5, routeSide: 'northwest' }),
  ]);
  insertionCoverSpecs.forEach((spec, index) => {
    natureVariant('boulder', index, spec.id, spec.x, spec.z, spec.scale, spec.rotation, { radius: 1.2, height: 1.55, kind: 'insertion_cover' });
    const tacticalOffset = spec.scale * 1.2 + 0.58;
    addCover(`${spec.id}_TACTICAL_POINT`, spec.x - tacticalOffset, spec.z + tacticalOffset, -0.52, 0.85, 'insertion', `${spec.id}_COLLIDER`);
  });
  const rockPlacements = [[-16, 93], [18, 91], [-27, 75], [29, 70], [-35, 31], [35, -12], [-34, -63], [34, -106]];
  rockPlacements.forEach(([x, z], index) => natureVariant(
    'rock',
    0,
    `AUTHORED_ROCK_${index}`,
    x,
    z,
    .75 + (index % 3) * .18,
    index * .91,
    { radius: 0.76, height: 1.05, kind: 'rock' },
  ));
  const outerRockPlacements = Object.freeze([
    [-83, 93, 0.72, 0.4], [-64, 113, 0.98, 2.9], [-48, 121, 0.64, 5.2],
    [-81, 61, 0.86, 1.6], [-57, 55, 0.7, 4.1], [-75, 18, 1.02, 0.8],
    [-45, -17, 0.78, 3.5], [-81, -29, 0.68, 5.7], [-60, -61, 0.94, 2.3],
    [-79, -92, 0.8, 4.9], [-48, -103, 1.06, 1.1],
    [82, 91, 0.76, 3.8], [63, 115, 0.92, 0.6], [47, 106, 0.66, 4.7],
    [80, 64, 1.0, 2.0], [57, 48, 0.74, 5.5], [76, 12, 0.88, 1.4],
    [45, -23, 0.7, 3.1], [82, -35, 1.04, 0.2], [62, -66, 0.82, 4.3],
    [78, -96, 0.96, 2.6], [47, -107, 0.68, 5.9],
  ]);
  outerRockPlacements.forEach(([x, z, scale, rotation], index) => {
    natureVariant('rock', index, `OUTER_ROCK_${index + 1}`, x, z, scale, rotation, {
      radius: 0.76, height: 1.05, kind: 'rock',
    });
  });
  const insertionRockSpecs = Object.freeze([
    Object.freeze({ id: 'INSERTION_COVER_ROCK_ECHO', x: -56, z: 102, scale: 1.32, rotation: 3.1 }),
    Object.freeze({ id: 'INSERTION_COVER_ROCK_FOXTROT', x: -24, z: 87, scale: 1.24, rotation: 0.9 }),
    Object.freeze({ id: 'INSERTION_COVER_ROCK_GOLF', x: -12, z: 70, scale: 1.18, rotation: 4.8 }),
  ]);
  insertionRockSpecs.forEach((spec, index) => {
    natureVariant('rock', index, spec.id, spec.x, spec.z, spec.scale, spec.rotation, { radius: 0.76, height: 1.05, kind: 'insertion_cover' });
  });
  root.userData.authoredExteriorRockCount = boulderPlacements.length + outerBoulderPlacements.length
    + rockPlacements.length + outerRockPlacements.length + insertionCoverSpecs.length + insertionRockSpecs.length;

  const enemySpawns = Object.freeze({
    intake: Object.freeze([
      { id: 'north_gate_patrol', position: new THREE.Vector3(-19, 0.08, 51), yaw: 0, role: 'rifle', thermalPost: 'north_gate', patrol: [new THREE.Vector3(-24, 0.08, 51), new THREE.Vector3(-10, 0.08, 47)] },
      { id: 'east_fence_sentry', position: new THREE.Vector3(23, 0.08, 36), yaw: 0, role: 'rifle', thermalPost: 'east_fence', patrol: [new THREE.Vector3(23, 0.08, 36), new THREE.Vector3(23, 0.08, 20)] },
      { id: 'west_fence_sentry', position: new THREE.Vector3(-23, 0.08, 31), yaw: 0, role: 'rifle_elite', thermalPost: 'west_fence', patrol: [new THREE.Vector3(-23, 0.08, 31), new THREE.Vector3(-23, 0.08, 15)] },
      { id: 'treatment_overwatch', position: new THREE.Vector3(15, 0.08, 18), yaw: 0, role: 'rifle', thermalPost: 'treatment_approach' },
    ]),
    filter: Object.freeze([
      { id: 'treatment_door_guard', position: new THREE.Vector3(5.5, 0.11, 14), yaw: 0, role: 'rifle', thermalPost: 'treatment_north_door' },
      { id: 'treatment_east_patrol', position: new THREE.Vector3(18, 0.08, -3), yaw: 0, role: 'rifle', thermalPost: 'east_apron', patrol: [new THREE.Vector3(18, 0.08, -3), new THREE.Vector3(18, 0.08, -24)] },
      { id: 'treatment_west_patrol', position: new THREE.Vector3(-25, 0.08, -15), yaw: 0, role: 'rifle_elite', thermalPost: 'west_apron', patrol: [new THREE.Vector3(-25, 0.08, -15), new THREE.Vector3(-25, 0.08, -30)] },
      { id: 'south_apron_guard', position: new THREE.Vector3(-11, 0.08, -42), yaw: 0, role: 'rifle', thermalPost: 'south_apron' },
    ]),
    atrium: Object.freeze([
      { id: 'injection_console_guard', position: new THREE.Vector3(7.5, 0.11, -6), yaw: 0, role: 'rifle_elite', thermalPost: 'injection_console' },
      { id: 'chemical_tote_guard', position: new THREE.Vector3(1.5, 0.11, -21), yaw: 0, role: 'rifle', thermalPost: 'chemical_totes' },
      { id: 'reservoir_aisle_guard', position: new THREE.Vector3(-3, 0.11, -27), yaw: 0, role: 'rifle', thermalPost: 'reservoir_aisle' },
      { id: 'reservoir_north_guard', position: new THREE.Vector3(-2, 0.11, 2), yaw: 0, role: 'rifle', thermalPost: 'reservoir_north_aisle' },
      { id: 'valve_route_patrol', position: new THREE.Vector3(23, 0.08, -39), yaw: 0, role: 'rifle', thermalPost: 'valve_route', patrol: [new THREE.Vector3(23, 0.08, -39), new THREE.Vector3(23, 0.08, -48)] },
      {
        id: 'poison_technician',
        position: new THREE.Vector3(3.35, 0.11, -15.5),
        workPosition: new THREE.Vector3(3.35, 0.11, -15.5),
        workFacing: new THREE.Vector3(5.6, 1.45, -15.5),
        yaw: Math.PI * 0.5,
        role: 'rifle_elite',
        specialty: 'poison_technician',
        missionAssetId: 'POISON_TECHNICIAN',
        technician: true,
        thermalPost: 'poison_injection_machine',
      },
    ]),
    finale: Object.freeze([
      { id: 'valve_entry_guard', position: new THREE.Vector3(18, 0.11, -48), yaw: 0, role: 'rifle', thermalPost: 'valve_entry' },
      { id: 'valve_west_guard', position: new THREE.Vector3(-10, 0.08, -66), yaw: 0, role: 'rifle', thermalPost: 'valve_west' },
      { id: 'valve_east_guard', position: new THREE.Vector3(26, 0.08, -70), yaw: 0, role: 'rifle_elite', thermalPost: 'valve_east' },
      { id: 'south_fence_guard', position: new THREE.Vector3(-14, 0.08, -96), yaw: 0, role: 'rifle_elite', thermalPost: 'south_fence' },
      {
        id: 'vault_technician',
        position: new THREE.Vector3(12.7, 0.11, -72.95),
        workPosition: new THREE.Vector3(12.7, 0.11, -72.95),
        workFacing: new THREE.Vector3(11, 2.62, -72.95),
        yaw: -Math.PI * 0.5,
        role: 'rifle_elite',
        specialty: 'valve_vault_technician',
        missionAssetId: 'VAULT_TECHNICIAN',
        technician: true,
        thermalPost: 'valve_vault',
      },
    ]),
    boss: Object.freeze([
      { id: 'cell_leader', position: new THREE.Vector3(8, 0.11, -78), yaw: 0, role: 'commander', name: 'Cell Leader Nadir' },
    ]),
  });

  // Start in the northwest tree pocket, well off the exposed gate/service-road
  // axis.  The insertion route below bends through the authored boulder chain
  // before joining the open gate from its western shoulder.
  const spawn = new THREE.Vector3(-58, terrainHeight(-58, 118) + 0.08, 118);
  const worldState = {
    elapsed: 0,
    poisonNeutralized: false,
    supplyValveClosed: false,
    backdoorPipeDemolished: false,
    poisonReleased: false,
    jammerDisabled: false,
    powerOn: false,
    ledgerTransmitted: false,
    purgeCancelled: false,
    gateUnlocked: true,
    finale: false,
    finished: false,
    gateOpen: 1,
    operationsDoorOpen: 1,
    valveRotation: 0,
  };

  function setPoisonNeutralized(neutralized = true) {
    worldState.poisonNeutralized = Boolean(neutralized);
    poisonInteraction.setCompleted(worldState.poisonNeutralized);
    if (worldState.poisonNeutralized) {
      jammerBeaconMaterial.emissive.setHex(0x3ea68c);
      jammerBeaconMaterial.emissiveIntensity = 0.8;
    } else {
      jammerBeaconMaterial.emissive.setHex(0xf0442e);
      jammerBeaconMaterial.emissiveIntensity = 3.2;
    }
  }

  function setSupplyValveClosed(closed = true) {
    worldState.supplyValveClosed = Boolean(closed);
    worldState.purgeCancelled = worldState.supplyValveClosed;
    valveInteraction.setCompleted(worldState.supplyValveClosed);
  }

  function setBackdoorPipeDemolished(demolished = true) {
    worldState.backdoorPipeDemolished = Boolean(demolished);
    backdoorPipeInteraction.setCompleted(worldState.backdoorPipeDemolished);
  }

  function setJammerDisabled() {
    if (worldState.jammerDisabled) return;
    worldState.jammerDisabled = true;
    setPoisonNeutralized(true);
  }

  function setPower(on = true) {
    worldState.powerOn = Boolean(on);
    powerInteraction.setCompleted(worldState.powerOn);
    for (const fixture of poweredFixtures) {
      fixture.light.color.setHex(worldState.powerOn ? 0xe8f4e8 : 0xff7b48);
      fixture.light.intensity = worldState.powerOn ? 1.55 : 0.18;
      fixture.material.emissive.setHex(worldState.powerOn ? 0xe9fff0 : 0xff6f3f);
      fixture.material.emissiveIntensity = worldState.powerOn ? 1.7 : 0.35;
    }
  }

  function setLedgerTransmitted() {
    if (worldState.ledgerTransmitted) return;
    worldState.ledgerTransmitted = true;
    worldState.gateUnlocked = true;
    ledgerInteraction.setCompleted(true);
  }

  function beginFinale() {
    worldState.finale = true;
  }

  function finishMission() {
    worldState.finished = true;
    finalBeaconMaterial.emissive.setHex(0x44dc91);
    finalBeaconMaterial.emissiveIntensity = 2.6;
  }

  function resetMission() {
    Object.assign(worldState, {
      elapsed: 0,
      poisonNeutralized: false,
      supplyValveClosed: false,
      backdoorPipeDemolished: false,
      poisonReleased: false,
      jammerDisabled: false,
      powerOn: false,
      ledgerTransmitted: false,
      purgeCancelled: false,
      gateUnlocked: true,
      finale: false,
      finished: false,
      gateOpen: 1,
      operationsDoorOpen: 1,
      valveRotation: 0,
    });
    poisonInteraction.enabled = true;
    valveInteraction.enabled = true;
    backdoorPipeInteraction.enabled = true;
    setPoisonNeutralized(false);
    setSupplyValveClosed(false);
    setBackdoorPipeDemolished(false);
    setPower(false);
    ledgerInteraction.setCompleted(false);
    valveWheel.rotation.z = 0;
    finalBeaconMaterial.emissive.setHex(0xff3f25);
    finalBeaconMaterial.emissiveIntensity = 0.25;
    return { ...worldState };
  }

  function missionFlag(mission, name) {
    if (!mission) return false;
    const state = typeof mission.getState === 'function' ? mission.getState() : mission;
    return Boolean(state?.flags?.[name] ?? state?.[name]);
  }

  function update(dt, mission = null) {
    const seconds = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    worldState.elapsed += seconds;
    if (activeCamera) sky.position.copy(activeCamera.position);
    if (missionFlag(mission, 'poisonNeutralized') || missionFlag(mission, 'poisonStopped') || missionFlag(mission, 'injectionClosed')) setPoisonNeutralized(true);
    if (missionFlag(mission, 'supplyValveClosed') || missionFlag(mission, 'waterSupplyStopped')) setSupplyValveClosed(true);
    if (missionFlag(mission, 'backdoorPipeDemolished') || missionFlag(mission, 'pipeDemolished')) setBackdoorPipeDemolished(true);
    if (missionFlag(mission, 'jammerDisabled')) setJammerDisabled();
    if (missionFlag(mission, 'powerRestored')) setPower(true);
    if (missionFlag(mission, 'ledgerTransmitted')) setLedgerTransmitted();
    // Legacy mission builds called the poison-machine cutoff "purge
    // cancelled". It belongs to the injection state, never the independent
    // municipal supply wheel.
    if (missionFlag(mission, 'purgeCancelled')) setPoisonNeutralized(true);
    worldState.poisonReleased = missionFlag(mission, 'poisonReleased') || missionFlag(mission, 'contaminated');
    const missionState = typeof mission?.getState === 'function' ? mission.getState() : mission;
    if (['defense', 'valve', 'close_supply_valve', 'hold_reinforcements', 'ending'].includes(missionState?.stage)) beginFinale();
    if (missionState?.complete) finishMission();

    for (const rotor of pumpRotors) rotor.rotation.z += seconds * (worldState.powerOn ? 4.8 : 0.05);
    const targetValveRotation = worldState.supplyValveClosed ? Math.PI * 2.35 : 0;
    worldState.valveRotation = THREE.MathUtils.damp(worldState.valveRotation, targetValveRotation, 3.8, seconds);
    valveWheel.rotation.z = worldState.valveRotation;
    for (const warning of warningFixtures) {
      if (warning.finaleOnly && !worldState.finale) {
        warning.material.emissiveIntensity = 0.25;
        continue;
      }
      if (worldState.finished) continue;
      const pulse = 0.28 + 0.72 * Math.max(0, Math.sin(worldState.elapsed * 4.5 + warning.phase * Math.PI * 2));
      warning.material.emissiveIntensity = warning.base * pulse;
    }
    materials.water.opacity = 0.88 + Math.sin(worldState.elapsed * 0.42) * 0.02;
  }

  function getGroundHeight(x, z, currentY = Infinity) {
    let best = null;
    const ceiling = Number.isFinite(currentY) ? currentY + 0.42 : Infinity;
    for (const floor of floors) {
      if (floor.enabled === false || x < floor.minX || x > floor.maxX || z < floor.minZ || z > floor.maxZ) continue;
      const height = typeof floor.heightAt === 'function' ? floor.heightAt(x, z, currentY) : floor.y;
      if (!Number.isFinite(height) || height > ceiling + EPSILON) continue;
      if (best === null || height > best) best = height;
    }
    return best;
  }

  function raycastWorld(originValue, directionValue, maxDistance = Infinity) {
    const origin = asVector3(originValue);
    tmpDirection.copy(directionValue);
    const length = tmpDirection.length();
    if (!origin || length < EPSILON) return null;
    tmpDirection.multiplyScalar(1 / length);
    tmpRay.set(origin, tmpDirection);
    let nearest = null;
    let nearestDistance = Math.max(0, maxDistance);
    for (const collider of colliders) {
      if (collider.ballistic === false) continue;
      const point = tmpRay.intersectBox(collider.box, tmpHit);
      if (!point) continue;
      const distance = origin.distanceTo(point);
      if (distance < 0.025 || distance > nearestDistance) continue;
      nearestDistance = distance;
      const normal = new THREE.Vector3();
      const tolerance = 0.018;
      if (Math.abs(point.x - collider.box.min.x) < tolerance) normal.set(-1, 0, 0);
      else if (Math.abs(point.x - collider.box.max.x) < tolerance) normal.set(1, 0, 0);
      else if (Math.abs(point.y - collider.box.min.y) < tolerance) normal.set(0, -1, 0);
      else if (Math.abs(point.y - collider.box.max.y) < tolerance) normal.set(0, 1, 0);
      else if (Math.abs(point.z - collider.box.min.z) < tolerance) normal.set(0, 0, -1);
      else normal.set(0, 0, 1);
      nearest = { distance, point: point.clone(), normal, object: collider.mesh, collider, kind: 'world', material: collider.kind };
    }
    return nearest;
  }

  function segmentBlocked(start, end) {
    tmpDirection.copy(end).sub(start);
    const length = tmpDirection.length();
    if (length < EPSILON) return false;
    const hit = raycastWorld(start, tmpDirection.multiplyScalar(1 / length), Math.max(0, length - 0.025));
    return Boolean(hit && hit.distance < length - 0.025);
  }

  function actorPositionClear(position, radius = 0.41, height = 1.8) {
    for (const collider of colliders) {
      if (collider.blocking === false) continue;
      const box = collider.box;
      if (box.max.y <= position.y + 0.34 || box.min.y >= position.y + height) continue;
      const nearestX = THREE.MathUtils.clamp(position.x, box.min.x, box.max.x);
      const nearestZ = THREE.MathUtils.clamp(position.z, box.min.z, box.max.z);
      const dx = position.x - nearestX;
      const dz = position.z - nearestZ;
      if (dx * dx + dz * dz < radius * radius) return false;
    }
    return true;
  }

  function resolveActorMovement(positionValue, deltaValue, radius = 0.41) {
    const start = asVector3(positionValue);
    const delta = asVector3(deltaValue, new THREE.Vector3());
    if (!start) return null;
    const next = start.clone();
    const distance = Math.hypot(delta.x, delta.z);
    const steps = Math.max(1, Math.ceil(distance / Math.max(0.08, radius * 0.45)));
    const stepX = delta.x / steps;
    const stepZ = delta.z / steps;
    for (let index = 0; index < steps; index += 1) {
      const xCandidate = next.clone();
      xCandidate.x += stepX;
      if (actorPositionClear(xCandidate, radius)) next.x = xCandidate.x;
      const zCandidate = next.clone();
      zCandidate.z += stepZ;
      if (actorPositionClear(zCandidate, radius)) next.z = zCandidate.z;
    }
    const ground = getGroundHeight(next.x, next.z, next.y + 0.4);
    if (Number.isFinite(ground)) next.y = ground;
    return next;
  }

  function resolveEnemyMovement(position, delta, radius = 0.41) {
    return resolveActorMovement(position, delta, radius);
  }

  function getCoverPoints(groupId) {
    return coverPoints.filter((point) => !groupId || point.zone === String(groupId));
  }

  function isCoverValid(cover, threatValue) {
    const threat = asVector3(threatValue);
    const position = asVector3(cover?.position ?? cover);
    if (!threat || !position) return false;
    if (cover?.colliderId && colliderById.get(cover.colliderId)?.blocking === false) return false;
    return segmentBlocked(position.clone().add(new THREE.Vector3(0, 0.9, 0)), threat.clone().add(new THREE.Vector3(0, 1.18, 0)));
  }

  const insertionRouteWaypoints = Object.freeze([
    [-58, 118],
    [-54, 112],
    [-53, 106],
    [-51.8, 102],
    [-46, 98],
    [-43.2, 96.8],
    [-43, 91],
    [-37, 87.5],
    [-35, 85],
    [-34, 79],
    [-27, 75],
    [-34, 71.5],
    [-32.5, 67],
    [-27, 64.5],
    [-22, 62.5],
    [-17.5, 60],
  ].map(([x, z]) => Object.freeze(new THREE.Vector3(x, terrainHeight(x, z) + 0.08, z))));
  const insertionCoverColliderIds = Object.freeze([
    ...insertionCoverSpecs.map((spec) => `${spec.id}_COLLIDER`),
    ...insertionRockSpecs.map((spec) => `${spec.id}_COLLIDER`),
  ]);
  const allHostileSpawns = Object.values(enemySpawns).flat();
  const authoredRosterIds = Object.freeze(allHostileSpawns.map((entry) => entry.id));
  if (authoredRosterIds.length !== 20 || new Set(authoredRosterIds).size !== 20) {
    throw new Error('CLEARWATER authored reconnaissance roster must contain exactly 20 unique contacts.');
  }
  const nearestInsertionHostile = allHostileSpawns.reduce((nearest, entry) => {
    const distance = spawn.distanceTo(entry.position);
    return !nearest || distance < nearest.distance ? { entry, distance } : nearest;
  }, null);
  const spawnEye = spawn.clone().add(new THREE.Vector3(0, 1.58, 0));
  const nearestHostileEye = nearestInsertionHostile.entry.position.clone().add(new THREE.Vector3(0, 1.28, 0));
  const insertionRoute = Object.freeze({
    id: 'NORTHWEST_CONCEALED_APPROACH',
    description: 'Off-axis tree pocket through the compacted-track dogleg to the west-shoulder gate.',
    spawn: spawn.clone(),
    perimeterEntry: insertionRouteWaypoints.at(-1).clone(),
    waypoints: insertionRouteWaypoints,
    coverColliderIds: insertionCoverColliderIds,
    coverAssetIds: Object.freeze([
      ...insertionCoverSpecs.map((spec) => spec.id),
      ...insertionRockSpecs.map((spec) => spec.id),
    ]),
    nearestHostileId: nearestInsertionHostile.entry.id,
    nearestHostileDistance: nearestInsertionHostile.distance,
    initialLineOfSightBlocked: segmentBlocked(spawnEye, nearestHostileEye),
    gateAxisOffset: Math.abs(spawn.x - -17.5),
    terrainMargin: Object.freeze({ north: TERRAIN_MAX_Z - spawn.z, west: spawn.x - TERRAIN_MIN_X }),
  });

  const facilityRouteWaypoints = Object.freeze([
    [-17.5, 60], [-18.5, 52], [-9.5, 45], [-18.5, 37], [-8, 29], [-1, 22], [5.5, 9],
    [7, 2], [2.5, -9], [0, -19], [-21, -22], [-25, -36], [-14, -43], [3, -43],
    [11, -48], [18, -53], [17, -61], [14, -68], [11, -71.95], [4, -78], [2.9, -81], [8.2, -85.75],
  ].map(([x, z]) => Object.freeze(new THREE.Vector3(x, terrainHeight(x, z) + 0.11, z))));
  const facilityTopology = Object.freeze({
    gate: Object.freeze({
      id: 'NORTH_SERVICE_GATE',
      position: new THREE.Vector3(-17.5, 0.08, 60),
      width: 10,
      usable: true,
    }),
    buildings: Object.freeze({
      treatmentHall: Object.freeze({
        id: 'TREATMENT_HALL',
        purpose: 'enclosed_reservoir_process_and_poison_injection',
        doors: facilityDoors.treatmentHall,
        containsOpenWater: false,
        processTankIds: Object.freeze(processTankSpecs.map((tank) => tank.id)),
      }),
      supplyValveHouse: Object.freeze({
        id: 'SUPPLY_VALVE_HOUSE',
        purpose: 'secured_city_supply_valve_vault',
        doors: facilityDoors.supplyValveHouse,
        backdoorId: valveBackdoor.id,
        vaultDoor: valveVaultDoor,
      }),
    }),
    route: Object.freeze({ id: 'OFFSET_PROCESS_TO_VAULT_ROUTE', waypoints: facilityRouteWaypoints }),
    gateToTreatmentDoorLateralOffset: Math.abs(-17.5 - treatmentNorthDoor.position.x),
    gateAndPrimaryDoorAligned: false,
    directDoorToDoorAxis: false,
  });

  // Counterattacks retask surviving members of the original twenty-contact
  // scan. These manifests never create a hidden reinforcement roster.
  const reinforcementSpawns = Object.freeze([
    Object.freeze({
      id: 'COUNTERATTACK_TECHNICIANS_SECURED', trigger: 'technicians_secured', routeKey: 'north_gate_dogleg',
      retaskOnly: true, spawnNewContacts: false,
      eligibleSpawnIds: Object.freeze(['north_gate_patrol', 'east_fence_sentry', 'west_fence_sentry', 'treatment_overwatch', 'south_apron_guard']),
      rallyPoints: Object.freeze([new THREE.Vector3(-17.5, 0.08, 54), new THREE.Vector3(-9, 0.08, 44), new THREE.Vector3(-4, 0.08, 23)]),
    }),
    Object.freeze({
      id: 'COUNTERATTACK_VALVE_CLOSED', trigger: 'valve_closed', routeKey: 'cross_yard_to_vault',
      retaskOnly: true, spawnNewContacts: false,
      eligibleSpawnIds: Object.freeze(['treatment_east_patrol', 'treatment_west_patrol', 'valve_route_patrol', 'valve_west_guard', 'valve_east_guard']),
      rallyPoints: Object.freeze([new THREE.Vector3(-12, 0.08, -43), new THREE.Vector3(8, 0.08, -48), new THREE.Vector3(18, 0.11, -53)]),
    }),
    Object.freeze({
      id: 'COUNTERATTACK_PIPE_DEMOLISHED', trigger: 'pipe_demolished', routeKey: 'south_backdoor_clamp',
      retaskOnly: true, spawnNewContacts: false,
      eligibleSpawnIds: Object.freeze(['south_fence_guard', 'valve_west_guard', 'valve_east_guard', 'cell_leader', 'reservoir_aisle_guard']),
      rallyPoints: Object.freeze([new THREE.Vector3(-14, 0.08, -96), new THREE.Vector3(15, 0.08, -88), new THREE.Vector3(2.9, 0.11, -81)]),
    }),
    Object.freeze({
      id: 'COUNTERATTACK_FALLBACK', trigger: 'counterattack', routeKey: 'offset_facility_route',
      retaskOnly: true, spawnNewContacts: false,
      eligibleSpawnIds: authoredRosterIds,
      rallyPoints: Object.freeze([new THREE.Vector3(-9, 0.08, 44), new THREE.Vector3(-12, 0.08, -43), new THREE.Vector3(15, 0.08, -88)]),
    }),
  ]);

  const boundary = Object.freeze({
    terrainBounds: Object.freeze({ minX: TERRAIN_MIN_X, maxX: TERRAIN_MAX_X, minZ: TERRAIN_MIN_Z, maxZ: TERRAIN_MAX_Z }),
    playableBounds: Object.freeze({ minX: -94, maxX: 94, minZ: -123, maxZ: 140 }),
    naturalBoundaryColliderIds,
    renderedLandBeyondPlayableBoundary: Object.freeze({ west: 38, east: 38, north: 24, south: 65 }),
    vegetationBounds: Object.freeze({ minX: -87, maxX: 87, minZ: -121, maxZ: 139 }),
    vegetationComposition: Object.freeze({
      exteriorGrassClumps: root.userData.exteriorGrassClumpCount ?? 0,
      northMeadowGrassClumps: root.userData.north_meadowGrassCount ?? 0,
      westWetVergeGrassClumps: root.userData.west_wet_vergeGrassCount ?? 0,
      eastWetVergeGrassClumps: root.userData.east_wet_vergeGrassCount ?? 0,
      maintainedInteriorFieldClumps: 0,
      authoredExteriorGrassAccents: grassPlacements.length,
      grassDistribution: root.userData.exteriorGrassDistribution ?? 'unavailable',
      authoredExteriorTrees: root.userData.authoredExteriorTreeCount ?? 0,
      authoredExteriorRocks: root.userData.authoredExteriorRockCount ?? 0,
    }),
  });

  const fenceContract = Object.freeze({
    actorBlocking: true,
    ballisticPermeable: true,
    lineOfSightPermeable: true,
    visualPanelsIgnoreWeaponFallbackRaycast: true,
    textureTile: Object.freeze({ sizePixels: 512, latticePitchPixels: 64, seamless: true }),
    wholeTileSpanPhase: true,
    singleOwnerCornerAndGatePosts: true,
    colliderIds: Object.freeze(colliders.filter((collider) => collider.ballisticPermeable === true).map((collider) => collider.id)),
    visualPanelNames: Object.freeze(root.children.filter((child) => child.name.endsWith('_CHAINLINK')).map((child) => child.name)),
  });

  const interactionAliases = Object.freeze({
    neutralize_poison: 'neutralize_poison',
    stop_poison_injection: 'neutralize_poison',
    poison: 'neutralize_poison',
    disable_jammer: 'neutralize_poison',
    transmit_ledger: 'neutralize_poison',
    close_supply_valve: 'close_supply_valve',
    stop_water_supply: 'close_supply_valve',
    valve: 'close_supply_valve',
    cancel_purge: 'close_supply_valve',
    restore_power: 'close_supply_valve',
    demolish_backdoor_main_pipe: 'demolish_backdoor_main_pipe',
    backdoor_pipe: 'demolish_backdoor_main_pipe',
    demolish_pipe: 'demolish_backdoor_main_pipe',
    pipe_demolished: 'demolish_backdoor_main_pipe',
  });
  const getInteractable = (id) => {
    const canonical = interactionAliases[String(id ?? '').trim().toLowerCase()] ?? String(id ?? '');
    return interactables.find((item) => item.id === canonical || item.aliases?.includes?.(id)) ?? null;
  };

  const thermalScan = Object.freeze({
    contactCount: Object.values(enemySpawns).reduce((count, group) => count + group.length, 0),
    insertion: spawn.clone(),
    perimeterEntry: new THREE.Vector3(-17.5, 0.08, 60),
    facilityFocus: new THREE.Vector3(0, 0.1, -20),
    flightStart: new THREE.Vector3(0, 76, 132),
    flightEnd: new THREE.Vector3(0, 72, -116),
    posts: Object.freeze(Object.values(enemySpawns).flat().map((entry) => Object.freeze({
      id: entry.id,
      label: entry.thermalPost ?? entry.id,
      position: entry.position.clone(),
      group: Object.entries(enemySpawns).find(([, members]) => members.includes(entry))?.[0] ?? 'unknown',
    }))),
  });

  const poisonTechnicianSpawn = allHostileSpawns.find((entry) => entry.id === 'poison_technician');
  const vaultTechnicianSpawn = allHostileSpawns.find((entry) => entry.id === 'vault_technician');
  const missionTargets = Object.freeze({
    POISON_TECHNICIAN: Object.freeze({
      id: 'POISON_TECHNICIAN', kind: 'hostile', spawnId: 'poison_technician',
      specialty: poisonTechnicianSpawn.specialty, position: poisonTechnicianSpawn.position.clone(),
    }),
    VAULT_TECHNICIAN: Object.freeze({
      id: 'VAULT_TECHNICIAN', kind: 'hostile', spawnId: 'vault_technician',
      specialty: vaultTechnicianSpawn.specialty, position: vaultTechnicianSpawn.position.clone(),
    }),
    POISON_INJECTION_MACHINE: Object.freeze({
      id: 'POISON_INJECTION_MACHINE', kind: 'objective_machine', interactionId: poisonInteraction.id,
      stateKey: 'poisonNeutralized', position: poisonMachinePosition.clone(), meshName: poisonMachine.name,
    }),
    SUPPLY_VALVE: Object.freeze({
      id: 'SUPPLY_VALVE', kind: 'objective_valve', interactionId: valveInteraction.id,
      stateKey: 'supplyValveClosed', position: valveInteraction.position.clone(), meshName: valveWheel.name,
    }),
    BACKDOOR_MAIN_PIPE: Object.freeze({
      id: 'BACKDOOR_MAIN_PIPE', kind: 'demolition_target', interactionId: backdoorPipeInteraction.id,
      stateKey: 'backdoorPipeDemolished', position: backdoorPipeInteraction.position.clone(), meshName: backdoorMainPipe.name,
    }),
  });

  // Exactly three thin-red strategic annotations are projected by the RQ-4
  // layer. They are semantic facility targets, not gameplay enemy markers.
  const reconTargets = Object.freeze([
    Object.freeze({
      id: 'valve_vault', label: 'SECURED VALVE VAULT', position: new THREE.Vector3(11, 1.35, -73),
      interactionId: valveInteraction.id, assetId: 'SUPPLY_VALVE',
    }),
    Object.freeze({
      id: 'poison_injection_machine', label: 'POISON INJECTION MACHINE', position: poisonMachinePosition.clone(),
      interactionId: poisonInteraction.id, assetId: 'POISON_INJECTION_MACHINE',
    }),
    Object.freeze({
      id: 'backdoor_pipe', label: 'BACKDOOR MAIN PIPE / DEMOLITION', position: backdoorPipeInteraction.position.clone(),
      interactionId: backdoorPipeInteraction.id, assetId: 'BACKDOOR_MAIN_PIPE',
    }),
  ]);

  const pipeNodeDegrees = new Map([...pipeNodeMap.keys()].map((id) => [id, 0]));
  pipeRuns.forEach((run) => {
    pipeNodeDegrees.set(run.from, (pipeNodeDegrees.get(run.from) ?? 0) + 1);
    pipeNodeDegrees.set(run.to, (pipeNodeDegrees.get(run.to) ?? 0) + 1);
  });
  const equipmentTerminalNodeIds = new Set(pipeEquipmentLinks.flatMap((link) => [
    ...(link.inletNodeIds ?? []),
    ...(link.outletNodeIds ?? []),
  ]));
  const legitimateTerminalKinds = new Set([
    'blind_end',
    'tank_outlet',
    'pump_inlet',
    'pump_outlet',
    'dosing_pump_outlet',
    'chemical_tote_outlet',
    'poison_machine_inlet',
    'valve_inlet',
    'valve_outlet',
    'city_buried_connection',
  ]);
  const danglingPipeNodeIds = [...pipeNodeMap.values()]
    .filter((node) => (pipeNodeDegrees.get(node.id) ?? 0) < 2
      && !legitimateTerminalKinds.has(node.kind)
      && !equipmentTerminalNodeIds.has(node.id))
    .map((node) => node.id);
  const unsupportedHorizontalRunIds = pipeRuns
    .filter((run) => run.horizontal && run.supportIds.length === 0)
    .map((run) => run.id);
  const coincidentRunPairs = [];
  for (let leftIndex = 0; leftIndex < pipeRuns.length; leftIndex += 1) {
    const left = pipeRuns[leftIndex];
    const leftDirection = left.end.clone().sub(left.start);
    const leftLength = leftDirection.length();
    if (leftLength < EPSILON) continue;
    const leftAxis = leftDirection.multiplyScalar(1 / leftLength);
    for (let rightIndex = leftIndex + 1; rightIndex < pipeRuns.length; rightIndex += 1) {
      const right = pipeRuns[rightIndex];
      const rightDirection = right.end.clone().sub(right.start);
      if (rightDirection.lengthSq() < EPSILON * EPSILON) continue;
      const rightAxis = rightDirection.normalize();
      if (leftAxis.clone().cross(rightAxis).lengthSq() > 0.000001) continue;
      const offset = right.start.clone().sub(left.start);
      if (offset.clone().cross(leftAxis).lengthSq() > 0.000001) continue;
      const rightStart = offset.dot(leftAxis);
      const rightEnd = right.end.clone().sub(left.start).dot(leftAxis);
      const overlap = Math.min(leftLength, Math.max(rightStart, rightEnd))
        - Math.max(0, Math.min(rightStart, rightEnd));
      if (overlap > 0.025) coincidentRunPairs.push(Object.freeze([left.id, right.id]));
    }
  }
  const pipeRunIds = new Set(pipeRuns.map((run) => run.id));
  const downstreamValveRuns = pipeRuns.filter((run) => run.from === valveDownstreamNodeId);
  const pumpDischargeTeeZ = processPumpSpecs.map((pump) => pump.z);
  const hydraulicAdjacency = new Map([...pipeNodeMap.keys()].map((id) => [id, []]));
  const addHydraulicEdge = (from, to, kind, id, bidirectional = false) => {
    hydraulicAdjacency.get(from)?.push({ from, to, kind, id });
    if (bidirectional) hydraulicAdjacency.get(to)?.push({ from: to, to: from, kind, id });
  };
  pipeRuns.forEach((run) => addHydraulicEdge(run.from, run.to, 'run', run.id, true));
  pipeEquipmentLinks.forEach((link) => {
    (link.inletNodeIds ?? []).forEach((inletNodeId) => {
      (link.outletNodeIds ?? []).forEach((outletNodeId) => {
        addHydraulicEdge(inletNodeId, outletNodeId, 'equipment', link.id, false);
      });
    });
  });
  const findHydraulicPath = (sourceNodeId, sinkNodeId) => {
    const queue = [sourceNodeId];
    const visited = new Set(queue);
    const predecessor = new Map();
    while (queue.length) {
      const current = queue.shift();
      if (current === sinkNodeId) break;
      for (const edge of hydraulicAdjacency.get(current) ?? []) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        predecessor.set(edge.to, edge);
        queue.push(edge.to);
      }
    }
    if (!visited.has(sinkNodeId)) return null;
    const steps = [];
    let cursor = sinkNodeId;
    while (cursor !== sourceNodeId) {
      const edge = predecessor.get(cursor);
      if (!edge) return null;
      steps.push(edge);
      cursor = edge.from;
    }
    steps.reverse();
    return {
      sourceNodeId,
      sinkNodeId,
      nodeIds: [sourceNodeId, ...steps.map((step) => step.to)],
      runIds: steps.filter((step) => step.kind === 'run').map((step) => step.id),
      equipmentIds: steps.filter((step) => step.kind === 'equipment').map((step) => step.id),
    };
  };
  const sourcePathEvidence = PIPE_NETWORK_CONTRACT.sourceNodeIds.map((sourceNodeId) => {
    const path = findHydraulicPath(sourceNodeId, buriedCityConnectionNodeId);
    const runIds = path?.runIds ?? [];
    const equipmentIds = path?.equipmentIds ?? [];
    const nodeIds = path?.nodeIds ?? [];
    const pumpEquipmentId = PIPE_NETWORK_CONTRACT.pumpEquipmentIds.find((id) => equipmentIds.includes(id)) ?? null;
    return Object.freeze({
      sourceNodeId,
      sinkNodeId: buriedCityConnectionNodeId,
      reachable: Boolean(path),
      pumpEquipmentId,
      traversesPoisonInjection: nodeIds.includes(poisonInjectionNodeId),
      traversesValve: equipmentIds.includes(PIPE_NETWORK_CONTRACT.valveEquipmentId),
      traversesBackdoorDemolitionRun: runIds.includes('BACKDOOR_MAIN_PIPE'),
      nodeIds: Object.freeze(nodeIds),
      runIds: Object.freeze(runIds),
      equipmentIds: Object.freeze(equipmentIds),
    });
  });
  const everyTankReachesSinkThroughRequiredAssets = sourcePathEvidence.every((path) => (
    path.reachable
    && PIPE_NETWORK_CONTRACT.pumpEquipmentIds.includes(path.pumpEquipmentId)
    && path.traversesPoisonInjection
    && path.traversesValve
    && path.traversesBackdoorDemolitionRun
  ));
  const connectivity = Object.freeze({
    graphSemantics: Object.freeze({ pipeRuns: 'bidirectional', equipmentLinks: 'directed_inlet_to_outlet' }),
    sourceNodeIds: PIPE_NETWORK_CONTRACT.sourceNodeIds,
    sinkNodeId: buriedCityConnectionNodeId,
    tankOutletNodes: PIPE_NETWORK_CONTRACT.sourceNodeIds,
    pumpEquipmentIds: PIPE_NETWORK_CONTRACT.pumpEquipmentIds,
    dischargeHeaderNodeIds: Object.freeze(processPumpSpecs.map((pump) => pump.dischargeTeeId)),
    poisonInjectionNodeId,
    valveNodeIds: Object.freeze({ inlet: valveUpstreamNodeId, outlet: valveDownstreamNodeId }),
    backdoorOutletNodeId: buriedCityConnectionNodeId,
    danglingNodeIds: Object.freeze(danglingPipeNodeIds),
    unsupportedHorizontalRunIds: Object.freeze(unsupportedHorizontalRunIds),
    coincidentRunPairs: Object.freeze(coincidentRunPairs),
    sourcePaths: Object.freeze(sourcePathEvidence),
    allRunEndpointsTerminated: danglingPipeNodeIds.length === 0,
    allExposedHorizontalRunsSupported: unsupportedHorizontalRunIds.length === 0,
    noCoincidentRuns: coincidentRunPairs.length === 0,
    allWallPenetrationsCollared: PIPE_NETWORK_CONTRACT.wallPenetrationIds.every((id) => (
      pipeWallPenetrations.some((penetration) => penetration.id === id && penetration.collarId)
    )),
    pumpDischargePrecedesPoisonInjection: pumpDischargeTeeZ.every((z) => z > -24.5),
    poisonFeedsSingleInjectionPort: pipeRuns.filter((run) => run.to === poisonInjectionNodeId && run.id.startsWith('POISON_')).length === 1,
    cityMainPassesThroughValve: pipeRunIds.has('CITY_SUPPLY_MAIN')
      && pipeRunIds.has('CITY_SUPPLY_MAIN_DOWNSTREAM')
      && pipeEquipmentLinks.some((link) => link.id === PIPE_NETWORK_CONTRACT.valveEquipmentId),
    backdoorIsSoleDownstreamPath: downstreamValveRuns.length === 1
      && downstreamValveRuns[0].id === 'CITY_SUPPLY_MAIN_DOWNSTREAM',
    everyTankReachesSinkThroughPumpInjectionValveAndBackdoor: everyTankReachesSinkThroughRequiredAssets,
  });
  const freezePosition = (position) => Object.freeze(position.toArray());
  const pipeNetwork = Object.freeze({
    contract: PIPE_NETWORK_CONTRACT,
    revision: PIPE_NETWORK_CONTRACT.revision,
    nodes: Object.freeze([...pipeNodeMap.values()].map((node) => Object.freeze({
      ...node,
      position: freezePosition(node.position),
      degree: pipeNodeDegrees.get(node.id) ?? 0,
    }))),
    runs: Object.freeze(pipeRuns.map((run) => Object.freeze({
      id: run.id,
      from: run.from,
      to: run.to,
      start: freezePosition(run.start),
      end: freezePosition(run.end),
      radius: run.radius,
      horizontal: run.horizontal,
      supportKind: run.supportKind,
      supportIds: Object.freeze([...run.supportIds]),
      meshName: run.meshName,
    }))),
    fittings: Object.freeze(pipeFittings.map((fitting) => Object.freeze({ ...fitting }))),
    supports: Object.freeze(pipeSupports.map((support) => Object.freeze({
      ...support,
      position: freezePosition(support.position),
    }))),
    wallPenetrations: Object.freeze(pipeWallPenetrations.map((penetration) => Object.freeze({ ...penetration }))),
    equipmentLinks: Object.freeze(pipeEquipmentLinks.map((link) => Object.freeze({
      ...link,
      inletNodeIds: Object.freeze([...(link.inletNodeIds ?? [])]),
      outletNodeIds: Object.freeze([...(link.outletNodeIds ?? [])]),
    }))),
    hydraulicFlowPath: PIPE_NETWORK_CONTRACT.hydraulicFlowPath,
    connectivity,
  });

  const metadata = Object.freeze({
    revision: 'clearwater-connected-waterworks-v4',
    indoorLocationCount: 2,
    hostileCount: thermalScan.contactCount,
    authoredRosterCount: authoredRosterIds.length,
    rosterIsCompleteAtRecon: authoredRosterIds.length === thermalScan.contactCount,
    technicianSpawnIds: Object.freeze(['poison_technician', 'vault_technician']),
    allHostilesInsidePerimeter: Object.values(enemySpawns).flat().every((entry) => (
      entry.position.x > -30 && entry.position.x < 30
      && entry.position.z < 60 && entry.position.z > -112
    )),
    insertionRoute,
    facilityTopology,
    missionTargets,
    reconTargets,
    pipeNetwork,
    reinforcementSpawns,
    boundary,
    fenceContract,
  });

  // A clean, correctly oriented handle lets the intro own a Global Hawk model
  // and thermal pass without leaving an aircraft hovering during gameplay.
  // Object3D.lookAt faces a regular object's +Z axis along the path. The NASA
  // Global Hawk glTF uses that same converted forward axis.
  const drone = new THREE.Group();
  drone.name = 'GLOBAL_HAWK_INTRO_ANCHOR';
  drone.position.copy(thermalScan.flightStart);
  drone.rotation.set(0, 0, 0);
  drone.visible = false;
  drone.userData.introOnly = true;
  drone.userData.forwardAxis = '+Z';
  drone.userData.flightStart = thermalScan.flightStart.clone();
  drone.userData.flightEnd = thermalScan.flightEnd.clone();
  drone.userData.thermalFocus = thermalScan.facilityFocus.clone();
  root.add(drone);

  setPower(false);
  root.updateMatrixWorld(true);

  return {
    scene,
    spawn,
    killY: -2.5,
    colliders,
    floors,
    interactables,
    interactionAliases,
    getInteractable,
    facilityDoors,
    facilityTopology,
    missionTargets,
    reconTargets,
    pipeNetwork,
    reinforcementSpawns,
    authoredRosterIds,
    coverPoints,
    enemySpawns,
    thermalScan,
    insertionRoute,
    boundary,
    fenceContract,
    metadata,
    raycastMeshes,
    update,
    terrainHeight,
    getGroundHeight,
    groundHeightAt: getGroundHeight,
    segmentBlocked,
    raycastWorld,
    resolveEnemyMovement,
    resolveActorMovement,
    getCoverPoints,
    isCoverValid,
    setJammerDisabled,
    setPoisonNeutralized,
    setSupplyValveClosed,
    setBackdoorPipeDemolished,
    setPower,
    setLedgerTransmitted,
    beginFinale,
    finishMission,
    resetMission,
    drone,
    worldState,
  };
}

export default createWorld;
