const rendererPermissions = new Set(["clipboard-sanitized-write", "notifications"])

export function isRendererPermission(permission: string) {
  return rendererPermissions.has(permission)
}

export function isMainWindowWebContents(id: number, windowIds: number[]) {
  return windowIds.includes(id)
}
