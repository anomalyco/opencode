# Arcade cabinet model

The 3D 404 page's cabinet (`cabinet-glb.ts` loads `cabinet.glb`).

## Source and licence

- Model: "Arcade Machine" by MitchellBr — https://sketchfab.com/3d-models/arcade-machine-5551c32834344b75996d5c911d8d9644
- Licence: Creative Commons Attribution 4.0 (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/
- Attribution to show on the site: "Arcade cabinet based on “Arcade Machine” by MitchellBr (Sketchfab), CC BY 4.0, modified."
- The marquee, bezel and side-script art come from the project's own FLORA reference renders.

## Changes from the source

- Scaled to 1.8 m tall, origin at the floor centre, front facing +Z, metres. The body is widened to 0.66 m; round parts (buttons, sticks, locks, coin parts) keep their shape.
- One coin mech, centred, with a lit square insert (`coinSlot`) and a slit; the second mech and coin return are removed.
- The controls are centred. Two red ball-top joysticks; the back row of buttons is red, yellow and blue, the front row white; two white start buttons.
- The flat glass is replaced by a bezel with a rounded opening (0.42 × 0.285 m, the CRT's aspect), with "1 PLAYER" and "2 PLAYER". The CRT is trimmed to the opening and has 0–1 UVs.
- Re-textured: navy paint, worn and scratched, chipped edges, dust on top faces and grime near the floor; link-blue T-molding; a faded "ANOMALY" script on both side panels (it reads bottom to top on both sides, not mirrored); a speaker grille; an "INSERT COIN" plate; the ANOMALY marquee. All Pac-Man art is gone.
- One baked PBR atlas for the body (base colour, ORM, normal); small parts use plain materials. Geometry is meshopt-compressed.

## Files

| File               | Textures                                       | Download | GPU textures | Use                                                                   |
| ------------------ | ---------------------------------------------- | -------- | ------------ | --------------------------------------------------------------------- |
| `cabinet.glb`      | WebP, 2048 atlas                               | 0.94 MB  | ~73 MB       | Desktop. Works with the current loader.                               |
| `cabinet-lite.glb` | WebP, 1024 atlas                               | 0.45 MB  | ~18 MB       | Phones and the low tier.                                              |
| `cabinet.ktx2.glb` | KTX2 (Basis), 2048 colour, 1024 ORM and normal | 1.77 MB  | ~10 MB       | Desktop, when the loader has a `KTX2Loader` (transcoder in `basis/`). |

All three have 7,848 triangles.

## Integration note

Coordinates are in cabinet space: metres, +Y up, front +Z, floor at y = 0, centred on x = 0.

- Size: 0.66 wide × 1.80 tall × 0.74 deep (z −0.37 to +0.37).
- `screen`: the CRT glass, curved, 9 to 43 mm behind the bezel. Its UVs span the visible picture: u 0→1 from left to right, v 0→1 from bottom to top as seen from the front (like `PlaneGeometry`). Opening centre (0, 1.227, −0.002), normal (0, 0.354, 0.935), 0.420 × 0.285 m.
- `coinSlot`: the lit insert. Its origin is the slit centre, (0, 0.693, 0.266); the coin goes in along −Z. Material `lamp` (the loader clones it and drives its emissive). `coinSlit` is the black slit.
- `coinReturn`: (0, 0.548, 0.259), origin at the front of the flap.
- `marquee`: the front of the top box, 0.60 × 0.13 m, y 1.626 to 1.759. Material `marquee` has the art in `map` and no emissive map (the loader sets `emissiveMap = map`). The art is bright even unlit; for the dark first state, consider scaling `material.color` down (about 0.25) until power-up.
- `edges`: the side panels' T-molding. It shares the `body` material in the file; the loader clones it, so its emissive only tints the molding.
- `joysticks` → `joystick1P` (−0.199, 1.023, 0.226), `joystick2P` (0.050, 1.023, 0.226). Origins at the base of each stick, so a rotation about the origin tilts the stick.
- `buttons` → `button1P-1…6`, `button2P-1…6` (on the panel, origins at their centres), `start1P`, `start2P` (on the panel's front face at x ∓0.129, y 0.921).
- `bezel`, `insertCoin`, `body`: static.
- The bottom of the cabinet is open (never seen from the floor).
- To use the KTX2 file: `new KTX2Loader(manager).setTranscoderPath("/arcade3d/basis/").detectSupport(renderer)` and `loader.setKTX2Loader(...)`.

`candidates/` holds the other models compared in the studio (`/dev/arcade-studio`). They are for development only; do not ship them.
