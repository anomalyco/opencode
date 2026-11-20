import path from "node:path"

/**
 * Where a native picker may open, best first: `check` must exist for `use` to be passed as its default path. Without
 * one, Windows opens at the Desktop, and shows "Location is not available" before the picker when that folder is
 * missing or redirected away; a folder that exists always opens cleanly. A save picker keeps the suggested file name
 * in whichever folder it opens. A relative request names no folder and is ignored.
 */
export function pickerStarts(requested: string | undefined, home: string, save: boolean) {
  const named = requested?.trim() && path.isAbsolute(requested) ? requested : undefined

  return [
    ...(named ? [{ check: save ? path.dirname(named) : named, use: named }] : []),
    { check: home, use: save && named ? path.join(home, path.basename(named)) : home },
  ]
}
