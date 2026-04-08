import type { TranscriptSegment } from "./asr-client"

/**
 * Accumulated voice metadata for a session — emotion trends, intent patterns,
 * speech rate stats. Designed to be serialized to voice-metadata.md and
 * injected as context so the LLM can adapt to the user's vocal state.
 */
export interface VoiceMetadata {
  /** Running count of voice segments processed */
  segmentCount: number
  /** Emotion frequency: { happy: 5, frustrated: 2, ... } */
  emotionCounts: Record<string, number>
  /** Intent frequency: { question: 3, command: 7, ... } */
  intentCounts: Record<string, number>
  /** Current/latest emotion detected */
  currentEmotion: string
  /** Current/latest intent detected */
  currentIntent: string
  /** Average words per minute across segments */
  avgWpm: number
  /** Total filler count (um, uh, like) */
  totalFillers: number
  /** Total pause count */
  totalPauses: number
  /** Recent emotion sequence (last 10) for trend detection */
  recentEmotions: string[]
  /** Timestamps of recording sessions */
  sessions: Array<{ start: number; end?: number; segmentCount: number }>
}

/**
 * Accumulates voice metadata across a session and produces a markdown
 * summary suitable for injection into LLM context.
 */
export class VoiceMetadataStore {
  private data: VoiceMetadata = {
    segmentCount: 0,
    emotionCounts: {},
    intentCounts: {},
    currentEmotion: "",
    currentIntent: "",
    avgWpm: 0,
    totalFillers: 0,
    totalPauses: 0,
    recentEmotions: [],
    sessions: [],
  }

  private wpmSamples: number[] = []
  private sessionStart: number | null = null

  get current(): Readonly<VoiceMetadata> {
    return this.data
  }

  /** Call when recording starts */
  startSession(): void {
    this.sessionStart = Date.now()
    this.data.sessions.push({ start: this.sessionStart, segmentCount: 0 })
  }

  /** Call when recording stops */
  endSession(): void {
    const last = this.data.sessions[this.data.sessions.length - 1]
    if (last && !last.end) {
      last.end = Date.now()
    }
    this.sessionStart = null
  }

  /** Ingest a transcript segment's metadata */
  ingest(seg: TranscriptSegment): void {
    if (!seg.is_final) return

    this.data.segmentCount++

    // Track the current session's segment count
    const last = this.data.sessions[this.data.sessions.length - 1]
    if (last && !last.end) last.segmentCount++

    // Emotion
    const emotion = seg.metadata?.emotion
    if (emotion) {
      this.data.emotionCounts[emotion] = (this.data.emotionCounts[emotion] ?? 0) + 1
      this.data.currentEmotion = emotion
      this.data.recentEmotions.push(emotion)
      if (this.data.recentEmotions.length > 10) {
        this.data.recentEmotions.shift()
      }
    }

    // Intent
    const intent = seg.metadata?.intent
    if (intent) {
      this.data.intentCounts[intent] = (this.data.intentCounts[intent] ?? 0) + 1
      this.data.currentIntent = intent
    }

    // Speech rate
    if (seg.speech_rate) {
      if (seg.speech_rate.words_per_minute > 0) {
        this.wpmSamples.push(seg.speech_rate.words_per_minute)
        this.data.avgWpm = Math.round(
          this.wpmSamples.reduce((a, b) => a + b, 0) / this.wpmSamples.length,
        )
      }
      this.data.totalFillers += seg.speech_rate.filler_count
      this.data.totalPauses += seg.speech_rate.pause_count
    }
  }

  /** Dominant emotion (most frequent) */
  get dominantEmotion(): string {
    let max = 0
    let best = ""
    for (const [emotion, count] of Object.entries(this.data.emotionCounts)) {
      if (count > max) {
        max = count
        best = emotion
      }
    }
    return best
  }

  /** Detect emotional trend from recent sequence */
  get emotionTrend(): string {
    const recent = this.data.recentEmotions
    if (recent.length < 3) return ""
    const last3 = recent.slice(-3)
    if (last3.every((e) => e === last3[0])) return `consistently ${last3[0]}`
    // Check for shift
    const first = recent.slice(0, Math.floor(recent.length / 2))
    const second = recent.slice(Math.floor(recent.length / 2))
    const mode = (arr: string[]) => {
      const counts: Record<string, number> = {}
      for (const v of arr) counts[v] = (counts[v] ?? 0) + 1
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
    }
    const firstMode = mode(first)
    const secondMode = mode(second)
    if (firstMode && secondMode && firstMode !== secondMode) {
      return `shifting from ${firstMode} to ${secondMode}`
    }
    return ""
  }

  /** Short single-line summary for TUI display */
  get shortSummary(): string {
    const parts: string[] = []
    if (this.data.currentEmotion) parts.push(this.data.currentEmotion)
    if (this.data.currentIntent) parts.push(this.data.currentIntent)
    if (this.data.avgWpm > 0) parts.push(`${this.data.avgWpm}wpm`)
    return parts.join(" · ")
  }

  /**
   * Generate a markdown summary for LLM context injection.
   * Compact enough to not waste tokens, rich enough to be useful.
   */
  toMarkdown(): string {
    const d = this.data
    if (d.segmentCount === 0) return ""

    const lines: string[] = ["## Voice Session Context"]
    lines.push("")

    // Current state
    const current: string[] = []
    if (d.currentEmotion) current.push(`**Emotion:** ${d.currentEmotion}`)
    if (d.currentIntent) current.push(`**Intent:** ${d.currentIntent}`)
    if (current.length) {
      lines.push(`Current: ${current.join(", ")}`)
    }

    // Trend
    const trend = this.emotionTrend
    if (trend) lines.push(`Trend: ${trend}`)

    // Emotion distribution (top 3)
    const sortedEmotions = Object.entries(d.emotionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
    if (sortedEmotions.length) {
      const total = Object.values(d.emotionCounts).reduce((a, b) => a + b, 0)
      const dist = sortedEmotions
        .map(([e, c]) => `${e} ${Math.round((c / total) * 100)}%`)
        .join(", ")
      lines.push(`Emotions: ${dist}`)
    }

    // Intent distribution (top 3)
    const sortedIntents = Object.entries(d.intentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
    if (sortedIntents.length) {
      const total = Object.values(d.intentCounts).reduce((a, b) => a + b, 0)
      const dist = sortedIntents
        .map(([i, c]) => `${i} ${Math.round((c / total) * 100)}%`)
        .join(", ")
      lines.push(`Intents: ${dist}`)
    }

    // Speech stats
    const stats: string[] = []
    if (d.avgWpm > 0) stats.push(`${d.avgWpm} wpm`)
    if (d.totalFillers > 0) stats.push(`${d.totalFillers} fillers`)
    if (d.totalPauses > 0) stats.push(`${d.totalPauses} pauses`)
    if (stats.length) lines.push(`Speech: ${stats.join(", ")}`)

    lines.push(`Segments: ${d.segmentCount}`)

    return lines.join("\n")
  }
}
