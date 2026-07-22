# OPERATION CLEARWATER

Operation Clearwater is a self-contained 3D tactical story FPS set at Ridgewatch, the municipal waterworks serving 218,000 people on the fictional island of Oris.

## Play online

**[Launch Operation Clearwater](https://operation-clearwater.pages.dev/)** in a
modern desktop browser. The Cloudflare Pages edition is the complete game and
does not require installation.

## Creation credit

Operation Clearwater was fully assembled, programmed, written, and iterated by
**OpenAI GPT-5.6-sol**, under the creative direction and playtesting of Fujia
Zhang. The game uses properly attributed third-party models, textures, audio,
and libraries listed in [License and attribution](#license-and-attribution).

An armed terrorist cell has stolen municipal guardian uniforms and occupied the supply plant. Eighteen disguised guards protect two specialists: a poison technician preparing the dosing machine and a vault technician working to defeat the city-supply valve. If a specialist falls, any surviving hostile can replace them, but the work advances only while an operator is within 1.35 metres of the relevant controls. A Global Hawk EO/IR pass opens the operation by identifying all twenty people and marking the valve vault, injection machine, and emergency demolition point. Coast Guard marksman Mara Venn then inserts alone from the grassland beyond the perimeter.

Two independent technical clocks begin at insertion: **05:00** until poison transfer and **02:30** until the valve vault is breached. Mara's primary route is to neutralize the poison operator or isolate the injection machine; once the poison is stopped, the city is safe even if the backup valve vault was breached. If poison is released, she must close the manual valve before the breach. Only if both protections fail does the south-backdoor city-main demolition become available. Every successful route ends with a counterattack and reinforcement hold, and killing all twenty hostiles is never required.

## Run offline

Download or clone the complete repository. The launchers start the bundled
local server and open the game in your default browser:

- **macOS:** double-click `Open CLEARWATER.command`.
- **Windows:** double-click `Open CLEARWATER.bat`.
- **Linux:** run `./open-clearwater.sh`.

Node.js 18 or newer is required for the offline launchers. You can also start
the game from any terminal:

```sh
cd "/path/to/CLEARWATER"
npm start
```

Then open <http://127.0.0.1:4173>.

No package download, external server, or internet connection is needed after
the repository and Node.js are present. Opening `index.html` directly is not
supported because browsers block local model loading; use the included tiny
local server.

## Releases

The [latest GitHub release](https://github.com/ZFrankJ/operation-clearwater/releases/latest)
provides a stable, downloadable offline edition. GitHub also supplies ZIP and
tar.gz source archives for every release. Extract the complete archive, then use
the launcher for your operating system from [Run offline](#run-offline).

GitHub Packages is intentionally not used: Operation Clearwater is a static web
game, not a reusable software dependency or container image. Releases are the
appropriate distribution channel for its offline edition.

## Controls

- `W A S D` — move
- Mouse — aim
- Left mouse — fire
- Right mouse — aim down sights / magnify
- `X` — hold to aim down sights / magnify
- Home aim selector — choose `2×`, `4×`, or `8×` aim magnification before deployment
- `2`, `4`, or `8` — change aim magnification directly during the operation
- `R` — reload
- `E` — hold to interact
- `Shift` — sprint / lower weapon
- `C` or `Ctrl` — crouch / crawl
- `Space` — jump / short vault
- `Esc` — pause and release mouse

The home difficulty selector offers **Easy**, **Normal**, **Hard**, and **Extreme**, with **Normal selected by default**. Easy preserves the forgiving original balance. Each harder setting progressively raises hostile health and accuracy while reducing player health; Hard is a genuine one-life run. Extreme is also one-life: enemies wear concealed ballistic vests, headshots are lethal, and body shots cause only limited damage.

## Mission route

1. Watch the Global Hawk identify eighteen guards, the poison technician, the vault technician, and the three strategic targets.
2. Insert from the concealed northwest grassland and follow the compacted-track dogleg toward the offset north gate.
3. Choose the north control entry or west service door into the **dry process gallery**. Enclosed tanks, pump skids, and overhead pipework replace the old exposed indoor reservoir.
4. Stop whoever is physically operating the poison controls or isolate the injection machine before **05:00**; the **02:30** vault clock likewise advances only while an enemy is working at the vault.
5. If needed, penetrate the secured valve vault, isolate the city supply with the manual wheel, and hold the position for **01:00** against the counterattack. A hostile who returns to an unsecured console resumes that operation, so the dosing controls must remain defended.
6. Only if poison transfer and valve security both fail, use the valve-house south backdoor and place a charge on the exposed city-main pipe.
7. Neutralize guards who block the chosen route; a twenty-kill sweep is never an objective or an unlock condition.

## Design promises

- A deliberately authored infiltration route that begins beyond the occupied perimeter, never among the enemy patrols.
- A concealed dogleg approach, two independently usable process-gallery doors, an offset valve-vault route, and a real south backdoor fallback.
- A compact home briefing that keeps magnification and difficulty selection visible without covering the key art with a full player card.
- Denser grass, shrubs, trees, and rocks outside the fence, with the operating yard kept visibly maintained and sparse.
- Buildings visibly seated on foundations and connected by gravel approaches rather than floating construction pieces.
- Compact Ridgewatch municipal enamel signs shared across every facility building instead of oversized mismatched placards.
- A dry, grounded municipal process gallery built from enclosed pressure tanks, pump skids, and connected pipe manifolds rather than an implausible indoor pool.
- A fully fenced reservoir edge plus solid barriers, buildings, equipment, and cover that block both the player and enemies.
- Skinned, textured human models—not visible collision capsules or stacked primitives.
- Local PBR materials and image-based lighting.
- Alert enemies that investigate, pursue, use cover, respect obstacles, and fire from their weapon muzzle.
- Two visible technical countdowns—**05:00 poison transfer** and **02:30 valve-vault breach**—with objective outcomes independent of total kill count.
- Three coherent resolution paths: prevent poison and hold, secure the valve and hold, or demolish the backdoor pipe only after both safeguards fail.
- A service carbine with recoil, selectable 2×/4×/8× field-of-view aiming on either right mouse or `X`, direct `2`/`4`/`8` switching in play, visible chamber/magazine cartridges, bolt and charging-handle cycling, and a compact fully animated magazine change.
- Real skinned Rocketbox tactical-glove arms that hold the pistol grip and handguard, then move with ADS, sprint, and reload choreography.
- Tucked two-hand enemy rifle poses, a 90-degree upward rear-wrist correction, and a compact support-hand reload envelope.
- Accurate unaware torso or head placement incapacitates a standard guard before return fire; established combat retains the normal multi-hit balance.
- Deterministic encounters and authored approaches without requiring a full twenty-hostile extermination.
- No horror imagery or horror story beats.

## License and attribution

CLEARWATER's source code is released under the MIT License. Third-party assets
retain their own licenses:

- Microsoft Rocketbox characters, animations, and first-person arms: MIT.
- M4A1 model and textures: CC0 1.0.
- Poly Haven models, textures, and HDRI: CC0 1.0.
- Global Hawk model: NASA media usage guidelines. NASA is the source of the
  model and does not endorse this game or its fictional mission.
- Three.js: MIT.

See `licenses/ASSETS.md`, the preserved license texts under `licenses/`, and
`assets/manifest.json` for exact provenance.
