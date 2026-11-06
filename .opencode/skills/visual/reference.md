# Visual spec reference

Every block is one JSON object. Unknown fields are ignored. Missing optional fields use the defaults below.

```json
{
  "v": 1,
  "kind": "mechanism",
  "title": "Claim in one line",
  "subtitle": "Context, parameters, or configuration",
  "caption": "One sentence the reader needs after the visual.",
  "note": "Assumptions and limits.",
  "source": "Formula, standard, or reference.",
  "unit": "mm, kN, MPa",
  "height": 320,
  "data": {}
}
```

`v` is required. `title` is required. `height` is optional and capped at 720. `unit` is a display string, not a unit system. Put the actual unit of each number in the field name or in `unit`, and keep them consistent.

## mechanism

Planar linkage kinematics. One degree of freedom.

```json
{
  "type": "fourbar",
  "a": 34, "b": 104, "c": 74, "d": 128,
  "branch": "open",
  "rpm": 18,
  "angle": 38,
  "trace": false
}
```

- `type`: `fourbar` or `crank-slider`.
- Four-bar: `a` crank, `b` coupler, `c` rocker, `d` ground. `branch` is `open` or `crossed`.
- Slider-crank: `r` crank radius, `l` connecting rod, `offset` slider offset from the crank axis.
- `rpm` sets animation speed. `angle` is the starting crank angle in degrees. `trace` draws the coupler point path.
- The renderer computes joint positions by circle intersection, shows the transmission angle, checks Grashof, and reports stroke and rod ratio for a slider-crank.
- Place all lengths in the same unit. The app does not convert.

## beam

Statically determinate beam with linear elastic Euler-Bernoulli deflection.

```json
{
  "type": "simply-supported",
  "length": 4,
  "unit": "m",
  "loads": [
    { "type": "udl", "from": 0, "to": 4, "magnitude": 8 },
    { "type": "point", "x": 3, "magnitude": 12 }
  ],
  "section": { "shape": "rect", "b": 100, "h": 200 },
  "E": 200,
  "yield": 250
}
```

- `type`: `simply-supported` or `cantilever`. Supports sit at both ends for a simply supported beam, and the fixed end is at zero for a cantilever.
- `length` in metres. Point loads in kN, UDL in kN/m. Downward is positive.
- `section.shape`: `rect` (`b`, `h`), `circle` (`d`), or `ibeam` (`b`, `h`, `tw`, `tf`). Section dimensions are millimetres.
- `E` is Young's modulus in GPa. `yield` is the yield strength in MPa.
- The renderer computes reactions, shear, bending moment, peak stress, utilization, and deflection. It draws the free body, shear diagram, moment diagram, and an exaggerated deflection curve.
- Do not state a peak value in prose unless you compute it with the same parameters.

## mohr

Plane stress, isotropic, linear elastic.

```json
{ "sigmaX": 80, "sigmaY": 20, "tauXY": 40 }
```

- All values in the same stress unit, normally MPa.
- `tauXY` is positive on the positive x face in the positive y direction.
- The renderer computes the centre, radius, principal stresses, maximum shear, and principal angle. The slider rotates the plane from 0 to 180 degrees.

## stress-strain

```json
{
  "materials": [
    { "name": "Steel S275", "E": 200, "yield": 275, "ultimate": 430, "ultimateStrain": 15, "fractureStrain": 22 },
    { "name": "Aluminium 6061-T6", "E": 69, "yield": 276, "ultimate": 310, "ultimateStrain": 8, "fractureStrain": 12 }
  ]
}
```

- `E` in GPa, stresses in MPa, strains in percent.
- Use `points: [[strainPercent, stressMPa], ...]` instead of the four parameters when you have measured data. The renderer plots the points directly.
- The generated curve is linear to yield, then linear hardening to ultimate, then a drop to fracture. It is a teaching idealization, not a mill certificate.

## pv

```json
{
  "gas": { "gamma": 1.4 },
  "steps": [
    { "type": "adiabatic", "label": "Compression", "from": [100, 1.0], "to": [695.8, 0.25] },
    { "type": "isochoric", "label": "Heat addition", "p1": 695.8, "p2": 2200, "v1": 0.25 },
    { "type": "adiabatic", "label": "Expansion", "from": [2200, 0.25], "to": [315.9, 1.0] },
    { "type": "isochoric", "label": "Heat rejection", "p1": 315.9, "p2": 100, "v1": 1.0 }
  ]
}
```

- `from` and `to` are `[pressure, specificVolume]`. Pressure in kPa, specific volume in m³/kg, work in kJ/kg.
- `type`: `isothermal` (`n = 1`), `adiabatic` (`n = gamma`), `isochoric` (`v` constant), `isobaric` (`p` constant), or `polytropic` (`n` supplied).
- For a polytropic step you may give `from` and `to`, or `from` and `ratio` (`v2 / v1`), or `p1`, `v1`, and `v2`.
- Work is `p1 v1 ln(v2/v1)` for `n = 1`, and `(p2 v2 - p1 v1) / (1 - n)` otherwise. Constant volume work is zero.
- The renderer shades positive work and animates a piston with the current state.

## tolerance

```json
{
  "nominal": 0.3,
  "limits": { "upper": 0.3, "lower": 0.3 },
  "stack": [
    { "name": "Shaft diameter", "plus": 0.05, "minus": 0.05 },
    { "name": "Bearing width", "plus": 0.02, "minus": 0.01 },
    { "name": "Spacer", "plus": 0.1, "minus": 0.05 },
    { "name": "Housing depth", "plus": 0.08, "minus": 0.08 }
  ]
}
```

- All dimensions in the same unit.
- `nominal` is the controlled result, for example a clearance. The stack items are the tolerance contributors; they carry only tolerances.
- `plus` and `minus` are absolute tolerance magnitudes, always positive. The worst case adds every contribution.
- Worst case is `sum(plus)` and `sum(minus)`. RSS is `sqrt(sum(((plus + minus) / 2)^2))`.
- `limits` is optional. When present, the renderer states whether the worst case fits.
- Do not mix worst-case and RSS in one claim.

## flow

Industrial process schematic.

```json
{
  "nodes": [
    { "id": "tank", "label": "Reservoir", "type": "tank", "detail": "40 L" },
    { "id": "pump", "label": "Pump", "type": "pump", "detail": "12 L/min", "active": true }
  ],
  "edges": [{ "from": "tank", "to": "pump", "label": "suction" }],
  "readouts": [{ "label": "Flow", "value": "12 L/min" }]
}
```

- `type`: `source`, `pump`, `valve`, `tank`, `heat`, `machine`, `sensor`, `sink`.
- `x` and `y` are optional, from 0 to 1. Without them the renderer lays the flow out by graph depth.
- `active` colors one stream or unit with the app accent.
- `readouts` is at most two rows of `{ "label", "value" }`.
- This is a schematic, not a hydraulic calculation. Do not imply pressure drop or cavitation analysis unless you computed it.

## assembly

```json
{
  "explode": 0.65,
  "parts": [
    { "id": "housing", "label": "Housing", "shape": "box", "size": [150, 110, 110], "position": [-55, 55, 0], "tone": "dark", "explode": [-30, 0, 0] },
    { "id": "shaft", "label": "Input shaft", "shape": "shaft", "size": [18, 170, 18], "position": [0, 55, 0], "rotation": [0, 0, 90], "tone": "steel" },
    { "id": "gear", "label": "Gear z24 m2", "shape": "gear", "size": [52, 14, 52], "position": [10, 55, 0], "teeth": 24, "module": 2, "thickness": 14, "hole": 20, "tone": "accent" }
  ]
}
```

- `shape`: `box`, `cylinder`, `shaft`, `gear`, `bearing`, `plate`.
- `size` in millimetres. For a cylinder, `size[0]` is diameter and `size[1]` is length. For a gear, `teeth`, `module`, `thickness`, and `hole` set the geometry. `hole` is the bore diameter in both gears and bearings.
- `position` in millimetres, `rotation` in degrees around x, y, z.
- `explode` is the assembly direction. `explode` at the top sets the initial separation from 0 to 1.
- `tone`: `steel`, `dark`, or `accent`. Use accent for the part the claim is about.
- Gear teeth are simplified trapezoids, not true involute profiles. Say so in `note` when gear meshing matters.

## task

Agent progress, not telemetry.

```json
{
  "status": "running",
  "elapsed": 84,
  "steps": [
    { "label": "Read the brief", "detail": "12 kN at the gear mesh", "state": "done" },
    { "label": "Size the shaft", "state": "active" },
    { "label": "Check the pin", "state": "pending" },
    { "label": "Write the note", "state": "pending" }
  ]
}
```

- `status`: `running`, `done`, or `blocked`.
- `state`: `done`, `active`, `pending`, or `blocked`.
- Keep two to eight steps. Put the artifact each step produces in `detail`.
- Emit this at the start of a long task and again when the state changes. Do not emit a new task block for every tool call.

## diagram

```json
{
  "nodes": [
    { "id": "brief", "label": "Requirement", "detail": "loads, envelope", "tone": "accent" },
    { "id": "model", "label": "Parametric model", "detail": "dimensions" },
    { "id": "check", "label": "Analysis", "detail": "stress, deflection" }
  ],
  "edges": [
    { "from": "brief", "to": "model" },
    { "from": "model", "to": "check" },
    { "from": "check", "to": "model", "label": "revise", "style": "dashed" }
  ]
}
```

- `tone`: `accent`, `muted`, or `critical`.
- `style`: `solid` or `dashed`. `arrow` defaults to true.
- Without `x` and `y`, a chain of three or more nodes lays out vertically. Branching layouts lay out in columns.
- Use this for a process, decision path, or structure. Use Mermaid instead when nodes and edges alone tell the whole story and no interaction is needed.

## plot

```json
{
  "x": { "label": "cycles to failure", "unit": "N", "scale": "log" },
  "y": { "label": "stress amplitude", "unit": "MPa" },
  "series": [
    { "label": "S275 at R = -1", "style": "points", "tone": "accent", "points": [[1000, 420], [10000, 330], [100000, 275], [1000000, 240]] }
  ],
  "annotations": [{ "at": [1000000, 240], "label": "endurance limit" }]
}
```

- `x` and `y` accept `label`, `unit`, `domain` as `[min, max]`, and `scale` as `linear` or `log`.
- `series.style`: `line`, `points`, `area`, or `bar`. `tone`: `accent` or `muted`.
- `annotations[].at` is `[x, y]`.
- Use labels that state the quantity and unit. A chart with no unit is a sketch.

## Review checklist

Before writing the block, check:

- The title states the claim, not the topic.
- Units are named and consistent.
- Every number is either supplied by the user, computed by the renderer, or clearly labeled as an assumption.
- The visual is the smallest one that proves the claim.
- The block has a caption and an assumption or source when the result depends on a model.
- If the user asked for a visual, at least one visual is present.
