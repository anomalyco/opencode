---
name: product-launch-video-ai-app
description: Create high-converting product launch / promo videos for AI coding desktop apps (and similar dev tools): write the script, beat sheet, storyboard, and motion + screen-record animation plan; use when asked for a “launch video”, “product trailer”, “promo”, “explainer video”, “teaser”, or a Remotion/AE/CapCut plan for a desktop app UI demo.
---

# Product Launch Video (AI App)

## Goal

Create a launch-ready plan: messaging → script → storyboard → animation + screen-record direction → export checklist.

## Workflow

### 0) Confirm constraints (ask, then assume if missing)

- Duration target: 15s teaser / 30s social / 60–75s launch / 90–120s explainer
- Aspect ratios: 16:9 (YouTube) + 1:1 or 9:16 cutdowns
- Voiceover: none / VO / captions-only (default: captions-only for social, VO for 60–90s)
- CTA: waitlist / download / docs / “Try it now”
- Proof: metrics, logos, testimonial, benchmark, OSS credibility (if available)

If user provides nothing, default to: 60s, 16:9, VO + captions, CTA = “Download”.

### 1) Build the “message map” (1 sentence each)

- Audience: who is this for (role + context)
- Pain: what they struggle with today
- Promise: your “one big thing” (what changes)
- Proof: why believe you (specifics)
- Differentiators: 3 bullets max (must be demo-able)
- CTA: what to do next

Output this as a tight table. See `references/templates.md`.

### 2) Choose a video structure (pick one)

- **Hook → Demo → CTA** (best for confident product + strong UI)
- **Problem → Solution → Demo → Proof → CTA** (best for new category)
- **Before/After** (best when you can show time saved)

For 60–75s, use this default timing:
- 0–4s hook (bold claim + visual proof)
- 4–12s problem framing (1–2 beats)
- 12–40s demo (3 feature beats)
- 40–55s proof (credibility + who it’s for)
- 55–60s CTA (single action)

### 3) Write the beat sheet (scenes + timestamps)

Write 6–10 beats. Each beat includes:
- timestamp range
- on-screen headline (max 6 words)
- what the viewer sees (UI / motion graphic)
- narration (optional)
- purpose (hook / clarify / prove / transition)

Use the templates in `references/templates.md`.

### 4) Plan the visuals (UI demo direction + motion rules)

Default visual language for dev-tool desktop apps:
- Big typography + minimal copy (1 idea per beat)
- Fast cuts, slow camera (avoid constant zooming)
- Emphasis via highlight/blur, cursor spotlight, and “pill” labels
- “Show results” over “show typing”: tests passing, PR/diff, finished output, notifications
- Keep UI readable: record at 2x/4K and downscale; avoid tiny text

Pick 3–5 recurring motion motifs (reuse them):
- Tab reveal / card stack / lane split (parallelism)
- Toast notification pop (completion)
- Timeline/progress ring (work in flight)
- “Agent bubbles” (multiple CLIs running)
- Workspace switch (sessions/tabs)

See `references/scene-library.md` for ready-to-use patterns.

### 5) Write the script (VO + captions)

Rules:
- One sentence = one visual.
- Prefer concrete nouns and verbs (“Run 6 agents in parallel”, not “increase productivity”).
- On-screen headline should not repeat VO verbatim; it should compress it.
- Avoid feature laundry lists; each feature beat must answer: “so what?”

Deliver as:
- `script.md` (VO + on-screen text)
- `storyboard.md` (beat sheet + visual notes)
- `shotlist.md` (what to record + props)

### 6) Design the “demo beats” (AI coding app specifics)

Use only 3 demo beats max in 60s; each beat must be instantly legible:
- **Parallel work**: start N agents; show a clean “work lanes” view
- **Session control**: jump between sessions/workspaces via tabs
- **Done signal**: notification toast + result summary; click to open output

If product supports multiple agents/CLIs, show: “Pick agent → run → track → collect output”.

### 7) Add polish (sound + pacing + QA)

- Sound design: 3–6 whooshes/clicks max; UI toasts get a distinct “done” sound.
- Music: steady, minimal; never compete with VO.
- Captions: always; large; 2 lines max.
- QA checklist: `references/checklist.md`.

## Output format (default)

Produce four artifacts in Markdown:
- `message-map.md` (audience/pain/promise/proof/differentiators/cta)
- `beat-sheet.md` (timestamps + on-screen + visuals + narration)
- `script.md` (VO + captions + lower thirds)
- `shotlist.md` (screen recordings + motion gfx assets)

If user asks for Claxedo specifically, also include a tailored example (see `references/claxedo-example.md`).

## References

- `references/templates.md` (copy/paste templates)
- `references/scene-library.md` (animation + editing patterns)
- `references/checklist.md` (export + QA)
- `references/claxedo-example.md` (example scripts for Claxedo)
