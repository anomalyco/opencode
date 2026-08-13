import type { ExportRecordingOptions } from "./export.js"

export interface RecordingPaths {
  readonly timeline: string
  readonly video: string
}

export async function finalizeRecording(timeline: string, expected: RecordingPaths, options?: ExportRecordingOptions) {
  if (timeline !== expected.timeline) throw new Error(`OpenCode returned an unexpected recording path: ${timeline}`)
  if (!(await Bun.file(timeline).exists())) throw new Error(`OpenCode recording timeline was not created: ${timeline}`)
  const { exportRecording } = await import("./export.js")
  await exportRecording(timeline, expected.video, options)
  return expected.video
}
