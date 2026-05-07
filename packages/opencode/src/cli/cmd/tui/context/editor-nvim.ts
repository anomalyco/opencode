import { readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import z from "zod"
import type { EditorSelection } from "./editor"

const NvimPositionSchema = z.object({
  line: z.number(),
  column: z.number(),
  offset: z.number(),
})

const NvimProbeSchema = z.object({
  cwd: z.string(),
  file: z.string(),
  mode: z.string(),
  cursor: NvimPositionSchema,
  visual_start: NvimPositionSchema,
  visual_end: NvimPositionSchema,
  current_line: z.string(),
  selected_lines: z.array(z.string()),
  buffers: z.array(z.string()),
})

const nvimProbeExpression = String.raw`luaeval('vim.json.encode((function()
  local function pos(mark)
    local value = vim.fn.getpos(mark)
    return { line = value[2], column = value[3], offset = value[4] }
  end

  local function listed_buffers()
    local buffers = {}
    for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_is_loaded(buffer) then
        local name = vim.api.nvim_buf_get_name(buffer)
        if name ~= "" then
          table.insert(buffers, name)
        end
      end
    end
    return buffers
  end

  local mode = vim.api.nvim_get_mode().mode
  local active_selection = mode == "v" or mode == "V" or mode == "s" or mode == "S"
  local visual_start = active_selection and pos("v") or pos("''<")
  local visual_end = active_selection and pos(".") or pos("''>")
  local selected_lines = {}
  if visual_start.line > 0 and visual_end.line > 0 then
    local start_line = math.min(visual_start.line, visual_end.line)
    local end_line = math.max(visual_start.line, visual_end.line)
    selected_lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  end

  return {
    cwd = vim.fn.getcwd(),
    file = vim.api.nvim_buf_get_name(0),
    mode = mode,
    cursor = pos("."),
    visual_start = visual_start,
    visual_end = visual_end,
    current_line = vim.api.nvim_get_current_line(),
    selected_lines = selected_lines,
    buffers = listed_buffers(),
  }
end)())')`

type NvimProbe = z.infer<typeof NvimProbeSchema>

export type NvimSelectionResult =
  | { type: "selection"; selection: EditorSelection }
  | { type: "empty" }
  | { type: "unavailable" }

export async function resolveNvimSelection(cwd = process.cwd()): Promise<NvimSelectionResult> {
  const sockets = resolveNvimSockets()
  if (sockets.length === 0) return { type: "empty" }

  const probes = (await Promise.all(sockets.map(queryNvimSocket))).flatMap((result) => {
    if (result.type !== "probe") return []
    const score = scoreNvimWorkspace(result.probe, cwd)
    if (score === 0) return []
    return [{ socket: result.socket, probe: result.probe, score }]
  })

  const match = probes.sort((left, right) => right.score - left.score)[0]
  if (!match) return { type: "empty" }

  const selection = nvimProbeToSelection(match.probe)
  if (!selection) return { type: "empty" }

  return { type: "selection", selection }
}

export function resolveNvimSockets() {
  if (process.platform !== "linux") return []

  return Array.from(
    new Set(
      [
        process.env.NVIM_LISTEN_ADDRESS,
        ...scanSocketDirectory(process.env.XDG_RUNTIME_DIR),
        ...scanSocketDirectory(path.join("/run/user", String(process.getuid?.() ?? os.userInfo().uid))),
      ].filter((item): item is string => Boolean(item)),
    ),
  )
}

async function queryNvimSocket(socket: string) {
  try {
    const proc = Bun.spawn(["nvim", "--server", socket, "--remote-expr", nvimProbeExpression], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = setTimeout(() => proc.kill(), 750)
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]).finally(() => {
      clearTimeout(timeout)
    })
    if (exitCode !== 0) return { type: "unavailable" as const }

    const parsed = NvimProbeSchema.safeParse(JSON.parse(stdout) as unknown)
    if (!parsed.success) return { type: "unavailable" as const }
    return { type: "probe" as const, socket, probe: parsed.data }
  } catch {
    return { type: "unavailable" as const }
  }
}

function nvimProbeToSelection(probe: NvimProbe): EditorSelection | undefined {
  if (!isFilePath(probe.file)) return undefined

  const range = nvimSelectedRange(probe) ?? nvimCursorRange(probe)
  if (!range) return undefined

  return {
    filePath: probe.file,
    source: "nvim",
    ranges: [range],
  }
}

function nvimSelectedRange(probe: NvimProbe): EditorSelection["ranges"][number] | undefined {
  if (!isNvimSelectionMode(probe.mode)) return undefined
  if (probe.visual_start.line <= 0 || probe.visual_end.line <= 0 || probe.selected_lines.length === 0) return undefined

  const start = compareNvimPosition(probe.visual_start, probe.visual_end) <= 0 ? probe.visual_start : probe.visual_end
  const end = start === probe.visual_start ? probe.visual_end : probe.visual_start
  if (start.line === end.line && start.column === end.column) return undefined

  if (probe.mode === "V" || probe.mode === "S") {
    return {
      text: probe.selected_lines.join("\n"),
      selection: {
        start: { line: start.line, character: 1 },
        end: {
          line: end.line,
          character: (probe.selected_lines[probe.selected_lines.length - 1] ?? "").length + 1,
        },
      },
    }
  }

  const text = probe.selected_lines
    .map((line, index) => {
      if (probe.selected_lines.length === 1) return sliceNvimLine(line, start.column, end.column, true)
      if (index === 0) return sliceNvimLine(line, start.column)
      if (index === probe.selected_lines.length - 1) return sliceNvimLine(line, 1, end.column, true)
      return line
    })
    .join("\n")

  return {
    text,
    selection: {
      start: { line: start.line, character: nvimColumnToCharacter(probe.selected_lines[0] ?? "", start.column) },
      end: {
        line: end.line,
        character: nvimColumnToCharacter(probe.selected_lines[probe.selected_lines.length - 1] ?? "", end.column, true),
      },
    },
  }
}

function nvimCursorRange(probe: NvimProbe): EditorSelection["ranges"][number] | undefined {
  if (probe.cursor.line <= 0 || probe.cursor.column <= 0) return undefined

  return {
    text: "",
    selection: {
      start: { line: probe.cursor.line, character: nvimColumnToCharacter(probe.current_line, probe.cursor.column) },
      end: { line: probe.cursor.line, character: nvimColumnToCharacter(probe.current_line, probe.cursor.column) },
    },
  }
}

function scanSocketDirectory(directory: string | undefined): string[] {
  if (!directory) return []

  try {
    const entries = readdirSync(directory, { withFileTypes: true })
    return [
      ...entries
        .filter((entry) => entry.isSocket() && entry.name.toLowerCase().includes("nvim"))
        .map((entry) => path.join(directory, entry.name)),
      ...entries
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes("nvim"))
        .flatMap((entry) => scanSocketDirectory(path.join(directory, entry.name))),
    ]
  } catch {
    return []
  }
}

function scoreNvimWorkspace(probe: NvimProbe, cwd: string) {
  return Math.max(
    pathContainsLength(probe.cwd, cwd),
    isFilePath(probe.file) ? pathContainsLength(path.dirname(probe.file), cwd) : 0,
    ...probe.buffers.map((buffer) => (isFilePath(buffer) ? pathContainsLength(path.dirname(buffer), cwd) : 0)),
  )
}

function compareNvimPosition(left: z.infer<typeof NvimPositionSchema>, right: z.infer<typeof NvimPositionSchema>) {
  return left.line - right.line || left.column - right.column
}

function sliceNvimLine(line: string, startColumn: number, endColumn?: number, includeEnd?: boolean) {
  return line.slice(
    utf8ByteOffsetToStringIndex(line, Math.max(startColumn - 1, 0)),
    endColumn == null ? undefined : utf8ByteOffsetToStringIndex(line, Math.max(endColumn - (includeEnd ? 0 : 1), 0)),
  )
}

function nvimColumnToCharacter(line: string, column: number, includeEnd?: boolean) {
  return utf8ByteOffsetToStringIndex(line, Math.max(column - (includeEnd ? 0 : 1), 0)) + 1
}

function utf8ByteOffsetToStringIndex(text: string, byteOffset: number) {
  if (byteOffset <= 0) return 0

  const utf8 = new TextEncoder()
  let bytes = 0
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) return text.length

    const nextIndex = index + (codePoint > 0xffff ? 2 : 1)
    bytes += utf8.encode(text.slice(index, nextIndex)).length
    if (bytes >= byteOffset) return nextIndex
    index = nextIndex
  }

  return text.length
}

function pathContainsLength(parent: string, child: string) {
  const resolved = path.resolve(parent)
  const relative = path.relative(resolved, path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved.length : 0
}

function isFilePath(value: string) {
  return path.isAbsolute(value) && !value.includes("://")
}

function isNvimSelectionMode(mode: string) {
  return mode === "v" || mode === "V" || mode === "s" || mode === "S"
}
