# OPERATION CLEARWATER Nature Pack - provenance proposal

This folder is a self-contained, 1K-resolution CC0 nature pack selected for a grounded coastal-reservoir scene. Its runtime assets are registered in the project manifest and top-level license inventory.

## License and source policy

- Provider: [Poly Haven](https://polyhaven.com/)
- Asset license: [Poly Haven CC0 license statement](https://polyhaven.com/license)
- Legal instrument: [Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Programmatic download metadata: [Poly Haven public API](https://polyhaven.com/our-api)

Poly Haven states that its HDRIs, textures, and 3D models are CC0/public-domain assets and may be used for any purpose without required attribution. The credits below are retained voluntarily for provenance.

## Selected 3D models

| Local folder | Source | Author credit | Downloaded payload | Scene role |
| --- | --- | --- | ---: | --- |
| `models/pine_sapling_small/` | [Pine Sapling Small](https://polyhaven.com/a/pine_sapling_small) | Rob Tuytel, photography; Rico Cilliers, modeling | 21,891,339 bytes | Three visibly different, fully modeled coastal-pine forms. Use as a small number of hero/near trees and vary scale/rotation. |
| `models/shrub_02/` | [Shrub 02](https://polyhaven.com/a/shrub_02) | Rico Cilliers | 1,966,425 bytes | Four low, narrow evergreen shrub forms resembling hardy coastal scrub. |
| `models/shrub_04/` | [Shrub 04](https://polyhaven.com/a/shrub_04) | Rico Cilliers | 1,907,514 bytes | Four broad-leaf shrub forms for natural variation around rocks and embankments. |
| `models/grass_medium_02/` | [Grass Medium 02](https://polyhaven.com/a/grass_medium_02) | Rico Cilliers | 801,474 bytes | Five dry grass clumps; suited to sparse placement over tiled ground. |
| `models/boulder_01/` | [Boulder 01](https://polyhaven.com/a/boulder_01) | Rico Cilliers | 5,771,986 bytes | Irregular warm, fractured outcrop for large collision cover and reservoir edges. |
| `models/rock_07/` | [Rock 07](https://polyhaven.com/a/rock_07) | Jenelle van Heerden | 2,184,088 bytes | Small dark weathered rock for scale variation and ground breakup. |

Each model directory contains one `.gltf`, its binary mesh payload, and every referenced 1K JPEG texture at the same relative URI used by the glTF. No model relies on a URL, sibling project, or missing external file.

## Selected PBR surfaces

| Local folder | Source | Author credit | Downloaded payload | Included channels |
| --- | --- | --- | ---: | --- |
| `surfaces/mud_forest/` | [Mud Forest](https://polyhaven.com/a/mud_forest) | eye-candy.xyz | 3,568,038 bytes | diffuse, OpenGL normal, roughness, ambient occlusion |
| `surfaces/withered_grass/` | [Withered Grass](https://polyhaven.com/a/withered_grass) | Charlotte Baglioni | 4,430,072 bytes | diffuse, OpenGL normal, roughness, ambient occlusion |
| `surfaces/dry_ground_rocks/` | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) | Rob Tuytel | 3,155,815 bytes | diffuse, OpenGL normal, roughness, ambient occlusion |

All surface maps are 1024 x 1024 JPEGs. `mud_forest` is the active broad terrain material; `dry_ground_rocks` is the service path, shoreline, and exposed aggregate material. `withered_grass` remains packaged as provenance for the earlier terrain treatment but is no longer loaded at runtime.

## Verification record

- Total payload: 45,676,751 bytes (45 MiB on disk), 45 files.
- Every downloaded file matches the MD5 supplied by Poly Haven's `/files/{asset}` API response.
- Every URI declared by all six glTF documents resolves to a file inside its own asset directory; missing dependency count: zero.
- No glTF uses Draco, Meshopt, Basis/KTX2, or another decoder that would require an additional runtime.
- The pine uses standard `KHR_materials_specular` and `KHR_materials_ior`; Three.js `GLTFLoader` supports both. Vegetation uses standard glTF `MASK`/`BLEND` alpha materials.
- Surface files were identified as valid 1024 x 1024 JPEG images.

Approximate mesh budget from glTF accessors:

| Model | Variants / meshes | Triangles total |
| --- | ---: | ---: |
| Pine Sapling Small | 3 | 398,144 |
| Shrub 02 | 4 | 27,254 |
| Shrub 04 | 1 | 27,327 |
| Grass Medium 02 | 5 | 7,842 |
| Boulder 01 | 1 | 66,122 |
| Rock 07 | 1 | 14,844 |

## Integration cautions

- The pine is intentionally high fidelity. Keep only a handful of its three hero meshes close to the playable path; do not deep-clone the complete 398k-triangle collection dozens of times. For distant woodland, reuse selected meshes with instancing or a later billboard/LOD pass.
- Preserve imported foliage `alphaTest`, `side`, and transparency settings. Replacing the glTF materials with opaque generic materials will turn leaf cards into visible rectangles.
- Use the supplied `_nor_gl_` maps directly as Three.js normal maps; do not invert their green channel.
- Generated terrain needs a second UV channel before applying the AO textures. Repeating the two ground materials at different scales and breaking their boundary with grass/rocks will hide obvious tiling.
- Add collisions around tree trunks and boulders separately from visual leaf/rock geometry; mesh-level collision against the full photogrammetry would be unnecessarily expensive.
