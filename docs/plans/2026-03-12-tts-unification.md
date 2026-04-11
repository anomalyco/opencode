# TTS Unification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the two disconnected TTS systems (browser Web Speech API + backend Edge TTS) into one: server-side Edge TTS with streaming audio to the browser.

**Architecture:** Server synthesizes audio via `msedge-tts` (which handles the Edge TTS WebSocket protocol), streams MP3 directly into the HTTP response using the established `new Response(readableStream)` pattern from `provider.ts`. Browser fetches the stream, creates a blob URL, plays via `HTMLAudioElement`. Control bar preferences persisted in localStorage via the existing `Persist.global()` + `persisted()` pattern.

**Tech Stack:** msedge-tts (replaces node-edge-tts), Hono routes, Bun, SolidJS, HTMLAudioElement, @solid-primitives/storage

**Context:** We are editing commit `qsloyxzw` (feat/tts) directly. Descendants (voice-integration merge, voice-mode, etc.) will auto-rebase. The voice-mode component (`voice-mode.tsx`, on the `feat/voice-mode` branch) depends on the TTS API surface: `isSpeaking()`, `stop()`, `isEnabled()`, `tts_finished` detection. That API surface must be preserved.

---

## Task 1: Switch to msedge-tts and add streaming synthesis

**Files:**

- Modify: `packages/opencode/package.json` (swap `node-edge-tts` → `msedge-tts`)
- Rewrite: `packages/opencode/src/tts/index.ts`

**Why:** `node-edge-tts` only has `ttsPromise(text, filePath)` — writes to a file, no streaming. The `msedge-tts` library (v2.0.4, actively maintained, 5K weekly downloads) has a first-class `toStream()` method that returns a Node `Readable` of audio chunks. It also has the Dec 2025 `Sec-MS-GEC` auth fix. `Readable.toWeb()` converts to Web `ReadableStream` — matching the `new Response(body)` pattern already used in `provider.ts`.

**Step 1: Swap the dependency**

In `packages/opencode/package.json`, replace `"node-edge-tts"` with `"msedge-tts"`. Then run `bun install` from the repo root.

**Step 2: Rewrite `packages/opencode/src/tts/index.ts`**

Replace the `EdgeTTS` import and all synthesis code. Key changes:

- Replace `import { EdgeTTS } from "node-edge-tts"` with `import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"`
- Remove the `playAudio()` function, `currentProcess`, and file-based `processQueue()` — these were for CLI playback only
- Keep: `VOICES` list, `getVoices()`, `getDefaultVoice()`, `ConfigSchema`, `Event` definitions, `cleanTextForSpeech()`
- Keep: `enabled` state, `toggle()`, `enable()`, `disable()`, `isEnabled()` — the bus events for enabled state are used elsewhere
- Add `synthesize()` that returns a `ReadableStream<Uint8Array>`:

```ts
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"
import { Readable } from "stream"

export async function synthesize(input: {
  text: string
  voice?: string
  rate?: string
  volume?: string
  pitch?: string
}): Promise<ReadableStream<Uint8Array>> {
  const config = await Config.get()
  const cfg = config.tts

  const tts = new MsEdgeTTS()
  await tts.setMetadata(input.voice ?? cfg?.voice ?? "en-US-AriaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)

  const cleaned = cleanTextForSpeech(input.text)
  const { audioStream } = tts.toStream(cleaned, {
    rate: input.rate ?? cfg?.rate ?? "default",
    volume: input.volume ?? cfg?.volume ?? "default",
    pitch: input.pitch ?? cfg?.pitch ?? "default",
  })

  return Readable.toWeb(audioStream) as ReadableStream<Uint8Array>
}
```

Notes on the `msedge-tts` API:

- `new MsEdgeTTS()` — constructor takes no required args
- `setMetadata(voice, format)` — async, opens the WebSocket connection. Must be called before `toStream()`
- `toStream(text, prosodyOpts)` — synchronous, returns `{ audioStream: Readable }`. Audio data flows as the WebSocket receives chunks.
- `OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3` — higher quality than `node-edge-tts` default (96kbps vs 48kbps)
- Rate/pitch/volume go in the second arg to `toStream()`, not the constructor

Also add a `speak()` wrapper for the backend bus events (used by event listeners):

```ts
export async function speak(input: { text: string; sessionID: string; messageID: string; partID: string }) {
  if (!enabled) return

  const cleaned = cleanTextForSpeech(input.text)
  if (!cleaned.trim()) return

  try {
    Bus.publish(Event.SpeakStart, {
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
    })

    // For backend consumers (CLI), synthesize to a temp file and play
    const config = await Config.get()
    const cfg = config.tts

    const tts = new MsEdgeTTS()
    await tts.setMetadata(cfg?.voice ?? "en-US-AriaNeural", OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)

    const tempDir = path.join(Global.Path.data, "tts")
    await fs.mkdir(tempDir, { recursive: true })
    const tempFile = path.join(tempDir, `${input.partID}.mp3`)

    const { audioFilePath } = await tts.toFile(tempDir, cleaned, {
      rate: cfg?.rate ?? "default",
      volume: cfg?.volume ?? "default",
      pitch: cfg?.pitch ?? "default",
    })

    await playAudio(audioFilePath)
    await fs.unlink(audioFilePath).catch(() => {})

    Bus.publish(Event.SpeakEnd, {
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
    })
  } catch (error) {
    log.error("speak failed", { error })
    Bus.publish(Event.SpeakError, {
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
```

Wait — on second thought, the CLI `speak()` path with `playAudio()` is dead code in the web context. Check whether anything actually calls `TTS.speak()` on the backend. If nothing does (the frontend context was the only caller and it used the browser API), delete `speak()` and `playAudio()` entirely. Keep only `synthesize()` for the web route. If something does call it, keep `speak()` with the `toFile()` + `playAudio()` approach above.

**Step 3: Update the config schema**

The `ConfigSchema` voice enum references specific voice names. `msedge-tts` supports the same voices — they're Microsoft Edge neural voices either way. The schema can stay as-is. Verify the format enum values match by checking `OUTPUT_FORMAT` exports from `msedge-tts`.

**Step 4: Verify it compiles**

Run: `bun typecheck` from `packages/opencode`

**Step 5: Describe and advance**

```
jj describe -m "feat(tts): switch to msedge-tts for streaming synthesis"
jj new
```

---

## Task 2: Add server TTS routes

**Files:**

- Create: `packages/opencode/src/server/routes/tts.ts`
- Modify: `packages/opencode/src/server/server.ts` (add route mount)

**Why:** The browser needs HTTP endpoints to request audio synthesis and discover available voices.

**Step 1: Create the route file**

Follow the existing route pattern (see `routes/voice.ts` for reference — Hono + `lazy()` + `describeRoute` + `zValidator`). Two routes:

```ts
// packages/opencode/src/server/routes/tts.ts
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { zValidator } from "@hono/zod-validator"
import z from "zod"
import { TTS } from "@/tts"
import { lazy } from "@/util/lazy"

export const TTSRoutes = lazy(() =>
  new Hono()
    .post(
      "/speak",
      describeRoute({
        summary: "Synthesize speech",
        description: "Convert text to speech audio using Edge TTS",
        operationId: "tts.speak",
        responses: {
          200: {
            description: "MP3 audio stream",
            content: { "audio/mpeg": {} },
          },
        },
      }),
      zValidator(
        "json",
        z.object({
          text: z.string(),
          voice: z.string().optional(),
          rate: z.string().optional(),
          volume: z.string().optional(),
          pitch: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json")
        const stream = await TTS.synthesize(input)
        return new Response(stream, {
          headers: { "content-type": "audio/mpeg" },
        })
      },
    )
    .get(
      "/voices",
      describeRoute({
        summary: "List TTS voices",
        operationId: "tts.voices",
        responses: {
          200: {
            description: "Available voices",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(TTS.getVoices())
      },
    ),
)
```

The `POST /tts/speak` handler calls `TTS.synthesize()` which returns a `ReadableStream<Uint8Array>`, then wraps it in `new Response(stream, { headers })`. This is the same pattern as `provider.ts` line 102: `new Response(body, { headers: new Headers(res.headers), status: res.status })`.

**Step 2: Mount in server.ts**

Add import and route mount alongside the other routes:

```ts
import { TTSRoutes } from "./routes/tts"
```

Add `.route("/tts", TTSRoutes())` near the other `.route(...)` calls (around line 253, near `/mcp` and `/tui`).

**Step 3: Verify it compiles**

Run: `bun typecheck` from `packages/opencode`

**Step 4: Describe and advance**

```
jj describe -m "feat(tts): add /tts/speak and /tts/voices server routes"
jj new
```

---

## Task 3: Rewrite frontend TTS utility

**Files:**

- Rewrite: `packages/app/src/utils/tts.ts`
- Modify: `packages/app/src/context/tts.tsx`

**Why:** Replace the broken Web Speech API implementation with server-backed Edge TTS + HTMLAudioElement playback. Must preserve the API surface that voice-mode depends on.

**API surface to preserve** (voice-mode uses these):

- `isSupported()` → always `true` now (server-side TTS has no browser requirement)
- `isEnabled()` → local toggle
- `isSpeaking()` → true while audio element is playing
- `isPaused()` → true while audio element is paused
- `speak(text)` → POST to server, play response
- `stop()` → pause audio, clear queue, revoke blob URLs
- `togglePause()` → audio.pause() / audio.play()
- `replay()` → replay last audio blob
- `canReplay()` → has last audio blob
- `voices()` → fetched from server on init
- `selectedVoice()` / `setVoice()` → localStorage-persisted
- `rate()` / `setRate()` → localStorage-persisted
- `enable()` / `disable()` / `toggle()` → local toggle

**Step 1: Rewrite `packages/app/src/utils/tts.ts`**

Replace the entire file. Key changes:

- Remove all `window.speechSynthesis` / `SpeechSynthesisUtterance` usage
- Add `synthesize(text)` that POSTs to `/tts/speak` and returns a blob URL
- Use `HTMLAudioElement` for playback with event-driven state
- Queue management: array of pending texts, process one at a time via audio `ended` event
- `cleanTextForSpeech()` stays (same function, still useful to pre-clean before sending to server)

```ts
import { createSignal, onCleanup } from "solid-js"

function cleanTextForSpeech(text: string): string {
  // ... same as current implementation ...
}

export function createTTS(url: () => string, fetcher: () => typeof fetch) {
  const [enabled, setEnabled] = createSignal(true)
  const [speaking, setSpeaking] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [voices, setVoices] = createSignal<string[]>([])
  const [voice, setVoice] = createSignal("")
  const [rate, setRate] = createSignal("+0%")
  const [last, setLast] = createSignal<string | undefined>()

  let queue: string[] = []
  let audio: HTMLAudioElement | undefined
  let blob: string | undefined

  // Fetch available voices from server
  const load = async () => {
    try {
      const f = fetcher() ?? fetch
      const res = await f(`${url()}/tts/voices`)
      if (!res.ok) return
      const list = (await res.json()) as string[]
      setVoices(list)
      if (!voice() && list.length > 0) setVoice(list[0])
    } catch {
      // Silent — voices just won't populate
    }
  }

  // Synthesize text → blob URL
  const synthesize = async (text: string): Promise<string | undefined> => {
    try {
      const f = fetcher() ?? fetch
      const res = await f(`${url()}/tts/speak`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          voice: voice() || undefined,
          rate: rate() || undefined,
        }),
      })
      if (!res.ok) return undefined
      const data = await res.blob()
      return URL.createObjectURL(data)
    } catch {
      return undefined
    }
  }

  const revoke = () => {
    if (blob) {
      URL.revokeObjectURL(blob)
      blob = undefined
    }
  }

  const process = async () => {
    if (speaking() || queue.length === 0) return

    const text = queue.shift()!
    setSpeaking(true)
    setPaused(false)

    const src = await synthesize(text)
    if (!src) {
      // Synthesis failed — skip, try next
      setSpeaking(false)
      process()
      return
    }

    revoke()
    blob = src
    setLast(src)

    audio = new Audio(src)
    audio.onended = () => {
      setSpeaking(false)
      setPaused(false)
      audio = undefined
      process()
    }
    audio.onerror = () => {
      setSpeaking(false)
      setPaused(false)
      audio = undefined
      process()
    }
    audio.onpause = () => setPaused(true)
    audio.onplay = () => setPaused(false)
    audio.play().catch(() => {
      setSpeaking(false)
      audio = undefined
      process()
    })
  }

  const speak = (text: string) => {
    if (!enabled()) return
    const cleaned = cleanTextForSpeech(text)
    if (!cleaned.trim()) return
    queue.push(cleaned)
    process()
  }

  const stop = () => {
    queue = []
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.onerror = null
      audio.onpause = null
      audio.onplay = null
      audio = undefined
    }
    setSpeaking(false)
    setPaused(false)
  }

  const togglePause = () => {
    if (!audio) return
    if (paused()) audio.play()
    else audio.pause()
  }

  const replay = () => {
    const src = last()
    if (!src) return
    stop()
    setSpeaking(true)
    audio = new Audio(src)
    audio.onended = () => {
      setSpeaking(false)
      setPaused(false)
      audio = undefined
    }
    audio.onerror = () => {
      setSpeaking(false)
      setPaused(false)
      audio = undefined
    }
    audio.onpause = () => setPaused(true)
    audio.onplay = () => setPaused(false)
    audio.play().catch(() => {
      setSpeaking(false)
      audio = undefined
    })
  }

  onCleanup(() => stop())

  return {
    isSupported: () => true,
    isEnabled: enabled,
    isSpeaking: speaking,
    isPaused: paused,
    voices,
    selectedVoice: voice,
    setVoice,
    rate,
    setRate,
    speak,
    pause: () => audio?.pause(),
    resume: () => {
      audio?.play()
    },
    togglePause,
    stop,
    toggle: () => {
      const next = !enabled()
      setEnabled(next)
      if (!next) stop()
      return next
    },
    enable: () => setEnabled(true),
    disable: () => {
      setEnabled(false)
      stop()
    },
    queueLength: () => queue.length,
    replay,
    canReplay: () => !!last(),
    load,
  }
}
```

Key differences from the old implementation:

- `createTTS(url, fetcher)` now takes the server URL and fetch function as arguments (injected by context)
- No `window.speechSynthesis` anywhere
- `voices` is `string[]` (server voice names like `"en-US-AvaNeural"`) instead of `TTSVoice` objects
- `rate` is a string like `"+25%"` (Edge TTS format) instead of a number
- `isSupported()` is always `true`
- New `load()` method to fetch voices from server

**Step 2: Update `packages/app/src/context/tts.tsx`**

Update the provider to:

- Pass `url` and `fetcher` from the SDK/platform context
- Add localStorage persistence for voice and rate preferences
- Call `tts.load()` on mount to fetch voices from server

```tsx
import { createContext, useContext, createEffect, onMount, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createTTS } from "@/utils/tts"
import { useSDK } from "./sdk"
import { usePlatform } from "./platform"
import { useGlobalSDK } from "./global-sdk"
import { persisted, Persist } from "@/utils/persist"
import type { Part } from "@opencode-ai/sdk/v2/client"

type TTSContextValue = ReturnType<typeof createTTS>

const TTSContext = createContext<TTSContextValue>()

export function TTSProvider(props: ParentProps) {
  const sdk = useSDK()
  const platform = usePlatform()
  const globalSDK = useGlobalSDK()

  const tts = createTTS(
    () => sdk.url,
    () => platform.fetch ?? fetch,
  )

  // Persist voice and rate preferences in localStorage
  const [prefs, setPrefs] = persisted(Persist.global("tts"), createStore({ voice: "", rate: "+0%" }))

  // Sync persisted prefs → TTS state
  createEffect(() => {
    if (prefs.voice) tts.setVoice(prefs.voice)
    if (prefs.rate) tts.setRate(prefs.rate)
  })

  // When user changes voice/rate, persist
  const originalSetVoice = tts.setVoice
  tts.setVoice = (v: string) => {
    originalSetVoice(v)
    setPrefs("voice", v)
  }
  const originalSetRate = tts.setRate
  tts.setRate = (r: string) => {
    originalSetRate(r)
    setPrefs("rate", r)
  }

  // Fetch voice list on mount
  onMount(() => tts.load())

  // Track spoken parts to avoid repeats (same as before)
  const spoken = new Set<string>()
  const MAX = 500

  try {
    globalSDK.event.listen((e) => {
      try {
        const event = e.details
        if (!event || event.type !== "message.part.updated") return
        if (!tts.isEnabled()) return

        const part = event.properties.part as Part
        if (part.type !== "text") return
        if (!part.time?.end) return
        if (spoken.has(part.id)) return

        spoken.add(part.id)
        if (spoken.size > MAX) {
          const first = spoken.values().next().value
          if (first) spoken.delete(first)
        }
        tts.speak(part.text ?? "")
      } catch {}
    })
  } catch {}

  return <TTSContext.Provider value={tts}>{props.children}</TTSContext.Provider>
}

export function useTTS() {
  const context = useContext(TTSContext)
  if (!context) throw new Error("useTTS must be used within a TTSProvider")
  return context
}
```

**Step 3: Remove old types**

Delete the `TTSVoice` type export and `getGlobalTTS` singleton from the old `tts.ts` — they're no longer needed.

**Step 4: Verify it compiles**

Run: `bun typecheck` from `packages/app`

**Step 5: Describe and advance**

```
jj describe -m "feat(tts): rewrite frontend TTS to use server-side Edge TTS"
jj new
```

---

## Task 4: Update the control bar

**Files:**

- Modify: `packages/app/src/components/tts-control-bar.tsx`

**Why:** The control bar currently filters browser voices (empty on Linux) and has hardcoded dark-mode styles. Wire it to the new server-backed TTS.

**Changes:**

1. **Voice dropdown**: Use `tts.voices()` directly (server voice names), no more `englishVoices` filter. Display names cleaned up (strip `en-US-` prefix and `Neural` suffix for readability).

2. **Speed dropdown**: Map rate options to Edge TTS format strings (`"+0%"`, `"+25%"`, `"+50%"`, etc.) instead of numeric multipliers.

3. **Remove hardcoded inline styles**: Delete all `style={{ "background-color": "#1a1a1a", color: "#e0e0e0" }}`. Use only Tailwind/theme classes so it works in any theme. Add `bg-surface-base text-text-base` or similar from the existing design system.

4. **Remove `englishVoices` memo**: No longer needed — voices come pre-filtered from the server.

**Step 1: Update the component**

```tsx
import { Show, For } from "solid-js"
import { useTTS } from "@/context/tts"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"

// Clean voice name for display: "en-US-AvaNeural" → "Ava"
function label(name: string) {
  return name
    .replace(/^en-\w+-/, "")
    .replace(/Neural$/, "")
    .replace(/MultilingualNeural$/, " (Multilingual)")
    .trim()
}

const rates = [
  { value: "-50%", label: "0.5x" },
  { value: "-25%", label: "0.75x" },
  { value: "+0%", label: "1x" },
  { value: "+25%", label: "1.25x" },
  { value: "+50%", label: "1.5x" },
  { value: "+100%", label: "2x" },
]

export function TTSControlBar() {
  const tts = useTTS()

  return (
    <Show when={tts.isEnabled()}>
      {/* ... same layout structure as current, with these changes:
        - Voice <select>: <For each={tts.voices()}>, value={tts.selectedVoice()},
          onChange calls tts.setVoice(), option label uses label() helper
        - Speed <select>: <For each={rates}>, value={tts.rate()},
          onChange calls tts.setRate(e.currentTarget.value)
        - All <select> elements: remove style={{...}} props, keep only class="..."
        - Remove the englishVoices memo entirely
        - Remove isSupported() from the Show condition (always true now)
      */}
    </Show>
  )
}
```

**Step 2: Remove hardcoded styles**

For each `<select>` and `<option>`, delete:

```
style={{ "background-color": "#1a1a1a", color: "#e0e0e0" }}
```

Replace with theme-aware classes. The existing `border-border-weak-base` and `bg-surface-base` classes handle theming. Add `bg-surface-base text-text-base` to the selects.

**Step 3: Verify it compiles**

Run: `bun typecheck` from `packages/app`

**Step 4: Describe and advance**

```
jj describe -m "fix(tts): wire control bar to server TTS, fix empty dropdowns and styling"
jj new
```

---

## Task 5: Manual verification

**Why:** Verify the full flow works end-to-end.

**Step 1: Start the backend**

From `packages/opencode`:

```bash
bun run --conditions=browser ./src/index.ts serve --port 4096
```

**Step 2: Start the frontend**

From `packages/app`:

```bash
bun dev -- --port 4444
```

**Step 3: Verify**

Open `http://localhost:4444` and check:

1. **Voices endpoint**: `curl http://localhost:4096/tts/voices` should return a JSON array of voice names
2. **Speak endpoint**: `curl -X POST http://localhost:4096/tts/speak -H 'content-type: application/json' -d '{"text":"Hello world"}' -o test.mp3` should produce a valid MP3 file
3. **Control bar**: Voice dropdown should show voices (Ava, Aria, Jenny, etc.), speed dropdown should show 0.5x–2x
4. **Playback**: Send a message, TTS should speak the response. Play/pause/stop buttons should work while audio is playing.
5. **Persistence**: Change voice, refresh page, voice selection should be preserved

**Step 4: Describe final state**

```
jj describe -m "feat(tts): unify TTS — server-side Edge TTS with streaming audio to browser"
```

---

## Notes

### Voice-mode compatibility

The `voice-mode.tsx` component (on `feat/voice-mode` branch) uses:

- `tts.isSpeaking()` — works: driven by `HTMLAudioElement` events
- `tts.stop()` — works: pauses audio, clears queue
- `tts.isEnabled()` — works: unchanged signal

The `createEffect` in voice-mode that watches `tts.isSpeaking()` for `tts_finished` dispatch will work identically because `isSpeaking()` transitions from `true` → `false` when the audio element fires `ended`.

### Why msedge-tts over node-edge-tts

|            | node-edge-tts (old)              | msedge-tts (new)                                   |
| ---------- | -------------------------------- | -------------------------------------------------- |
| Streaming  | ❌ `ttsPromise(text, file)` only | ✅ `toStream()` → Node `Readable`                  |
| Auth fix   | ✅                               | ✅ Dec 2025 Sec-MS-GEC                             |
| Maintained | v1.2.8                           | v2.0.4, Jan 2026                                   |
| Downloads  | —                                | 5K/week                                            |
| API        | 1 method                         | `toStream()`, `toFile()`, `getVoices()`, `close()` |

The original plan proposed monkey-patching `node-edge-tts._connectWebSocket()` (a private method) and reimplementing the SSML + WebSocket message handler. That's fragile and duplicates auth/DRM logic. `msedge-tts.toStream()` handles all of that and returns a standard Node `Readable`.

`Readable.toWeb(audioStream)` converts to Web `ReadableStream<Uint8Array>` — matching the pattern in `packages/opencode/src/provider/provider.ts` line 102: `new Response(body, { headers })`.

### Edge TTS rate format

Edge TTS uses percentage strings for rate: `"+0%"` = 1x, `"+50%"` = 1.5x, `"-25%"` = 0.75x. The control bar maps display labels (0.5x, 1x, 2x) to these strings.

### Error handling

All synthesis/playback failures are silently skipped. The queue continues processing. No toasts, no error UI. The user experience is simply: that message doesn't get spoken, the next one will.

### Streaming behavior

The audio streaming works in two stages:

1. **Server-side**: `msedge-tts` opens a WebSocket to Microsoft's Edge TTS service. Audio chunks arrive incrementally as the service synthesizes. `toStream()` pipes these chunks into a Node `Readable` as they arrive. `Readable.toWeb()` converts to a Web `ReadableStream`. The Hono route returns `new Response(stream)` — Bun streams the chunks to the browser as they arrive from Microsoft.
2. **Browser-side**: `fetch()` collects the streaming response into a blob, creates an object URL, and plays via `HTMLAudioElement`. The browser must wait for the full response before playback starts.

For practical purposes, Edge TTS generates audio fast (~200ms–1s for message-length text), so the total time-to-audio is low. The server-side streaming eliminates temp files and reduces server memory pressure.

For lower time-to-first-audio on very long text, the browser could use `MediaSource Extensions` with WebM output format (`OUTPUT_FORMAT.WEBM_24KHZ_16BIT_MONO_OPUS`) to start playback before the full response arrives. This is complex and probably unnecessary for now.
