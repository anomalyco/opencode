export function hiddenWindowOptions(os: NodeJS.Platform = process.platform) {
  return { windowsHide: os === "win32" }
}
