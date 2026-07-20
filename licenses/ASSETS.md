# OPERATION CLEARWATER asset notes

All runtime files live inside the `CLEARWATER` folder. The game makes no CDN or neighboring-project requests.

## Three.js

Three.js 0.185.1 is vendored under `vendor/three` and used under the MIT License. Its upstream license is preserved as `vendor/three/LICENSE` and copied to `licenses/THREE-LICENSE.txt`.

## Microsoft Rocketbox humans

The skinned security character, animation clips, and character textures come from [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), released under the MIT License. TGA textures were locally converted to JPEG for browser delivery; their visual content is unchanged. The FBX's equal-length texture filename extensions were updated from `.tga` to `.jpg`.

The first-person arms use Rocketbox's [`Military_Male_04`](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Military_Male_04) avatar from the same MIT-licensed collection. The original copyright and MIT terms are preserved verbatim in [`licenses/ROCKETBOX-LICENSE.md`](ROCKETBOX-LICENSE.md).

- `assets/models/hands/military-male-04-arms.fbx` is a local rename of the exact upstream [`Export/Military_Male_04.fbx`](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/Assets/Avatars/Professions/Military_Male_04/Export/Military_Male_04.fbx), not a separately authored or generated hands model. Its Git blob identity is unchanged (`632aff9a21c1e8e8c4d8c9869d449cbb36ac8f99`). The packaged FBX retains the complete skinned avatar, human proportions, skeleton, and finger rig; at runtime CLEARWATER derives and displays only the skin-weighted forearm and hand geometry for the first-person viewmodel.
- `assets/models/hands/sm005_body_color_acu.jpg` is a 1024 px JPEG conversion of upstream [`sm005_body_color_acu.tga`](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/Assets/Avatars/Professions/Military_Male_04/Textures/sm005_body_color_acu.tga), used as the forearm, glove, and exposed-skin base color.
- `assets/models/hands/sm005_body_normal.png` is a lossless 1024 px PNG conversion of upstream [`sm005_body_normal.tga`](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/Assets/Avatars/Professions/Military_Male_04/Textures/sm005_body_normal.tga), used as the corresponding normal map.
- `assets/models/hands/sm005_body_specular.jpg` is a 1024 px JPEG conversion of upstream [`sm005_body_specular.tga`](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/Assets/Avatars/Professions/Military_Male_04/Textures/sm005_body_specular.tga), used as the corresponding specular map.

The viewmodel supplies these packaged body maps explicitly and does not depend on the FBX's original workstation texture paths. The 36 MB of source TGAs and the duplicate upstream-named FBX are not shipped.

## M4A1

The M4A1 model and texture set were published by `nisu`, sourced from 3DModelsCC0, through [OpenGameArt](https://opengameart.org/content/m4a1-assault-rifle) under CC0 1.0. The active viewmodel uses the complete upstream package (`m4a1_0.zip`): its 278 KB FBX plus base-color, height, metallic, OpenGL-normal, and roughness maps. The earlier 32 KB FBX and diffuse-only texture remain bundled as an archived fallback but are no longer the intended runtime model.

## Poly Haven

`docklands_02_1k.hdr` and the `concrete_pavement_02` texture maps are from [Poly Haven](https://polyhaven.com/) and are CC0 1.0. They are bundled locally.

The Ridgewatch revision also bundles Poly Haven's **Pine Sapling Small**, **Shrub 02**, **Shrub 04**, **Grass Medium 02**, **Boulder 01**, **Rock 07**, **Mud Forest**, **Withered Grass**, and **Dry Ground Rocks** assets. These are the real modeled vegetation, stone, and PBR ground materials used by the playable landscape; they are likewise released under [Poly Haven's CC0 license](https://polyhaven.com/license). **Mud Forest** is the active exterior terrain material: its dark wet soil, leaf litter, and fine organic debris replace the earlier dry highland surface. Exact authors, source pages, payloads, and integrity checks are recorded in `assets/nature/ASSET_PROVENANCE_PROPOSAL.md`.

## NASA Global Hawk

`global-hawk.glb` was copied, never moved, from the user's local `3D stuff/airplane-model` folder. Its macOS download-origin metadata identifies NASA's official [Global Hawk model](https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/model/global-hawk/Global%20Hawk.glb); the direct URL is also preserved in `assets/manifest.json`. It is used for the opening reconnaissance flyover and associated fictionalized EO/IR presentation. NASA's [media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) apply. NASA does not endorse this game or its fictional mission.

## Global Hawk flyby audio

`assets/audio/jet-plane-flyby.mp3` is the locally packaged high-quality preview of [Jet Plane Flyby by qubodup](https://freesound.org/people/qubodup/sounds/189446/), released under CC0 1.0 and described by its author as extracted from U.S. Government agency footage. CLEARWATER blends this real Doppler pass with a restrained procedural low-frequency UAV layer. Playback makes no external request.

## Generated key art

`clearwater-keyart.png` was generated specifically for this project with OpenAI's built-in image-generation tool. It is used only in the briefing and closing presentation; the playable landscape and characters are true 3D assets.

`clearwater-ridge-keyart.png` was generated specifically for the Ridgewatch reservoir revision with OpenAI's built-in image-generation tool. It replaces the original key art in the briefing and closing presentation; the playable landscape, vegetation, structures, and characters remain true 3D assets.

`clearwater-waterworks-keyart.png` was generated specifically for the Operation Clearwater mission revision with OpenAI's built-in image-generation tool. It is the current briefing and outcome-screen artwork, depicting the seized municipal waterworks premise; all playable terrain, architecture, aircraft, weapons, vegetation, and characters remain true 3D assets.
