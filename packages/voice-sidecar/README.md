# opencode voice sidecar

Python sidecar for opencode's voice experience. See the design docs:
[`prd-voice-commands.md`](../../docs/prd-voice-commands.md) ·
[`voice-architecture.md`](../../docs/voice-architecture.md) ·
[`voice-roadmap.md`](../../docs/voice-roadmap.md).

## Setup

Requires Python 3.10+. Using [uv](https://docs.astral.sh/uv/) (recommended):

```sh
cd packages/voice-sidecar
uv venv
uv pip install -e .
```

Or with stdlib venv + pip:

```sh
cd packages/voice-sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

> macOS: the first mic use will prompt for microphone permission for your
> terminal. If `sounddevice` fails to load PortAudio, run `brew install portaudio`.

### Configure

```sh
export XAI_API_KEY="xai-…"   # real key from https://console.x.ai — not a placeholder
# optional STT overrides:
# export XAI_BASE_URL="https://api.x.ai/v1"
# export VOICE_STT_LANGUAGE="en"

# Phase 1 — opencode server (auto-discovered if omitted):
# export OPENCODE_SERVER_URL="http://127.0.0.1:4096"
# export OPENCODE_DIRECTORY="/path/to/your/repo"   # required for headless ask/converse
# export OPENCODE_AGENT="build"
# export OPENCODE_MODEL_PROVIDER="opencode"        # or xai
# export OPENCODE_MODEL_ID="big-pickle"            # or grok-build-0.1
# export OPENCODE_SERVER_PASSWORD="…"
```

The sidecar discovers a locally running opencode server from
`~/.local/state/opencode/server.json` and `password`, the same files the CLI
writes when you run `opencode serve` or open the app.

---

## Phase 0 — local STT binary

**Live (streaming) transcription** from the microphone, plus a batch file mode for
debugging. STT providers sit behind swappable interfaces — streaming in
`voice_sidecar/stream.py`, batch in `voice_sidecar/stt.py`; xAI is the first provider.

`listen` streams mic audio to xAI's WebSocket STT (`wss://api.x.ai/v1/stt`) and shows
results as they arrive:

- **interim** partials (`·`) update live as you speak,
- **chunk-final** locked text (`▸`) once a span settles,
- a **final utterance** is committed to **stdout** when you stop speaking
  (`speech_final` — this is the unit later phases hand to the decider).

```sh
# Live transcription. Speak; interim text updates in place; each finished
# utterance is printed as a line. Ctrl-C to stop.
voice-stt listen

# Stop automatically after the first complete utterance.
voice-stt listen --once

# Transcribe an existing wav file in one shot (batch; no mic needed).
voice-stt transcribe /tmp/clip.wav

# List input devices, then target one.
voice-stt devices
voice-stt listen --device 1
```

Final utterances are printed to **stdout**; live/interim text and status go to
**stderr**, so you can capture just the committed transcript:

```sh
voice-stt listen 2>/dev/null
```

Mic options: `--language` (e.g. `en`), `--sample-rate` (default 16000), `--device`.

### Dev runner (opencode + sidecar together)

`run-voice-dev.sh` starts opencode from source and the voice sidecar, logging
everything to `.voice-dev/voice-dev.log` for debugging and agent inspection.

```sh
cd packages/voice-sidecar
export XAI_API_KEY="xai-…"   # from https://console.x.ai

./run-voice-dev.sh start      # opencode serve + voice-stt converse
./run-voice-dev.sh status
./run-voice-dev.sh logs       # last 80 lines
./run-voice-dev.sh logs 200
./run-voice-dev.sh logs-path  # print log file path
./run-voice-dev.sh restart
./run-voice-dev.sh stop
```

Env overrides: `OPENCODE_PORT` (default 4096), `OPENCODE_WORKSPACE` (default repo
root), `VOICE_MODE=ask` for a one-shot text test instead of `converse`.

Requires `bun install` at repo root and a sidecar venv (`pip install -e .`).

---

## Phase 1 — voice drives opencode (control plane)

A spoken (or typed) command runs in an opencode session via the server's HTTP API.
The sidecar is a headless client: create or reuse a session → submit a prompt →
wait for idle → print the assistant's reply.

You need **two terminals**: one for opencode (the server + agent), one for the
voice sidecar (Python).

### 1. Start opencode (terminal 1)

From the **project directory you want opencode to work on** (the repo root, or any
folder with code):

```sh
cd /path/to/your/project

# from a dev checkout of this repo:
cd packages/opencode
bun run --conditions=browser ./src/index.ts serve --port 4096
```

Or, if you have `opencode` installed globally:

```sh
cd /path/to/your/project
opencode serve --port 4096
```

You should see: `opencode server listening on http://127.0.0.1:4096`

The server uses its **current working directory** as the workspace unless a client
sends `x-opencode-directory`, so start it from the repo you want to ask about.

**Auth (optional):** if `OPENCODE_SERVER_PASSWORD` is set, the server requires HTTP
Basic auth. The sidecar reads the password from `~/.local/state/opencode/password`
(written when the TUI/app starts a daemon) or from `OPENCODE_SERVER_PASSWORD`.
For local `serve` without a password, leave it unset — the sidecar connects with
no auth.

**Providers:** opencode still needs its usual model/provider config (API keys in
`opencode.json` or env) so the agent can answer. Voice only replaces how you *send*
the prompt.

**Alternative — TUI instead of bare `serve`:** running the interactive TUI also
starts a server and writes `server.json` + `password` for auto-discovery:

```sh
cd packages/opencode
bun dev
```

The sidecar can then auto-discover URL and password from
`~/.local/state/opencode/`.

### 2. Run the voice sidecar (terminal 2)

Install once (see [Setup](#setup) above), then:

```sh
cd packages/voice-sidecar
export XAI_API_KEY="xai-…"   # from https://console.x.ai

# Text smoke test — no mic
voice-stt ask "list the files in src"

# Voice loop — speak, wait for reply, repeat (Ctrl-C to quit)
export OPENCODE_DIRECTORY="/path/to/your/repo"
export OPENCODE_AGENT="build"
export OPENCODE_MODEL_PROVIDER="opencode"
export OPENCODE_MODEL_ID="big-pickle"
export XAI_API_KEY="xai-…"   # from https://console.x.ai
voice-stt converse --server http://127.0.0.1:4096

# Single utterance smoke test (no loop)
voice-stt converse --once --server http://127.0.0.1:4096
```

If you used bare `serve` on port 4096 (no `server.json`), pass the URL explicitly:

```sh
voice-stt ask --server http://127.0.0.1:4096 "list the files in src"
```

Reply text goes to **stdout**; session id and progress go to **stderr**.

### Session options

```sh
# Reuse an existing session
voice-stt ask --session ses_abc123 "what changed?"

# Pick an agent when creating a new session
voice-stt converse --agent build

# Point at a specific server
voice-stt ask --server http://127.0.0.1:4096 "run the tests"
```

Shared flags: `--server`, `--session`, `--agent`. `converse` also accepts the
mic flags from Phase 0.

**Done when:** *"list the files in src"* → opencode runs it → you see the result.
**Not yet:** talk-back (TTS), continuous listening, mid-turn decider, sidecar HTTP API for web.

---

## Phase 2 — voice HTTP service (in progress)

Expose the sidecar as a network service for the web app and test clients.

```sh
# terminal 3 (opencode on 4096, env vars set as in Phase 1)
voice-stt serve --port 8765

curl -s http://127.0.0.1:8765/health | python3 -m json.tool
curl -s http://127.0.0.1:8765/voice/config | python3 -m json.tool

# Create a voice session (binds to opencode; creates session if omitted)
curl -s -X POST http://127.0.0.1:8765/voice/session \
  -H 'Content-Type: application/json' \
  -d '{"directory":"/Users/nivedita/git/opencode","agent":"build"}' \
  | python3 -m json.tool
```

Response includes `id`, `stream` (WSS URL for the next step), and `opencode.sessionID`.

### Stream + TTS test page

With `voice-stt serve` running:

1. Open **http://127.0.0.1:8765/voice/test** in Chrome
2. Click **Start session** (confirm workspace path)
3. Click **Enable mic**, speak a command, wait for reply + audio playback
4. Repeat for another turn (mic can stay on)

Events on the WSS: `status`, `transcript`, `reply`, `tts` (base64 MP3), `error`.

**Done when:** browser test page hears a spoken reply after a voice command.
**Next:** wire `@opencode-ai/app` composer (Phase 3).

### Web app (Phase 3)

Three terminals for local dev:

1. `bun dev serve` — opencode (note the port, e.g. 55521)
2. `voice-stt serve --port 8765` — sidecar (with `XAI_API_KEY`, `OPENCODE_DIRECTORY`)
3. `bun run --cwd packages/app dev` — web UI

If opencode is not on 4096, set in terminal 2:

```sh
export OPENCODE_SERVER_URL="http://127.0.0.1:55521"
```

Optional in `packages/app/.env.local`:

```sh
VITE_VOICE_SIDECAR_URL=http://127.0.0.1:8765
VITE_OPENCODE_SERVER_PORT=55521
```

In the web composer, open a session, click the mic, speak a command, hear the reply.

See [`voice-roadmap.md`](../../docs/voice-roadmap.md) — LiveKit is Phase 7+, after hosted web launch.
