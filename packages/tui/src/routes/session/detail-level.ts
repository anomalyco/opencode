export const TRANSCRIPT_DETAIL_LEVELS = ["final", "compact", "full"] as const

export type TranscriptDetail = (typeof TRANSCRIPT_DETAIL_LEVELS)[number]

export function transcriptDetailAt(x: number, width: number): TranscriptDetail {
  if (width <= 0) return "compact"
  const index = Math.max(0, Math.min(2, Math.floor((x / width) * 3)))
  return TRANSCRIPT_DETAIL_LEVELS[index]
}

export function nextTranscriptDetail(detail: TranscriptDetail): TranscriptDetail {
  return TRANSCRIPT_DETAIL_LEVELS[(TRANSCRIPT_DETAIL_LEVELS.indexOf(detail) + 1) % TRANSCRIPT_DETAIL_LEVELS.length]
}
