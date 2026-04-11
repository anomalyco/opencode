import React, { useEffect, useState, useRef, useCallback, useMemo } from "react"
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  FlatList,
  Modal,
  Alert,
  ActivityIndicator,
  LayoutChangeEvent,
  Linking,
  Platform,
  Switch,
} from "react-native"
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  Easing,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { StatusBar } from "expo-status-bar"
import { SymbolView } from "expo-symbols"
import * as Haptics from "expo-haptics"
import { useAudioPlayer } from "expo-audio"
import { initWhisper, releaseAllWhisper, type WhisperContext } from "whisper.rn"
import { RealtimeTranscriber, type RealtimeTranscribeEvent } from "whisper.rn/src/realtime-transcription"
import { AudioPcmStreamAdapter } from "whisper.rn/src/realtime-transcription/adapters/AudioPcmStreamAdapter"
import { AudioManager } from "react-native-audio-api"
import * as FileSystem from "expo-file-system/legacy"
import { fetch as expoFetch } from "expo/fetch"
import { buildPermissionCardModel } from "@/lib/pending-permissions"
import { unregisterRelayDevice } from "@/lib/relay-client"
import { useMdnsDiscovery } from "@/hooks/use-mdns-discovery"
import {
  useMonitoring,
  type MonitorJob,
  type PermissionDecision,
  type PromptHistoryEntry,
} from "@/hooks/use-monitoring"
import { DEFAULT_RELAY_URL, looksLikeLocalHost, useServerSessions } from "@/hooks/use-server-sessions"
import { ensureNotificationPermissions, getDevicePushToken } from "@/notifications/monitoring-notifications"

const CONTROL_HEIGHT = 86
const SEND_SETTLE_MS = 240
const WAVEFORM_ROWS = 5
const WAVEFORM_CELL_SIZE = 8
const WAVEFORM_CELL_GAP = 2
const READER_ACTION_SIZE = 20
const READER_ACTION_GAP = 14
const READER_ACTION_TRAVEL = READER_ACTION_SIZE + READER_ACTION_GAP
const READER_ACTION_RAIL_WIDTH = READER_ACTION_SIZE * 2 + READER_ACTION_GAP
const AGENT_SUCCESS_GREEN = "#91C29D"

// ---------------------------------------------------------------------------
// Semantic color tokens
// ---------------------------------------------------------------------------
const C = {
  bg: "#121212",
  surface: "#151515",
  surfaceRaised: "#17181B",
  border: "#282828",
  borderSubtle: "#222733",
  borderMuted: "#242424",
  textPrimary: "#F1F1F1",
  textSecondary: "#D6DAE4",
  textTertiary: "#B8BDC9",
  textMuted: "#8F97AA",
  textDimmed: "#6F7686",
  textPlaceholder: "#4A5060",
  blue: "#1D6FF4",
  blueBorder: "#1557C3",
  red: "#FF2E3F",
  redBg: "#421B17",
  green: AGENT_SUCCESS_GREEN,
  orange: "#FFB347",
  yellow: "#D2A542",
} as const

// Unified primary button metrics
const BTN_PRIMARY = {
  minHeight: 52,
  borderRadius: 16,
  borderWidth: 2,
  backgroundColor: C.blue,
  borderColor: C.blueBorder,
} as const
const DROPDOWN_VISIBLE_ROWS = 6
const DROPDOWN_ROW_HEIGHT = 42
const SERVER_MENU_SECTION_HEIGHT = 56
const SERVER_MENU_ENTRY_HEIGHT = 36
const SERVER_MENU_FOOTER_HEIGHT = 28
// If the press duration is shorter than this, treat it as a tap (toggle)
const TAP_THRESHOLD_MS = 300
const SERVER_STATE_FILE = `${FileSystem.documentDirectory}mobile-voice-servers.json`
const WHISPER_SETTINGS_FILE = `${FileSystem.documentDirectory}mobile-voice-whisper-settings.json`
const ONBOARDING_STATE_FILE = `${FileSystem.documentDirectory}mobile-voice-onboarding.json`
const WHISPER_MODELS_DIR = `${FileSystem.documentDirectory}whisper-models`
const WHISPER_REPO = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
const WHISPER_MODELS = [
  "ggml-tiny.en-q5_1.bin",
  "ggml-tiny.en-q8_0.bin",
  "ggml-tiny.en.bin",
  "ggml-tiny-q5_1.bin",
  "ggml-tiny-q8_0.bin",
  "ggml-tiny.bin",
  "ggml-base.en-q5_1.bin",
  "ggml-base.en-q8_0.bin",
  "ggml-base.en.bin",
  "ggml-base-q5_1.bin",
  "ggml-base-q8_0.bin",
  "ggml-base.bin",
  "ggml-small.en-q5_1.bin",
  "ggml-small.en-q8_0.bin",
  "ggml-small.en.bin",
  "ggml-small-q5_1.bin",
  "ggml-small-q8_0.bin",
  "ggml-small.bin",
  "ggml-medium.en-q5_0.bin",
  "ggml-medium.en-q8_0.bin",
  "ggml-medium.en.bin",
  "ggml-medium-q5_0.bin",
  "ggml-medium-q8_0.bin",
  "ggml-medium.bin",
] as const

type WhisperModelID = (typeof WHISPER_MODELS)[number]
type TranscriptionMode = "bulk" | "realtime"
type PermissionPromptState = "idle" | "pending" | "granted" | "denied"
const DEFAULT_WHISPER_MODEL: WhisperModelID = "ggml-small-q8_0.bin"
const DEFAULT_TRANSCRIPTION_MODE: TranscriptionMode = "bulk"

const WHISPER_MODEL_LABELS: Record<WhisperModelID, string> = {
  "ggml-tiny.en-q5_1.bin": "tiny.en q5_1",
  "ggml-tiny.en-q8_0.bin": "tiny.en q8_0",
  "ggml-tiny.en.bin": "tiny.en",
  "ggml-tiny-q5_1.bin": "tiny q5_1",
  "ggml-tiny-q8_0.bin": "tiny q8_0",
  "ggml-tiny.bin": "tiny",
  "ggml-base.en-q5_1.bin": "base.en q5_1",
  "ggml-base.en-q8_0.bin": "base.en q8_0",
  "ggml-base.en.bin": "base.en",
  "ggml-base-q5_1.bin": "base q5_1",
  "ggml-base-q8_0.bin": "base q8_0",
  "ggml-base.bin": "base",
  "ggml-small.en-q5_1.bin": "small.en q5_1",
  "ggml-small.en-q8_0.bin": "small.en q8_0",
  "ggml-small.en.bin": "small.en",
  "ggml-small-q5_1.bin": "small q5_1",
  "ggml-small-q8_0.bin": "small q8_0",
  "ggml-small.bin": "small",
  "ggml-medium.en-q5_0.bin": "medium.en q5_0",
  "ggml-medium.en-q8_0.bin": "medium.en q8_0",
  "ggml-medium.en.bin": "medium.en",
  "ggml-medium-q5_0.bin": "medium q5_0",
  "ggml-medium-q8_0.bin": "medium q8_0",
  "ggml-medium.bin": "medium",
}

const READER_OPEN_SYMBOL = {
  ios: "arrow.up.left.and.arrow.down.right",
  android: "open_in_full",
  web: "open_in_full",
} as const

const READER_CLOSE_SYMBOL = {
  ios: "arrow.down.right.and.arrow.up.left",
  android: "close_fullscreen",
  web: "close_fullscreen",
} as const

const WHISPER_MODEL_SIZES: Record<WhisperModelID, number> = {
  "ggml-tiny.en-q5_1.bin": 32166155,
  "ggml-tiny.en-q8_0.bin": 43550795,
  "ggml-tiny.en.bin": 77704715,
  "ggml-tiny-q5_1.bin": 32152673,
  "ggml-tiny-q8_0.bin": 43537433,
  "ggml-tiny.bin": 77691713,
  "ggml-base.en-q5_1.bin": 59721011,
  "ggml-base.en-q8_0.bin": 81781811,
  "ggml-base.en.bin": 147964211,
  "ggml-base-q5_1.bin": 59707625,
  "ggml-base-q8_0.bin": 81768585,
  "ggml-base.bin": 147951465,
  "ggml-small.en-q5_1.bin": 190098681,
  "ggml-small.en-q8_0.bin": 264477561,
  "ggml-small.en.bin": 487614201,
  "ggml-small-q5_1.bin": 190085487,
  "ggml-small-q8_0.bin": 264464607,
  "ggml-small.bin": 487601967,
  "ggml-medium.en-q5_0.bin": 539225533,
  "ggml-medium.en-q8_0.bin": 823382461,
  "ggml-medium.en.bin": 1533774781,
  "ggml-medium-q5_0.bin": 539212467,
  "ggml-medium-q8_0.bin": 823369779,
  "ggml-medium.bin": 1533763059,
}

type WhisperModelFamily = {
  key: string
  label: string
  description: string
  models: WhisperModelID[]
}

const WHISPER_MODEL_FAMILIES: WhisperModelFamily[] = [
  {
    key: "tiny",
    label: "Tiny",
    description: "Fastest, lowest quality",
    models: [
      "ggml-tiny.en-q5_1.bin",
      "ggml-tiny.en-q8_0.bin",
      "ggml-tiny.en.bin",
      "ggml-tiny-q5_1.bin",
      "ggml-tiny-q8_0.bin",
      "ggml-tiny.bin",
    ],
  },
  {
    key: "base",
    label: "Base",
    description: "Good balance of speed and quality",
    models: [
      "ggml-base.en-q5_1.bin",
      "ggml-base.en-q8_0.bin",
      "ggml-base.en.bin",
      "ggml-base-q5_1.bin",
      "ggml-base-q8_0.bin",
      "ggml-base.bin",
    ],
  },
  {
    key: "small",
    label: "Small",
    description: "Higher quality, moderate size",
    models: [
      "ggml-small.en-q5_1.bin",
      "ggml-small.en-q8_0.bin",
      "ggml-small.en.bin",
      "ggml-small-q5_1.bin",
      "ggml-small-q8_0.bin",
      "ggml-small.bin",
    ],
  },
  {
    key: "medium",
    label: "Medium",
    description: "Best quality, largest download",
    models: [
      "ggml-medium.en-q5_0.bin",
      "ggml-medium.en-q8_0.bin",
      "ggml-medium.en.bin",
      "ggml-medium-q5_0.bin",
      "ggml-medium-q8_0.bin",
      "ggml-medium.bin",
    ],
  },
]

function isWhisperModelID(value: unknown): value is WhisperModelID {
  return typeof value === "string" && (WHISPER_MODELS as readonly string[]).includes(value)
}

function isEnglishOnlyWhisperModel(modelID: WhisperModelID): boolean {
  return modelID.includes(".en")
}

function isTranscriptionMode(value: unknown): value is TranscriptionMode {
  return value === "bulk" || value === "realtime"
}

function formatWhisperModelSize(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(1)} GB`
  }

  return `${Math.round(mib)} MB`
}

function cleanTranscriptText(text: string): string {
  return text.replace(/[ \t]+$/gm, "").trimEnd()
}

function cleanSessionText(text: string): string {
  return cleanTranscriptText(text).trimStart()
}

function normalizeTranscriptSessions(text: string): string {
  const cleaned = cleanTranscriptText(text)
  if (!cleaned) {
    return ""
  }

  return cleaned
    .split(/\n\n+/)
    .map((session) => cleanSessionText(session))
    .filter((session) => session.length > 0)
    .join("\n\n")
}

function mergeTranscriptChunk(previous: string, chunk: string): string {
  const cleanPrevious = cleanTranscriptText(previous)
  const cleanChunk = cleanSessionText(chunk)

  if (!cleanChunk) {
    return cleanPrevious
  }

  if (!cleanPrevious) {
    return cleanChunk
  }

  const normalizedChunk = cleanChunk
  if (!normalizedChunk) {
    return cleanPrevious
  }

  if (/^[,.;:!?)]/.test(normalizedChunk)) {
    return `${cleanPrevious}${normalizedChunk}`
  }

  return `${cleanPrevious} ${normalizedChunk}`
}

function formatSessionUpdated(updatedMs: number): string {
  if (!updatedMs) return ""

  const now = Date.now()
  const deltaMs = Math.max(0, now - updatedMs)
  const deltaMin = Math.floor(deltaMs / 60000)

  if (deltaMin < 60) {
    return `${Math.max(1, deltaMin)} min`
  }

  const date = new Date(updatedMs)
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  } catch {
    return date.toLocaleTimeString()
  }
}

function formatWorkingDirectory(directory?: string): string {
  if (!directory) return "Not available"

  if (directory.startsWith("/Users/")) {
    const segments = directory.split("/")
    if (segments.length >= 4) {
      const tail = segments.slice(3).join("/")
      return tail.length > 0 ? `~/${tail}` : "~"
    }
  }

  return directory
}

type DropdownMode = "none" | "server" | "session"

type Pair = {
  v: 1
  serverID?: string
  relayURL: string
  relaySecret: string
  hosts: string[]
}

type PairHostKind = "tailnet_name" | "tailnet_ip" | "mdns" | "lan" | "loopback" | "public" | "unknown"

type PairHostOption = {
  url: string
  kind: PairHostKind
  label: string
}

type PairHostProbe = {
  status: "checking" | "online" | "offline"
  latencyMs?: number
  note?: string
}

type ReaderHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

type ReaderBlock =
  | {
      type: "text"
      content: string
    }
  | {
      type: "heading"
      level: ReaderHeadingLevel
      content: string
    }
  | {
      type: "code"
      language: string
      content: string
    }

type ReaderInlineSegment =
  | {
      type: "text"
      content: string
    }
  | {
      type: "inline_code"
      content: string
    }
  | {
      type: "italic"
      content: string
    }
  | {
      type: "bold"
      content: string
    }
  | {
      type: "bold_italic"
      content: string
    }

const AUDIO_SESSION_BUSY_MESSAGE = "Microphone is unavailable while another call is active. End the call and try again."

type Scan = {
  data: string
}

type WhisperSavedState = {
  defaultModel: WhisperModelID
  mode: TranscriptionMode
  autoSendOnDictationEnd: boolean
}

type OnboardingSavedState = {
  completed: boolean
}

type Cam = {
  CameraView: (typeof import("expo-camera"))["CameraView"]
  requestCameraPermissionsAsync: () => Promise<{ granted: boolean }>
}

function parsePairShape(data: unknown): Pair | undefined {
  if (!data || typeof data !== "object") return
  if ((data as { v?: unknown }).v !== 1) return
  if (typeof (data as { relayURL?: unknown }).relayURL !== "string") return
  if (typeof (data as { relaySecret?: unknown }).relaySecret !== "string") return
  if (!Array.isArray((data as { hosts?: unknown }).hosts)) return
  const hosts = (data as { hosts: unknown[] }).hosts.filter((item): item is string => typeof item === "string")
  if (!hosts.length) return
  const serverIDRaw = (data as { serverID?: unknown }).serverID
  const serverID = typeof serverIDRaw === "string" && serverIDRaw.length > 0 ? serverIDRaw : undefined
  return {
    v: 1,
    serverID,
    relayURL: (data as { relayURL: string }).relayURL,
    relaySecret: (data as { relaySecret: string }).relaySecret,
    hosts,
  }
}

function parsePair(input: string): Pair | undefined {
  const raw = input.trim()
  if (!raw) return

  const candidates: string[] = [raw]

  try {
    const url = new URL(raw)
    const query = url.searchParams.get("pair") ?? url.searchParams.get("payload")
    if (query) {
      candidates.unshift(query)
    }
  } catch {
    // Raw JSON payload is still supported.
  }

  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)

    try {
      const parsed = JSON.parse(candidate)
      const pair = parsePairShape(parsed)
      if (pair) {
        return pair
      }
    } catch {
      // keep trying fallbacks
    }
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1"
}

function isCarrierGradeNat(hostname: string): boolean {
  const match = /^100\.(\d{1,3})\./.exec(hostname)
  if (!match) return false
  const octet = Number(match[1])
  return octet >= 64 && octet <= 127
}

function classifyPairHost(hostname: string): PairHostKind {
  if (isLoopback(hostname)) return "loopback"
  if (hostname.endsWith(".ts.net")) return "tailnet_name"
  if (isCarrierGradeNat(hostname)) return "tailnet_ip"
  if (hostname.endsWith(".local")) return "mdns"
  if (hostname.startsWith("10.") || hostname.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) {
    return "lan"
  }
  if (hostname.includes(".")) return "public"
  return "unknown"
}

function pairHostKindLabel(kind: PairHostKind): string {
  switch (kind) {
    case "tailnet_name":
      return "Tailscale DNS"
    case "tailnet_ip":
      return "Tailscale IP"
    case "mdns":
      return "mDNS"
    case "lan":
      return "LAN"
    case "loopback":
      return "Loopback"
    case "public":
      return "Public"
    default:
      return "Unknown"
  }
}

function normalizePairHosts(input: string[]): PairHostOption[] {
  const seen = new Set<string>()
  const normalized = input
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      try {
        const parsed = new URL(item)
        const url = `${parsed.protocol}//${parsed.host}`
        if (seen.has(url)) return null
        seen.add(url)
        return {
          url,
          kind: classifyPairHost(parsed.hostname),
          label: parsed.hostname,
        } as PairHostOption
      } catch {
        return null
      }
    })
    .filter((item): item is PairHostOption => !!item)

  const nonLoopback = normalized.filter((item) => item.kind !== "loopback")
  return nonLoopback.length > 0 ? nonLoopback : normalized
}

function pairProbeLabel(probe: PairHostProbe | undefined): string {
  if (!probe || probe.status === "checking") return "Checking..."
  if (probe.status === "online") return `${probe.latencyMs ?? 0} ms`
  return probe.note ?? "Unavailable"
}

function pairProbeSummary(probe: PairHostProbe | undefined): string {
  if (!probe || probe.status === "checking") {
    return "Health check in progress"
  }

  if (probe.status === "online") {
    return `Healthy, reached in ${probe.latencyMs ?? 0} ms`
  }

  return `Health check: ${probe.note ?? "Unavailable"}`
}

function parseReaderBlocks(input: string): ReaderBlock[] {
  const normalized = input.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")

  const blocks: ReaderBlock[] = []
  const prose: string[] = []
  const code: string[] = []
  let fence: "```" | "~~~" | null = null
  let language = ""

  const flushProse = () => {
    const content = prose.join("\n").trim()
    if (content.length > 0) {
      blocks.push({ type: "text", content })
    }
    prose.length = 0
  }

  const flushCode = () => {
    const content = code.join("\n").replace(/\n+$/, "")
    blocks.push({ type: "code", language, content })
    code.length = 0
    language = ""
    fence = null
  }

  for (const line of lines) {
    if (!fence) {
      const match = /^\s*(```|~~~)(.*)$/.exec(line)
      if (match) {
        flushProse()
        fence = match[1] as "```" | "~~~"
        language = match[2]?.trim().split(/\s+/)[0] ?? ""
      } else {
        const headingMatch = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
        if (headingMatch) {
          flushProse()
          blocks.push({
            type: "heading",
            level: headingMatch[1].length as ReaderHeadingLevel,
            content: headingMatch[2].trim(),
          })
        } else {
          prose.push(line)
        }
      }
      continue
    }

    if (line.trimStart().startsWith(fence)) {
      flushCode()
      continue
    }

    code.push(line)
  }

  if (fence) {
    prose.push(`${fence}${language ? language : ""}`)
    prose.push(...code)
  }

  flushProse()

  return blocks
}

function parseReaderAsteriskSegments(input: string): ReaderInlineSegment[] {
  const segments: ReaderInlineSegment[] = []
  let cursor = 0
  let textStart = 0

  while (cursor < input.length) {
    if (input[cursor] !== "*") {
      cursor += 1
      continue
    }

    const marker = input.startsWith("***", cursor) ? "***" : input.startsWith("**", cursor) ? "**" : "*"
    const end = input.indexOf(marker, cursor + marker.length)
    if (end === -1) {
      cursor += 1
      continue
    }

    const content = input.slice(cursor + marker.length, end)
    if (content.trim().length === 0 || content !== content.trim() || content.includes("\n")) {
      cursor += 1
      continue
    }

    if (cursor > textStart) {
      segments.push({ type: "text", content: input.slice(textStart, cursor) })
    }

    segments.push({
      type: marker === "***" ? "bold_italic" : marker === "**" ? "bold" : "italic",
      content,
    })

    cursor = end + marker.length
    textStart = cursor
  }

  if (textStart < input.length) {
    segments.push({ type: "text", content: input.slice(textStart) })
  }

  return segments.length > 0 ? segments : [{ type: "text", content: input }]
}

function parseReaderInlineSegments(input: string): ReaderInlineSegment[] {
  const segments: ReaderInlineSegment[] = []
  const pattern = /(`+|~+)([^`~\n]+?)\1/g
  let cursor = 0

  for (const match of input.matchAll(pattern)) {
    const full = match[0] ?? ""
    const code = match[2] ?? ""
    const start = match.index ?? 0
    const end = start + full.length

    if (start > cursor) {
      segments.push(...parseReaderAsteriskSegments(input.slice(cursor, start)))
    }

    if (code.length > 0) {
      segments.push({ type: "inline_code", content: code })
    }

    cursor = end
  }

  if (cursor < input.length) {
    segments.push(...parseReaderAsteriskSegments(input.slice(cursor)))
  }

  if (segments.length === 0) {
    segments.push({ type: "text", content: input })
  }

  return segments
}

function isAudioSessionBusyError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "")
  return (
    message.includes("InsufficientPriority") ||
    message.includes("561017449") ||
    message.includes("Session activation failed")
  )
}

function normalizeAudioStartErrorMessage(error: unknown): string {
  if (isAudioSessionBusyError(error)) {
    return AUDIO_SESSION_BUSY_MESSAGE
  }

  const raw = error instanceof Error ? error.message.trim() : String(error ?? "").trim()
  if (!raw) {
    return "Unable to activate microphone."
  }

  return raw
}

export default function DictationScreen() {
  const insets = useSafeAreaInsets()
  const [camera, setCamera] = useState<Cam | null>(null)
  const [defaultWhisperModel, setDefaultWhisperModel] = useState<WhisperModelID>(DEFAULT_WHISPER_MODEL)
  const [onboardingReady, setOnboardingReady] = useState(false)
  const [onboardingComplete, setOnboardingComplete] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [microphonePermissionState, setMicrophonePermissionState] = useState<PermissionPromptState>("idle")
  const [notificationPermissionState, setNotificationPermissionState] = useState<PermissionPromptState>("idle")
  const [localNetworkPermissionState, setLocalNetworkPermissionState] = useState<PermissionPromptState>("idle")
  const [activeWhisperModel, setActiveWhisperModel] = useState<WhisperModelID | null>(null)
  const [installedWhisperModels, setInstalledWhisperModels] = useState<WhisperModelID[]>([])
  const [whisperSettingsOpen, setWhisperSettingsOpen] = useState(false)
  const [downloadingModelID, setDownloadingModelID] = useState<WhisperModelID | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [isPreparingWhisperModel, setIsPreparingWhisperModel] = useState(true)
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>(DEFAULT_TRANSCRIPTION_MODE)
  const [autoSendOnDictationEnd, setAutoSendOnDictationEnd] = useState(false)
  const [isTranscribingBulk, setIsTranscribingBulk] = useState(false)
  const [whisperError, setWhisperError] = useState("")
  const [transcribedText, setTranscribedText] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [controlsWidth, setControlsWidth] = useState(0)
  const [hasCompletedSession, setHasCompletedSession] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [agentStateDismissed, setAgentStateDismissed] = useState(false)
  const [readerModeOpen, setReaderModeOpen] = useState(false)
  const [readerModeRendered, setReaderModeRendered] = useState(false)
  const [transcriptionAreaHeight, setTranscriptionAreaHeight] = useState(0)
  const [agentStateCardHeight, setAgentStateCardHeight] = useState(0)
  const [dropdownMode, setDropdownMode] = useState<DropdownMode>("none")
  const [dropdownRenderMode, setDropdownRenderMode] = useState<Exclude<DropdownMode, "none">>("server")
  const [serverMenuListHeight, setServerMenuListHeight] = useState(0)
  const [sessionMenuListHeight, setSessionMenuListHeight] = useState(0)
  const [serverMenuFooterHeight, setServerMenuFooterHeight] = useState(0)
  const [sessionMenuFooterHeight, setSessionMenuFooterHeight] = useState(0)
  const [sessionCreateMode, setSessionCreateMode] = useState<"same" | "root" | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [pairSelectionOpen, setPairSelectionOpen] = useState(false)
  const [pendingPair, setPendingPair] = useState<Pair | null>(null)
  const [pairHostOptions, setPairHostOptions] = useState<PairHostOption[]>([])
  const [selectedPairHostURL, setSelectedPairHostURL] = useState<string | null>(null)
  const [pairHostProbes, setPairHostProbes] = useState<Record<string, PairHostProbe>>({})
  const [isConnectingPairHost, setIsConnectingPairHost] = useState(false)
  const [camGranted, setCamGranted] = useState(false)
  const [waveformLevels, setWaveformLevels] = useState<number[]>(Array.from({ length: 24 }, () => 0))
  const [waveformTick, setWaveformTick] = useState(0)
  const waveformLevelsRef = useRef<number[]>(Array.from({ length: 24 }, () => 0))
  const lastWaveformCommitRef = useRef(0)
  const sendPlayer = useAudioPlayer(require("../../assets/sounds/send-whoosh.mp3"))
  const completePlayer = useAudioPlayer(require("../../assets/sounds/complete.wav"))

  const isRecordingRef = useRef(false)
  const isStartingRef = useRef(false)
  const activeSessionRef = useRef(0)
  const scrollViewRef = useRef<ScrollView>(null)
  const isHoldingRef = useRef(false)
  const pressInTimeRef = useRef(0)
  const accumulatedRef = useRef("")
  const baseTextRef = useRef("")
  const whisperContextRef = useRef<WhisperContext | null>(null)
  const whisperContextModelRef = useRef<WhisperModelID | null>(null)
  const whisperTranscriberRef = useRef<RealtimeTranscriber | null>(null)
  const bulkAudioStreamRef = useRef<AudioPcmStreamAdapter | null>(null)
  const bulkAudioChunksRef = useRef<Uint8Array[]>([])
  const bulkTranscriptionJobRef = useRef(0)
  const downloadProgressRef = useRef(0)
  const autoSendSignatureRef = useRef("")
  const waveformPulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanLockRef = useRef(false)
  const pairProbeRunRef = useRef(0)
  const whisperRestoredRef = useRef(false)
  const promptPagerRef = useRef<FlatList<PromptHistoryEntry | "live">>(null)
  const promptPagerPageRef = useRef(-1)

  const closeDropdown = useCallback(() => {
    setDropdownMode("none")
  }, [])

  const discoveryEnabled = onboardingComplete && localNetworkPermissionState !== "denied" && dropdownMode === "server"

  const {
    servers,
    serversRef,
    activeServerId,
    setActiveServerId,
    activeServerIdRef,
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    restoredRef,
    refreshServerStatusAndSessions,
    refreshAllServerHealth,
    selectServer,
    selectSession,
    removeServer,
    addServer,
    createSession,
    findServerForSession,
  } = useServerSessions()

  const { discoveredServers, discoveryStatus, discoveryError, discoveryAvailable, refreshDiscovery } = useMdnsDiscovery(
    {
      enabled: discoveryEnabled,
    },
  )

  const {
    beginMonitoring,
    activePermissionRequest,
    devicePushToken,
    latestAssistantContext,
    latestPromptText,
    latestAssistantResponse,
    monitorJob,
    monitorStatus,
    pendingPermissionCount,
    promptHistory,
    respondingPermissionID,
    respondToPermission,
    setDevicePushToken,
    setLatestPromptText,
    setPromptHistory,
    setMonitorStatus,
  } = useMonitoring({
    completePlayer,
    closeDropdown,
    findServerForSession,
    refreshServerStatusAndSessions,
    servers,
    serversRef,
    restoredRef,
    activeServerId,
    activeSessionId,
    activeServerIdRef,
    activeSessionIdRef,
    setActiveServerId,
    setActiveSessionId,
    setAgentStateDismissed,
    setNotificationPermissionState,
  })

  useEffect(() => {
    let mounted = true

    void (async () => {
      let complete = false

      try {
        const data = await FileSystem.readAsStringAsync(ONBOARDING_STATE_FILE)
        if (data) {
          const parsed = JSON.parse(data) as Partial<OnboardingSavedState>
          complete = Boolean(parsed.completed)
        }
      } catch {
        // No onboarding state file yet.
      }

      if (!complete) {
        try {
          const [serverInfo, whisperInfo] = await Promise.all([
            FileSystem.getInfoAsync(SERVER_STATE_FILE),
            FileSystem.getInfoAsync(WHISPER_SETTINGS_FILE),
          ])

          if (serverInfo.exists || whisperInfo.exists) {
            complete = true
          }
        } catch {
          // Keep first-install behavior if metadata check fails.
        }

        if (complete) {
          void FileSystem.writeAsStringAsync(ONBOARDING_STATE_FILE, JSON.stringify({ completed: true })).catch(() => {})
        }
      }

      if (mounted) {
        setOnboardingComplete(complete)
        setOnboardingReady(true)
      }
    })()

    return () => {
      mounted = false
    }
  }, [])

  const modelPath = useCallback((modelID: WhisperModelID) => `${WHISPER_MODELS_DIR}/${modelID}`, [])

  const refreshInstalledWhisperModels = useCallback(async () => {
    const next: WhisperModelID[] = []

    for (const modelID of WHISPER_MODELS) {
      try {
        const info = await FileSystem.getInfoAsync(modelPath(modelID))
        if (info.exists) {
          next.push(modelID)
        }
      } catch {
        // Ignore model metadata read errors.
      }
    }

    setInstalledWhisperModels(next)
    return next
  }, [modelPath])

  const stopWaveformPulse = useCallback(() => {
    if (waveformPulseIntervalRef.current) {
      clearInterval(waveformPulseIntervalRef.current)
      waveformPulseIntervalRef.current = null
    }
  }, [])

  const clearWaveform = useCallback(() => {
    const cleared = new Array(waveformLevelsRef.current.length).fill(0)
    waveformLevelsRef.current = cleared
    setWaveformLevels(cleared)
    setWaveformTick(Date.now())
  }, [])

  useEffect(() => {
    return () => {
      if (sendSettleTimeoutRef.current) {
        clearTimeout(sendSettleTimeoutRef.current)
      }
      stopWaveformPulse()
    }
  }, [stopWaveformPulse])

  const ensureAudioInputRoute = useCallback(async () => {
    try {
      const devices = await AudioManager.getDevicesInfo()
      if (devices.currentInputs.length === 0 && devices.availableInputs.length > 0) {
        const pick = devices.availableInputs[0]
        await AudioManager.setInputDevice(pick.id)
      }
    } catch {
      // Input route setup is best-effort.
    }
  }, [])

  const activateAudioSession = useCallback(
    async (trigger: "startup" | "record") => {
      try {
        await AudioManager.setAudioSessionActivity(true)
        return true
      } catch (error) {
        const message = normalizeAudioStartErrorMessage(error)
        if (trigger === "record") {
          setWhisperError(message)
        }

        if (isAudioSessionBusyError(error)) {
          console.warn("[Audio] Session activation deferred:", { trigger, message })
          return false
        }

        console.warn("[Audio] Session activation failed:", { trigger, message })
        return false
      }
    },
    [setWhisperError],
  )

  // Set up audio session and check microphone permissions on mount.
  useEffect(() => {
    void (async () => {
      try {
        AudioManager.setAudioSessionOptions({
          iosCategory: "playAndRecord",
          iosMode: "spokenAudio",
          iosOptions: ["allowBluetoothHFP", "defaultToSpeaker"],
        })

        const sessionReady = await activateAudioSession("startup")

        const permission = await AudioManager.checkRecordingPermissions()
        const granted = permission === "Granted"
        setPermissionGranted(granted)
        setMicrophonePermissionState(granted ? "granted" : permission === "Denied" ? "denied" : "idle")

        if (granted && sessionReady) {
          await ensureAudioInputRoute()
        }
      } catch (e) {
        const message = normalizeAudioStartErrorMessage(e)
        console.warn("[Audio] Setup warning:", message)
      }
    })()
  }, [activateAudioSession, ensureAudioInputRoute])

  const loadWhisperContext = useCallback(
    async (modelID: WhisperModelID) => {
      if (whisperContextRef.current && whisperContextModelRef.current === modelID) {
        setActiveWhisperModel(modelID)
        return whisperContextRef.current
      }

      setIsPreparingWhisperModel(true)
      setWhisperError("")

      try {
        const existing = whisperContextRef.current
        whisperContextRef.current = null
        whisperContextModelRef.current = null
        if (existing) {
          await existing.release().catch(() => {})
        }

        const context = await initWhisper({
          filePath: modelPath(modelID),
          useGpu: Platform.OS === "ios",
        })

        whisperContextRef.current = context
        whisperContextModelRef.current = modelID
        setActiveWhisperModel(modelID)
        return context
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load Whisper model"
        setWhisperError(message)
        throw error
      } finally {
        setIsPreparingWhisperModel(false)
      }
    },
    [modelPath],
  )

  const downloadWhisperModel = useCallback(
    async (modelID: WhisperModelID) => {
      if (downloadingModelID && downloadingModelID !== modelID) {
        return false
      }

      setDownloadingModelID(modelID)
      downloadProgressRef.current = 0
      setDownloadProgress(0)
      setWhisperError("")

      try {
        await FileSystem.makeDirectoryAsync(WHISPER_MODELS_DIR, { intermediates: true }).catch(() => {})

        const targetPath = modelPath(modelID)
        await FileSystem.deleteAsync(targetPath, { idempotent: true }).catch(() => {})

        const download = FileSystem.createDownloadResumable(
          `${WHISPER_REPO}/${modelID}`,
          targetPath,
          {},
          (event: FileSystem.DownloadProgressData) => {
            const total = event.totalBytesExpectedToWrite
            if (!total) return
            const rawProgress = Math.max(0, Math.min(1, event.totalBytesWritten / total))
            const progress = Math.max(downloadProgressRef.current, rawProgress)
            downloadProgressRef.current = progress
            setDownloadProgress(progress)
          },
        )

        const result = await download.downloadAsync()
        if (!result?.uri) {
          throw new Error("Whisper model download did not complete")
        }

        await refreshInstalledWhisperModels()
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to download Whisper model"
        setWhisperError(message)
        return false
      } finally {
        setDownloadingModelID((current) => (current === modelID ? null : current))
      }
    },
    [downloadingModelID, modelPath, refreshInstalledWhisperModels],
  )

  const ensureWhisperModelReady = useCallback(
    async (modelID: WhisperModelID) => {
      const info = await FileSystem.getInfoAsync(modelPath(modelID))
      if (!info.exists) {
        const downloaded = await downloadWhisperModel(modelID)
        if (!downloaded) {
          throw new Error(`Unable to download ${modelID}`)
        }
      }
      return loadWhisperContext(modelID)
    },
    [downloadWhisperModel, loadWhisperContext, modelPath],
  )

  useEffect(() => {
    let mounted = true

    void (async () => {
      await FileSystem.makeDirectoryAsync(WHISPER_MODELS_DIR, { intermediates: true }).catch(() => {})

      let nextDefaultModel: WhisperModelID = DEFAULT_WHISPER_MODEL
      let nextMode: TranscriptionMode = DEFAULT_TRANSCRIPTION_MODE
      let nextAutoSendOnDictationEnd = false
      try {
        const data = await FileSystem.readAsStringAsync(WHISPER_SETTINGS_FILE)
        if (data) {
          const parsed = JSON.parse(data) as Partial<WhisperSavedState>
          if (isWhisperModelID(parsed.defaultModel)) {
            nextDefaultModel = parsed.defaultModel
          }
          if (isTranscriptionMode(parsed.mode)) {
            nextMode = parsed.mode
          }
          if (parsed.autoSendOnDictationEnd === true) {
            nextAutoSendOnDictationEnd = true
          }
        }
      } catch {
        // Use default settings if state file is missing or invalid.
      }

      if (!mounted) return

      whisperRestoredRef.current = true
      setDefaultWhisperModel(nextDefaultModel)
      setTranscriptionMode(nextMode)
      setAutoSendOnDictationEnd(nextAutoSendOnDictationEnd)

      await refreshInstalledWhisperModels()

      try {
        await ensureWhisperModelReady(nextDefaultModel)
      } catch (error) {
        console.error("[Whisper] Failed to initialize default model:", error)
      } finally {
        if (mounted) {
          setIsPreparingWhisperModel(false)
        }
      }
    })()

    return () => {
      mounted = false
    }
  }, [ensureWhisperModelReady, refreshInstalledWhisperModels])

  useEffect(() => {
    if (!whisperRestoredRef.current) return
    const payload: WhisperSavedState = {
      defaultModel: defaultWhisperModel,
      mode: transcriptionMode,
      autoSendOnDictationEnd,
    }
    void FileSystem.writeAsStringAsync(WHISPER_SETTINGS_FILE, JSON.stringify(payload)).catch(() => {})
  }, [autoSendOnDictationEnd, defaultWhisperModel, transcriptionMode])

  useEffect(() => {
    return () => {
      const transcriber = whisperTranscriberRef.current
      whisperTranscriberRef.current = null
      if (transcriber) {
        void (async () => {
          await transcriber.stop().catch(() => {})
          await transcriber.release().catch(() => {})
        })()
      }

      const bulkStream = bulkAudioStreamRef.current
      bulkAudioStreamRef.current = null
      if (bulkStream) {
        void (async () => {
          await bulkStream.stop().catch(() => {})
          await bulkStream.release().catch(() => {})
        })()
      }

      const context = whisperContextRef.current
      whisperContextRef.current = null
      whisperContextModelRef.current = null

      if (context) {
        void context.release().catch(() => {})
      }

      void releaseAllWhisper().catch(() => {})
    }
  }, [])

  const startWaveformPulse = useCallback(() => {
    if (waveformPulseIntervalRef.current) return

    waveformPulseIntervalRef.current = setInterval(() => {
      if (!isRecordingRef.current) return

      const next = waveformLevelsRef.current.map((value) => {
        const decay = value * 0.45
        const lift = Math.random() * 0.95
        return Math.max(0.08, Math.min(1, decay + lift * 0.55))
      })

      waveformLevelsRef.current = next

      const now = Date.now()
      if (now - lastWaveformCommitRef.current > 45) {
        setWaveformLevels(next)
        setWaveformTick(now)
        lastWaveformCommitRef.current = now
      }
    }, 70)
  }, [])

  const finalizeRecordingState = useCallback(() => {
    isRecordingRef.current = false
    activeSessionRef.current = 0
    isStartingRef.current = false
    setIsRecording(false)
    stopWaveformPulse()
    clearWaveform()
  }, [clearWaveform, stopWaveformPulse])

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isStartingRef.current || downloadingModelID || isTranscribingBulk) return

    isStartingRef.current = true
    const sessionID = Date.now()
    activeSessionRef.current = sessionID
    accumulatedRef.current = ""
    baseTextRef.current = normalizeTranscriptSessions(transcribedText)
    if (baseTextRef.current !== transcribedText) {
      setTranscribedText(baseTextRef.current)
    }
    isRecordingRef.current = true
    setIsRecording(true)
    setWhisperError("")

    const cancelled = () => !isRecordingRef.current || activeSessionRef.current !== sessionID

    try {
      const permission = await AudioManager.checkRecordingPermissions()
      const granted = permission === "Granted"
      setPermissionGranted(granted)
      setMicrophonePermissionState(granted ? "granted" : permission === "Denied" ? "denied" : "idle")

      if (!granted) {
        setWhisperError("Microphone permission is required to record.")
        finalizeRecordingState()
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
        return
      }

      const sessionReady = await activateAudioSession("record")
      if (!sessionReady) {
        finalizeRecordingState()
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
        return
      }

      await ensureAudioInputRoute()

      const context = await ensureWhisperModelReady(defaultWhisperModel)
      if (cancelled()) {
        isStartingRef.current = false
        return
      }

      const previousTranscriber = whisperTranscriberRef.current
      whisperTranscriberRef.current = null
      if (previousTranscriber) {
        await previousTranscriber.stop().catch(() => {})
        await previousTranscriber.release().catch(() => {})
      }

      const previousBulkStream = bulkAudioStreamRef.current
      bulkAudioStreamRef.current = null
      if (previousBulkStream) {
        await previousBulkStream.stop().catch(() => {})
        await previousBulkStream.release().catch(() => {})
      }

      bulkAudioChunksRef.current = []
      bulkTranscriptionJobRef.current = 0

      startWaveformPulse()

      const englishOnlyModel = isEnglishOnlyWhisperModel(defaultWhisperModel)

      if (transcriptionMode === "bulk") {
        const audioStream = new AudioPcmStreamAdapter()
        audioStream.onData((packet: unknown) => {
          if (activeSessionRef.current !== sessionID) return
          const data = (packet as { data?: unknown }).data
          if (!(data instanceof Uint8Array) || data.length === 0) return
          bulkAudioChunksRef.current.push(new Uint8Array(data))
        })
        audioStream.onError((error: string) => {
          if (activeSessionRef.current !== sessionID) return
          setWhisperError(error)
          console.error("[Dictation] Bulk audio stream error:", error)
        })

        await audioStream.initialize({
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
          bufferSize: 16 * 1024,
          audioSource: 6,
        })
        await audioStream.start()

        bulkAudioStreamRef.current = audioStream

        if (cancelled()) {
          await audioStream.stop().catch(() => {})
          await audioStream.release().catch(() => {})
          if (bulkAudioStreamRef.current === audioStream) {
            bulkAudioStreamRef.current = null
          }
          finalizeRecordingState()
          return
        }

        isStartingRef.current = false
        return
      }

      const transcriber = new RealtimeTranscriber(
        {
          whisperContext: context,
          audioStream: new AudioPcmStreamAdapter(),
        },
        {
          audioSliceSec: 4,
          audioMinSec: 0.8,
          maxSlicesInMemory: 6,
          transcribeOptions: {
            language: englishOnlyModel ? "en" : "auto",
            translate: !englishOnlyModel,
            maxLen: 1,
          },
          logger: () => {},
        },
        {
          onTranscribe: (event: RealtimeTranscribeEvent) => {
            if (activeSessionRef.current !== sessionID) return
            if (event.type !== "transcribe") return

            const nextSessionText = mergeTranscriptChunk(accumulatedRef.current, event.data?.result ?? "")
            accumulatedRef.current = nextSessionText

            const base = normalizeTranscriptSessions(baseTextRef.current)
            const separator = base.length > 0 && nextSessionText.length > 0 ? "\n\n" : ""
            setTranscribedText(normalizeTranscriptSessions(base + separator + nextSessionText))

            if (nextSessionText.length > 0) {
              setHasCompletedSession(true)
            }
          },
          onError: (error: string) => {
            if (activeSessionRef.current !== sessionID) return
            console.error("[Dictation] Whisper realtime error:", error)
            setWhisperError(error)
          },
          onStatusChange: (active: boolean) => {
            if (activeSessionRef.current !== sessionID) return
            if (!active) {
              if (whisperTranscriberRef.current === transcriber) {
                whisperTranscriberRef.current = null
              }
              finalizeRecordingState()
            }
          },
        },
      )

      whisperTranscriberRef.current = transcriber
      await transcriber.start()

      if (cancelled()) {
        await transcriber.stop().catch(() => {})
        await transcriber.release().catch(() => {})
        if (whisperTranscriberRef.current === transcriber) {
          whisperTranscriberRef.current = null
        }
        finalizeRecordingState()
        return
      }

      isStartingRef.current = false
    } catch (error) {
      const busy = isAudioSessionBusyError(error)
      const message = normalizeAudioStartErrorMessage(error)
      setWhisperError(message)

      if (busy) {
        console.warn("[Dictation] Recording blocked while call is active")
      } else {
        console.error("[Dictation] Failed to start realtime transcription:", error)
      }

      const activeTranscriber = whisperTranscriberRef.current
      whisperTranscriberRef.current = null
      if (activeTranscriber) {
        void (async () => {
          await activeTranscriber.stop().catch(() => {})
          await activeTranscriber.release().catch(() => {})
        })()
      }

      finalizeRecordingState()
      void Haptics.notificationAsync(
        busy ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
      ).catch(() => {})
    }
  }, [
    defaultWhisperModel,
    downloadingModelID,
    ensureWhisperModelReady,
    finalizeRecordingState,
    isTranscribingBulk,
    activateAudioSession,
    ensureAudioInputRoute,
    startWaveformPulse,
    transcriptionMode,
    transcribedText,
  ])

  const stopRecording = useCallback(() => {
    if (!isRecordingRef.current && !isStartingRef.current) return

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

    const baseAtStop = normalizeTranscriptSessions(baseTextRef.current)
    const englishOnlyModel = isEnglishOnlyWhisperModel(defaultWhisperModel)

    const transcriber = whisperTranscriberRef.current
    whisperTranscriberRef.current = null
    if (transcriber) {
      void (async () => {
        await transcriber.stop().catch((error: unknown) => {
          console.warn("[Dictation] Failed to stop realtime transcription:", error)
        })
        await transcriber.release().catch(() => {})
      })()
    }

    const bulkStream = bulkAudioStreamRef.current
    bulkAudioStreamRef.current = null
    const bulkChunks = bulkAudioChunksRef.current
    bulkAudioChunksRef.current = []

    finalizeRecordingState()

    if (transcriptionMode !== "bulk") {
      return
    }

    const runID = Date.now()
    bulkTranscriptionJobRef.current = runID

    void (async () => {
      if (bulkStream) {
        await bulkStream.stop().catch((error: unknown) => {
          console.warn("[Dictation] Failed to stop bulk audio stream:", error)
        })
        await bulkStream.release().catch(() => {})
      }

      if (bulkChunks.length === 0) {
        return
      }

      const totalLength = bulkChunks.reduce((sum, chunk) => sum + chunk.length, 0)
      if (totalLength === 0) {
        return
      }

      const merged = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of bulkChunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const context = whisperContextRef.current
      if (!context) {
        setWhisperError("Whisper model is not loaded")
        return
      }

      setIsTranscribingBulk(true)

      try {
        const { promise } = context.transcribeData(merged.buffer, {
          language: englishOnlyModel ? "en" : "auto",
          translate: !englishOnlyModel,
          maxLen: 1,
        })

        const result = await promise
        if (bulkTranscriptionJobRef.current !== runID) {
          return
        }

        const sessionText = cleanSessionText(result.result ?? "")
        if (!sessionText) {
          return
        }

        const separator = baseAtStop.length > 0 ? "\n\n" : ""
        setTranscribedText(normalizeTranscriptSessions(baseAtStop + separator + sessionText))
        setHasCompletedSession(true)
      } catch (error) {
        if (bulkTranscriptionJobRef.current !== runID) {
          return
        }
        const message = error instanceof Error ? error.message : "Bulk transcription failed"
        setWhisperError(message)
        console.error("[Dictation] Bulk transcription failed:", error)
      } finally {
        if (bulkTranscriptionJobRef.current === runID) {
          setIsTranscribingBulk(false)
        }
      }
    })()
  }, [defaultWhisperModel, finalizeRecordingState, transcriptionMode])

  const clearIconRotation = useSharedValue(0)
  const sendOutProgress = useSharedValue(0)

  const handleClearTranscript = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {})

    clearIconRotation.value = withSequence(
      withTiming(-30, { duration: 90 }),
      withTiming(30, { duration: 120 }),
      withTiming(0, { duration: 90 }),
    )

    if (isRecordingRef.current) {
      stopRecording()
    }
    accumulatedRef.current = ""
    baseTextRef.current = ""
    setTranscribedText("")
    setHasCompletedSession(false)
    clearWaveform()
    sendOutProgress.value = 0
    setIsSending(false)
  }, [clearIconRotation, clearWaveform, sendOutProgress, stopRecording])

  const handleHideAgentState = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {})
    setReaderModeOpen(false)
    setAgentStateDismissed(true)
  }, [])

  const handleOpenReaderMode = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {})
    setReaderModeRendered(true)
    setReaderModeOpen(true)
  }, [])

  const handleCloseReaderMode = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {})
    setReaderModeOpen(false)
  }, [])

  const handlePermissionDecision = useCallback(
    (reply: PermissionDecision) => {
      if (!activePermissionRequest || !activeServerId) return

      void Haptics.selectionAsync().catch(() => {})
      void respondToPermission({
        serverID: activeServerId,
        sessionID: activePermissionRequest.sessionID,
        requestID: activePermissionRequest.id,
        reply,
      }).catch((error) => {
        Alert.alert(
          "Could not send decision",
          error instanceof Error ? error.message : "OpenCode did not accept that decision.",
        )
      })
    },
    [activePermissionRequest, activeServerId, respondToPermission],
  )

  const resetTranscriptState = useCallback(() => {
    if (isRecordingRef.current) {
      stopRecording()
    }
    accumulatedRef.current = ""
    baseTextRef.current = ""
    setTranscribedText("")
    setHasCompletedSession(false)
    clearWaveform()
  }, [clearWaveform, stopRecording])

  const handleOpenWhisperSettings = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {})
    setDropdownMode("none")
    setWhisperSettingsOpen(true)
  }, [])

  const handleDownloadWhisperModel = useCallback(
    async (modelID: WhisperModelID) => {
      const ok = await downloadWhisperModel(modelID)
      if (ok) {
        void Haptics.selectionAsync().catch(() => {})
      }
    },
    [downloadWhisperModel],
  )

  const handleSelectWhisperModel = useCallback(
    async (modelID: WhisperModelID) => {
      if (isRecordingRef.current || isStartingRef.current) {
        stopRecording()
      }

      try {
        await ensureWhisperModelReady(modelID)
        setDefaultWhisperModel(modelID)
        setWhisperError("")
        void Haptics.selectionAsync().catch(() => {})
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to switch Whisper model"
        setWhisperError(message)
      }
    },
    [ensureWhisperModelReady, stopRecording],
  )

  const handleDeleteWhisperModel = useCallback(
    async (modelID: WhisperModelID) => {
      if (downloadingModelID === modelID) return

      if (isRecordingRef.current || isStartingRef.current) {
        stopRecording()
      }

      if (whisperContextModelRef.current === modelID && whisperContextRef.current) {
        const activeContext = whisperContextRef.current
        whisperContextRef.current = null
        whisperContextModelRef.current = null
        setActiveWhisperModel(null)
        await activeContext.release().catch(() => {})
      }

      await FileSystem.deleteAsync(modelPath(modelID), { idempotent: true }).catch(() => {})
      const nextInstalled = await refreshInstalledWhisperModels()

      if (defaultWhisperModel === modelID) {
        const fallbackModel = nextInstalled[0] ?? DEFAULT_WHISPER_MODEL
        setDefaultWhisperModel(fallbackModel)
        try {
          await ensureWhisperModelReady(fallbackModel)
        } catch {
          // Keep UI responsive if fallback init fails.
        }
      } else if (activeWhisperModel == null && nextInstalled.includes(defaultWhisperModel)) {
        try {
          await ensureWhisperModelReady(defaultWhisperModel)
        } catch {
          // Keep UI responsive if default model init fails.
        }
      }

      void Haptics.selectionAsync().catch(() => {})
    },
    [
      activeWhisperModel,
      defaultWhisperModel,
      downloadingModelID,
      ensureWhisperModelReady,
      modelPath,
      refreshInstalledWhisperModels,
      stopRecording,
    ],
  )

  const handleRequestNotificationPermission = useCallback(async () => {
    if (notificationPermissionState === "pending") return

    setNotificationPermissionState("pending")

    try {
      const granted = await ensureNotificationPermissions()
      setNotificationPermissionState(granted ? "granted" : "denied")

      if (!granted) {
        return
      }

      const token = await getDevicePushToken()
      if (token) {
        setDevicePushToken(token)
      }
    } catch {
      setNotificationPermissionState("denied")
    }
  }, [notificationPermissionState, setDevicePushToken])

  const handleRequestMicrophonePermission = useCallback(async () => {
    if (microphonePermissionState === "pending") return

    setMicrophonePermissionState("pending")

    try {
      const permission = await AudioManager.requestRecordingPermissions()
      const granted = permission === "Granted"
      setPermissionGranted(granted)
      setMicrophonePermissionState(granted ? "granted" : "denied")

      if (granted) {
        await ensureAudioInputRoute()
      }
    } catch {
      setPermissionGranted(false)
      setMicrophonePermissionState("denied")
    }
  }, [ensureAudioInputRoute, microphonePermissionState])

  const handleRequestLocalNetworkPermission = useCallback(async () => {
    if (localNetworkPermissionState === "pending") return

    setLocalNetworkPermissionState("pending")

    const localProbes = new Set<string>([
      "http://192.168.1.1",
      "http://192.168.0.1",
      "http://10.0.0.1",
      "http://100.100.100.100",
    ])

    for (const server of serversRef.current) {
      try {
        const url = new URL(server.url)
        if (looksLikeLocalHost(url.hostname)) {
          localProbes.add(`${url.protocol}//${url.host}`)
        }
      } catch {
        // Skip malformed saved server URL.
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, 1800)

    try {
      await Promise.allSettled(
        [...localProbes].map((base) =>
          expoFetch(`${base.replace(/\/+$/, "")}/health`, {
            method: "GET",
            signal: controller.signal,
          }),
        ),
      )
      setLocalNetworkPermissionState("granted")
    } catch {
      setLocalNetworkPermissionState("denied")
    } finally {
      clearTimeout(timeout)
    }
  }, [localNetworkPermissionState, serversRef])

  const completeSend = useCallback(() => {
    if (sendSettleTimeoutRef.current) {
      clearTimeout(sendSettleTimeoutRef.current)
    }

    sendSettleTimeoutRef.current = setTimeout(() => {
      resetTranscriptState()
      sendOutProgress.value = 0
      setIsSending(false)
      sendSettleTimeoutRef.current = null
    }, SEND_SETTLE_MS)
  }, [resetTranscriptState, sendOutProgress])

  const handleSendTranscript = useCallback(async () => {
    const text = transcribedText.trim()
    if (text.length === 0 || isSending || !activeServerId || !activeSessionId) return

    const server = serversRef.current.find((item) => item.id === activeServerId)
    if (!server) return

    const session = server.sessions.find((item) => item.id === activeSessionId)
    if (!session) return

    const base = server.url.replace(/\/+$/, "")

    setIsSending(true)
    setMonitorStatus("Sending prompt…")

    try {
      const response = await fetch(`${base}/session/${session.id}/prompt_async`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parts: [
            {
              type: "text",
              text,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error(`Prompt request failed (${response.status})`)
      }

      setLatestPromptText(text)

      const nextJob: MonitorJob = {
        id: `job-${Date.now()}`,
        sessionID: session.id,
        opencodeBaseURL: base,
        startedAt: Date.now(),
      }

      await beginMonitoring(nextJob)

      if (server.relaySecret.trim().length === 0) {
        setMonitorStatus("Monitoring (foreground only)")
      }

      void sendPlayer.seekTo(0)
      void sendPlayer.play()

      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {})
      setTimeout(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      }, 70)

      sendOutProgress.value = withTiming(
        1,
        {
          duration: 320,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        },
        (finished) => {
          if (finished) {
            runOnJS(completeSend)()
          }
        },
      )

      // Safety timeout: if the Reanimated animation callback never fires (e.g. app
      // backgrounded during the 320ms animation), force-reset isSending so the user
      // isn't permanently blocked from sending new prompts.
      setTimeout(() => {
        completeSend()
      }, 5_000)
    } catch {
      setMonitorStatus("Failed to send prompt")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      setIsSending(false)
      sendOutProgress.value = 0
    }
  }, [
    activeServerId,
    activeSessionId,
    beginMonitoring,
    completeSend,
    isSending,
    serversRef,
    setMonitorStatus,
    setLatestPromptText,
    sendOutProgress,
    sendPlayer,
    transcribedText,
  ])

  // --- Gesture handling: tap vs hold ---

  const handlePressIn = useCallback(() => {
    pressInTimeRef.current = Date.now()

    if (isRecordingRef.current) return

    setDropdownMode("none")
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    isHoldingRef.current = true
    // Snap pager to live page (index 0) so user sees their transcription
    if (promptPagerRef.current) {
      try {
        promptPagerRef.current.scrollToIndex({ index: 0, animated: true })
      } catch {
        // FlatList may not have items yet
      }
    }
    void startRecording()
  }, [startRecording])

  const handlePressOut = useCallback(() => {
    const pressDuration = Date.now() - pressInTimeRef.current

    if (pressDuration < TAP_THRESHOLD_MS) {
      if (isHoldingRef.current) {
        // Tap started recording on pressIn -- keep it running (toggle ON)
        isHoldingRef.current = false
      } else {
        // Already recording from a previous tap -- this tap stops it
        stopRecording()
      }
    } else {
      // Long press = hold-to-record, stop on release
      isHoldingRef.current = false
      stopRecording()
    }
  }, [stopRecording])

  const modelDownloading = downloadingModelID !== null
  const modelLoading = isPreparingWhisperModel || activeWhisperModel == null || modelDownloading || isTranscribingBulk
  const dictationSettingsLocked = isRecording || isTranscribingBulk || isSending
  let modelLoadingState: "downloading" | "loading" | "ready" = "ready"
  if (modelDownloading) {
    modelLoadingState = "downloading"
  } else if (modelLoading) {
    modelLoadingState = "loading"
  }
  const pct = Math.round(Math.max(0, Math.min(1, downloadProgress)) * 100)
  const loadingModelLabel = downloadingModelID
    ? WHISPER_MODEL_LABELS[downloadingModelID]
    : WHISPER_MODEL_LABELS[defaultWhisperModel]
  const hasTranscript = transcribedText.trim().length > 0
  const hasAssistantResponse = latestAssistantResponse.trim().length > 0
  const readerBlocks = useMemo(() => parseReaderBlocks(latestAssistantResponse), [latestAssistantResponse])
  const activePermissionCard = activePermissionRequest ? buildPermissionCardModel(activePermissionRequest) : null
  const hasPendingPermission = activePermissionRequest !== null && activePermissionCard !== null
  const readerModeEnabled = readerModeOpen && hasAssistantResponse && !hasPendingPermission
  const readerModeVisible = readerModeEnabled || readerModeRendered
  const fallbackAgentStateCardHeight = transcriptionAreaHeight > 0 ? Math.max(0, (transcriptionAreaHeight - 8) / 2) : 0
  const collapsedReaderHeight = agentStateCardHeight > 0 ? agentStateCardHeight : fallbackAgentStateCardHeight
  const expandedReaderHeight = Math.max(collapsedReaderHeight, transcriptionAreaHeight)
  const hasAgentActivity = hasAssistantResponse || monitorStatus.trim().length > 0 || monitorJob !== null
  const shouldShowAgentStateCard = !hasPendingPermission && hasAgentActivity && !agentStateDismissed
  const showsCompleteState = monitorStatus.toLowerCase().includes("complete")
  let agentStateIcon: "loading" | "done" = "loading"
  if (monitorJob === null && (hasAssistantResponse || showsCompleteState)) {
    agentStateIcon = "done"
  }
  const agentStateText = hasAssistantResponse ? latestAssistantResponse : "Waiting for agent…"
  const agentStateBlocks = useMemo(() => parseReaderBlocks(agentStateText), [agentStateText])
  const shouldShowSend = hasCompletedSession && hasTranscript && !hasPendingPermission
  const activeServer = servers.find((s) => s.id === activeServerId) ?? null
  const discoveredServerOptions = useMemo(() => {
    const saved = new Set(servers.map((server) => server.url.replace(/\/+$/, "")))
    return discoveredServers.filter((server) => !saved.has(server.url.replace(/\/+$/, "")))
  }, [discoveredServers, servers])
  const discoveredServerEmptyLabel =
    discoveryStatus === "error"
      ? "Unable to discover local servers"
      : discoveryStatus === "scanning"
        ? "Scanning local network..."
        : "No local servers found"
  const activeSession = activeServer?.sessions.find((s) => s.id === activeSessionId) ?? null
  let currentSessionModelLabel = "Not available"
  if (latestAssistantContext?.modelID) {
    currentSessionModelLabel = latestAssistantContext.modelID
    if (latestAssistantContext.providerID) {
      currentSessionModelLabel = `${latestAssistantContext.providerID}/${latestAssistantContext.modelID}`
    }
  }
  const currentSessionDirectory = latestAssistantContext?.workingDirectory ?? activeSession?.directory
  const currentSessionUpdated = activeSession ? formatSessionUpdated(activeSession.updated) : ""
  const sessionList = activeSession
    ? (activeServer?.sessions ?? []).filter((session) => session.id !== activeSession.id)
    : (activeServer?.sessions ?? [])
  const canSendToSession = !!activeServer && activeServer.status === "online" && !!activeSession
  const isReplyingToActivePermission =
    activePermissionRequest !== null && respondingPermissionID === activePermissionRequest.id
  const displayedTranscript = isSending ? "" : transcribedText
  const [transcriptionPanelWidth, setTranscriptionPanelWidth] = useState(0)
  const handleTranscriptionPanelLayout = useCallback((e: LayoutChangeEvent) => {
    setTranscriptionPanelWidth(e.nativeEvent.layout.width)
  }, [])
  const pagerPageWidth = transcriptionPanelWidth || 1

  // Prompt history pager: "live" at index 0 (leftmost), then history newest-first to the right.
  // Swipe right-to-left to browse older prompts, swipe left-to-right to return to live.
  const promptPagerData = useMemo<(PromptHistoryEntry | "live")[]>(
    () => (promptHistory.length > 0 ? ["live" as const, ...[...promptHistory].reverse()] : []),
    [promptHistory],
  )
  const promptPagerKeyExtractor = useCallback(
    (item: PromptHistoryEntry | "live") => (item === "live" ? "live" : item.userMessageID),
    [],
  )
  const handlePromptPagerSnap = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const pageIndex = Math.round(e.nativeEvent.contentOffset.x / pagerPageWidth)
      if (pageIndex !== promptPagerPageRef.current) {
        promptPagerPageRef.current = pageIndex
        void Haptics.selectionAsync().catch(() => {})
      }
    },
    [pagerPageWidth],
  )
  const isDropdownOpen = dropdownMode !== "none"
  const effectiveDropdownMode = isDropdownOpen ? dropdownMode : dropdownRenderMode
  const isCreatingSession = sessionCreateMode !== null
  const showSessionCreationChoices =
    effectiveDropdownMode === "session" && !!activeServer && activeServer.status === "online"
  const sessionCreationChoiceCount = showSessionCreationChoices ? (activeSession ? 2 : 1) : 0
  const recommendedPairHostURL = useMemo(() => {
    const online = pairHostOptions
      .map((item) => ({ item, probe: pairHostProbes[item.url] }))
      .filter((entry) => entry.probe?.status === "online")
      .sort(
        (a, b) => (a.probe?.latencyMs ?? Number.POSITIVE_INFINITY) - (b.probe?.latencyMs ?? Number.POSITIVE_INFINITY),
      )

    if (online[0]) {
      return online[0].item.url
    }

    return pairHostOptions[0]?.url ?? null
  }, [pairHostOptions, pairHostProbes])
  const headerTitle = activeServer?.name ?? "No server configured"
  let headerDotStyle = styles.serverStatusOffline
  if (activeServer?.status === "online") {
    headerDotStyle = styles.serverStatusActive
  } else if (activeServer?.status === "checking") {
    headerDotStyle = styles.serverStatusChecking
  }

  const recordingProgress = useSharedValue(0)
  const sendVisibility = useSharedValue(hasTranscript ? 1 : 0)
  const waveformVisibility = useSharedValue(0)
  const serverMenuProgress = useSharedValue(0)
  const readerExpandProgress = useSharedValue(0)

  useEffect(() => {
    recordingProgress.value = withSpring(isRecording ? 1 : 0, {
      damping: 14,
      stiffness: 140,
      mass: 0.8,
    })
  }, [isRecording, recordingProgress])

  useEffect(() => {
    const isGenerating = isRecording
    waveformVisibility.value = withTiming(isGenerating ? 1 : 0, {
      duration: isGenerating ? 180 : 240,
      easing: Easing.inOut(Easing.quad),
    })
  }, [isRecording, waveformVisibility])

  useEffect(() => {
    serverMenuProgress.value = withTiming(isDropdownOpen ? 1 : 0, {
      duration: isDropdownOpen ? 240 : 240,
      easing: isDropdownOpen ? Easing.bezier(0.2, 0.8, 0.2, 1) : Easing.bezier(0.4, 0, 0.2, 1),
    })
  }, [isDropdownOpen, serverMenuProgress])

  useEffect(() => {
    if (readerModeEnabled) {
      readerExpandProgress.value = withTiming(1, {
        duration: 320,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      })
      return
    }

    if (!readerModeRendered) {
      readerExpandProgress.value = 0
      return
    }

    readerExpandProgress.value = withTiming(
      0,
      {
        duration: 240,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      },
      (finished) => {
        if (finished) {
          runOnJS(setReaderModeRendered)(false)
        }
      },
    )
  }, [readerExpandProgress, readerModeEnabled, readerModeRendered])

  useEffect(() => {
    if (dropdownMode !== "none") {
      setDropdownRenderMode(dropdownMode)
    }
  }, [dropdownMode])

  useEffect(() => {
    sendVisibility.value = shouldShowSend
      ? withTiming(1, {
          duration: 320,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        })
      : withTiming(0, {
          duration: 360,
          easing: Easing.bezier(0.22, 0.61, 0.36, 1),
        })
  }, [shouldShowSend, sendVisibility])

  useEffect(() => {
    const text = transcribedText.trim()
    if (!hasCompletedSession || text.length === 0) {
      autoSendSignatureRef.current = ""
      return
    }

    if (
      !autoSendOnDictationEnd ||
      isRecording ||
      isTranscribingBulk ||
      isSending ||
      hasPendingPermission ||
      !activeServerId ||
      !activeSessionId
    ) {
      return
    }

    const signature = `${activeServerId}:${activeSessionId}:${transcriptionMode}:${text}`
    if (autoSendSignatureRef.current === signature) {
      return
    }

    autoSendSignatureRef.current = signature
    void handleSendTranscript()
  }, [
    activeServerId,
    activeSessionId,
    autoSendOnDictationEnd,
    handleSendTranscript,
    hasCompletedSession,
    hasPendingPermission,
    isRecording,
    isSending,
    isTranscribingBulk,
    transcriptionMode,
    transcribedText,
  ])

  // Parent clips outer half of center-stroke, so only inner half is visible.
  // borderWidth 6 → 3px visible inward, borderWidth 12 → 6px visible inward.
  const animatedBorderStyle = useAnimatedStyle(() => {
    const progress = recordingProgress.value
    // Width: 3 → ~1.5px visible inward at rest (matches other cards),
    // 12 → ~6px visible inward when active
    const bw = interpolate(progress, [0, 1], [3, 12], Extrapolation.CLAMP)
    return {
      borderWidth: bw,
      borderColor: "#FF2E3F",
    }
  })

  const animatedDotStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(recordingProgress.value, [0, 1], [19, 2], Extrapolation.CLAMP),
  }))

  const animatedClearIconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${clearIconRotation.value}deg` }],
  }))

  const animatedSendStyle = useAnimatedStyle(() => ({
    width: interpolate(sendVisibility.value, [0, 1], [0, Math.max((controlsWidth - 8) / 2, 0)], Extrapolation.CLAMP),
    marginLeft: interpolate(sendVisibility.value, [0, 1], [0, 8], Extrapolation.CLAMP),
    opacity: sendVisibility.value,
    transform: [
      {
        translateX: interpolate(sendVisibility.value, [0, 1], [14, 0], Extrapolation.CLAMP),
      },
      {
        scale: interpolate(sendVisibility.value, [0, 1], [0.98, 1], Extrapolation.CLAMP),
      },
    ],
  }))

  const animatedTranscriptSendStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sendOutProgress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(sendOutProgress.value, [0, 1], [0, -44], Extrapolation.CLAMP),
      },
    ],
  }))

  const animatedWaveformRowStyle = useAnimatedStyle(() => ({
    opacity: waveformVisibility.value,
    transform: [
      {
        translateY: interpolate(waveformVisibility.value, [0, 1], [6, 0], Extrapolation.CLAMP),
      },
    ],
  }))

  // Inverse of waveform: visible when waveform is hidden, fades out when waveform appears
  const animatedSwipeHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(waveformVisibility.value, [0, 1], [1, 0], Extrapolation.CLAMP),
  }))

  const maxDropdownListHeight = DROPDOWN_VISIBLE_ROWS * DROPDOWN_ROW_HEIGHT
  const serverMenuEntries = Math.max(servers.length, 1) + Math.max(discoveredServerOptions.length, 1)
  const estimatedServerMenuRowsHeight = Math.min(
    SERVER_MENU_SECTION_HEIGHT + serverMenuEntries * SERVER_MENU_ENTRY_HEIGHT,
    maxDropdownListHeight,
  )
  const sessionMenuRows = Math.max(activeServer?.sessions.length ?? 0, 1)
  const estimatedSessionMenuRowsHeight = Math.min(sessionMenuRows, DROPDOWN_VISIBLE_ROWS) * DROPDOWN_ROW_HEIGHT
  const serverMenuRowsHeight = Math.min(serverMenuListHeight || estimatedServerMenuRowsHeight, maxDropdownListHeight)
  const sessionMenuRowsHeight = Math.min(sessionMenuListHeight || estimatedSessionMenuRowsHeight, maxDropdownListHeight)
  const expandedRowsHeight = effectiveDropdownMode === "server" ? serverMenuRowsHeight : sessionMenuRowsHeight

  const estimatedSessionFooterHeight = sessionCreationChoiceCount === 2 ? 72 : sessionCreationChoiceCount === 1 ? 38 : 8

  const measuredServerFooterHeight = serverMenuFooterHeight || SERVER_MENU_FOOTER_HEIGHT
  const measuredSessionFooterHeight = sessionMenuFooterHeight || estimatedSessionFooterHeight

  const dropdownFooterExtraHeight =
    effectiveDropdownMode === "server"
      ? measuredServerFooterHeight
      : showSessionCreationChoices
        ? measuredSessionFooterHeight
        : 8
  const expandedHeaderHeight = 51 + 12 + expandedRowsHeight + dropdownFooterExtraHeight

  const animatedHeaderStyle = useAnimatedStyle(() => ({
    height: interpolate(serverMenuProgress.value, [0, 1], [51, expandedHeaderHeight], Extrapolation.CLAMP),
  }))

  const animatedServerMenuStyle = useAnimatedStyle(() => ({
    opacity: serverMenuProgress.value,
    transform: [
      {
        translateY: interpolate(serverMenuProgress.value, [0, 1], [-8, 0], Extrapolation.CLAMP),
      },
    ],
  }))

  const animatedHeaderShadowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(serverMenuProgress.value, [0, 1], [0, 0.35], Extrapolation.CLAMP),
    shadowRadius: interpolate(serverMenuProgress.value, [0, 1], [0, 18], Extrapolation.CLAMP),
    elevation: interpolate(serverMenuProgress.value, [0, 1], [0, 16], Extrapolation.CLAMP),
  }))

  const animatedReaderExpandStyle = useAnimatedStyle(() => ({
    height: interpolate(
      readerExpandProgress.value,
      [0, 1],
      [collapsedReaderHeight, expandedReaderHeight],
      Extrapolation.CLAMP,
    ),
    opacity: interpolate(readerExpandProgress.value, [0, 0.12, 1], [0, 1, 1], Extrapolation.CLAMP),
  }))

  const animatedAgentStateActionsStyle = useAnimatedStyle(() => ({
    opacity: interpolate(readerExpandProgress.value, [0, 0.16, 1], [1, 0, 0], Extrapolation.CLAMP),
  }))

  const animatedReaderToggleTravelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(readerExpandProgress.value, [0, 1], [-READER_ACTION_TRAVEL, 0], Extrapolation.CLAMP),
      },
    ],
  }))

  const animatedReaderToggleOpenIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(readerExpandProgress.value, [0, 0.45, 1], [1, 0.18, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(readerExpandProgress.value, [0, 1], [1, 0.92], Extrapolation.CLAMP) }],
  }))

  const animatedReaderToggleCloseIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(readerExpandProgress.value, [0, 0.45, 1], [0, 0.35, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(readerExpandProgress.value, [0, 1], [0.92, 1], Extrapolation.CLAMP) }],
  }))

  const waveformColumnMeta = useMemo(
    () =>
      Array.from({ length: waveformLevels.length }, () => ({
        delay: Math.random() * 1.5,
        duration: 1 + Math.random(),
        phase: Math.random() * Math.PI * 2,
      })),
    [waveformLevels.length],
  )

  const getWaveformCellStyle = useCallback(
    (row: number, col: number) => {
      const level = waveformLevels[col] ?? 0
      const rowFromBottom = WAVEFORM_ROWS - 1 - row
      const intensity = Math.max(0, Math.min(1, level * WAVEFORM_ROWS - rowFromBottom))

      const meta = waveformColumnMeta[col]
      const t = waveformTick / 1000
      const basePhase = (Math.max(0, t - meta.delay) / meta.duration) * Math.PI * 2 + meta.phase + row * 0.35
      const pulse = 0.5 + 0.5 * Math.sin(basePhase)

      let alpha = 0.08
      if (intensity > 0) {
        alpha = (0.4 + intensity * 0.6) * (0.85 + pulse * 0.15)
      } else if (isRecording) {
        alpha = 0.1 + pulse * 0.07
      }

      // Base palette around #78839A, with brighter/lower variants by intensity.
      const baseR = 120
      const baseG = 131
      const baseB = 154
      const lift = Math.round(intensity * 28)
      const r = Math.min(255, baseR + lift)
      const g = Math.min(255, baseG + lift)
      const b = Math.min(255, baseB + lift)

      return {
        backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})`,
        borderColor: `rgba(${Math.min(255, r + 8)}, ${Math.min(255, g + 8)}, ${Math.min(255, b + 8)}, ${Math.min(1, alpha + 0.16)})`,
      }
    },
    [isRecording, waveformColumnMeta, waveformLevels, waveformTick],
  )

  const handleControlsLayout = useCallback((event: LayoutChangeEvent) => {
    setControlsWidth(event.nativeEvent.layout.width)
  }, [])

  const handleTranscriptionAreaLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height)
    setTranscriptionAreaHeight((prev) => (prev === next ? prev : next))
  }, [])

  const handleAgentStateCardLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height)
    setAgentStateCardHeight((prev) => (prev === next ? prev : next))
  }, [])

  const handleWaveformLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width
    const columns = Math.max(14, Math.floor((width + WAVEFORM_CELL_GAP) / (WAVEFORM_CELL_SIZE + WAVEFORM_CELL_GAP)))

    if (columns === waveformLevelsRef.current.length) return

    const next = Array.from({ length: columns }, () => 0)
    waveformLevelsRef.current = next
    setWaveformLevels(next)
  }, [])

  const handleServerMenuListLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height)
    setServerMenuListHeight((prev) => (prev === next ? prev : next))
  }, [])

  const handleSessionMenuListLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height)
    setSessionMenuListHeight((prev) => (prev === next ? prev : next))
  }, [])

  const handleServerMenuFooterLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height)
    setServerMenuFooterHeight((prev) => (prev === next ? prev : next))
  }, [])

  const handleSessionMenuFooterLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.height)
    setSessionMenuFooterHeight((prev) => (prev === next ? prev : next))
  }, [])

  const renderMarkdownBlocks = (blocks: ReaderBlock[], variant: "reader" | "reply") => {
    const keyPrefix = variant === "reader" ? "reader" : "reply"
    const paragraphStyle = variant === "reader" ? styles.readerParagraph : styles.replyText

    const renderMarkdownInline = (input: string, blockIndex: number) =>
      parseReaderInlineSegments(input).map((segment, segmentIndex) => {
        const segmentKey = `${keyPrefix}-inline-${blockIndex}-${segmentIndex}`

        switch (segment.type) {
          case "inline_code":
            return (
              <Text key={segmentKey} style={styles.readerInlineCode}>
                {segment.content}
              </Text>
            )
          case "italic":
            return (
              <Text key={segmentKey} style={styles.markdownItalic}>
                {segment.content}
              </Text>
            )
          case "bold":
            return (
              <Text key={segmentKey} style={styles.markdownBold}>
                {segment.content}
              </Text>
            )
          case "bold_italic":
            return (
              <Text key={segmentKey} style={styles.markdownBoldItalic}>
                {segment.content}
              </Text>
            )
          default:
            return <Text key={segmentKey}>{segment.content}</Text>
        }
      })

    const getHeadingStyle = (level: ReaderHeadingLevel) => {
      if (variant === "reader") {
        return [
          styles.readerHeading,
          level === 1 ? styles.readerHeading1 : level === 2 ? styles.readerHeading2 : styles.readerHeading3,
        ]
      }

      return [
        styles.replyHeading,
        level === 1 ? styles.replyHeading1 : level === 2 ? styles.replyHeading2 : styles.replyHeading3,
      ]
    }

    return blocks.map((block, index) =>
      block.type === "code" ? (
        <View key={`${keyPrefix}-code-${index}`} style={styles.readerCodeBlock}>
          {block.language ? <Text style={styles.readerCodeLanguage}>{block.language}</Text> : null}
          <Text style={styles.readerCodeText}>{block.content}</Text>
        </View>
      ) : block.type === "heading" ? (
        <Text key={`${keyPrefix}-heading-${index}`} style={getHeadingStyle(block.level)}>
          {renderMarkdownInline(block.content, index)}
        </Text>
      ) : (
        <Text key={`${keyPrefix}-text-${index}`} style={paragraphStyle}>
          {renderMarkdownInline(block.content, index)}
        </Text>
      ),
    )
  }

  const renderTranscriptionPanel = () => (
    <View style={styles.transcriptionPanel} onLayout={handleTranscriptionPanelLayout}>
      <View style={styles.transcriptionTopActions} pointerEvents="box-none">
        <Pressable
          onPress={handleOpenWhisperSettings}
          style={({ pressed }) => [styles.clearButton, pressed && styles.clearButtonPressed]}
          hitSlop={8}
        >
          <SymbolView
            name={{ ios: "gearshape.fill", android: "settings", web: "settings" }}
            size={18}
            weight="semibold"
            tintColor={C.textTertiary}
          />
        </Pressable>
        <Pressable
          onPress={handleClearTranscript}
          style={({ pressed }) => [styles.clearButton, pressed && styles.clearButtonPressed]}
          hitSlop={8}
        >
          <Animated.View style={animatedClearIconStyle}>
            <SymbolView
              name={{ ios: "arrow.counterclockwise", android: "refresh", web: "refresh" }}
              size={18}
              weight="semibold"
              tintColor="#A0A0A0"
            />
          </Animated.View>
        </Pressable>
      </View>

      {whisperError ? (
        <View style={styles.modelErrorBadge}>
          <Text style={styles.modelErrorText}>{whisperError}</Text>
        </View>
      ) : null}

      {promptPagerData.length > 1 ? (
        <FlatList
          ref={promptPagerRef}
          data={promptPagerData}
          keyExtractor={promptPagerKeyExtractor}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handlePromptPagerSnap}
          initialScrollIndex={0}
          getItemLayout={(_data, index) => ({
            length: pagerPageWidth,
            offset: pagerPageWidth * index,
            index,
          })}
          style={styles.transcriptionScroll}
          renderItem={({ item }) =>
            item === "live" ? (
              <ScrollView
                ref={scrollViewRef}
                style={{ width: pagerPageWidth }}
                contentContainerStyle={[styles.transcriptionContent, styles.transcriptionContentLive]}
                onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
              >
                <Animated.View style={animatedTranscriptSendStyle}>
                  {displayedTranscript ? (
                    <Text style={styles.transcriptionText}>{displayedTranscript}</Text>
                  ) : isSending ? null : (
                    <Text style={styles.placeholderText}>Your transcription will appear here…</Text>
                  )}
                </Animated.View>
                <Animated.View style={[styles.swipeHint, animatedSwipeHintStyle]} pointerEvents="none">
                  {!displayedTranscript && !isSending ? (
                    <>
                      <Text style={styles.swipeHintText}>Swipe left to see previous prompts</Text>
                      <Text style={styles.swipeHintArrow}>→</Text>
                    </>
                  ) : null}
                </Animated.View>
              </ScrollView>
            ) : (
              <ScrollView style={{ width: pagerPageWidth }} contentContainerStyle={styles.transcriptionContent}>
                <Text style={styles.promptHistoryLabel}>Previous prompt</Text>
                <Text style={styles.promptHistoryText}>{item.promptText}</Text>
              </ScrollView>
            )
          }
        />
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.transcriptionScroll}
          contentContainerStyle={styles.transcriptionContent}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          <Animated.View style={animatedTranscriptSendStyle}>
            {displayedTranscript ? (
              <Text style={styles.transcriptionText}>{displayedTranscript}</Text>
            ) : isSending ? null : (
              <Text style={styles.placeholderText}>Your transcription will appear here…</Text>
            )}
          </Animated.View>
        </ScrollView>
      )}

      <Animated.View
        style={[styles.waveformBoxesRow, animatedWaveformRowStyle]}
        pointerEvents="none"
        onLayout={handleWaveformLayout}
      >
        {Array.from({ length: WAVEFORM_ROWS }).map((_, row) => (
          <View key={`row-${row}`} style={styles.waveformGridRow}>
            {waveformLevels.map((_, col) => (
              <View key={`cell-${row}-${col}`} style={[styles.waveformBox, getWaveformCellStyle(row, col)]} />
            ))}
          </View>
        ))}
      </Animated.View>
    </View>
  )

  const toggleServerMenu = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {})
    setDropdownMode((prev) => {
      const next = prev === "server" ? "none" : "server"
      if (next === "server") {
        setDropdownRenderMode("server")
      }
      if (next === "server") {
        refreshAllServerHealth()
        refreshDiscovery()
      }
      return next
    })
  }, [refreshAllServerHealth, refreshDiscovery])

  const toggleSessionMenu = useCallback(() => {
    if (!activeServer || activeServer.status !== "online") return
    void Haptics.selectionAsync().catch(() => {})
    void refreshServerStatusAndSessions(activeServer.id)
    setDropdownRenderMode("session")
    setDropdownMode((prev) => (prev === "session" ? "none" : "session"))
  }, [activeServer, refreshServerStatusAndSessions])

  const handleSelectServer = useCallback(
    (id: string) => {
      selectServer(id)
      setDropdownMode("none")
      void refreshServerStatusAndSessions(id)
    },
    [refreshServerStatusAndSessions, selectServer],
  )

  const handleSelectSession = useCallback(
    (id: string) => {
      selectSession(id)
      setDropdownMode("none")
    },
    [selectSession],
  )

  const handleCreateRootSession = useCallback(() => {
    if (!activeServer || activeServer.status !== "online" || isCreatingSession) {
      return
    }

    setSessionCreateMode("root")
    void createSession(activeServer.id)
      .then((created) => {
        if (!created) {
          Alert.alert("Could not create session", "Please check that your server is online and try again.")
          return
        }

        setDropdownMode("none")
      })
      .finally(() => {
        setSessionCreateMode(null)
      })
  }, [activeServer, createSession, isCreatingSession])

  const handleCreateSessionLikeCurrent = useCallback(() => {
    if (!activeServer || activeServer.status !== "online" || !activeSession || isCreatingSession) {
      return
    }

    setSessionCreateMode("same")
    void createSession(activeServer.id, {
      directory: activeSession.directory,
      workspaceID: activeSession.workspaceID,
    })
      .then((created) => {
        if (!created) {
          Alert.alert("Could not create session", "Please check that your server is online and try again.")
          return
        }

        setDropdownMode("none")
      })
      .finally(() => {
        setSessionCreateMode(null)
      })
  }, [activeServer, activeSession, createSession, isCreatingSession])

  const handleDeleteServer = useCallback(
    (id: string) => {
      const server = serversRef.current.find((s) => s.id === id)
      if (server && devicePushToken && server.relaySecret.trim().length > 0) {
        unregisterRelayDevice({
          relayBaseURL: server.relayURL,
          secret: server.relaySecret.trim(),
          deviceToken: devicePushToken,
        }).catch(() => {})
      }

      removeServer(id)
    },
    [devicePushToken, removeServer, serversRef],
  )

  const handleConnectDiscoveredServer = useCallback(
    (url: string) => {
      const ok = addServer(url, DEFAULT_RELAY_URL, "")
      if (!ok) {
        Alert.alert("Could not add server", "The discovered server could not be added. Try scanning the QR code.")
        return
      }

      setDropdownMode("none")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    },
    [addServer],
  )

  const handleStartScan = useCallback(async () => {
    scanLockRef.current = false
    const current =
      camera ??
      (() => {
        try {
          // Expo dev builds were failing to resolve this native module through async import().
          const mod = require("expo-camera") as typeof import("expo-camera") & {
            Camera?: { requestCameraPermissionsAsync?: unknown }
          }
          const direct = (mod as { requestCameraPermissionsAsync?: unknown }).requestCameraPermissionsAsync
          const fromCamera = mod.Camera?.requestCameraPermissionsAsync
          let requestCameraPermissionsAsync: (() => Promise<{ granted: boolean }>) | null = null
          if (typeof direct === "function") {
            requestCameraPermissionsAsync = direct as () => Promise<{ granted: boolean }>
          } else if (typeof fromCamera === "function") {
            requestCameraPermissionsAsync = fromCamera as () => Promise<{ granted: boolean }>
          }

          if (!mod.CameraView || !requestCameraPermissionsAsync) {
            return null
          }

          const next = {
            CameraView: mod.CameraView,
            requestCameraPermissionsAsync,
          }
          setCamera(next)
          return next
        } catch {
          return null
        }
      })()
    if (!current) {
      Alert.alert("Scanner unavailable", "This build does not include camera support. Reinstall the latest dev build.")
      return
    }
    if (camGranted) {
      setScanOpen(true)
      return
    }
    const res = await current.requestCameraPermissionsAsync()
    if (!res.granted) return
    setCamGranted(true)
    setScanOpen(true)
  }, [camGranted, camera])

  const completeOnboarding = useCallback(
    (openScanner: boolean) => {
      setOnboardingComplete(true)
      void FileSystem.writeAsStringAsync(ONBOARDING_STATE_FILE, JSON.stringify({ completed: true })).catch(() => {})

      if (openScanner) {
        void handleStartScan()
      }
    },
    [handleStartScan],
  )

  const handleReplayOnboarding = useCallback(() => {
    setWhisperSettingsOpen(false)
    setScanOpen(false)
    setPairSelectionOpen(false)
    setPendingPair(null)
    setPairHostOptions([])
    setPairHostProbes({})
    setSelectedPairHostURL(null)
    setIsConnectingPairHost(false)
    setDropdownMode("none")
    setOnboardingStep(0)
    setMicrophonePermissionState(permissionGranted ? "granted" : "idle")
    setNotificationPermissionState("idle")
    setLocalNetworkPermissionState("idle")
    setOnboardingReady(true)
    setOnboardingComplete(false)
    void FileSystem.deleteAsync(ONBOARDING_STATE_FILE, { idempotent: true }).catch(() => {})
  }, [permissionGranted])

  const closePairSelection = useCallback(() => {
    setPairSelectionOpen(false)
    setPendingPair(null)
    setPairHostOptions([])
    setPairHostProbes({})
    setSelectedPairHostURL(null)
    setIsConnectingPairHost(false)
    pairProbeRunRef.current += 1
  }, [])

  const handleConnectSelectedPairHost = useCallback(() => {
    if (!pendingPair || !selectedPairHostURL || isConnectingPairHost) {
      return
    }

    setIsConnectingPairHost(true)
    const ok = addServer(selectedPairHostURL, pendingPair.relayURL, pendingPair.relaySecret, pendingPair.serverID)

    if (!ok) {
      Alert.alert("Could not add server", "The selected host could not be added. Try another host.")
      setIsConnectingPairHost(false)
      return
    }

    closePairSelection()
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
  }, [addServer, closePairSelection, isConnectingPairHost, pendingPair, selectedPairHostURL])

  const handleRescanFromPairSelection = useCallback(() => {
    closePairSelection()
    scanLockRef.current = false
    void handleStartScan()
  }, [closePairSelection, handleStartScan])

  useEffect(() => {
    if (latestAssistantResponse.trim().length === 0 || activePermissionRequest !== null) {
      setReaderModeOpen(false)
    }
  }, [activePermissionRequest, latestAssistantResponse])

  const connectPairPayload = useCallback((rawData: string, source: "scan" | "link") => {
    const fromScan = source === "scan"
    if (fromScan && scanLockRef.current) return

    if (fromScan) {
      scanLockRef.current = true
    }

    const pair = parsePair(rawData)
    if (!pair) {
      if (fromScan) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
        setTimeout(() => {
          scanLockRef.current = false
        }, 750)
      }
      return
    }

    const options = normalizePairHosts(pair.hosts)
    if (!options.length) {
      if (fromScan) {
        scanLockRef.current = false
      }
      Alert.alert("No valid hosts found", "The QR payload did not include any valid server hosts.")
      return
    }

    if (fromScan) {
      setScanOpen(false)
    }

    setPendingPair(pair)
    setPairHostOptions(options)
    setSelectedPairHostURL(options[0]?.url ?? null)
    setPairHostProbes(Object.fromEntries(options.map((item) => [item.url, { status: "checking" as const }])))
    setPairSelectionOpen(true)

    if (fromScan) {
      scanLockRef.current = false
    }
  }, [])

  const handleScan = useCallback(
    (event: Scan) => {
      connectPairPayload(event.data, "scan")
    },
    [connectPairPayload],
  )

  useEffect(() => {
    if (scanOpen) return
    scanLockRef.current = false
  }, [scanOpen])

  useEffect(() => {
    if (!pairSelectionOpen || !pairHostOptions.length) {
      return
    }

    const runID = pairProbeRunRef.current + 1
    pairProbeRunRef.current = runID

    setPairHostProbes((prev) => {
      const next: Record<string, PairHostProbe> = {}
      for (const option of pairHostOptions) {
        next[option.url] = prev[option.url]?.status === "online" ? prev[option.url] : { status: "checking" }
      }
      return next
    })

    pairHostOptions.forEach((option) => {
      void (async () => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2800)
        const startedAt = Date.now()

        try {
          const response = await fetch(`${option.url}/health`, {
            method: "GET",
            signal: controller.signal,
          })
          if (pairProbeRunRef.current !== runID) return

          if (response.ok) {
            setPairHostProbes((prev) => ({
              ...prev,
              [option.url]: {
                status: "online",
                latencyMs: Math.max(1, Date.now() - startedAt),
              },
            }))
            return
          }

          setPairHostProbes((prev) => ({
            ...prev,
            [option.url]: {
              status: "offline",
              note: `HTTP ${response.status}`,
            },
          }))
        } catch (err) {
          if (pairProbeRunRef.current !== runID) return

          const aborted = err instanceof Error && err.name === "AbortError"
          let note = aborted ? "Timed out" : "Unavailable"
          if (!aborted) {
            try {
              const parsed = new URL(option.url)
              if (Platform.OS === "ios" && parsed.protocol === "http:" && !looksLikeLocalHost(parsed.hostname)) {
                note = "ATS blocked"
              }
            } catch {
              // ignore parse failure and keep default note
            }
          }

          setPairHostProbes((prev) => ({
            ...prev,
            [option.url]: {
              status: "offline",
              note,
            },
          }))
        } finally {
          clearTimeout(timeout)
        }
      })()
    })
  }, [pairHostOptions, pairSelectionOpen])

  useEffect(() => {
    let active = true

    const handleURL = async (url: string | null) => {
      if (!url) return
      if (!parsePair(url)) return

      if (!restoredRef.current) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          if (restoredRef.current || !active) {
            break
          }
        }
      }

      if (!active) return
      connectPairPayload(url, "link")
    }

    void Linking.getInitialURL()
      .then((url) => handleURL(url))
      .catch(() => {})

    const sub = Linking.addEventListener("url", (event) => {
      void handleURL(event.url)
    })

    return () => {
      active = false
      sub.remove()
    }
  }, [connectPairPayload, restoredRef])

  useEffect(() => {
    if (!activeServerId) return
    void refreshServerStatusAndSessions(activeServerId)
    const timer = setInterval(() => {
      void refreshServerStatusAndSessions(activeServerId)
    }, 15000)
    return () => clearInterval(timer)
  }, [activeServerId, refreshServerStatusAndSessions])

  const defaultModelInstalled = installedWhisperModels.includes(defaultWhisperModel)
  let onboardingProgressRaw = 0
  if (downloadingModelID) {
    onboardingProgressRaw = downloadProgress
  } else if (defaultModelInstalled || activeWhisperModel === defaultWhisperModel) {
    onboardingProgressRaw = 1
  } else if (isPreparingWhisperModel) {
    onboardingProgressRaw = 0.12
  }
  const onboardingProgress = Math.max(0, Math.min(1, onboardingProgressRaw))
  const onboardingProgressPct = Math.round(onboardingProgress * 100)
  let onboardingModelStatus = "Downloading model in background"
  if (downloadingModelID) {
    onboardingModelStatus = `Downloading model in background ${onboardingProgressPct}%`
  } else if (onboardingProgress >= 1) {
    onboardingModelStatus = "Model ready in background"
  }
  const onboardingSteps = [
    {
      title: "Microphone access.",
      body: "Control only listens while you hold the record button.",
      primaryLabel: microphonePermissionState === "pending" ? "Requesting microphone access..." : "Continue",
      primaryDisabled: microphonePermissionState === "pending",
      secondaryLabel: undefined,
      visualTag: "MIC",
      visualSurfaceStyle: styles.onboardingVisualSurfaceMic,
      visualOrbStyle: styles.onboardingVisualOrbMic,
      visualTagStyle: styles.onboardingVisualTagMic,
    },
    {
      title: "Turn on notifications.",
      body: "Get alerts when your OpenCode run finishes, fails, or needs your attention.",
      primaryLabel: notificationPermissionState === "pending" ? "Requesting notification access..." : "Continue",
      primaryDisabled: notificationPermissionState === "pending",
      secondaryLabel: undefined,
      visualTag: "PUSH",
      visualSurfaceStyle: styles.onboardingVisualSurfaceNotifications,
      visualOrbStyle: styles.onboardingVisualOrbNotifications,
      visualTagStyle: styles.onboardingVisualTagNotifications,
    },
    {
      title: "Local network access.",
      body: "This lets Control discover your machine on the same network.",
      primaryLabel: localNetworkPermissionState === "pending" ? "Requesting local network access..." : "Continue",
      primaryDisabled: localNetworkPermissionState === "pending",
      secondaryLabel: undefined,
      visualTag: "LAN",
      visualSurfaceStyle: styles.onboardingVisualSurfaceNetwork,
      visualOrbStyle: styles.onboardingVisualOrbNetwork,
      visualTagStyle: styles.onboardingVisualTagNetwork,
    },
    {
      title: "Pair your computer.",
      body: "Start `opencode serve --mdns` on your computer. Control can discover nearby servers automatically, or you can scan a QR code.",
      primaryLabel: "Scan OpenCode QR (optional)",
      primaryDisabled: false,
      secondaryLabel: "Skip and use discovery",
      visualTag: "PAIR",
      visualSurfaceStyle: styles.onboardingVisualSurfacePair,
      visualOrbStyle: styles.onboardingVisualOrbPair,
      visualTagStyle: styles.onboardingVisualTagPair,
    },
  ] as const
  const onboardingStepCount = onboardingSteps.length
  const clampedOnboardingStep = Math.max(0, Math.min(onboardingStep, onboardingStepCount - 1))
  const onboardingCurrentStep = onboardingSteps[clampedOnboardingStep]
  const {
    title: onboardingTitle,
    body: onboardingBody,
    primaryLabel: onboardingPrimaryLabel,
    primaryDisabled: onboardingPrimaryDisabled,
    secondaryLabel: onboardingSecondaryLabel,
    visualTag: onboardingVisualTag,
    visualSurfaceStyle: onboardingVisualSurfaceStyle,
    visualOrbStyle: onboardingVisualOrbStyle,
    visualTagStyle: onboardingVisualTagStyle,
  } = onboardingCurrentStep
  const onboardingSafeStyle = useMemo(
    () => [styles.onboardingRoot, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }],
    [insets.bottom, insets.top],
  )

  if (!onboardingReady) {
    return (
      <SafeAreaView style={onboardingSafeStyle} edges={["left", "right"]}>
        <StatusBar style="light" />
      </SafeAreaView>
    )
  }

  if (!onboardingComplete) {
    return (
      <SafeAreaView style={onboardingSafeStyle} edges={["left", "right"]}>
        <StatusBar style="light" />

        <View style={styles.onboardingShell}>
          <View style={styles.onboardingTopRail}>
            <View style={styles.onboardingModelRow}>
              <Text style={styles.onboardingModelText}>{onboardingModelStatus}</Text>
              <View style={styles.onboardingModelTrack}>
                <View
                  style={[
                    styles.onboardingModelFill,
                    { width: `${Math.max(onboardingProgressPct, onboardingProgress > 0 ? 6 : 0)}%` },
                  ]}
                />
              </View>
            </View>
          </View>

          <View style={styles.onboardingContent}>
            <View style={[styles.onboardingVisualSurface, onboardingVisualSurfaceStyle]}>
              <View style={[styles.onboardingVisualOrb, styles.onboardingVisualOrbOne, onboardingVisualOrbStyle]} />
              <View style={[styles.onboardingVisualOrb, styles.onboardingVisualOrbTwo, onboardingVisualOrbStyle]} />
              <View style={[styles.onboardingVisualTag, onboardingVisualTagStyle]}>
                <Text style={styles.onboardingVisualTagText}>{onboardingVisualTag}</Text>
              </View>
            </View>

            <View style={styles.onboardingCopyBlock}>
              <Text
                style={styles.onboardingEyebrow}
              >{`STEP ${clampedOnboardingStep + 1} OF ${onboardingStepCount}`}</Text>
              <Text style={styles.onboardingTitle}>{onboardingTitle}</Text>
              <Text style={styles.onboardingBody}>{onboardingBody}</Text>
            </View>
          </View>

          <View style={styles.onboardingFooter}>
            <Pressable
              onPress={() => {
                if (clampedOnboardingStep === 0) {
                  void (async () => {
                    await handleRequestMicrophonePermission()
                    setOnboardingStep(1)
                  })()
                  return
                }

                if (clampedOnboardingStep === 1) {
                  void (async () => {
                    await handleRequestNotificationPermission()
                    setOnboardingStep(2)
                  })()
                  return
                }

                if (clampedOnboardingStep === 2) {
                  void (async () => {
                    await handleRequestLocalNetworkPermission()
                    setOnboardingStep(3)
                  })()
                  return
                }

                completeOnboarding(true)
              }}
              style={({ pressed }) => [
                styles.onboardingPrimaryButton,
                onboardingPrimaryDisabled && styles.onboardingPrimaryButtonDisabled,
                pressed && styles.clearButtonPressed,
              ]}
              disabled={onboardingPrimaryDisabled}
            >
              <Text style={styles.onboardingPrimaryButtonText}>{onboardingPrimaryLabel}</Text>
              <SymbolView
                name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
                size={20}
                weight="semibold"
                tintColor="#FFFFFF"
              />
            </Pressable>

            {onboardingSecondaryLabel ? (
              <Pressable
                onPress={() => {
                  if (clampedOnboardingStep < onboardingStepCount - 1) {
                    setOnboardingStep((step) => Math.min(step + 1, onboardingStepCount - 1))
                    return
                  }

                  completeOnboarding(false)
                }}
                style={({ pressed }) => [styles.onboardingSecondaryButton, pressed && styles.clearButtonPressed]}
              >
                <Text style={styles.onboardingSecondaryText}>{onboardingSecondaryLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {isDropdownOpen ? <Pressable style={styles.dismissOverlay} onPress={closeDropdown} /> : null}

      {/* Workspace header */}
      <View style={styles.headerAnchor}>
        <Animated.View style={[styles.statusBar, animatedHeaderStyle, animatedHeaderShadowStyle]}>
          {activeServer ? (
            <View style={styles.headerSplitRow}>
              <Pressable
                onPress={toggleServerMenu}
                style={({ pressed }) => [styles.headerSplitLeft, pressed && styles.clearButtonPressed]}
              >
                <View style={styles.headerServerLabel}>
                  <View style={styles.headerStatusIconWrap}>
                    <View style={[styles.serverStatusDot, headerDotStyle]} />
                  </View>
                  <Text
                    style={[styles.workspaceHeaderText, styles.headerServerText]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {activeServer.name}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.headerSplitDivider} />

              <Pressable
                onPress={toggleSessionMenu}
                style={({ pressed }) => [styles.headerSplitRight, pressed && styles.clearButtonPressed]}
              >
                <Text
                  style={[styles.workspaceHeaderText, styles.headerSessionText]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {activeSession?.title ?? "Select session"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={toggleServerMenu}
              style={({ pressed }) => [styles.statusBarTapArea, pressed && styles.clearButtonPressed]}
            >
              <View style={styles.headerServerLabel}>
                <View style={styles.headerStatusIconWrap}>
                  <View style={[styles.serverStatusDot, headerDotStyle]} />
                </View>
                <Text style={styles.workspaceHeaderText}>{headerTitle}</Text>
              </View>
            </Pressable>
          )}

          <Animated.View
            style={[styles.serverMenuInline, animatedServerMenuStyle]}
            pointerEvents={isDropdownOpen ? "auto" : "none"}
          >
            <ScrollView
              style={styles.dropdownListViewport}
              contentContainerStyle={styles.dropdownListContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {effectiveDropdownMode === "server" ? (
                <View onLayout={handleServerMenuListLayout}>
                  <Text style={styles.serverGroupLabel}>Saved:</Text>

                  {servers.length === 0 ? (
                    <Text style={[styles.serverEmptyText, styles.serverGroupEmptyText]}>No saved servers</Text>
                  ) : (
                    servers.map((server) => (
                      <Pressable
                        key={server.id}
                        onPress={() => handleSelectServer(server.id)}
                        style={({ pressed }) => [styles.serverRow, pressed && styles.serverRowPressed]}
                      >
                        <View
                          style={[
                            styles.serverStatusDot,
                            server.status === "online" ? styles.serverStatusActive : styles.serverStatusOffline,
                          ]}
                        />
                        <Text style={styles.serverNameText}>{server.name}</Text>
                        <Pressable onPress={() => handleDeleteServer(server.id)} hitSlop={8}>
                          <SymbolView
                            name={{ ios: "xmark", android: "close", web: "close" }}
                            size={12}
                            weight="bold"
                            tintColor="#8C93A3"
                          />
                        </Pressable>
                      </Pressable>
                    ))
                  )}

                  <View style={styles.serverGroupHeaderRow}>
                    <Text style={styles.serverGroupLabel}>Discovered:</Text>
                    {discoveryStatus === "scanning" ? <ActivityIndicator size="small" color="#8790A3" /> : null}
                  </View>

                  {!discoveryAvailable ? (
                    <Text style={[styles.serverEmptyText, styles.serverGroupEmptyText]}>
                      Discovery unavailable in this build
                    </Text>
                  ) : discoveredServerOptions.length === 0 ? (
                    <Text style={[styles.serverEmptyText, styles.serverGroupEmptyText]}>
                      {discoveredServerEmptyLabel}
                    </Text>
                  ) : (
                    discoveredServerOptions.map((server, index) => (
                      <Pressable
                        key={server.id}
                        onPress={() => handleConnectDiscoveredServer(server.url)}
                        style={({ pressed }) => [
                          styles.serverRow,
                          index === discoveredServerOptions.length - 1 && styles.serverRowLast,
                          pressed && styles.serverRowPressed,
                        ]}
                      >
                        <View style={[styles.serverStatusDot, styles.serverStatusChecking]} />
                        <View style={styles.discoveredServerCopy}>
                          <Text style={styles.serverNameText} numberOfLines={1}>
                            {server.name}
                          </Text>
                          <Text style={styles.discoveredServerMeta} numberOfLines={1} ellipsizeMode="middle">
                            {server.url}
                          </Text>
                        </View>
                        <Text style={styles.discoveredServerAction}>Connect</Text>
                      </Pressable>
                    ))
                  )}

                  {discoveryStatus === "error" && discoveryError ? (
                    <Text style={styles.discoveryErrorText} numberOfLines={1} ellipsizeMode="tail">
                      {discoveryError}
                    </Text>
                  ) : null}
                </View>
              ) : activeServer ? (
                <View onLayout={handleSessionMenuListLayout}>
                  {activeSession ? (
                    <>
                      <View style={styles.currentSessionSummary}>
                        <Text style={styles.currentSessionLabel}>Current session</Text>

                        <View style={styles.currentSessionMetaRow}>
                          <Text style={styles.currentSessionMetaKey}>Working dir</Text>
                          <Text style={styles.currentSessionMetaValue} numberOfLines={1} ellipsizeMode="middle">
                            {formatWorkingDirectory(currentSessionDirectory)}
                          </Text>
                        </View>

                        <View style={styles.currentSessionMetaRow}>
                          <Text style={styles.currentSessionMetaKey}>Model</Text>
                          <Text style={styles.currentSessionMetaValue} numberOfLines={1} ellipsizeMode="middle">
                            {currentSessionModelLabel}
                          </Text>
                        </View>

                        <View style={styles.currentSessionMetaRow}>
                          <Text style={styles.currentSessionMetaKey}>Updated</Text>
                          <Text style={styles.currentSessionMetaValue}>{currentSessionUpdated || "Just now"}</Text>
                        </View>
                      </View>

                      <View style={styles.currentSessionDivider} />
                    </>
                  ) : null}

                  {sessionList.length === 0 ? (
                    activeServer.sessionsLoading ? null : (
                      <Text style={styles.serverEmptyText}>
                        {activeSession ? "No other sessions available" : "No sessions available"}
                      </Text>
                    )
                  ) : (
                    sessionList.map((session, index) => (
                      <Pressable
                        key={session.id}
                        onPress={() => handleSelectSession(session.id)}
                        style={({ pressed }) => [
                          styles.serverRow,
                          index === sessionList.length - 1 && styles.serverRowLast,
                          pressed && styles.serverRowPressed,
                        ]}
                      >
                        <View style={[styles.serverStatusDot, styles.serverStatusActive]} />
                        <Text style={styles.serverNameText} numberOfLines={1}>
                          {session.title}
                        </Text>
                        <Text style={styles.sessionUpdatedText}>{formatSessionUpdated(session.updated)}</Text>
                      </Pressable>
                    ))
                  )}
                </View>
              ) : (
                <Text style={styles.serverEmptyText}>Select a server first</Text>
              )}
            </ScrollView>

            {effectiveDropdownMode === "server" ? (
              <View onLayout={handleServerMenuFooterLayout}>
                <Pressable onPress={() => void handleStartScan()} style={styles.addServerButton}>
                  <Text style={styles.addServerButtonText}>Add server by scanning QR code</Text>
                </Pressable>
              </View>
            ) : effectiveDropdownMode === "session" && activeServer?.status === "online" ? (
              <View style={styles.sessionMenuActions} onLayout={handleSessionMenuFooterLayout}>
                {activeSession ? (
                  <Pressable
                    onPress={handleCreateSessionLikeCurrent}
                    disabled={isCreatingSession}
                    style={({ pressed }) => [
                      styles.serverRow,
                      styles.sessionMenuActionRow,
                      isCreatingSession && styles.sessionMenuActionButtonDisabled,
                      pressed && styles.clearButtonPressed,
                    ]}
                  >
                    <View style={styles.sessionMenuActionInner}>
                      <View style={styles.sessionMenuActionIconSlot}>
                        <SymbolView
                          name={{ ios: "folder.badge.plus", android: "create_new_folder", web: "create_new_folder" }}
                          size={12}
                          tintColor="#9BA3B5"
                        />
                      </View>
                      <Text style={styles.sessionMenuActionText}>
                        {sessionCreateMode === "same" ? "Creating workspace session..." : "New session with workspace"}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={handleCreateRootSession}
                  disabled={isCreatingSession}
                  style={({ pressed }) => [
                    styles.serverRow,
                    styles.sessionMenuActionRow,
                    styles.serverRowLast,
                    isCreatingSession && styles.sessionMenuActionButtonDisabled,
                    pressed && styles.clearButtonPressed,
                  ]}
                >
                  <View style={styles.sessionMenuActionInner}>
                    <View style={styles.sessionMenuActionIconSlot}>
                      <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={12} tintColor="#9BA3B5" />
                    </View>
                    <Text style={styles.sessionMenuActionText}>
                      {sessionCreateMode === "root" ? "Creating new session..." : "New session"}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : null}
          </Animated.View>
        </Animated.View>
      </View>

      {/* Transcription area */}
      <View style={styles.transcriptionArea} onLayout={handleTranscriptionAreaLayout}>
        {hasPendingPermission && activePermissionCard ? (
          <View style={[styles.splitCard, styles.permissionCard]}>
            <View style={styles.permissionHeaderRow}>
              <View style={styles.permissionStatusDot} />
              <View style={styles.permissionHeaderCopy}>
                <Text style={styles.replyCardLabel}>Permission</Text>
                <Text style={styles.permissionStatusText}>
                  {isReplyingToActivePermission
                    ? monitorStatus || "Sending decision…"
                    : pendingPermissionCount > 1
                      ? `${pendingPermissionCount} requests pending`
                      : "Action needed"}
                </Text>
              </View>
            </View>

            <ScrollView style={styles.permissionScroll} contentContainerStyle={styles.permissionContent}>
              <Text style={styles.permissionEyebrow}>{activePermissionCard.eyebrow}</Text>
              <Text style={styles.permissionTitle}>{activePermissionCard.title}</Text>
              <Text style={styles.permissionBody}>{activePermissionCard.body}</Text>

              {activePermissionCard.sections.map((section, index) => (
                <View
                  key={`permission-section-${section.label}-${index}`}
                  style={[
                    styles.permissionSection,
                    index === activePermissionCard.sections.length - 1 && styles.permissionSectionLast,
                  ]}
                >
                  <Text style={styles.permissionSectionLabel}>{section.label}</Text>
                  <Text style={[styles.permissionSectionText, section.mono && styles.permissionSectionTextMono]}>
                    {section.text}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <View style={styles.permissionFooter}>
              <Pressable
                onPress={() => handlePermissionDecision("once")}
                disabled={isReplyingToActivePermission}
                style={({ pressed }) => [
                  styles.permissionPrimaryButton,
                  isReplyingToActivePermission && styles.permissionActionDisabled,
                  pressed && styles.clearButtonPressed,
                ]}
              >
                {isReplyingToActivePermission ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.permissionPrimaryButtonText}>Allow once</Text>
                )}
              </Pressable>

              <View style={styles.permissionSecondaryRow}>
                {activePermissionRequest.always.length > 0 ? (
                  <Pressable
                    onPress={() => handlePermissionDecision("always")}
                    disabled={isReplyingToActivePermission}
                    style={({ pressed }) => [
                      styles.permissionSecondaryButton,
                      isReplyingToActivePermission && styles.permissionActionDisabled,
                      pressed && styles.clearButtonPressed,
                    ]}
                  >
                    <Text style={styles.permissionSecondaryButtonText}>Always allow</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => handlePermissionDecision("reject")}
                  disabled={isReplyingToActivePermission}
                  style={({ pressed }) => [
                    styles.permissionRejectButton,
                    activePermissionRequest.always.length === 0 && styles.permissionRejectButtonWide,
                    isReplyingToActivePermission && styles.permissionActionDisabled,
                    pressed && styles.clearButtonPressed,
                  ]}
                >
                  <Text style={styles.permissionRejectButtonText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : shouldShowAgentStateCard ? (
          <>
            <View style={styles.splitCardStack} pointerEvents={readerModeRendered ? "none" : "auto"}>
              <View style={[styles.splitCard, styles.replyCard]} onLayout={handleAgentStateCardLayout}>
                <View style={styles.agentStateHeaderRow}>
                  <View style={styles.agentStateTitleWrap}>
                    <View style={styles.agentStateIconWrap}>
                      {agentStateIcon === "loading" ? (
                        <ActivityIndicator size="small" color="#91A0C0" />
                      ) : (
                        <SymbolView
                          name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }}
                          size={16}
                          tintColor={AGENT_SUCCESS_GREEN}
                        />
                      )}
                    </View>
                    <Text style={styles.replyCardLabel}>Agent</Text>
                  </View>
                  <Animated.View
                    style={[
                      styles.agentStateActions,
                      !hasAssistantResponse && styles.agentStateActionsSingle,
                      animatedAgentStateActionsStyle,
                    ]}
                  >
                    {hasAssistantResponse ? (
                      <Pressable
                        onPress={handleOpenReaderMode}
                        hitSlop={8}
                        accessibilityLabel="Open Reader"
                        style={styles.agentStateActionButton}
                      >
                        <SymbolView
                          name={READER_OPEN_SYMBOL}
                          size={16}
                          tintColor="#8FA4CC"
                          style={styles.readerToggleSymbol}
                        />
                      </Pressable>
                    ) : null}
                    <Pressable onPress={handleHideAgentState} hitSlop={8} style={styles.agentStateActionButton}>
                      <SymbolView
                        name={{ ios: "xmark", android: "close", web: "close" }}
                        size={14}
                        weight="bold"
                        tintColor="#8D97AB"
                      />
                    </Pressable>
                  </Animated.View>
                </View>
                <ScrollView style={styles.replyScroll} contentContainerStyle={styles.replyContent}>
                  {renderMarkdownBlocks(agentStateBlocks, "reply")}
                </ScrollView>
              </View>

              {renderTranscriptionPanel()}
            </View>

            {readerModeVisible ? (
              <Animated.View
                pointerEvents={readerModeRendered ? "auto" : "none"}
                style={[styles.splitCard, styles.readerCard, styles.readerOverlayCard, animatedReaderExpandStyle]}
              >
                <View style={styles.readerHeaderRow}>
                  <View style={styles.agentStateTitleWrap}>
                    <View style={styles.agentStateIconWrap}>
                      {agentStateIcon === "loading" ? (
                        <ActivityIndicator size="small" color="#91A0C0" />
                      ) : (
                        <SymbolView
                          name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }}
                          size={16}
                          tintColor={AGENT_SUCCESS_GREEN}
                        />
                      )}
                    </View>
                    <Text style={styles.replyCardLabel}>Agent</Text>
                  </View>
                  <View style={styles.readerActionRail}>
                    <Animated.View style={[styles.readerToggleFloatingAction, animatedReaderToggleTravelStyle]}>
                      <Pressable
                        onPress={handleCloseReaderMode}
                        hitSlop={8}
                        accessibilityLabel="Close Reader"
                        style={styles.agentStateActionButton}
                      >
                        <Animated.View style={[styles.readerToggleIconLayer, animatedReaderToggleOpenIconStyle]}>
                          <SymbolView
                            name={READER_OPEN_SYMBOL}
                            size={16}
                            tintColor="#8FA4CC"
                            style={styles.readerToggleSymbol}
                          />
                        </Animated.View>
                        <Animated.View style={[styles.readerToggleIconLayer, animatedReaderToggleCloseIconStyle]}>
                          <SymbolView
                            name={READER_CLOSE_SYMBOL}
                            size={16}
                            tintColor="#8FA4CC"
                            style={styles.readerToggleSymbol}
                          />
                        </Animated.View>
                      </Pressable>
                    </Animated.View>
                  </View>
                </View>

                <ScrollView style={styles.readerScroll} contentContainerStyle={styles.readerContent}>
                  {renderMarkdownBlocks(readerBlocks, "reader")}
                </ScrollView>
              </Animated.View>
            ) : null}
          </>
        ) : (
          renderTranscriptionPanel()
        )}
      </View>

      {hasPendingPermission ? null : (
        <View style={styles.controlsRow} onLayout={handleControlsLayout}>
          <Pressable
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={!permissionGranted || modelLoading}
            style={[styles.recordPressable, !permissionGranted && styles.recordButtonDisabled]}
          >
            <View style={styles.recordButton}>
              {isTranscribingBulk ? (
                <View style={styles.recordBusyCenter}>
                  <ActivityIndicator color="#FF2E3F" size="small" />
                </View>
              ) : modelLoadingState !== "ready" ? (
                <>
                  <View
                    style={[
                      styles.loadFill,
                      modelLoadingState === "loading" && styles.loadFillPending,
                      { width: modelLoadingState === "downloading" ? `${Math.max(pct, 3)}%` : "100%" },
                    ]}
                  />
                  <View style={styles.loadOverlay} pointerEvents="none">
                    <Text style={styles.loadText}>
                      {modelLoadingState === "downloading"
                        ? `Downloading ${loadingModelLabel} ${pct}%`
                        : `Loading ${loadingModelLabel}`}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <Animated.View style={[styles.recordBorder, animatedBorderStyle]} pointerEvents="none" />
                  <Animated.View style={[styles.recordDot, animatedDotStyle]} />
                </>
              )}
            </View>
          </Pressable>

          <Animated.View style={[styles.sendSlot, animatedSendStyle]} pointerEvents={shouldShowSend ? "auto" : "none"}>
            <Pressable
              onPress={handleSendTranscript}
              style={({ pressed }) => [
                styles.sendButton,
                (isSending || !hasTranscript || !canSendToSession) && styles.sendButtonDisabled,
                pressed && styles.clearButtonPressed,
              ]}
              disabled={isSending || !hasTranscript || !canSendToSession}
              hitSlop={8}
            >
              <SymbolView
                name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }}
                size={28}
                weight="bold"
                tintColor="#FFFFFF"
              />
            </Pressable>
          </Animated.View>
        </View>
      )}

      <Modal
        visible={whisperSettingsOpen}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setWhisperSettingsOpen(false)}
      >
        <SafeAreaView style={styles.settingsRoot}>
          <View style={styles.settingsTop}>
            <View style={styles.settingsTitleBlock}>
              <Text style={styles.settingsTitle}>Settings</Text>
              <Text style={styles.settingsSubtitle}>Default: {WHISPER_MODEL_LABELS[defaultWhisperModel]}</Text>
            </View>
            <Pressable onPress={() => setWhisperSettingsOpen(false)}>
              <Text style={styles.settingsClose}>Done</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsContent}>
            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionLabel}>DEVELOPMENT:</Text>
              {__DEV__ ? (
                <Pressable
                  onPress={handleReplayOnboarding}
                  style={({ pressed }) => [styles.settingsTextRow, pressed && styles.clearButtonPressed]}
                >
                  <Text style={styles.settingsTextRowTitle}>Replay onboarding</Text>
                  <Text style={styles.settingsTextRowAction}>Run</Text>
                </Pressable>
              ) : (
                <View style={styles.settingsTextRow}>
                  <Text style={styles.settingsMutedText}>Available in development builds.</Text>
                </View>
              )}
            </View>

            <View style={styles.settingsSection}>
              <Text style={styles.settingsSectionLabel}>GENERAL:</Text>
              <View style={styles.settingsTextRow}>
                <Text style={styles.settingsTextRowTitle}>Default model</Text>
                <Text style={styles.settingsTextRowValue}>{WHISPER_MODEL_LABELS[defaultWhisperModel]}</Text>
              </View>

              <View style={styles.settingsTextRow}>
                <View style={styles.settingsOptionCopy}>
                  <Text style={styles.settingsTextRowTitle}>Realtime dictation</Text>
                  <Text style={styles.settingsTextRowMeta}>Turn off to transcribe after release</Text>
                </View>
                <Switch
                  value={transcriptionMode === "realtime"}
                  onValueChange={(enabled) => setTranscriptionMode(enabled ? "realtime" : "bulk")}
                  disabled={dictationSettingsLocked}
                  trackColor={{ false: "#2D2D31", true: "#6A3A33" }}
                  thumbColor={transcriptionMode === "realtime" ? "#FF6B56" : "#F2F2F2"}
                  ios_backgroundColor="#2D2D31"
                />
              </View>

              <View style={styles.settingsTextRow}>
                <View style={styles.settingsOptionCopy}>
                  <Text style={styles.settingsTextRowTitle}>Auto send on dictation end</Text>
                  <Text style={styles.settingsTextRowMeta}>Send the transcript as soon as recording finishes</Text>
                </View>
                <Switch
                  value={autoSendOnDictationEnd}
                  onValueChange={setAutoSendOnDictationEnd}
                  disabled={dictationSettingsLocked}
                  trackColor={{ false: "#2D2D31", true: "#6A3A33" }}
                  thumbColor={autoSendOnDictationEnd ? "#FF6B56" : "#F2F2F2"}
                  ios_backgroundColor="#2D2D31"
                />
              </View>
            </View>

            {WHISPER_MODEL_FAMILIES.map((family) => (
              <View key={family.key} style={styles.settingsSection}>
                <Text style={styles.settingsSectionLabel}>{family.label.toUpperCase()}:</Text>
                <View style={styles.settingsTextRow}>
                  <Text style={styles.settingsMutedText}>{family.description}</Text>
                </View>
                {family.models.map((modelID) => {
                  const installed = installedWhisperModels.includes(modelID)
                  const isDefault = defaultWhisperModel === modelID
                  const isDownloading = downloadingModelID === modelID
                  const actionDisabled = (downloadingModelID !== null && !isDownloading) || isTranscribingBulk
                  const downloadPct = Math.round(Math.max(0, Math.min(1, downloadProgress)) * 100)
                  const actionLabel = isDownloading
                    ? `${downloadPct}%`
                    : installed
                      ? isDefault
                        ? "Selected"
                        : "Select"
                      : "Download"
                  const sizeLabel = formatWhisperModelSize(WHISPER_MODEL_SIZES[modelID])
                  const friendlyName = WHISPER_MODEL_LABELS[modelID]
                  const rowMeta = [sizeLabel, installed ? "installed" : null, isDefault ? "default" : null]
                    .filter(Boolean)
                    .join(" · ")

                  return (
                    <View key={modelID} style={styles.settingsInlineRow}>
                      <Pressable
                        onPress={() => {
                          if (installed) {
                            void handleSelectWhisperModel(modelID)
                          }
                        }}
                        onLongPress={() => {
                          if (!installed || isDownloading) return
                          Alert.alert("Delete model?", `Remove ${friendlyName} from this device?`, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => {
                                void handleDeleteWhisperModel(modelID)
                              },
                            },
                          ])
                        }}
                        delayLongPress={350}
                        disabled={!installed || actionDisabled || isPreparingWhisperModel}
                        style={({ pressed }) => [
                          styles.settingsInlineLabelPressable,
                          (!installed || actionDisabled || isPreparingWhisperModel) &&
                            styles.settingsInlinePressableDisabled,
                          pressed && styles.clearButtonPressed,
                        ]}
                      >
                        <Text style={styles.settingsInlineName}>{friendlyName}</Text>
                        <Text style={styles.settingsInlineMeta}>{rowMeta}</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => {
                          if (isDownloading) return
                          if (installed) {
                            void handleSelectWhisperModel(modelID)
                            return
                          }
                          void handleDownloadWhisperModel(modelID)
                        }}
                        disabled={actionDisabled || (installed && isPreparingWhisperModel)}
                        accessibilityLabel={actionLabel}
                        style={({ pressed }) => [
                          styles.settingsInlineTextActionPressable,
                          (actionDisabled || (installed && isPreparingWhisperModel)) &&
                            styles.settingsInlinePressableDisabled,
                          pressed && styles.clearButtonPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.settingsInlineTextAction,
                            installed && styles.settingsInlineTextActionInstalled,
                            isDownloading && styles.settingsInlineTextActionDownloading,
                          ]}
                        >
                          {actionLabel}
                        </Text>
                      </Pressable>
                    </View>
                  )
                })}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={scanOpen}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setScanOpen(false)}
      >
        <SafeAreaView style={styles.scanRoot}>
          <View style={styles.scanTop}>
            <Text style={styles.scanTitle}>Scan server QR</Text>
            <Pressable onPress={() => setScanOpen(false)}>
              <Text style={styles.scanClose}>Close</Text>
            </Pressable>
          </View>
          {camGranted && camera ? (
            <camera.CameraView
              style={styles.scanCam}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={handleScan}
            />
          ) : (
            <View style={styles.scanEmpty}>
              <Text style={styles.scanHint}>Camera permission is required to scan setup QR codes.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={pairSelectionOpen}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={closePairSelection}
      >
        <SafeAreaView style={styles.pairSelectRoot}>
          <View style={styles.pairSelectTop}>
            <View style={styles.pairSelectTitleBlock}>
              <Text style={styles.pairSelectTitle}>Choose server host</Text>
              <Text style={styles.pairSelectSubtitle}>Select the best network route for this server.</Text>
            </View>
            <Pressable onPress={closePairSelection}>
              <Text style={styles.pairSelectClose}>Close</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.pairSelectList} contentContainerStyle={styles.pairSelectListContent}>
            {pairHostOptions.map((option, index) => {
              const probe = pairHostProbes[option.url]
              const selected = selectedPairHostURL === option.url
              const recommended = recommendedPairHostURL === option.url
              let dotStyle = styles.pairSelectDotChecking
              if (probe?.status === "online") {
                dotStyle = styles.pairSelectDotOnline
              } else if (probe?.status === "offline") {
                dotStyle = styles.pairSelectDotOffline
              }

              return (
                <Pressable
                  key={option.url}
                  onPress={() => setSelectedPairHostURL(option.url)}
                  style={({ pressed }) => [
                    styles.pairSelectRow,
                    selected && styles.pairSelectRowSelected,
                    index === pairHostOptions.length - 1 && styles.pairSelectRowLast,
                    pressed && styles.clearButtonPressed,
                  ]}
                >
                  <View style={styles.pairSelectRowMain}>
                    <View style={styles.pairSelectLeftCol}>
                      <View style={[styles.pairSelectDot, dotStyle]} />
                      <View style={styles.pairSelectRowCopy}>
                        <View style={styles.pairSelectRowTitleLine}>
                          <Text style={styles.pairSelectHostLabel} numberOfLines={1}>
                            {option.label}
                          </Text>
                          {recommended ? <Text style={styles.pairSelectRecommended}>recommended</Text> : null}
                        </View>
                        <Text style={styles.pairSelectHostMeta}>{pairHostKindLabel(option.kind)}</Text>
                        <Text style={styles.pairSelectProbeMeta}>{pairProbeSummary(probe)}</Text>
                        <Text style={styles.pairSelectHostURL} numberOfLines={1} ellipsizeMode="middle">
                          {option.url}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.pairSelectRightCol}>
                      <Text style={styles.pairSelectLatency}>{pairProbeLabel(probe)}</Text>
                      {selected ? (
                        <SymbolView
                          name={{
                            ios: "checkmark",
                            android: "check",
                            web: "check",
                          }}
                          size={13}
                          tintColor="#C5C5C5"
                        />
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              )
            })}
          </ScrollView>

          <View style={styles.pairSelectFooter}>
            <Pressable
              onPress={handleConnectSelectedPairHost}
              disabled={!selectedPairHostURL || isConnectingPairHost}
              style={({ pressed }) => [
                styles.pairSelectPrimaryButton,
                (!selectedPairHostURL || isConnectingPairHost) && styles.pairSelectPrimaryButtonDisabled,
                pressed && styles.clearButtonPressed,
              ]}
            >
              <Text style={styles.pairSelectPrimaryButtonText}>
                {isConnectingPairHost ? "Connecting..." : "Connect selected host"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleRescanFromPairSelection}
              style={({ pressed }) => [pressed && styles.clearButtonPressed]}
            >
              <Text style={styles.pairSelectSecondaryAction}>Scan again</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    position: "relative",
  },
  onboardingRoot: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 16,
  },
  onboardingShell: {
    flex: 1,
  },
  onboardingTopRail: {
    gap: 8,
    marginBottom: 10,
  },
  onboardingContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "stretch",
    gap: 22,
    paddingHorizontal: 2,
  },
  onboardingModelRow: {
    gap: 6,
  },
  onboardingModelText: {
    color: "#A9A9A9",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  onboardingModelTrack: {
    height: 4,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "#2C2C2C",
    overflow: "hidden",
  },
  onboardingModelFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#FF5B47",
  },
  onboardingVisualSurface: {
    width: "100%",
    minHeight: 176,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#171717",
    borderColor: "#2B2B2B",
  },
  onboardingVisualSurfaceMic: {
    backgroundColor: "#1A2118",
    borderColor: "#2F3D2D",
  },
  onboardingVisualSurfaceNotifications: {
    backgroundColor: "#1A1D2A",
    borderColor: "#303A5A",
  },
  onboardingVisualSurfaceNetwork: {
    backgroundColor: "#1A2218",
    borderColor: "#344930",
  },
  onboardingVisualSurfacePair: {
    backgroundColor: "#1F1A27",
    borderColor: "#413157",
  },
  onboardingVisualOrb: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.22,
  },
  onboardingVisualOrbOne: {
    width: 130,
    height: 130,
    top: -28,
    left: -22,
  },
  onboardingVisualOrbTwo: {
    width: 160,
    height: 160,
    bottom: -52,
    right: -44,
  },
  onboardingVisualOrbMic: {
    backgroundColor: "#61C372",
  },
  onboardingVisualOrbNotifications: {
    backgroundColor: "#4A6EE0",
  },
  onboardingVisualOrbNetwork: {
    backgroundColor: "#78B862",
  },
  onboardingVisualOrbPair: {
    backgroundColor: "#9B6CDC",
  },
  onboardingVisualTag: {
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 3,
  },
  onboardingVisualTagMic: {
    backgroundColor: "#253A25",
    borderColor: "#3A5C3A",
  },
  onboardingVisualTagNotifications: {
    backgroundColor: "#223561",
    borderColor: "#38518C",
  },
  onboardingVisualTagNetwork: {
    backgroundColor: "#284122",
    borderColor: "#3D6835",
  },
  onboardingVisualTagPair: {
    backgroundColor: "#3B2859",
    borderColor: "#5A3D86",
  },
  onboardingVisualTagText: {
    color: "#F6F7F8",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  onboardingCopyBlock: {
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
  },
  onboardingEyebrow: {
    color: "#7F7F7F",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.3,
  },
  onboardingTitle: {
    color: C.textPrimary,
    fontSize: 34,
    fontWeight: "800",
    textAlign: "left",
    letterSpacing: -1,
    lineHeight: 38,
  },
  onboardingBody: {
    color: "#B4B4B4",
    fontSize: 18,
    lineHeight: 25,
    textAlign: "left",
    paddingHorizontal: 0,
  },
  onboardingFooter: {
    gap: 10,
    paddingTop: 6,
  },
  onboardingPrimaryButton: {
    minHeight: BTN_PRIMARY.minHeight,
    borderRadius: BTN_PRIMARY.borderRadius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN_PRIMARY.backgroundColor,
    borderWidth: BTN_PRIMARY.borderWidth,
    borderColor: BTN_PRIMARY.borderColor,
    flexDirection: "row",
    gap: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 4,
  },
  onboardingPrimaryButtonDisabled: {
    opacity: 0.6,
  },
  onboardingPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  onboardingSecondaryButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  onboardingSecondaryText: {
    color: "#959CAA",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "left",
  },
  dismissOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
  },
  headerAnchor: {
    marginHorizontal: 6,
    marginTop: 5,
    height: 51,
    zIndex: 30,
  },
  statusBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingTop: 0,
    overflow: "hidden",
    shadowColor: "#000000",
  },
  statusBarInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 30,
  },
  statusBarTapArea: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  headerServerLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  headerSplitRow: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
  },
  headerSplitLeft: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    height: "100%",
    justifyContent: "center",
    alignItems: "flex-start",
    paddingRight: 8,
  },
  headerSplitDivider: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#3F4556",
    marginHorizontal: 6,
  },
  headerSplitRight: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    height: "100%",
    justifyContent: "center",
    alignItems: "flex-start",
    paddingLeft: 8,
  },
  workspaceHeaderText: {
    color: "#8F8F8F",
    fontSize: 14,
    fontWeight: "600",
  },
  headerServerText: {
    flex: 1,
    minWidth: 0,
    width: "100%",
  },
  headerSessionText: {
    flexShrink: 1,
    minWidth: 0,
    width: "100%",
    textAlign: "left",
  },
  serverMenuInline: {
    marginTop: 8,
    paddingBottom: 2,
    gap: 4,
  },
  dropdownListViewport: {
    maxHeight: DROPDOWN_VISIBLE_ROWS * DROPDOWN_ROW_HEIGHT,
  },
  dropdownListContent: {
    paddingBottom: 0,
  },
  currentSessionSummary: {
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 8,
    gap: 5,
  },
  currentSessionLabel: {
    color: "#A3ACC0",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  currentSessionMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  currentSessionMetaKey: {
    width: 74,
    color: "#7C8599",
    fontSize: 12,
    fontWeight: "600",
  },
  currentSessionMetaValue: {
    flex: 1,
    color: "#D7DCE6",
    fontSize: 13,
    fontWeight: "500",
  },
  currentSessionDivider: {
    width: "100%",
    height: 1,
    backgroundColor: "#222733",
    marginBottom: 4,
  },
  serverGroupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  serverGroupLabel: {
    color: "#8F97AA",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  serverEmptyText: {
    color: C.textDimmed,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 10,
  },
  serverGroupEmptyText: {
    textAlign: "left",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  serverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#222733",
  },
  serverRowLast: {
    borderBottomWidth: 0,
  },
  serverRowPressed: {
    opacity: 0.85,
  },
  serverStatusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  serverStatusActive: {
    backgroundColor: C.green,
  },
  serverStatusChecking: {
    backgroundColor: C.yellow,
  },
  serverStatusOffline: {
    backgroundColor: "#D14C55",
  },
  serverNameText: {
    flex: 1,
    color: C.textSecondary,
    fontSize: 16,
    fontWeight: "500",
  },
  sessionUpdatedText: {
    color: "#8E96A8",
    fontSize: 14,
    fontWeight: "500",
    marginLeft: 8,
  },
  discoveredServerCopy: {
    flex: 1,
    gap: 2,
  },
  discoveredServerMeta: {
    color: "#818A9E",
    fontSize: 12,
    fontWeight: "500",
  },
  discoveredServerAction: {
    color: "#B9C2D8",
    fontSize: 13,
    fontWeight: "700",
  },
  discoveryErrorText: {
    color: "#7D8598",
    fontSize: 11,
    fontWeight: "500",
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  // serverDeleteIcon: removed — replaced with SymbolView
  addServerButton: {
    marginTop: 4,
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 10,
  },
  addServerButtonText: {
    color: "#B8BDC9",
    fontSize: 16,
    fontWeight: "600",
  },
  sessionMenuActions: {
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "#222733",
  },
  sessionMenuActionRow: {
    paddingVertical: 9,
  },
  sessionMenuActionInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sessionMenuActionIconSlot: {
    width: 9,
    height: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionMenuActionButtonDisabled: {
    opacity: 0.55,
  },
  sessionMenuActionText: {
    flex: 1,
    color: "#D6DAE4",
    fontSize: 16,
    fontWeight: "500",
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  readyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AGENT_SUCCESS_GREEN,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF2E3F",
  },
  statusText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  statusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  clearButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  clearButtonPressed: {
    opacity: 0.75,
  },
  // clearIcon: removed — replaced with SymbolView
  transcriptionArea: {
    flex: 1,
    marginHorizontal: 6,
    marginTop: 6,
  },
  splitCardStack: {
    flex: 1,
    gap: 8,
  },
  splitCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: C.border,
    overflow: "hidden",
    position: "relative",
  },
  replyCard: {
    paddingTop: 16,
  },
  permissionCard: {
    paddingTop: 16,
  },
  permissionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  permissionHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  permissionStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: C.orange,
  },
  permissionEyebrow: {
    color: C.orange,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  permissionStatusText: {
    color: "#9099AA",
    fontSize: 13,
    fontWeight: "600",
  },
  permissionScroll: {
    flex: 1,
  },
  permissionContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 14,
  },
  permissionTitle: {
    color: "#F7F8FB",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
    letterSpacing: -0.7,
  },
  permissionBody: {
    color: "#B2BDCF",
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24,
  },
  permissionSection: {
    gap: 6,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#242424",
  },
  permissionSectionLast: {
    borderBottomWidth: 0,
  },
  permissionSectionLabel: {
    color: "#7F8798",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  permissionSectionText: {
    color: "#E7E7E7",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  permissionSectionTextMono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", web: "monospace" }),
    fontSize: 12,
    lineHeight: 18,
    color: "#D4D7DE",
    backgroundColor: "#17181B",
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  permissionFooter: {
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 18,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#21252F",
  },
  permissionPrimaryButton: {
    minHeight: BTN_PRIMARY.minHeight,
    borderRadius: BTN_PRIMARY.borderRadius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN_PRIMARY.backgroundColor,
    borderWidth: BTN_PRIMARY.borderWidth,
    borderColor: BTN_PRIMARY.borderColor,
    paddingHorizontal: 16,
  },
  permissionPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  permissionSecondaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  permissionSecondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1C1E22",
    borderWidth: 1,
    borderColor: "#32353D",
    paddingHorizontal: 12,
  },
  permissionSecondaryButtonText: {
    color: "#E0E3EA",
    fontSize: 14,
    fontWeight: "700",
  },
  permissionRejectButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#31181C",
    borderWidth: 1,
    borderColor: "#5E2B34",
    paddingHorizontal: 12,
  },
  permissionRejectButtonWide: {
    flex: 1,
  },
  permissionRejectButtonText: {
    color: "#FFCCD2",
    fontSize: 14,
    fontWeight: "700",
  },
  permissionActionDisabled: {
    opacity: 0.6,
  },
  transcriptionPanel: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  replyCardLabel: {
    color: "#AAB5CC",
    fontSize: 15,
    fontWeight: "600",
  },
  readerCard: {
    paddingTop: 16,
  },
  readerOverlayCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  readerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginBottom: 8,
  },
  readerScroll: {
    flex: 1,
  },
  readerContent: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: 14,
  },
  readerParagraph: {
    color: "#E8EDF8",
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 32,
  },
  readerHeading: {
    color: "#F7F9FF",
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  readerHeading1: {
    fontSize: 29,
    lineHeight: 38,
  },
  readerHeading2: {
    fontSize: 25,
    lineHeight: 34,
  },
  readerHeading3: {
    fontSize: 22,
    lineHeight: 30,
  },
  markdownItalic: {
    fontStyle: "italic",
  },
  markdownBold: {
    fontWeight: "800",
  },
  markdownBoldItalic: {
    fontStyle: "italic",
    fontWeight: "800",
  },
  readerInlineCode: {
    color: "#E7EBF5",
    backgroundColor: "#17181B",
    borderWidth: 1,
    borderColor: "#292A2E",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 18,
    lineHeight: 26,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", web: "monospace" }),
  },
  readerCodeBlock: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#292A2E",
    backgroundColor: "#17181B",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  readerCodeLanguage: {
    color: "#97A5C2",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  readerCodeText: {
    color: "#DDE6F7",
    fontSize: 18,
    lineHeight: 28,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", web: "monospace" }),
  },
  agentStateHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 20,
    marginBottom: 8,
  },
  agentStateTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  agentStateIconWrap: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerStatusIconWrap: {
    width: 16,
    height: 16,
    justifyContent: "center",
    paddingLeft: 5,
  },
  agentStateActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    width: READER_ACTION_RAIL_WIDTH,
    gap: READER_ACTION_GAP,
  },
  agentStateActionsSingle: {
    width: READER_ACTION_SIZE,
    gap: 0,
  },
  agentStateActionButton: {
    width: READER_ACTION_SIZE,
    height: READER_ACTION_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  agentStateReader: {
    color: "#8FA4CC",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  readerActionRail: {
    width: READER_ACTION_RAIL_WIDTH,
    height: READER_ACTION_SIZE,
    position: "relative",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  readerToggleFloatingAction: {
    position: "absolute",
    right: 0,
    width: READER_ACTION_SIZE,
    height: READER_ACTION_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  readerToggleIconLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  readerToggleSymbol: {
    transform: [{ rotate: "-90deg" }],
  },
  // agentStateClose: removed — replaced with SymbolView
  replyScroll: {
    flex: 1,
  },
  replyContent: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    flexGrow: 1,
    gap: 14,
  },
  replyText: {
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 32,
    color: "#F4F7FF",
  },
  replyHeading: {
    color: "#F7F9FF",
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  replyHeading1: {
    fontSize: 27,
    lineHeight: 36,
  },
  replyHeading2: {
    fontSize: 24,
    lineHeight: 32,
  },
  replyHeading3: {
    fontSize: 21,
    lineHeight: 29,
  },
  transcriptionScroll: {
    flex: 1,
  },
  transcriptionContent: {
    padding: 20,
    paddingTop: 54,
    paddingBottom: 54,
    flexGrow: 1,
  },
  transcriptionTopActions: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    zIndex: 4,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  promptHistoryLabel: {
    color: "#555",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  promptHistoryText: {
    fontSize: 24,
    fontWeight: "500",
    lineHeight: 34,
    color: "#888",
  },
  modelErrorBadge: {
    alignSelf: "flex-start",
    marginLeft: 14,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#3A1A1D",
    borderWidth: 1,
    borderColor: "#5D292F",
  },
  modelErrorText: {
    color: "#FFB9BF",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  transcriptionText: {
    fontSize: 28,
    fontWeight: "500",
    lineHeight: 38,
    color: "#FFFFFF",
  },
  placeholderText: {
    fontSize: 28,
    fontWeight: "500",
    color: C.textPlaceholder,
  },
  transcriptionContentLive: {
    justifyContent: "space-between",
  },
  swipeHint: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
  },
  swipeHintText: {
    color: "#444",
    fontSize: 13,
    fontWeight: "500",
  },
  swipeHintArrow: {
    color: "#444",
    fontSize: 15,
    fontWeight: "600",
  },
  waveformBoxesRow: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 14,
    height: WAVEFORM_ROWS * WAVEFORM_CELL_SIZE + (WAVEFORM_ROWS - 1) * WAVEFORM_CELL_GAP,
    pointerEvents: "none",
  },
  waveformGridRow: {
    flexDirection: "row",
    gap: WAVEFORM_CELL_GAP,
    marginBottom: WAVEFORM_CELL_GAP,
  },
  waveformBox: {
    width: WAVEFORM_CELL_SIZE,
    height: WAVEFORM_CELL_SIZE,
    borderRadius: 1,
    backgroundColor: "#78839A",
    borderWidth: 1,
    borderColor: "#818DA6",
  },
  controlsRow: {
    paddingHorizontal: 6,
    paddingBottom: 6,
    paddingTop: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  recordPressable: {
    flex: 1,
  },
  recordButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.redBg,
    height: CONTROL_HEIGHT,
    borderRadius: 20,
    width: "100%",
    overflow: "hidden",
  },
  recordBusyCenter: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
  },
  loadFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#FF5B47",
  },
  loadFillPending: {
    backgroundColor: "#66423C",
  },
  loadOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  loadText: {
    color: "#FFF6F4",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  settingsRoot: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  settingsTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 4,
  },
  settingsTitleBlock: {
    flex: 1,
    gap: 4,
  },
  settingsTitle: {
    color: C.textPrimary,
    fontSize: 20,
    fontWeight: "700",
  },
  settingsSubtitle: {
    color: "#999999",
    fontSize: 13,
    fontWeight: "500",
  },
  settingsClose: {
    color: "#C5C5C5",
    fontSize: 15,
    fontWeight: "700",
  },
  settingsScroll: {
    flex: 1,
  },
  settingsContent: {
    gap: 24,
    paddingBottom: 24,
  },
  settingsSection: {
    gap: 0,
  },
  settingsSectionLabel: {
    color: "#7D7D7D",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.05,
    marginBottom: 6,
  },
  settingsTextRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderMuted,
    paddingVertical: 10,
  },
  settingsToggleRow: {
    alignItems: "flex-start",
  },
  settingsMutedText: {
    color: "#868686",
    fontSize: 12,
    fontWeight: "500",
  },
  settingsOptionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  settingsTextRowTitle: {
    color: "#ECECEC",
    fontSize: 14,
    fontWeight: "600",
  },
  settingsTextRowMeta: {
    color: "#8D8D8D",
    fontSize: 12,
    fontWeight: "500",
  },
  settingsTextRowValue: {
    color: "#BDBDBD",
    fontSize: 13,
    fontWeight: "600",
    maxWidth: "55%",
    textAlign: "right",
  },
  settingsTextRowAction: {
    color: "#B8B8B8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  settingsTextRowActionActive: {
    color: "#FFD8D2",
  },
  settingsModeToggle: {
    flexDirection: "row",
    backgroundColor: "#17181B",
    borderWidth: 1,
    borderColor: "#292A2E",
    borderRadius: 14,
    padding: 4,
    gap: 4,
    alignSelf: "stretch",
  },
  settingsModeToggleOption: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  settingsModeToggleOptionActive: {
    backgroundColor: "#3F201B",
  },
  settingsModeToggleOptionPressed: {
    opacity: 0.82,
  },
  settingsModeToggleText: {
    color: "#9A9A9A",
    fontSize: 13,
    fontWeight: "700",
  },
  settingsModeToggleTextActive: {
    color: "#FFF0EC",
  },
  settingsInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: C.borderMuted,
  },
  settingsInlineLabelPressable: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingRight: 12,
    gap: 2,
  },
  settingsInlinePressableDisabled: {
    opacity: 0.55,
  },
  settingsInlineName: {
    color: "#E7E7E7",
    fontSize: 14,
    fontWeight: "600",
  },
  settingsInlineMeta: {
    color: "#8F8F8F",
    fontSize: 12,
    fontWeight: "500",
  },
  settingsInlineTextActionPressable: {
    marginLeft: 8,
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  settingsInlineTextAction: {
    color: "#D0D0D0",
    fontSize: 12,
    fontWeight: "700",
    minWidth: 72,
    textAlign: "right",
  },
  settingsInlineTextActionInstalled: {
    color: "#E2B1A8",
  },
  settingsInlineTextActionDownloading: {
    color: "#FFD7CE",
  },
  scanRoot: {
    flex: 1,
    backgroundColor: "#101014",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  scanTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scanTitle: {
    color: "#E8EAF0",
    fontSize: 18,
    fontWeight: "700",
  },
  scanClose: {
    color: "#8FA4CC",
    fontSize: 15,
    fontWeight: "600",
  },
  scanCam: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  scanEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  scanHint: {
    color: "#A6ABBA",
    fontSize: 14,
    textAlign: "center",
  },
  pairSelectRoot: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  pairSelectTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  pairSelectTitleBlock: {
    flex: 1,
    gap: 4,
  },
  pairSelectTitle: {
    color: "#E8EAF0",
    fontSize: 18,
    fontWeight: "700",
  },
  pairSelectSubtitle: {
    color: "#A3A3A3",
    fontSize: 13,
    fontWeight: "500",
  },
  pairSelectClose: {
    color: "#C5C5C5",
    fontSize: 15,
    fontWeight: "600",
  },
  pairSelectList: {
    flex: 1,
  },
  pairSelectListContent: {
    paddingBottom: 12,
  },
  pairSelectRow: {
    minHeight: 74,
    borderBottomWidth: 1,
    borderBottomColor: "#242424",
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  pairSelectRowSelected: {
    backgroundColor: "#171717",
  },
  pairSelectRowLast: {
    borderBottomColor: "#242424",
  },
  pairSelectRowMain: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  pairSelectLeftCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  pairSelectDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  pairSelectDotChecking: {
    backgroundColor: "#6F778A",
  },
  pairSelectDotOnline: {
    backgroundColor: AGENT_SUCCESS_GREEN,
  },
  pairSelectDotOffline: {
    backgroundColor: "#E35B5B",
  },
  pairSelectRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pairSelectRowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pairSelectHostLabel: {
    color: "#ECECEC",
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1,
  },
  pairSelectRecommended: {
    color: "#D5A79F",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pairSelectHostMeta: {
    color: "#9F9F9F",
    fontSize: 12,
    fontWeight: "500",
  },
  pairSelectProbeMeta: {
    color: "#B8B8B8",
    fontSize: 12,
    fontWeight: "500",
  },
  pairSelectHostURL: {
    color: "#7E7E7E",
    fontSize: 11,
    fontWeight: "500",
  },
  pairSelectLatency: {
    color: "#D4D4D4",
    fontSize: 13,
    fontWeight: "700",
    minWidth: 76,
    textAlign: "right",
  },
  pairSelectRightCol: {
    minWidth: 76,
    flexShrink: 0,
    alignItems: "flex-end",
    gap: 8,
    marginLeft: 10,
    paddingTop: 2,
  },
  pairSelectFooter: {
    borderTopWidth: 1,
    borderTopColor: "#242424",
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  pairSelectPrimaryButton: {
    minHeight: BTN_PRIMARY.minHeight,
    borderRadius: BTN_PRIMARY.borderRadius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN_PRIMARY.backgroundColor,
    borderWidth: BTN_PRIMARY.borderWidth,
    borderColor: BTN_PRIMARY.borderColor,
  },
  pairSelectPrimaryButtonDisabled: {
    opacity: 0.6,
  },
  pairSelectPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  pairSelectSecondaryAction: {
    color: "#A8A8A8",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 8,
  },
  sendSlot: {
    height: CONTROL_HEIGHT,
    overflow: "hidden",
  },
  sendButton: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BTN_PRIMARY.backgroundColor,
    borderWidth: BTN_PRIMARY.borderWidth,
    borderColor: BTN_PRIMARY.borderColor,
  },
  sendButtonDisabled: {
    opacity: 0.7,
  },
  // sendIcon: removed — replaced with SymbolView
  recordBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
  },
  recordButtonDisabled: {
    opacity: 0.4,
  },
  recordDot: {
    width: 38,
    height: 38,
    backgroundColor: "#FF2E3F",
  },
})
