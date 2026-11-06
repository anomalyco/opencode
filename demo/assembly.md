# Assembly smoke test

```visual
{
  "v": 1,
  "kind": "assembly",
  "title": "The stack opens along the input shaft",
  "subtitle": "Housing, input shaft, 24-tooth gear, bearing, and cover",
  "unit": "mm",
  "data": {
    "explode": 0.65,
    "parts": [
      { "id": "housing", "label": "Housing", "shape": "box", "size": [150, 110, 110], "position": [-55, 55, 0], "tone": "dark", "explode": [-30, 0, 0] },
      { "id": "shaft", "label": "Input shaft", "shape": "shaft", "size": [20, 170, 20], "position": [0, 55, 0], "rotation": [0, 0, 90], "tone": "steel", "explode": [10, 0, 0] },
      { "id": "gear", "label": "Gear z24 m2", "shape": "gear", "size": [52, 14, 52], "position": [-10, 55, 0], "teeth": 24, "module": 2, "thickness": 14, "hole": 20, "tone": "accent", "explode": [40, 0, 0] },
      { "id": "bearing", "label": "Bearing 6204", "shape": "bearing", "size": [47, 14, 47], "position": [10, 55, 0], "hole": 20, "tone": "steel", "explode": [70, 0, 0] },
      { "id": "cover", "label": "Cover plate", "shape": "plate", "size": [6, 110, 110], "position": [23, 55, 0], "tone": "steel", "explode": [100, 0, 0] }
    ]
  },
  "caption": "Drag to orbit. The explode control separates the stack along the shaft axis. The list is an axial parts list, not a work instruction.",
  "note": "Simplified geometry. The housing is solid, the bearing is a plain torus, the cover sits at the housing face, and gear teeth are trapezoidal rather than involute."
}
```

A WebGL canvas should replace the fence. If the fence stays as code, the assembly chunk did not load.
