import { createSignal, onCleanup } from "solid-js"

// Minimal types to avoid relying on non-standard DOM typings
type RecognitionResult = {
  0: { transcript: string }
  isFinal: boolean
}

type RecognitionEvent = {
  results: RecognitionResult[]
  resultIndex: number
}

interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

const COMMIT_DELAY = 250

const appendSegment = (base: string, addition: string) => {
  const trimmed = addition.trim()
  if (!trimmed) return base
  if (!base) return trimmed
  const needsSpace = /\S$/.test(base) && !/^[,.;!?]/.test(trimmed)
  return `${base}${needsSpace ? " " : ""}${trimmed}`
}

const extractSuffix = (committed: string, hypothesis: string) => {
  const cleanHypothesis = hypothesis.trim()
  if (!cleanHypothesis) return ""
  const baseTokens = committed.trim() ? committed.trim().split(/\s+/) : []
  const hypothesisTokens = cleanHypothesis.split(/\s+/)
  let index = 0
  while (
    index < baseTokens.length &&
    index < hypothesisTokens.length &&
    baseTokens[index] === hypothesisTokens[index]
  ) {
    index += 1
  }
  if (index < baseTokens.length) return ""
  return hypothesisTokens.slice(index).join(" ")
}

export function createSpeechRecognition(opts?: {
  lang?: string
  onFinal?: (text: string) => void
  onInterim?: (text: string) => void
}) {
  const hasSupport =
    typeof window !== "undefined" &&
    Boolean((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition)

  const [isRecording, setIsRecording] = createSignal(false)
  const [committed, setCommitted] = createSignal("")
  const [interim, setInterim] = createSignal("")

  let recognition: Recognition | undefined
  let shouldContinue = false
  let committedText = ""
  let sessionCommitted = ""
  let pendingHypothesis = ""
  let lastInterimSuffix = ""
  let shrinkCandidate: string | undefined
  let commitTimer: number | undefined

  const cancelPendingCommit = () => {
    if (commitTimer === undefined) return
    clearTimeout(commitTimer)
    commitTimer = undefined
  }

  const commitSegment = (segment: string) => {
    const nextCommitted = appendSegment(committedText, segment)
    if (nextCommitted === committedText) return
    committedText = nextCommitted
    setCommitted(committedText)
    if (opts?.onFinal) opts.onFinal(segment.trim())
  }

  const promotePending = () => {
    if (!pendingHypothesis) return
    const suffix = extractSuffix(sessionCommitted, pendingHypothesis)
    if (!suffix) {
      pendingHypothesis = ""
      return
    }
    sessionCommitted = appendSegment(sessionCommitted, suffix)
    commitSegment(suffix)
    pendingHypothesis = ""
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setInterim("")
    if (opts?.onInterim) opts.onInterim("")
  }

  const applyInterim = (suffix: string, hypothesis: string) => {
    cancelPendingCommit()
    pendingHypothesis = hypothesis
    lastInterimSuffix = suffix
    shrinkCandidate = undefined
    setInterim(suffix)
    if (opts?.onInterim) {
      opts.onInterim(suffix ? appendSegment(committedText, suffix) : "")
    }
    if (!suffix) return
    const snapshot = hypothesis
    commitTimer = window.setTimeout(() => {
      if (pendingHypothesis !== snapshot) return
      const currentSuffix = extractSuffix(sessionCommitted, pendingHypothesis)
      if (!currentSuffix) return
      sessionCommitted = appendSegment(sessionCommitted, currentSuffix)
      commitSegment(currentSuffix)
      pendingHypothesis = ""
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      setInterim("")
      if (opts?.onInterim) opts.onInterim("")
    }, COMMIT_DELAY)
  }

  if (hasSupport) {
    const Ctor: new () => Recognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition

    recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = opts?.lang || (typeof navigator !== "undefined" ? navigator.language : "en-US")

    recognition.onresult = (event: RecognitionEvent) => {
      if (!event.results.length) return

      let aggregatedFinal = ""
      let latestHypothesis = ""

      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = (result[0]?.transcript || "").trim()
        if (!transcript) continue
        if (result.isFinal) {
          aggregatedFinal = appendSegment(aggregatedFinal, transcript)
        } else {
          latestHypothesis = transcript
        }
      }

      if (aggregatedFinal) {
        cancelPendingCommit()
        const finalSuffix = extractSuffix(sessionCommitted, aggregatedFinal)
        if (finalSuffix) {
          sessionCommitted = appendSegment(sessionCommitted, finalSuffix)
          commitSegment(finalSuffix)
        }
        pendingHypothesis = ""
        lastInterimSuffix = ""
        shrinkCandidate = undefined
        setInterim("")
        if (opts?.onInterim) opts.onInterim("")
        return
      }

      cancelPendingCommit()

      if (!latestHypothesis) {
        shrinkCandidate = undefined
        applyInterim("", "")
        return
      }

      const suffix = extractSuffix(sessionCommitted, latestHypothesis)

      if (!suffix) {
        if (!lastInterimSuffix) {
          shrinkCandidate = undefined
          applyInterim("", latestHypothesis)
          return
        }
        if (shrinkCandidate === "") {
          applyInterim("", latestHypothesis)
          return
        }
        shrinkCandidate = ""
        pendingHypothesis = latestHypothesis
        return
      }

      if (lastInterimSuffix && suffix.length < lastInterimSuffix.length) {
        if (shrinkCandidate === suffix) {
          applyInterim(suffix, latestHypothesis)
          return
        }
        shrinkCandidate = suffix
        pendingHypothesis = latestHypothesis
        return
      }

      shrinkCandidate = undefined
      applyInterim(suffix, latestHypothesis)
    }

    recognition.onerror = (e: { error: string }) => {
      cancelPendingCommit()
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      if (e.error === "no-speech" && shouldContinue) {
        setInterim("")
        if (opts?.onInterim) opts.onInterim("")
        setTimeout(() => {
          try {
            recognition?.start()
          } catch {}
        }, 150)
        return
      }
      shouldContinue = false
      setIsRecording(false)
    }

    recognition.onstart = () => {
      sessionCommitted = ""
      pendingHypothesis = ""
      cancelPendingCommit()
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      setInterim("")
      if (opts?.onInterim) opts.onInterim("")
      setIsRecording(true)
    }

    recognition.onend = () => {
      cancelPendingCommit()
      lastInterimSuffix = ""
      shrinkCandidate = undefined
      setIsRecording(false)
      if (shouldContinue) {
        setTimeout(() => {
          try {
            recognition?.start()
          } catch {}
        }, 150)
      }
    }
  }

  const start = () => {
    if (!recognition) return
    shouldContinue = true
    sessionCommitted = ""
    pendingHypothesis = ""
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setInterim("")
    try {
      recognition.start()
    } catch {}
  }

  const stop = () => {
    if (!recognition) return
    shouldContinue = false
    promotePending()
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setInterim("")
    if (opts?.onInterim) opts.onInterim("")
    try {
      recognition.stop()
    } catch {}
  }

  onCleanup(() => {
    shouldContinue = false
    promotePending()
    cancelPendingCommit()
    lastInterimSuffix = ""
    shrinkCandidate = undefined
    setInterim("")
    if (opts?.onInterim) opts.onInterim("")
    try {
      recognition?.stop()
    } catch {}
  })

  return {
    isSupported: () => hasSupport,
    isRecording,
    committed,
    interim,
    start,
    stop,
  }
}
