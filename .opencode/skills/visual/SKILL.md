---
name: visual
description: Use for any mechanical, industrial, or technical answer where a drawing, chart, mechanism, or interactive exhibit would prove the point, even when the user did not ask. Use whenever the user mentions visual, visualization, diagram, chart, animation, simulation, interactive, or asks to see something. Renders an inline interactive visual in the conversation. Not for ordinary tables, static labeled structures that Mermaid already covers, or project files.
---

# Visual blocks

Write one fenced block with the `visual` language and a JSON spec. The desktop app replaces the fence with an interactive renderer that uses the host theme. The renderer owns the layout and the math; you supply the parameters and the claim.

Use a visual when seeing or manipulating the thing answers the question. Keep prose to the claim and the takeaway. Do not restate the labels or the numbers in the visual.

## Decide before you answer

Before writing a technical answer, decide silently whether a visual would make the claim easier to see. If one would, include it. Do not ask the user whether they want a visual, and do not describe the decision. If the user asks for a visual, you must include at least one visual even when the topic is simple.

## When not to use it

- A table answers the question. Write a Markdown table.
- A static structure with labeled nodes and edges is enough. Write a Mermaid block.
- The user asked for a file, site, report, or project change. Build the file, not an inline visual.
- The numbers are unknown. Do not invent data to fill a chart. Ask, or show the method with a clearly marked placeholder.
- You would need more than four visuals to answer one question. Pick the two that prove the point.

## Contract

- Top level: `v` is `1`, `kind` names the renderer, `title` states the claim, `data` holds the parameters.
- `unit` names the units used by the numbers. `caption` is one sentence under the visual. `note` states assumptions or limits. `source` names the formula, standard, or reference.
- Numbers carry units and a real basis. Every computed result must come from the supplied parameters. State the formula or assumption in `source` or `note`.
- Keep specs under 256 kB. Keep series under eight, points under 4,000 per series, parts under forty, nodes under fourteen.
- Use the kind that matches the table below.
- Do not add HTML, JavaScript, colors, or CSS. The renderer colors every mark from the app theme.
- Write the block after the prose that introduces it. Keep one claim per visual.

## Choosing a kind

| Question | Kind |
| --- | --- |
| How does the mechanism move? | `mechanism` |
| Is this beam strong and stiff enough? | `beam` |
| What are the principal stresses? | `mohr` |
| How does a material behave past yield? | `stress-strain` |
| How much work does a gas cycle produce? | `pv` |
| Will the tolerances stack up? | `tolerance` |
| How does the process flow? | `flow` |
| What does the assembly look like? | `assembly` |
| What is the agent doing? | `task` |
| What is the structure or decision path? | `diagram` |
| How do two quantities compare? | `plot` |

## Minimum examples

Four-bar linkage:

```visual
{"v":1,"kind":"mechanism","title":"Crank-rocker","unit":"mm","data":{"type":"fourbar","a":34,"b":104,"c":74,"d":128,"branch":"open","rpm":18},"caption":"The rocker reverses where the crank and coupler become collinear.","note":"Planar rigid-body kinematics, no joint clearance."}
```

Simply supported beam:

```visual
{"v":1,"kind":"beam","title":"Pin beam under 12 kN","unit":"m, kN, mm","data":{"type":"simply-supported","length":4,"loads":[{"type":"udl","from":0,"to":4,"magnitude":8},{"type":"point","x":3,"magnitude":12}],"section":{"shape":"rect","b":100,"h":200},"E":200,"yield":250},"caption":"The peak moment sits just past the point load.","source":"Euler-Bernoulli beam theory"}
```

Agent progress:

```visual
{"v":1,"kind":"task","title":"Checking the gearbox","data":{"status":"running","steps":[{"label":"Read the brief","state":"done"},{"label":"Size the shaft","state":"active","detail":"6204 bearing"},{"label":"Check the pin","state":"pending"}]}}
```

Read `reference.md` in this skill for every field and the full examples.
