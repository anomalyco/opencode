# Proof of /oc Command\n\n## Issue Flow (audio-troubleshooting-lab#4)\n\n### Bot Response\n`\nModel not found: google/gemini-2.0-flash. Did you mean: gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite?

[github run](/zzz-creator/audio-troubleshooting-lab/actions/runs/40239302532)\n`\n\n### Bot Response\n`\nAPIError: This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements. We recommend you to use the Interactions API (https://ai.google.dev/gemini-api/docs/get-started).

[github run](/zzz-creator/audio-troubleshooting-lab/actions/runs/40239406787)\n`\n\n### Bot Response\n`\n### Audio Troubleshooting Lab

An interactive browser-based mixing console training and troubleshooting simulator for Audio University.

#### Key Highlights
- **Tech Stack & Architecture:** Zero-build single-page app (React + Babel via CDN, deployed on GitHub Pages). Audio is procedurally synthesized from state using the Web Audio API rather than relying on external audio files.
- **Core Files:**
  - `index.html`: Single-page app engine, mixing console UI, Web Audio synthesis, and member unlock handling.
  - `content.js`: Scenario catalog containing definitions, fault pools, lessons (`START_HERE`, `LEVELS`, `PRACTICE`), and the authoritative `GLOSSARY`.
  - `js/unlock.js`: Client-side signed-cookie member access and unlock module.
  - `scripts/`: Verification and release toolchain (`promote.js`, `check_syntax.js`, `check_tier_prompt.js`, `check_lesson3_regression.js`, `lint_copy.py`).
- **Tier Model:** Free Essentials arc (acts as an educational lead magnet) alongside a Member tier that unlocks extended challenges, Practice Mode, Run the Show, and a feedback ring-out trainer via query-parameter gating (`?tier=member`, `?optedin=1`).

[github run](/zzz-creator/audio-troubleshooting-lab/actions/runs/40239497340)\n`\n\n## PR Flow (audio-troubleshooting-lab#5)\n\n### Bot Response\n`\n### PR Summary

- **Type:** Test / Verification
- **Changes:**
  - Added `test-file.txt` containing a single line (`test content`).
- **Impact:** None on project functionality; created to test the `/oc` GitHub Action workflow on pull requests.

[github run](/zzz-creator/audio-troubleshooting-lab/actions/runs/40239927418)\n`\n\n
