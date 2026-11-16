/** Remote preview requests use portable workspace-relative segments, never a server or OS address. */
export function previewPath(path: string, windows = false) {
  return !/^[a-z]:\//i.test(path) && path.split("/").every((part) => !!part && part !== "." && part !== ".." &&
    !/[\\\u0000-\u001f]/.test(part) && (!windows || windowsPreviewSegment(part)))
}

export function windowsPreviewSegment(part: string) {
  return !/[:\\]|[. ]$|^(?:con(?:in\$|out\$)?|nul|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
}
