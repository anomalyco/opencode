/** Remote preview requests use portable workspace-relative segments, never a server or OS address. */
export function previewPath(path: string) {
  return path.split("/").every((part) => !!part && !/[\\:\u0000-\u001f]|[. ]$/.test(part) &&
    !/^(?:con(?:in\$|out\$)?|nul|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}
