type RecordValue = Record<string, unknown>

const isRecord = (value: unknown): value is RecordValue => {
  return typeof value === "object" && value !== null
}

export const isDisposable = (value: unknown): value is { dispose: () => void } => {
  return isRecord(value) && typeof value.dispose === "function"
}

export const disposeIfDisposable = (value: unknown) => {
  if (!isDisposable(value)) return
  value.dispose()
}

export const hasSetOption = (value: unknown): value is { setOption: (key: string, next: unknown) => void } => {
  return isRecord(value) && typeof value.setOption === "function"
}

export const setOptionIfSupported = (value: unknown, key: string, next: unknown) => {
  if (!hasSetOption(value)) return
  value.setOption(key, next)
}

export const getHoveredLinkText = (value: unknown) => {
  if (!isRecord(value)) return
  const link = value.currentHoveredLink
  if (!isRecord(link)) return
  if (typeof link.text !== "string") return
  return link.text
}

export const getSpeechRecognitionCtor = <T>(value: unknown): (new () => T) | undefined => {
  if (!isRecord(value)) return
  const ctor =
    typeof value.webkitSpeechRecognition === "function" ? value.webkitSpeechRecognition : value.SpeechRecognition
  if (typeof ctor !== "function") return
  return ctor as new () => T
}

export const getMediaDevices = <T>(value: unknown): T | undefined => {
  if (!isRecord(value)) return
  const nav = value.navigator
  if (!isRecord(nav)) return
  const media = nav.mediaDevices
  if (!isRecord(media)) return
  if (typeof media.getUserMedia !== "function") return
  return media as T
}

export const getPermissions = <T>(value: unknown): T | undefined => {
  if (!isRecord(value)) return
  const nav = value.navigator
  if (!isRecord(nav)) return
  const perms = nav.permissions
  if (!isRecord(perms)) return
  if (typeof perms.query !== "function") return
  return perms as T
}

export const getSpeechSynthesis = <T>(value: unknown): T | undefined => {
  if (!isRecord(value)) return
  const synth = value.speechSynthesis
  if (!isRecord(synth)) return
  if (typeof synth.speak !== "function") return
  if (typeof synth.cancel !== "function") return
  return synth as T
}

export const getSpeechSynthesisUtteranceCtor = <T>(value: unknown): (new (text?: string) => T) | undefined => {
  if (!isRecord(value)) return
  if (typeof value.SpeechSynthesisUtterance !== "function") return
  return value.SpeechSynthesisUtterance as new (text?: string) => T
}
