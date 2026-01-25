export const MAX_FILE_SIZE = 5 * 1024 * 1024

export const ALLOWED_AUDIO_EXTENSIONS = ["mp3", "wav", "aac", "aiff", "ogg", "flac", "m4a", "wma"]

export function getFileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? ""
}

export function isAudioFile(path: string): boolean {
  return ALLOWED_AUDIO_EXTENSIONS.includes(getFileExtension(path))
}

export function getFilename(path: string): string {
  return path.split(/[/\\]/).pop() ?? ""
}
