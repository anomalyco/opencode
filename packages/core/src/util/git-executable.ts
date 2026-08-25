import path from "path"
import { which } from "./which.js"

const resolved = process.platform === "win32" ? which("git") : undefined

export const gitExecutable = resolved ? path.resolve(resolved) : "git"
