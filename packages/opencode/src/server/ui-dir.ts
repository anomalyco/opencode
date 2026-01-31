let uiDir: string | undefined

export function setUiDir(path?: string) {
  uiDir = path
}

export function getUiDir() {
  return uiDir
}
