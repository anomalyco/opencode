import path from "path"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"

export type GuardOptions = {
  bypass?: boolean
  message?: string
}

export function resolve(input: string) {
  return path.isAbsolute(input) ? input : path.join(Instance.directory, input)
}

export function guard(input: string, options: GuardOptions = {}) {
  const resolved = resolve(input)
  if (!options.bypass && !Filesystem.contains(Instance.directory, resolved)) {
    const message = options.message ?? `File ${resolved} is not in the current working directory`
    throw new Error(message)
  }
  return resolved
}
