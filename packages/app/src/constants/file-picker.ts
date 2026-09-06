export const ACCEPTED_FILE_TYPES = ["*/*"]
export const ACCEPTED_FILE_EXTENSIONS: string[] = []

export function filePickerFilters(name: string, ext?: string[]) {
  if (!ext || ext.length === 0) return undefined
  return [{ name, extensions: ext }]
}
