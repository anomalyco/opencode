# Visual plugin smoke test

This file is opened in the app's Markdown preview. The fence below must render as an interactive four-bar linkage.

```visual
{
  "v": 1,
  "kind": "mechanism",
  "title": "Crank-rocker: the rocker reverses at its limits",
  "unit": "mm",
  "data": { "type": "fourbar", "a": 34, "b": 104, "c": 74, "d": 128, "branch": "open", "rpm": 18 },
  "caption": "The dashed arc is the rocker path; the two limit links mark where it reverses.",
  "note": "Planar rigid-body kinematics, no joint clearance."
}
```

If the fence above stays as code, the CodeBlock contribution did not replace it.
