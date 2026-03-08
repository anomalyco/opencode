import path from "path"
import { Filesystem } from "@/util/filesystem"

export const Dir = {
  root() {
    return Filesystem.resolve(process.env.PWD ?? process.cwd())
  },
  project(input?: string) {
    const root = Dir.root()
    const next = input ? Filesystem.resolve(path.isAbsolute(input) ? input : path.join(root, input)) : root
    return Dir.enter(next)
  },
  enter(input: string) {
    process.chdir(input)
    return process.cwd()
  },
}
