import "./voice-mode.css"
import { useI18n } from "~/context/i18n"
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { drawScope, loudness, Scope, AutoLevel, type ScopeStage } from "./dot-scope"
import { OrbRenderer, OrbSim, type OrbState } from "./wisp-orb"
import { setVoicePhase, voiceLevel, voicePhase, voiceSessionKey } from "./state"
import { siteSettings } from "../settings"

/**
 * Voice mode: ask OpenCode questions out loud. The footer's voice button (or, with Design mode's
 * voiceOrb "always", the resting orb) asks the browser for the microphone; then the orb from
 * OpenCode Mobile sits alone in the bottom-right corner, and Hex's Dot scope shows the voice at the
 * top of the window, with the status and captions in one line under it. The scope links to Hex.
 *
 * Hearing: the browser's SpeechRecognition; without it, a recording sent to /api/voice/transcribe
 * (ElevenLabs Scribe, when the server has a key). Answers come from /api/voice/answer. Speaking:
 * the answer's pre-generated ElevenLabs audio, then /api/voice/speech, then speechSynthesis.
 */

type Status = "connecting" | "listening" | "thinking" | "speaking" | "paused" | "failed"
type Answer = {
  id: string
  text: string
  speech: string
  links: { label: string; href: string }[]
  audio: string | null
}
type Hearing = "speech" | "recorder" | "script"
// Why voice mode can't listen, in the user's terms.
type Failure = "blocked" | "no-mic" | "disconnected" | "unsupported" | "service" | "answers" | "in-app" | "insecure"

// The platforms whose mic quirks voice mode handles. In-app browsers (Instagram, Facebook, LinkedIn,
// TikTok, Snapchat, Line and Android WebViews) usually can't record or recognise speech at all.
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
const ios =
  /iPhone|iPad|iPod/.test(ua) ||
  (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)
const android = /Android/.test(ua)
const inApp = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|TikTok|\bLine\/|; wv\)/.test(
  ua,
)

const failures: Record<Failure, [string, string]> = {
  blocked: [
    "Microphone blocked",
    ios
      ? "In Safari, tap aA in the address bar, then Website Settings › Microphone › Allow, and tap the orb again."
      : android
        ? "Tap the lock icon in the address bar, then Permissions › Microphone › Allow, and tap the orb again."
        : "Allow the microphone for this site in the address bar, then try again.",
  ],
  "in-app": [
    "This app's browser can't use the microphone",
    ios ? "Open this page in Safari to talk to OpenCode." : "Open this page in Chrome to talk to OpenCode.",
  ],
  insecure: ["Voice needs a secure connection", "Open this page over HTTPS to use the microphone."],
  "no-mic": ["No microphone", "Connect a microphone, then try again."],
  disconnected: ["Microphone disconnected", "Connect your microphone again, then try again."],
  unsupported: ["Voice isn't supported in this browser", "Try Chrome, Edge or Safari to talk to OpenCode."],
  service: [
    "Speech recognition isn't responding",
    "Your browser's speech service didn't answer. Try again in a moment.",
  ],
  answers: ["Couldn't get an answer", "The answers didn't load. Try again in a moment."],
}

const hexUrl = "https://anoma.ly/hex"
const hexKey = "opencode-voice-hex-line-shown"
const hexDismissedKey = "opencode-voice-hex-dismissed"
const examples = ["What is OpenCode?", "Which models can I use?", "Is there a mobile app?"]

export default function VoiceMode() {
  const i18n = useI18n()
  const props = {
    get captions() {
      return siteSettings.voiceCaptions
    },
  }
  // Restored from an earlier page load: paused, with no microphone until the orb is clicked.
  const [status, setStatus] = createSignal<Status>(voicePhase() === "active" ? "paused" : "connecting")
  const [failure, setFailure] = createSignal<Failure>()
  // What the user is saying: the settled words, then the words still being recognised.
  const [heardFinal, setHeardFinal] = createSignal("")
  const [heardInterim, setHeardInterim] = createSignal("")
  const heard = () => heardFinal() + heardInterim()
  const setHeard = (text: string, interim = "") => {
    setHeardFinal(text)
    setHeardInterim(interim)
  }
  // Hex's section in the popover: shown from the first question on, until dismissed (both per session).
  const [hexShown, setHexShown] = createSignal(false)
  // Hex's section comes in once the user has actually spoken in this voice session: the first final
  // recognised utterance. Interim words and example chips don't count. "Maybe later" hides it for the visit.
  const spoke = () => {
    if (sessionStorage.getItem(hexDismissedKey) !== "1") setHexShown(true)
  }
  const [answer, setAnswer] = createSignal<Answer>()
  const [spoken, setSpoken] = createSignal(0)
  // After an answer: its links, and once per session the line about Hex.
  const [asked, setAsked] = createSignal(false)
  const [tail, setTail] = createSignal<{ links: Answer["links"]; hex: boolean }>()
  const [captionShown, setCaptionShown] = createSignal(false)
  const [scopeShown, setScopeShown] = createSignal(false)
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  const darkQuery = matchMedia("(prefers-color-scheme: dark)")
  const phoneQuery = matchMedia("(max-width: 40rem)")
  const coarse = matchMedia("(pointer: coarse)")
  // The hover explainer is for mouse and trackpad only; touch goes straight to the browser's prompt.
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)")
  const hexTitle = `Like talking to your ${matchMedia("(pointer: coarse)").matches ? "device" : "computer"}?`
  const capabilities = fetch("/api/voice/capabilities")
    .then((response) => response.json() as Promise<{ speech: boolean; transcribe: boolean; model: boolean }>)
    .catch(() => ({ speech: false, transcribe: false, model: false }))
  // A dev-only stand-in for speech recognition (for recordings in headless browsers, which have none):
  // ?voice-script=<question> "hears" that question while the microphone has a voice on it.
  const script = import.meta.env.DEV ? new URLSearchParams(location.search).get("voice-script") : null

  let orbCanvas!: HTMLCanvasElement
  let orbButton: HTMLButtonElement | undefined
  let scopeCanvas!: HTMLCanvasElement
  let hexLink!: HTMLAnchorElement
  let topBox!: HTMLDivElement
  let sheet: HTMLElement | undefined
  let caption: HTMLDivElement | undefined
  let stream: MediaStream | undefined
  let audio: AudioContext | undefined
  let micAnalyser: AnalyserNode | undefined
  let playAnalyser: AnalyserNode | undefined
  const samples = new Float32Array(1024)
  let hearing: Hearing = "speech"
  let recognition: SpeechRecognitionLike | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  let networkErrors = 0
  let recorder: MediaRecorder | undefined
  let player: HTMLAudioElement | undefined
  let utterance: SpeechSynthesisUtterance | undefined
  let request: AbortController | undefined
  let starting = false
  // The idle explainer: shown after a short hover (or at once on keyboard focus), hidden after a short
  // grace period, so the pointer can move from the orb onto it.
  const [explainer, setExplainer] = createSignal(false)
  let explainerTimer: ReturnType<typeof setTimeout> | undefined
  const showExplainer = (delay: number) => {
    clearTimeout(explainerTimer)
    explainerTimer = setTimeout(() => !active() && setExplainer(true), delay)
  }
  const hideExplainer = () => {
    clearTimeout(explainerTimer)
    explainerTimer = setTimeout(() => setExplainer(false), 250)
  }
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let frame = 0
  let scopeCleared = false
  let solid = 1
  let last = 0
  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let hovering = false
  const sim = new OrbSim()
  const scope = new Scope()
  const micLevel = new AutoLevel()
  let renderer: OrbRenderer | undefined
  let synthetic = 0
  // Voice-activity state for the recorder and the scripted recogniser.
  let voiced = 0
  let silent = 0
  let heardAt = 0

  const active = () => voicePhase() !== "closed"
  const isDark = () => {
    const theme = (document.querySelector("[data-site]") as HTMLElement | null)?.dataset.theme
    return theme === "dark" || (theme !== "light" && darkQuery.matches)
  }

  // The rAF loop: meters, both simulations, both drawings, the Hex link's size and the footer icon's level.
  // The loop runs every frame only while voice mode listens, thinks or speaks, and for a moment after
  // any change so transitions finish smoothly. Idle, paused or failed, the orb's slow breathing is
  // drawn 8 times a second; with reduced motion it stops on a still frame. rAF itself pauses in a
  // hidden tab.
  const busy = () => {
    const s = status()
    return voicePhase() !== "closed" && s !== "paused" && s !== "failed"
  }
  let changedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  function kick() {
    changedAt = performance.now()
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(loop)
  }
  function schedule(now: number) {
    if (busy() || now - changedAt < 1500 || !scope.settled || (solid > 0 && solid < 1)) {
      frame = requestAnimationFrame(loop)
      return
    }
    // The plain circle doesn't move: draw it once and stop until something changes.
    if (reduced || solid === 1) return
    timer = setTimeout(() => (frame = requestAnimationFrame(loop)), 125)
  }
  createEffect(on([voicePhase, status, () => siteSettings.voiceOrbShadow], kick, { defer: true }))
  // A stopped loop still redraws for a theme change or a new window size.
  onMount(() => {
    const site = document.querySelector("[data-site]")
    const themes = new MutationObserver(kick)
    if (site) themes.observe(site, { attributes: true, attributeFilter: ["data-theme"] })
    darkQuery.addEventListener("change", kick)
    window.addEventListener("resize", kick)
    onCleanup(() => {
      themes.disconnect()
      darkQuery.removeEventListener("change", kick)
      window.removeEventListener("resize", kick)
    })
  })

  const loop = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0
    last = now
    schedule(now)
    const s = status()
    const micDb = s === "paused" ? -120 : meter(micAnalyser)
    const speaking = s === "speaking"
    const playDb = speaking ? (playAnalyser ? meter(playAnalyser) : syntheticDb(now)) : -120
    const user = s === "listening" ? micLevel.step(micDb, Math.max(dt, 1 / 240)) : 0
    const agent = speaking ? clamp((playDb + 50) / 36, 0, 1) : 0
    voiceLevel.value = speaking ? agent : user
    listenForVoice(user, dt)
    if (player && speaking && player.duration) setSpoken(player.currentTime / player.duration)
    sim.step(dt, user, agent, orbState(), reduced)
    // Idle and paused, the orb is a plain circle; it crossfades (200 ms) into the live orb.
    const solidTarget = voicePhase() !== "active" || s === "paused" || s === "failed" ? 1 : 0
    solid = reduced ? solidTarget : clamp(solid + Math.sign(solidTarget - solid) * (dt / 0.2), 0, 1)
    if (Math.abs(solid - solidTarget) < 0.01) solid = solidTarget
    renderer?.draw(sim, isDark(), siteSettings.voiceOrbShadow / 100, solid)
    const stage: ScopeStage =
      s === "thinking" ? "processing" : speaking ? "speaking" : s === "failed" ? "failed" : "recording"
    // Idle and paused, the pill fades away; it comes back with listening. Once it has faded out and
    // been cleared, neither its simulation nor its drawing runs.
    const pill = voicePhase() === "active" && s !== "paused"
    if (pill || !scope.settled || !scopeCleared) {
      scope.advance(dt, stage, pill, speaking ? playDb : micDb, reduced)
      drawScope(scopeCanvas, scope, isDark(), 1.5)
      scopeCleared = scope.settled
      const shown = scope.opacity.x > 0.5
      if (shown !== scopeShown()) setScopeShown(shown)
      if (shown) hexLink.style.width = `${Math.max(scope.width.x, 26) * 1.5 * scope.scale.x}px`
      if (scope.opacity.x > 0.002) placeTop()
    }
  }

  // On phones the pill sits 8px below whatever is stuck to the top of the window: the top bar, the
  // announcement banner, and on legal pages the breadcrumb and view tabs once they stick. The canvas
  // has 16.5px above the pill. Desktop keeps its place from the CSS.
  const stuckAtTop =
    'header[data-component="topbar"], [data-component="announcement-banner"], [data-component="breadcrumb"], [data-slot="view-tabs"]'
  let placedTop = ""
  function placeTop() {
    let bottom = 0
    if (phoneQuery.matches)
      for (const rect of [...document.querySelectorAll<HTMLElement>(stuckAtTop)]
        .map((el) => el.getBoundingClientRect())
        .sort((a, b) => a.top - b.top)) {
        // Stuck: touching the top edge or the bottom of what's above it, and on screen.
        if (rect.height && rect.top <= bottom + 1 && rect.bottom > bottom) bottom = rect.bottom
      }
    const top = phoneQuery.matches && bottom ? `${Math.round(bottom + 8 - 16.5)}px` : ""
    if (top !== placedTop) topBox.style.top = placedTop = top
  }

  // On phones the conversation scrolls in its sheet; keep the newest words in view.
  createEffect(
    on([heardFinal, heardInterim, answer, spoken, hexShown], () => {
      if (!sheet || !phoneQuery.matches) return
      const target = sheet
      const toEnd = () => (target.scrollTop = target.scrollHeight)
      requestAnimationFrame(toEnd)
      // And again once the Hex section has finished growing in.
      setTimeout(toEnd, 360)
    }),
  )

  const orbState = (): OrbState => {
    if (!active()) return "sleeping"
    const s = status()
    // Paused rests like idle: the plain circle at its resting size.
    if (s === "paused") return "sleeping"
    return s === "failed" ? "error" : s
  }

  function meter(analyser: AnalyserNode | undefined) {
    if (!analyser) return -120
    analyser.getFloatTimeDomainData(samples)
    const sum = samples.reduce((total, value) => total + value * value, 0)
    return loudness(Math.sqrt(sum / samples.length))
  }

  // speechSynthesis has no audio to meter: syllables at about 4.5 a second (Hex's `demo_level`).
  function syntheticDb(now: number) {
    const t = (now - synthetic) / 1000
    const phrase = Math.floor(t / 2.4)
    const into = t - phrase * 2.4
    if (into > 1.9) return -58
    const shape = Math.pow(Math.sin((Math.PI * into) / 1.9), 0.4)
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * (4.3 + 0.6 * Math.sin(phrase * 1.7)) * into + phrase)
    return -58 + 28 * (0.08 + 0.82 * shape * Math.pow(syllable, 1.6))
  }

  onMount(() => {
    // Phones get a bigger orb: a 70px circle while active, about 53px at rest (desktop: 52 and 40).
    const sizeOrb = () => {
      renderer = new OrbRenderer(orbCanvas, phoneQuery.matches ? 70 : 52, 1.75)
      kick()
    }
    sizeOrb()
    phoneQuery.addEventListener("change", sizeOrb)
    onCleanup(() => phoneQuery.removeEventListener("change", sizeOrb))

    frame = requestAnimationFrame(loop)
    document.addEventListener("keydown", onKey)
    document.addEventListener("visibilitychange", onVisibility)
  })
  onCleanup(() => {
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    clearTimeout(fadeTimer)
    clearTimeout(idleTimer)
    clearTimeout(explainerTimer)
    document.removeEventListener("keydown", onKey)
    document.removeEventListener("visibilitychange", onVisibility)
    shutdown()
  })

  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape" || !active()) return
    event.preventDefault()
    close()
  }

  // A hidden tab can't recognise speech, and Chrome ends recognition there; start again on return.
  function onVisibility() {
    // Phones stop the mic when the screen locks or the tab goes to the background; voice mode pauses
    // then and waits for a tap, instead of coming back half-working.
    if (
      document.hidden &&
      coarse.matches &&
      voicePhase() === "active" &&
      status() !== "paused" &&
      status() !== "failed"
    )
      return pause()
    if (document.hidden) return abortRecognition()
    if (status() === "listening" && hearing === "speech" && !recognition) startRecognition()
  }

  createEffect(
    on(voicePhase, (phase) => {
      if (phase === "closed") sessionStorage.setItem(voiceSessionKey, "closed")
      if (phase === "active") sessionStorage.setItem(voiceSessionKey, "paused")
      if (phase === "asking") start()
      if (phase === "closed") shutdown()
    }),
  )

  // Captions show while something is being said, and fade a few seconds after it ends.
  function holdCaption(ms?: number) {
    clearTimeout(fadeTimer)
    setCaptionShown(true)
    if (ms) fadeTimer = setTimeout(fadeCaption, ms)
  }
  function fadeCaption() {
    if (hovering || caption?.contains(document.activeElement)) {
      fadeTimer = setTimeout(fadeCaption, 1500)
      return
    }
    setCaptionShown(false)
  }

  function fail(reason: Failure) {
    abortRecognition()
    stopRecorder()
    setStatus("failed")
    setFailure(reason)
    setTail(undefined)
    holdCaption()
  }

  async function start() {
    if (starting) return
    starting = true
    setStatus("connecting")
    setFailure(undefined)
    setHexShown(false)
    holdCaption()
    const media = await navigator.mediaDevices
      ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch((error: DOMException) => error)
    starting = false
    if (!active()) {
      if (media instanceof MediaStream) media.getTracks().forEach((track) => track.stop())
      return
    }
    setVoicePhase("active")
    if (!media || media instanceof DOMException) {
      if (!navigator.mediaDevices) return fail(window.isSecureContext ? "unsupported" : "insecure")
      return fail(media?.name === "NotAllowedError" || media?.name === "SecurityError" ? "blocked" : "no-mic")
    }
    stream = media
    stream.getAudioTracks().forEach((track) => (track.onended = () => active() && fail("disconnected")))
    // Made (and resumed) during the orb's click, so the browser lets it play the answers.
    audio ??= new AudioContext()
    void audio.resume().catch(() => undefined)
    micAnalyser = audio.createAnalyser()
    micAnalyser.fftSize = 1024
    audio.createMediaStreamSource(stream).connect(micAnalyser)
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((permission) => {
        permission.onchange = () => permission.state === "denied" && active() && fail("blocked")
      })
      .catch(() => undefined)
    const caps = await capabilities
    if (script) hearing = "script"
    else if (speechRecognition()) hearing = "speech"
    else if (caps.transcribe && typeof MediaRecorder !== "undefined") hearing = "recorder"
    else return fail("unsupported")
    if (status() === "paused") return
    listen()
    holdCaption(2500)
  }

  function close() {
    setVoicePhase("closed")
    orbButton?.focus()
  }

  function shutdown() {
    request?.abort()
    abortRecognition()
    stopRecorder()
    stopSpeaking()
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    stream = undefined
    void audio?.close().catch(() => undefined)
    audio = undefined
    micAnalyser = undefined
    playAnalyser = undefined
    clearTimeout(fadeTimer)
    setCaptionShown(false)
    setStatus("connecting")
    setFailure(undefined)
    setHeard("")
    setAnswer(undefined)
    setTail(undefined)
    setAsked(false)
    setHexShown(false)
  }

  function listen() {
    stream?.getAudioTracks().forEach((track) => (track.enabled = true))
    if (ios) audioSession("play-and-record")
    stopSpeaking()
    setStatus("listening")
    setFailure(undefined)
    // The popover keeps the last question with its answer until the next one starts.
    if (props.captions === "top") setHeard("")
    voiced = 0
    silent = 0
    heardAt = 0
    if (hearing === "speech") startRecognition()
  }

  // Recognition ends after each phrase and after a few seconds of silence ("no-speech"). While voice
  // mode listens it starts again: at once after a normal end, and with a growing pause (up to 4 s)
  // when it keeps ending straight away. Only a lasting failure stops it, and says why.
  function startRecognition() {
    clearTimeout(retryTimer)
    if (document.hidden || recognition) return
    const Recognition = speechRecognition()
    if (!Recognition) return fallBack("unsupported")
    const rec = new Recognition()
    rec.lang = document.documentElement.lang || "en-US"
    rec.interimResults = true
    rec.continuous = false
    const startedAt = performance.now()
    let started = false
    let fatal: Failure | undefined
    // Some Chromium builds (embedded browsers without Google's speech service) never start.
    const watchdog = setTimeout(() => {
      if (started || recognition !== rec) return
      recognition = undefined
      rec.abort()
      fallBack("unsupported")
    }, 5000)
    rec.onstart = () => (started = true)
    rec.onresult = (event: SpeechResultEvent) => {
      retries = 0
      networkErrors = 0
      const results = Array.from(event.results)
      const settled = results
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join("")
      const pending = results
        .filter((result) => !result.isFinal)
        .map((result) => result[0].transcript)
        .join("")
      setHeard(settled, pending)
      setAnswer(undefined)
      setTail(undefined)
      holdCaption()
      said = (settled + pending).trim()
      clearTimeout(settleTimer)
      if (results.at(-1)?.isFinal && settled.trim()) return finish(settled)
      // Chrome often ends a phrase without ever marking it final, or keeps it open after you stop.
      // Words that stop changing for 1.2 s count as the question.
      settleTimer = setTimeout(() => recognition === rec && said && finish(said), 1200)
    }
    // Takes what was heard as the question, once.
    let said = ""
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (text: string) => {
      clearTimeout(settleTimer)
      said = ""
      if (status() !== "listening") return
      spoke()
      ask(text)
    }
    rec.onerror = (event: { error: string }) => {
      if (event.error === "not-allowed") fatal = "blocked"
      if (event.error === "service-not-allowed" || event.error === "language-not-supported") fatal = "unsupported"
      if (event.error === "audio-capture") fatal = "no-mic"
      if (event.error === "network") networkErrors += 1
      if (networkErrors >= 5) fatal = "service"
    }
    rec.onend = () => {
      clearTimeout(watchdog)
      clearTimeout(settleTimer)
      if (recognition !== rec) return
      recognition = undefined
      if (fatal) return fallBack(fatal)
      if (status() !== "listening") return
      // Ended with words but no final result: answer them rather than dropping them.
      if (said) return finish(said)
      retries = performance.now() - startedAt < 1000 ? retries + 1 : 0
      retryTimer = setTimeout(startRecognition, retries ? Math.min(250 * 2 ** (retries - 1), 4000) : 0)
    }
    recognition = rec
    try {
      rec.start()
    } catch {
      recognition = undefined
      clearTimeout(watchdog)
      retryTimer = setTimeout(startRecognition, 500)
    }
  }

  // Without working recognition, a server transcription key still lets the recording through.
  async function fallBack(reason: Failure) {
    const caps = await capabilities
    if ((reason === "unsupported" || reason === "service") && caps.transcribe && typeof MediaRecorder !== "undefined") {
      hearing = "recorder"
      return
    }
    fail(reason)
  }

  function abortRecognition() {
    clearTimeout(retryTimer)
    const rec = recognition
    recognition = undefined
    rec?.abort()
  }

  function stopRecorder() {
    if (recorder?.state === "recording") recorder.stop()
    recorder = undefined
  }

  // Voice activity for the recorder and the scripted recogniser: a voice starts after 120 ms above
  // the level and ends after 800 ms below it.
  function listenForVoice(level: number, dt: number) {
    if (status() !== "listening" || hearing === "speech") return
    if (level > 0.32) {
      voiced += dt
      silent = 0
    } else if (voiced > 0.12) silent += dt
    if (voiced > 0.12 && !heardAt) {
      heardAt = performance.now()
      if (hearing === "recorder") startRecorder()
    }
    if (heardAt && hearing === "script" && script) {
      const words = script.split(" ")
      const count = Math.min(words.length, 1 + Math.floor(((performance.now() - heardAt) / 1000) * 3.2))
      setHeard("", words.slice(0, count).join(" "))
      setAnswer(undefined)
      setTail(undefined)
      holdCaption()
    }
    if (heardAt && silent > 0.8) {
      heardAt = 0
      voiced = 0
      silent = 0
      if (hearing === "script" && script) {
        spoke()
        ask(script)
      }
      if (hearing === "recorder" && recorder?.state === "recording") recorder.stop()
    }
  }

  function startRecorder() {
    if (!stream) return
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (event) => chunks.push(event.data)
    rec.onstop = async () => {
      if (status() !== "listening") return
      setStatus("thinking")
      const text = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: new Blob(chunks, { type: rec.mimeType }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<{ text: string }>) : { text: "" }))
        .catch(() => ({ text: "" }))
      if (voicePhase() !== "active") return
      if (!text.text) return listen()
      spoke()
      ask(text.text)
    }
    recorder = rec
    rec.start()
  }

  async function ask(question: string) {
    setAsked(true)
    abortRecognition()
    stopRecorder()
    stopSpeaking()
    setHeard(question)
    setTail(undefined)
    setStatus("thinking")
    holdCaption()
    request?.abort()
    const controller = new AbortController()
    request = controller
    const [reply] = await Promise.all([
      fetch("/api/voice/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, page: location.pathname }),
        signal: controller.signal,
      })
        .then((response) => (response.ok ? (response.json() as Promise<Answer>) : undefined))
        .catch(() => undefined),
      // Long enough for the thinking look to read as a beat, not a flicker.
      new Promise((resolve) => setTimeout(resolve, 500)),
    ])
    if (controller.signal.aborted || voicePhase() !== "active") return
    if (!reply) {
      fail("answers")
      setTimeout(() => failure() === "answers" && listen(), 3000)
      return
    }
    setAnswer(reply)
    setSpoken(0)
    speak(reply)
  }

  async function speak(reply: Answer) {
    setStatus("speaking")
    // iOS routes audio to the earpiece while the mic records: mute the mic and switch the page's audio
    // session to playback while it speaks (Safari 16.4+; ignored elsewhere).
    if (ios) {
      stream?.getAudioTracks().forEach((track) => (track.enabled = false))
      audioSession("playback")
    }
    holdCaption()
    const caps = await capabilities
    // The recorded answers are also Opus in WebM (public/voice/<id>.webm, a third smaller): tried
    // first where the browser decodes it, with the MP3 next if it fails.
    const opus = reply.audio?.endsWith(".mp3") && new Audio().canPlayType('audio/webm; codecs="opus"') === "probably"
    const sources = [
      opus ? reply.audio?.replace(/\.mp3$/, ".webm") : null,
      reply.audio,
      caps.speech ? "speech" : null,
    ].filter((source): source is string => Boolean(source))
    for (const source of sources) {
      if (status() !== "speaking") return
      const url = source === "speech" ? await fetchSpeech(reply.speech) : source
      if (url && (await play(url))) return
    }
    if (status() === "speaking") synthesize(reply)
  }

  async function fetchSpeech(text: string) {
    const response = await fetch("/api/voice/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => undefined)
    if (!response?.ok) return undefined
    return URL.createObjectURL(await response.blob())
  }

  // Resolves false when the audio can't play, so the next source gets a turn.
  function play(url: string) {
    return new Promise<boolean>((resolve) => {
      const element = new Audio(url)
      player = element
      // Through the analyser only when the context is running; a suspended one would play silence.
      // Not on iOS, where Web Audio output while the mic is open can come out of the earpiece.
      if (audio?.state === "running" && !ios) {
        playAnalyser = audio.createAnalyser()
        playAnalyser.fftSize = 1024
        audio.createMediaElementSource(element).connect(playAnalyser)
        playAnalyser.connect(audio.destination)
      }
      element.onended = () => {
        if (player !== element) return
        setSpoken(1)
        finished()
      }
      element.onerror = () => {
        if (player === element) player = undefined
        resolve(false)
      }
      element.play().then(
        () => resolve(true),
        () => {
          if (player === element) player = undefined
          resolve(false)
        },
      )
    })
  }

  function synthesize(reply: Answer) {
    if (!("speechSynthesis" in window)) return finished()
    const next = new SpeechSynthesisUtterance(reply.speech)
    next.lang = "en-US"
    utterance = next
    playAnalyser = undefined
    synthetic = performance.now()
    next.onboundary = (event) => setSpoken(event.charIndex / reply.speech.length)
    const done = () => {
      clearTimeout(guard)
      if (utterance !== next) return
      setSpoken(1)
      finished()
    }
    next.onend = done
    next.onerror = done
    // Some systems have no voice and never end the utterance; don't wait forever. Without
    // boundary events the caption follows the clock at about 14 characters a second.
    const length = reply.speech.length
    const started = performance.now()
    const guard = setTimeout(done, (length / 14) * 1000 + 3000)
    const follow = () => {
      if (utterance !== next) return
      setSpoken((s) => Math.max(s, Math.min((((performance.now() - started) / 1000) * 14) / length, 0.99)))
      requestAnimationFrame(follow)
    }
    requestAnimationFrame(follow)
    speechSynthesis.cancel()
    speechSynthesis.speak(next)
  }

  function stopSpeaking() {
    const element = player
    player = undefined
    element?.pause()
    playAnalyser = undefined
    if (utterance) {
      utterance = undefined
      speechSynthesis.cancel()
    }
  }

  function finished() {
    player = undefined
    utterance = undefined
    playAnalyser = undefined
    const hex = sessionStorage.getItem(hexKey) !== "1"
    if (hex) sessionStorage.setItem(hexKey, "1")
    const links = answer()?.links ?? []
    setTail(links.length || hex ? { links, hex } : undefined)
    holdCaption(links.length || hex ? 7000 : 3000)
    if (voicePhase() === "active") listen()
  }

  // The orb: interrupts an answer, otherwise ends voice mode. With voiceOrb "always" it also starts it.
  // The orb starts voice mode, then pauses and resumes it (an answer being spoken stops too). Esc ends
  // it, and so do ten minutes paused.
  function tapOrb() {
    // Audio is only allowed to start from a user gesture: make the context now, inside the click.
    if (!audio) audio = new AudioContext()
    void audio.resume().catch(() => undefined)
    if (!active()) {
      clearTimeout(explainerTimer)
      return begin()
    }
    if (status() === "paused") return resume()
    if (status() === "failed") {
      if (failure() === "in-app" || failure() === "insecure") return
      return stream ? listen() : start()
    }
    pause()
  }

  // Starts voice mode from a tap: it says why it can't where the browser never could.
  // getUserMedia runs here, inside the tap or click, so the browser's own prompt appears at once (or,
  // already allowed, listening starts).
  function begin() {
    setExplainer(false)
    if (inApp) return failNow("in-app")
    if (!window.isSecureContext) return failNow("insecure")
    setVoicePhase("asking")
    void start()
  }
  function failNow(reason: Failure) {
    setVoicePhase("active")
    fail(reason)
  }

  // Paused, the microphone stays granted but its track is muted, so nothing is captured.
  function pause() {
    request?.abort()
    abortRecognition()
    stopRecorder()
    if (status() === "speaking") setSpoken(1)
    stopSpeaking()
    stream?.getAudioTracks().forEach((track) => (track.enabled = false))
    setStatus("paused")
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => status() === "paused" && setVoicePhase("closed"), 10 * 60 * 1000)
  }

  const resume = () => {
    clearTimeout(idleTimer)
    if (!stream) return void start()
    listen()
  }

  const paused = () => status() === "paused"
  // Paused or failed, the orb rests as the plain circle with the voice icon; a tap resumes or retries.
  const resting = () => paused() || status() === "failed"
  const orbLabel = () => {
    if (!active()) return "Start voice mode"
    if (status() === "failed") return "Try voice mode again"
    return paused() ? "Resume voice mode" : "Pause voice mode"
  }

  // The caption line: a status word when there is no speech to show, then what was said.
  const statusWord = () => {
    const reason = failure()
    if (reason) return failures[reason][0]
    const s = status()
    if (s === "connecting") return "Waiting for the microphone"
    if (s === "listening" && !heard() && !tail()) return "Listening"
    if (s === "thinking") return "Thinking"
    return ""
  }

  // The whole answer, split at the word being spoken.
  const spokenText = () => {
    const text = answer()?.text ?? ""
    if (spoken() >= 1) return [text, ""]
    const end = text.indexOf(" ", Math.round(text.length * clamp(spoken(), 0, 1)))
    const split = end === -1 ? text.length : end
    return [text.slice(0, split), text.slice(split)]
  }

  // The sentence being spoken, split at the current word.
  const spokenSentence = () => {
    const text = answer()?.text ?? ""
    const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]
    const at = Math.round(text.length * clamp(spoken(), 0, 1))
    let start = 0
    const sentence = sentences.find((item) => {
      if (at < start + item.length) return true
      start += item.length
      return false
    })
    if (!sentence) return [sentences.at(-1) ?? "", ""]
    const into = at - start
    const end = sentence.indexOf(" ", into)
    const split = end === -1 ? sentence.length : end
    return [sentence.slice(0, split), sentence.slice(split)]
  }

  // The newest part of what the user is saying, so a long question doesn't push past two lines.
  const heardTail = () => {
    const text = heard()
    return text.length > 110 ? `…${text.slice(-110)}` : text
  }

  return (
    <>
      {/* The voice demo listens, answers and speaks in English only (voice-answers.ts), so it says so. */}
      <div data-component="voice-mode" lang="en" data-status={status()} data-active={active() ? "" : undefined}>
        <div data-slot="top" ref={topBox}>
          <canvas ref={scopeCanvas} data-slot="scope" aria-hidden="true" />
          <a
            ref={hexLink}
            data-slot="hex"
            href={hexUrl}
            target="_blank"
            rel="noopener"
            aria-label="Hex — voice to text"
            title="Hex — voice to text"
            tabIndex={scopeShown() ? 0 : -1}
            // Out of the accessibility tree too while it isn't showing.
            aria-hidden={scopeShown() ? undefined : "true"}
            data-shown={scopeShown() ? "" : undefined}
          />
          <Show when={props.captions === "top"}>
            <div
              ref={caption}
              data-slot="caption"
              data-shown={active() && captionShown() ? "" : undefined}
              data-failed={failure() ? "" : undefined}
              aria-live="polite"
              onPointerEnter={() => (hovering = true)}
              onPointerLeave={() => (hovering = false)}
            >
              <Show when={statusWord()}>
                <span data-slot="word">{statusWord()}</span>
              </Show>
              <Show when={failure()}>{(reason) => <p>{failures[reason()][1]}</p>}</Show>
              <Show
                when={
                  !failure() &&
                  (status() === "connecting" || status() === "listening" || status() === "thinking") &&
                  !tail()
                }
              >
                <Show
                  when={heard()}
                  fallback={
                    <Show when={status() === "connecting"}>
                      <p>Allow the microphone to talk to OpenCode.</p>
                    </Show>
                  }
                >
                  <p data-slot="heard">{heardTail()}</p>
                </Show>
              </Show>
              <Show when={status() === "speaking" && answer()}>
                <p data-slot="answer">
                  <span data-slot="said">{spokenSentence()[0]}</span>
                  <span data-slot="unsaid">{spokenSentence()[1]}</span>
                </p>
              </Show>
              <Show when={status() === "listening" && !heard() && tail()}>
                {(after) => (
                  <p data-slot="tail">
                    <For each={after().links}>
                      {(link) => (
                        <a
                          href={link.href}
                          {...(link.href.startsWith("http") ? { target: "_blank", rel: "noopener" } : {})}
                        >
                          {link.label}
                        </a>
                      )}
                    </For>
                    <Show when={after().hex && props.captions === "top"}>
                      <span data-slot="hex-line">
                        {hexTitle}{" "}
                        <a href={hexUrl} target="_blank" rel="noopener">
                          Try Hex
                        </a>
                      </span>
                    </Show>
                  </p>
                )}
              </Show>
            </div>
          </Show>
        </div>

        {/* Idle: what the orb will do, on hover or keyboard focus. Always in the page, so the orb's
            description can point to it. */}
        <Show when={props.captions === "popover" && !active()}>
          <section
            data-slot="popover"
            data-explainer=""
            aria-hidden={explainer() ? undefined : "true"}
            inert={!explainer()}
            data-hidden={explainer() ? undefined : ""}
            onPointerEnter={() => clearTimeout(explainerTimer)}
            onPointerLeave={(event) => event.pointerType !== "touch" && hideExplainer()}
          >
            <div data-slot="body" id="voice-orb-explainer">
              <p data-slot="intro">Talk to OpenCode</p>
              <p>Allow microphone access to talk.</p>
            </div>
          </section>
        </Show>

        <Show when={props.captions === "popover" && voicePhase() === "active"}>
          <section
            ref={sheet}
            data-slot="popover"
            aria-label="Voice mode"
            aria-hidden={paused() ? "true" : undefined}
            inert={paused()}
            data-hidden={paused() ? "" : undefined}
            data-failed={failure() ? "" : undefined}
          >
            <div data-slot="body" aria-live="polite">
              <Show when={failure()}>
                {(reason) => (
                  <p data-slot="notice" role="alert">
                    <span data-slot="error">{failures[reason()][0]}.</span> {failures[reason()][1]}
                  </p>
                )}
              </Show>
              <Show when={!failure() && !heard() && !answer() && !asked()}>
                <p data-slot="intro">Ask me anything about OpenCode</p>
                <div data-slot="examples">
                  <For each={examples}>
                    {(question) => (
                      <button type="button" onClick={() => ask(question)}>
                        {question}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={heard()}>
                <p data-slot="heard">
                  <span data-slot="final">{heardFinal()}</span>
                  <span data-slot="interim">{heardInterim()}</span>
                </p>
              </Show>
              <Show when={answer() && status() !== "thinking"}>
                <div data-slot="answer">
                  <p>
                    <span data-slot="said">{spokenText()[0]}</span>
                    <span data-slot="unsaid">{spokenText()[1]}</span>
                  </p>
                </div>
              </Show>
            </div>
            <Show when={hexShown()}>
              {/* Mounted closed, then opened on the next frame, so its height grows from 0 once. */}
              <div
                data-slot="hex-wrap"
                ref={(el) => requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute("data-open", "")))}
              >
                <div data-slot="hex-clip">
                  <aside data-slot="hex-sell" aria-label="Hex">
                    <img src="/apps/hex.png" alt="" width="28" height="28" />
                    <div>
                      <p data-slot="hex-title">{hexTitle}</p>
                      <p data-slot="hex-body">Hex is free, open source dictation for Mac, Windows and Linux.</p>
                    </div>
                    <div data-slot="hex-actions">
                      <a data-slot="hex-get" href={hexUrl} target="_blank" rel="noopener">
                        Get Hex
                      </a>
                      <button
                        type="button"
                        data-slot="hex-later"
                        onClick={() => {
                          sessionStorage.setItem(hexDismissedKey, "1")
                          setHexShown(false)
                        }}
                      >
                        Maybe later
                      </button>
                    </div>
                  </aside>
                </div>
              </div>
            </Show>
          </section>
        </Show>

        <button
          ref={orbButton}
          type="button"
          data-slot="orb"
          data-design="voiceOrb voiceCaptions voiceOrbShadow"
          data-shown=""
          data-active={voicePhase() === "active" && !resting() ? "" : undefined}
          data-resting={voicePhase() !== "active" || resting() ? "" : undefined}
          aria-label={orbLabel()}
          aria-pressed={voicePhase() === "active" ? (paused() ? "true" : "false") : undefined}
          aria-describedby={
            active() ? "voice-orb-hint" : props.captions === "popover" ? "voice-orb-explainer" : undefined
          }
          onPointerEnter={(event) =>
            event.pointerType === "mouse" && finePointer.matches && !active() && showExplainer(150)
          }
          onPointerLeave={(event) => event.pointerType !== "touch" && hideExplainer()}
          onFocus={(event) => event.currentTarget.matches(":focus-visible") && !active() && showExplainer(0)}
          onBlur={hideExplainer}
          title={active() ? orbLabel() : undefined}
          onClick={tapOrb}
        >
          <canvas ref={orbCanvas} aria-hidden="true" />
          <span id="voice-orb-hint" data-slot="sr-only">
            {i18n.t("site.voice.endHint")}
          </span>
          {/* Idle and paused: the voice icon, always shown. Listening or speaking: pause on hover or focus. */}
          <svg data-slot="orb-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <Show
              when={voicePhase() === "active" && !resting()}
              fallback={
                <path d="M1.375 6H2.625V10H1.375ZM4.375 4H5.625V12H4.375ZM7.375 2H8.625V14H7.375ZM10.375 4H11.625V12H10.375ZM13.375 6H14.625V10H13.375Z" />
              }
            >
              <path d="M4.5 3H6.5V13H4.5ZM9.5 3H11.5V13H9.5Z" />
            </Show>
          </svg>
        </button>
      </div>
    </>
  )
}

type SpeechResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

function speechRecognition() {
  const scope = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

function audioSession(type: "playback" | "play-and-record") {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
  if (session) session.type = type
}
