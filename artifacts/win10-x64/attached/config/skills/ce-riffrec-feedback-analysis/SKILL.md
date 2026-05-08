---
name: ce-riffrec-feedback-analysis
description: Riffrec product-feedback workflow. ALWAYS load when the user posts a `riffrec-*.zip`, a bundle with `session.json` + `events.json` + `recording.webm` + `voice.webm`, a video/audio recording for product feedback, or asks how to capture and share Riffrec sessions. Routes between setup, quick bug report, and extensive analysis.
---

# Riffrec Feedback Analysis

Turn raw product feedback into structured evidence for downstream agents. This skill is the consumption side of [Riffrec](https://github.com/kieranklaassen/riffrec), a capture tool that records synchronized screen + voice + event sessions and emits a `riffrec-*.zip` bundle.

## Choose the path

Route to the matching reference based on the input. Read only that reference; do not load the others.

- **Setup** — user has no recording yet and asks how to install Riffrec, capture a session, or share feedback. Read `references/install-riffrec.md`.
- **Quick bug report** — input is a short recording (under ~60 seconds), the user describes a single specific issue, or asks for "quick", "small", or "just transcribe". Read `references/quick-bug-report.md`. Emit one concise bug report; skip the full artifact set and brainstorm handoff.
- **Extensive analysis** — input is a longer recording, contains multiple issues / requirements / workflow walkthroughs, or the user wants requirements or brainstorm material. Read `references/extensive-analysis.md`. Always continue into the `ce-brainstorm` skill.

When the input is ambiguous (e.g., a zip arrived without context), inspect the recording length and event count before choosing. If still unclear, ask the user which path applies before running anything heavy.

## Common rules

- Keep raw recordings, audio chunks, zip contents, session dumps, and extracted screenshots local-only by default. Do not commit `raw/` or `frames/` directories unless the user explicitly asks and privacy is acceptable.
- Text/metadata artifacts (requirements docs, analysis summaries, problem analyses, source manifests) may be committed when they are needed for traceability and contain no sensitive data.
- Use repo-relative screenshot paths in any committed doc so later agents can open the evidence without absolute local paths.

## Analyzer entrypoint

All non-setup paths share the same analyzer:

```bash
python scripts/analyze_riffrec_zip.py /path/to/input
```

Accepted inputs: a Riffrec `.zip`, an `.mp4` / `.mov` / `.webm` video, an `.m4a` / `.mp3` / `.wav` audio file, or a meeting-notes `.md`. Use `--output-dir <dir>` to control where artifacts land. In repos with `docs/brainstorms/`, the default is `docs/brainstorms/riffrec-feedback/`. The quick path overrides the output dir to a temp location so nothing pollutes the repo.

The Compound Engineering output format used by the extensive path is documented in `references/compound-engineering-feedback-format.md`.
