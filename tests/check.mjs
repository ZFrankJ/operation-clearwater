import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MissionDirector, MISSION_TIMINGS, TECHNICIAN_IDS } from '../src/mission.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const passes = [];
const assert = (condition, message) => (condition ? passes : failures).push(message);

const manifest = JSON.parse(await readFile(join(root, 'assets/manifest.json'), 'utf8'));
const manifestPaths = new Set(manifest.assets.map((asset) => asset.path));
for (const asset of manifest.assets) {
  try {
    const info = await stat(join(root, asset.path));
    assert(info.size > 0, `asset has content: ${asset.path}`);
  } catch {
    failures.push(`missing asset: ${asset.path}`);
  }
}

const clearwaterKeyArtPaths = [
  'assets/images/clearwater-keyart.png',
  'assets/images/clearwater-ridge-keyart.png',
  'assets/images/clearwater-waterworks-keyart.png',
];
const clearwaterKeyArt = clearwaterKeyArtPaths.map((path) => manifest.assets.find((asset) => asset.path === path));
assert(
  manifest.project === 'CLEARWATER' && clearwaterKeyArt.every(Boolean) &&
    /current Operation Clearwater title and outcome key art/i.test(clearwaterKeyArt[2]?.role ?? '') &&
    !manifest.assets.some((asset) => /saltline|waterguard/i.test(asset.path)),
  'the CLEARWATER manifest declares all three renamed key-art files and selects the waterworks revision as current',
);
assert(
  clearwaterKeyArt.every((asset) =>
    /OpenAI image generation/i.test(asset?.source ?? '') && /project-original/i.test(asset?.license ?? '')),
  'all CLEARWATER key art retains generated-asset provenance',
);
const hawkAsset = manifest.assets.find((asset) => asset.path === 'assets/models/vehicles/global-hawk.glb');
assert(
  Boolean(hawkAsset) && /NASA/i.test(hawkAsset.source ?? '') && /NASA/i.test(hawkAsset.license ?? ''),
  'the packaged Global Hawk has explicit NASA provenance',
);
const flybyAudioAsset = manifest.assets.find((asset) => asset.path === 'assets/audio/jet-plane-flyby.mp3');
const flybyAudioInfo = await stat(join(root, 'assets/audio/jet-plane-flyby.mp3'));
assert(
  Boolean(flybyAudioAsset) && flybyAudioInfo.size > 300_000 &&
    /freesound\.org\/people\/qubodup\/sounds\/189446/i.test(flybyAudioAsset.source ?? '') &&
    /CC0-1\.0/i.test(flybyAudioAsset.license ?? ''),
  'the substantial local aircraft recording retains its CC0 source provenance',
);
const activeWeaponAssets = manifest.assets.filter((asset) => /active .*PBR/i.test(asset.role ?? '') && asset.path.startsWith('assets/models/weapons/'));
assert(
  activeWeaponAssets.length === 6 &&
    activeWeaponAssets.every((asset) => /OpenGameArt/i.test(asset.source ?? '') && /CC0-1\.0/i.test(asset.license ?? '')),
  'the active full-detail rifle and its five PBR channels retain CC0 online provenance',
);
const activeRifleInfo = await stat(join(root, 'assets/models/weapons/m4a1-pbr.fbx'));
const archivedRifleInfo = await stat(join(root, 'assets/models/weapons/m4a1.fbx'));
assert(
  activeRifleInfo.size >= 250_000 && activeRifleInfo.size >= archivedRifleInfo.size * 5,
  'the runtime rifle is the substantially richer upstream FBX rather than the archived low-detail fallback',
);
const expectedHandsPaths = [
  'assets/models/hands/military-male-04-arms.fbx',
  'assets/models/hands/sm005_body_color_acu.jpg',
  'assets/models/hands/sm005_body_normal.png',
  'assets/models/hands/sm005_body_specular.jpg',
];
const handsAssets = manifest.assets.filter((asset) => asset.path.startsWith('assets/models/hands/'));
assert(
  handsAssets.length === expectedHandsPaths.length &&
    expectedHandsPaths.every((path) => handsAssets.some((asset) => asset.path === path)) &&
    handsAssets.every((asset) => /github\.com\/microsoft\/Microsoft-Rocketbox/i.test(asset.source ?? '') && asset.license === 'MIT'),
  'the complete local first-person arm mesh and three texture maps retain Microsoft Rocketbox MIT provenance',
);
const handsFbxBytes = await readFile(join(root, expectedHandsPaths[0]));
assert(
  createHash('sha256').update(handsFbxBytes).digest('hex') ===
    '483b5c1d9c1cfd89db620832a66a3bffe4451524bb3f3362bda40f6345519276',
  'the packaged first-person FBX exactly matches the verified upstream skinned Military Male 04 asset',
);
const natureAssets = manifest.assets.filter((asset) => asset.path.startsWith('assets/nature/'));
assert(natureAssets.length >= 6, 'manifest declares a substantial local nature asset pack');
assert(
  natureAssets.length > 0 && natureAssets.every((asset) => /https:\/\/polyhaven\.com\/a\//i.test(asset.source ?? '')),
  'every declared nature asset links to its Poly Haven source page',
);
assert(
  natureAssets.length > 0 && natureAssets.every((asset) => /CC0(?:-1\.0)?/i.test(asset.license ?? '')),
  'every declared nature asset records its CC0 license',
);
const natureModels = natureAssets.filter((asset) => asset.path.endsWith('.gltf'));
assert(natureModels.length >= 4, 'nature pack includes several real glTF vegetation and rock models');
for (const asset of natureModels) {
  const gltf = JSON.parse(await readFile(join(root, asset.path), 'utf8'));
  const dependencyUris = [
    ...(gltf.buffers ?? []).map((entry) => entry.uri),
    ...(gltf.images ?? []).map((entry) => entry.uri),
  ].filter(Boolean);
  assert(dependencyUris.length >= 2, `nature model has mesh and PBR dependencies: ${asset.path}`);
  for (const uri of dependencyUris) {
    const isLocal = !/^(?:[a-z]+:|\/)/i.test(uri) && !uri.includes('..');
    assert(isLocal, `nature model dependency stays inside its asset folder: ${asset.path} -> ${uri}`);
    if (!isLocal) continue;
    try {
      const info = await stat(join(root, dirname(asset.path), decodeURIComponent(uri)));
      assert(info.size > 0, `nature model dependency has content: ${asset.path} -> ${uri}`);
    } catch {
      failures.push(`missing nature model dependency: ${asset.path} -> ${uri}`);
    }
  }
}

const html = await readFile(join(root, 'index.html'), 'utf8');
const styleSource = await readFile(join(root, 'src/style.css'), 'utf8');
const robotsSource = await readFile(join(root, 'robots.txt'), 'utf8');
const packageManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const readmeSource = await readFile(join(root, 'README.md'), 'utf8');
const serverSource = await readFile(join(root, 'server.mjs'), 'utf8');
const assetNotesSource = await readFile(join(root, 'licenses/ASSETS.md'), 'utf8');
const requiredIds = [
  'game-canvas', 'loading-screen', 'loading-bar', 'loading-status', 'start-screen', 'start-button',
  'quality-select', 'aim-select', 'difficulty-select', 'mute-toggle', 'hud', 'health-fill', 'health-value', 'armor-value', 'ammo-current',
  'ammo-reserve', 'aim-mode', 'objective-kicker', 'objective-text', 'objective-distance', 'location-label',
  'defense-timer', 'crosshair', 'hitmarker', 'subtitle', 'subtitle-speaker', 'subtitle-text', 'interact',
  'interact-label', 'interact-progress', 'toast-layer', 'damage-vignette', 'death-veil', 'pause-screen', 'resume-button',
  'restart-button', 'ending-screen', 'ending-stats', 'replay-button', 'thermal-overlay',
  'thermal-drone-label', 'thermal-scan-status', 'thermal-count-label', 'thermal-count',
  'thermal-sector', 'thermal-progress', 'ending-water-label', 'ending-water-value',
  'ending-supply-label', 'ending-supply-value'
];
for (const id of requiredIds) assert(html.includes(`id="${id}"`), `DOM contract: #${id}`);
assert(!/(?:src|href)=["']https?:\/\//.test(html), 'HTML has no runtime CDN dependency');
assert(
  /^User-agent:\s*\*\s*$[\s\S]*^Disallow:\s*\/\s*$[\s\S]*github\.com\/ZFrankJ\/operation-clearwater/m.test(robotsSource),
  'robots.txt blocks crawler access and identifies the public GitHub source repository',
);
assert(
  /['"]\.txt['"]:\s*['"]text\/plain; charset=utf-8['"]/.test(serverSource),
  'the offline server serves robots.txt with the standard text/plain media type',
);
assert(html.includes('three.module.min.js'), 'local Three.js import map is present');
assert(
  /<meta name=["']description["'] content=["']OPERATION CLEARWATER/.test(html) &&
    /<title>OPERATION CLEARWATER\s*[—-]\s*Ridgewatch Waterworks<\/title>/.test(html) &&
    /id=["']game-canvas["'][^>]*aria-label=["']OPERATION CLEARWATER 3D game viewport["']/.test(html) &&
    /class=["'][^"']*\bloading-screen\b[^"']*["'][\s\S]*?<h1>OPERATION CLEARWATER<\/h1>/.test(html) &&
    /id=["']game-title["'][^>]*aria-label=["']OPERATION CLEARWATER["'][\s\S]*?OPERATION[\s\S]*?CLEARWATER/.test(html) &&
    /class=["']operation-strip["'][\s\S]*?OPERATION CLEARWATER/.test(html) &&
    /class=["']location-card["'][\s\S]*?OPERATION CLEARWATER/.test(html) &&
    /<noscript>OPERATION CLEARWATER requires JavaScript and WebGL\.<\/noscript>/.test(html),
  'OPERATION CLEARWATER brands document metadata, loading, briefing, operation strip, HUD, canvas accessibility, and fallback copy',
);
assert(!/SALTLINE|WATERGUARD/i.test(html), 'no superseded SALTLINE or WATERGUARD branding remains in player-facing HTML');
assert(
  packageManifest.name === 'clearwater-fps' && /OPERATION CLEARWATER/.test(packageManifest.description ?? '') &&
    /^# OPERATION CLEARWATER/m.test(readmeSource) && /Open CLEARWATER\.command/.test(readmeSource) &&
    /OPERATION CLEARWATER is ready/.test(serverSource) && /CLEARWATER: file not found/.test(serverSource) &&
    /^# OPERATION CLEARWATER asset notes/m.test(assetNotesSource),
  'package metadata, README, local server, and asset documentation carry the CLEARWATER identity',
);
assert(
  !/SALTLINE|WATERGUARD/i.test(JSON.stringify(manifest)) &&
    !/SALTLINE|WATERGUARD/i.test(readmeSource) &&
    !/SALTLINE|WATERGUARD/i.test(serverSource) &&
    !/SALTLINE|WATERGUARD/i.test(assetNotesSource),
  'renamed project metadata and documentation contain no superseded brand copy',
);
assert(
  /terrorists in stolen guardian uniforms/i.test(html) &&
    /eighteen gunmen protect two technical specialists/i.test(html) &&
    /five-minute poison transfer/i.test(html) && /two and a half minutes/i.test(html) &&
    /stop whoever is operating the poison controls or isolate the injection machine/i.test(html) &&
    /another hostile can continue only by reaching the same controls/i.test(html) &&
    /if poison is released, close the municipal valve/i.test(html) &&
    /if both protections fail, demolish the marked backdoor main/i.test(html),
  'home briefing accounts for all 20 contacts and accurately explains the primary, valve, and pipe routes',
);
assert(
  /RMB\s*\/\s*X[\s\S]*?HOLD TO AIM/i.test(html) &&
    /id=["']aim-select["'][\s\S]*?value=["']2["'][\s\S]*?value=["']4["'][\s\S]*?value=["']8["']/.test(html) &&
    /2\s*\/\s*4\s*\/\s*8[\s\S]*?CHANGE AIM/i.test(html),
  'home controls retain selectable 2x, 4x, and 8x magnification and advertise direct in-game switching',
);
assert(
  /<kbd>C \/ CTRL<\/kbd><span>CROUCH \/ CRAWL<\/span>/.test(html),
  'home controls visibly document the C or Control crouch/crawl action',
);
assert(
  /id=["']loading-screen["'][^>]*class=["'][^"']*\bis-hidden\b/.test(html) &&
    /id=["']start-screen["'][^>]*class=["'][^"']*\bis-visible\b/.test(html) &&
    /id=["']start-button["'][^>]*data-ready=["']false["'][^>]*aria-busy=["']true["']/.test(html) &&
    /id=["']preload-status["']>STATUS: PRELOADING<\/span>/.test(html),
  'the briefing homepage is visible in the initial HTML before any 3D gameplay assets finish loading',
);
assert(
  /id=["']health-value["']>120<\/strong>/.test(html) &&
    /id=["']armor-pips["']>(?:<i><\/i>){6}<\/b><strong id=["']armor-value["']>120<\/strong>/.test(html) &&
    /\.armor-row b\s*\{[^}]*width:\s*150px/.test(styleSource) &&
    /\.armor-row b i\s*\{[^}]*flex:\s*1 1 0/.test(styleSource),
  'the default Normal HUD shows 120 vitality and plate with six scalable 25-point plate segments',
);
assert(
  !/operator-dossier|operator-portrait|VCS-4 SERVICE CARBINE/.test(html) &&
    /id=["']difficulty-select["'][\s\S]*?value=["']easy["'][\s\S]*?value=["']normal["'][\s\S]*?value=["']hard["'][\s\S]*?value=["']extreme["']/.test(html) &&
    /EASY\s*\/\s*FORGIVING[\s\S]*?value=["']normal["'] selected[\s\S]*?EXTREME\s*\/\s*CONCEALED VESTS/.test(html),
  'home removes the full player presentation while retaining all four compact difficulty controls',
);
assert(/id=["']thermal-overlay["'][\s\S]*?RQ-4 GLOBAL HAWK[\s\S]*?id=["']thermal-count["']/.test(html),
  'thermal reconnaissance DOM exposes the aircraft identity and live contact count');

const jsFiles = (await readdir(join(root, 'src'))).filter((name) => name.endsWith('.js'));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', join(root, 'src', file)], { encoding: 'utf8' });
  assert(result.status === 0, `syntax: src/${file}`);
  if (result.status !== 0) failures.push(result.stderr.trim());
  const source = await readFile(join(root, 'src', file), 'utf8');
  assert(!/from\s+["']https?:\/\//.test(source), `local imports only: src/${file}`);
  for (const match of source.matchAll(/new URL\(["']\.\.\/(assets\/[^"']+)["']/g)) {
    const declared = match[1].endsWith('/')
      ? [...manifestPaths].some((assetPath) => assetPath.startsWith(match[1]))
      : manifestPaths.has(match[1]);
    assert(declared, `runtime asset is declared: ${match[1]}`);
  }
}

const worldSource = await readFile(join(root, 'src/world.js'), 'utf8');

// The replacement scene is an authored, continuous landscape. Rendered
// terrain and collision share one height function, and nature comes from the
// local Poly Haven pack rather than random primitive generation.
const natureRuntimeRefs = [...worldSource.matchAll(/new URL\(['"]\.\.\/(assets\/nature\/[^'"]+)['"]/g)]
  .map((match) => match[1]);
assert(natureRuntimeRefs.length >= 12, 'world loads a broad local nature-and-ground asset set');
assert(
  natureRuntimeRefs.filter((path) => path.endsWith('.gltf')).length >= 6 &&
    natureRuntimeRefs.some((path) => path.includes('/surfaces/mud_forest/')) &&
    natureRuntimeRefs.some((path) => path.includes('/surfaces/dry_ground_rocks/')),
  'world uses real vegetation, rocks, moist soil, and service-aggregate assets',
);
const wetTerrainMaps = natureRuntimeRefs.filter((path) => path.includes('/surfaces/mud_forest/'));
assert(
  wetTerrainMaps.length === 4 &&
    ['diff', 'nor_gl', 'rough', 'ao'].every((channel) => wetTerrainMaps.some((path) => path.includes(`mud_forest_${channel}_1k.jpg`))) &&
    /URLS\.grass,\s*URLS\.grassNormal,\s*URLS\.grassRough,\s*URLS\.grassAO/.test(worldSource),
  'all four scanned mud-forest PBR channels are loaded by the active terrain texture job',
);
const materialsSection = worldSource.match(/const materials\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1] ?? '';
const wetTerrainMaterial = materialsSection.match(
  /grass:\s*new THREE\.MeshStandardMaterial\(\{([\s\S]*?)\n\s*\}\),/,
)?.[1] ?? '';
const wetTerrainColor = Number(wetTerrainMaterial.match(/color:\s*(0x[\da-f]+)/i)?.[1]);
const wetTerrainChannels = [wetTerrainColor >> 16, (wetTerrainColor >> 8) & 0xff, wetTerrainColor & 0xff];
assert(
  /name:\s*['"]Dark wet reservoir meadow soil['"]/.test(wetTerrainMaterial) &&
    /map:\s*grassMap/.test(wetTerrainMaterial) && /normalMap:\s*grassNormal/.test(wetTerrainMaterial) &&
    /roughnessMap:\s*grassRough/.test(wetTerrainMaterial) && /aoMap:\s*grassAO/.test(wetTerrainMaterial) &&
    Number.isFinite(wetTerrainColor) && Math.max(...wetTerrainChannels) <= 0x88 &&
    /const terrain\s*=\s*new THREE\.Mesh\(makeTerrainGeometry\(\),\s*materials\.grass\)/.test(worldSource),
  'continuous terrain actively uses a dark, wet, four-channel soil material',
);
assert(
  /export function terrainHeight\(x, z\)/.test(worldSource) &&
    /positions\.push\(x, terrainHeight\(x, z\), z\)/.test(worldSource) &&
    /heightAt:\s*\(x, z\) => terrainHeight\(x, z\)/.test(worldSource),
  'one deterministic height profile drives both terrain rendering and actor floors',
);
assert(!/Math\.random\(/.test(worldSource), 'landscape and nature placement contain no random initialization');
assert(
  /const pinePlacements\s*=\s*\[[\s\S]*?AUTHORED_PINE_/.test(worldSource) &&
    /const shrubPlacements\s*=\s*\[[\s\S]*?AUTHORED_SHRUB_/.test(worldSource) &&
    /const grassPlacements\s*=\s*\[[\s\S]*?AUTHORED_GRASS_/.test(worldSource),
  'trees, shrubs, and grass use fixed authored transform tables',
);
const objectiveFoundations = [...worldSource.matchAll(
  /slab\(['"]((?:TREATMENT_HALL|SUPPLY_VALVE_HOUSE)_FOUNDATION)['"]/g,
)].map((match) => match[1]);
const allNamedFoundations = [...worldSource.matchAll(/slab\(['"]([A-Z0-9_]+_FOUNDATION)['"]/g)]
  .map((match) => match[1]);
assert(
  objectiveFoundations.length === 2 && new Set(objectiveFoundations).size === 2 && allNamedFoundations.length === 2,
  'the compact facility has exactly two founded indoor objective buildings',
);
assert(
  /TREATMENT_HALL_NORTH_WEST[\s\S]*?TREATMENT_HALL_NORTH_EAST/.test(worldSource) &&
    /VALVE_HOUSE_NORTH_WEST[\s\S]*?VALVE_HOUSE_NORTH_EAST/.test(worldSource) &&
    /id:\s*['"]neutralize_poison['"][\s\S]*?id:\s*['"]close_supply_valve['"]/.test(worldSource),
  'both indoor buildings have split entry facades and their own physical objective',
);
assert(
  !/INDOOR_CLEAR_WATER_RESERVOIR|const indoorBasin|BASIN_PARAPET_/.test(worldSource) &&
    /containsOpenWater:\s*false/.test(worldSource) &&
    /const processTankSpecs\s*=\s*Object\.freeze\(\[[\s\S]*?PROCESS_TANK_A[\s\S]*?PROCESS_TANK_B[\s\S]*?PROCESS_TANK_C/.test(worldSource) &&
    /PROCESS_OVERHEAD_MANIFOLD/.test(worldSource) && /PROCESS_CITY_FEED_HEADER/.test(worldSource) &&
    /for \(const \[index, x, z\] of \[\[0,[^\]]+\], \[1,[^\]]+\]\]\)[\s\S]*?`PROCESS_PUMP_SKID_\$\{index \+ 1\}`/.test(worldSource),
  'the reservoir process hall is dry and densely equipped with three enclosed tanks, pump skids, and overhead manifolds',
);
assert(
  /const treatmentNorthDoor\s*=\s*openDoorFrame\(['"]TREATMENT_NORTH_ENTRY['"]/.test(worldSource) &&
    /const treatmentWestDoor\s*=\s*openDoorFrame\(['"]TREATMENT_WEST_SERVICE_DOOR['"]/.test(worldSource) &&
    /const valveNorthDoor\s*=\s*openDoorFrame\(['"]VALVE_HOUSE_NORTH_ENTRY['"]/.test(worldSource) &&
    /const valveBackdoor\s*=\s*openDoorFrame\(['"]VALVE_HOUSE_SOUTH_BACKDOOR['"]/.test(worldSource) &&
    /treatmentHall:\s*Object\.freeze\(\[treatmentNorthDoor, treatmentWestDoor\]\)/.test(worldSource) &&
    /supplyValveHouse:\s*Object\.freeze\(\[valveNorthDoor, valveBackdoor\]\)/.test(worldSource) &&
    /clearOpening:\s*true[\s\S]*?usable:\s*true|usable:\s*true[\s\S]*?clearOpening:\s*true/.test(worldSource),
  'both objective buildings expose two independently usable framed doorways, including the supply-vault backdoor',
);
assert(
  /VALVE_VAULT_PARTITION_WEST/.test(worldSource) && /VALVE_VAULT_PARTITION_EAST/.test(worldSource) &&
    /VALVE_VAULT_SECURITY_THRESHOLD/.test(worldSource) && /SECURED VALVE VAULT/.test(worldSource) &&
    /POISON_INJECTION_MACHINE_COLLIDER/.test(worldSource) && /BACKDOOR_MAIN_PIPE_COLLIDER/.test(worldSource) &&
    /id:\s*['"]demolish_backdoor_main_pipe['"]/.test(worldSource),
  'the secured valve vault, poison dosing machine, and reachable backdoor main-pipe demolition point are physical authored locations',
);
assert(
  /FACILITY_ENTRY_SIGN_MONUMENT/.test(worldSource) &&
    /facilityEntrySign\.userData\.signMount\s*=\s*['"]solid_masonry_monument['"]/.test(worldSource) &&
    /VALVE_HOUSE_SIGN[\s\S]*?new THREE\.Vector3\(3\.0,\s*3\.0,\s*-52\.74\)/.test(worldSource) &&
    /valveHouseSign\.userData\.occlusionClearance\s*=\s*['"]west_of_clean_water_header['"]/.test(worldSource) &&
    /VALVE_VAULT_SECURITY_SIGN[\s\S]*?new THREE\.Vector3\(-1\.74,\s*1\.3,\s*-64\.4\)[\s\S]*?Math\.PI \/ 2/.test(worldSource) &&
    /valveSecuritySign\.userData\.occlusionClearance\s*=\s*['"]clear_of_city_main['"]/.test(worldSource),
  'facility labels use solid mounting surfaces with explicit clearance from wire mesh and process pipes',
);
assert(
  /const facilityRouteWaypoints\s*=\s*Object\.freeze\(\[[\s\S]*?OFFSET_PROCESS_TO_VAULT_ROUTE/.test(worldSource) &&
    /EXTERIOR_GATE_DOGLEG/.test(worldSource) && /CROSS_YARD_SERVICE_LANE/.test(worldSource) &&
    /gateToTreatmentDoorLateralOffset:\s*Math\.abs\(-17\.5 - treatmentNorthDoor\.position\.x\)/.test(worldSource) &&
    /gateAndPrimaryDoorAligned:\s*false/.test(worldSource) && /directDoorToDoorAxis:\s*false/.test(worldSource),
  'the gate, process entry, cross-yard route, and valve-vault doors form an explicit offset dogleg rather than one firing axis',
);

// The compound stays physically fenced, but its north facade deliberately
// leaves a wide, collider-free infiltration opening instead of enclosing the
// player at spawn.
const northWestFence = worldSource.match(
  /fenceSegment\(['"]NORTH_PERIMETER_W['"],\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/,
);
const northEastFence = worldSource.match(
  /fenceSegment\(['"]NORTH_PERIMETER_E['"],\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/,
);
const westFence = worldSource.match(
  /fenceSegment\(['"]WEST_PERIMETER['"],\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/,
);
const eastFence = worldSource.match(
  /fenceSegment\(['"]EAST_PERIMETER['"],\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/,
);
const reservoirFence = worldSource.match(
  /fenceSegment\(['"]RESERVOIR_SAFETY_FENCE['"],\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/,
);
const infiltrationGap = Number(northEastFence?.[1]) - Number(northWestFence?.[3]);
const northGateCenter = northWestFence && northEastFence
  ? [
      (Number(northWestFence[3]) + Number(northEastFence[1])) * 0.5,
      (Number(northWestFence[4]) + Number(northEastFence[2])) * 0.5,
    ]
  : null;
assert(
  Boolean(northWestFence && northEastFence) &&
    Number(northWestFence[2]) === Number(northWestFence[4]) &&
    Number(northEastFence[2]) === Number(northEastFence[4]) && infiltrationGap >= 3,
  'north perimeter leaves a traversable player-width infiltration opening',
);
assert(!/NORTH_(?:ARRIVAL_)?GATE['"][\s\S]{0,100}?blocking:\s*true/.test(worldSource),
  'the authored infiltration opening is not closed by a hidden blocking gate');
assert(
  /RESERVOIR_PARAPET_BARRIER/.test(worldSource) &&
    /fenceSegment\(['"]RESERVOIR_SAFETY_FENCE['"]/.test(worldSource) &&
    /kind:\s*['"]reservoir_barrier['"]/.test(worldSource),
  'reservoir edge has continuous visible and actor-solid safety barriers',
);
const fencePoint = (match, offset) => match ? [Number(match[offset]), Number(match[offset + 1])] : null;
const sameFencePoint = (left, right) => Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
assert(
  sameFencePoint(fencePoint(westFence, 3), fencePoint(northWestFence, 1)) &&
    sameFencePoint(fencePoint(northEastFence, 3), fencePoint(eastFence, 1)) &&
    sameFencePoint(fencePoint(westFence, 1), fencePoint(reservoirFence, 1)) &&
    sameFencePoint(fencePoint(eastFence, 3), fencePoint(reservoirFence, 3)),
  'every non-gate perimeter span meets its neighbor at the exact same two-dimensional endpoint',
);
assert(
  /function fenceSegment\([\s\S]*?addCollider\([\s\S]*?blocking:\s*true/.test(worldSource),
  'every authored fence segment creates a blocking body collider',
);
const fenceSegmentSource = worldSource.match(
  /function fenceSegment\([\s\S]*?\n\s*return \{ panel, collider \};\n\s*\}/,
)?.[0] ?? '';
assert(
  /blocking:\s*true,\s*ballistic:\s*options\.ballistic \?\? false/.test(fenceSegmentSource) &&
    !/raycastMeshes\.push\(panel\)/.test(fenceSegmentSource) &&
    !/fenceSegment\([^;\n]*ballistic:\s*true/.test(worldSource),
  'chain-link blocks actors while its wire panel and barrier remain excluded from ballistics',
);
const chainTextureSource = worldSource.match(
  /function makeChainTexture\(\)\s*\{([\s\S]*?)\n\}/,
)?.[1] ?? '';
assert(
  /canvas\.width\s*=\s*512/.test(chainTextureSource) && /canvas\.height\s*=\s*512/.test(chainTextureSource) &&
    /const linkPitch\s*=\s*64/.test(chainTextureSource) &&
    /offset\s*\+=\s*linkPitch/.test(chainTextureSource) &&
    /\[10,\s*['"]rgba\(39,52,50,\.82\)['"]\][\s\S]*?\[4,\s*['"]rgba\(205,218,214,\.98\)['"]\]/.test(chainTextureSource) &&
    /texture\.generateMipmaps\s*=\s*false/.test(chainTextureSource) &&
    /texture\.minFilter\s*=\s*THREE\.LinearFilter/.test(chainTextureSource),
  'chain-link uses a high-contrast seamless 512px lattice whose 64px pitch divides the tile exactly',
);
assert(
  /name:\s*['"]Two-sided galvanized chain-link['"][\s\S]*?side:\s*THREE\.DoubleSide[\s\S]*?shadowSide:\s*THREE\.DoubleSide[\s\S]*?alphaToCoverage:\s*true/.test(fenceSegmentSource) &&
    /linePostCount\s*=\s*Math\.max\(1,\s*Math\.ceil\(length\s*\/\s*3\.2\)\)/.test(fenceSegmentSource) &&
    /_LINE_POST_\$\{index\}/.test(fenceSegmentSource) &&
    /_TOP_RAIL/.test(fenceSegmentSource) && /_BOTTOM_TENSION_WIRE/.test(fenceSegmentSource),
  'fence renders from both sides with closely spaced posts, a top rail, and a bottom tension wire',
);
assert(
  /const horizontalTiles\s*=\s*Math\.max\(1,\s*Math\.round\(length \/ 1\.28\)\)/.test(fenceSegmentSource) &&
    /const tileMeters\s*=\s*length \/ horizontalTiles/.test(fenceSegmentSource) &&
    /texture\.repeat\.set\(horizontalTiles,\s*height \/ tileMeters\)/.test(fenceSegmentSource) &&
    /textureTile:\s*Object\.freeze\(\{\s*sizePixels:\s*512,\s*latticePitchPixels:\s*64,\s*seamless:\s*true\s*\}\)[\s\S]*?wholeTileSpanPhase:\s*true/.test(worldSource),
  'every fence panel ends on a whole lattice tile so adjacent panels meet at the same diamond phase',
);
assert(
  /const terminalPosts\s*=\s*\[[\s\S]*?options\.startPost\s*!==\s*false[\s\S]*?options\.endPost\s*!==\s*false[\s\S]*?if \(!enabled\) continue/.test(fenceSegmentSource) &&
    /RESERVOIR_SAFETY_FENCE[\s\S]{0,220}?startPost:\s*false,\s*endPost:\s*false/.test(worldSource) &&
    /NORTH_PERIMETER_W[\s\S]{0,180}?startPost:\s*false,\s*endPost:\s*false/.test(worldSource) &&
    /NORTH_PERIMETER_E[\s\S]{0,180}?startPost:\s*false,\s*endPost:\s*false/.test(worldSource) &&
    /NORTH_GATE_POST_W[\s\S]*?NORTH_GATE_POST_E/.test(worldSource) &&
    /singleOwnerCornerAndGatePosts:\s*true/.test(worldSource),
  'shared corners and gate junctions have exactly one post owner, preventing doubled caps and flashing joins',
);
assert(
  /function raycastWorld\([\s\S]*?for \(const collider of colliders\)[\s\S]*?if \(collider\.ballistic === false\) continue;[\s\S]*?tmpRay\.intersectBox/.test(worldSource) &&
    /function segmentBlocked\([\s\S]*?const hit = raycastWorld\(/.test(worldSource) &&
    /function actorPositionClear\([\s\S]*?if \(collider\.blocking === false\) continue;/.test(worldSource),
  'world bullets and line-of-sight skip non-ballistic wire while movement still honors its blocking collider',
);
assert(
  /const ballisticSolid\s*=\s*assetName === ['"]boulder['"] \|\| assetName === ['"]rock['"]/.test(worldSource) &&
    /object\.userData\.ballisticPermeable\s*=\s*!stone/.test(worldSource) &&
    /blocking:\s*true,[\s\S]{0,100}?ballistic:\s*stone,[\s\S]{0,120}?mesh:\s*object/.test(worldSource) &&
    /rockPlacements\.forEach\([\s\S]*?kind:\s*['"]rock['"]/.test(worldSource),
  'trees and foliage are bullet-permeable while every authored rock remains physical rendered cover',
);
assert(
  /function addMeshCollider\(id, mesh, options = \{\}\)/.test(worldSource) &&
    /addMeshCollider\(`\$\{name\}_SOLID_COLLIDER`, mesh,[\s\S]*?blocking:\s*true,[\s\S]*?ballistic:\s*true/.test(worldSource) &&
    /const pipeRun[\s\S]*?const mesh = beamBetween\(name, start, end, radius, material\)/.test(worldSource),
  'all tubes, rack members, cradles and anchors register solid movement and ballistic geometry',
);
const reservoirLevel = Number(
  worldSource.match(/reservoir\.position\.set\(\s*-?[\d.]+\s*,\s*(-?[\d.]+)/)?.[1],
);
const killY = Number(worldSource.match(/killY:\s*(-?[\d.]+)/)?.[1]);
assert(
  Number.isFinite(reservoirLevel) && Number.isFinite(killY) && killY > reservoirLevel + 0.5,
  'fall reset threshold triggers safely above the reservoir water surface',
);

// Static spawn validation: the operative begins well outside the north fence
// and every disguised terrorist begins inside it, with no opening-frame spawn
// overlap or invisible drop.
const terrainBounds = Object.fromEntries(
  ['MIN_X', 'MAX_X', 'MIN_Z', 'MAX_Z'].map((suffix) => [
    suffix,
    Number(worldSource.match(new RegExp(`const TERRAIN_${suffix}\\s*=\\s*(-?[\\d.]+)`))?.[1]),
  ]),
);
assert(
  terrainBounds.MAX_X - terrainBounds.MIN_X >= 250 &&
    terrainBounds.MAX_Z - terrainBounds.MIN_Z >= 340,
  'the continuous terrain extends far beyond the facility in every direction',
);
const naturalBoundaryBoxes = [...worldSource.matchAll(
  /addCollider\(naturalBoundaryColliderIds\[\d+\],\s*\[([^\]]+)\],\s*\[([^\]]+)\],\s*\{\s*kind:\s*['"]natural_boundary['"],\s*blocking:\s*true,\s*ballistic:\s*true\s*\}\)/g,
)].map((match) => [...match[1].split(','), ...match[2].split(',')].map(Number));
const boundaryEnvelope = naturalBoundaryBoxes.reduce((bounds, box) => ({
  minX: Math.min(bounds.minX, box[0]), minZ: Math.min(bounds.minZ, box[2]),
  maxX: Math.max(bounds.maxX, box[3]), maxZ: Math.max(bounds.maxZ, box[5]),
}), { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
assert(
  naturalBoundaryBoxes.length === 4 &&
    boundaryEnvelope.minX - terrainBounds.MIN_X >= 18 &&
    terrainBounds.MAX_X - boundaryEnvelope.maxX >= 18 &&
    boundaryEnvelope.minZ - terrainBounds.MIN_Z >= 18 &&
    terrainBounds.MAX_Z - boundaryEnvelope.maxZ >= 18 &&
    /sideBoundary[\s\S]*?northBoundary[\s\S]*?farReservoirBank/.test(worldSource),
  'actor limits are buried inside raised natural boundaries with at least 18 metres of rendered land behind them',
);
assert(
  /const boundaryPines\s*=\s*Object\.freeze\(\[[\s\S]*?BOUNDARY_RIDGE_PINE_/.test(worldSource) &&
    /object\.position\.set\(x, terrainHeight\(x, z\) - [\d.]+, z\)[\s\S]*?object\.userData\.terrainSupported\s*=\s*true/.test(worldSource) &&
    /dummy\.position\.set\(candidate\.x, terrainHeight\(candidate\.x, candidate\.z\) - [\d.]+, candidate\.z\)[\s\S]*?field\.userData\.terrainSupported\s*=\s*true/.test(worldSource),
  'trees, props, and instanced meadow vegetation explicitly inherit the terrain height instead of floating beyond it',
);
const enemySpawnSection = worldSource.match(
  /const enemySpawns\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\s*\}\);/,
)?.[1] ?? '';
const enemyFeet = [...enemySpawnSection.matchAll(
  /position:\s*new THREE\.Vector3\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g,
)].map((match) => match.slice(1).map(Number));
const numericPlayerSpawn = worldSource.match(
  /const spawn\s*=\s*new THREE\.Vector3\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/,
)?.slice(1).map(Number);
const terrainPlayerSpawnMatch = worldSource.match(
  /const spawn\s*=\s*new THREE\.Vector3\(\s*(-?[\d.]+)\s*,\s*terrainHeight\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\+\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/,
);
const terrainPlayerSpawn = terrainPlayerSpawnMatch
  ? [Number(terrainPlayerSpawnMatch[1]), Number(terrainPlayerSpawnMatch[4]), Number(terrainPlayerSpawnMatch[5])]
  : null;
const playerSpawn = terrainPlayerSpawn ?? numericPlayerSpawn;
const playerSpawnUsesGround = Boolean(
  terrainPlayerSpawnMatch &&
  Number(terrainPlayerSpawnMatch[1]) === Number(terrainPlayerSpawnMatch[2]) &&
  Number(terrainPlayerSpawnMatch[3]) === Number(terrainPlayerSpawnMatch[5]) &&
  Number(terrainPlayerSpawnMatch[4]) >= 0.05 && Number(terrainPlayerSpawnMatch[4]) <= 0.12,
);
const allFeet = [...enemyFeet];
assert(enemyFeet.length >= 15 && Boolean(playerSpawn), 'authored player and encounter spawn coordinates are inspectable');
assert(
  allFeet.every(([x, y, z]) =>
    x > terrainBounds.MIN_X && x < terrainBounds.MAX_X &&
    z > terrainBounds.MIN_Z && z < terrainBounds.MAX_Z && y >= 0 && y <= 0.12) &&
    playerSpawn[0] > terrainBounds.MIN_X && playerSpawn[0] < terrainBounds.MAX_X &&
    playerSpawn[2] > terrainBounds.MIN_Z && playerSpawn[2] < terrainBounds.MAX_Z &&
    (playerSpawnUsesGround || (numericPlayerSpawn?.[1] >= 0 && numericPlayerSpawn?.[1] <= 0.12)),
  'all actor spawns sit on the continuous terrain floor at feet height',
);
const nearestEnemyAtInsertion = playerSpawn
  ? Math.min(...enemyFeet.map(([x, , z]) => Math.hypot(x - playerSpawn[0], z - playerSpawn[2])))
  : 0;
assert(
  Boolean(playerSpawn) && playerSpawn[2] > Number(northWestFence?.[2]) + 40 &&
    Math.abs(playerSpawn[0]) >= 30 &&
    enemyFeet.every(([x, , z]) => Math.abs(x) < 30 && z < Number(northWestFence?.[2])) &&
    nearestEnemyAtInsertion >= 50,
  'player inserts off the front-gate axis, outside the perimeter, and at least 50 metres from every hostile',
);

const parseInsertionCoverSpecs = (name) => {
  const section = worldSource.match(
    new RegExp(`const ${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\n\\s*\\]\\);`),
  )?.[1] ?? '';
  return [...section.matchAll(
    /id:\s*['"]([^'"]+)['"],\s*x:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+),\s*scale:\s*([\d.]+)/g,
  )].map((match) => ({ id: match[1], x: Number(match[2]), z: Number(match[3]), scale: Number(match[4]) }));
};
const insertionBoulders = parseInsertionCoverSpecs('insertionCoverSpecs');
const insertionRocks = parseInsertionCoverSpecs('insertionRockSpecs');
const insertionObstacles = [...insertionBoulders, ...insertionRocks];
assert(
  insertionBoulders.length >= 4 && insertionObstacles.length >= 7 &&
    /insertionCoverSpecs\.forEach\([\s\S]*?kind:\s*['"]insertion_cover['"]/.test(worldSource) &&
    /insertionRockSpecs\.forEach\([\s\S]*?kind:\s*['"]insertion_cover['"]/.test(worldSource) &&
    /const stone\s*=\s*assetName === ['"]boulder['"] \|\| assetName === ['"]rock['"]/.test(worldSource) &&
    /if \(collider\)[\s\S]*?addCollider\([\s\S]*?blocking:\s*true,[\s\S]*?ballistic:\s*stone/.test(worldSource),
  'the exterior insertion has at least seven substantial, body-solid and ballistic cover obstacles',
);
const orderedBoulderChain = [...insertionBoulders].sort((a, b) => b.z - a.z);
assert(
  Boolean(playerSpawn) && orderedBoulderChain.length >= 4 &&
    Math.hypot(orderedBoulderChain[0].x - playerSpawn[0], orderedBoulderChain[0].z - playerSpawn[2]) <= 18 &&
    orderedBoulderChain.every((cover, index) => index === 0 ||
      (cover.z < orderedBoulderChain[index - 1].z && cover.x > orderedBoulderChain[index - 1].x)) &&
    Math.hypot(orderedBoulderChain.at(-1).x, orderedBoulderChain.at(-1).z - Number(northWestFence?.[2])) <= 24,
  'cover forms a staggered concealed chain from the northwest spawn to the gate shoulder',
);
const insertionRouteSection = worldSource.match(
  /const insertionRouteWaypoints\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s*\.map\(/,
)?.[1] ?? '';
const insertionRoutePoints = [...insertionRouteSection.matchAll(
  /\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g,
)].map((match) => [Number(match[1]), Number(match[2])]);
const insertionXSteps = insertionRoutePoints.slice(1)
  .map((point, index) => point[0] - insertionRoutePoints[index][0]);
assert(
  insertionRoutePoints.length >= 12 && Boolean(playerSpawn) &&
    insertionRoutePoints[0][0] === playerSpawn[0] && insertionRoutePoints[0][1] === playerSpawn[2] &&
    Boolean(northGateCenter) &&
    insertionRoutePoints.at(-1)[0] === northGateCenter[0] && insertionRoutePoints.at(-1)[1] === northGateCenter[1] &&
    insertionRoutePoints.every(([x, z]) =>
      x > terrainBounds.MIN_X && x < terrainBounds.MAX_X && z > terrainBounds.MIN_Z && z < terrainBounds.MAX_Z) &&
    insertionXSteps.some((delta) => delta > 1) && insertionXSteps.some((delta) => delta < -1) &&
    /const insertionRoute\s*=\s*Object\.freeze\(\{[\s\S]*?id:\s*['"]NORTHWEST_CONCEALED_APPROACH['"][\s\S]*?waypoints:\s*insertionRouteWaypoints[\s\S]*?initialLineOfSightBlocked:\s*segmentBlocked/.test(worldSource) &&
    /return \{[\s\S]*?insertionRoute,[\s\S]*?boundary,[\s\S]*?fenceContract,/.test(worldSource),
  'an exported, ground-supported northwest route bends from concealed spawn to the open gate',
);
const insertionCoverBoxes = insertionObstacles.map((cover) => {
  const radius = cover.id.includes('BOULDER') ? 1.2 * cover.scale : 0.76 * cover.scale;
  return { minX: cover.x - radius, maxX: cover.x + radius, minZ: cover.z - radius, maxZ: cover.z + radius };
});
const actorRadius = 0.34;
const pointClearOfInsertionCover = (x, z) => insertionCoverBoxes.every((box) => {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return dx * dx + dz * dz >= actorRadius * actorRadius;
});
const routeIsTraversable = insertionRoutePoints.slice(1).every((end, index) => {
  const start = insertionRoutePoints[index];
  const samples = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.15));
  return Array.from({ length: samples + 1 }, (_, sample) => sample / samples).every((t) =>
    pointClearOfInsertionCover(
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
    ));
});
assert(routeIsTraversable, 'the authored insertion route clears every cover collider by a full player radius');
const nearestEnemyPosition = playerSpawn
  ? enemyFeet.reduce((nearest, enemy) => (
    !nearest || Math.hypot(enemy[0] - playerSpawn[0], enemy[2] - playerSpawn[2]) < nearest.distance
      ? { point: [enemy[0], enemy[2]], distance: Math.hypot(enemy[0] - playerSpawn[0], enemy[2] - playerSpawn[2]) }
      : nearest
  ), null)?.point
  : null;
const initialSightCrossesCover = Boolean(playerSpawn && nearestEnemyPosition) && Array.from({ length: 401 }, (_, index) => index / 400)
  .some((t) => insertionCoverBoxes.some((box) => {
    const x = playerSpawn[0] + (nearestEnemyPosition[0] - playerSpawn[0]) * t;
    const z = playerSpawn[2] + (nearestEnemyPosition[1] - playerSpawn[2]) * t;
    return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
  }));
assert(initialSightCrossesCover, 'natural cover physically interrupts the opening line from the nearest guard to spawn');

const grassSection = worldSource.match(/const grassPlacements\s*=\s*\[([\s\S]*?)\n\s*\];/)?.[1] ?? '';
const grassPoints = [...grassSection.matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)]
  .map((match) => [Number(match[1]), Number(match[2])]);
const exteriorGrass = grassPoints.filter(([x, z]) => z >= 60 || Math.abs(x) >= 30);
const maintainedInteriorGrass = grassPoints.filter(([x, z]) => z < 60 && z > -112 && Math.abs(x) < 30);
assert(
  grassPoints.length === 48 && exteriorGrass.length === grassPoints.length && maintainedInteriorGrass.length === 0,
  'all 48 individually modeled grass accents remain in the unmanaged exterior with none on the maintained apron',
);
const exteriorGrassFieldSource = worldSource.match(
  /function buildExteriorGrassField\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*const pinePlacements/,
)?.[1] ?? '';
const grassZoneTargets = [...exteriorGrassFieldSource.matchAll(/targetCount:\s*(\d+)/g)].map((match) => Number(match[1]));
assert(
  grassZoneTargets.length === 3 && grassZoneTargets.reduce((sum, count) => sum + count, 0) === 6300 &&
    /new THREE\.InstancedMesh\([\s\S]*?AUTHORED_EXTERIOR_GRASS_FIELD_/.test(exteriorGrassFieldSource) &&
    /authoredBounds\s*=\s*Object\.freeze\(\{\s*minX:\s*-82\.5,\s*maxX:\s*82\.5,\s*minZ:\s*-108\.5,\s*maxZ:\s*133/.test(exteriorGrassFieldSource) &&
    /maintainedInteriorFieldClumps:\s*0/.test(worldSource),
  'the 6,300-clump exterior field stays on supported land with broad margins and a strictly empty maintained interior',
);
assert(
  /const hashUnit\s*=/.test(exteriorGrassFieldSource) &&
    /zone\.spacing\s*\*\s*0\.98/.test(exteriorGrassFieldSource) &&
    /priority:\s*hashUnit/.test(exteriorGrassFieldSource) &&
    /candidateZones\[zone\.index\]\.sort\(\(a, b\)\s*=>\s*a\.priority - b\.priority\)/.test(exteriorGrassFieldSource) &&
    /const spatial\s*=\s*new Map\(\)/.test(exteriorGrassFieldSource) &&
    /minimum\s*=\s*Math\.max\(candidate\.separation, neighbour\.separation\)/.test(exteriorGrassFieldSource) &&
    /exteriorGrassDistribution\s*=\s*['"]deterministic_blue_noise_moisture_clusters['"]/.test(exteriorGrassFieldSource) &&
    !/Math\.sin\(authoredRow|Math\.sin\(authoredColumn/.test(exteriorGrassFieldSource),
  'full-cell deterministic jitter, shuffled priority, moisture clusters, and spatial separation suppress visible grass rows without runtime randomness',
);

const authoredNumericArrayBody = (name) => worldSource.match(
  new RegExp(`const ${name}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\);`),
)?.[1] ?? worldSource.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`))?.[1] ?? '';
const authoredXZPoints = (name) => [...authoredNumericArrayBody(name).matchAll(
  /\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g,
)].map((match) => [Number(match[1]), Number(match[2])]);
const treePoints = ['pinePlacements', 'insertionPines', 'boundaryPines', 'outerWoodlandPines']
  .flatMap(authoredXZPoints);
const naturalRockPoints = ['boulderPlacements', 'outerBoulderPlacements', 'rockPlacements', 'outerRockPlacements']
  .flatMap(authoredXZPoints);
const allRockPoints = [
  ...naturalRockPoints,
  ...insertionBoulders.map(({ x, z }) => [x, z]),
  ...insertionRocks.map(({ x, z }) => [x, z]),
];
const nearestNeighborStats = (points) => {
  const distances = points.map(([x, z], index) => Math.min(...points.map(([otherX, otherZ], otherIndex) => (
    index === otherIndex ? Infinity : Math.hypot(x - otherX, z - otherZ)
  ))));
  const mean = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
  const deviation = Math.sqrt(
    distances.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, distances.length),
  );
  return {
    variation: deviation / Math.max(1e-6, mean),
    uniqueRoundedDistances: new Set(distances.map((value) => value.toFixed(2))).size,
  };
};
const treeDistribution = nearestNeighborStats(treePoints);
const rockDistribution = nearestNeighborStats(allRockPoints);
assert(
  treePoints.length === 77 && allRockPoints.length === 54 &&
    authoredXZPoints('outerWoodlandPines').length === 23 &&
    authoredXZPoints('outerBoulderPlacements').length === 12 &&
    authoredXZPoints('outerRockPlacements').length === 22 &&
    /authoredExteriorTrees:\s*root\.userData\.authoredExteriorTreeCount/.test(worldSource) &&
    /authoredExteriorRocks:\s*root\.userData\.authoredExteriorRockCount/.test(worldSource),
  'the authored outskirts expose the complete expanded inventory of 77 trees and 54 rocks',
);
assert(
  treePoints.every(([x, z]) => Math.abs(x) >= 30 || z >= 60) &&
    allRockPoints.every(([x, z]) => Math.abs(x) >= 30 || z >= 60) &&
    treeDistribution.variation >= 0.25 && treeDistribution.uniqueRoundedDistances >= 35 &&
    rockDistribution.variation >= 0.3 && rockDistribution.uniqueRoundedDistances >= 28,
  'tree and rock cover stays outside the maintained compound and has diverse nearest-neighbor spacing instead of mirrored grid rows',
);

// World-level substepping plus axis-separated probes provide the movement API
// consumed by guards, preventing tunnelling while preserving wall sliding.
assert(
  /function resolveActorMovement\(positionValue, deltaValue, radius/.test(worldSource) &&
    /Math\.ceil\(distance \/ Math\.max/.test(worldSource) &&
    /actorPositionClear\(xCandidate, radius\)/.test(worldSource) &&
    /actorPositionClear\(zCandidate, radius\)/.test(worldSource),
  'world resolves actor movement with radius-aware substeps and axis sliding',
);
assert(
  /function resolveEnemyMovement\(position, delta, radius[\s\S]*?return resolveActorMovement\(position, delta, radius\)/.test(worldSource) &&
    /return \{[\s\S]*?resolveEnemyMovement,[\s\S]*?resolveActorMovement,/.test(worldSource),
  'world exports both enemy and generic actor movement resolvers',
);

assert(
  /const thermalScan\s*=\s*Object\.freeze\(\{[\s\S]*?contactCount:\s*Object\.values\(enemySpawns\)[\s\S]*?posts:/.test(worldSource) &&
    /drone\.name\s*=\s*['"]GLOBAL_HAWK_INTRO_ANCHOR['"][\s\S]*?drone\.rotation\.set\(0,\s*0,\s*0\)[\s\S]*?drone\.userData\.forwardAxis\s*=\s*['"]\+Z['"]/.test(worldSource) &&
    /return \{[\s\S]*?thermalScan,[\s\S]*?drone,/.test(worldSource),
  'world exports an enemy-derived thermal manifest and a level, north-to-south Global Hawk intro anchor',
);
const enemiesSource = await readFile(join(root, 'src/enemies.js'), 'utf8');
const mainSource = await readFile(join(root, 'src/main.js'), 'utf8');
const weaponSource = await readFile(join(root, 'src/weapon.js'), 'utf8');
const handsSource = await readFile(join(root, 'src/first-person-hands.js'), 'utf8');
const difficultySource = await readFile(join(root, 'src/difficulty.js'), 'utf8');
const missionSource = await readFile(join(root, 'src/mission.js'), 'utf8');
const playerSource = await readFile(join(root, 'src/player.js'), 'utf8');
const audioSource = await readFile(join(root, 'src/audio.js'), 'utf8');

assert(
  /this\.radius\s*=\s*0\.41/.test(playerSource) &&
    /const BODY_RADIUS\s*=\s*0\.39/.test(enemiesSource) &&
    /const BODY_SKIN\s*=\s*0\.04/.test(enemiesSource) &&
    /BODY_RADIUS \+ BODY_SKIN, enemy/.test(enemiesSource) &&
    /actorPositionClear\(position, radius = 0\.41/.test(worldSource),
  'living player and enemy capsules retain enough wall clearance for visible shoulders and sleeves',
);
assert(
  /_updateWallClearance\(activeDt \|\| dt\)/.test(weaponSource) &&
    /this\.wallPosition\s*=\s*new THREE\.Vector3\(0\.18,\s*-0\.185,\s*0\.2\)/.test(weaponSource) &&
    /this\.wallRotation\s*=\s*new THREE\.Euler\(-0\.055,\s*0,\s*-0\.035,\s*['"]YXZ['"]\)/.test(weaponSource) &&
    /target\.lerp\(this\.wallPosition, this\.wallBlend\)/.test(weaponSource) &&
    !/this\.wallBlend < 0\.34/.test(weaponSource) &&
    /_syncViewmodelVisibility\(\)[\s\S]*?this\.viewRoot\.visible = true[\s\S]*?this\.hands\?\.setEnabled\(true\)/.test(weaponSource) &&
    /_updateWeaponWallClearance\(enemy, dt\)/.test(enemiesSource) &&
    /WEAPON_WALL_RETRACT \* enemy\.weaponWallBlend/.test(enemiesSource) &&
    !/mount\.rotation\.y \+= enemy\.avoidanceSide/.test(enemiesSource),
  'player and enemy rifles retract straight back without folding through the body or disabling honest cover fire',
);
assert(
  /const poseAds\s*=\s*this\.reloading \? 0 : this\.ads/.test(weaponSource) &&
    /const poseSprint\s*=\s*this\.reloading \? 0 : this\.sprintBlend/.test(weaponSource) &&
    /this\._poseTargetEuler\.set\([\s\S]*?MathUtils\.lerp\(functionalPitch, this\.wallRotation\.x, this\.wallBlend\)[\s\S]*?MathUtils\.lerp\(functionalYaw, this\.wallRotation\.y, this\.wallBlend\)[\s\S]*?MathUtils\.lerp\(functionalRoll, this\.wallRotation\.z, this\.wallBlend\)/.test(weaponSource) &&
    /this\._poseTargetQuaternion\.setFromEuler\(this\._poseTargetEuler\)/.test(weaponSource) &&
    /this\.viewRoot\.quaternion\.slerp\(this\._poseTargetQuaternion, turnResponse\)/.test(weaponSource) &&
    /angleTo\(this\._poseTargetQuaternion\) <= 1e-4[\s\S]*?quaternion\.copy\(this\._poseTargetQuaternion\)/.test(weaponSource) &&
    /posePositionError:\s*this\.viewRoot\.position\.distanceTo\(this\._poseTargetPosition\)/.test(weaponSource) &&
    /poseAngularError:\s*this\.viewRoot\.quaternion\.angleTo\(this\._poseTargetQuaternion\)/.test(weaponSource),
  'mixed reload, ADS, sprint, and clearance inputs resolve to one quaternion target and snap exactly home',
);
assert(
  /aircraftTakeoff\(\)/.test(audioSource) && /aircraftFlyby\(progress = 0\)/.test(audioSource) &&
    /aircraftStop\(fadeSeconds = 0\.7\)/.test(audioSource) &&
    /voice\(speaker, text, options = \{\}\)/.test(audioSource) &&
    /enemyAlert\(\)/.test(audioSource) && /death\(\)/.test(audioSource) &&
    /failure\(\)/.test(audioSource) && /success\(\)/.test(audioSource) &&
    /audio\.aircraftTakeoff\(\)/.test(mainSource) &&
    /function updateFlyby\(time\)[\s\S]*?audio\.aircraftFlyby\(t\)/.test(mainSource) &&
    /if \(next !== ['"]flyby['"]\) audio\.aircraftStop\(0\.72\)/.test(mainSource) &&
    /qaAudioState = JSON\.stringify\(audio\.getState\(\)\)/.test(mainSource) &&
    /aircraftActive:\s*Boolean\(this\.aircraftNodes\)/.test(audioSource) &&
    /AIRCRAFT_SAMPLE_URL[\s\S]*?assets\/audio\/jet-plane-flyby\.mp3/.test(audioSource) &&
    /await this\._prepareAircraftSample\(\)/.test(audioSource) &&
    /sampleSource\.buffer = this\.aircraftSampleBuffer/.test(audioSource) &&
    /sampleSource\.playbackRate\.value = 1\.18/.test(audioSource) &&
    /aircraftSampleReady:\s*Boolean\(this\.aircraftSampleBuffer\)/.test(audioSource) &&
    /aircraftSampleActive:\s*Boolean\(this\.aircraftNodes\?\.sampleSource\)/.test(audioSource) &&
    /whooshGain\.gain\.value = 0\.052/.test(audioSource) &&
    /bus\.gain\.setTargetAtTime\(0\.88 \+ pass \* 0\.28/.test(audioSource) &&
    /function presentRadioLine\(line\)[\s\S]*?audio\.voice\(line\.speaker, line\.text\)/.test(mainSource) &&
    /onRadio:[\s\S]*?reconActive[\s\S]*?deferReconRadio\(line\)[\s\S]*?presentRadioLine\(line\)/.test(mainSource) &&
    /onAlert:[\s\S]*?audio\.enemyAlert\(\)/.test(mainSource) &&
    /onDeath:[\s\S]*?audio\.death\(\)/.test(mainSource) &&
    /beginHardFailure[\s\S]*?audio\.failure\(\)/.test(mainSource) &&
    /beginEnding[\s\S]*?audio\.ending\(\)/.test(mainSource),
  'recon launch uses a local real Doppler recording with a restrained positional UAV bed while all mission audio remains wired',
);
assert(
  /speaker:\s*['"]MAJOR REYES['"]/.test(missionSource) && !/speaker:\s*['"]LEILA['"]/.test(missionSource) &&
    /speaker:\s*['"]HAWK SEVEN AIRCREW['"][\s\S]*?Clearwater, Hawk Seven\. We are on station\. Starting the infrared sweep now\./.test(missionSource) &&
    !/speaker:\s*['"]GLOBAL HAWK 7['"]/.test(missionSource) &&
    /const officer = \/MAJOR\|OFFICER\|RESPONSE\//.test(audioSource) &&
    /const voiceSpeed = 1\.5/.test(audioSource) &&
    /utterance\.rate = voiceSpeed/.test(audioSource) &&
    !/const baseRate =/.test(audioSource) &&
    /utterance\.pitch = [\s\S]*?officer \? 0\.82[\s\S]*?HAWK SEVEN\|AIRCREW[\s\S]*?0\.94/.test(audioSource) &&
    /Alex[\s\S]*?Daniel[\s\S]*?Google UK English Male/.test(audioSource) &&
    /Every voiced role intentionally uses the male pool, including Mara/.test(audioSource) &&
    !/femalePreference/.test(audioSource) &&
    /utterance\.voice = selectedVoice/.test(audioSource),
  'every role, including the explicitly human Hawk Seven aircrew, uses the 1.5x faster natural English male voice pool',
);
assert(
  /this\.checkpointYaw = this\.yaw/.test(playerSource) &&
    /this\.checkpointPitch = this\.pitch/.test(playerSource) &&
    /setCheckpoint\(position = this\.position, orientation = \{\}\)/.test(playerSource) &&
    /this\.checkpointYaw = numberOr\(orientation\.yaw, this\.yaw\)/.test(playerSource) &&
    /this\.yaw = numberOr\(options\.yaw, this\.checkpointYaw\)/.test(playerSource) &&
    /this\.pitch = THREE\.MathUtils\.clamp\(numberOr\(options\.pitch, this\.checkpointPitch\)/.test(playerSource) &&
    /function factoryFacingFrom\(position = player\?\.position\)/.test(mainSource) &&
    /setCheckpoint\?\.\(position, factoryFacingFrom\(position\)\)/.test(mainSource),
  'checkpoint respawns restore a recorded factory-facing yaw and pitch instead of the death direction',
);
assert(
  /resetForRespawn\(\)[\s\S]*?if \(this\.reloading\) this\._cancelReload\(\)[\s\S]*?if \(this\.ammo <= 0 && this\.reserve > 0\)[\s\S]*?this\.ammo = loaded[\s\S]*?this\.reserve -= loaded[\s\S]*?this\.boltTimer = 0[\s\S]*?this\._restoreReloadParts\(\)[\s\S]*?this\._emitAmmo\(\)/.test(weaponSource) &&
    /onDeath:[\s\S]*?player\.reset\(\);[\s\S]*?weapon\?\.resetForRespawn\?\.\(\);[\s\S]*?weapon\?\.setEnabled\?\.\(true\)/.test(mainSource) &&
    /const testDeathReload = testMode && params\.get\(['"]deathReload['"]\) === ['"]1['"]/.test(mainSource) &&
    /if \(testDeathReload\)[\s\S]*?weapon\.ammo = 0[\s\S]*?weapon\.reload\(\)[\s\S]*?if \(testPlayerDeath\) player\.applyDamage/.test(mainSource) &&
    /respawnRecoveries:\s*this\.respawnRecoveries/.test(weaponSource) &&
    /lastRespawnRecovery:\s*this\.lastRespawnRecovery/.test(weaponSource),
  'death during an empty reload respawns with a physically restored, chambered magazine and an observable recovery record',
);
assert(
  /let deferredReconRadioLine = null/.test(mainSource) &&
    /function scheduleDeferredReconRadio\(delayMs = 1000\)/.test(mainSource) &&
    /if \(next === ['"]thermal['"]\) scheduleDeferredReconRadio\(1000\)/.test(mainSource) &&
    /audio\.aircraftStop\(0\.72\)[\s\S]*?scheduleDeferredReconRadio\(1000\)/.test(mainSource) &&
    /function clearDeferredReconRadio\(\)[\s\S]*?clearTimeout\(deferredReconRadioTimer\)/.test(mainSource) &&
    /function cleanupReconPresentation\(\)[\s\S]*?clearDeferredReconRadio\(\)/.test(mainSource),
  'the opening completes its engine fade and a clean silence gap before radio speech begins in the thermal phase',
);
assert(
  /death\(\) \{[\s\S]*?this\.deathSerial \+= 1[\s\S]*?type:\s*['"]death['"][\s\S]*?172, 0\.48, 0\.24[\s\S]*?frequency:\s*690[\s\S]*?1280, 1\.85, 0\.07/.test(audioSource) &&
    /deathSerial:\s*this\.deathSerial/.test(audioSource) &&
    /onDeath:[\s\S]*?audio\.death\(\)/.test(mainSource),
  'player death triggers a loud vocal-like fall, impact, heartbeat, and ringing tail before the eyelid close completes',
);
assert(
  /stopVoices\(\)\s*\{[\s\S]*?speechSynthesis\?\.cancel\?\.\(\)[\s\S]*?this\.activeVoices\.clear\(\)/.test(audioSource) &&
    /beginHardFailure[\s\S]*?audio\.stopVoices\(\)[\s\S]*?audio\.failure\(\)/.test(mainSource) &&
    /beginEnding[\s\S]*?audio\.stopVoices\(\)[\s\S]*?audio\.ending\(\)/.test(mainSource),
  'terminal success or failure cancels any active officer speech before the ending sound plays',
);
assert(
  /this\.lowHealthThreshold\s*=\s*0\.35/.test(playerSource) &&
    /this\.minimumMobility\s*=\s*0\.58/.test(playerSource) &&
    /maxSpeed[\s\S]*?this\._mobilityMultiplier\(\)/.test(playerSource) &&
    /if \(!this\.alive\) \{[\s\S]*?deathElapsed \/ this\.deathDuration[\s\S]*?1\.08/.test(playerSource) &&
    /setTimeout\(\(\) => beginHardFailure\(['"]operator_down['"]\), 1500\)/.test(mainSource),
  'critical health reduces locomotion and death plays a complete camera fall before checkpoint or hard-mode resolution',
);
const uiSource = await readFile(join(root, 'src/ui.js'), 'utf8');

assert(
  /preload\(progress = 0,[\s\S]*?dataset\.ready = String\(complete\)[\s\S]*?aria-busy[\s\S]*?BRIEFING AVAILABLE NOW/.test(uiSource) &&
    /bindInput\(\);[\s\S]*?ui\.preload\(0,[\s\S]*?bootPromise = boot\(\)/.test(mainSource) &&
    /function reportBoot\([\s\S]*?startInProgress[\s\S]*?ui\.loading[\s\S]*?ui\.preload/.test(mainSource) &&
    /if \(!bootComplete\) \{[\s\S]*?ui\.loading\(bootProgress, bootStatus\)[\s\S]*?await bootPromise/.test(mainSource),
  'background boot progress stays on the deploy control until an early Play click asks for the full loading overlay',
);

assert(
  /deathVeil:\s*['"]death-veil['"]/.test(uiSource) &&
    /setDeathVeil\(progress = 0\)[\s\S]*?rawClose[\s\S]*?translateY/.test(uiSource) &&
    /ui\.setDeathVeil\(playerState\?\.deathProgress \?\? 0\)/.test(mainSource) &&
    /\.death-veil\s*\{[^}]*z-index:\s*60/.test(styleSource) &&
    /\.death-veil i\s*\{[^}]*linear-gradient\(to bottom[\s\S]*?transparent 100%/.test(styleSource) &&
    /\.death-veil b\s*\{[^}]*linear-gradient\(to top[\s\S]*?transparent 100%/.test(styleSource),
  'the player death fall drives two closing eyelids and a progressive black vision veil',
);

assert(
  /_canSee\(enemy, playerEye\)[\s\S]*?return !this\._segmentBlocked\(eye, playerEye\)/.test(enemiesSource) &&
    /_segmentBlocked\(start, end\)[\s\S]*?this\.world\.segmentBlocked\(start\.clone\(\), end\.clone\(\)\)/.test(enemiesSource) &&
    /raycast\(origin, direction,[\s\S]*?const worldHit = this\._raycastWorld\(start, dir, far\)/.test(enemiesSource),
  'enemy sight and hit tests share the world ballistic filter, so chain-link wire does not hide targets or stop rounds',
);
assert(
  /panel\.userData\.noHit\s*=\s*true/.test(fenceSegmentSource) &&
    /intersectObjects\(targets, true\)\.find\(\(hit\) => !this\._isIgnoredHit\(hit\.object\)\)/.test(weaponSource) &&
    /_isIgnoredHit\(object\)[\s\S]*?current\.userData\?\.noHit/.test(weaponSource),
  'the visible chain-link panel is also ignored by the player weapon fallback raycaster',
);

assert(
  /clearwater-waterworks-keyart\.png/.test(styleSource) &&
    !/(?:saltline|waterguard|clearwater-ridge-keyart|clearwater-keyart)\.png/i.test(styleSource),
  'title and ending presentation use only the current Operation Clearwater waterworks key art',
);
assert(
  !/\.operator-dossier\s*\{|\.operator-portrait\s*\{|\.loadout-card\s*\{|\.optic-row\s*\{/.test(styleSource) &&
    /\.option-stack\s*\{[^}]*grid-template-columns:\s*repeat\(2/.test(styleSource),
  'the home layout removes the operator card and keeps compact two-column deployment options',
);
assert(
  /\.briefing-panel\s*\{[^}]*height:\s*100%[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/.test(styleSource) &&
    /@media \(max-width: 900px\)[\s\S]*?\.briefing-panel\s*\{[^}]*width:\s*min\(720px, 84vw\)[^}]*justify-content:\s*flex-start/.test(styleSource) &&
    /@media \(max-width: 700px\)[\s\S]*?\.briefing-panel\s*\{[^}]*width:\s*100%/.test(styleSource) &&
    /@media \(max-width: 480px\)[\s\S]*?\.option-stack\s*\{[^}]*grid-template-columns:\s*1fr/.test(styleSource) &&
    /@media \(max-width: 900px\)[\s\S]*?\.operation-strip\s*\{[^}]*display:\s*none/.test(styleSource) &&
    /briefingPanel\.scrollTop\s*=\s*0/.test(uiSource) &&
    !/\.brief-plans\s*\{\s*display:\s*none/.test(styleSource) &&
    !/\.brief-meta span:nth-child\(3\)\s*\{\s*display:\s*none/.test(styleSource),
  'the home briefing scrolls safely, preserves its small-print content, and stacks settings before text can clip',
);

// Recon is a local, deterministic cinematic: all 20 initial contacts exist
// before insertion (18 gunmen plus two technical specialists), and the
// aircraft follows its declared +Z forward axis with world-up preserved.
assert(enemyFeet.length === 20, 'the authored facility contains exactly 20 thermal-counted hostiles');
assert(
  /id:\s*['"]poison_technician['"][\s\S]{0,500}?role:\s*['"]rifle_elite['"][\s\S]{0,220}?specialty:\s*['"]poison_technician['"][\s\S]{0,220}?missionAssetId:\s*['"]POISON_TECHNICIAN['"][\s\S]{0,220}?technician:\s*true/.test(worldSource) &&
    /id:\s*['"]vault_technician['"][\s\S]{0,500}?role:\s*['"]rifle_elite['"][\s\S]{0,220}?specialty:\s*['"]valve_vault_technician['"][\s\S]{0,220}?missionAssetId:\s*['"]VAULT_TECHNICIAN['"][\s\S]{0,220}?technician:\s*true/.test(worldSource) &&
    /authoredRosterIds\.length !== 20[\s\S]*?new Set\(authoredRosterIds\)\.size !== 20/.test(worldSource) &&
    /authoredRosterCount:\s*authoredRosterIds\.length/.test(worldSource),
  'the two named technicians extend the original 18-guard roster to 20 unique recon contacts with stable specialties',
);
assert(
  /import \{ GLTFLoader \}/.test(mainSource) && /import \{ DRACOLoader \}/.test(mainSource) &&
    /RECON_HAWK_URL\s*=\s*['"]\.\/assets\/models\/vehicles\/global-hawk\.glb['"]/.test(mainSource) &&
    /RECON_DRACO_PATH\s*=\s*['"]\.\/vendor\/three\/examples\/jsm\/libs\/draco\/gltf\/['"]/.test(mainSource),
  'Global Hawk and Draco runtime paths are entirely local',
);
assert(
  /async function loadGlobalHawk\(\)[\s\S]*?loader\.setDRACOLoader\(draco\)[\s\S]*?local \+Z after conversion/.test(mainSource) &&
    !/asset\.rotation\.y \+= Math\.PI/.test(mainSource) &&
    /globalHawk\.name\s*=\s*['"]RQ4_GLOBAL_HAWK_RECON_CINEMATIC['"][\s\S]*?globalHawk\.userData\.forwardAxis\s*=\s*['"]\+Z['"]/.test(mainSource) &&
    /globalHawk\.up\.set\(0,\s*1,\s*0\)[\s\S]*?globalHawk\.lookAt\(ahead\)/.test(mainSource),
  'Global Hawk model is corrected once, remains upright, and points along its flight path',
);
assert(
  /function authoredEnemySpawns\(\)[\s\S]*?world\?\.enemySpawns/.test(mainSource) &&
    /function spawnAllAuthoredHostiles\(\)[\s\S]*?authoredEnemyGroups\(\)[\s\S]*?spawnGroup\(group/.test(mainSource) &&
    /onStart:\s*\(\)\s*=>\s*\{[\s\S]*?spawnAllAuthoredHostiles\(\)/.test(mainSource),
  'all authored terrorists deploy before the recon pass rather than spawning beside the player by stage',
);
assert(
  /function createThermalTargets\(\)[\s\S]*?reconGuardPositions\.map/.test(mainSource) &&
    /function syncThermalContactPosition\(contact\)[\s\S]*?enemies\?\.enemies\?\.find\?\.[\s\S]*?actor\.torsoBone \?\? actor\.root[\s\S]*?getWorldPosition\(contact\.worldPosition\)/.test(mainSource) &&
    /contact\.marker\.dataset\.live\s*=\s*['"]true['"][\s\S]*?dataset\.initialPlanarDrift/.test(mainSource) &&
    /function updateThermal\(time\)[\s\S]*?count:\s*detected[\s\S]*?HUMAN HEAT SIGNATURES/.test(mainSource) &&
    /count:\s*reconGuardPositions\.length[\s\S]*?HOSTILES MAPPED/.test(mainSource),
  'thermal presentation counts the authored roster while anchoring every contact to its live enemy torso',
);
const thermalTargetCreationSource = mainSource.match(
  /function createThermalTargets\(\)\s*\{([\s\S]*?)\n\}\n\nfunction authoredReconTargets/,
)?.[1] ?? '';
const thermalMarkerProjectionSource = mainSource.match(
  /function projectThermalMarker\([\s\S]*?\n\}/,
)?.[0] ?? '';
const thermalProjectionSource = mainSource.match(
  /function updateThermalTargetProjection\(visibleCount\)\s*\{([\s\S]*?)\n\}\n\nfunction cubicPoint/,
)?.[1] ?? '';
assert(
  /document\.createElement\(['"]div['"]\)[\s\S]*?layer\.className\s*=\s*['"]thermal-contact-layer['"]/.test(thermalTargetCreationSource) &&
    /reconGuardPositions\.map\(\(spec, index\)\s*=>/.test(thermalTargetCreationSource) &&
    /document\.createElement\(['"]i['"]\)[\s\S]*?marker\.className\s*=\s*['"]thermal-contact-x['"]/.test(thermalTargetCreationSource) &&
    /marker\.dataset\.contact\s*=\s*String\(index \+ 1\)\.padStart\(2, ['"]0['"]\)/.test(thermalTargetCreationSource) &&
    /marker\.dataset\.enemyId\s*=\s*spec\.id/.test(thermalTargetCreationSource) &&
    /authoredPosition:\s*spec\.position\.clone\(\)/.test(thermalTargetCreationSource) &&
    /overlay\.prepend\(layer, strategicLayer\)/.test(thermalTargetCreationSource),
  'EO/IR creates one enemy-ID-addressable contact with an auditable authored origin for every hostile',
);
assert(
  /\.thermal-contact-x\s*\{[^}]*width:\s*clamp\(6px,\s*\.58vw,\s*9px\);[^}]*height:\s*clamp\(6px,\s*\.58vw,\s*9px\)/.test(styleSource) &&
    /\.thermal-contact-x::before,\s*\.thermal-contact-x::after\s*\{[^}]*height:\s*1px;[^}]*background:\s*#ff493d;[^}]*box-shadow:\s*0 0 0 \.5px rgba\(35,0,0,\.9\)/.test(styleSource) &&
    /\.thermal-contact-x::before\s*\{[^}]*rotate\(45deg\)/.test(styleSource) &&
    /\.thermal-contact-x::after\s*\{[^}]*rotate\(-45deg\)/.test(styleSource) &&
    /\.thermal-contact-x\[hidden\],\s*\.thermal-contact-layer\[hidden\],\s*\.thermal-strategic-layer\[hidden\],\s*\.thermal-strategic-marker\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(styleSource),
  'thermal contacts use smaller 6–9 px red Xs with true 1 px strokes, a half-pixel keyline, and strict hidden state',
);
assert(
  /projected\.copy\(worldPosition\)\.project\(camera\)/.test(thermalMarkerProjectionSource) &&
    /projected\.x\s*>=\s*-1\.04[\s\S]*?projected\.x\s*<=\s*1\.04/.test(thermalMarkerProjectionSource) &&
    /marker\.hidden\s*=\s*!visible/.test(thermalMarkerProjectionSource) &&
    /translate3d\(\$\{x\.toFixed\(1\)\}px, \$\{y\.toFixed\(1\)\}px, 0\) translate\(-50%, -50%\)/.test(thermalMarkerProjectionSource) &&
    /if \(index\s*>=\s*visibleCount\)[\s\S]*?contact\.marker\.hidden\s*=\s*true/.test(thermalProjectionSource) &&
    /if \(!syncThermalContactPosition\(contact\)\)[\s\S]*?contact\.marker\.hidden\s*=\s*true/.test(thermalProjectionSource) &&
    /projectThermalMarker\(contact\.marker, contact\.worldPosition, contact\.projected, width, height\)/.test(thermalProjectionSource) &&
    /targets\.strategic\.forEach[\s\S]*?projectThermalMarker\(target\.marker, target\.position, target\.projected, width, height\)/.test(thermalProjectionSource) &&
    /const detected\s*=\s*Math\.min\([\s\S]*?updateThermalTargetProjection\(detected\)/.test(mainSource),
  'hostile and strategic world positions share one bounded active-camera projection into screen-space markers',
);
const worldReconTargetSource = worldSource.match(
  /const reconTargets\s*=\s*Object\.freeze\(\[([\s\S]*?)\n\s*\]\);/,
)?.[1] ?? '';
const worldReconTargetIds = [...worldReconTargetSource.matchAll(/id:\s*['"]([^'"]+)['"]/g)]
  .map((match) => match[1]);
assert(
  worldReconTargetIds.length === 3 &&
    ['valve_vault', 'poison_injection_machine', 'backdoor_pipe'].every((id) => worldReconTargetIds.includes(id)) &&
    /interactionId:\s*valveInteraction\.id,\s*assetId:\s*['"]SUPPLY_VALVE['"]/.test(worldReconTargetSource) &&
    /interactionId:\s*poisonInteraction\.id,\s*assetId:\s*['"]POISON_INJECTION_MACHINE['"]/.test(worldReconTargetSource) &&
    /interactionId:\s*backdoorPipeInteraction\.id,\s*assetId:\s*['"]BACKDOOR_MAIN_PIPE['"]/.test(worldReconTargetSource) &&
    /const RECON_TARGET_DEFINITIONS\s*=\s*Object\.freeze\(\[[\s\S]*?valve_vault[\s\S]*?poison_injection_machine[\s\S]*?backdoor_pipe/.test(mainSource) &&
    /function authoredReconTargets\(\)[\s\S]*?world\?\.reconTargets[\s\S]*?RECON_TARGET_DEFINITIONS\.map/.test(mainSource),
  'Global Hawk reconnaissance consumes exactly three stable authored facility targets with physical asset and interaction IDs',
);
assert(
  /function setReconPhase\(next\)[\s\S]*?const thermal\s*=\s*next\s*===\s*['"]thermal['"][\s\S]*?reconThermalTargets\.layer\.hidden\s*=\s*!thermal[\s\S]*?if \(!thermal\)[\s\S]*?contact\.marker\.hidden\s*=\s*true/.test(mainSource) &&
    /function cleanupReconPresentation\(\)[\s\S]*?setReconPhase\(['"]idle['"]\)[\s\S]*?removeThermalTargets\(\)/.test(mainSource) &&
    !/gameplayHostileMarkers|markGameplayHostile|markReconTransferHostiles|updateGameplayHostileMarkers|HOSTILE_CROSS_|CanvasTexture|SpriteMaterial|new THREE\.Sprite/.test(mainSource),
  'the DOM X layer is thermal-recon-only, is removed at handoff, and no WebGL or gameplay marker lifecycle remains',
);
assert(
  /RECON_TEST_TIMES\s*=\s*Object\.freeze\(\{\s*flyby:[\s\S]*?thermal:[\s\S]*?insertion:/.test(mainSource) &&
    /introPhase:\s*\(phase[\s\S]*?completeIntro:\s*\(\)/.test(mainSource) &&
    /intro:\s*\{[\s\S]*?hostileCount:[\s\S]*?aircraftForwardAxis:[\s\S]*?insertion:[\s\S]*?thermalAlignment:\s*thermalAlignmentSnapshot\(\)/.test(mainSource) &&
    /function thermalAlignmentSnapshot\(\)[\s\S]*?markerAnchorError:[\s\S]*?initialPlanarDrift:/.test(mainSource),
  'browser QA can freeze recon and audit each thermal marker against its live actor and initial authored position',
);

// Rendering stays on the native-resolution WebGL target. The former
// post-processing chain introduced extra buffers that could surface as soft
// output or bright square tiles on some integrated GPUs.
const cameraArgs = mainSource.match(
  /new THREE\.PerspectiveCamera\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/,
);
const cameraNear = Number(cameraArgs?.[3]);
const cameraFar = Number(cameraArgs?.[4]);
assert(Boolean(cameraArgs), 'main declares a numeric perspective-camera depth range');
assert(
  cameraNear >= 0.05 && cameraFar <= 500 && cameraFar / cameraNear <= 6000,
  'camera near/far range is tight enough for stable foundations and fence hardware',
);
const highDprCap = Number(mainSource.match(/quality === ['"]high['"]\s*\?\s*([\d.]+)/)?.[1]);
assert(highDprCap >= 2, 'high quality permits at least 2x device-pixel resolution');
assert(
  /const pixelRatio\s*=\s*Math\.min\([\s\S]*?renderer\.setPixelRatio\(pixelRatio\)/.test(mainSource) &&
    /renderer\.setSize\(width, height, false\)/.test(mainSource),
  'the direct WebGL target receives both the selected device-pixel ratio and native viewport size',
);
assert(
  !/EffectComposer|RenderPass|OutputPass|UnrealBloomPass|BloomPass|AfterimagePass|\bcomposer\b/.test(mainSource) &&
    (mainSource.match(/renderer\.render\(scene, camera\)/g) ?? []).length === 1,
  'the frame uses one direct renderer pass with no post-processing buffers that can expose intermittent square tiles',
);
assert(
  !/mix-blend-mode\s*:\s*(?:screen|plus-lighter|color-dodge)/i.test(styleSource),
  'full-screen CSS overlays do not use bright compositing modes that can reveal rectangular layers',
);

// RMB aiming must be optical, not just a tiny model translation, and every
// disable/dispose path must restore the original projection.
assert(
  /button === 2[\s\S]*?this\.adsHeld = this\.enabled/.test(weaponSource) &&
    /button === 2\) this\.adsHeld = false/.test(weaponSource),
  'right mouse press/release drives the ADS state',
);
assert(
  /canvas\.addEventListener\(['"]mousedown['"][\s\S]*?weapon\.handleMouseDown\(event\)/.test(mainSource) &&
    /addEventListener\(['"]mouseup['"][\s\S]*?handleMouseUp/.test(mainSource),
  'game input forwards held right-mouse events to the weapon system',
);
assert(
  /event\.code === ['"]KeyX['"][\s\S]*?this\.adsKeyHeld = this\.enabled[\s\S]*?_syncAdsHeld\(\)/.test(weaponSource) &&
    /event\.code !== ['"]KeyX['"][\s\S]*?this\.adsKeyHeld = false[\s\S]*?_syncAdsHeld\(\)/.test(weaponSource) &&
    /this\.adsHeld = this\.enabled && \(this\.adsMouseHeld \|\| this\.adsKeyHeld\)/.test(weaponSource),
  'held X drives ADS independently and composes correctly with held RMB',
);
assert(
  /this\.baseFov\s*=/.test(weaponSource) && /this\.adsFov\s*=/.test(weaponSource) &&
    /_updateCameraFov\([\s\S]*?MathUtils\.lerp\(this\.baseFov, this\.adsFov, this\.ads\)/.test(weaponSource),
  'ADS interpolates between explicit hip and magnified camera FOV values',
);
assert(
  /_setCameraFov\(value,[\s\S]*?this\.camera\.fov = value;[\s\S]*?this\.camera\.updateProjectionMatrix\(\);/.test(weaponSource),
  'ADS changes the real camera projection matrix',
);
const representativeHipFov = 71;
const fovForMagnification = (zoom) => 2 * 180 / Math.PI * Math.atan(
  Math.tan(representativeHipFov * Math.PI / 360) / zoom,
);
const selectableAimFovs = [2, 4, 8].map(fovForMagnification);
assert(
  selectableAimFovs[0] < representativeHipFov && selectableAimFovs[2] < selectableAimFovs[1] &&
    /this\.aimMagnification\s*=\s*2/.test(weaponSource) &&
    /\[2,\s*4,\s*8\]\.includes\(requested\)/.test(weaponSource) &&
    /_fovForMagnification\(magnification\)[\s\S]*?Math\.atan\(Math\.tan\([\s\S]*?\/\s*zoom\)/.test(weaponSource) &&
    /adsFov:\s*this\.adsFov/.test(weaponSource) && /aimMagnification:\s*this\.aimMagnification/.test(weaponSource),
  'RMB and X aiming uses the selected true angular 2x, 4x, or 8x camera magnification',
);
assert(
  /aimSelect:\s*['"]aim-select['"]/.test(uiSource) &&
    /aimMagnification:\s*Number\(this\.el\.aimSelect\?\.value \?\? 2\)/.test(uiSource) &&
    /weapon\?\.setMagnification\?\.\(requestedOptions\.aimMagnification \?\? 2\)/.test(mainSource) &&
    /aimMagnification:\s*weapon\?\.aimMagnification \?\? 2/.test(mainSource) &&
    /Digit2:\s*2,\s*Digit4:\s*4,\s*Digit8:\s*8/.test(weaponSource) &&
    /this\.setMagnification\(directMagnification\)/.test(weaponSource) &&
    /onMagnification:\s*\(event\s*=\s*\{\}\)/.test(mainSource),
  'home magnification applies before insertion, while 2, 4, and 8 switch it directly and refresh the live HUD',
);
assert(
  /difficultySelect:\s*['"]difficulty-select['"]/.test(uiSource) &&
    /\['easy',\s*'normal',\s*'hard',\s*'extreme'\]\.includes\(selectedDifficulty\)/.test(uiSource) &&
    /difficultyProfile\s*=\s*getDifficultyProfile\(requestedOptions\.difficulty\)/.test(mainSource) &&
    /player\?\.setDifficulty\?\.\(difficultyProfile\)/.test(mainSource) &&
    /enemies\?\.setDifficulty\?\.\(difficultyProfile\)/.test(mainSource) &&
    /function saveCheckpoint\([\s\S]*?!isOneLifeDifficulty\(difficulty\)[\s\S]*?setCheckpoint/.test(mainSource) &&
    /onDeath:[\s\S]*?isOneLifeDifficulty\(difficulty\)[\s\S]*?beginHardFailure\(['"]operator_down['"]\)/.test(mainSource) &&
    /onFall:[\s\S]*?beginHardFailure\(['"]operator_fell['"]\)[\s\S]*?return true/.test(mainSource) &&
    /easy:[\s\S]*?playerHealth:\s*150[\s\S]*?startingArmor:\s*150[\s\S]*?enemyHealthMultiplier:\s*1[\s\S]*?normal:[\s\S]*?playerHealth:\s*120[\s\S]*?startingArmor:\s*120[\s\S]*?enemyHealthMultiplier:\s*1\.2/.test(difficultySource) &&
    /getDifficultyProfile\(value = ['"]normal['"]\)/.test(difficultySource) &&
    /easy:[\s\S]*?enemyAccuracyMultiplier:\s*1\.2[\s\S]*?normal:[\s\S]*?enemyAccuracyMultiplier:\s*0\.92[\s\S]*?hard:[\s\S]*?enemyAccuracyMultiplier:\s*0\.62[\s\S]*?extreme:[\s\S]*?enemyAccuracyMultiplier:\s*0\.4/.test(difficultySource) &&
    /const spread = this\._shotSpread\([\s\S]*?this\.enemyAccuracyMultiplier/.test(enemiesSource) &&
    /hard:[\s\S]*?playerHealth:\s*100[\s\S]*?startingArmor:\s*100[\s\S]*?enemyHealthMultiplier:\s*1\.45[\s\S]*?oneLife:\s*true/.test(difficultySource) &&
    /extreme:[\s\S]*?playerHealth:\s*75[\s\S]*?startingArmor:\s*75[\s\S]*?enemyHealthMultiplier:\s*1\.8[\s\S]*?concealedVests:\s*true/.test(difficultySource) &&
    /this\.maxArmor\s*=\s*Math\.max\(0, numberOr\(profile\.startingArmor, 120\)\)/.test(playerSource) &&
    /this\.armor\s*=\s*this\.alive[\s\S]*?this\.maxArmor \* armorRatio/.test(playerSource) &&
    /maxArmor:\s*qaPlayerState\.maxArmor/.test(mainSource) &&
    /if \(handled !== true\) this\.reset\(this\.checkpoint\)/.test(playerSource),
  'Normal is the default with the requested paired vitality/plate capacities while harder settings retain accuracy and one-life rules',
);
assert(
  /let difficulty\s*=\s*getDifficultyProfile\(params\.get\(['"]difficulty['"]\)\)\.id/.test(mainSource) &&
    /if \(ui\.difficultySelect\) ui\.difficultySelect\.value = difficulty/.test(mainSource) &&
    /async function restartInMemory\(\)[\s\S]*?difficulty,[\s\S]*?resetMission[\s\S]*?resetForReplay[\s\S]*?mission = buildMission\(\)[\s\S]*?beginGame\(options\)/.test(mainSource) &&
    /ui\.onRestart\(restartInMemory\)/.test(mainSource) &&
    /ui\.onReplay\(restartInMemory\)/.test(mainSource) &&
    !/location\.(?:assign|reload|replace)\(/.test(mainSource),
  'Restart and Play Again preserve active settings through an in-memory reset without navigating or reloading the document',
);
assert(
  /resetForReplay\(\)[\s\S]*?Keep parsed FBX templates[\s\S]*?this\.enemies\.length = 0[\s\S]*?this\.spawnedGroups\.clear\(\)[\s\S]*?this\.facilityAlerted = false/.test(enemiesSource) &&
    /resetForReplay\(\)[\s\S]*?this\.ammo = this\.magSize[\s\S]*?this\.reserve = 120[\s\S]*?this\.shotSerial = 0[\s\S]*?this\._emitAmmo\(\)/.test(weaponSource) &&
    /function resetMission\(\)[\s\S]*?poisonNeutralized: false[\s\S]*?supplyValveClosed: false[\s\S]*?backdoorPipeDemolished: false[\s\S]*?setPoisonNeutralized\(false\)[\s\S]*?setSupplyValveClosed\(false\)[\s\S]*?setBackdoorPipeDemolished\(false\)/.test(worldSource) &&
    /resetMission,/.test(worldSource) &&
    /resetForReplay\(\)[\s\S]*?this\.setDeathVeil\(0\)[\s\S]*?this\._show\(this\.el\.endingScreen, false\)/.test(uiSource),
  'replay clears every per-run combat, weapon, world, and overlay state while retaining already parsed asset templates',
);
const accuracyMultipliers = { easy: 1.2, normal: 0.92, hard: 0.62, extreme: 0.4 };
const accuracyAt = (distance, multiplier, movementSpeed = 0) => {
  const rangePenalty = Math.min(0.0014, Math.max(0, distance - 18) * 0.000025);
  const movementPenalty = Math.min(0.0014, Math.max(0, movementSpeed) * 0.00018);
  const angularSpread = (0.0036 + rangePenalty + movementPenalty) * multiplier;
  return { angularSpread, horizontalSigma: distance * angularSpread };
};
const longRangeAccuracy = Object.fromEntries(Object.entries(accuracyMultipliers).map(
  ([id, multiplier]) => [id, accuracyAt(80, multiplier)],
));
assert(
  /const ALERTED_SIGHT_RANGE = 110/.test(enemiesSource) &&
    /const ENEMY_BALLISTIC_RANGE = 140/.test(enemiesSource) &&
    /_raycastWorld\(origin, direction, ENEMY_BALLISTIC_RANGE\)/.test(enemiesSource) &&
    /addScaledVector\(direction, ENEMY_BALLISTIC_RANGE\)/.test(enemiesSource) &&
    /Math\.min\([\s\S]*?MAX_RANGE_SPREAD[\s\S]*?RANGE_SPREAD_PER_METER/.test(enemiesSource) &&
    !/distance \* 0\.00016/.test(enemiesSource) &&
    longRangeAccuracy.easy.horizontalSigma <= 0.481 &&
    longRangeAccuracy.normal.horizontalSigma < longRangeAccuracy.easy.horizontalSigma &&
    longRangeAccuracy.hard.horizontalSigma < longRangeAccuracy.normal.horizontalSigma &&
    longRangeAccuracy.extreme.horizontalSigma < longRangeAccuracy.hard.horizontalSigma,
  `enemy rounds cover the full alert range and retain useful, difficulty-ordered 80 m accuracy (${JSON.stringify(longRangeAccuracy)})`,
);
const pbrWeaponLoadSource = weaponSource.match(/async load\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*setEnabled\(/)?.[1] ?? '';
assert(
  /MODEL_URL[\s\S]*?m4a1-pbr\.fbx/.test(weaponSource) &&
    /BASE_COLOR_URL[\s\S]*?M4A1_Base_Color\.png/.test(weaponSource) &&
    /HEIGHT_URL[\s\S]*?M4A1_Height\.png/.test(weaponSource) &&
    /METALLIC_URL[\s\S]*?M4A1_Metallic\.png/.test(weaponSource) &&
    /NORMAL_URL[\s\S]*?M4A1_Normal\.png/.test(weaponSource) &&
    /ROUGHNESS_URL[\s\S]*?M4A1_Roughness\.png/.test(weaponSource) &&
    !/const MODEL_URL[\s\S]{0,100}?m4a1\.fbx/.test(weaponSource),
  'weapon runtime selects the full-detail CC0 rifle and all five PBR texture channels',
);
assert(
  /new THREE\.MeshStandardMaterial\(\{[\s\S]*?name:\s*['"]M4A1_CC0_PBR_Viewmodel_Material['"][\s\S]*?map:\s*baseColor[\s\S]*?bumpMap:\s*height[\s\S]*?bumpScale:\s*0\.012[\s\S]*?metalnessMap:\s*metallic[\s\S]*?normalMap:\s*normal[\s\S]*?normalScale:\s*new THREE\.Vector2\(0\.72,\s*0\.72\)[\s\S]*?roughnessMap:\s*roughness/.test(pbrWeaponLoadSource) &&
    /const scale\s*=\s*MODEL_LENGTH\s*\/\s*longest[\s\S]*?model\.name\s*=\s*['"]CC0_M4A1_PBR_Viewmodel['"]/.test(pbrWeaponLoadSource) &&
    /\/\^\(Sight\(\?:_2\)\?\|Switch\[12\]\)\$\/i\.test\(child\.name\)[\s\S]*?child\.visible\s*=\s*false/.test(pbrWeaponLoadSource),
  'full-detail rifle receives its real PBR material, normalized scale, and hides duplicate baked sight hardware',
);
const aimSightSource = weaponSource.match(/_createAimSight\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*_seatAimSight\(/)?.[1] ?? '';
assert(
  /this\.aimSight\s*=\s*this\._createAimSight\(\)[\s\S]*?this\.viewRoot\.add\(this\.aimSight\)/.test(weaponSource) &&
    !/(?:this\.)?camera\.add\(this\.aimSight\)/.test(weaponSource) &&
    !/(?:this\.)?camera\.remove\(this\.aimSight\)/.test(weaponSource),
  'the holographic sight is rifle-mounted under viewRoot rather than detached on the camera',
);
assert(
  /M4A1_Rail_Mounted_XPS2_Holographic_Sight/.test(aimSightSource) &&
    /XPS2_Receiver_Contact_Base/.test(aimSightSource) &&
    /XPS2_Captive_Rail_Clamp/.test(aimSightSource) && /XPS2_Fixed_Rail_Jaw/.test(aimSightSource) &&
    /XPS2_Rail_Cross_Bolt/.test(aimSightSource) &&
    /XPS2_Left_Body_Support/.test(aimSightSource) && /XPS2_Right_Body_Support/.test(aimSightSource) &&
    /roundedRectShape\(0\.038,\s*0\.027[\s\S]*?XPS2_Beveled_Hood_With_Rectangular_Aperture/.test(aimSightSource),
  'the XPS2 silhouette has a receiver-contact base, rail jaws, cross-bolt, supports, and rectangular hood',
);
assert(
  /XPS2_Recessed_Rectangular_Glass[\s\S]*?transparent:\s*true[\s\S]*?opacity:\s*0\.0\d+[\s\S]*?depthTest:\s*false[\s\S]*?depthWrite:\s*false[\s\S]*?side:\s*THREE\.DoubleSide/.test(aimSightSource) &&
    /new THREE\.PlaneGeometry\(0\.037,\s*0\.026\)[\s\S]*?glass\.position\.set\(0,\s*XPS2_WINDOW_CENTER_Y,\s*0\.0235\)[\s\S]*?glass\.name\s*=\s*['"]XPS2_Recessed_Rectangular_View_Window['"]/.test(aimSightSource) &&
    /XPS2_Bore_Aligned_Centre_Dot/.test(aimSightSource) && /XPS2_Bore_Aligned_Outer_Ring/.test(aimSightSource) &&
    /sight\.traverse\([\s\S]*?child\.userData\.noHit\s*=\s*true/.test(aimSightSource) &&
    /aimSight\.visible\s*=\s*this\.enabled && this\.loaded/.test(weaponSource),
  'the mounted 37 by 26 mm recessed window stays transparent, non-ballistic, and visible with its rifle',
);
const aimSightSeatSource = weaponSource.match(/_seatAimSight\(railY, railZ\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
assert(
  /const XPS2_WIDTH\s*=\s*0\.0533/.test(weaponSource) &&
    /const XPS2_HEIGHT\s*=\s*0\.0635/.test(weaponSource) && /const XPS2_LENGTH\s*=\s*0\.0965/.test(weaponSource) &&
    /const railY\s*=\s*\(rawBaseBounds\.max\.y - center\.y\) \* scale/.test(pbrWeaponLoadSource) &&
    /const railZ\s*=\s*\(rawBaseCenter\.z - center\.z\) \* scale \+ MODEL_LONGITUDINAL_OFFSET/.test(pbrWeaponLoadSource) &&
    /this\._seatAimSight\(railY, railZ\)/.test(pbrWeaponLoadSource) &&
    /officialDimensionsMm\s*=\s*\[53\.3,\s*63\.5,\s*96\.5\]/.test(aimSightSeatSource) &&
    /opticalCenterY\s*=\s*safeRailY \+ XPS2_WINDOW_CENTER_Y[\s\S]*?this\.adsPosition\.y\s*=\s*-this\.aimSight\.userData\.opticalCenterY/.test(aimSightSeatSource),
  'measured receiver geometry seats the official-size sight and aligns its optical centre for ADS',
);
assert(
  (weaponSource.match(/_setCameraFov\(this\.baseFov, true\)/g) ?? []).length >= 2,
  'weapon disable and disposal both restore the original camera FOV',
);

// Reloading has readable mechanical phases on named parts instead of being an
// invisible ammo timer.
assert(
  /getObjectByName\(['"]M4A1_magazine['"]\)/.test(weaponSource) &&
    /this\.magazineHome\s*=\s*\{[\s\S]*?position:[\s\S]*?quaternion:/.test(weaponSource),
  'reload identifies the authored M4A1 magazine and records its home transform',
);
const reloadPreparationSource = weaponSource.match(
  /_prepareReloadParts\(model\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*_createCartridge\(/,
)?.[1] ?? '';
assert(
  /M4A1_Detachable_Magazine_Assembly/.test(reloadPreparationSource) &&
    /assembly\.attach\(this\.magazineMesh\)/.test(reloadPreparationSource) &&
    /M4A1_Visible_Magazine_Follower/.test(reloadPreparationSource) &&
    /M4A1_Staggered_Visible_Top_Rounds/.test(reloadPreparationSource) &&
    /M4A1_Magazine_Top_Round_Left/.test(reloadPreparationSource) &&
    /M4A1_Magazine_Top_Round_Right/.test(reloadPreparationSource),
  'the normalized rifle owns a detachable magazine with a visible follower and staggered top cartridges',
);
assert(
  /M4A1_Open_Ejection_Port_Cavity/.test(reloadPreparationSource) &&
    /M4A1_Visible_Reciprocating_Bolt_Carrier/.test(reloadPreparationSource) &&
    /M4A1_Visible_Chambered_Round/.test(reloadPreparationSource) &&
    /M4A1_Visible_Cartridge_Brass/.test(reloadPreparationSource) &&
    /M4A1_Visible_Cartridge_Projectile/.test(reloadPreparationSource),
  'the receiver visibly contains an open ejection port, bolt carrier, and complete brass-and-projectile chambered round',
);
const ammoVisualSource = weaponSource.match(
  /_updateAmmoVisuals\(forceFreshMagazine = false\)\s*\{([\s\S]*?)\n\s*\}/,
)?.[1] ?? '';
assert(
  /visibleRounds\s*=\s*forceFreshMagazine\s*\?\s*Math\.min\(this\.magSize,\s*this\.reserve\)\s*:\s*this\.ammo/.test(ammoVisualSource) &&
    /this\.magazineRounds\.visible\s*=\s*visibleRounds\s*>\s*0/.test(ammoVisualSource) &&
    /this\.topRounds\[0\]\.visible\s*=\s*visibleRounds\s*>\s*0/.test(ammoVisualSource) &&
    /this\.topRounds\[1\]\.visible\s*=\s*visibleRounds\s*>\s*1/.test(ammoVisualSource) &&
    /this\.chamberRound\.visible\s*=\s*this\.ammo\s*>\s*0/.test(ammoVisualSource) &&
    /this\.ammo\s*-=\s*1;[\s\S]*?this\._updateAmmoVisuals\(\)/.test(weaponSource),
  'visible magazine and chamber ammunition follows live ammo state immediately after every shot',
);
assert(
  /chargingHandle\.name\s*=\s*['"]M4A1_Animated_Charging_Handle['"]/.test(weaponSource) &&
    /_animateReloadParts\(progress\)[\s\S]*?const pull = phase\(p,[\s\S]*?const release = phase\(p,[\s\S]*?chargingHandle\.position\.z/.test(weaponSource),
  'reload includes a named charging handle with pull-and-release phases',
);
const reloadAnimationSource = weaponSource.match(
  /_animateReloadParts\(progress\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*_setCameraFov\(/,
)?.[1] ?? '';
const magazineDrop = Number(reloadAnimationSource.match(/drop\s*=\s*([\d.]+)\s*\*\s*t/)?.[1]);
const magazineSide = Number(reloadAnimationSource.match(/side\s*=\s*([\d.]+)\s*\*\s*t/)?.[1]);
assert(
  magazineDrop >= 0.2 && magazineSide >= 0.055 && magazineDrop <= 0.26 &&
    /this\.magazine\.visible\s*=\s*p\s*<\s*0\.47\s*\|\|\s*p\s*>=\s*0\.5/.test(reloadAnimationSource) &&
    /this\._updateAmmoVisuals\(p\s*>=\s*0\.5\)/.test(reloadAnimationSource),
  'reload visibly removes the old magazine and presents a fresh one inside a compact 20 to 26 cm insertion path',
);
assert(
  /this\.reloadNeedsCharge\s*=\s*this\.ammo\s*<=\s*0/.test(weaponSource) &&
    /const chargeTravel\s*=\s*this\.reloadNeedsCharge\s*\?\s*pull\s*\*\s*\(1\s*-\s*release\)\s*:\s*0/.test(reloadAnimationSource) &&
    /this\.boltCarrier\.position\.z\s*\+=\s*0\.052\s*\*\s*chargeTravel/.test(reloadAnimationSource) &&
    /this\.chamberRound\.visible\s*=\s*this\.reloadNeedsCharge\s*\?\s*p\s*>=\s*0\.9\s*:\s*this\.ammo\s*>\s*0/.test(reloadAnimationSource),
  'empty reloads visibly rack the bolt and chamber a round while tactical reloads retain the chambered cartridge',
);
assert(
  /_updateViewmodel\([\s\S]*?_animateReloadParts\(reloadProgress\)/.test(weaponSource),
  'magazine and charging-handle animation is advanced every reload frame',
);

// The player's rifle is shouldered by a real skinned two-arm viewmodel. Its
// lifecycle is owned by WeaponSystem so hip, ADS, sprint, reload, disable, and
// disposal cannot leave hands detached from the gun.
assert(
  /import \{ FirstPersonHands \} from ['"]\.\/first-person-hands\.js['"]/.test(weaponSource) &&
    /this\.hands\s*=\s*new FirstPersonHands\(this\.camera,\s*this\.viewRoot,\s*\{\s*enabled:\s*false\s*\}\)/.test(weaponSource) &&
    /await this\.hands\.load\(\)/.test(weaponSource) &&
    /this\.hands\.bindWeapon\(\{\s*root:\s*this\.viewRoot,\s*magazine:\s*this\.magazine,\s*chargingHandle:\s*this\.chargingHandle,?\s*\}\)/.test(weaponSource),
  'WeaponSystem imports, loads, and binds the skinned first-person hands to the rifle and its moving reload parts',
);
assert(
  /this\.hands\?\.update\(dt,\s*\{[\s\S]*?enabled:\s*this\.enabled\s*&&\s*this\.loaded[\s\S]*?ads:\s*this\.ads[\s\S]*?sprint:\s*this\.sprintBlend[\s\S]*?reloading:\s*this\.reloading[\s\S]*?reloadProgress:/.test(weaponSource) &&
    /this\.hands\?\.setEnabled\(this\.enabled\s*&&\s*this\.loaded\)/.test(weaponSource) &&
    /dispose\(\)[\s\S]*?this\.hands\?\.dispose\(\)/.test(weaponSource),
  'hand pose, visibility, and disposal follow the weapon lifecycle on every frame',
);
assert(
  /military-male-04-arms\.fbx/.test(handsSource) &&
    /sm005_body_color_acu\.jpg/.test(handsSource) &&
    /sm005_body_normal\.png/.test(handsSource) &&
    /sm005_body_specular\.jpg/.test(handsSource) &&
    /new THREE\.LoadingManager\(\)[\s\S]*?setURLModifier\([\s\S]*?\/\\\.tga[\s\S]*?BODY_NORMAL_URL[\s\S]*?BODY_SPECULAR_URL[\s\S]*?BODY_COLOR_URL/.test(handsSource),
  'the arm loader uses only the four packaged assets and remaps every embedded legacy TGA request locally',
);
const armExtractionSource = handsSource.match(
  /function extractArmGeometry\(source, skeleton, threshold = ARM_WEIGHT_THRESHOLD\)\s*\{([\s\S]*?)\n\}/,
)?.[1] ?? '';
assert(
  /const ARM_WEIGHT_THRESHOLD\s*=\s*0\.25/.test(handsSource) &&
    /object\.isSkinnedMesh/.test(handsSource) &&
    /triangle\.every\(\(vertex\)\s*=>\s*armWeightAt\(vertex\)\s*>=\s*threshold\)/.test(armExtractionSource) &&
    /Object\.entries\(source\.attributes\)/.test(armExtractionSource) &&
    /geometry\.userData\.armTriangleCount\s*=\s*selectedVertices\.length\s*\/\s*3/.test(armExtractionSource) &&
    /this\.root\.userData\.armTriangleCount\s*=\s*triangleCount/.test(handsSource),
  'the exact pinned Rocketbox mesh deterministically extracts and exposes its verified 1,780 skinned arm triangles at the 0.25 arm-weight threshold',
);
assert(
  /Rocketbox_FirstPerson_Arms_Root/.test(handsSource) &&
    /Rocketbox_Military04_FirstPerson_Armature/.test(handsSource) &&
    /Rocketbox_Military04_Skinned_Gloved_Arms/.test(handsSource) &&
    /camera\.add\(this\.root\)/.test(handsSource) &&
    /name:\s*['"]Rocketbox_Military04_ACU_Gloved_Arms['"][\s\S]*?map:\s*colorMap[\s\S]*?normalMap,[\s\S]*?specularIntensityMap:\s*specularMap[\s\S]*?depthTest:\s*true[\s\S]*?depthWrite:\s*true/.test(handsSource),
  'the camera-mounted skinned ACU/glove arms use their real color, normal, and specular maps with depth-correct rendering',
);
const handsUpdateSource = handsSource.match(
  /update\(dt, state = \{\}\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*dispose\(\)/,
)?.[1] ?? '';
assert(
  /TRIGGER_GRIP/.test(handsUpdateSource) && /SUPPORT_GRIP/.test(handsUpdateSource) &&
    /this\._solveArm\(this\.rig\.right,\s*this\._triggerWorld/.test(handsUpdateSource) &&
    /this\._solveArm\(this\.rig\.left,\s*this\._supportWorld/.test(handsUpdateSource) &&
    /this\._orientHand\(\s*this\.rig\.right\.hand/.test(handsUpdateSource) &&
    /this\._orientHand\(this\.rig\.left\.hand/.test(handsUpdateSource),
  'the trigger and support hands are solved onto separate rifle grip points and oriented with the weapon',
);
assert(
  /function dampAndSnap\(current, target, lambda, dt, epsilon = 1e-5\)/.test(handsSource) &&
    /this\.model\.position\.x = dt > 0[\s\S]*?dampAndSnap\(this\.model\.position\.x, armatureX, 24, dt\)/.test(handsUpdateSource) &&
    /this\.model\.position\.y = dt > 0[\s\S]*?dampAndSnap\(this\.model\.position\.y, armatureY, 24, dt\)/.test(handsUpdateSource) &&
    /this\.model\.position\.z = dt > 0[\s\S]*?dampAndSnap\(this\.model\.position\.z, armatureZ, 24, dt\)/.test(handsUpdateSource) &&
    /this\.root\.position\.x = dampAndSnap\(this\.root\.position\.x/.test(handsUpdateSource) &&
    /this\.root\.position\.y = dampAndSnap\(this\.root\.position\.y/.test(handsUpdateSource) &&
    /this\.root\.rotation\.z = dampAndSnap\(this\.root\.rotation\.z/.test(handsUpdateSource),
  'the armature and support-hand carrier snap back to authored transforms after mixed functional inputs',
);
const vector3Constant = (name) => {
  const match = handsSource.match(new RegExp(
    `const ${name}\\s*=\\s*new THREE\\.Vector3\\(\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\)`,
  ));
  return match ? match.slice(1, 4).map(Number) : null;
};
const triggerWrist = vector3Constant('TRIGGER_GRIP');
const supportWrist = vector3Constant('SUPPORT_GRIP');
const firingHandAxis = vector3Constant('FIRING_HAND_AXIS');
const firingPalmNormal = vector3Constant('FIRING_PALM_NORMAL');
const firingThumbBridge = vector3Constant('FIRING_THUMB_BRIDGE');
const firingThumbContact = vector3Constant('FIRING_THUMB_CONTACT');
const firingThumbPad = vector3Constant('FIRING_THUMB_PAD');
const supportHandAxis = vector3Constant('SUPPORT_HAND_AXIS');
const supportPalmNormal = vector3Constant('SUPPORT_PALM_NORMAL');
const vectorNear = (actual, expected, epsilon = 0.001) => Boolean(actual) &&
  actual.every((value, index) => Math.abs(value - expected[index]) <= epsilon);
assert(
  Boolean(triggerWrist && supportWrist) &&
    vectorNear(triggerWrist, [0.024, -0.029, -0.015]) && vectorNear(supportWrist, [-0.058, 0.008, -0.288]) &&
    triggerWrist[1] <= supportWrist[1] + 0.01 && supportWrist[2] <= triggerWrist[2] - 0.1 &&
    Math.hypot(...triggerWrist.map((value, index) => value - supportWrist[index])) > 0.15,
  'the firing wrist seats against the pistol grip while the support wrist remains forward beneath the handguard',
);
assert(
  vectorNear(firingThumbBridge, [0.018, 0.022, -0.058]) &&
    vectorNear(firingThumbContact, [-0.014, 0.02, -0.062]) &&
    vectorNear(firingThumbPad, [-0.024, 0.012, -0.102]) &&
    firingThumbBridge[2] > -0.08 && firingThumbContact[2] > -0.08 &&
    firingThumbPad[0] < firingThumbContact[0] && firingThumbPad[2] < firingThumbContact[2],
  'the firing thumb crosses visibly behind the grip before its pad closes forward on the far face',
);
assert(
  vectorNear(firingHandAxis, [0, 0, -1]) && vectorNear(firingPalmNormal, [-1, 0, 0]) &&
    vectorNear(supportHandAxis, [0.985, 0, -0.174]) && vectorNear(supportPalmNormal, [0, 1, 0]) &&
    /this\._weaponDirection\(FIRING_HAND_AXIS, this\._rightAxisWorld\)/.test(handsUpdateSource) &&
    /this\._weaponDirection\(FIRING_PALM_NORMAL, this\._rightPalmWorld\)/.test(handsUpdateSource) &&
    /this\._weaponDirection\(SUPPORT_HAND_AXIS, this\._leftAxisWorld\)/.test(handsUpdateSource) &&
    /this\._weaponDirection\(SUPPORT_PALM_NORMAL, this\._leftPalmWorld\)/.test(handsUpdateSource),
  'the firing hand is rifle-parallel from above while the support hand crosses beneath the barrel with its palm facing up',
);
const poseProbeSource = handsSource.match(
  /getPoseProbe\(\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*dispose\(\)/,
)?.[1] ?? '';
assert(
  /version:\s*11/.test(handsSource) && /expectedFingerBones:\s*30/.test(handsSource) &&
    /rearHandBoneAlignment:\s*['"]weapon_parallel_from_above['"]/.test(handsSource) &&
    /rearHandDownturnDegrees:\s*0/.test(handsSource) &&
    /rearHandTiltDegrees:\s*THREE\.MathUtils\.radToDeg\(FIRING_HAND_TILT\)/.test(handsSource) &&
    /immutable weapon-local[\s\S]*?this\._weaponDirection\(FIRING_HAND_AXIS, this\._rightAxisWorld\)/.test(handsUpdateSource) &&
    /firingWrist:\s*TRIGGER_GRIP\.toArray\(\)/.test(handsSource) &&
    /supportWrist:\s*SUPPORT_GRIP\.toArray\(\)/.test(handsSource) &&
    /handForearmAlignmentDot:\s*firingHandAxis\.dot\(firingForearmAxis\)/.test(poseProbeSource) &&
    /forearmVerticalDelta:\s*firingWrist\.y - firingElbow\.y/.test(poseProbeSource) &&
    /elbowLowered:\s*firingWrist\.y > firingElbow\.y/.test(poseProbeSource) &&
    /handDownturnDegrees:\s*0/.test(poseProbeSource) &&
    /if \(outwardSign > 0 && bend > 1e-5\)[\s\S]*?this\._worldQuaternion\.slerp\(this\._poseQuaternion, smooth01\(sprint\)\)/.test(handsSource) &&
    /dot\(this\._cameraUpWorld\) - 0\.075/.test(handsSource) &&
    /this\._weaponDirection\(FIRING_HAND_AXIS, this\._rightAxisWorld\)/.test(handsUpdateSource) &&
    /this\._weaponDirection\(FIRING_PALM_NORMAL, this\._rightPalmWorld\)/.test(handsUpdateSource) &&
    /triggerContactDistance:\s*closestContact\.distanceTo\(TRIGGER_CONTACT\)/.test(poseProbeSource) &&
    /triggerDistalContactT:\s*distalContactDistance \/ distalLength/.test(poseProbeSource) &&
    /topViewSlope:\s*Math\.abs\(firingHandAxis\.x\)/.test(poseProbeSource) &&
    /indexKnuckleLeft:\s*indexMiddle\.x - indexBase\.x/.test(poseProbeSource) &&
    /indexOverallLeft:\s*indexDistal\.x - indexBase\.x/.test(poseProbeSource) &&
    /indexLateralClosure:\s*indexDistal\.x - indexMiddle\.x/.test(poseProbeSource) &&
    /indexPadAlignment:\s*indexDistalAxis\.dot/.test(poseProbeSource) &&
    /silhouetteCameraAxis:\s*firingSilhouetteCameraAxis\.toArray\(\)/.test(poseProbeSource) &&
    /rearViewSilhouetteSlope:\s*Math\.abs\(firingSilhouetteCameraAxis\.x\)/.test(poseProbeSource) &&
    /thumbRearClearance:\s*firingThumbMiddle\.z - PISTOL_GRIP_REAR_Z/.test(poseProbeSource) &&
    /thumbHooksAcrossGrip:\s*firingThumbDistal\.x < firingThumbMiddle\.x/.test(poseProbeSource) &&
    /uprightApproach:\s*-firingHandAxis\.y/.test(poseProbeSource) &&
    /thumbFarSide:\s*supportThumbDistal\.x/.test(poseProbeSource) &&
    /thumbInwardWrap:\s*supportThumbDistal\.x - supportThumbBase\.x/.test(poseProbeSource) &&
    /thumbBarrelHeight:\s*supportThumbDistal\.y/.test(poseProbeSource) &&
    /thumbDownwardCurl:\s*supportThumbDistal\.y - supportThumbMiddle\.y/.test(poseProbeSource) &&
    /thumbForwardLean:\s*supportThumbDistal\.z - supportThumbBase\.z/.test(poseProbeSource) &&
    /thumbOppositionDot:\s*supportThumbAxis\.dot\(supportOpposingFingerAxis\)/.test(poseProbeSource) &&
    /palmUpAlignment:\s*supportPalmNormal\.y/.test(poseProbeSource) &&
    /crossBarrelAlignment:\s*supportHandAxis\.x/.test(poseProbeSource) &&
    /upwardWrap:\s*supportMiddleDistal\.y - supportMiddleBase\.y/.test(poseProbeSource) &&
    /supportTravel:\s*supportWrist\.distanceTo\(SUPPORT_GRIP\)/.test(poseProbeSource) &&
    /supportRise:\s*supportWrist\.y - SUPPORT_GRIP\.y/.test(poseProbeSource) &&
    /handPose:\s*\(\)\s*=>\s*safeCall\(weapon\?\.hands, ['"]getPoseProbe['"]\)/.test(mainSource) &&
    /document\.body\.dataset\.qaPlayerHand\s*=\s*JSON\.stringify\(playerHandProbe\)/.test(mainSource),
  'the live QA probe exposes a stable lowered firing elbow, aligned hand, trigger contact, thumb opposition, and capped reload travel',
);
const fingerPoseSource = handsSource.match(
  /const FINGER_CURL_POSES\s*=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/,
)?.[1] ?? '';
const fingerPosesFor = (side) => {
  const body = fingerPoseSource.match(new RegExp(
    `${side}:\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\n\\s*\\}\\)`,
  ))?.[1] ?? '';
  return new Map([...body.matchAll(/(\d):\s*Object\.freeze\(\[([^\]]+)\]\)/g)].map((match) => [
    Number(match[1]),
    match[2].split(',').map(Number),
  ]));
};
const rightFingerPoses = fingerPosesFor('right');
const leftFingerPoses = fingerPosesFor('left');
const triggerIndexPose = rightFingerPoses.get(1);
const littleFingerPose = rightFingerPoses.get(4);
assert(
  Boolean(triggerIndexPose) && triggerIndexPose[0] >= 0.55 &&
    triggerIndexPose[1] >= 0.4 && triggerIndexPose[2] >= 0.4 &&
    [2, 3, 4].every((finger) => {
      const wrap = rightFingerPoses.get(finger);
      return wrap?.[0] >= 0.9 && wrap?.[1] >= 1.0 && wrap?.[2] >= 0.95 &&
        wrap?.every((angle, segment) => Math.abs(angle - littleFingerPose[segment]) < 1e-6);
    }),
  'the firing index closes onto the trigger while the remaining three fingers share one tight circular grip bend',
);
const rocketboxFingerBones = new Set(
  handsFbxBytes.toString('latin1').match(/Bip01 [LR] Finger[0-4](?:[12])?(?!\d)/g) ?? [],
);
const fingerPoseMethodSource = handsSource.match(
  /_poseFingers\(side, curl, weight, excludeThumb = false\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*_weaponPoint/,
)?.[1] ?? '';
assert(
  rocketboxFingerBones.size === 30 &&
    [...rocketboxFingerBones].filter((name) => name.includes(' L ')).length === 15 &&
    [...rocketboxFingerBones].filter((name) => name.includes(' R ')).length === 15 &&
    rightFingerPoses.size === 5 && leftFingerPoses.size === 5 &&
    [...rightFingerPoses.values(), ...leftFingerPoses.values()].every((pose) => pose.length === 3) &&
    /this\.fingerRest\.set\(bone, bone\.quaternion\.clone\(\)\)/.test(handsSource) &&
    /suffix\.length === 1[\s\S]*?\? 0[\s\S]*?Number\.parseInt\(suffix\.slice\(1\), 10\)[\s\S]*?1, 2/.test(fingerPoseMethodSource) &&
    /pose\?\.\[finger\]\?\.\[segment\]/.test(fingerPoseMethodSource) &&
    /finger === 0 && excludeThumb/.test(fingerPoseMethodSource) &&
    /this\._poseFingers\(['"]right['"],\s*1,\s*response,\s*true\)/.test(handsUpdateSource) &&
    /this\._aimBoneXAxis\(this\.rig\.right\.indexBase, this\._triggerFingerGuideWorld, 1\)/.test(handsUpdateSource) &&
    /this\._aimBoneXAxis\(this\.rig\.right\.indexMiddle, this\._triggerContactWorld, 1\)/.test(handsUpdateSource) &&
    /this\._aimBoneXAxis\(this\.rig\.right\.indexDistal, this\._triggerFingerPadWorld, 1\)/.test(handsUpdateSource) &&
    /this\._aimBoneXAxis\(this\.rig\.right\.thumbBase, this\._firingThumbBridgeWorld, 1\)/.test(handsUpdateSource) &&
    /this\._aimBoneXAxis\(this\.rig\.right\.thumbMiddle, this\._firingThumbContactWorld, 1\)/.test(handsUpdateSource) &&
    /this\._aimBoneXAxis\(this\.rig\.right\.thumbDistal, this\._firingThumbPadWorld, 1\)/.test(handsUpdateSource),
  'all 30 Rocketbox finger bones receive independent poses while both thumbs use explicit surface-wrap solves',
);
assert(
  /this\.magazine\.getWorldPosition\(this\._magazineWorld\)/.test(handsUpdateSource) &&
    /this\.chargingHandle\.getWorldPosition\(this\._chargingWorld\)/.test(handsUpdateSource) &&
    /this\._weaponPoint\(MAGAZINE_POUCH, this\._magazinePouchWorld\)/.test(handsUpdateSource) &&
    /leftMode\s*=\s*['"]magazine['"]/.test(handsUpdateSource) &&
    !/leftMode\s*=\s*['"]charging['"]/.test(handsUpdateSource) &&
    /phase\(reloadProgress,\s*0\.73,\s*0\.86\)/.test(handsUpdateSource) &&
    /leftMode\s*=\s*returnProgress < 1 \? ['"]return['"] : ['"]support['"]/.test(handsUpdateSource) &&
    /this\._poseFingers\(\s*['"]right['"],\s*1[\s\S]*?this\._poseFingers\(\s*['"]left['"]/.test(handsUpdateSource),
  'reload choreography uses a compact pouch, then returns directly to the foregrip without a charging-handle overshoot',
);

// Load the real Rocketbox FBX and solve its real bones in Node. Texture image
// decoding is the only browser facility replaced here; FBX parsing, skeleton
// binding, IK, finger posing, trigger contact and the reload sweep all execute
// through FirstPersonHands itself.
const threePoseModuleUrl = new URL('../vendor/three/build/three.module.min.js', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: threePoseModuleUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

class NodePoseProbeImage {
  constructor() {
    this._listeners = new Map();
    this.complete = false;
    this.naturalWidth = 1;
    this.naturalHeight = 1;
  }

  addEventListener(type, callback) {
    this._listeners.set(type, callback);
  }

  removeEventListener(type) {
    this._listeners.delete(type);
  }

  set src(value) {
    this._src = value;
    this.complete = true;
    queueMicrotask(() => this._listeners.get('load')?.call(this));
  }

  get src() {
    return this._src;
  }
}

const hadPoseProbeDocument = 'document' in globalThis;
const originalPoseProbeDocument = globalThis.document;
const originalPoseProbeFetch = globalThis.fetch;
globalThis.document = {
  createElementNS(_namespace, tag) {
    if (tag === 'img') return new NodePoseProbeImage();
    throw new Error(`Unexpected DOM element requested by hand probe: ${tag}`);
  },
};
globalThis.fetch = async (input, init) => {
  const href = input instanceof URL
    ? input.href
    : typeof input === 'string' ? input : input.url;
  if (!href.startsWith('file:')) return originalPoseProbeFetch(input, init);
  const bytes = await readFile(fileURLToPath(href));
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return {
    status: 200,
    statusText: 'OK',
    url: href,
    // Three's FileLoader deliberately takes its deterministic non-streaming
    // response branch for this local-file adapter.
    body: undefined,
    headers: new Headers({ 'Content-Length': String(bytes.byteLength) }),
    arrayBuffer: async () => arrayBuffer,
    text: async () => bytes.toString('utf8'),
    blob: async () => new Blob([bytes]),
  };
};

let executableHands = null;
let baseHandPose = null;
let aimHandPose = null;
let sprintHandPose = null;
let maxSprintRearElbowStep = 0;
let maxSprintRearArmTurnDegrees = 0;
let maxSprintRearElbowStepFrame = -1;
let maxSprintRearElbowStepBlend = 0;
let maxSprintRearElbowStepFrom = null;
let maxSprintRearElbowStepTo = null;
let maxReloadSupportTravel = 0;
let maxReloadSupportRise = 0;
let handPoseProbeError = null;
const reloadSupportModes = new Set();
try {
  const PoseTHREE = await import('three');
  const { FirstPersonHands } = await import('../src/first-person-hands.js');
  const poseCamera = new PoseTHREE.PerspectiveCamera(68, 16 / 9, 0.05, 500);
  const poseWeaponRoot = new PoseTHREE.Group();
  poseCamera.add(poseWeaponRoot);
  executableHands = new FirstPersonHands(poseCamera, poseWeaponRoot);
  await executableHands.load();
  executableHands.update(0, {
    enabled: true,
    ads: 0,
    sprint: 0,
    reloading: false,
    reloadProgress: 0,
  });
  baseHandPose = executableHands.getPoseProbe();

  poseWeaponRoot.position.set(0, -0.14, -0.405);
  poseWeaponRoot.rotation.set(0, 0, 0, 'YXZ');
  poseWeaponRoot.updateMatrixWorld(true);
  executableHands.update(0, {
    enabled: true,
    ads: 1,
    sprint: 0,
    reloading: false,
    reloadProgress: 0,
  });
  aimHandPose = executableHands.getPoseProbe();

  poseWeaponRoot.position.set(0.08, -0.24, -0.3);
  poseWeaponRoot.rotation.set(-0.42, 0.3, 0.55, 'YXZ');
  poseWeaponRoot.updateMatrixWorld(true);
  executableHands.update(0, {
    enabled: true,
    ads: 0,
    sprint: 1,
    reloading: false,
    reloadProgress: 0,
  });
  sprintHandPose = executableHands.getPoseProbe();

  // Reproduce the real Shift transition instead of teleporting straight to
  // the final sprint pose. The weapon and hand solver receive separately
  // damped blends in production, so a discontinuous elbow-pole choice only
  // appears while crossing the intermediate orientations.
  const transitionHipPosition = new PoseTHREE.Vector3(0.255, -0.255, -0.37);
  const transitionSprintPosition = new PoseTHREE.Vector3(0.08, -0.24, -0.3);
  const transitionTargetPosition = new PoseTHREE.Vector3();
  const transitionTargetEuler = new PoseTHREE.Euler(0, 0, 0, 'YXZ');
  const transitionTargetQuaternion = new PoseTHREE.Quaternion();
  let transitionSprintBlend = 0;
  poseWeaponRoot.position.copy(transitionHipPosition);
  poseWeaponRoot.quaternion.identity();
  poseWeaponRoot.updateMatrixWorld(true);
  executableHands.update(0, {
    enabled: true,
    ads: 0,
    sprint: 0,
    reloading: false,
    reloadProgress: 0,
  });
  let previousTransitionPose = executableHands.getPoseProbe();
  for (let step = 0; step < 540; step += 1) {
    const enteringSprint = step % 180 < 90;
    const sprintTarget = enteringSprint ? 1 : 0;
    const sprintLambda = enteringSprint ? 12 : 16;
    transitionSprintBlend = PoseTHREE.MathUtils.damp(
      transitionSprintBlend,
      sprintTarget,
      sprintLambda,
      1 / 60,
    );
    transitionTargetPosition.copy(transitionHipPosition)
      .lerp(transitionSprintPosition, transitionSprintBlend);
    poseWeaponRoot.position.x = PoseTHREE.MathUtils.damp(
      poseWeaponRoot.position.x,
      transitionTargetPosition.x,
      17,
      1 / 60,
    );
    poseWeaponRoot.position.y = PoseTHREE.MathUtils.damp(
      poseWeaponRoot.position.y,
      transitionTargetPosition.y,
      17,
      1 / 60,
    );
    poseWeaponRoot.position.z = PoseTHREE.MathUtils.damp(
      poseWeaponRoot.position.z,
      transitionTargetPosition.z,
      24,
      1 / 60,
    );
    transitionTargetEuler.set(
      -0.42 * transitionSprintBlend,
      0.3 * transitionSprintBlend,
      0.55 * transitionSprintBlend,
      'YXZ',
    );
    transitionTargetQuaternion.setFromEuler(transitionTargetEuler);
    poseWeaponRoot.quaternion.slerp(
      transitionTargetQuaternion,
      1 - Math.exp(-18 / 60),
    );
    poseWeaponRoot.updateMatrixWorld(true);
    executableHands.update(1 / 60, {
      enabled: true,
      ads: 0,
      sprint: transitionSprintBlend,
      reloading: false,
      reloadProgress: 0,
    });
    const transitionPose = executableHands.getPoseProbe();
    const elbowStep = Math.hypot(...transitionPose.firing.elbow.map(
      (value, index) => value - previousTransitionPose.firing.elbow[index],
    ));
    const forearmDot = PoseTHREE.MathUtils.clamp(
      transitionPose.firing.forearmAxis.reduce(
        (sum, value, index) => sum + value * previousTransitionPose.firing.forearmAxis[index],
        0,
      ),
      -1,
      1,
    );
    if (elbowStep > maxSprintRearElbowStep) {
      maxSprintRearElbowStep = elbowStep;
      maxSprintRearElbowStepFrame = step;
      maxSprintRearElbowStepBlend = transitionSprintBlend;
      maxSprintRearElbowStepFrom = [...previousTransitionPose.firing.elbow];
      maxSprintRearElbowStepTo = [...transitionPose.firing.elbow];
    }
    maxSprintRearArmTurnDegrees = Math.max(
      maxSprintRearArmTurnDegrees,
      PoseTHREE.MathUtils.radToDeg(Math.acos(forearmDot)),
    );
    previousTransitionPose = transitionPose;
  }

  poseWeaponRoot.position.set(0, 0, 0);
  poseWeaponRoot.rotation.set(0, 0, 0, 'YXZ');
  poseWeaponRoot.updateMatrixWorld(true);

  for (let step = 0; step <= 100; step += 1) {
    executableHands.update(0, {
      enabled: true,
      ads: 0,
      sprint: 0,
      reloading: true,
      reloadProgress: step / 100,
    });
    const reloadPose = executableHands.getPoseProbe();
    maxReloadSupportTravel = Math.max(maxReloadSupportTravel, reloadPose.reload.supportTravel);
    maxReloadSupportRise = Math.max(maxReloadSupportRise, reloadPose.reload.supportRise);
    reloadSupportModes.add(reloadPose.reload.supportMode);
  }
} catch (error) {
  handPoseProbeError = error;
} finally {
  executableHands?.dispose();
  globalThis.fetch = originalPoseProbeFetch;
  if (hadPoseProbeDocument) globalThis.document = originalPoseProbeDocument;
  else delete globalThis.document;
}
assert(
  !handPoseProbeError && baseHandPose?.ready && baseHandPose.contract?.version === 11 &&
    baseHandPose.fingerBoneCount === 30 && baseHandPose.firing.handBoneAlignment === 'weapon_parallel_from_above' &&
    baseHandPose.firing.handDownturnDegrees === 0 &&
    baseHandPose.firing.handTiltDegrees === 0 &&
    baseHandPose.firing.rearViewSilhouetteSlope <= 0.02 &&
    baseHandPose.firing.topViewSlope <= 0.02 &&
    baseHandPose.firing.elbowLowered === true &&
    baseHandPose.firing.forearmVerticalDelta >= 0.06 && baseHandPose.firing.forearmVerticalDelta <= 0.09 &&
    baseHandPose.firing.triggerContactDistance <= 0.003 &&
    baseHandPose.firing.triggerContactT > 0.8 &&
    baseHandPose.firing.indexKnuckleLeft <= -0.01 &&
    baseHandPose.firing.indexOverallLeft <= -0.005 &&
    baseHandPose.firing.indexPadAlignment >= 0.98 &&
    baseHandPose.firing.thumbHooksAcrossGrip === true &&
    baseHandPose.firing.thumbRearClearance >= -0.01,
  `the executable Rocketbox probe keeps the rear hand vertical from above, tightly hooks the trigger, and retains the thumb wrap (${JSON.stringify(baseHandPose?.firing ?? null)})`,
);
assert(
  !handPoseProbeError && baseHandPose?.support.crossBarrelAlignment >= 0.98 &&
    baseHandPose.support.palmUpAlignment >= 0.98 && baseHandPose.support.upwardWrap >= 0.04 &&
    baseHandPose.support.thumbInwardWrap >= 0.015 && baseHandPose.support.thumbBarrelHeight <= 0.03 &&
    baseHandPose.support.thumbDownwardCurl <= -0.01 && baseHandPose.support.thumbForwardLean <= -0.003 &&
    baseHandPose.support.thumbOppositionDot < 0 &&
    baseHandPose.support.wristError <= 0.005,
  'the executable Rocketbox probe keeps a raised diagonal support palm beneath the barrel while its fingers curl upward and its thumb hooks inward, forward, and down around the handguard',
);
assert(
  !handPoseProbeError && aimHandPose?.ready && aimHandPose.firing.wristError <= 0.005 &&
    aimHandPose.support.wristError <= 0.005 && aimHandPose.firing.topViewSlope <= 0.02 &&
    aimHandPose.firing.triggerContactDistance <= 0.003,
  `the ADS armature keeps both hands and the trigger finger attached to the rifle (${JSON.stringify(aimHandPose ?? null)})`,
);
assert(
  !handPoseProbeError && sprintHandPose?.sprint.blend === 1 &&
    sprintHandPose.firing.handForearmAlignmentDot >= 0.9 &&
    sprintHandPose.firing.forearmVerticalDelta >= -0.03 && sprintHandPose.firing.forearmVerticalDelta <= 0.18 &&
    sprintHandPose.sprint.handPose === 'same_as_hip_weapon_local' &&
    sprintHandPose.firing.handAxis.every((value, index) =>
      Math.abs(value - baseHandPose.firing.handAxis[index]) <= 0.001) &&
    sprintHandPose.firing.palmNormal.every((value, index) =>
      Math.abs(value - baseHandPose.firing.palmNormal[index]) <= 0.001) &&
    Math.abs(sprintHandPose.firing.handTiltDegrees - baseHandPose.firing.handTiltDegrees) <= 0.001 &&
    sprintHandPose.firing.triggerContactDistance <= 0.02 &&
    sprintHandPose.firing.wristError <= 0.015 && sprintHandPose.support.wristError <= 0.015,
  `the sprint solve turns both arms and the rear glove with the rifle while retaining both grip contacts (${JSON.stringify(sprintHandPose ?? null)})`,
);
assert(
  !handPoseProbeError && maxSprintRearElbowStep <= 0.03 && maxSprintRearArmTurnDegrees <= 8,
  `the live Shift transition keeps the rear arm on one continuous elbow branch without a one-frame flip (max elbow step ${maxSprintRearElbowStep.toFixed(4)} m at frame ${maxSprintRearElbowStepFrame}, blend ${maxSprintRearElbowStepBlend.toFixed(4)}, from ${JSON.stringify(maxSprintRearElbowStepFrom)} to ${JSON.stringify(maxSprintRearElbowStepTo)}; max forearm turn ${maxSprintRearArmTurnDegrees.toFixed(2)} deg)`,
);
assert(
  !handPoseProbeError && baseHandPose?.reload.compactTravelLimit === 0.235 &&
    maxReloadSupportTravel <= baseHandPose.reload.compactTravelLimit + 0.00001 &&
    baseHandPose.reload.maxSupportRise === 0.025 &&
    maxReloadSupportRise <= baseHandPose.reload.maxSupportRise + 0.00001 &&
    ['magazine', 'return', 'support'].every((mode) => reloadSupportModes.has(mode)) &&
    !reloadSupportModes.has('charging'),
  'the exhaustive 101-step live reload sweep caps total travel/rise and settles on the handguard without reversing direction',
);
assert(
  /const hardSurfaceHit\s*=\s*hit\?\.point && !hit\.enemy && hit\.material !== ['"]body['"]/.test(weaponSource) &&
    /if \(hardSurfaceHit\) \{[\s\S]*?this\._spawnImpact\(hit\)/.test(weaponSource) &&
    /new THREE\.Mesh\(this\.impactGeometry, this\.impactMaterial\.clone\(\)\)/.test(weaponSource),
  'hard surfaces receive independent fading impact marks while successful body hits never show obstacle glow',
);
const opaqueWeaponMaterialSource = pbrWeaponLoadSource.match(
  /model\.traverse\(\(child\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/,
)?.[1] ?? '';
const opticHousingSource = aimSightSource.match(
  /const housingMaterial\s*=\s*new THREE\.MeshStandardMaterial\(\{([\s\S]*?)\n\s*\}\);/,
)?.[1] ?? '';
const opticHardwareSource = aimSightSource.match(
  /const edgeMaterial\s*=\s*new THREE\.MeshStandardMaterial\(\{([\s\S]*?)\n\s*\}\);/,
)?.[1] ?? '';
assert(
  /child\.material\.depthTest\s*=\s*true/.test(opaqueWeaponMaterialSource) &&
    /child\.material\.depthWrite\s*=\s*true/.test(opaqueWeaponMaterialSource) &&
    /transparent:\s*false/.test(opticHousingSource) && /depthTest:\s*true/.test(opticHousingSource) &&
    /depthWrite:\s*true/.test(opticHousingSource) && /opacity:\s*1/.test(opticHousingSource) &&
    /transparent:\s*false/.test(opticHardwareSource) && /depthTest:\s*true/.test(opticHardwareSource) &&
    /depthWrite:\s*true/.test(opticHardwareSource),
  'opaque rifle and optic surfaces use the depth buffer instead of intermittently drawing as flashing rectangles',
);
assert(
  (weaponSource.match(/this\._updateEffects\(activeDt\)/g) ?? []).length === 1,
  'weapon transient effects advance exactly once per frame',
);

const sprintPose = weaponSource.match(
  /this\.sprintPosition\s*=\s*new THREE\.Vector3\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/,
);
assert(
  Boolean(sprintPose) && Number(sprintPose[2]) <= -0.22 && Number(sprintPose[3]) >= -0.32,
  'sprint tucks the rifle while retaining a readable cross-body silhouette',
);
const sprintPitch = Number(
  weaponSource.match(/const functionalPitch\s*=\s*(-?[\d.]+)\s*\*\s*poseSprint/)?.[1],
);
const sprintYaw = Number(
  weaponSource.match(/const functionalYaw\s*=\s*(-?[\d.]+)\s*\*\s*poseSprint/)?.[1],
);
const sprintRoll = Number(
  weaponSource.match(/const functionalRoll\s*=\s*(-?[\d.]+)\s*\*\s*poseSprint/)?.[1],
);
assert(
  sprintPitch <= -0.35 && sprintYaw >= 0.25 && sprintRoll >= 0.45 &&
    Number(sprintPose?.[1]) <= 0.1 && /target\.lerp\(this\.sprintPosition, poseSprint\)/.test(weaponSource),
  'sprint pitches and folds the weapon left across the chest away from the firing line',
);

// Enemy ballistics originate from the animated weapon and movement uses a
// full body radius with sliding fallbacks instead of point-like wall crossing.
assert(
  /this\.lowerBodyGeometry\s*=\s*new THREE\.BoxGeometry\(0\.5,\s*0\.84,\s*0\.38\)/.test(enemiesSource) &&
    /lowerBody\.position\.set\(0,\s*0\.4,\s*0\)/.test(enemiesSource) &&
    /this\.proxyData\.set\(lowerBody,\s*\{\s*enemy,\s*region:\s*['"]limb['"]\s*\}\)/.test(enemiesSource) &&
    /this\.hitProxies\.push\(head,\s*torso,\s*lowerBody\)/.test(enemiesSource),
  'the visible lower body remains hittable before or after a guard is alerted',
);
const enemyDamageSource = enemiesSource.match(/damage\(target,[\s\S]*?\n\s*}\n\n\s*surrenderRusk\(/)?.[0] ?? '';
assert(
  /hitRegion === ['"]limb['"][\s\S]*?standardGuard && unawareAtImpact[\s\S]*?enemy\.maxHealth \/ 2[\s\S]*?enemy\.maxHealth \/ 4[\s\S]*?Math\.max\(raw,\s*limbFloor\)/.test(enemyDamageSource) &&
    !/if\s*\([^)]*enemy\.alerted[^)]*\)\s*(?:return|\{[\s\S]{0,120}?return)/.test(enemyDamageSource),
  'arm damage is effective before detection, visibly stronger on an unaware standard guard, and never gated on alert state',
);
assert(
  /const unawareAtImpact\s*=\s*!enemy\.alerted\s*&&\s*!enemy\.hasLOS/.test(enemyDamageSource) &&
  /const standardGuard\s*=\s*!enemy\.isRusk\s*&&\s*!enemy\.isCellLeader/.test(enemyDamageSource) &&
    /else\s*\{[\s\S]*?applied\s*=\s*Math\.max\(raw,\s*enemy\.maxHealth \/ 3\)/.test(enemyDamageSource) &&
    !/applied\s*=\s*[^;]*(?:alerted|hasLOS|hasFired|reaction)/.test(enemyDamageSource),
  'centre-mass damage uses one state-independent rule before or after detection and hostile fire',
);
assert(
  /if\s*\(unawareAtImpact\)\s*\{[\s\S]*?enemy\.shotTimer\s*=\s*Math\.max\(finite\(enemy\.shotTimer\),\s*0\.24\)/.test(enemyDamageSource) &&
    /hasFiredAtImpact,[\s\S]*?reactionAtImpact,[\s\S]*?balanceRule/.test(enemyDamageSource),
  'a surviving unaware target has a short response delay while diagnostics retain its exact pre-impact combat state',
);
const sightRange = Number(enemiesSource.match(/const SIGHT_RANGE\s*=\s*([\d.]+)/)?.[1]);
const hearingRange = Number(enemiesSource.match(/const HEARING_RANGE\s*=\s*([\d.]+)/)?.[1]);
assert(sightRange >= 48 && hearingRange >= 45, 'guards have practical sight and weapon-hearing ranges');
assert(
  /const ALERTED_FOV_COSINE/.test(enemiesSource) && /enemy\.alerted \? ALERTED_FOV_COSINE : FOV_COSINE/.test(enemiesSource),
  'alerted guards broaden their field of view instead of ignoring the player',
);
assert(
  /_raiseLocalAlert\(enemy, playerEye, ['"]visual['"]\)/.test(enemiesSource) &&
    /this\.facilityAlerted\s*=\s*true/.test(enemiesSource) &&
    /this\.facilityAlertCount \+= 1/.test(enemiesSource) &&
    /for \(const enemy of this\.enemies\)[\s\S]*?enemy\.alerted = true[\s\S]*?enemy\.lastKnownPlayer\.copy\(position\)/.test(enemiesSource),
  'the first visual contact raises one facility-wide alert and shares the player bearing with every active group',
);
assert(
  /reaction:\s*0\.055 \+ random\(\) \* 0\.09/.test(enemiesSource) &&
    /enemy\.losTimer\s*=\s*0\.055 \+ enemy\.random\(\) \* 0\.06/.test(enemiesSource) &&
    /enemy\.shotTimer\s*=\s*Math\.min\(enemy\.shotTimer, 0\.08 \+ enemy\.random\(\) \* 0\.07\)/.test(enemiesSource) &&
    /enemy\.aimSettle < 0\.16/.test(enemiesSource) &&
    /_alertAlliesToCasualty\(downed\)[\s\S]*?CASUALTY_IMMEDIATE_RANGE[\s\S]*?ally\.reaction = 0/.test(enemiesSource),
  'visual contact and ally casualties produce a fast shouldered response instead of a multi-second idle delay',
);
assert(
  /const muzzle = new THREE\.Object3D\(\);[\s\S]*?muzzle\.name = `M4A1_Muzzle_\$\{enemy\.id\}`[\s\S]*?weapon\.add\(muzzle\)/.test(enemiesSource),
  'each enemy rifle owns a child muzzle marker',
);
assert(
  /_getMuzzleOrigin\(enemy\)[\s\S]*?enemy\.muzzle\.getWorldPosition\(new THREE\.Vector3\(\)\)/.test(enemiesSource),
  'enemy shot origin is read from the animated muzzle world position',
);
assert(
  !/new THREE\.Vector3\(0,\s*1\.4[0-9]*,\s*0\)/.test(enemiesSource),
  'enemy fire no longer uses the old hard-coded head-height origin',
);
assert(
  /_fire\(enemy,[\s\S]*?const origin = this\._getMuzzleOrigin\(enemy\)[\s\S]*?if \(this\._segmentBlocked\(origin, target\)\) return false;/.test(enemiesSource),
  'enemy fire requires a clear muzzle-to-target lane',
);
assert(
  /const broadPhaseWorldHit\s*=\s*this\._isBallisticPermeableHit\(worldHit\) \? null : worldHit/.test(enemiesSource) &&
    /this\._refineWorldOcclusion\(start, dir, broadPhaseWorldHit, requestedDistance\)/.test(enemiesSource) &&
    /const hasWorldBallisticRaycast\s*=\s*typeof this\.world\?\.raycastWorld === ['"]function['"]/.test(enemiesSource) &&
    /if \(!hasWorldBallisticRaycast && this\._segmentBlocked\(start, hit\.point\)\) \{[\s\S]*?reason:\s*['"]legacy_segment_blocked['"][\s\S]*?continue;/.test(enemiesSource) &&
    /permeableWorldHitIgnored:\s*Boolean\(worldHit && !broadPhaseWorldHit\)/.test(enemiesSource) &&
    /worldBroadPhaseRejected:\s*refinedWorld\.rejected/.test(enemiesSource) &&
    /getLastRaycastDiagnostic\(\)[\s\S]*?this\.lastRaycastDiagnostic/.test(enemiesSource) &&
    /probeShot:[\s\S]*?getLastRaycastDiagnostic/.test(mainSource),
  'enemy raycasts ignore permeable fencing, validate broad colliders against rendered surfaces, and expose deterministic diagnostics',
);

// Import EnemyDirector against the vendored Three.js runtime without invoking
// browser-only asset loaders. This exercises the real proxy refresh, world
// occlusion and damage paths rather than accepting source-text evidence alone.
const enemiesRuntimePath = join(root, 'src/enemies.js');
const threeRuntimePath = join(root, 'vendor/three/build/three.module.min.js');
const threeRuntimeUrl = pathToFileURL(threeRuntimePath).href;
let executableEnemiesSource = enemiesSource
  .replace("import * as THREE from 'three';", `import * as THREE from ${JSON.stringify(threeRuntimeUrl)};`)
  .replace(
    "import { FBXLoader } from '../vendor/three/examples/jsm/loaders/FBXLoader.js';",
    'class FBXLoader {}',
  )
  .replace(
    "import * as SkeletonUtils from '../vendor/three/examples/jsm/utils/SkeletonUtils.js';",
    'const SkeletonUtils = { clone: (value) => value.clone(true) };',
  )
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(enemiesRuntimePath).href));
const { EnemyDirector: ExecutableEnemyDirector } = await import(
  `data:text/javascript;base64,${Buffer.from(executableEnemiesSource).toString('base64')}`
);
const THREE = await import(threeRuntimeUrl);
const makeEnemyProbeDirector = (world, callbacks = {}) => {
  const director = new ExecutableEnemyDirector(new THREE.Scene(), world, callbacks);
  director.characterTemplate = new THREE.Group();
  // A lightweight weapon group exercises the real shouldered-weapon proxy
  // without invoking browser-only FBX loading.
  director.weaponTemplate = new THREE.Group();
  director.clips = {};
  director.loaded = true;
  return director;
};
const spawnEnemyProbe = (director, id, combatState) => {
  const enemy = director.spawnGroup({
    id: `probe_group_${id}`,
    spawns: [{ id, position: new THREE.Vector3(0, 0, 10) }],
  })[0];
  Object.assign(enemy, combatState);
  return enemy;
};
const fireEnemyProbe = (director, enemy, region, amount) => {
  const origin = new THREE.Vector3(enemy.root.position.x, region === 'head' ? 1.64 : 1.14, enemy.root.position.z - 10);
  const hit = director.raycast(origin, new THREE.Vector3(0, 0, 1), 30);
  const result = hit ? director.damage(hit, amount, region, { sourcePosition: origin }) : null;
  return { hit, result, diagnostic: director.getLastShotDiagnostic() };
};
const directBallisticWorld = Object.freeze({
  raycastWorld: () => null,
  segmentBlocked: () => false,
});

const facilityAlertEvents = [];
const facilityAlertDirector = makeEnemyProbeDirector(directBallisticWorld, {
  onAlert: (enemy, event) => facilityAlertEvents.push({ enemy: enemy.id, reason: event.reason }),
});
const facilityGuards = [
  facilityAlertDirector.spawnGroup({
    id: 'outside',
    spawns: [{ id: 'outside_alert_probe', position: new THREE.Vector3(-4, 0, 10) }],
  })[0],
  facilityAlertDirector.spawnGroup({
    id: 'inside',
    spawns: [{ id: 'inside_alert_probe', position: new THREE.Vector3(0, 0, 10) }],
  })[0],
  facilityAlertDirector.spawnGroup({
    id: 'technical',
    spawns: [{
      id: 'technical_alert_probe',
      position: new THREE.Vector3(4, 0, 10),
      technician: true,
      workPosition: new THREE.Vector3(4, 0, 10),
    }],
  })[0],
];
const exteriorPlayerEye = new THREE.Vector3(0, 1.62, 86);
facilityAlertDirector._raiseLocalAlert(facilityGuards[0], exteriorPlayerEye, 'visual');
facilityAlertDirector._raiseLocalAlert(facilityGuards[1], exteriorPlayerEye, 'visual');
for (let frame = 0; frame < 12; frame += 1) {
  facilityAlertDirector.update(0.075, {
    position: new THREE.Vector3(0, 0, 86),
    eyePosition: exteriorPlayerEye,
    velocity: new THREE.Vector3(),
    alive: true,
    paused: false,
  });
}
assert(
  facilityAlertDirector.facilityAlerted && facilityAlertDirector.facilityAlertCount === 1 &&
    facilityAlertEvents.length === 1 &&
    facilityGuards.every((enemy) => enemy.alerted && enemy.hasLOS && enemy.hasFired) &&
    facilityGuards.some((enemy) => enemy.technician && enemy.state === 'attack'),
  'one facility alert wakes every squad once, and even an indoor technical guard sees and fires on a clear exterior target',
);
facilityAlertDirector.dispose();

const extremeDirector = makeEnemyProbeDirector(directBallisticWorld);
extremeDirector.setDifficulty({
  id: 'extreme',
  enemyHealthMultiplier: 1.8,
  concealedVests: true,
});
const extremeEnemy = spawnEnemyProbe(extremeDirector, 'extreme_vest_probe', {
  alerted: true,
  hasLOS: true,
  state: 'attack',
});
const extremeTorso = extremeDirector.damage(extremeEnemy, 36, 'torso', {
  sourcePosition: new THREE.Vector3(0, 1.2, 0),
});
const extremeHead = extremeDirector.damage(extremeEnemy, 1, 'head', {
  sourcePosition: new THREE.Vector3(0, 1.6, 0),
});
assert(
  extremeEnemy.maxHealth === 180 && extremeTorso.damage === 3.6 && !extremeTorso.killed &&
    extremeHead.killed && extremeDirector.getLastDamageDiagnostic()?.balanceRule === 'extreme_head_lethal',
  'Extreme gives standard enemies 1.8x health, sharply reduces concealed-vest body damage, and keeps every headshot lethal',
);
extremeDirector.dispose();

const lowPipeBox = new THREE.Box3(
  new THREE.Vector3(-1, 0.58, 10.68),
  new THREE.Vector3(1, 1.02, 11.08),
);
const lowVaultDirector = makeEnemyProbeDirector({
  ...directBallisticWorld,
  colliders: [{ id: 'LOW_PROCESS_PIPE', kind: 'pipe', blocking: true, box: lowPipeBox }],
  groundHeightAt: () => 0,
});
const lowVaultEnemy = spawnEnemyProbe(lowVaultDirector, 'low_vault_probe', {
  alerted: true,
  state: 'investigate',
});
const vaultStarted = lowVaultDirector._startLowVault(
  lowVaultEnemy,
  lowVaultEnemy.root.position.clone(),
  new THREE.Vector3(0, 0, 14),
);
for (let step = 0; step < 10; step += 1) lowVaultDirector._updateLowVault(lowVaultEnemy, 0.1);
assert(
  vaultStarted && lowVaultEnemy.vault === null && lowVaultEnemy.vaultsCompleted === 1 &&
    lowVaultEnemy.root.position.z > lowPipeBox.max.z + 0.39,
  'reinforcing guards vault completely over a low process pipe and land beyond its movement collider',
);
lowVaultDirector.dispose();

const permeableFenceWorld = Object.freeze({
  raycastWorld: (origin, direction) => ({
    distance: 4,
    point: origin.clone().addScaledVector(direction, 4),
    ballistic: false,
    collider: { ballistic: false, ballisticPermeable: true },
  }),
  // A legacy broad-phase may report the fence, but the explicit ballistic
  // raycast contract above is authoritative and must let the round through.
  segmentBlocked: () => true,
});
const preFireShotMatrix = [];
for (const [lane, world] of [['direct', directBallisticWorld], ['fence', permeableFenceWorld]]) {
  for (const region of ['head', 'torso']) {
    for (const alerted of [false, true]) {
      for (const hasFired of [false, true]) {
        const id = `${lane}_${region}_${alerted ? 'alerted' : 'unalerted'}_${hasFired ? 'postfire' : 'prefire'}`;
        const director = makeEnemyProbeDirector(world);
        const enemy = spawnEnemyProbe(director, id, {
          alerted,
          hasLOS: alerted,
          hasFired,
          reaction: alerted ? 0 : 1,
          state: alerted ? 'attack' : 'patrol',
        });
        const shot = fireEnemyProbe(director, enemy, region, region === 'head' ? 110 : 36);
        preFireShotMatrix.push({ lane, region, alerted, hasFired, ...shot.diagnostic });
        director.dispose();
      }
    }
  }
}
assert(
  preFireShotMatrix.length === 16 && preFireShotMatrix.every((shot) => (
    shot.raycast?.accepted === true && shot.raycast.reason === 'live_enemy_proxy_hit' &&
    shot.damage?.accepted === true && /^damage_applied(?:_lethal)?$/.test(shot.damage.reason) &&
    shot.damage.appliedDamage > 0 && shot.damage.alertedAtImpact === shot.alerted &&
    shot.damage.hasFiredAtImpact === shot.hasFired &&
    shot.damage.raycastSerial === shot.raycast.serial &&
    (shot.region === 'head'
      ? shot.damage.killed
      : !shot.alerted && !shot.hasFired
        ? shot.damage.killed && shot.damage.balanceRule === 'unaware_standard_torso_lethal'
        : !shot.damage.killed && shot.damage.appliedDamage === 36) &&
    (shot.lane === 'fence' ? shot.raycast.permeableWorldHitIgnored : !shot.raycast.permeableWorldHitIgnored)
  )),
  'direct and chain-link opening torso shots visibly down unaware guards before detection or return fire',
);
const distantTreeWorld = Object.freeze({
  raycastWorld: (origin, direction) => ({
    distance: 8,
    point: origin.clone().addScaledVector(direction, 8),
    ballistic: false,
    collider: { id: 'TREE_TRUNK', kind: 'tree', blocking: true, ballistic: false },
  }),
  segmentBlocked: () => false,
});
const distantTreeDirector = makeEnemyProbeDirector(distantTreeWorld);
const distantTreeEnemy = spawnEnemyProbe(distantTreeDirector, 'distant_tree_lane', {
  alerted: false,
  hasLOS: false,
  hasFired: false,
  state: 'patrol',
});
distantTreeEnemy.root.position.z = 38;
distantTreeDirector._updateHitProxies(distantTreeEnemy);
const distantTreeOrigin = new THREE.Vector3(0, 1.14, 0);
const distantTreeHit = distantTreeDirector.raycast(distantTreeOrigin, new THREE.Vector3(0, 0, 1), 80);
const distantTreeDamage = distantTreeHit
  ? distantTreeDirector.damage(distantTreeHit, 36, distantTreeHit.region, { sourcePosition: distantTreeOrigin })
  : null;
assert(
  distantTreeHit?.enemy === distantTreeEnemy && distantTreeDamage?.killed === true &&
    distantTreeDirector.getLastShotDiagnostic().raycast?.permeableWorldHitIgnored === true &&
    distantTreeDirector.getLastShotDiagnostic().damage?.hasFiredAtImpact === false,
  'a distant unaware guard remains damageable through a tree lane before ever firing',
);
distantTreeDirector.dispose();
// Reproduce the reported yellow-impact failure: a visible hostile triangle sits
// only centimetres beyond an over-eager world collider, while the exact proxy
// misses at the side of the uniform. The rendered mesh must still own the shot
// before the cosmetic world-impact path can run.
const renderedColliderWorld = Object.freeze({
  raycastWorld: (origin, direction) => ({
    distance: 9.76,
    point: origin.clone().addScaledVector(direction, 9.76),
    collider: { id: 'OVERLAPPING_DOORFRAME_COLLIDER', ballistic: true },
  }),
  segmentBlocked: () => true,
});
const renderedMeshDirector = makeEnemyProbeDirector(renderedColliderWorld);
const renderedCharacter = new THREE.Group();
const renderedUniform = new THREE.Mesh(
  new THREE.BoxGeometry(0.8, 1.45, 0.24),
  new THREE.MeshBasicMaterial(),
);
renderedUniform.name = 'RenderedUniformProbe';
renderedUniform.position.y = 1.02;
renderedCharacter.add(renderedUniform);
renderedMeshDirector.characterTemplate = renderedCharacter;
const renderedMeshEnemy = spawnEnemyProbe(renderedMeshDirector, 'rendered_mesh_prefire', {
  alerted: false,
  hasLOS: false,
  hasFired: false,
  reaction: 1,
  state: 'patrol',
});
const renderedMeshOrigin = new THREE.Vector3(0.34, 1.14, 0);
const renderedMeshHit = renderedMeshDirector.raycast(
  renderedMeshOrigin,
  new THREE.Vector3(0, 0, 1),
  30,
);
const renderedMeshDamage = renderedMeshHit
  ? renderedMeshDirector.damage(
    renderedMeshHit,
    36,
    renderedMeshHit.region,
    { sourcePosition: renderedMeshOrigin },
  )
  : null;
const renderedMeshDiagnostic = renderedMeshDirector.getLastShotDiagnostic();
assert(
  renderedMeshHit?.enemy === renderedMeshEnemy && renderedMeshHit.renderedMeshHit === true &&
    renderedMeshDamage?.accepted === true && renderedMeshDamage.killed === true &&
    renderedMeshDiagnostic.raycast?.reason === 'live_enemy_render_mesh_hit' &&
    renderedMeshDiagnostic.raycast?.worldColliderId === 'OVERLAPPING_DOORFRAME_COLLIDER' &&
    renderedMeshDiagnostic.raycast?.enemyAlerted === false &&
    renderedMeshDiagnostic.raycast?.enemyHasFired === false &&
    renderedMeshDiagnostic.damage?.appliedDamage > 0,
  'a visible pre-alert uniform triangle overrides an overlapping world collider and applies damage instead of a yellow wall glow',
);
renderedMeshDirector.dispose();
const falseColliderVisual = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 2, 0.4),
  new THREE.MeshBasicMaterial(),
);
falseColliderVisual.position.set(4, 1, 4);
falseColliderVisual.updateMatrixWorld(true);
const falseBroadPhaseWorld = Object.freeze({
  raycastWorld: (origin, direction) => ({
    distance: 4,
    point: origin.clone().addScaledVector(direction, 4),
    object: falseColliderVisual,
    collider: { id: 'OVERBROAD_ROTATED_PROP_COLLIDER', ballistic: true },
  }),
  segmentBlocked: () => true,
});
const falseBroadPhaseDirector = makeEnemyProbeDirector(falseBroadPhaseWorld);
const falseBroadPhaseEnemy = spawnEnemyProbe(falseBroadPhaseDirector, 'false_broad_phase_prefire', {
  alerted: false,
  hasLOS: false,
  hasFired: false,
  reaction: 1,
  state: 'patrol',
});
const falseBroadPhaseOrigin = new THREE.Vector3(0, 1.14, 0);
const falseBroadPhaseHit = falseBroadPhaseDirector.raycast(
  falseBroadPhaseOrigin,
  new THREE.Vector3(0, 0, 1),
  30,
);
const falseBroadPhaseDamage = falseBroadPhaseHit
  ? falseBroadPhaseDirector.damage(
    falseBroadPhaseHit,
    36,
    falseBroadPhaseHit.region,
    { sourcePosition: falseBroadPhaseOrigin },
  )
  : null;
const falseBroadPhaseDiagnostic = falseBroadPhaseDirector.getLastShotDiagnostic();
assert(
  falseBroadPhaseHit?.enemy === falseBroadPhaseEnemy && falseBroadPhaseDamage?.killed === true &&
    falseBroadPhaseDiagnostic.raycast?.worldBroadPhaseRejected === true &&
    falseBroadPhaseDiagnostic.raycast?.worldBroadPhaseDistance === 4 &&
    falseBroadPhaseDiagnostic.raycast?.worldDistance === null &&
    falseBroadPhaseDiagnostic.raycast?.permeableWorldHitIgnored === false &&
    falseBroadPhaseDiagnostic.damage?.alertedAtImpact === false &&
    falseBroadPhaseDiagnostic.damage?.hasFiredAtImpact === false,
  'a false collider-box wall hit is rejected when its rendered prop misses the ray, allowing pre-fire enemy damage without a yellow decal',
);
falseBroadPhaseDirector.dispose();
falseColliderVisual.geometry.dispose();
falseColliderVisual.material.dispose();
const realWallVisual = new THREE.Mesh(
  new THREE.BoxGeometry(4, 4, 0.2),
  new THREE.MeshBasicMaterial(),
);
realWallVisual.position.set(0, 1.5, 5);
realWallVisual.updateMatrixWorld(true);
const realWallWorld = Object.freeze({
  raycastWorld: (origin, direction) => ({
    distance: 4.9,
    point: origin.clone().addScaledVector(direction, 4.9),
    object: realWallVisual,
    collider: { id: 'REAL_RENDERED_WALL', ballistic: true },
  }),
  segmentBlocked: () => true,
});
const realWallDirector = makeEnemyProbeDirector(realWallWorld);
spawnEnemyProbe(realWallDirector, 'behind_real_wall', {
  alerted: false,
  hasLOS: false,
  hasFired: false,
  state: 'patrol',
});
const realWallHit = realWallDirector.raycast(
  new THREE.Vector3(0, 1.14, 0),
  new THREE.Vector3(0, 0, 1),
  30,
);
const realWallDiagnostic = realWallDirector.getLastRaycastDiagnostic();
assert(
  realWallHit === null && realWallDiagnostic?.reason === 'solid_world_occlusion' &&
    realWallDiagnostic.worldBroadPhaseRejected === false &&
    Math.abs(realWallDiagnostic.worldDistance - 4.9) <= 0.001,
  'a real rendered wall still blocks an enemy behind it after broad-phase validation',
);
realWallDirector.dispose();
realWallVisual.geometry.dispose();
realWallVisual.material.dispose();
const unawareLimbDirector = makeEnemyProbeDirector(directBallisticWorld);
const unawareLimbEnemy = spawnEnemyProbe(unawareLimbDirector, 'unaware_limb', {
  alerted: false,
  hasLOS: false,
  hasFired: false,
  state: 'patrol',
});
const unawareLimbResult = unawareLimbDirector.damage(
  unawareLimbEnemy,
  22,
  'limb',
  { sourcePosition: new THREE.Vector3(0, 1.2, 0) },
);
const unawareLimbDiagnostic = unawareLimbDirector.getLastShotDiagnostic().damage;
assert(
  unawareLimbResult?.accepted === true && unawareLimbResult.damage === 50 &&
    unawareLimbEnemy.health === 50 && unawareLimbDiagnostic?.alertedAtImpact === false &&
    unawareLimbDiagnostic?.hasFiredAtImpact === false &&
    unawareLimbDiagnostic?.balanceRule === 'unaware_standard_limb_half_health_floor' &&
    unawareLimbEnemy.hitReact > 0,
  'an opening arm hit damages an unaware standard guard for half health and starts visible impact feedback before return fire',
);
unawareLimbDirector.dispose();
const unawareWeaponDirector = makeEnemyProbeDirector(directBallisticWorld);
const unawareWeaponEnemy = spawnEnemyProbe(unawareWeaponDirector, 'unaware_weapon', {
  alerted: false,
  hasLOS: false,
  hasFired: false,
  state: 'patrol',
});
const weaponSideOrigin = new THREE.Vector3(-0.14, 1.38, 30);
const weaponSideHit = unawareWeaponDirector.raycast(weaponSideOrigin, new THREE.Vector3(0, 0, -1), 30);
const weaponSideDamage = weaponSideHit
  ? unawareWeaponDirector.damage(weaponSideHit, 22, weaponSideHit.region, { sourcePosition: weaponSideOrigin })
  : null;
assert(
  weaponSideHit?.enemy === unawareWeaponEnemy && weaponSideHit.region === 'limb' &&
    weaponSideDamage?.accepted === true && weaponSideDamage.damage === 50 &&
    unawareWeaponEnemy.health === 50 &&
    unawareWeaponDirector.getLastShotDiagnostic().raycast?.enemyHasFired === false,
  `a real ray through an unaware guard rifle resolves to its weapon-side limb volume and applies damage before return fire (${JSON.stringify({ hit: weaponSideHit && { region: weaponSideHit.region, distance: weaponSideHit.distance, name: weaponSideHit.object?.name }, damage: weaponSideDamage && { accepted: weaponSideDamage.accepted, damage: weaponSideDamage.damage, region: weaponSideDamage.region }, health: unawareWeaponEnemy.health, diagnostic: unawareWeaponDirector.getLastShotDiagnostic() })})`,
);
unawareWeaponDirector.dispose();
const silhouetteStateMatrix = [];
for (const alerted of [false, true]) {
  const director = makeEnemyProbeDirector(directBallisticWorld);
  const enemy = spawnEnemyProbe(director, `silhouette_${alerted ? 'alerted' : 'unaware'}`, {
    alerted,
    hasLOS: alerted,
    hasFired: alerted,
    state: alerted ? 'attack' : 'patrol',
  });
  // x=.42 misses every exact box/weapon proxy but remains inside the visible
  // standing-character silhouette fallback radius.
  const origin = new THREE.Vector3(0.42, 1.1, 0);
  const hit = director.raycast(origin, new THREE.Vector3(0, 0, 1), 30);
  const result = hit ? director.damage(hit, 36, hit.region, { sourcePosition: origin }) : null;
  silhouetteStateMatrix.push({ alerted, hit, result, diagnostic: director.getLastShotDiagnostic() });
  director.dispose();
}
assert(
  silhouetteStateMatrix.every(({ alerted, hit, result, diagnostic }) => (
    hit?.silhouetteFallback === true && hit.enemy && result?.accepted === true &&
    diagnostic.raycast?.reason === 'live_enemy_silhouette_fallback' &&
    diagnostic.damage?.alertedAtImpact === alerted && diagnostic.damage?.appliedDamage > 0
  )),
  'the forgiving whole-body silhouette path damages guards identically before and after alert/fire state',
);
const makeProbeAction = () => ({
  reset() { return this; },
  setEffectiveWeight() { return this; },
  setEffectiveTimeScale() { return this; },
  play() { return this; },
  stop() { return this; },
  crossFadeTo() { return this; },
});
const blockedMovementWorld = Object.freeze({
  raycastWorld: () => null,
  segmentBlocked: () => true,
});
const blockedMovementDirector = makeEnemyProbeDirector(blockedMovementWorld);
const blockedMovementEnemy = spawnEnemyProbe(blockedMovementDirector, 'blocked_movement', {
  state: 'patrol',
  alerted: false,
});
blockedMovementEnemy.actions = {
  idle: makeProbeAction(),
  walk: makeProbeAction(),
  run: makeProbeAction(),
};
blockedMovementEnemy.motion = 'run';
blockedMovementEnemy.patrol = [
  blockedMovementEnemy.root.position.clone(),
  blockedMovementEnemy.root.position.clone().add(new THREE.Vector3(0, 0, 4)),
];
const blockedMovementStart = blockedMovementEnemy.root.position.clone();
let blockedRouteAbandoned = false;
for (let step = 0; step < 16; step += 1) {
  blockedMovementDirector._moveTowards(
    blockedMovementEnemy,
    blockedMovementStart.clone().add(new THREE.Vector3(0, 0, 5)),
    blockedMovementEnemy.speed,
    0.1,
  );
  if (blockedMovementEnemy.lastCombatAction === 'blocked_route_abandoned') {
    blockedRouteAbandoned = true;
    break;
  }
}
assert(
  blockedRouteAbandoned && blockedMovementEnemy.motion === 'idle' &&
    blockedMovementEnemy.patrolIndex === 1 &&
    blockedMovementEnemy.root.position.distanceTo(blockedMovementStart) <= 1e-8,
  'an executable fully blocked guard stops running in place and skips its impossible patrol node within a bounded interval',
);
blockedMovementDirector.dispose();
const detourMovementWorld = Object.freeze({
  raycastWorld: () => null,
  // Local steps are blocked, but a sampled point beyond the obstacle is clear.
  segmentBlocked: (start, end) => start.distanceTo(end) < 0.5,
});
const detourMovementDirector = makeEnemyProbeDirector(detourMovementWorld);
const detourMovementEnemy = spawnEnemyProbe(detourMovementDirector, 'detour_movement', {
  state: 'patrol',
  alerted: false,
});
detourMovementEnemy.actions = {
  idle: makeProbeAction(),
  walk: makeProbeAction(),
  run: makeProbeAction(),
};
detourMovementEnemy.motion = 'run';
const detourStart = detourMovementEnemy.root.position.clone();
for (let step = 0; step < 5; step += 1) {
  detourMovementDirector._moveTowards(
    detourMovementEnemy,
    detourStart.clone().add(new THREE.Vector3(0, 0, 5)),
    detourMovementEnemy.speed,
    0.1,
  );
}
assert(
  detourMovementEnemy.escapeTarget?.isVector3 === true &&
    detourMovementEnemy.escapeTarget.distanceTo(detourStart) >= 0.7 &&
    detourMovementEnemy.stuckReplans === 1 &&
    detourMovementEnemy.lastCombatAction === 'obstacle_escape' &&
    detourMovementEnemy.motion === 'idle',
  'an executable locally blocked guard selects a clear lateral escape waypoint instead of animating against the obstacle',
);
detourMovementDirector.dispose();
const watchdogDirector = makeEnemyProbeDirector(directBallisticWorld);
const watchdogEnemy = spawnEnemyProbe(watchdogDirector, 'watchdog_patrol', {
  state: 'patrol',
  alerted: false,
});
watchdogEnemy.actions = {
  idle: makeProbeAction(),
  walk: makeProbeAction(),
  run: makeProbeAction(),
};
watchdogEnemy.motion = 'idle';
watchdogEnemy.patrol = [
  watchdogEnemy.root.position.clone().add(new THREE.Vector3(0, 0, 3)),
  watchdogEnemy.root.position.clone().add(new THREE.Vector3(3, 0, 0)),
];
watchdogEnemy.progressAnchor.copy(watchdogEnemy.root.position);
watchdogEnemy.movementIntent = true;
watchdogEnemy.movementIntentTarget.copy(watchdogEnemy.patrol[0]);
watchdogEnemy.progressTime = 0.84;
watchdogDirector._watchMovementProgress(watchdogEnemy, 0.02);
assert(
  watchdogEnemy.motion === 'idle' && watchdogEnemy.patrolIndex === 1 &&
    watchdogEnemy.lastCombatAction === 'watchdog_repath' && watchdogEnemy.stuckReplans === 1,
  'a long-window progress watchdog catches idle-animation collision stalls and selects a different patrol route',
);
watchdogEnemy.movementIntent = true;
watchdogEnemy.movementIntentTarget.copy(watchdogEnemy.patrol[1]);
watchdogEnemy.progressAnchor.copy(watchdogEnemy.root.position);
watchdogEnemy.progressTime = 0.84;
watchdogDirector._watchMovementProgress(watchdogEnemy, 0.02);
assert(
  watchdogEnemy.progressRecoveries === 2 && watchdogEnemy.stuckReplans === 2 &&
    watchdogEnemy.escapeTarget?.distanceTo(watchdogEnemy.root.position) >= 0.75 &&
    watchdogEnemy.blockedPatrolUntil.size === 2,
  'a repeated stall inside five seconds escalates to a wider escape search and remembers both rejected patrol nodes',
);
watchdogDirector.dispose();

const alternateCoverWorld = {
  ...directBallisticWorld,
  getCoverPoints: () => [
    { id: 'near_cover', position: new THREE.Vector3(0, 0, 11) },
    { id: 'alternate_cover', position: new THREE.Vector3(2, 0, 11) },
  ],
};
const alternateCoverDirector = makeEnemyProbeDirector(alternateCoverWorld);
const alternateCoverEnemy = spawnEnemyProbe(alternateCoverDirector, 'alternate_cover_guard', {
  state: 'cover',
  alerted: true,
});
alternateCoverEnemy.rejectedCoverUntil.set('near_cover', alternateCoverDirector.elapsed + 8);
alternateCoverDirector._releaseCover(alternateCoverEnemy);
const alternateCover = alternateCoverDirector._chooseCover(
  alternateCoverEnemy,
  new THREE.Vector3(0, 1.6, 0),
);
assert(
  alternateCover?.id === 'alternate_cover',
  'a guard does not immediately select the same recently rejected cover route again',
);
alternateCoverDirector.dispose();

const operationRetakeEvents = [];
const operationDirector = makeEnemyProbeDirector(directBallisticWorld, {
  onOperationalRecaptured: (event) => operationRetakeEvents.push(event),
});
const [poisonOperator, replacementOperator] = operationDirector.spawnGroup({
  id: 'atrium',
  spawns: [
    {
      id: 'poison_operator_probe',
      position: new THREE.Vector3(0, 0, 10),
      technician: true,
      specialty: 'poison_technician',
      workPosition: new THREE.Vector3(0, 0, 10),
      workFacing: new THREE.Vector3(1, 1, 10),
    },
    { id: 'replacement_operator_probe', position: new THREE.Vector3(2.6, 0, 10) },
  ],
});
replacementOperator.actions = {
  idle: makeProbeAction(),
  walk: makeProbeAction(),
  run: makeProbeAction(),
};
replacementOperator.motion = 'idle';
assert(
  operationDirector.getOperationalStatus().poison.operating === true &&
    operationDirector.getOperationalStatus().poison.operatorIds.includes(poisonOperator.id),
  'the original poison specialist advances the threat only while physically inside the 1.35 m operating region',
);
operationDirector._downEnemy(poisonOperator, 'torso');
let replacementStatus = operationDirector.getOperationalStatus().poison;
assert(
  replacementOperator.operationAssignment === 'poison' &&
    replacementStatus.assignedOperatorId === replacementOperator.id && !replacementStatus.operating,
  'downing the specialist assigns an ordinary nearby guard, but does not advance poison while that replacement is still outside the controls',
);
for (let step = 0; step < 35; step += 1) operationDirector._updateTechnician(replacementOperator, 0.1);
replacementStatus = operationDirector.getOperationalStatus().poison;
assert(
  replacementStatus.operating && replacementStatus.operatorIds.includes(replacementOperator.id) &&
    replacementOperator.root.position.distanceTo(replacementOperator.operationPosition) <= 0.33 &&
    operationRetakeEvents.length === 1 && operationRetakeEvents[0].type === 'poison',
  'the replacement guard physically reaches the operating region, resumes work, and emits one console-retake event',
);
operationDirector.dispose();

const remoteRetakeDirector = makeEnemyProbeDirector(directBallisticWorld);
const [remotePoisonOperator, remoteRetakeGuard] = remoteRetakeDirector.spawnGroup({
  id: 'remote_retake',
  spawns: [
    {
      id: 'remote_poison_operator',
      position: new THREE.Vector3(0, 0, 10),
      technician: true,
      specialty: 'poison_technician',
      workPosition: new THREE.Vector3(0, 0, 10),
    },
    { id: 'remote_retake_guard', position: new THREE.Vector3(0, 0, 52) },
  ],
});
remoteRetakeGuard.actions = {
  idle: makeProbeAction(),
  walk: makeProbeAction(),
  run: makeProbeAction(),
};
remoteRetakeGuard.motion = 'idle';
remoteRetakeDirector._downEnemy(remotePoisonOperator, 'torso');
const remoteRetakeAssigned = remoteRetakeGuard.operationAssignment === 'poison' &&
  remoteRetakeDirector.facilityAlerted;
for (let step = 0; step < 260; step += 1) remoteRetakeDirector._updateTechnician(remoteRetakeGuard, 0.1);
const remoteRetakeStatus = remoteRetakeDirector.getOperationalStatus().poison;
assert(
  remoteRetakeAssigned && remoteRetakeStatus.operating &&
    remoteRetakeStatus.operatorIds.includes(remoteRetakeGuard.id) &&
    remoteRetakeGuard.root.position.distanceTo(remoteRetakeGuard.operationPosition) <= 0.33,
  'after the facility alert, a guard beyond the old 34 m limit crosses the site and physically retakes abandoned poison controls',
);
remoteRetakeDirector.dispose();

const corpseWall = {
  id: 'CORPSE_TEST_WALL',
  blocking: true,
  min: new THREE.Vector3(-2, 0, 8.55),
  max: new THREE.Vector3(2, 3, 9.78),
};
const corpseDirector = makeEnemyProbeDirector({
  ...directBallisticWorld,
  colliders: [corpseWall],
});
const corpseEnemy = spawnEnemyProbe(corpseDirector, 'corpse_wall_guard', {
  state: 'attack',
  alerted: true,
});
corpseEnemy.root.position.set(0, 0, 10.12);
corpseDirector._downEnemy(corpseEnemy, 'torso');
const selectedCorpseClearance = corpseDirector._fallenBodyClearance(
  corpseEnemy.death.targetPosition,
  corpseEnemy.death.fallDirection,
);
corpseDirector._updateDeath(corpseEnemy, 2);
assert(
  corpseEnemy.death.collisionFree && selectedCorpseClearance.clear &&
    corpseEnemy.root.position.distanceTo(corpseEnemy.death.targetPosition.clone().add(new THREE.Vector3(0, 0.045, 0))) <= 0.001,
  'a guard downed beside a wall selects and settles into a full collision-free body footprint instead of rotating through the wall',
);
corpseDirector.dispose();

const reinforcementDirector = makeEnemyProbeDirector(directBallisticWorld);
const exteriorCasualty = reinforcementDirector.spawnGroup({
  id: 'intake',
  spawns: [{ id: 'outside_guard', position: new THREE.Vector3(0, 0, 18) }],
})[0];
const indoorResponder = reinforcementDirector.spawnGroup({
  id: 'atrium',
  spawns: [{ id: 'indoor_guard', position: new THREE.Vector3(0, 0, 4) }],
})[0];
const protectedTechnician = reinforcementDirector.spawnGroup({
  id: 'finale',
  spawns: [{
    id: 'protected_technician',
    position: new THREE.Vector3(1, 0, 5),
    technician: true,
    workPosition: new THREE.Vector3(1, 0, 5),
    workFacing: new THREE.Vector3(2, 1, 5),
  }],
})[0];
reinforcementDirector._downEnemy(exteriorCasualty, 'torso');
assert(
  indoorResponder.reinforcingCasualtyId === exteriorCasualty.id && indoorResponder.assaultActive === true &&
    indoorResponder.assaultTarget.distanceTo(exteriorCasualty.root.position) <= 1e-8 &&
    indoorResponder.casualtyAlertsReceived === 1 && indoorResponder.alerted && indoorResponder.reaction === 0 &&
    protectedTechnician.casualtyAlertsReceived === 1 && protectedTechnician.lastCasualtyId === exteriorCasualty.id &&
    protectedTechnician.reinforcingCasualtyId === null && protectedTechnician.assaultActive === false,
  'an exterior casualty immediately alerts nearby allies, dispatches one rifleman, and keeps technical staff at their protected work station',
);
protectedTechnician.actions = {
  idle: makeProbeAction(),
  walk: makeProbeAction(),
  run: makeProbeAction(),
};
protectedTechnician.motion = 'run';
protectedTechnician.root.position.x += 0.6;
reinforcementDirector._updateTechnician(protectedTechnician, 0.1);
assert(
  protectedTechnician.lastCombatAction === 'return_to_technical_station' &&
    protectedTechnician.combatShotsFired === 0 && !protectedTechnician.assaultActive,
  'a displaced technician returns behind equipment rather than joining the firefight',
);
reinforcementDirector.dispose();
const playerShotSource = mainSource.match(/function handleShot\(origin, direction\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
assert(
  /rawEnemyHit\s*=\s*safeCall\(enemies, ['"]raycast['"]/.test(playerShotSource) &&
    /const rawWorldHit\s*=\s*enemyHit \? null : safeCall\(world, ['"]raycastWorld['"]/.test(playerShotSource) &&
    /const hit\s*=\s*enemyHit \?\? worldHit/.test(playerShotSource),
  'the player shot path accepts EnemyDirector ballistic authority before requesting a cosmetic world impact',
);

// Build the real authored facility graph while replacing only asynchronous
// image/nature decoding. Every pipe mesh, node, fitting, support, penetration,
// equipment edge and hydraulic path below is produced by createWorld itself.
const worldRuntimePath = join(root, 'src/world.js');
const rejectingWorldLoaderUrl = (name) => `data:text/javascript,${encodeURIComponent(
  `export class ${name}{loadAsync(){return Promise.reject(new Error('stubbed ${name}'))}}`,
)}`;
const topologyTextureLoaderUrl = `data:text/javascript,${encodeURIComponent(
  'export class TextureLoader{async loadAsync(){return {repeat:{set(){}},offset:{set(){}},center:{set(){}},dispose(){}}}}',
)}`;
const topologyCanvasContext = new Proxy({}, {
  get(target, key) {
    if (!(key in target)) target[key] = () => {};
    return target[key];
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});
const priorTopologyDocument = globalThis.document;
const priorTopologyWarn = console.warn;
let runtimeWorld = null;
let runtimeWorldError = null;
let runtimeWorldModule = null;
try {
  globalThis.document = {
    createElement: () => ({ width: 1, height: 1, getContext: () => topologyCanvasContext }),
  };
  console.warn = () => {};
  let executableWorldSource = worldSource
    .replace(
      "import * as THREE from 'three';",
      `import * as THREE from ${JSON.stringify(threeRuntimeUrl)};\nimport { TextureLoader as TestTextureLoader } from ${JSON.stringify(topologyTextureLoaderUrl)};`,
    )
    .replace(
      "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';",
      `import { GLTFLoader } from ${JSON.stringify(rejectingWorldLoaderUrl('GLTFLoader'))};`,
    )
    .replace(
      "import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';",
      `import { HDRLoader } from ${JSON.stringify(rejectingWorldLoaderUrl('HDRLoader'))};`,
    )
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(worldRuntimePath).href))
    .replace('const textureLoader = new THREE.TextureLoader();', 'const textureLoader = new TestTextureLoader();');
  runtimeWorldModule = await import(
    `data:text/javascript;base64,${Buffer.from(executableWorldSource).toString('base64')}`
  );
  runtimeWorld = await runtimeWorldModule.createWorld(new THREE.Scene(), null);
} catch (error) {
  runtimeWorldError = error;
} finally {
  console.warn = priorTopologyWarn;
  if (priorTopologyDocument === undefined) delete globalThis.document;
  else globalThis.document = priorTopologyDocument;
}

const pipeNetwork = runtimeWorld?.pipeNetwork;
const pipeContract = runtimeWorldModule?.PIPE_NETWORK_CONTRACT;
const pipeNodes = new Map((pipeNetwork?.nodes ?? []).map((node) => [node.id, node]));
const pipeRuns = new Map((pipeNetwork?.runs ?? []).map((run) => [run.id, run]));
const pipeSupports = new Map((pipeNetwork?.supports ?? []).map((support) => [support.id, support]));
const pipeFittings = new Map((pipeNetwork?.fittings ?? []).map((fitting) => [fitting.id, fitting]));
const pipeBodyColliders = (runtimeWorld?.colliders ?? []).filter((collider) => (
  collider.kind === 'pipe' || collider.kind === 'pipe_support'
));
const lowSupportCollider = pipeBodyColliders.find((collider) => (
  collider.kind === 'pipe_support' && collider.min.y < 0.4 && collider.max.y > 0.8 &&
  collider.max.x - collider.min.x < 0.2 && collider.max.z - collider.min.z < 0.2
));
let lowSupportCrossing = null;
if (lowSupportCollider) {
  const centreZ = (lowSupportCollider.min.z + lowSupportCollider.max.z) * 0.5;
  const start = new THREE.Vector3(lowSupportCollider.min.x - 0.75, 0.11, centreZ);
  lowSupportCrossing = runtimeWorld.resolveActorMovement(start, new THREE.Vector3(1.5, 0, 0), 0.34);
}
assert(
  pipeBodyColliders.length >= (pipeNetwork?.runs.length ?? Infinity) &&
    [...pipeRuns.keys()].every((id) => pipeBodyColliders.some((collider) => (
      collider.id === `${id}_SOLID_COLLIDER` && collider.blocking && collider.ballistic && collider.mesh?.isObject3D
    ))) &&
    Boolean(lowSupportCollider && lowSupportCrossing) &&
    lowSupportCrossing.x <= lowSupportCollider.min.x - 0.33,
  'the executable world makes every tube and a grounded scaffold post physically impassable while retaining rendered ballistic geometry',
);
const finitePoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const pointDistanceSquared = (left, right) => left.reduce(
  (sum, value, index) => sum + (value - right[index]) ** 2,
  0,
);
const pointLiesOnSegment = (point, start, end) => {
  const axis = end.map((value, index) => value - start[index]);
  const offset = point.map((value, index) => value - start[index]);
  const lengthSquared = axis.reduce((sum, value) => sum + value ** 2, 0);
  if (lengthSquared <= 1e-12) return false;
  const t = offset.reduce((sum, value, index) => sum + value * axis[index], 0) / lengthSquared;
  const projected = start.map((value, index) => value + axis[index] * t);
  return t >= -1e-8 && t <= 1 + 1e-8 && pointDistanceSquared(point, projected) <= 1e-10;
};
const pipeRunEndpointAudit = (pipeNetwork?.runs ?? []).every((run) => {
  const from = pipeNodes.get(run.from);
  const to = pipeNodes.get(run.to);
  return Boolean(
    run.id && from && to && finitePoint(run.start) && finitePoint(run.end) && run.radius > 0 &&
    pointDistanceSquared(run.start, from.position) <= 1e-12 &&
    pointDistanceSquared(run.end, to.position) <= 1e-12 &&
    pointDistanceSquared(run.start, run.end) > 1e-8 &&
    (run.horizontal ? (
      run.supportIds.length > 0 && run.supportIds.every((supportId) => {
        const support = pipeSupports.get(supportId);
        return support?.runId === run.id && finitePoint(support.position) &&
          pointLiesOnSegment(support.position, run.start, run.end);
      })
    ) : run.supportKind === 'vertical_riser')
  );
});
const groundedRackSupportAudit = (pipeNetwork?.supports ?? [])
  .filter((support) => support.kind === 'rack')
  .every((support) => {
    const foot = runtimeWorld?.scene.getObjectByName(`${support.id}_FOOT`);
    if (!foot) return false;
    const groundY = runtimeWorld.getGroundHeight(
      support.position[0],
      support.position[2],
      support.position[1],
    );
    return Math.abs((foot.position.y - 0.05) - groundY) <= 0.015;
  });
const continuousRackRailAudit = (pipeNetwork?.runs ?? [])
  .filter((run) => run.supportKind === 'rack' && run.supportIds.length > 1)
  .every((run) => Array.from({ length: run.supportIds.length - 1 }, (_, offset) => offset + 1)
    .every((index) => ['A', 'B'].every((side) => (
      runtimeWorld?.scene.getObjectByName(`${run.id}_RACK_LONGITUDINAL_${index}_${side}`)
    ))));
const treatmentRoof = runtimeWorld?.scene.getObjectByName('TREATMENT_HALL_FLAT_ROOF');
const treatmentRoofBounds = treatmentRoof ? new THREE.Box3().setFromObject(treatmentRoof) : null;
const connectedCeilingHangerAudit = (pipeNetwork?.supports ?? [])
  .filter((support) => support.kind === 'hanger')
  .every((support) => {
    const channel = runtimeWorld?.scene.getObjectByName(`${support.id}_CEILING_CHANNEL`);
    const rodA = runtimeWorld?.scene.getObjectByName(`${support.id}_ROD_A`);
    const rodB = runtimeWorld?.scene.getObjectByName(`${support.id}_ROD_B`);
    const plateA = runtimeWorld?.scene.getObjectByName(`${support.id}_ANCHOR_PLATE_A`);
    const plateB = runtimeWorld?.scene.getObjectByName(`${support.id}_ANCHOR_PLATE_B`);
    if (!channel || !rodA || !rodB || !plateA || !plateB || !treatmentRoofBounds) return false;
    const channelBounds = new THREE.Box3().setFromObject(channel);
    const rodABounds = new THREE.Box3().setFromObject(rodA);
    const rodBBounds = new THREE.Box3().setFromObject(rodB);
    const plateABounds = new THREE.Box3().setFromObject(plateA);
    const plateBBounds = new THREE.Box3().setFromObject(plateB);
    return Math.abs(channelBounds.max.y - treatmentRoofBounds.min.y) <= 0.015 &&
      Math.abs(plateABounds.max.y - treatmentRoofBounds.min.y) <= 0.005 &&
      Math.abs(plateBBounds.max.y - treatmentRoofBounds.min.y) <= 0.005 &&
      rodABounds.max.y >= channelBounds.min.y && rodBBounds.max.y >= channelBounds.min.y &&
      rodABounds.min.y <= support.position[1] && rodBBounds.min.y <= support.position[1];
  });
const computedPipeDegrees = new Map([...pipeNodes.keys()].map((id) => [id, 0]));
for (const run of pipeNetwork?.runs ?? []) {
  computedPipeDegrees.set(run.from, (computedPipeDegrees.get(run.from) ?? 0) + 1);
  computedPipeDegrees.set(run.to, (computedPipeDegrees.get(run.to) ?? 0) + 1);
}
const equipmentTerminalNodeIds = new Set(
  (pipeNetwork?.equipmentLinks ?? []).flatMap((link) => [
    ...(link.inletNodeIds ?? []),
    ...(link.outletNodeIds ?? []),
  ]),
);
const legitimatePipeTerminalKinds = new Set([
  'blind_end', 'tank_outlet', 'pump_inlet', 'pump_outlet', 'dosing_pump_outlet',
  'chemical_tote_outlet', 'poison_machine_inlet', 'valve_inlet', 'valve_outlet',
  'city_buried_connection',
]);
const independentlyDanglingPipeNodes = [...pipeNodes.values()].filter((node) => (
  (computedPipeDegrees.get(node.id) ?? 0) < 2 &&
  !legitimatePipeTerminalKinds.has(node.kind) && !equipmentTerminalNodeIds.has(node.id)
));
assert(
  !runtimeWorldError && pipeNetwork && pipeContract &&
    runtimeWorld.metadata.pipeNetwork === pipeNetwork && pipeNetwork.contract === pipeContract &&
    Object.isFrozen(pipeNetwork) && Object.isFrozen(pipeNetwork.nodes) &&
    pipeNetwork.nodes.every(Object.isFrozen) && pipeNetwork.runs.every(Object.isFrozen) &&
    pipeNetwork.nodes.length === 66 && pipeNetwork.runs.length === 62 &&
    pipeNetwork.fittings.length === 142 && pipeNetwork.supports.length === 82 &&
    pipeNetwork.wallPenetrations.length === 4 && pipeNetwork.equipmentLinks.length === 7 &&
    new Set(pipeNetwork.nodes.map((node) => node.id)).size === pipeNetwork.nodes.length &&
    new Set(pipeNetwork.runs.map((run) => run.id)).size === pipeNetwork.runs.length &&
    new Set(pipeNetwork.supports.map((support) => support.id)).size === pipeNetwork.supports.length,
  'createWorld exposes one immutable measured pipe graph with unique nodes, runs, fittings, supports, penetrations, and equipment links',
);
assert(
  pipeRunEndpointAudit && independentlyDanglingPipeNodes.length === 0 &&
    groundedRackSupportAudit && continuousRackRailAudit && connectedCeilingHangerAudit &&
    [...pipeNodes.values()].every((node) => node.degree === computedPipeDegrees.get(node.id)) &&
    [...pipeSupports.values()].every((support) => pipeRuns.has(support.runId)) &&
    [...pipeFittings.values()].every((fitting) => pipeNodes.has(fitting.nodeId)),
  'every measured run terminates at its junction, floor racks are grounded, ceiling hangers touch the roof structure, and no node dangles',
);
const penetrationAudit = (pipeNetwork?.wallPenetrations ?? []).every((penetration) => (
  pipeContract?.wallPenetrationIds?.includes(penetration.id) && pipeNodes.has(penetration.nodeId) &&
  pipeFittings.has(penetration.collarId) &&
  Boolean(runtimeWorld.scene.getObjectByName(penetration.wallId))
));
const equipmentAudit = (pipeNetwork?.equipmentLinks ?? []).every((link) => (
  link.id && Boolean(runtimeWorld.scene.getObjectByName(link.assetId)) &&
  [...link.inletNodeIds, ...link.outletNodeIds].every((nodeId) => pipeNodes.has(nodeId))
));
assert(
  penetrationAudit && equipmentAudit &&
    pipeContract?.requiredRunIds?.every((id) => pipeRuns.has(id)) &&
    pipeContract?.sourceNodeIds?.every((id) => pipeNodes.has(id)) && pipeNodes.has(pipeContract?.sinkNodeId),
  'every wall sleeve resolves to its collar and wall, every equipment edge resolves to a physical asset, and all required runs exist',
);

const expectedHydraulicFlowPath = [
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
];
const pipeInvariantKeys = [
  'allRunEndpointsTerminated',
  'allExposedHorizontalRunsSupported',
  'noCoincidentRuns',
  'allWallPenetrationsCollared',
  'pumpDischargePrecedesPoisonInjection',
  'poisonFeedsSingleInjectionPort',
  'cityMainPassesThroughValve',
  'backdoorIsSoleDownstreamPath',
  'everyTankReachesSinkThroughPumpInjectionValveAndBackdoor',
];
assert(
  JSON.stringify(pipeNetwork?.hydraulicFlowPath) === JSON.stringify(expectedHydraulicFlowPath) &&
    pipeInvariantKeys.every((key) => pipeNetwork.connectivity[key] === true) &&
    pipeNetwork.connectivity.danglingNodeIds.length === 0 &&
    pipeNetwork.connectivity.unsupportedHorizontalRunIds.length === 0 &&
    pipeNetwork.connectivity.coincidentRunPairs.length === 0,
  'the named hydraulic contract is tank to pump to header to injection to valve to backdoor, with every measured invariant true',
);

// Independently recompute reachability rather than trusting the world flag.
// Pipe runs carry water in either direction; equipment edges carry it only
// from inlet to outlet, matching the runtime graph semantics.
const hydraulicAdjacency = new Map([...pipeNodes.keys()].map((id) => [id, []]));
const addHydraulicAuditEdge = (from, to, kind, id) => {
  hydraulicAdjacency.get(from)?.push({ from, to, kind, id });
};
for (const run of pipeNetwork?.runs ?? []) {
  addHydraulicAuditEdge(run.from, run.to, 'run', run.id);
  addHydraulicAuditEdge(run.to, run.from, 'run', run.id);
}
for (const link of pipeNetwork?.equipmentLinks ?? []) {
  for (const inlet of link.inletNodeIds) {
    for (const outlet of link.outletNodeIds) addHydraulicAuditEdge(inlet, outlet, 'equipment', link.id);
  }
}
const findIndependentHydraulicPath = (source, sink) => {
  const queue = [source];
  const visited = new Set(queue);
  const predecessor = new Map();
  while (queue.length && !visited.has(sink)) {
    const current = queue.shift();
    for (const edge of hydraulicAdjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      predecessor.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  if (!visited.has(sink)) return null;
  const edges = [];
  let cursor = sink;
  while (cursor !== source) {
    const edge = predecessor.get(cursor);
    if (!edge) return null;
    edges.push(edge);
    cursor = edge.from;
  }
  edges.reverse();
  return {
    nodeIds: [source, ...edges.map((edge) => edge.to)],
    runIds: edges.filter((edge) => edge.kind === 'run').map((edge) => edge.id),
    equipmentIds: edges.filter((edge) => edge.kind === 'equipment').map((edge) => edge.id),
  };
};
const independentTankPaths = pipeContract?.sourceNodeIds.map((source) => (
  findIndependentHydraulicPath(source, pipeContract.sinkNodeId)
)) ?? [];
assert(
  independentTankPaths.length === 3 && independentTankPaths.every((path) => (
    path && path.nodeIds.includes(pipeContract.poisonInjectionNodeId) &&
    path.equipmentIds.some((id) => pipeContract.pumpEquipmentIds.includes(id)) &&
    path.equipmentIds.includes(pipeContract.valveEquipmentId) &&
    path.runIds.includes('PROCESS_POST_PUMP_HEADER') &&
    path.runIds.includes('INTERBUILDING_CLEAN_WATER_HEADER') &&
    path.runIds.includes('CITY_SUPPLY_MAIN_DOWNSTREAM') &&
    path.runIds.includes('BACKDOOR_MAIN_PIPE') &&
    path.nodeIds.at(-1) === pipeContract.sinkNodeId
  )) && pipeNetwork.connectivity.sourcePaths.every((path) => (
    path.reachable && path.traversesPoisonInjection && path.traversesValve &&
    path.traversesBackdoorDemolitionRun && pipeContract.pumpEquipmentIds.includes(path.pumpEquipmentId)
  )),
  'independent BFS proves all three tanks reach the buried city sink through a pump, injection header, valve, and backdoor demolition run',
);
assert(
  /const FIRE_LANE_FAILURE_LIMIT\s*=\s*3/.test(enemiesSource) &&
    /enemy\.fireLaneFailures\s*\+=\s*1/.test(enemiesSource) &&
    /enemy\.fireLaneFailures\s*>=\s*FIRE_LANE_FAILURE_LIMIT[\s\S]*?_repositionForFireLane\(enemy, playerEye, ['"]blocked_muzzle['"]\)/.test(enemiesSource) &&
    /const LOST_LOS_COVER_GRACE\s*=\s*0\.58/.test(enemiesSource) &&
    /this\.elapsed - enemy\.lastSeenTime > LOST_LOS_COVER_GRACE[\s\S]*?_repositionForFireLane/.test(enemiesSource) &&
    /enemy\.immobileTime > 0\.72[\s\S]*?_repositionForFireLane\(enemy, investigateTarget, ['"]blocked_investigation['"]\)/.test(enemiesSource),
  'blocked muzzles, stale cover LOS, and immobile investigations deterministically leave their stuck states and repath',
);
assert(
  /const BODY_RADIUS\s*=\s*0\.[2-9]/.test(enemiesSource) &&
    /_bodyPositionClear\(enemy,[\s\S]*?_circleBoxPenetration\(/.test(enemiesSource) &&
    /_bodySweepBlocked\(current, candidate\)/.test(enemiesSource),
  'enemy locomotion checks a swept body radius against blocking geometry',
);
assert(
  /current\.clone\(\)\.add\(new THREE\.Vector3\(delta\.x, 0, 0\)\)[\s\S]*?current\.clone\(\)\.add\(new THREE\.Vector3\(0, 0, delta\.z\)\)/.test(enemiesSource),
  'enemy locomotion tries axis-separated wall-sliding candidates',
);
assert(
  /const methods = \[['"]resolveEnemyMovement['"], ['"]resolveActorMovement['"], ['"]resolveMovement['"]\]/.test(enemiesSource),
  'enemy locomotion consumes the world actor-resolution contract',
);
assert(
  /const minimumUsefulStep\s*=\s*Math\.max\(0\.004,\s*speed \* dt \* 0\.16\)/.test(enemiesSource) &&
    /this\._setMotion\(enemy,\s*['"]idle['"]\)/.test(enemiesSource) &&
    /enemy\.immobileTime >= 0\.46[\s\S]*?this\._findEscapePoint\(enemy, current, originalTarget, enemy\.progressRecoveries\)/.test(enemiesSource) &&
    /enemy\.escapeTarget\s*=\s*escape/.test(enemiesSource) &&
    /if \(enemy\.escapeTarget\) \{[\s\S]*?enemy\.escapeTarget\s*=\s*null;[\s\S]*?enemy\.escapeFailures \+= 1/.test(enemiesSource) &&
    /enemy\.escapeFailures\s*>=\s*3/.test(enemiesSource) &&
    /lastCombatAction\s*=\s*['"]obstacle_escape['"]/.test(enemiesSource) &&
    /lastCombatAction\s*=\s*['"]blocked_route_abandoned['"]/.test(enemiesSource) &&
    /const actualSpeed\s*=\s*displacement\.length\(\) \/ Math\.max\(dt, 1e-5\)/.test(enemiesSource) &&
    /const pursuingMovement\s*=\s*Boolean\(enemy\.movementIntent\)/.test(enemiesSource) &&
    /enemy\.progressTime < 0\.85/.test(enemiesSource) &&
    /const radii = recoveryLevel > 0 \? \[1\.12, 1\.65, 2\.3, 0\.72\]/.test(enemiesSource),
  'blocked guards stop run-in-place animation, sample a clear escape route, and abandon an impossible route if replanning fails',
);
const counterattackSource = enemiesSource.match(
  /beginCounterattack\(targetValue, options = \{\}\)\s*\{([\s\S]*?)\n\s*\}\n\n\s*update\(/,
)?.[1] ?? '';
assert(
  /enemy\.active && !enemy\.dead && !enemy\.surrendered/.test(counterattackSource) &&
    /waveSize[\s\S]*?waveInterval[\s\S]*?withinWaveStagger/.test(counterattackSource) &&
    /const wave\s*=\s*Math\.floor\(index \/ waveSize\)/.test(counterattackSource) &&
    /enemy\.assaultTarget\s*=\s*target\.clone\(\)/.test(counterattackSource) &&
    /this\._releaseCover\(enemy\)/.test(counterattackSource) &&
    /this\._emit\(['"]onCounterattack['"]/.test(counterattackSource) &&
    !/_spawnEnemy|spawnGroup/.test(counterattackSource) &&
    /beginCounterattack:\s*\(target, options = \{\}\)\s*=>\s*safeCall\([\s\S]*?['"]beginCounterattack['"]/.test(mainSource),
  'counterattacks deterministically retask only surviving authored guards into staggered physical waves without spawning contacts',
);
const worldCounterattackSource = worldSource.match(
  /const reinforcementSpawns\s*=\s*Object\.freeze\(\[([\s\S]*?)\n\s*\]\);/,
)?.[1] ?? '';
assert(
  ['technicians_secured', 'valve_closed', 'pipe_demolished', 'counterattack']
    .every((trigger) => worldCounterattackSource.includes(`trigger: '${trigger}'`)) &&
    (worldCounterattackSource.match(/retaskOnly:\s*true,\s*spawnNewContacts:\s*false/g) ?? []).length === 4 &&
    /eligibleSpawnIds:/.test(worldCounterattackSource) && /rallyPoints:/.test(worldCounterattackSource) &&
    !/entries:\s*\[|newContacts|spawnNewContacts:\s*true/.test(worldCounterattackSource),
  'world counterattack manifests expose four stable trigger routes and can only retask survivors from the original 20-contact roster',
);
assert(
  /this\.shotSerial\s*\+=\s*1/.test(weaponSource) &&
    /shotSerial:\s*this\.shotSerial/.test(weaponSource) &&
    /shotOrigin:\s*this\.lastShotOrigin\.clone\(\)/.test(weaponSource),
  'every weapon round publishes a unique hearing token and its shooter origin',
);
assert(
  /shotSerial:\s*weaponState\.shotSerial/.test(mainSource) &&
    /shotOrigin:\s*weaponState\.shotOrigin/.test(mainSource) &&
    /const token = playerState\.shotSerial/.test(enemiesSource),
  'main forwards each automatic-fire round to enemy hearing',
);
assert(
  /this\.lastNoiseToken\s*=\s*0;/.test(enemiesSource),
  'enemy hearing starts on the weapon serial baseline without a false first-frame gunshot',
);
assert(
  /damage\(target,[\s\S]*?context = \{\}/.test(enemiesSource) &&
    /context\?\.sourcePosition \?\? context\?\.origin/.test(enemiesSource) &&
    /['"]damage['"], enemy, damage, region, \{ sourcePosition: origin \}/.test(mainSource),
  'guards hit from outside sight receive the actual shooter origin',
);
const damageResponse = enemiesSource.match(/damage\(target,[\s\S]*?\n\s*surrenderRusk\(/)?.[0] ?? '';
assert(
  /_raiseLocalAlert\(enemy, enemy\.lastKnownPlayer, ['"]incoming_fire['"]\)/.test(damageResponse) &&
    /_face\(enemy, incomingOrigin, 1\)/.test(damageResponse) &&
    /_setState\(enemy, ['"]attack['"]\)/.test(damageResponse) &&
    !/_setState\(enemy, ['"](?:cover|flank)['"]\)/.test(damageResponse),
  'a surviving shot victim immediately faces and attacks the shooter instead of running to cover',
);
assert(
  /m4a1-pbr\.fbx/.test(enemiesSource) &&
    /M4A1_Base_Color\.png/.test(enemiesSource) &&
    /M4A1_Height\.png/.test(enemiesSource) &&
    /M4A1_Metallic\.png/.test(enemiesSource) &&
    /M4A1_Normal\.png/.test(enemiesSource) &&
    /M4A1_Roughness\.png/.test(enemiesSource) &&
    /M4A1_CC0_PBR_Enemy_Material/.test(enemiesSource) &&
    /model\.rotation\.y\s*=\s*Math\.PI/.test(enemiesSource),
  'enemy rifles use the same centered PBR M4 source and texture stack as the player weapon',
);
assert(
  /M4A1_RightGrip_\$\{enemy\.id\}/.test(enemiesSource) &&
    /M4A1_LeftGrip_\$\{enemy\.id\}/.test(enemiesSource) &&
    (enemiesSource.match(/this\._solveArmReach\(/g) ?? []).length >= 2 &&
    /rearHandBoneAlignment:\s*['"]slight_diagonal['"][\s\S]*?rearHandDownturnDegrees:\s*0/.test(enemiesSource) &&
    /rearHandTiltDegrees:\s*THREE\.MathUtils\.radToDeg\(ENEMY_FIRING_HAND_TILT\)/.test(enemiesSource) &&
    /rig\.rightForearm\.getWorldPosition\(this\._a\)/.test(enemiesSource) &&
    /this\._c\.copy\(this\._b\)\.sub\(this\._a\)/.test(enemiesSource) &&
    /if \(outwardSign < 0 && bend > 1e-5\)[\s\S]*?dot\(rootUp\) - 0\.075[\s\S]*?addScaledVector\(sideBasis/.test(enemiesSource) &&
    /this\._orientCombatHand\([\s\S]*?rig\.rightHand,[\s\S]*?this\._c,[\s\S]*?ENEMY_FIRING_PALM_NORMAL/.test(enemiesSource) &&
    /ENEMY_SUPPORT_PALM_NORMAL\s*=\s*new THREE\.Vector3\(-1,\s*0,\s*0\)/.test(enemiesSource) &&
    !/REAR_HAND_BONE_ROTATION/.test(enemiesSource) &&
    /mount\.position\.set\(-0\.14,\s*1\.38,\s*0\.38\)/.test(enemiesSource) &&
    /rightGrip\.position\.set\(-0\.06,\s*-0\.03,\s*-0\.197\)/.test(enemiesSource) &&
    /leftGrip\.position\.set\(0\.048,\s*-0\.015,\s*-0\.065\)/.test(enemiesSource) &&
    /rig\.poseWeight\s*=\s*1/.test(enemiesSource) &&
    /desiredYaw\s*=\s*THREE\.MathUtils\.clamp\(Math\.atan2\(dx, dz\),\s*-0\.34,\s*0\.34\)/.test(enemiesSource) &&
    /enemy\.mixer\.update\(seconds\)[\s\S]*?_updateCombatPose\(enemy, seconds, playerEye\)/.test(enemiesSource),
  'enemy rifles reuse the player slight-diagonal firing-hand contract with wrists seated at the pistol grip and handguard',
);
assert(
  /getGripProbe\(target = ['"]treatment_door_guard['"]\)/.test(enemiesSource) &&
    /rightContactDistance:\s*rightHand && rightGrip \? rightHand\.distanceTo\(rightGrip\)/.test(enemiesSource) &&
    /leftContactDistance:\s*leftHand && leftGrip \? leftHand\.distanceTo\(leftGrip\)/.test(enemiesSource) &&
    /document\.body\.dataset\.qaEnemyGrip\s*=\s*JSON\.stringify\(enemyGripProbe\)/.test(mainSource) &&
    /document\.body\.dataset\.qaEnemyMovement\s*=\s*JSON\.stringify\(enemyMovementProbe\)/.test(mainSource) &&
    /movementIntent:\s*enemy\.movementIntent/.test(enemiesSource) &&
    /stuckReplans:\s*enemy\.stuckReplans/.test(enemiesSource),
  'browser QA exposes live skinned wrist-to-rifle contact distances for both enemy hands',
);
assert(
  /this\.armProxyGeometry\s*=\s*new THREE\.CylinderGeometry/.test(enemiesSource) &&
    /RIGHT_UPPER_ARM[\s\S]*?RIGHT_FOREARM[\s\S]*?LEFT_UPPER_ARM[\s\S]*?LEFT_FOREARM/.test(enemiesSource) &&
    /this\.proxyData\.set\(proxy,\s*\{\s*enemy,\s*region:\s*['"]limb['"]\s*\}\)/.test(enemiesSource) &&
    /segment\.startBone\.getWorldPosition[\s\S]*?segment\.endBone\.getWorldPosition[\s\S]*?setFromUnitVectors\(UP/.test(enemiesSource),
  'animated upper arms and forearms own bone-following limb hit volumes throughout the rifle pose',
);
assert(
  /this\.weaponProxyGeometry\s*=\s*new THREE\.BoxGeometry\(0\.18,\s*0\.26,\s*0\.82\)/.test(enemiesSource) &&
    /weaponProxy\.name\s*=\s*`WEAPON_HIT_\$\{enemy\.id\}`/.test(enemiesSource) &&
    /enemy\.weaponMount\.add\(weaponProxy\)/.test(enemiesSource) &&
    /this\.proxyData\.set\(weaponProxy,\s*\{\s*enemy,\s*region:\s*['"]limb['"]\s*\}\)/.test(enemiesSource) &&
    /enemy\.weaponProxy/.test(enemiesSource),
  'the shouldered enemy rifle is part of the damageable weapon-side silhouette instead of a visual hole to the wall behind it',
);
assert(
  /this\.damageMeshes\s*=\s*\[\]/.test(enemiesSource) &&
    /this\._registerDamageMeshes\(enemy\)/.test(enemiesSource) &&
    /register\(enemy\.visual,\s*['"]torso['"]\)/.test(enemiesSource) &&
    /register\(enemy\.weapon,\s*['"]limb['"]\)/.test(enemiesSource) &&
    /intersectObjects\(this\.damageMeshes,\s*false\)/.test(enemiesSource) &&
    /reason:\s*['"]live_enemy_render_mesh_hit['"]/.test(enemiesSource),
  'the rendered hostile uniform, gloves, and rifle are registered as direct damage geometry independent of awareness state',
);
assert(
  /_raycastEnemySilhouettes\(start, direction, far\)/.test(enemiesSource) &&
    /ray\.distanceSqToSegment\(segmentStart, segmentEnd, pointOnRay, pointOnBody\)/.test(enemiesSource) &&
    /distanceSq > 0\.48 \* 0\.48/.test(enemiesSource) &&
    /reason:\s*['"]live_enemy_silhouette_fallback['"]/.test(enemiesSource) &&
    !/_raycastEnemySilhouettes\([\s\S]*?(?:alerted|hasLOS|hasFired|reaction)/.test(
      enemiesSource.match(/_raycastEnemySilhouettes\(start, direction, far\)\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? '',
    ),
  'whole-body fallback targeting is clipped by world distance and contains no awareness, LOS, reaction, or hostile-fire gate',
);
assert(
  /fingerBoneCount\s*=\s*enemy\.combatRig\.fingers\.length/.test(enemiesSource) &&
    /restQuaternion:\s*bone\.quaternion\.clone\(\)/.test(enemiesSource) &&
    /_fingerDesiredQuaternion\.copy\(entry\.restQuaternion\)\.multiply\(this\._fingerQuaternion\)/.test(enemiesSource) &&
    /entry\.bone\.quaternion\.slerp\(this\._fingerDesiredQuaternion/.test(enemiesSource),
  'all enemy finger joints close around their grip from a stable rest pose without accumulating twist frame to frame',
);
assert(
  /const aimPoint = engaged[\s\S]*?enemy\.hasLOS && playerEye \? playerEye : enemy\.lastKnownPlayer/.test(enemiesSource) &&
    /desiredYaw\s*=\s*THREE\.MathUtils\.clamp\(Math\.atan2\(dx, dz\)/.test(enemiesSource) &&
    /desiredPitch\s*=\s*THREE\.MathUtils\.clamp\(-Math\.atan2\(dy, horizontal\)/.test(enemiesSource) &&
    /_attack\(enemy,[\s\S]*?_face\(enemy, playerEye,[\s\S]*?_fireControl/.test(enemiesSource),
  'engaged guards turn their bodies and visually track the player with the mounted rifle',
);
assert(
  /_chooseDeathPose\(enemy\)[\s\S]*?_fallenBodyClearance\(targetPosition, direction\)/.test(enemiesSource) &&
    /makeBasis\(xAxis, direction, UP\)/.test(enemiesSource) &&
    /targetQuaternion:\s*deathPose\.targetQuaternion/.test(enemiesSource) &&
    /weaponMount\.removeFromParent\(\)[\s\S]*?targetPosition:[\s\S]*?weaponDrop/.test(enemiesSource) &&
    /_updateDeath\(enemy, dt\)[\s\S]*?slerpQuaternions\(enemy\.death\.startQuaternion, enemy\.death\.targetQuaternion, t\)[\s\S]*?lerpVectors\(enemy\.death\.startPosition, enemy\.death\.targetPosition, t\)[\s\S]*?drop\.targetPosition/.test(enemiesSource),
  'downed enemies choose a collision-checked supine landing lane while the rifle drops beside the body',
);
assert(
  /simulationDt = playerState\.paused \? 0 : dt/.test(mainSource),
  'pause freezes mission and defense time',
);
assert(
  /firing: weaponState\.firing/.test(mainSource),
  'weapon fire is forwarded to enemy hearing',
);
assert(
  /WATER STATUS/.test(html) && /SUPPLY MAIN/.test(html) &&
    /poisonPrevented/.test(uiSource) && /supplyShutOff/.test(uiSource) && /serviceInterrupted/.test(uiSource),
  'ending UI supports distinct clean-water and emergency-shutoff outcomes',
);

const launcherName = 'Open CLEARWATER.command';
const launcherPath = join(root, launcherName);
const launch = await stat(launcherPath);
const launcherSource = await readFile(launcherPath, 'utf8');
const windowsLauncherSource = await readFile(join(root, 'Open CLEARWATER.bat'), 'utf8');
const linuxLauncherPath = join(root, 'open-clearwater.sh');
const linuxLaunch = await stat(linuxLauncherPath);
const linuxLauncherSource = await readFile(linuxLauncherPath, 'utf8');
const internalLauncherFiles = (await readdir(root)).filter((name) => /\.command$/.test(name));
assert(
  Boolean(launch.mode & 0o100) && Boolean(linuxLaunch.mode & 0o100) && internalLauncherFiles.length === 1 &&
    /GAME_DIR="\$\{0:A:h\}"/.test(launcherSource) &&
    /\/usr\/bin\/open "\$\{GAME_URL\}"/.test(launcherSource) &&
    /["']project["']:\s*["']CLEARWATER["']/.test(launcherSource) &&
    /where node/.test(windowsLauncherSource) && /node server\.mjs/.test(windowsLauncherSource) &&
    /http:\/\/127\.0\.0\.1:4173/.test(windowsLauncherSource) &&
    /command -v node/.test(linuxLauncherSource) && /xdg-open "\$GAME_URL"/.test(linuxLauncherSource) &&
    /node server\.mjs/.test(linuxLauncherSource) &&
    !/SALTLINE|WATERGUARD/i.test(`${launcherSource}\n${windowsLauncherSource}\n${linuxLauncherSource}`),
  'the standalone repository ships executable macOS and Linux launchers plus a Windows launcher for the local browser server',
);
assert((await stat(join(root, 'vendor/three/build/three.module.min.js'))).size > 300_000, 'vendored Three.js runtime is intact');

// Exercise every CLEARWATER mission route as a deterministic state machine.
// Threat progress belongs to a physical operating zone. Named technicians can
// be replaced by ordinary guards, but nobody can advance a clock from afar.
const advanceMission = (director, seconds) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += 1) director.update(1);
};
const startInfiltration = (director) => {
  director.start();
  assert(director.completeRecon(), 'mission reconnaissance can hand off deterministically to infiltration');
  return director.getState();
};
const runHoldToBoundary = (director) => {
  advanceMission(director, director.getState().hold.total - 1);
  const before = director.getState();
  director.update(1);
  return { before, after: director.getState() };
};

const timingMission = new MissionDirector();
timingMission.start();
const timingState = timingMission.getState();
assert(
  MISSION_TIMINGS.poisonSeconds === 300 && MISSION_TIMINGS.vaultBreachSeconds === 150 &&
    MISSION_TIMINGS.reinforcementHoldSeconds === 60 &&
    timingState.poison.total === 300 && timingState.poison.remaining === 300 &&
    timingState.vault.total === 150 && timingState.vault.remaining === 150 &&
    timingState.hold.total === 60,
  'default mission clocks are authored at exactly 05:00 poison, 02:30 vault breach, and 01:00 reinforcement hold',
);
assert(
  /setOperationalPresence\(status = \{\}\)/.test(missionSource) &&
    /this\._poisonThreatOpen\(\) && this\.operationalPresence\.poison\.operating/.test(missionSource) &&
    /this\.operationalPresence\.vault\.operating/.test(missionSource) &&
    /getOperationalStatus\(\)/.test(enemiesSource) &&
    /distanceToSquared\(position\) <= OPERATION_RADIUS \* OPERATION_RADIUS/.test(enemiesSource) &&
    /safeCall\(mission, ['"]setOperationalPresence['"], operationalStatus\)/.test(mainSource),
  'mission clocks consume live enemy proximity and cannot be advanced by an assigned operator who is still far from the controls',
);
assert(
  timingState.recon.hostileCount === 20 && timingState.stats.expectedHostiles === 20 &&
    timingState.requiredNeutralizations === 2 && timingState.technicians.required === 2 &&
    TECHNICIAN_IDS.poison === 'poison_technician' && TECHNICIAN_IDS.vault === 'vault_technician' &&
    timingState.technicians.poison.id === TECHNICIAN_IDS.poison &&
    timingState.technicians.vault.id === TECHNICIAN_IDS.vault,
  'EO/IR reports exactly 20 original contacts while mission state identifies the two stable technician IDs as the only critical neutralizations',
);

const technicianEvents = { threat: [], poison: [], vault: [], counterattack: [], recaptured: [], defense: [], complete: [] };
const technicianMission = new MissionDirector({
  onThreatTimers: (payload) => technicianEvents.threat.push(payload),
  onPoisonPrevented: (payload) => technicianEvents.poison.push(payload),
  onVaultSecured: (payload) => technicianEvents.vault.push(payload),
  onCounterattackStarted: (payload) => technicianEvents.counterattack.push(payload),
  onOperationRecaptured: (payload) => technicianEvents.recaptured.push(payload),
  onDefenseTimer: (payload) => technicianEvents.defense.push(payload),
  onComplete: (state) => technicianEvents.complete.push(state),
});
startInfiltration(technicianMission);
for (let index = 0; index < 18; index += 1) technicianMission.enemyDown(`guardian_${index + 1}`);
let technicianState = technicianMission.getState();
assert(
  technicianState.stage === 'stop_technical_team' && technicianState.stats.techniciansNeutralized === 0 &&
    technicianState.remainingHostiles === 2 && !technicianState.flags.siteCleared,
  'neutralizing all 18 generic guards never clears or gates the technical objective',
);
technicianMission.enemyDown(TECHNICIAN_IDS.poison);
technicianState = technicianMission.getState();
assert(
  technicianState.flags.poisonTechnicianNeutralized && !technicianState.flags.poisonPrevented &&
    !technicianState.flags.vaultTechnicianNeutralized && !technicianState.flags.vaultSecured &&
    technicianState.stage === 'stop_technical_team' && technicianState.poison.active &&
    technicianEvents.poison.length === 0 && technicianEvents.counterattack.length === 0,
  'downing the named poison technician does not stop a process that any nearby hostile can continue',
);
technicianMission.setOperationalPresence({
  poison: { operating: false, operatorIds: [] },
  vault: { operating: true, operatorIds: [TECHNICIAN_IDS.vault] },
});
const pausedPoisonTime = technicianMission.getState().poison.remaining;
const activeVaultTime = technicianMission.getState().vault.remaining;
advanceMission(technicianMission, 3);
technicianState = technicianMission.getState();
assert(
  technicianState.poison.remaining === pausedPoisonTime && !technicianState.poison.active &&
    technicianState.vault.remaining === activeVaultTime - 3 && technicianState.vault.active,
  'poison progress pauses with no hostile inside its operating radius while the staffed vault breach continues',
);
technicianMission.setOperationalPresence({
  poison: { operating: true, operatorIds: ['replacement_guard'] },
  vault: { operating: true, operatorIds: [TECHNICIAN_IDS.vault] },
});
advanceMission(technicianMission, 2);
assert(
  technicianMission.getState().poison.remaining === pausedPoisonTime - 2 &&
    technicianMission.getState().poison.operatorIds.includes('replacement_guard'),
  'an ordinary replacement inside the poison controls resumes the same authored clock',
);
assert(technicianMission.interact('neutralize_poison'), 'the player can still isolate an unstaffed or replacement-staffed poison machine');
technicianState = technicianMission.getState();
assert(
  technicianState.flags.poisonPrevented && technicianState.stage === 'hold_reinforcements' &&
    technicianState.hold.active && technicianEvents.poison.length === 1 &&
    technicianEvents.counterattack.length === 1 &&
    technicianEvents.counterattack[0].targetKey === 'POISON_INJECTION_MACHINE',
  'physically isolating the poison machine starts the clean-water reinforcement hold',
);
advanceMission(technicianMission, 3);
technicianState = technicianMission.getState();
assert(
  technicianState.stage === 'stop_technical_team' && !technicianState.flags.poisonPrevented &&
    technicianEvents.recaptured.length === 1 && technicianEvents.recaptured[0].type === 'poison' &&
    technicianState.poison.remaining === pausedPoisonTime - 2 &&
    technicianState.vault.remaining === activeVaultTime - 8,
  'a replacement who remains on the dosing controls for 2.5 seconds restarts poison, keeps vault work moving, and cancels the hold',
);
technicianMission.setOperationalPresence({
  poison: { operating: false, operatorIds: [] },
  vault: { operating: true, operatorIds: [TECHNICIAN_IDS.vault] },
});
assert(technicianMission.interact('neutralize_poison'), 'the player can retake and isolate the dosing console again');
const technicianHold = runHoldToBoundary(technicianMission);
assert(
  !technicianHold.before.complete && technicianHold.before.stage === 'hold_reinforcements' &&
    technicianHold.before.hold.remaining === 1 && technicianHold.before.defense.active &&
    technicianHold.after.complete && technicianHold.after.flags.defenseComplete &&
    technicianHold.after.stats.counterattackSurvived && technicianEvents.complete.length === 1,
  'the machine-secured route cannot complete at 59 seconds and succeeds exactly when its 60-second hold expires',
);

const stoppedTimerEvents = [];
const stoppedTimerMission = new MissionDirector({
  onComplete: (state) => stoppedTimerEvents.push(state),
});
startInfiltration(stoppedTimerMission);
for (let index = 0; index < 20; index += 1) stoppedTimerMission.enemyDown(`timer_stop_${index + 1}`);
const stoppedTimerState = stoppedTimerMission.getState();
assert(
  stoppedTimerState.complete && stoppedTimerState.stage === 'ending' &&
    stoppedTimerState.outcome === 'site_cleared' && stoppedTimerState.remainingHostiles === 0 &&
    stoppedTimerState.flags.siteCleared && stoppedTimerState.stats.siteCleared &&
    !stoppedTimerState.operators.poison.operating && !stoppedTimerState.operators.vault.operating &&
    !stoppedTimerState.poison.released && !stoppedTimerState.vault.breached &&
    stoppedTimerState.snapshots.at(-1)?.reason === 'all_hostiles_down_both_timers_stopped' &&
    stoppedTimerEvents.length === 1,
  'eliminating all hostiles while both threat timers are still safe ends immediately as a direct site-clear success',
);

const fullClearEvents = [];
const fullClearMission = new MissionDirector({
  onComplete: (state) => fullClearEvents.push(state),
});
startInfiltration(fullClearMission);
assert(fullClearMission.interact('neutralize_poison'), 'the full-clear probe reaches a valid containment route');
for (let index = 0; index < 20; index += 1) fullClearMission.enemyDown(`full_clear_${index + 1}`);
const fullClearState = fullClearMission.getState();
assert(
  fullClearState.complete && fullClearState.stage === 'ending' && fullClearState.flags.siteCleared &&
    fullClearState.stats.siteCleared && fullClearState.remainingHostiles === 0 &&
    !fullClearState.operators.poison.operating && !fullClearState.operators.vault.operating &&
    fullClearState.snapshots.at(-1)?.reason === 'all_hostiles_down_both_operations_stopped' &&
    fullClearEvents.length === 1,
  'a contained site with every hostile down immediately ends as a full-clear success instead of sticking on the reinforcement clock',
);

const valveEvents = { supply: [], vault: [], counterattack: [], defense: [], complete: [] };
const valveMission = new MissionDirector({
  onSupplyShutOff: (payload) => valveEvents.supply.push(payload),
  onVaultSecured: (payload) => valveEvents.vault.push(payload),
  onCounterattackStarted: (payload) => valveEvents.counterattack.push(payload),
  onDefenseTimer: (payload) => valveEvents.defense.push(payload),
  onComplete: (state) => valveEvents.complete.push(state),
});
startInfiltration(valveMission);
advanceMission(valveMission, 149);
assert(
  valveMission.getState().vault.remaining === 1 && !valveMission.getState().vault.breached &&
    valveMission.canInteract('close_supply_valve') && !valveMission.canInteract('demolish_backdoor_main_pipe'),
  'the supply valve remains closable one second before the deterministic vault breach while pipe demolition stays locked',
);
assert(valveMission.interact('close_supply_valve'), 'closing the canonical supply valve resolves before vault breach');
let valveState = valveMission.getState();
assert(
  valveState.stage === 'hold_reinforcements' && valveState.flags.supplyValveClosed &&
    valveState.flags.supplyShutOff && valveState.flags.vaultSecured &&
    valveEvents.supply.length === 1 && valveEvents.vault.length === 1 &&
    valveEvents.counterattack.length === 1 && valveEvents.counterattack[0].route === 'valve_closed' &&
    valveEvents.counterattack[0].targetKey === 'SUPPLY_VALVE',
  'closing the valve starts one valve-centered counterattack and exposes the supply/vault callback state',
);
const valveHold = runHoldToBoundary(valveMission);
assert(
  !valveHold.before.complete && valveHold.before.hold.remaining === 1 &&
    valveHold.after.complete && valveHold.after.outcome === 'valve_closed' &&
    valveEvents.complete.length === 1 && valveEvents.defense.some((timer) => timer.active && timer.kind === 'reinforcement_hold'),
  'the valve route also requires the complete authored hold before reporting success',
);

const fallbackEvents = { threat: [], breached: [], pipe: [], counterattack: [], defense: [], complete: [] };
const fallbackMission = new MissionDirector({
  onThreatTimers: (payload) => fallbackEvents.threat.push(payload),
  onVaultBreached: (payload) => fallbackEvents.breached.push(payload),
  onPipeDemolished: (payload) => fallbackEvents.pipe.push(payload),
  onCounterattackStarted: (payload) => fallbackEvents.counterattack.push(payload),
  onDefenseTimer: (payload) => fallbackEvents.defense.push(payload),
  onComplete: (state) => fallbackEvents.complete.push(state),
});
startInfiltration(fallbackMission);
assert(
  fallbackMission.getState().interactionId !== 'demolish_backdoor_main_pipe' &&
    !fallbackMission.canInteract('demolish_backdoor_main_pipe'),
  'pipe demolition is unavailable while neither primary threat has succeeded',
);
advanceMission(fallbackMission, 150);
let fallbackState = fallbackMission.getState();
assert(
  fallbackState.vault.breached && !fallbackState.poison.released && fallbackState.poison.remaining === 150 &&
    fallbackEvents.breached.length === 1 && !fallbackMission.canInteract('demolish_backdoor_main_pipe'),
  'vault breach occurs at exactly 02:30 but cannot unlock the pipe while the poison deadline remains',
);
advanceMission(fallbackMission, 150);
fallbackState = fallbackMission.getState();
assert(
  fallbackState.poison.released && fallbackState.vault.breached && fallbackState.planC.active &&
    fallbackState.planC.demolitionUnlocked &&
    fallbackState.interactionId === 'demolish_backdoor_main_pipe' &&
    fallbackMission.canInteract('demolish_backdoor_main_pipe'),
  'only the conjunction of poison release and vault breach unlocks the canonical backdoor-main demolition',
);
assert(
  fallbackMission.interact('demolish_backdoor_main_pipe'),
  'the canonical backdoor-main demolition interaction resolves after both primary failures',
);
fallbackState = fallbackMission.getState();
assert(
  fallbackState.stage === 'hold_reinforcements' && fallbackState.flags.backdoorPipeDemolished &&
    fallbackEvents.pipe.length === 1 && fallbackEvents.counterattack.length === 1 &&
    fallbackEvents.counterattack[0].route === 'pipe_demolished' &&
    fallbackEvents.counterattack[0].targetKey === 'BACKDOOR_MAIN_PIPE',
  'pipe demolition starts one fallback counterattack centered on the authored backdoor main',
);
const fallbackHold = runHoldToBoundary(fallbackMission);
assert(
  !fallbackHold.before.complete && fallbackHold.before.hold.remaining === 1 &&
    fallbackHold.after.complete && fallbackHold.after.outcome === 'pipe_demolished' &&
    fallbackHold.after.stats.serviceInterrupted && fallbackEvents.complete.length === 1,
  'the double-failure fallback succeeds only after pipe demolition and the entire 60-second hold',
);
assert(
  fallbackEvents.threat.some((payload) =>
    payload.poison.total === 300 && payload.vault.total === 150 &&
    typeof payload.poison.status === 'string' && typeof payload.vault.status === 'string') &&
    fallbackEvents.defense.some((payload) =>
      payload.active && payload.total === 60 && payload.kind === 'reinforcement_hold') &&
    fallbackEvents.defense.at(-1)?.active === false,
  'threat and defense callbacks publish readable dual-timer status, exact totals, hold kind, and terminal inactive state',
);

// Explore the complete finite mission graph with both possible timer orders.
// Replaying each action trace through a fresh director avoids privileged state
// mutation and proves that every public route remains executable end to end.
const missionGraphActions = Object.freeze([
  'tick',
  'down_poison_technician',
  'down_vault_technician',
  'neutralize_poison',
  'close_supply_valve',
  'demolish_backdoor_main_pipe',
]);
const createGraphMission = (timings) => {
  const director = new MissionDirector({
    poisonSeconds: timings.poisonSeconds,
    vaultSeconds: timings.vaultSeconds,
    holdSeconds: 2,
  });
  director.start();
  director.completeRecon();
  return director;
};
const applyMissionGraphAction = (director, action) => {
  if (action === 'tick') director.update(1);
  else if (action === 'down_poison_technician') director.enemyDown(TECHNICIAN_IDS.poison);
  else if (action === 'down_vault_technician') director.enemyDown(TECHNICIAN_IDS.vault);
  else director.interact(action);
};
const replayMissionGraph = (timings, actions) => {
  const director = createGraphMission(timings);
  for (const action of actions) applyMissionGraphAction(director, action);
  return { director, state: director.getState() };
};
const missionGraphSignature = (director, state = director.getState()) => JSON.stringify({
  stage: state.stage,
  complete: state.complete,
  failed: state.failed,
  outcome: state.outcome,
  clocks: [state.poison.remaining, state.vault.remaining, state.hold.remaining],
  technicians: [state.technicians.poison.neutralized, state.technicians.vault.neutralized],
  flags: [
    state.flags.poisonPrevented,
    state.flags.poisonReleased,
    state.flags.vaultSecured,
    state.flags.vaultBreached,
    state.flags.supplyValveClosed,
    state.flags.backdoorPipeDemolished,
    state.flags.counterattackActive,
    state.flags.defenseComplete,
  ],
  interactions: [
    director.canInteract('neutralize_poison'),
    director.canInteract('close_supply_valve'),
    director.canInteract('demolish_backdoor_main_pipe'),
  ],
});
const exploreMissionGraph = (timings) => {
  const initial = replayMissionGraph(timings, []);
  const initialSignature = missionGraphSignature(initial.director, initial.state);
  const entries = new Map([[initialSignature, { path: [], state: initial.state }]]);
  const edges = new Map();
  const queue = [initialSignature];

  while (queue.length) {
    const signature = queue.shift();
    const entry = entries.get(signature);
    const successors = new Set();
    for (const action of missionGraphActions) {
      const nextPath = [...entry.path, action];
      const next = replayMissionGraph(timings, nextPath);
      const nextSignature = missionGraphSignature(next.director, next.state);
      if (nextSignature === signature) continue;
      successors.add(nextSignature);
      if (!entries.has(nextSignature)) {
        entries.set(nextSignature, { path: nextPath, state: next.state });
        queue.push(nextSignature);
      }
    }
    edges.set(signature, successors);
  }

  const terminal = new Set(
    [...entries].filter(([, entry]) => entry.state.complete || entry.state.failed).map(([signature]) => signature),
  );
  const canReachTerminal = new Set(terminal);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [signature, successors] of edges) {
      if (canReachTerminal.has(signature)) continue;
      if ([...successors].some((next) => canReachTerminal.has(next))) {
        canReachTerminal.add(signature);
        expanded = true;
      }
    }
  }
  const deadlocks = [...entries].filter(([signature, entry]) => (
    !entry.state.complete && !entry.state.failed && (edges.get(signature)?.size ?? 0) === 0
  ));
  const stranded = [...entries].filter(([signature]) => !canReachTerminal.has(signature));
  return { entries, edges, terminal, deadlocks, stranded };
};

const vaultFirstGraph = exploreMissionGraph({ poisonSeconds: 5, vaultSeconds: 3 });
const poisonFirstGraph = exploreMissionGraph({ poisonSeconds: 3, vaultSeconds: 5 });
const missionGraphEntries = [...vaultFirstGraph.entries.values(), ...poisonFirstGraph.entries.values()];
const graphOutcomes = new Set(
  missionGraphEntries.filter((entry) => entry.state.complete).map((entry) => entry.state.outcome),
);
const breachedThenStopped = [...vaultFirstGraph.entries.values()].find((entry) => (
  entry.state.flags.vaultBreached && entry.state.flags.poisonPrevented && !entry.state.flags.poisonReleased &&
  entry.state.stage === 'hold_reinforcements' && entry.state.hold.active &&
  !entry.state.flags.vaultTechnicianNeutralized && entry.path.includes('neutralize_poison') &&
  !entry.path.includes('down_vault_technician')
));
assert(
  missionGraphEntries.length >= 50 && vaultFirstGraph.terminal.size > 0 && poisonFirstGraph.terminal.size > 0 &&
    vaultFirstGraph.deadlocks.length === 0 && poisonFirstGraph.deadlocks.length === 0 &&
    vaultFirstGraph.stranded.length === 0 && poisonFirstGraph.stranded.length === 0,
  'the exhaustive public-action mission graph has no deadlock or state stranded from a terminal outcome',
);
assert(
  graphOutcomes.has('technicians_secured') && graphOutcomes.has('valve_closed') &&
    graphOutcomes.has('pipe_demolished'),
  'the exhaustive mission graph reaches clean-water, valve, and backdoor-pipe endings under both clock orders',
);
assert(
  Boolean(breachedThenStopped) && breachedThenStopped.state.outcome === 'technicians_secured' &&
    breachedThenStopped.state.flags.poisonPrevented && !breachedThenStopped.state.flags.poisonReleased,
  'stopping poison after a vault breach immediately secures clean water without an extra specialist kill',
);

if (failures.length) {
  console.error(`CLEARWATER check failed (${failures.length}):`);
  for (const item of failures) console.error(`  ✗ ${item}`);
  process.exit(1);
}

console.log(`CLEARWATER check passed: ${passes.length} assertions across ${jsFiles.length} modules and ${manifest.assets.length} declared assets.`);
