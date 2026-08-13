export { decodeTimeline } from "./decode.js"
export { encodeFrames, type EncodeOptions, type ImageFrame } from "./encode.js"
export { exportRecording, type ExportRecordingOptions, type ExportRecordingResult } from "./export.js"
export { joinFrames, renderFrame } from "./render.js"
export { replayRecording, type ReplayOptions } from "./replay.js"
export type {
  CapturedFrame,
  CapturedLine,
  CapturedSpan,
  SampledFrame,
  TimelineHeader,
  TimelineOutput,
  TimelineRecord,
} from "./types.js"
