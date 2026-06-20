# RFC: Computer Use for opencode

- **Status**: Draft
- **Author**: <you>
- **Related issues**: #20490 (closed), #20917, #26772, #30755, #32945
- **Target release**: opencode 1.19 (Phase 1–3a), 1.20+ (Phase 3b–5)

## Summary

Add first-class desktop computer-use tools to opencode: an agent can
take screenshots, locate UI elements, and inject mouse/keyboard input
on the host OS. The agent loop is **see screen → decide → act →
repeat** and works against any GUI application, not just browsers.

This is the open-source equivalent of Claude Code's computer-use and
OpenAI's CUA, designed to be **provider-agnostic** while also
**passing through native provider tools when available**, and to
**run fully on-device** via UI-TARS-1.5-7B for users who want a
local, private, zero-per-action-cost path.

## Goals

- Screenshot + mouse + keyboard control of the host desktop.
- Works against any GUI application (not limited to browsers).
- Provider-agnostic core: any vision-capable model can drive it.
- **Native pass-through** for three targets:
  - Anthropic `computer_use` (Claude)
  - OpenAI `computer-use-preview`
  - UI-TARS-1.5-7B (local, Apache-2.0, beats both closed competitors
    on OSWorld: 42.5 vs 36.4 / 28.0)
- Structure-first when available (#32945 direction): accessibility
  trees preferred over pixel coordinates, with OCR fallback.
- Auditable: every action logged through the session event stream.
- Permissioned: integrates with the existing `permissions` system.
- Multi-OS: Linux (X11, Wayland, XWayland), macOS, Windows, headless/CI.
- **One-line local setup** for the UI-TARS path (`opencode
  computer-use --local`).

## Non-Goals (v1)

- **Visual element "click-to-edit" annotation in opencode Desktop**
  (Codex's actual UX). That is a separate, browser-scoped feature
  (see #30755). This RFC targets the Claude Code / CUA model:
  agent-driven, not user-annotated.
- Recording / replay of reusable GUI flows (see #32945) — designed
  compatible with that direction but not in v1.
- Mobile / embedded targets.

## User-facing behavior

1. Opt-in via `computer_use.enabled: true` in `opencode.json`
   (default off — the feature ships **disabled by default** behind
   an experimental flag; see §Architecture).
2. Top-level config block, **adjacent to `tools`** in
   `opencode.json`:

   ```jsonc
   {
     "tools": { /* ... */ },
     "computer_use": { /* ... */ }
   }
   ```

3. **Permission model: ask per batch / session, not per action.**
   On the first `computer_*` call in a session, the user is prompted
   once with the task description and the proposed
   `max_steps_per_task` budget (default 50). Approving grants
   permission for all subsequent `computer_*` calls in that session
   up to the step budget. Per-action confirmation is rejected as
   impractical UX. Three granularities:

   - `ask` (default) — prompt once at session start
   - `allow` — no prompt, every action allowed up to the step budget
   - `deny` — refuse all input tools; screenshot still allowed

4. New permission rules in `permissions`:
   - `computer_screenshot` — default `allow`
   - `computer_click`, `computer_type`, `computer_key`,
     `computer_scroll`, `computer_cursor_position` — default
     gated by the batch grant above
5. Tools exposed in the agent's tool surface (see §Tool surface).
6. **Screenshot transport: base64 PNG image part.** Native format for
   UI-TARS, Anthropic, and OpenAI vision APIs. Default
   `max_width: 1024` with aspect-preserving downscale — aggressive
   enough to fit a typical screen into ~150 KB and stay well under
   one context window for many turns. UI-TARS does not need a
   coordinate grid overlay (its grounding training handles
   coordinates natively); generic VLMs get an optional grid overlay
   (`grid_overlay: "auto"` = on for `generic`, off for `ui_tars`).
7. Each action emits a typed `computer_use.action` event on the
   session event stream containing the action, parameters, target
   window (if detectable), and the resulting screenshot hash.
8. Sub-agents in the read-only `plan` agent scope never see these
   tools (per #20483 referenced in #20490).
9. The Desktop app surfaces a single "Allow computer-use for this
   session (≤ N steps)?" prompt at session start; no per-action
   prompts.

## Architecture

```
+---------------------------------------------------------+
|                  Agent / LLM loop                        |
+----------------------------+----------------------------+
                             | tool calls
                             v
+---------------------------------------------------------+
|  Tool Registry (Core, experimental feature)             |
|  - computer_screenshot, computer_click,                  |
|    computer_type, computer_key, computer_scroll, ...     |
|  - gated by computer_use.enabled feature flag            |
+----------------------------+----------------------------+
                             |
                             v
+---------------------------------------------------------+
|  ComputerUse service (Core, src/computer-use/)          |
|  - adapter dispatch (see §Provider targeting)            |
|  - batch-permission gate (one prompt / session)          |
|  - max_steps_per_task counter & enforcement             |
|  - event stream emit (computer_use.action)              |
|  - screenshot policy (default max_width: 1024,           |
|    PNG base64, optional grid overlay)                   |
+----------------------------+----------------------------+
                             |
                             v
+---------------------------------------------------------+
|  Backend abstraction (src/computer-use/backend/)        |
|  - DisplayBackend  (screenshot)                          |
|  - InputBackend   (mouse/keyboard)                      |
|  - StructureBackend (a11y tree, OCR — Phase 5)           |
|  - ClipboardBackend                                      |
+----------------------------+----------------------------+
        |          |          |          |
        v          v          v          v
    Linux/      Linux/       macOS     Windows
     X11        Wayland
```

### Core-native (experimental) integration

This feature ships **directly in Core**, not as a plugin. Rationale:

- Permission gate, event stream, and step-budget enforcement must
  hook into Core's existing primitives (`permissions`, session event
  stream, tool registry). Plugin-first would force a parallel
  permission model.
- The agent loop benefits from Core's provider-aware tool registration
  so the four adapter paths (Anthropic / OpenAI / UI-TARS / generic)
  can dispatch per-turn without plugin IPC.
- Distribution: opencode's value prop is "works out of the box." A
  plugin would force every user to install something extra.

It ships behind a single **experimental feature flag**,
`computer_use.enabled` (default `false`), and is labelled
`experimental` in `opencode.json` schema validation and in the
release notes. OS-specific backends live in their own modules under
`packages/opencode/src/computer-use/backend/` and are imported lazily
per-OS so the bundle stays small. Third-party backends (e.g.,
proprietary VNC, Android-over-ADB) can register through a small
backend plugin interface without modifying Core.

```jsonc
// opencode.json (top level)
{
  "tools": { /* existing tools config */ },
  "computer_use": {
    "enabled": false,        // experimental — must be explicitly opted in
    // ...
  }
}
```

## Provider targeting

The `ComputerUse` service has four adapter implementations. Selection
is **per-turn**, driven by the active provider+model in the Catalog.

### 1. Anthropic native adapter

Used when the active model is a Claude variant with the `computer_use`
typed block. Adapter translates between Anthropic's tool schema and
the Core backend. Provider tool results are recorded as model-native
facts per `CONTEXT.md` "provider-executed tool results" rule.

### 2. OpenAI native adapter

Used when the active model is `computer-use-preview` (CUA). Same
pass-through pattern as Anthropic.

### 3. UI-TARS native adapter — recommended local path

Used when the active model is `ByteDance-Seed/UI-TARS-1.5-7B` (or a
finetune/quantization) served via an OpenAI-compatible local server
(vLLM, SGLang, Ollama, LM Studio).

Why this is more than a generic local VLM:

- **UI-TARS is trained for grounded GUI action** (ScreenSpot-Pro 61.6,
  vs Claude 3.7's 27.7 — see references). It emits coordinates
  directly without prompting tricks.
- **OSWorld 42.5** beats Claude 3.7 (28.0) and OpenAI CUA (36.4)
  with 100 steps.
- **Apache-2.0**, runs on a single consumer GPU at Q4 (8–16GB VRAM).
- **Reasoning-then-action**: the model produces a thought before each
  action. opencode surfaces this in the same visible-thinking block
  used for other models.

The adapter is a thin translation layer:

- Translate UI-TARS's native action vocabulary (click(x,y), type,
  scroll, key, finished, etc.) into Core tool calls.
- Constrain decoding with JSON mode for deterministic parsing.
- Forward the model's thought text into the assistant message's
  thinking field.

### 4. Generic vision adapter — fallback

Used for all other vision-capable models (Claude without the native
adapter enabled, GPT-4o, Gemini, Qwen2.5-VL, InternVL, etc.). The
tool surface is the same; the difference is that screenshots are
sent as image parts in the message and the model emits `computer_*`
tool calls via standard function calling.

### Adapter selection rules

```ts
function selectAdapter(provider: Provider, model: Model): Adapter {
  if (model.id.startsWith("ByteDance-Seed/UI-TARS")) return "ui_tars"
  if (provider === "anthropic" && model.features.includes("computer_use"))
    return "anthropic_native"
  if (provider === "openai" && model.id === "computer-use-preview")
    return "openai_native"
  if (model.modalities.includes("vision")) return "generic"
  throw new ConfigurationError(
    `Model ${model.id} has no vision capability; computer use requires it.`
  )
}
```

Users can override with `computer_use.adapter: "ui_tars" | "native"
| "generic"` in config.

## Tool surface

```ts
// Pseudo-schema; final shapes live in the Tool Registry's zod schemas.

computer_screenshot({
  region?: { x: number; y: number; w: number; h: number },
  display?: number,
  downscale?: {
    max_width?: number    // default 1024 (aggressive — see §Screenshot transport)
    max_height?: number   // default unset (aspect-preserving)
    grid?: boolean        // default: true for generic, false for ui_tars
  }
}) -> { image: base64png, width: number, height: number, scale: number }

computer_click({ x: number, y: number,
                 button?: "left"|"right"|"middle",
                 modifiers?: Key[] })
computer_double_click({ x: number, y: number, ... })
computer_type({ text: string, delay_ms?: number })
computer_key({ key: string, modifiers?: Key[] })
computer_scroll({ x: number, y: number, dx: number, dy: number })
computer_cursor_position() -> { x: number, y: number }

// Optional, v1.1 — gated by capability detection:
computer_window_list() -> Window[]
computer_window_focus({ title_contains?: string })
computer_clipboard_read() -> string
computer_clipboard_write({ text: string })
```

UI-TARS's native vocabulary maps directly to these, so the UI-TARS
adapter is a 1:1 translation. Generic VLMs emit these as standard
function calls.

## OS backend implementations (v1 scope)

| OS / env       | Screenshot                              | Mouse/Keyboard                | Clipboard                  | Notes |
|----------------|-----------------------------------------|-------------------------------|----------------------------|-------|
| Linux X11      | `scrot` / `maim`                        | `xdotool`                     | `xclip`                    | Headless: `Xvfb` |
| Linux Wayland  | `grim` (wlroots) / XDG Portal (GNOME) / `spectacle` (KDE) | `ydotool`+`ydotoold` | `wl-copy`/`wl-paste`       | Requires `/dev/uinput` write access + `input` group membership (see §Failure handling) |
| Linux XWayland | both stacks coexisting                  | route per-window              | both                       | Detect `DISPLAY`+`WAYLAND_DISPLAY` |
| macOS          | `screencapture -x`                      | `cliclick`                    | `pbcopy`/`pbpaste`         | Requires Accessibility permission |
| Windows        | PowerShell `System.Windows.Forms`       | `SendKeys`/Win32 `mouse_event`/`keybd_event` | `Get-Clipboard`/`Set-Clipboard` | **UIPI limitation**: input injection is silently blocked into windows running at a higher elevation than `opencode` (User Interface Privilege Isolation). See §Failure handling. |
| Headless / CI  | virtual display                         | virtual display               | n/a                        | `Xvfb`, `cage`, `weston --headless` |

### Per-platform notes

#### Linux Wayland — `ydotool` and `/dev/uinput`

`ydotool` does **not** speak Wayland directly; it writes synthetic
input events to the kernel through `/dev/uinput`. This requires:

- The `uinput` kernel module loaded: `sudo modprobe uinput`
- A `udev` rule granting the user's group write access to
  `/dev/uinput` (most distros ship one for the `input` group).
- The user to be a member of the `input` group:
  `sudo usermod -aG input $USER` (re-login required).
- The `ydotoold` daemon running (foreground or as a systemd user
  service): `ydotoold &` or
  `systemctl --user enable --now ydotoold`.

If any of these are missing, `ydotool` either fails with `Permission
denied` (caught and surfaced) or hangs silently (a watchdog timer
must interrupt). Both cases are mapped to actionable errors in
§Failure handling.

#### Windows — UIPI (User Interface Privilege Isolation)

Windows enforces UIPI: a process running at a lower integrity level
**cannot send input to** a window running at a higher integrity
level. Practically, if `opencode` runs **without** admin elevation,
every `computer_click` / `computer_type` targeting an "Run as
administrator" window will fail silently with no error reported to
the injecting process.

This is a hard OS-level constraint with no workaround from userspace
short of:

- Running `opencode` itself as Administrator (lowers the security
  posture of the whole session — **not recommended**, and the
  Desktop app should refuse this without an explicit override), or
- Closing the elevated target window (often impractical).

The backend **detects** the UIPI mismatch where possible (compare
the target window's integrity level against the injecting process)
and surfaces a clear error rather than failing silently. See
§Failure handling for the exact message.

#### macOS — Accessibility permission

The running process (`opencode` itself, or the Terminal that
launched it, or the Desktop app) must be granted Accessibility
access in **System Settings → Privacy & Security → Accessibility**.
Without it, `cliclick` and `CoreGraphics` calls return no error but
no input is delivered. Detected and surfaced clearly.

#### Linux X11 — DISPLAY-based, mostly unconstrained

`xdotool` requires only `DISPLAY` to be set and the user to have
access to the X server (usually automatic when running in the user's
own session). No additional group or kernel module requirements
beyond a normal desktop install.

## Structure backend (long-term direction, partial v1)

Per #32945: when the focused app exposes an accessibility tree
(UI Automation on Windows, NSAccessibility on macOS, AT-SPI on
Linux), prefer it over pixel coordinates. `computer_locate(role,
name?, ...)` returns structural selectors that survive
theme/resize changes. Falls back to OCR (Tesseract) or pixel
diffing when no a11y tree is available.

Out of scope for v1's first cut, but the backend interface is
designed to admit it without API changes.

## Permission model

Built on the existing `permissions` system. Tool-name matching:

- `computer_screenshot` — low risk, default `allow`
- `computer_click`, `computer_type`, `computer_key`,
  `computer_scroll`, `computer_cursor_position` — `DangerFullAccess`,
  default `ask`

Users can pin `allow` / `deny` per-session, per-workspace, or
globally. The Desktop app surfaces an "Allow once / Allow for
session / Deny" prompt identical to `bash`.

## Audit / event stream

Every action emits one `computer_use.action` event with:

- timestamp, session id, agent id
- tool name + parameters
- target window title + app name (when detectable)
- resulting screenshot hash (not the image itself; image stays in
  managed tool-output storage per `CONTEXT.md` "Managed Tool Output
  File")
- success / failure + error reason

The session event stream is the same one already consumed by the
desktop UI for tool-call rendering; the existing transcript UI can
surface these events without changes.

## Configuration

Top-level block, **adjacent to `tools`** in `opencode.json`:

```jsonc
// opencode.json (excerpt)
{
  "tools": { /* existing tools config */ },
  "computer_use": {
    "enabled": false,                // EXPERIMENTAL — must be explicitly opted in
    "backend": "auto",                // auto | x11 | wayland | macos | windows | headless
    "adapter": "auto",                // auto | native | ui_tars | generic
    "screenshot": {
      "max_width": 1024,              // aggressive default — saves context & bandwidth
      "max_height": null,             // null = aspect-preserving (no fixed cap)
      "grid_overlay": "auto"          // true | false | auto (true for generic, false for ui_tars)
    },
    "input": {
      "pre_action_delay_ms": 50,
      "humanize": false               // add jitter; v1.1
    },
    "permissions": "ask",             // ask | allow | deny (default for non-screenshot tools)
    "max_steps_per_task": 50,         // safety cap per session grant
    "ui_tars": {
      "endpoint": "http://localhost:8000/v1",
      "model": "ByteDance-Seed/UI-TARS-1.5-7B",
      "thinking": true,               // surface model's chain-of-thought
      "api_key": "${UI_TARS_API_KEY}" // optional; many local servers don't require one
    }
  }
}
```

## One-line local setup (`opencode computer-use --local`)

A new CLI subcommand that bootstraps the entire local UI-TARS path.
The flow is: **hardware probe → confirm → install vLLM → download
model → start server → write config snippet**.

```bash
$ opencode computer-use --local

🔍 Pre-flight hardware check...
   ✅ GPU:     NVIDIA RTX 4070 (compute capability 8.9)
   ✅ VRAM:    12 GB free (need ≥ 8 GB)
   ✅ Disk:    142 GB free at ~/.cache/huggingface (need ≥ 30 GB)
   ✅ RAM:     24 GB system, 18 GB free
   ✅ pip:     Python 3.12.4 available
   ✅ Network: huggingface.co reachable

🔍 Checking prerequisites...
   ✅ opencode 1.19.0
   ❌ vLLM not found
   ❌ UI-TARS-1.5-7B not cached

📦 Install vLLM? [Y/n] Y
   $ pip install vllm
   ✅ vLLM 0.7.2 installed

📥 Download UI-TARS-1.5-7B (~15 GB at Q4)? [Y/n] Y
   $ huggingface-cli download ByteDance-Seed/UI-TARS-1.5-7B ...
   ✅ Model cached at ~/.cache/huggingface/...

🚀 Start local server? [Y/n] Y
   $ vllm serve ByteDance-Seed/UI-TARS-1.5-7B --port 8000 &
   ✅ Server up at http://localhost:8000/v1

✏️  Wrote opencode.json snippet (top-level, adjacent to "tools"):
   {
     "tools": { /* existing */ },
     "provider": {
       "ui_tars_local": {
         "type": "openai-compatible",
         "base_url": "http://localhost:8000/v1",
         "model": "ByteDance-Seed/UI-TARS-1.5-7B"
       }
     },
     "computer_use": {
       "enabled": true,
       "adapter": "ui_tars",
       "permissions": "ask",
       "max_steps_per_task": 50,
       "screenshot": { "max_width": 1024 }
     }
   }

✅ Ready. Try: opencode "open Firefox and screenshot the homepage"

⚠️  Computer-use is an EXPERIMENTAL feature. You'll be asked once
   per session to grant up to 50 computer-use steps.

🛑 To stop the server later: opencode computer-use --stop
```

If the pre-flight check fails, the command aborts before any
download or install and prints the specific failed check with its
remediation (see §Pre-flight Hardware Check).

The command is implemented as a thin wrapper over existing tools
(`pip`, `huggingface-cli`, `vllm`) plus a config snippet writer.
It is **idempotent** (skips already-completed steps) and **safe**
(refuses to overwrite an existing config without `--force`).
`--skip-hardware-check` bypasses the pre-flight check (logged with
a warning) for users who know what they're doing.

This is the killer onboarding story:

> `brew install opencode && opencode computer-use --local`
> → fully offline GUI agent in ~5 minutes, no API keys.

## Failure handling & diagnostics

Every backend must surface *actionable* errors when the environment
isn't usable. No silent hangs.

| Failure                                  | Surfaced message (with remediation) |
|------------------------------------------|--------------------------------------|
| Wayland — `/dev/uinput` not writable     | "Cannot write to `/dev/uinput`. Run: `sudo usermod -aG input $USER` (then re-login), `sudo modprobe uinput`, and ensure a `udev` rule grants the `input` group write access. Then `sudo systemctl restart ydotoold`." |
| Wayland — user not in `input` group      | "User not in `input` group (required for `/dev/uinput`). Run: `sudo usermod -aG input $USER` and re-login." |
| Wayland — `ydotoold` daemon not running  | "ydotoold is not running. Install with your package manager, then start it: `sudo ydotoold &` (or `systemctl --user enable --now ydotoold`)." |
| Wayland — `uinput` kernel module missing | "`uinput` kernel module not loaded. Run: `sudo modprobe uinput && echo uinput \| sudo tee /etc/modules-load.d/uinput.conf`." |
| macOS — Accessibility permission missing | "opencode needs Accessibility permission. System Settings → Privacy & Security → Accessibility → enable opencode (or the launching Terminal / Desktop app)." |
| macOS — Screen Recording permission missing | "opencode needs Screen Recording permission to capture screenshots. System Settings → Privacy & Security → Screen Recording → enable opencode." |
| Headless — no virtual display detected   | "No display server detected. Run under `xvfb-run opencode ...` for X11 CI, or `cage opencode` / `weston --headless` for Wayland CI." |
| Required CLI tool missing (`grim`, `scrot`, `xdotool`, `cliclick`) | Specific install command for the user's detected package manager (apt / dnf / pacman / brew). |
| Windows — UIPI elevation mismatch        | "Target window is running as Administrator; opencode is not. Windows UIPI blocks input injection into elevated windows. Either close the elevated target, or restart opencode as Administrator (not recommended — lowers your session's security posture). Diagnostic: `whoami /groups \| findstr Mandatory`." |
| UI-TARS server unreachable               | "Cannot reach http://localhost:8000/v1. Run `opencode computer-use --local` to start it, or `opencode computer-use --status` to check." |
| UI-TARS model not loaded                 | "Server is up but model isn't loaded. Wait ~30s after `vllm serve` completes startup." |

### Pre-flight Hardware Check (`--local`)

Before installing vLLM or downloading UI-TARS-1.5-7B, the
`opencode computer-use --local` command runs a non-destructive
hardware probe and **aborts with a clear error if minimums aren't
met**. The user can override with `--skip-hardware-check` (logged
with a warning).

| Check                                          | Minimum                       | Failure message |
|------------------------------------------------|-------------------------------|------------------|
| **GPU presence & compute capability**          | NVIDIA CUDA (sm_70+, Volta+) **or** Apple Silicon (M1+) | "No compatible GPU detected. UI-TARS-7B requires either an NVIDIA GPU with CUDA compute capability ≥ 7.0 or Apple Silicon (M1 or newer). CPU-only inference is not supported in v1." |
| **VRAM available** (after subtracting other workloads) | ≥ 8 GB free (Q4) — recommend ≥ 12 GB (Q8) or ≥ 16 GB (fp16) | "Only X GB of VRAM available; UI-TARS-7B Q4 needs ≥ 8 GB. Free GPU memory or use a smaller quantization (if available)." |
| **Free disk space**                            | ≥ 30 GB (vLLM ~3 GB + model ~15 GB Q4 / ~30 GB fp16 + safetensors overhead + room for context cache) | "Only X GB free at <path>; UI-TARS-1.5-7B needs ≥ 30 GB free. Free disk space or set `HF_HOME` to a larger volume." |
| **Free RAM** (Apple Silicon unified memory)    | ≥ 16 GB system RAM with ≥ 12 GB free | "Only X GB of system RAM free; Apple Silicon inference needs ≥ 16 GB system RAM with ≥ 12 GB free. Close other apps or use a smaller model." |
| **`pip` available** (Linux/Windows)            | Python ≥ 3.10 + pip            | "Python 3.10+ with pip is required to install vLLM. Install Python from python.org or via your package manager." |
| **Network reachability**                       | `huggingface.co` reachable     | "Cannot reach huggingface.co to download the model. Check your network connection, proxy settings, or set `HF_ENDPOINT` to a mirror." |

The probe runs in `--status` too, so users can sanity-check their
machine without starting the server:

```bash
$ opencode computer-use --status
GPU:    NVIDIA RTX 4070, 12 GB VRAM available (compute capability 8.9) ✅
Disk:   142 GB free at /home/user ✅
RAM:    24 GB system, 18 GB free ✅
Server: not running
Model:  ByteDance-Seed/UI-TARS-1.5-7B not cached
```

## Phased delivery

- **Phase 0 — RFC + issue triage** (this document).
  - Comment on #32945, link #20490 / #20917 / #26772 / #30755.
  - Get sign-off on tool surface and permission model.

- **Phase 1 — Core tool skeleton + Linux X11 backend** (opencode 1.19).
  - Tool registry entries (`computer_*`).
  - Permission integration.
  - Event stream emit.
  - `xdotool` / `scrot` / `xclip` backend.
  - Generic vision adapter end-to-end working.
  - User-visible: opt-in via config; works with any vision-capable
    cloud model.

- **Phase 2 — macOS + Windows + Wayland backends** (opencode 1.19).
  - Each with the specific permission/error UX from the table above.
  - Backend auto-detection hardened across distros.

- **Phase 3a — UI-TARS native adapter + `--local` setup** (opencode 1.19).
  - Highest-leverage integration: Apache-2.0, runs locally, beats
    closed competitors on OSWorld.
  - References: [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop)
    for Electron UX patterns,
    [UI-TARS SDK](https://github.com/bytedance/UI-TARS) for action
    vocabulary mapping.
  - Ship `opencode computer-use --local` and `--status` subcommands.

- **Phase 3b — Closed provider native adapters** (opencode 1.20).
  - Anthropic `computer_use` block autodetect + pass-through.
  - OpenAI `computer-use-preview` autodetect + pass-through.

- **Phase 3c — Generic vision adapter polish** (opencode 1.20).
  - CoT prompting helpers for non-UI-TARS VLMs.
  - Coordinate grid overlay defaults.

- **Phase 4 — Headless / CI path** (opencode 1.20).
  - `xvfb-run opencode ...` integration documented.
  - `cage` / `weston --headless` for Wayland CI.
  - GitHub Actions recipe in `packages/opencode/.github/`.

- **Phase 5 — Structure backend** (opencode 1.21+).
  - AT-SPI / NSAccessibility / UI Automation.
  - `computer_locate(role, name?, ...)` tool.
  - Composes with #32945's "reusable flows" direction.

## Open questions for maintainers

### Resolved in this revision

| # | Question | Decision |
|---|----------|----------|
| 1 | Core vs plugin-first | **Core-native, experimental.** Ships behind `computer_use.enabled: false` feature flag, labelled `experimental` in schema validation and release notes. |
| 2 | Permission granularity | **Ask per batch / session** with `max_steps_per_task` budget (default 50). One prompt at session start, no per-action prompts. |
| 3 | Screenshot transport | **Base64 PNG image part**, aggressive default `max_width: 1024` (aspect-preserving). Native format for UI-TARS / Anthropic / OpenAI. |
| 4 | Native closed-provider adapters | **In Core** for v1 (one install, simpler UX). Open to extracting later if it bloats the Core provider surface. |
| 5 | Config block location | **Top-level `computer_use` adjacent to `tools`** in `opencode.json`. |
| 6 | `--local` setup command | **Ship as first-class subcommand** (`--local`, `--status`, `--stop`). The onboarding story is the differentiator vs Claude Code / Cursor. |

### Still open

7. **Quantized UI-TARS defaults.** Default to Q4 (~8GB VRAM) or
   fp16 (~16GB)? Default to a smaller variant like the Qwen2-VL-2B
   derivative if available?
8. **When to graduate out of experimental.** Ship as experimental for
   1.19 and 1.20, then promote to stable in 1.21 once we have:
   - Headless CI green for ≥ 2 weeks
   - At least 3 external users reporting successful real-world runs
   - All OS backend failure paths (incl. UIPI / `/dev/uinput`) covered
     by tests
9. **`grid_overlay` default for generic adapter.** Coordinate grid
   helps non-UI-TARS VLMs localize. Trade-off: extra annotation
   tokens. Default `true` for `generic` adapter seems right but
   needs benchmark confirmation.
10. **Step-budget UX after a denial.** When the user denies a
    session grant, can the agent retry with a narrower request
    (e.g., "only `computer_screenshot`, no input"), or is that a
    per-session state? Proposal: a denied session can be re-prompted
    with a narrower scope.

## References

### opencode issues

- #20490 — original detailed spec (closed without merged impl)
- #20917 — claude-code plugin compat request
- #26772 — integrated browser (separate scope, browser only)
- #30755 — Codex click-to-edit (separate scope, browser only)
- #32945 — accessibility-tree + reusable flows (compatible direction)

### UI-TARS

- UI-TARS-1.5-7B model card —
  https://huggingface.co/ByteDance-Seed/UI-TARS-1.5-7B
- UI-TARS paper (Qin et al., 2025) — https://arxiv.org/abs/2501.12326
- UI-TARS-1.5 blog — https://seed-tars.com/1.5/
- UI-TARS-desktop (Electron reference impl) —
  https://github.com/bytedance/UI-TARS-desktop
- UI-TARS SDK — https://github.com/bytedance/UI-TARS
- ScreenSpot-Pro grounding benchmark — https://arxiv.org/abs/2504.07981
- OSWorld benchmark — https://arxiv.org/abs/2404.07972
- Windows Agent Arena — https://arxiv.org/abs/2409.08264
- WebVoyager — https://arxiv.org/abs/2401.13919
- Online-Mind2Web — https://arxiv.org/abs/2504.01382

### Closed-provider equivalents

- Claude Code computer use docs (Anthropic)
- OpenAI `computer-use-preview` schema
- AT-SPI / NSAccessibility / UI Automation references for Phase 5

### opencode internals

- `CONTEXT.md` — session runtime semantics; in particular the
  "Managed Tool Output File" and "provider-executed tool results"
  rules that govern how screenshots and provider-native tool calls
  land in session history.
- `AGENTS.md` — contributor style guide; Phase 1 PRs must follow
  it.
- `specs/v2/` — V2 session architecture; computer-use event emission
  hooks into the V2 event stream.