import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type {
  ApprovalHandler,
  ToolCallRequest,
  ToolRegistryLike,
  ToolSpec,
} from "./types.ts";

export interface ToolResult {
  output: string;
  isError: boolean;
}

export interface RegistryOptions {
  root: string;
  /** Auto-approve mutating tools (write_file, edit_file, run_command). */
  yolo?: boolean;
  /** Max characters of any tool output fed back to the model. */
  outputCapChars?: number;
}

const MAX_READ_BYTES = 256 * 1024;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_FILES = 4000;
const MAX_GLOB_RESULTS = 500;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_LIST_ENTRIES = 1000;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  "dist",
  "out",
  "build",
  ".next",
  ".turbo",
]);

function truncate(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n… [output truncated at ${cap} chars]`;
}

/* ------------------------------------------------------------------ */
/* glob matching (dependency-free subset)                              */
/* ------------------------------------------------------------------ */

interface GlobRegex {
  regex: RegExp;
}

export function compileGlob(pattern: string): GlobRegex {
  const expanded = expandBraces(pattern);
  const regexes = expanded.map((p) => new RegExp(`^${globToRegex(p)}$`, "i"));
  return { regex: joinAny(regexes) };
}

function joinAny(regexes: RegExp[]): RegExp {
  if (regexes.length === 1) return regexes[0]!;
  const sources = regexes.map((r) => `(?:${r.source})`);
  return new RegExp(sources.join("|"), "i");
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [pattern];
  const prefix = pattern.slice(0, open);
  const body = pattern.slice(open + 1, close);
  const suffix = pattern.slice(close + 1);
  const parts = splitTopLevel(body, ",");
  if (parts.length <= 1) return [pattern];
  const out: string[] = [];
  for (const part of parts) {
    out.push(...expandBraces(`${prefix}${part}${suffix}`));
  }
  return out;
}

function splitTopLevel(body: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function globToRegex(pattern: string): string {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        const after = pattern[i + 2];
        if (after === "/") {
          re += "(?:.*/)?";
          i += 3;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/\\\\]*";
      i++;
      continue;
    }
    if (ch === "?") {
      re += "[^/\\\\]";
      i++;
      continue;
    }
    re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i++;
  }
  return re;
}

/* ------------------------------------------------------------------ */
/* workspace confinement                                               */
/* ------------------------------------------------------------------ */

export function resolveInsideRoot(root: string, requested?: string): string {
  const abs = path.resolve(root, requested && requested.length > 0 ? requested : ".");
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `path escapes the workspace root (${requested ?? "."} resolves outside ${root})`,
    );
  }
  return abs;
}

type VisitResult = void | "stop";

async function walkFiles(
  dir: string,
  relPrefix: string,
  visit: (absPath: string, relPath: string) => VisitResult | Promise<VisitResult>,
  state: { count: number; max: number },
): Promise<VisitResult> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      const stopped = await walkFiles(abs, rel, visit, state);
      if (stopped === "stop") return "stop";
    } else if (entry.isFile()) {
      state.count++;
      if (state.count > state.max) return "stop";
      const result = await visit(abs, rel);
      if (result === "stop") return "stop";
    }
  }
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

type Impl = (
  args: Record<string, unknown>,
  ctx: { approval: ApprovalHandler },
) => Promise<ToolResult>;

export class ToolRegistry implements ToolRegistryLike {
  private readonly specsByName = new Map<string, ToolSpec>();
  private readonly impls = new Map<string, Impl>();
  private readonly approvalKinds = new Set<string>();
  private readonly root: string;
  private readonly yolo: boolean;
  private readonly outputCapChars: number;

  constructor(options: RegistryOptions) {
    this.root = path.resolve(options.root);
    this.yolo = options.yolo ?? false;
    this.outputCapChars = options.outputCapChars ?? 20_000;
    this.registerDefaults();
  }

  get workspaceRoot(): string {
    return this.root;
  }

  private register(spec: ToolSpec, impl: Impl, needsApproval = false): void {
    this.specsByName.set(spec.name, spec);
    this.impls.set(spec.name, impl);
    if (needsApproval) this.approvalKinds.add(spec.name);
  }

  private registerDefaults(): void {
    this.register(
      {
        name: "read_file",
        description:
          "Read a text file inside the workspace. Returns up to 2000 lines with line numbers.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path" },
            offset_line: { type: "number", description: "1-based start line" },
            limit_lines: { type: "number", description: "Max lines to return" },
          },
          required: ["path"],
        },
      },
      async (args) => {
        const abs = resolveInsideRoot(this.root, str(args["path"]));
        const offset = Math.max(1, num(args["offset_line"], 1));
        const limit = Math.max(1, Math.min(num(args["limit_lines"], 2000), 2000));
        const handle = await fs.open(abs, "r");
        try {
          const slice = Buffer.alloc(Math.min(MAX_READ_BYTES, 4_000_000_000));
          const { bytesRead } = await handle.read(slice, 0, slice.length, 0);
          const content = slice.subarray(0, bytesRead).toString("utf8");
          const lines = content.split(/\r?\n/);
          const selected = lines.slice(offset - 1, offset - 1 + limit);
          const numbered = selected.map((l, i) => `${offset + i}: ${l}`).join("\n");
          const more =
            lines.length > offset - 1 + limit
              ? `\n… [file has ${lines.length} lines; showing ${offset}-${offset - 1 + selected.length}]`
              : "";
          return { output: numbered + more, isError: false };
        } finally {
          await handle.close();
        }
      },
    );

    this.register(
      {
        name: "write_file",
        description:
          "Create or overwrite a file in the workspace with the given content.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path" },
            content: { type: "string", description: "Full file content" },
          },
          required: ["path", "content"],
        },
      },
      async (args, ctx) => {
        const rel = str(args["path"]);
        if (!(await this.mutatingAllowed(ctx.approval, "write_file", rel))) {
          return { output: "user denied permission", isError: true };
        }
        const abs = resolveInsideRoot(this.root, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, str(args["content"]), "utf8");
        return { output: `wrote ${rel}`, isError: false };
      },
      true,
    );

    this.register(
      {
        name: "edit_file",
        description:
          "Replace an exact substring in an existing workspace file. Fails unless the match is unique (use replace_all to change every occurrence).",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path" },
            old_string: { type: "string", description: "Exact text to find" },
            new_string: { type: "string", description: "Replacement text" },
            replace_all: { type: "boolean", description: "Replace all occurrences" },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
      async (args, ctx) => {
        const rel = str(args["path"]);
        if (!(await this.mutatingAllowed(ctx.approval, "edit_file", rel))) {
          return { output: "user denied permission", isError: true };
        }
        const abs = resolveInsideRoot(this.root, rel);
        const original = await fs.readFile(abs, "utf8");
        const oldString = str(args["old_string"]);
        const newString = str(args["new_string"]);
        const occurrences = original.split(oldString).length - 1;
        if (occurrences === 0) {
          return { output: "old_string not found in file", isError: true };
        }
        if (occurrences > 1 && args["replace_all"] !== true) {
          return {
            output: `old_string occurs ${occurrences} times; pass replace_all=true or provide more context`,
            isError: true,
          };
        }
        const updated = args["replace_all"] === true
          ? original.split(oldString).join(newString)
          : original.replace(oldString, () => newString);
        await fs.writeFile(abs, updated, "utf8");
        return {
          output: `edited ${rel} (${occurrences > 1 ? occurrences : 1} replacement${occurrences > 1 ? "s" : ""})`,
          isError: false,
        };
      },
      true,
    );

    this.register(
      {
        name: "list_dir",
        description: "List entries of a directory inside the workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Directory path (default: workspace root)" },
          },
        },
      },
      async (args) => {
        const abs = resolveInsideRoot(this.root, str(args["path"]));
        const entries = await fs.readdir(abs, { withFileTypes: true });
        const lines: string[] = [];
        for (const e of entries.slice(0, MAX_LIST_ENTRIES)) {
          lines.push(e.isDirectory() ? `${e.name}/` : e.name);
        }
        if (entries.length > MAX_LIST_ENTRIES) {
          lines.push(`… [${entries.length - MAX_LIST_ENTRIES} more entries]`);
        }
        return { output: lines.join("\n"), isError: false };
      },
    );

    this.register(
      {
        name: "glob",
        description:
          "Find files by wildcard pattern relative to the workspace root. Supports **, *, ?, and {a,b}. Skips node_modules/.git/dist.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: 'e.g. "src/**/*.ts"' },
          },
          required: ["pattern"],
        },
      },
      async (args) => {
        const matcher = compileGlob(str(args["pattern"]));
        const results: string[] = [];
        await walkFiles(
          this.root,
          "",
          (_abs, rel) => {
            if (matcher.regex.test(rel.replaceAll("\\", "/"))) results.push(rel);
            if (results.length >= MAX_GLOB_RESULTS) return "stop";
          },
          { count: 0, max: Number.MAX_SAFE_INTEGER },
        );
        if (results.length === 0) return { output: "no matches", isError: false };
        return { output: results.join("\n"), isError: false };
      },
    );

    this.register(
      {
        name: "grep",
        description:
          "Search file contents with a regular expression across the workspace. Returns path:line:text matches.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "JavaScript regular expression" },
            include: { type: "string", description: 'Optional filename glob, e.g. "*.ts"' },
            path: { type: "string", description: "Subdirectory to search (default: root)" },
          },
          required: ["pattern"],
        },
      },
      async (args) => {
        let regex: RegExp;
        try {
          regex = new RegExp(str(args["pattern"]));
        } catch (err) {
          return { output: `invalid regex: ${msg(err)}`, isError: true };
        }
        const includeMatcher = args["include"]
          ? compileGlob(basenamePattern(str(args["include"])))
          : undefined;
        const baseDir = resolveInsideRoot(this.root, str(args["path"]));
        const baseRel = path.relative(this.root, baseDir).replaceAll("\\", "/");
        const matches: string[] = [];
        await walkFiles(
          baseDir,
          baseRel,
          async (abs, rel) => {
            if (includeMatcher && !includeMatcher.regex.test(rel.replaceAll("\\", "/"))) {
              return;
            }
            const stat = await fs.stat(abs);
            if (stat.size > 1024 * 1024) return;
            const content = await fs.readFile(abs, "utf8").catch(() => null);
            if (content === null) return;
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i]!)) {
                matches.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 300)}`);
                if (matches.length >= MAX_GREP_MATCHES) return "stop";
              }
            }
          },
          { count: 0, max: MAX_GREP_FILES },
        );
        if (matches.length === 0) return { output: "no matches", isError: false };
        return { output: matches.join("\n"), isError: false };
      },
    );

    this.register(
      {
        name: "run_command",
        description:
          "Run a shell command (cmd.exe /c) in the workspace root and capture stdout/stderr. Times out at 120s max.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command line to execute" },
            timeout_ms: { type: "number", description: "Timeout in ms (default 30000)" },
          },
          required: ["command"],
        },
      },
      async (args, ctx) => {
        const command = str(args["command"]);
        if (!(await this.mutatingAllowed(ctx.approval, "run_command", command))) {
          return { output: "user denied permission", isError: true };
        }
        const timeout = Math.min(
          Math.max(num(args["timeout_ms"], DEFAULT_COMMAND_TIMEOUT_MS), 1000),
          120_000,
        );
        return runShellCommand(command, this.root, timeout);
      },
      true,
    );
  }

  private async mutatingAllowed(
    approval: ApprovalHandler,
    kind: string,
    detail: string,
  ): Promise<boolean> {
    if (this.yolo) return true;
    return approval({
      kind: kind as "run_command" | "write_file" | "edit_file",
      title: kind,
      detail,
    });
  }

  specs(): ToolSpec[] {
    return [...this.specsByName.values()];
  }

  async invoke(
    call: ToolCallRequest,
    ctx: { approval: ApprovalHandler },
  ): Promise<ToolResult> {
    const impl = this.impls.get(call.name);
    if (!impl) {
      return { output: `unknown tool: ${call.name}`, isError: true };
    }
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(call.arguments || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("arguments must be a JSON object");
      }
      args = parsed as Record<string, unknown>;
    } catch (err) {
      return { output: `invalid arguments JSON: ${msg(err)}`, isError: true };
    }
    try {
      const result = await impl(args, ctx);
      return { ...result, output: truncate(result.output, this.outputCapChars) };
    } catch (err) {
      return { output: `error: ${msg(err)}`, isError: true };
    }
  }
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<ToolResult> {
  const shell = process.env.ComSpec || "cmd.exe";
  return new Promise<ToolResult>((resolve) => {
    const child = spawn(shell, ["/d", "/s", "/c", command], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const cap = 64 * 1024;
    child.stdout!.on("data", (d: Buffer) => {
      if (stdout.length < cap) stdout += d.toString("utf8");
    });
    child.stderr!.on("data", (d: Buffer) => {
      if (stderr.length < cap) stderr += d.toString("utf8");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.on("error", (err) =>
      finish({ output: `error: ${err.message}`, isError: true }),
    );
    child.on("close", (code) => {
      const combined = [
        stdout.trim(),
        stdout.trim() && stderr.trim() ? "--- stderr ---" : "",
        stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, cap);
      if (timedOut) {
        finish({
          output: `command timed out after ${timeoutMs}ms\n${combined}`,
          isError: true,
        });
      } else {
        finish({
          output: `exit code ${code}\n${combined}`.trim(),
          isError: code !== 0,
        });
      }
    });
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
}

function basenamePattern(include: string): string {
  // "*.ts" should match any directory depth.
  if (!include.includes("/")) return `**/${include}`;
  return include;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
