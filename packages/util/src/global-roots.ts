import os from "os"
import path from "path"
import { xdgCache, xdgConfig, xdgData, xdgState } from "xdg-basedir"

/** The XDG base directories that root opencode's global paths. */
export function roots(app: string) {
  return {
    data: path.join(xdgData!, app),
    cache: path.join(xdgCache!, app),
    config: path.join(xdgConfig!, app),
    state: path.join(xdgState!, app),
    tmp: path.join(os.tmpdir(), app),
  }
}
