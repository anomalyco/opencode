---
name: ce-demo-reel
description: "Capture a visual demo reel (GIF, terminal recording, screenshots) for PR descriptions. Use when shipping UI changes, CLI features, or any work with observable behavior that benefits from visual proof. Also use when asked to add a demo, record a GIF, screenshot a feature, show what changed visually, create a demo reel, capture evidence, add proof to a PR, or create a before/after comparison."
argument-hint: "[what to capture, e.g. 'the new settings page' or 'CLI output of the migrate command']"
---

# Demo Reel

Detect project type, recommend a capture tier, record visual evidence, upload to a public URL, and return markdown for PR inclusion.

**Evidence means USING THE PRODUCT, not running tests.** "I ran npm test" is test evidence. Evidence capture is running the actual CLI command, opening the web app, making the API call, or triggering the feature. The distinction is absolute -- test output is never labeled "Demo" or "Screenshots."

If real product usage is impractical (requires API keys, cloud deploy, paid services, bot tokens), say so explicitly: "Real evidence would require [X]. Recommending [fallback approach] instead." Do not silently skip to "no evidence needed" or substitute test output.

Never generate fake or placeholder image/GIF URLs. If upload fails, report the failure.

## Never Record Secrets

Recordings must never contain credentials — not in commands, output, URL bars, or on-screen UI. If the demo needs a credential, set it before the recording starts, outside the recorded region.

**Core principle:** secrets should affect the environment, not the visible transcript. Hidden *real* setup beats visible *fake* setup — fake setup breaks the demo and still leaks the secret's shape.

- **Plan it out of frame.** Route every surface where a secret could appear (env exports, CLI flag values, command output, auth headers, URL params, DevTools, config pages) out of the recorded region. Use VHS `Hide`/`Show`; invoke CLIs via env vars, not secret flag values; stay on user-facing pages. Show the authenticated result, not the auth step.
- **Do not substitute placeholders inside the recording.** Typing a fake `sk-xxxxx` produces a misleading artifact; recapture with the real credential set out of frame instead. Two specific failures:
  - Re-exporting a fake value visibly (`export API_KEY=REDACTED`) overwrites the real env var, so the demo breaks (401, `Unauthorized`, `0 credits remaining`, empty output). You leak the variable name *and* ship a broken product.
  - Planning to blur or crop later. Assume anything shown is leaked; recapture is the only remediation.
- **Scan before upload.** Look for `sk-`, `ghp_`, `ghs_`, `xoxb-`, `Bearer `, `Authorization:`, `?token=`, `api_key=`, long hex/base64 near credential-sounding labels, or visible `.env` contents. If any appear, discard and recapture. Never blur or crop.

## Arguments

Parse `$ARGUMENTS`:
- **What to capture**: A description of the feature or behavior to demonstrate. If provided, use it to guide which pages to visit, commands to run, or states to capture.
- If blank, infer what to capture from recoverable branch or PR context. If the target remains ambiguous after that, ask the user what they want to demonstrate before proceeding.

## Step 0: Discover Capture Target

Treat target discovery as stateless and branch-aware. The agent may be invoked in a fresh session after the work was already done, so do not rely on conversation history or assume the caller knows the right artifact.

If invoked by another skill, treat the caller-provided target as a hint, not proof. Rerun target discovery and validation before capturing anything.

Use the lightest available context to identify the best evidence target:

- Current branch name
- Open PR title and description, if one exists
- Changed files and diff against the base branch
- Recent commits
- A plan file only when it is obviously referenced by the branch, PR, arguments, or caller context

Form a capture hypothesis: "The best evidence appears to be [behavior]."

Proceed without asking only when there is exactly one high-confidence observable behavior and a plausible way to exercise it from the workspace. Ask the user what to demonstrate when multiple behaviors are plausible, the diff does not reveal how to exercise the behavior, or the requested target cannot be mapped to a product surface.

Skip evidence with a clear reason when the diff is docs-only, markdown-only, config-only, CI-only, test-only, or a pure internal refactor with no observable output change.

## Step 1: Exercise the Feature

Before capturing anything, verify the feature works by actually using it:

- **CLI tool**: Run the new/changed command and confirm the output is correct
- **Web app**: Navigate to the new/changed page and confirm it renders correctly
- **Library**: Run example code using the new/changed API
- **Bug fix**: Reproduce the original bug scenario and confirm it's fixed

Use the workspace where the feature was built. Do not reinstall from scratch. If setup requires credentials or services, use the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to asking in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question.

## Step 2: Detect Project Type

Use the capture target from Step 0 to decide which directory to classify. If the diff touches a specific subdirectory with its own package manifest (e.g., `packages/cli/`, `apps/web/`), pass that as the root. Otherwise use the repo root.

```bash
python3 scripts/capture-demo.py detect --repo-root [TARGET_DIR]
```

This outputs JSON with `type` and `reason`. The result is a signal, not a gate. If the agent's understanding from Step 0 contradicts the script's classification (e.g., the diff clearly changes CLI behavior but the repo root classifies as `web-app` because of a sibling Next.js app), the agent's judgment wins.

## Step 3: Assess Change Type

Step 0 already handled the "no observable behavior" early exit. This step classifies changes that DO have observable behavior into `motion` or `states` to guide tier selection.

If arguments describe what to capture, classify based on the description. Otherwise, use the diff context from Step 0.

**Change classification:**

1. **Involves motion or interaction?** (animations, typing flows, drag-and-drop, real-time updates, continuous CLI output) -> classify as `motion`.
2. **Involves discrete states?** (before/after UI, new page, command with output, API response) -> classify as `states`.

| Change characteristic | Classification |
|---|---|
| Animations, typing, drag-and-drop, streaming output | `motion` |
| New UI, before/after, command output, API responses | `states` |

**Feature vs bug fix -- what to demonstrate:**

- **New feature (`feat`)**: Demonstrate the feature working. Show the hero moment -- the feature doing its thing.
- **Bug fix (`fix`)**: Show before AND after. Reproduce the original broken state (if possible) then show the fix. If the broken state can't be reproduced (already fixed in the workspace), capture the fixed state and describe what was broken.

Infer feat vs fix from commit messages, branch name, or plan file frontmatter (`type: feat` or `type: fix`). If unclear, ask.

## Step 4: Tool Preflight

Run the preflight check:

```bash
python3 scripts/capture-demo.py preflight
```

This outputs JSON with boolean availability for each tool: `agent_browser`, `vhs`, `silicon`, `ffmpeg`, `ffprobe`. Print a human-readable summary for the user based on the result, noting install commands for missing tools (e.g., `brew install charmbracelet/tap/vhs` for vhs, `brew install silicon` for silicon, `brew install ffmpeg` for ffmpeg).

## Step 5: Create Run Directory

Create a per-run scratch directory in the OS temp location:

```bash
mktemp -d -t demo-reel-XXXXXX
```

Use the output as `RUN_DIR`. Pass this concrete run directory to every tier reference. Evidence artifacts are ephemeral — they get uploaded to a public URL and then discarded. The OS temp directory is the right place for them, not the repo tree.

## Step 6: Recommend Tier and Ask User

Run the recommendation script with the project type from Step 2, change classification from Step 3, and preflight JSON from Step 4:

```bash
python3 scripts/capture-demo.py recommend --project-type [TYPE] --change-type [motion|states] --tools '[PREFLIGHT_JSON]'
```

This outputs JSON with `recommended` (the best tier), `available` (list of tiers whose tools are present), and `reasoning`.

Present the available tiers to the user via the platform's blocking question tool: `AskUserQuestion` in Claude Code (call `ToolSearch` with `select:AskUserQuestion` first if its schema isn't loaded), `request_user_input` in Codex, `ask_user` in Gemini, `ask_user` in Pi (requires the `pi-ask-user` extension). Fall back to numbered options in chat only when no blocking tool exists in the harness or the call errors (e.g., Codex edit modes) — not because a schema load is required. Never silently skip the question. Mark the recommended tier. Always include "No evidence needed" as a final option.

**Question:** "How should evidence be captured for this change?"

**Options** (show only tiers from the `available` list, order by recommendation):
1. **Browser reel** -- Agent-browser screenshots stitched into animated GIF. Best for web apps.
2. **Terminal recording** -- VHS terminal recording to GIF. Best for CLI tools with interaction/motion.
3. **Screenshot reel** -- Styled terminal frames stitched into animated GIF. Best for discrete CLI steps.
4. **Static screenshots** -- Individual PNGs. Fallback when other tools are unavailable.
5. **No evidence needed** -- The diff speaks for itself. Best for text-only or config changes.

If the question tool is unavailable (background agent, batch mode), present the numbered options and wait for the user's reply before proceeding.

## Step 7: Execute Selected Tier

Carry the capture hypothesis from Step 0 and the feature exercise results from Step 1 into tier execution — these determine which specific pages to visit, commands to run, or states to screenshot. Substitute `[RUN_DIR]` in the tier reference with the concrete path from Step 5.

Load the appropriate reference file for the selected tier:

- **Browser reel** -> Read `references/tier-browser-reel.md`
- **Terminal recording** -> Read `references/tier-terminal-recording.md`
- **Screenshot reel** -> Read `references/tier-screenshot-reel.md`
- **Static screenshots** -> Read `references/tier-static-screenshots.md`
- **No evidence needed** -> Skip to output. Set `evidence_url` to null, `evidence_label` to null.

**Runtime failure fallback:** If the selected tier fails during execution (tool crashes, server not accessible, recording produces empty output), fall back to the next available tier rather than failing entirely. The fallback order is: browser reel -> static screenshots, terminal recording -> screenshot reel -> static screenshots, screenshot reel -> static screenshots. Static screenshots is the terminal fallback -- if even that fails, report the failure and let the user decide.

## Step 8: Upload and Approval

After the selected tier produces an artifact, read `references/upload-and-approval.md` for upload to a public host, user approval gate, and markdown embed generation.

## Output

Return these values to the caller (e.g., ce-commit-push-pr):

```
=== Evidence Capture Complete ===
Tier: [browser-reel / terminal-recording / screenshot-reel / static / skipped]
Description: [1 sentence describing what the evidence shows]
URL: [public URL or "none" (multiple URLs comma-separated for static screenshots)]
Path: [local file path or "none" (multiple paths comma-separated for static screenshots)]
=== End Evidence ===
```

The `Description` is a 1-line summary derived from the capture hypothesis in Step 0 (e.g., "CLI detect command classifying 3 project types and recommending capture tiers"). The caller decides how to format the URL(s) into the PR description.

- `Tier: skipped` means no evidence was captured; both `URL` and `Path` are `"none"`.
- When uploaded to catbox: `URL` has the public URL, `Path` is `"none"`.
- When saved locally: `Path` has the local file path, `URL` is `"none"`.
- For all non-skipped tiers, exactly one of `URL` or `Path` contains a real value; the other is `"none"`.

**Label convention:**
- Browser reel, terminal recording, screenshot reel: label as "Demo"
- Static screenshots: label as "Screenshots"
- The caller applies the label when formatting. ce-demo-reel does not generate markdown.
- Test output is never labeled "Demo" or "Screenshots"
