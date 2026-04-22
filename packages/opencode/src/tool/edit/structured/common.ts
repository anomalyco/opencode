import path from "path"
import { FileTime } from "@/file/time"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { WriteTool } from "../write"
import { assertExternalDirectory } from "@/tool/external-directory"
import type { Tool } from "@/tool/shared/tool"

export function resolve(file: string) {
  return path.isAbsolute(file) ? file : path.resolve(Instance.directory, file)
}

export async function load(file: string, ctx: Tool.Context, create?: string) {
  const out = resolve(file)
  await assertExternalDirectory(ctx, out)
  const has = await Filesystem.exists(out)
  if (!has) {
    if (create === undefined) throw new Error(`File not found: ${out}`)
    return {
      file: out,
      text: create,
      exists: false,
      eol: "\n" as const,
    }
  }

  const text = await Filesystem.readText(out)
  await FileTime.read(ctx.sessionID, out)
  return {
    file: out,
    text,
    exists: true,
    eol: text.includes("\r\n") ? ("\r\n" as const) : ("\n" as const),
  }
}

export function ptr(input?: string) {
  if (!input) return []
  if (input === "") return []
  if (!input.startsWith("/")) throw new Error("pointer must start with '/' and use JSON Pointer syntax")
  return input
    .split("/")
    .slice(1)
    .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))
}

export function at(root: unknown, pointer?: string) {
  let cur = root
  let seen = ""

  for (const item of ptr(pointer)) {
    seen += `/${item}`

    if (Array.isArray(cur)) {
      const idx = Number(item)
      if (!Number.isInteger(idx)) throw new Error(`Pointer segment '${item}' is not a valid array index at ${seen}`)
      if (idx < 0 || idx >= cur.length) throw new Error(`Array index out of range at ${seen}`)
      cur = cur[idx]
      continue
    }

    if (cur && typeof cur === "object") {
      if (!(item in cur)) throw new Error(`Missing key '${item}' at ${seen}`)
      cur = (cur as Record<string, unknown>)[item]
      continue
    }

    throw new Error(`Cannot descend into ${typeof cur} at ${seen}`)
  }

  return cur
}

export function put(root: unknown, pointer: string | undefined, value: unknown) {
  const path = ptr(pointer)
  if (path.length === 0) return value
  if (!root || typeof root !== "object") throw new Error("Frontmatter root is not an object")

  let cur = root as Record<string, unknown>
  for (const item of path.slice(0, -1)) {
    const hit = cur[item]
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) {
      cur[item] = {}
    }
    cur = cur[item] as Record<string, unknown>
  }

  cur[path.at(-1)!] = value
  return root
}

export function drop(root: unknown, pointer?: string) {
  const path = ptr(pointer)
  if (path.length === 0) return {}
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new Error("Frontmatter root is not an object")

  let cur = root as Record<string, unknown>
  for (const item of path.slice(0, -1)) {
    const hit = cur[item]
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) {
      throw new Error(`Missing key '${item}' while deleting frontmatter path`)
    }
    cur = hit as Record<string, unknown>
  }

  const key = path.at(-1)!
  if (!(key in cur)) throw new Error(`Missing key '${key}' while deleting frontmatter path`)
  delete cur[key]
  return root
}

export async function save(file: string, content: string, ctx: Tool.Context, note: string) {
  const tool = await WriteTool.init()
  const out = await tool.execute({ filePath: file, content }, ctx)
  return {
    ...out,
    output: `${note}\n\n${out.output}`,
  }
}

export function obj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function arr(root: unknown, pointer?: string) {
  const hit = at(root, pointer)
  if (!Array.isArray(hit)) throw new Error(`Target at ${pointer ?? "/"} is not an array`)
  return hit
}

export function normalize(text: string, eol: "\n" | "\r\n") {
  if (eol === "\n") return text.replaceAll("\r\n", "\n")
  return text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")
}
