import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onMount,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { Switch as Toggle } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { applyEdits, modify } from "jsonc-parser"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { paint } from "@/components/prompt-input/expand"
import { DialogConnectProvider } from "@/components/dialog-connect-provider"
import {
  OPENAI_COMPATIBLE,
  headerRow as blankHeaderRow,
  modelRow as blankModelRow,
  type FormState,
  type HeaderRow,
  type ModelRow,
  validateCustomProvider,
} from "@/components/dialog-custom-provider-form"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import {
  type ConfigTreeItem,
  type ConfigWorkspace,
  type GenericagentConfig,
  type HermesConfig,
  type OpenclawConfig,
  usePlatform,
} from "@/context/platform"
import { monoFontFamily, useSettings } from "@/context/settings"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { normalizeProviderList } from "@/context/global-sync/utils"
import { ServerConnection, useServer } from "@/context/server"
import { extraAgents, mainDomain } from "@/pages/layout/extra-agents"
import {
  basename,
  classifyPluginSource,
  classifySkillSource,
  isFilePath,
  localPath,
  normalizePath,
} from "@/utils/config-source"
import type { Agent, Config, Project, ProviderListResponse } from "@opencode-ai/sdk/v2/client"

const CORE_SECTIONS = ["agents-md", "providers", "agents", "skills", "plugins", "claws"] as const
type CoreSection = (typeof CORE_SECTIONS)[number]
type Section = CoreSection | (string & {})

function isKnownSection(value: string): boolean {
  if ((CORE_SECTIONS as readonly string[]).includes(value)) return true
  return extraAgents.some((agent) => agent.configSection === value)
}

type SkillGroup = "opencode" | "claude" | "project" | "external" | "plugin"

type DocItem = {
  id: string
  label: string
  path: string
  editable: boolean
  source: string
  note?: string
  content?: string
  warn?: string
  group?: SkillGroup
  project?: string
  origin?: string
  root?: string
}

type SkillItem = {
  name: string
  description: string
  location: string
  content: string
  editable: boolean
  source: string
  warn?: string
  group: SkillGroup
  project?: string
  origin?: string
  root?: string
}

type ProviderItem = {
  id: string
  name: string
  connected: boolean
  allowed: boolean
  custom: boolean
  source?: "env" | "api" | "config" | "custom"
  sdk?: string
  key?: string
  env?: string[]
  models: string[]
}

type ProviderCfg = NonNullable<Config["provider"]>[string]

type CustomState = FormState & {
  mode: "create" | "edit"
  saving: boolean
  deleting: boolean
  secret: boolean
}

const CUSTOM_NEW = "provider:_new_custom"
const SKILL_NEW = "skill:_new_custom"

type PluginItem = {
  id: string
  label: string
  name: string
  enabled: boolean
  exists: boolean
  path?: string
  spec?: string
  group: "global" | "project" | "external"
  project?: string
  root?: string
  origin?: string
}

type PluginSource = Pick<PluginItem, "group" | "project" | "root" | "origin">

type ClawItem = {
  id: string
  label: string
  note: string
  meta?: string
  enabled: boolean
}

type TreeNode = {
  path: string
  kind: "file" | "directory"
  kids: TreeNode[]
}

function name(path: string) {
  return basename(path)
}

function dir(path: string) {
  const list = path.split(/[\\/]/)
  if (list.length < 2) return path
  return list.slice(0, -1).join("/")
}

function short(path: string, root?: string) {
  if (!root) return path
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "")
  const next = path.replace(/\\/g, "/")
  if (next === base) return name(next)
  if (!next.startsWith(base + "/")) return path
  return next.slice(base.length + 1)
}

function local(path: string) {
  return localPath(path)
}

function plugin(path: string) {
  const next = local(path)
  const stem = name(next).replace(/\.(?:ts|js|mjs|cjs|mts|cts)$/i, "")
  if (path.startsWith("file://")) return stem
  if (next !== path) return stem
  if (path.includes("/") || path.includes("\\")) return stem
  const last = path.lastIndexOf("@")
  if (last > 0) return path.slice(0, last)
  return path
}

function pluginKey(path: string) {
  const next = local(path)
  if (file(path)) return norm(next)
  if (path.includes("/") || path.includes("\\")) return norm(next)
  return plugin(path)
}

function spec(path: string) {
  return new URL(path.startsWith("file://") ? path : `file://${path}`).href
}

function norm(path: string) {
  return normalizePath(path)
}

function join(root: string, ...parts: string[]) {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  return [root.replace(/[\\/]+$/, ""), ...parts.map((item) => item.replace(/^[\\/]+|[\\/]+$/g, ""))]
    .filter(Boolean)
    .join(sep)
}

function file(path: string) {
  return isFilePath(path)
}

function rel(root: string, path: string) {
  const base = norm(root)
  const next = norm(path)
  if (next === base) return name(next)
  if (!next.startsWith(base + "/")) return name(next)
  return next.slice(base.length + 1)
}

function stem(path: string) {
  return path.replace(/\.(?:md|mdx|d\.ts|ts|js|mjs|cjs)$/i, "")
}

function pkg(spec: string) {
  if (spec.startsWith("file://")) return
  if (spec.includes("\\") || spec.startsWith("/") || /^[A-Za-z]:\//.test(spec)) return
  const last = spec.lastIndexOf("@")
  if (last > 0) {
    return { name: spec.slice(0, last), version: spec.slice(last + 1) || "latest" }
  }
  return { name: spec, version: "latest" }
}

function skillMeta(text: string, path: string) {
  const hit = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!hit) {
    return {
      name: name(dir(path)),
      description: "Skill metadata is incomplete.",
      warn: "Missing frontmatter. Add `name` and `description` to `SKILL.md`.",
    }
  }

  const data = hit[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
    .filter((line): line is RegExpMatchArray => !!line)
    .reduce<Record<string, string>>((acc, line) => {
      acc[line[1]] = line[2].trim().replace(/^['"]|['"]$/g, "")
      return acc
    }, {})

  const miss = [!data.name && "`name`", !data.description && "`description`"].filter((item): item is string => !!item)

  return {
    name: data.name || name(dir(path)),
    description: data.description || "Skill metadata is incomplete.",
    warn: miss.length ? `Incomplete metadata. Add ${miss.join(" and ")} to the frontmatter.` : undefined,
  }
}

const key = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "of",
  "return",
  "satisfies",
  "static",
  "super",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "using",
  "var",
  "void",
  "while",
  "with",
  "yield",
])

const prim = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"])

const punt = new Set(["(", ")", "[", "]", "{", "}", ".", ",", ";", ":", "?"])

const safe = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const tint = (value: string, color: string) => `<span style="color:${color}">${safe(value)}</span>`

function script(path?: string) {
  const ext = name(local(path ?? ""))
    .split(".")
    .at(-1)
    ?.toLowerCase()
  if (["js", "mjs", "cjs", "ts", "mts", "cts", "tsx", "jsx"].includes(ext ?? "")) return true
  return false
}

function color(value: string) {
  if (value.startsWith("//") || value.startsWith("/*")) return "var(--syntax-comment)"
  if (['"', "'", "`"].includes(value[0] ?? "")) return "var(--syntax-string)"
  if (prim.has(value)) return "var(--syntax-primitive)"
  if (/^\d/.test(value)) return "var(--syntax-constant)"
  if (punt.has(value)) return "var(--syntax-punctuation)"
  if (key.has(value)) return "var(--syntax-keyword)"
  return "var(--text-base)"
}

function paintCode(raw: string) {
  const rule =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b[A-Za-z_$][\w$]*\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?n?\b|[()[\]{}.,;:?]/g

  let at = 0
  let out = ""

  for (const hit of raw.matchAll(rule)) {
    const idx = hit.index ?? 0
    if (idx > at) out += safe(raw.slice(at, idx))
    const value = hit[0]
    out += tint(value, color(value))
    at = idx + value.length
  }

  if (at < raw.length) out += safe(raw.slice(at))
  return out || "&nbsp;"
}

function sourceKey(source?: string) {
  if (source === "opencode") return "config.badge.opencode"
  if (source === "project") return "config.badge.project"
  if (source === "external") return "config.badge.external"
  if (source === "env") return "config.badge.env"
  if (source === "api") return "config.badge.api"
  if (source === "config") return "config.badge.config"
  if (source === "custom") return "config.badge.custom"
  return undefined
}

function providerEnabled(item?: ProviderItem) {
  if (!item) return false
  return item.custom ? item.allowed : item.connected
}

function home(path: string) {
  const list = norm(path).split("/").filter(Boolean)
  if (list.at(-1) !== "opencode") return
  if (list.at(-2) !== ".config") return
  const root = path.startsWith("/") ? "/" : ""
  return root + list.slice(0, -2).join("/")
}

function sortTree(list: ConfigTreeItem[]) {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "file" ? -1 : 1
    return name(a.path).localeCompare(name(b.path))
  })
}

function ext(path: string) {
  const base = name(path)
  const dot = base.lastIndexOf(".")
  if (dot < 0) return ""
  return base.slice(dot + 1).toLowerCase()
}

function treeGlyph(path: string, kind: TreeNode["kind"]) {
  if (kind === "directory") return { tone: "folder", label: "" }
  const base = name(path).toLowerCase()
  const type = ext(path)
  if (base === "package.json") return { tone: "node", label: "N" }
  if (base.endsWith("lock.json") || base === "bun.lock" || base === "bun.lockb" || base === "pnpm-lock.yaml") {
    return { tone: "lock", label: "L" }
  }
  if (base === ".gitignore" || base === ".gitattributes" || base === ".gitmodules") return { tone: "git", label: "G" }
  if (type === "py") return { tone: "python", label: "PY" }
  if (["ts", "tsx"].includes(type)) return { tone: "ts", label: "TS" }
  if (["js", "jsx", "mjs", "cjs"].includes(type)) return { tone: "js", label: "JS" }
  if (["json", "jsonc"].includes(type)) return { tone: "json", label: "{}" }
  if (["yaml", "yml", "toml", "ini"].includes(type)) return { tone: "cfg", label: "CF" }
  if (["md", "mdx"].includes(type) || base === "readme" || base === "readme.md") return { tone: "md", label: "MD" }
  if (["sh", "bash", "zsh", "fish", "ps1"].includes(type)) return { tone: "sh", label: "SH" }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(type)) return { tone: "img", label: "IM" }
  if (["zip", "gz", "tgz", "tar", "rar", "7z"].includes(type)) return { tone: "zip", label: "AR" }
  if (["rs", "go", "java", "swift", "kt", "rb", "php", "c", "cc", "cpp", "h", "hpp"].includes(type)) {
    return { tone: "code", label: "<>" }
  }
  if (base.startsWith(".")) return { tone: "dot", label: ".*" }
  return { tone: "file", label: "FI" }
}

function TreeGlyph(props: { path: string; kind: TreeNode["kind"] }) {
  const glyph = createMemo(() => treeGlyph(props.path, props.kind))
  const tone = createMemo(() => {
    const value = glyph().tone
    if (value === "folder") return "text-[#9fb1bf]"
    if (value === "python") return "text-[#4ea1f3]"
    if (value === "ts") return "text-[#4ea1f3]"
    if (value === "js") return "text-[#f0c04a]"
    if (value === "json") return "text-[#d16d9e]"
    if (value === "cfg") return "text-[#77c3b4]"
    if (value === "md") return "text-[#5aa2ff]"
    if (value === "sh") return "text-[#7dcf85]"
    if (value === "img") return "text-[#d79a5c]"
    if (value === "zip") return "text-[#c9a66b]"
    if (value === "git") return "text-[#e47d61]"
    if (value === "lock") return "text-[#d5b46a]"
    if (value === "node") return "text-[#78b35f]"
    if (value === "dot") return "text-[#9d92c7]"
    if (value === "code") return "text-[#7aa2f7]"
    return "text-[#aeb6c2]"
  })

  return (
    <div class={`relative mt-0.5 flex size-4 shrink-0 items-center justify-center ${tone()}`}>
      <Show
        when={props.kind === "directory"}
        fallback={
          <>
            <svg viewBox="0 0 16 16" class="size-4" fill="none" aria-hidden="true">
              <path d="M3 1.75H9.25L12.25 4.75V14.25H3V1.75Z" fill="currentColor" fill-opacity="0.12" />
              <path d="M3 1.75H9.25L12.25 4.75V14.25H3V1.75Z" stroke="currentColor" stroke-width="1" />
              <path d="M9.25 1.75V4.75H12.25" stroke="currentColor" stroke-width="1" />
            </svg>
            <div class="pointer-events-none absolute inset-0 flex items-end justify-center pb-[1px] text-[7px] font-semibold leading-none tracking-[-0.02em] text-current">
              {glyph().label}
            </div>
          </>
        }
      >
        <svg viewBox="0 0 16 16" class="size-4" fill="none" aria-hidden="true">
          <path d="M1.75 4.25H6L7.25 2.75H14.25V13.25H1.75V4.25Z" fill="currentColor" fill-opacity="0.12" />
          <path d="M1.75 4.25H6L7.25 2.75H14.25V13.25H1.75V4.25Z" stroke="currentColor" stroke-width="1" />
        </svg>
      </Show>
    </div>
  )
}

function patchText(input: string, path: (string | number)[], value: unknown) {
  return applyEdits(
    input,
    modify(input, path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
      },
    }),
  )
}

function providerCfg(input: ProviderCfg | undefined): CustomState {
  const headers = input?.options?.headers
  const models = Object.entries(input?.models ?? {})
  const env = Array.isArray(input?.env) && input.env.length > 0 ? `{env:${input.env[0]}}` : ""
  const api = typeof input?.options?.apiKey === "string" ? input.options.apiKey : ""
  return {
    mode: input ? "edit" : "create",
    providerID: "",
    npm: input?.npm ?? OPENAI_COMPATIBLE,
    name: input?.name ?? "",
    baseURL: typeof input?.options?.baseURL === "string" ? input.options.baseURL : "",
    apiKey: api || env,
    models:
      models.length > 0
        ? models.map(([id, item]) => ({
            row: blankModelRow().row,
            id,
            name: typeof item?.name === "string" ? item.name : id,
            err: {},
          }))
        : [blankModelRow()],
    headers:
      headers && typeof headers === "object" && !Array.isArray(headers) && Object.keys(headers).length > 0
        ? Object.entries(headers)
            .filter((item): item is [string, string] => typeof item[1] === "string")
            .map(([key, value]) => ({
              row: blankHeaderRow().row,
              key,
              value,
              err: {},
            }))
        : [blankHeaderRow()],
    saving: false,
    deleting: false,
    secret: true,
    err: {},
  }
}

function clawCfg(input?: OpenclawConfig) {
  return {
    enabled: input?.enabled ?? false,
    url: input?.url ?? "",
    token: input?.token ?? "",
    saving: false,
    testing: false,
    err: {
      url: "",
    },
    test: undefined as undefined | { ok: boolean; logs: string[] },
    run: 0,
  }
}

function gaCfg(input?: GenericagentConfig) {
  return {
    enabled: input?.enabled ?? false,
    pythonExecutable: input?.pythonExecutable ?? "",
    genericAgentDir: input?.genericAgentDir ?? "",
    saving: false,
    testing: false,
    err: {
      genericAgentDir: "",
    },
    test: undefined as undefined | { ok: boolean; logs: string[] },
    run: 0,
  }
}

function hmCfg(input?: HermesConfig) {
  return {
    enabled: input?.enabled ?? false,
    pythonExecutable: input?.pythonExecutable ?? "",
    hermesDir: input?.hermesDir ?? "",
    hermesHome: input?.hermesHome ?? "",
    saving: false,
    testing: false,
    err: {
      hermesDir: "",
    },
    test: undefined as undefined | { ok: boolean; logs: string[] },
    run: 0,
  }
}

function fuzzy(text: string, query: string) {
  const a = text.toLowerCase()
  const b = query.trim().toLowerCase()
  if (!b) return true
  let i = 0
  for (const ch of a) {
    if (ch === b[i]) i += 1
    if (i === b.length) return true
  }
  return a.includes(b)
}

function sectionIcon(section: Section): IconProps["name"] {
  if (section === "agents-md") return "review"
  if (section === "providers") return "providers"
  if (section === "agents") return "robot"
  if (section === "skills") return "brain"
  if (section === "plugins") return "code"
  const agent = extraAgents.find((item) => item.configSection === section)
  if (agent) return agent.icon
  return "openclaw"
}

function SectionButton(props: { current: boolean; title: string; icon: IconProps["name"]; onClick: () => void }) {
  return (
    <button
      type="button"
      class="group flex w-full items-center justify-between gap-3 border-b border-border-weak-base px-4 py-4 text-left transition-colors"
      classList={{
        "bg-surface-base hover:bg-surface-base-hover": !props.current,
        "border-border-base bg-surface-base-active": props.current,
      }}
      onClick={props.onClick}
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="flex size-8 shrink-0 items-center justify-center transition-colors"
          classList={{
            "text-text-weak": !props.current,
            "text-text-strong": props.current,
          }}
        >
          <Icon name={props.icon} size="medium" />
        </div>
        <div class="truncate text-16-medium text-text-strong transition-colors">
          {props.title}
        </div>
      </div>
      <div class="size-2 rounded-full bg-border-strong transition-colors" />
    </button>
  )
}

function ListButton(props: {
  active: boolean
  title: string
  note?: string
  meta?: string
  warn?: boolean
  tone?: "danger"
  onClick: () => void
  extra?: JSX.Element
}) {
  return (
    <button
      type="button"
      class="group flex w-full items-start justify-between gap-3 border-b border-border-weak-base px-3 py-3 text-left transition-colors"
      classList={{
        "bg-surface-base hover:bg-surface-base-hover": !props.active,
        "border-border-base bg-surface-base-active": props.active,
      }}
      onClick={props.onClick}
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <div
            class="truncate text-13-medium transition-colors"
            classList={{
              "text-text-danger-base": props.tone === "danger",
              "text-text-strong": props.tone !== "danger",
            }}
          >
            {props.title}
          </div>
          <Show when={props.warn}>
            <Icon name="help" size="small" class="shrink-0 text-warning-base" />
          </Show>
        </div>
        <Show when={props.note}>
          <div
            class="mt-1 line-clamp-2 text-12-regular transition-colors"
            classList={{
              "text-text-weak": !props.active,
              "text-text-base": props.active,
            }}
          >
            {props.note}
          </div>
        </Show>
        <Show when={props.meta}>
          <div
            class="mt-2 break-all font-mono text-[12px] leading-5 transition-colors"
            classList={{
              "text-text-weak": !props.active,
              "text-text-base": props.active,
            }}
          >
            {props.meta}
          </div>
        </Show>
      </div>
      <Show when={props.extra}>
        <div class="shrink-0">{props.extra}</div>
      </Show>
    </button>
  )
}

function Wait(props: { text: string }) {
  return (
    <div class="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <Spinner class="size-4 text-icon-weak-base" />
      <div class="text-13-regular text-text-weak">{props.text}</div>
    </div>
  )
}

function Tree(props: {
  list: TreeNode[]
  root?: string
  depth?: number
  open: (path: string) => boolean
  toggle: (path: string) => void
}) {
  return (
    <div class="flex flex-col gap-1.5">
      <For each={props.list}>
        {(item, idx) => (
          <div class="relative flex flex-col gap-1">
            <Show when={(props.depth ?? 0) > 0}>
              <div
                class="pointer-events-none absolute left-3 top-0 bottom-0 border-l border-border-weak-base/60"
                style={{ left: `${3 + (props.depth ?? 0) * 14}px` }}
              />
              <div
                class="pointer-events-none absolute top-[18px] h-px bg-border-weak-base/60"
                style={{
                  left: `${3 + (props.depth ?? 0) * 14}px`,
                  width: "14px",
                }}
              />
            </Show>
            <div
              class="relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-left"
              style={{ "padding-left": `${(props.depth ?? 0) * 14}px` }}
            >
              <Show
                when={item.kind === "directory" && item.kids.length > 0}
                fallback={
                  <Show when={(props.depth ?? 0) > 0}>
                    <div class="size-3 shrink-0" />
                  </Show>
                }
              >
                <button
                  type="button"
                  class="flex size-3 shrink-0 items-center justify-center text-text-weak transition-colors hover:text-text-base"
                  onClick={() => props.toggle(item.path)}
                >
                  <Icon name={props.open(item.path) ? "chevron-down" : "chevron-right"} size="small" />
                </button>
              </Show>
              <TreeGlyph path={item.path} kind={item.kind} />
              <div
                class="min-w-0 truncate text-12-regular text-text-base"
                classList={{
                  "cursor-pointer": item.kind === "directory" && item.kids.length > 0,
                }}
                onClick={() => {
                  if (item.kind !== "directory" || item.kids.length === 0) return
                  props.toggle(item.path)
                }}
              >
                {props.depth ? name(item.path) : short(item.path, props.root)}
              </div>
            </div>
            <Show when={item.kids.length > 0 && props.open(item.path)}>
              <div class="relative">
                <Show when={idx() !== props.list.length - 1}>
                  <div
                    class="pointer-events-none absolute left-3 top-0 bottom-0 border-l border-border-weak-base/60"
                    style={{ left: `${17 + (props.depth ?? 0) * 14}px` }}
                  />
                </Show>
                <Tree
                  list={item.kids}
                  root={props.root}
                  depth={(props.depth ?? 0) + 1}
                  open={props.open}
                  toggle={props.toggle}
                />
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

function MarkdownField(props: {
  text: string
  busy: boolean
  editable: boolean
  onInput: (value: string) => void
  paint?: (value: string) => string
}) {
  const settings = useSettings()
  const language = useLanguage()
  let box: HTMLTextAreaElement | undefined
  let back: HTMLDivElement | undefined
  const html = createMemo(() => (props.paint ?? paint)(props.text))
  const font = createMemo(() => monoFontFamily(settings.appearance.font()))

  const sync = () => {
    if (!box || !back) return
    back.scrollTop = box.scrollTop
    back.scrollLeft = box.scrollLeft
  }

  createEffect(() => {
    props.text
    requestAnimationFrame(sync)
  })

  return (
    <div class="relative h-full min-h-0 overflow-hidden rounded-xl border border-border-weak-base bg-background-base">
      <div
        ref={(el) => {
          back = el
        }}
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 overflow-auto px-4 py-3 text-13-mono leading-6 whitespace-pre-wrap break-words"
        style={{ "font-family": font() }}
      >
        <div class="min-h-full w-full" innerHTML={html()} />
      </div>
      <Show when={props.busy}>
        <div class="pointer-events-none absolute left-4 top-3 z-10 text-12-regular text-text-weak">
          {language.t("config.editor.loadingFile")}
        </div>
      </Show>
      <textarea
        ref={(el) => {
          box = el
        }}
        class="absolute inset-0 size-full min-h-0 resize-none overflow-auto bg-transparent px-4 py-3 text-13-mono leading-6 focus:outline-none"
        style={{
          color: "transparent",
          "-webkit-text-fill-color": "transparent",
          "caret-color": "var(--text-strong)",
          "font-family": font(),
        }}
        spellcheck={false}
        readOnly={!props.editable}
        value={props.text}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onScroll={sync}
      />
    </div>
  )
}

function SaveButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button size="small" variant="secondary" icon="check-small" onClick={props.onClick} disabled={props.disabled}>
      {props.label}
    </Button>
  )
}

function Editor(props: {
  item?: DocItem
  text: string
  dirty: boolean
  busy: boolean
  tree?: TreeNode[]
  treeRoot?: string
  treeBusy?: boolean
  treeOpen?: (path: string) => boolean
  onTreeToggle?: (path: string) => void
  onInput: (value: string) => void
  onSave: () => void
  onReload: () => void
  onOpenFolder?: () => void
  onCopyPath?: () => void
  extra?: JSX.Element
  warn?: string
  empty: string
  markdown?: boolean
}) {
  const language = useLanguage()
  const settings = useSettings()
  const font = createMemo(() => monoFontFamily(settings.appearance.font()))
  const source = createMemo(() => sourceKey(props.item?.source))

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="border-b border-border-weak-base px-5 py-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <div class="truncate text-15-medium text-text-strong">
              {props.item?.label ?? language.t("config.editor.selectItem")}
            </div>
            <Show when={props.item?.editable !== undefined}>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {props.item?.editable
                  ? language.t("config.editor.badge.editable")
                  : language.t("config.editor.badge.readOnly")}
              </span>
            </Show>
            <Show when={source()}>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {language.t(source()!)}
              </span>
            </Show>
          </div>
          <div class="mt-1 break-all font-mono text-[12px] leading-5 text-text-weak">
            {props.item?.path ?? ""}
            <Show when={props.onCopyPath && props.item?.path}>
              <IconButton
                icon="copy"
                variant="ghost"
                size="small"
                class="ml-1 inline-flex translate-y-[1px] align-middle text-text-weak hover:bg-surface-base-hover hover:text-text-base active:bg-surface-base-active"
                aria-label={language.t("session.header.open.copyPath")}
                onClick={props.onCopyPath}
              />
            </Show>
          </div>
          <Show when={props.item?.note}>
            <div class="mt-2 text-12-regular text-text-weak">{props.item?.note}</div>
          </Show>
          <Show when={props.warn}>
            <div class="mt-3 rounded-xl border border-border-weak-base bg-surface-secondary px-3 py-2 text-12-regular text-text-danger-base">
              {props.warn}
            </div>
          </Show>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <Show when={props.extra}>
              <div>{props.extra}</div>
            </Show>
            <Show when={props.onOpenFolder}>
              <Button size="small" variant="ghost" onClick={props.onOpenFolder}>
                <Icon name="folder" size="small" class="shrink-0" />
                {language.t("config.action.openFolder")}
              </Button>
            </Show>
            <Button size="small" variant="ghost" icon="reset" onClick={props.onReload}>
              {language.t("command.server.reloadBackend")}
            </Button>
            <Button
              size="small"
              variant="secondary"
              icon="check-small"
              onClick={props.onSave}
              disabled={!props.item?.editable || !props.dirty}
            >
              {language.t("common.save")}
            </Button>
          </div>
        </div>
      </div>
      <Show when={props.item} fallback={<div class="px-5 py-10 text-13-regular text-text-weak">{props.empty}</div>}>
        <div
          class="grid min-h-0 flex-1 auto-rows-fr gap-4 px-5 py-4"
          classList={{
            "xl:grid-cols-[minmax(0,1fr)_280px]": !!props.treeRoot,
          }}
        >
          <div class="min-h-0">
            <Show
              when={props.markdown}
              fallback={
                <div class="flex h-full min-h-0 flex-col rounded-xl border border-border-weak-base bg-background-base p-3">
                  <Show when={props.busy} fallback={null}>
                    <div class="mb-3 text-12-regular text-text-weak">{language.t("config.editor.loadingFile")}</div>
                  </Show>
                  <Show
                    when={script(props.item?.path)}
                    fallback={
                      <textarea
                        class="size-full min-h-0 flex-1 resize-none bg-transparent p-1 text-13-mono text-text-base outline-none"
                        style={{ "font-family": font() }}
                        spellcheck={false}
                        readOnly={!props.item?.editable}
                        value={props.text}
                        onInput={(event) => props.onInput(event.currentTarget.value)}
                      />
                    }
                  >
                    <MarkdownField
                      text={props.text}
                      busy={props.busy}
                      editable={!!props.item?.editable}
                      onInput={props.onInput}
                      paint={paintCode}
                    />
                  </Show>
                </div>
              }
            >
              <MarkdownField
                text={props.text}
                busy={props.busy}
                editable={!!props.item?.editable}
                onInput={props.onInput}
                paint={paint}
              />
            </Show>
          </div>
          <Show when={props.treeRoot}>
            <div class="flex h-full min-h-0 flex-col rounded-xl border border-border-weak-base bg-background-base p-3">
              <div class="mb-3 text-11-medium uppercase tracking-[0.08em] text-text-weak">
                {language.t("config.editor.structure")}
              </div>
              <Show when={props.treeBusy}>
                <div class="mb-3 text-12-regular text-text-weak">{language.t("config.editor.loadingStructure")}</div>
              </Show>
              <Show
                when={(props.tree ?? []).length > 0}
                fallback={<div class="text-12-regular text-text-weak">{language.t("config.editor.noFiles")}</div>}
              >
                <div class="min-h-0 flex-1 overflow-y-auto pr-1">
                  <Tree
                    list={props.tree ?? []}
                    root={props.treeRoot}
                    open={props.treeOpen ?? (() => true)}
                    toggle={props.onTreeToggle ?? (() => undefined)}
                  />
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ProviderDetail(props: {
  item?: ProviderItem
  busy: boolean
  onToggle: (item: ProviderItem, enabled: boolean) => void
}) {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show
        when={props.item}
        fallback={<div class="px-4 py-10 text-13-regular text-text-weak">{language.t("config.provider.select")}</div>}
      >
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border-weak-base px-4 py-4">
          <div>
            <div class="flex items-center gap-2">
              <div class="text-15-medium text-text-strong">{props.item?.id}</div>
              <Show when={props.item}>
                <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                  {providerEnabled(props.item)
                    ? language.t("config.provider.badge.enabled")
                    : language.t("config.provider.badge.known")}
                </span>
              </Show>
              <Show when={sourceKey(props.item?.source)}>
                <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                  {language.t(sourceKey(props.item?.source)!)}
                </span>
              </Show>
              <Show when={props.item?.sdk}>
                <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-weak">
                  {props.item?.sdk}
                </span>
              </Show>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {language.t("config.provider.modelsCount", { count: props.item?.models.length ?? 0 })}
              </span>
            </div>
            <div class="mt-2 text-12-regular text-text-weak">
              {props.item?.custom
                ? props.item?.allowed
                  ? language.t("config.provider.customEnabled")
                  : language.t("config.provider.customDisabled")
                : props.item?.connected
                  ? props.item?.source === "env"
                    ? language.t("config.provider.envConnected")
                    : language.t("config.provider.connected")
                  : language.t("config.provider.known")}
            </div>
          </div>
          <Toggle
            checked={props.item?.custom ? !!props.item?.allowed : !!props.item?.connected}
            disabled={props.busy || (!!props.item && !props.item.custom && props.item.source === "env")}
            onChange={(value) => props.item && props.onToggle(props.item, value)}
          >
            {props.item?.custom
              ? language.t("config.provider.toggle.enabledInConfig")
              : language.t("config.provider.toggle.connected")}
          </Toggle>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="mb-3 text-11-medium uppercase tracking-[0.08em] text-text-weak">
            {language.t("config.provider.modelsTitle")}
          </div>
          <Show
            when={(props.item?.models.length ?? 0) > 0}
            fallback={
              <div class="rounded-xl border border-border-weak-base bg-background-base px-4 py-6 text-12-regular text-text-weak">
                {language.t("config.provider.noModels")}
              </div>
            }
          >
            <div class="grid gap-2">
              <For each={props.item?.models ?? []}>
                {(item, idx) => (
                  <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-border-weak-base bg-background-base px-3 py-3">
                    <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                      {String(idx() + 1).padStart(2, "0")}
                    </div>
                    <div class="min-w-0 break-all font-mono text-[12px] leading-5 text-text-base">{item}</div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function ClawEditor(props: {
  item?: ClawItem
  form: ReturnType<typeof clawCfg>
  dirty: boolean
  busy: boolean
  canTest: boolean
  onChange: (key: "enabled" | "url" | "token", value: string | boolean) => void
  onSave: () => void
  onTest: () => void
  onAbort?: () => void
}) {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show
        when={props.item}
        fallback={<div class="px-4 py-10 text-13-regular text-text-weak">{language.t("config.claws.empty")}</div>}
      >
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border-weak-base px-4 py-4">
          <div>
            <div class="flex items-center gap-2">
              <div class="text-15-medium text-text-strong">{props.item?.label}</div>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {props.form.enabled
                  ? language.t("config.claws.badge.enabled")
                  : language.t("config.claws.badge.disabled")}
              </span>
            </div>
            <div class="mt-2 text-12-regular text-text-weak">{language.t("config.claws.detail")}</div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="small"
              variant="ghost"
              icon="reset"
              onClick={props.onTest}
              disabled={!props.canTest || props.busy || props.form.saving || props.form.testing}
            >
              {language.t("config.claws.action.test")}
            </Button>
            <Show when={props.form.testing && props.onAbort}>
              <Button size="small" variant="ghost" icon="stop" onClick={() => props.onAbort?.()}>
                {language.t("config.claws.action.abort")}
              </Button>
            </Show>
            <SaveButton
              label={language.t("config.claws.action.save")}
              onClick={props.onSave}
              disabled={props.busy || props.form.saving || props.form.testing || !props.dirty}
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="mx-auto flex max-w-[920px] flex-col gap-6">
            <div class="rounded-2xl border border-border-weak-base bg-background-base p-5">
              <div class="flex flex-col gap-5">
                <div class="flex items-center justify-between gap-4 rounded-xl border border-border-weak-base bg-surface-base px-4 py-3">
                  <div class="min-w-0">
                    <div class="text-13-medium text-text-strong">{language.t("config.claws.field.enabled")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">
                      {language.t("config.claws.field.enabledDescription")}
                    </div>
                  </div>
                  <Toggle
                    checked={props.form.enabled}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("enabled", value)}
                  >
                    {language.t("config.claws.field.enabled")}
                  </Toggle>
                </div>

                <div class="grid gap-4 lg:grid-cols-2">
                  <TextField
                    type="text"
                    label={language.t("config.claws.field.url")}
                    description={language.t("config.claws.field.urlDescription")}
                    placeholder="ws://127.0.0.1:18789"
                    value={props.form.url}
                    validationState={props.form.err.url ? "invalid" : undefined}
                    error={props.form.err.url}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("url", value)}
                  />
                  <TextField
                    type="password"
                    label={language.t("config.claws.field.token")}
                    description={language.t("config.claws.field.tokenDescription")}
                    placeholder={language.t("config.claws.field.tokenPlaceholder")}
                    value={props.form.token}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("token", value)}
                  />
                </div>
              </div>
            </div>

            <Show when={props.form.testing || !!props.form.test}>
              <div class="rounded-2xl border border-border-weak-base bg-surface-base p-5">
                <div class="text-13-medium text-text-strong">{language.t("config.claws.debug.title")}</div>
                <div class="mt-1 text-12-regular text-text-weak">{language.t("config.claws.debug.description")}</div>
                <div class="mt-4 rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                    {language.t("config.claws.debug.status")}
                  </div>
                  <Show
                    when={props.form.testing}
                    fallback={
                      <div
                        class="mt-2 text-13-medium"
                        classList={{
                          "text-text-success": !!props.form.test?.ok,
                          "text-text-danger-base": !props.form.test?.ok,
                        }}
                      >
                        {props.form.test?.ok
                          ? language.t("config.claws.status.success")
                          : language.t("config.claws.status.failed")}
                      </div>
                    }
                  >
                    <div class="mt-2 inline-flex items-center gap-2 text-13-medium text-text-base">
                      <Spinner class="size-4" />
                      <span>{language.t("config.claws.status.testing")}</span>
                    </div>
                  </Show>
                </div>
                <div class="mt-4 rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                    {language.t("config.claws.debug.logs")}
                  </div>
                  <pre
                    class="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-12-regular text-text-weak"
                    style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
                  >
                    {props.form.testing
                      ? language.t("config.claws.logs.testing", { url: props.form.url.trim() || "-" })
                      : props.form.test?.logs.join("\n") || ""}
                  </pre>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

function GenericAgentEditor(props: {
  item?: ClawItem
  form: ReturnType<typeof gaCfg>
  dirty: boolean
  busy: boolean
  canTest: boolean
  onChange: (key: "enabled" | "pythonExecutable" | "genericAgentDir", value: string | boolean) => void
  onSave: () => void
  onTest: () => void
  onAbort?: () => void
}) {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show
        when={props.item}
        fallback={<div class="px-4 py-10 text-13-regular text-text-weak">{language.t("config.claws.empty")}</div>}
      >
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border-weak-base px-4 py-4">
          <div>
            <div class="flex items-center gap-2">
              <div class="text-15-medium text-text-strong">{props.item?.label}</div>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {props.form.enabled
                  ? language.t("config.claws.badge.enabled")
                  : language.t("config.claws.badge.disabled")}
              </span>
            </div>
            <div class="mt-2 text-12-regular text-text-weak">{language.t("config.claws.detail")}</div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="small"
              variant="ghost"
              icon="reset"
              onClick={props.onTest}
              disabled={!props.canTest || props.busy || props.form.saving || props.form.testing}
            >
              {language.t("config.claws.action.test")}
            </Button>
            <Show when={props.form.testing && props.onAbort}>
              <Button size="small" variant="ghost" icon="stop" onClick={() => props.onAbort?.()}>
                {language.t("config.claws.action.abort")}
              </Button>
            </Show>
            <SaveButton
              label={language.t("config.claws.action.save")}
              onClick={props.onSave}
              disabled={props.busy || props.form.saving || props.form.testing || !props.dirty}
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="mx-auto flex max-w-[920px] flex-col gap-6">
            <div class="rounded-2xl border border-border-weak-base bg-background-base p-5">
              <div class="flex flex-col gap-5">
                <div class="flex items-center justify-between gap-4 rounded-xl border border-border-weak-base bg-surface-base px-4 py-3">
                  <div class="min-w-0">
                    <div class="text-13-medium text-text-strong">{language.t("config.claws.field.enabled")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">
                      {language.t("config.claws.field.enabledDescription")}
                    </div>
                  </div>
                  <Toggle
                    checked={props.form.enabled}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("enabled", value)}
                  >
                    {language.t("config.claws.field.enabled")}
                  </Toggle>
                </div>

                <div class="grid gap-4 lg:grid-cols-2">
                  <TextField
                    type="text"
                    label={language.t("config.claws.field.genericAgentDir")}
                    description={language.t("config.claws.field.genericAgentDirDescription")}
                    placeholder={language.t("config.claws.field.genericAgentDirPlaceholder")}
                    value={props.form.genericAgentDir}
                    validationState={props.form.err.genericAgentDir ? "invalid" : undefined}
                    error={props.form.err.genericAgentDir}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("genericAgentDir", value)}
                  />
                  <TextField
                    type="text"
                    label={language.t("config.claws.field.pythonExecutable")}
                    description={language.t("config.claws.field.pythonExecutableDescription")}
                    placeholder={language.t("config.claws.field.pythonExecutablePlaceholder")}
                    value={props.form.pythonExecutable}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("pythonExecutable", value)}
                  />
                </div>
              </div>
            </div>

            <Show when={props.form.testing || !!props.form.test}>
              <div class="rounded-2xl border border-border-weak-base bg-surface-base p-5">
                <div class="text-13-medium text-text-strong">{language.t("config.claws.debug.title")}</div>
                <div class="mt-1 text-12-regular text-text-weak">{language.t("config.claws.debug.description")}</div>
                <div class="mt-4 rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                    {language.t("config.claws.debug.status")}
                  </div>
                  <Show
                    when={props.form.testing}
                    fallback={
                      <div
                        class="mt-2 text-13-medium"
                        classList={{
                          "text-text-success": !!props.form.test?.ok,
                          "text-text-danger-base": !props.form.test?.ok,
                        }}
                      >
                        {props.form.test?.ok
                          ? language.t("config.claws.status.success")
                          : language.t("config.claws.status.failed")}
                      </div>
                    }
                  >
                    <div class="mt-2 inline-flex items-center gap-2 text-13-medium text-text-base">
                      <Spinner class="size-4" />
                      <span>{language.t("config.claws.status.testing")}</span>
                    </div>
                  </Show>
                </div>
                <div class="mt-4 rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                    {language.t("config.claws.debug.logs")}
                  </div>
                  <pre
                    class="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-12-regular text-text-weak"
                    style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
                  >
                    {props.form.testing
                      ? language.t("config.claws.logs.testingGa", {
                          dir: props.form.genericAgentDir.trim() || "-",
                        })
                      : props.form.test?.logs.join("\n") || ""}
                  </pre>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

function HermesEditor(props: {
  item?: ClawItem
  form: ReturnType<typeof hmCfg>
  dirty: boolean
  busy: boolean
  canTest: boolean
  onChange: (key: "enabled" | "pythonExecutable" | "hermesDir" | "hermesHome", value: string | boolean) => void
  onSave: () => void
  onTest: () => void
  onAbort?: () => void
}) {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show
        when={props.item}
        fallback={<div class="px-4 py-10 text-13-regular text-text-weak">{language.t("config.claws.empty")}</div>}
      >
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border-weak-base px-4 py-4">
          <div>
            <div class="flex items-center gap-2">
              <div class="text-15-medium text-text-strong">{props.item?.label}</div>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {props.form.enabled
                  ? language.t("config.claws.badge.enabled")
                  : language.t("config.claws.badge.disabled")}
              </span>
            </div>
            <div class="mt-2 text-12-regular text-text-weak">{language.t("config.claws.detail")}</div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              size="small"
              variant="ghost"
              icon="reset"
              onClick={props.onTest}
              disabled={!props.canTest || props.busy || props.form.saving || props.form.testing}
            >
              {language.t("config.claws.action.test")}
            </Button>
            <Show when={props.form.testing && props.onAbort}>
              <Button size="small" variant="ghost" icon="stop" onClick={() => props.onAbort?.()}>
                {language.t("config.claws.action.abort")}
              </Button>
            </Show>
            <SaveButton
              label={language.t("config.claws.action.save")}
              onClick={props.onSave}
              disabled={props.busy || props.form.saving || props.form.testing || !props.dirty}
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="mx-auto flex max-w-[920px] flex-col gap-6">
            <div class="rounded-2xl border border-border-weak-base bg-background-base p-5">
              <div class="flex flex-col gap-5">
                <div class="flex items-center justify-between gap-4 rounded-xl border border-border-weak-base bg-surface-base px-4 py-3">
                  <div class="min-w-0">
                    <div class="text-13-medium text-text-strong">{language.t("config.claws.field.enabled")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">
                      {language.t("config.claws.field.enabledDescription")}
                    </div>
                  </div>
                  <Toggle
                    checked={props.form.enabled}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("enabled", value)}
                  >
                    {language.t("config.claws.field.enabled")}
                  </Toggle>
                </div>

                <div class="grid gap-4 lg:grid-cols-2">
                  <TextField
                    type="text"
                    label={language.t("config.claws.field.hermesDir")}
                    description={language.t("config.claws.field.hermesDirDescription")}
                    placeholder={language.t("config.claws.field.hermesDirPlaceholder")}
                    value={props.form.hermesDir}
                    validationState={props.form.err.hermesDir ? "invalid" : undefined}
                    error={props.form.err.hermesDir}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("hermesDir", value)}
                  />
                  <TextField
                    type="text"
                    label={language.t("config.claws.field.pythonExecutable")}
                    description={language.t("config.claws.field.pythonExecutableDescription")}
                    placeholder={language.t("config.claws.field.pythonExecutablePlaceholder")}
                    value={props.form.pythonExecutable}
                    disabled={props.busy || props.form.saving || props.form.testing}
                    onChange={(value) => props.onChange("pythonExecutable", value)}
                  />
                </div>

                <TextField
                  type="text"
                  label={language.t("config.claws.field.hermesHome")}
                  description={language.t("config.claws.field.hermesHomeDescription")}
                  placeholder={language.t("config.claws.field.hermesHomePlaceholder")}
                  value={props.form.hermesHome}
                  disabled={props.busy || props.form.saving || props.form.testing}
                  onChange={(value) => props.onChange("hermesHome", value)}
                />
              </div>
            </div>

            <Show when={props.form.testing || !!props.form.test}>
              <div class="rounded-2xl border border-border-weak-base bg-surface-base p-5">
                <div class="text-13-medium text-text-strong">{language.t("config.claws.debug.title")}</div>
                <div class="mt-1 text-12-regular text-text-weak">{language.t("config.claws.debug.description")}</div>
                <div class="mt-4 rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                    {language.t("config.claws.debug.status")}
                  </div>
                  <Show
                    when={props.form.testing}
                    fallback={
                      <div
                        class="mt-2 text-13-medium"
                        classList={{
                          "text-text-success": !!props.form.test?.ok,
                          "text-text-danger-base": !props.form.test?.ok,
                        }}
                      >
                        {props.form.test?.ok
                          ? language.t("config.claws.status.success")
                          : language.t("config.claws.status.failed")}
                      </div>
                    }
                  >
                    <div class="mt-2 inline-flex items-center gap-2 text-13-medium text-text-base">
                      <Spinner class="size-4" />
                      <span>{language.t("config.claws.status.testing")}</span>
                    </div>
                  </Show>
                </div>
                <div class="mt-4 rounded-xl border border-border-weak-base bg-background-base px-4 py-3">
                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                    {language.t("config.claws.debug.logs")}
                  </div>
                  <pre
                    class="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-12-regular text-text-weak"
                    style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
                  >
                    {props.form.testing
                      ? language.t("config.claws.logs.testingHermes", {
                          dir: props.form.hermesDir.trim() || "-",
                          home: props.form.hermesHome.trim() || "~/.hermes",
                        })
                      : props.form.test?.logs.join("\n") || ""}
                  </pre>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

function CustomEditor(props: {
  item?: ProviderItem
  form: CustomState
  busy: boolean
  onToggle: (item: ProviderItem, enabled: boolean) => void
  onField: (key: "providerID" | "npm" | "name" | "baseURL" | "apiKey", value: string) => void
  onModel: (index: number, key: "id" | "name", value: string) => void
  onHeader: (index: number, key: "key" | "value", value: string) => void
  onAddModel: () => void
  onRemoveModel: (index: number) => void
  onAddHeader: () => void
  onRemoveHeader: (index: number) => void
  onSave: () => void
  onReload?: () => void
  onDelete: () => void
  onCreate: () => void
  onSecret: () => void
}) {
  const language = useLanguage()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <Show
        when={props.item || props.form.mode === "create"}
        fallback={<div class="px-4 py-10 text-13-regular text-text-weak">{language.t("config.custom.select")}</div>}
      >
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border-weak-base px-4 py-4">
          <div>
            <div class="flex items-center gap-2">
              <div class="text-15-medium text-text-strong">
                {props.form.mode === "create" ? language.t("config.custom.new") : props.item?.id}
              </div>
              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                {language.t("config.badge.custom")}
              </span>
              <Show when={props.item?.sdk || props.form.npm}>
                <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-weak">
                  {props.item?.sdk ?? props.form.npm}
                </span>
              </Show>
            </div>
            <div class="mt-2 text-12-regular text-text-weak">{language.t("config.custom.description")}</div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Show when={props.item}>
              <Toggle
                checked={!!props.item?.allowed}
                disabled={props.busy}
                onChange={(value) => props.item && props.onToggle(props.item, value)}
              >
                {language.t("config.provider.toggle.enabledInConfig")}
              </Toggle>
            </Show>
            <Show
              when={props.form.mode === "create"}
              fallback={
                <Button size="small" variant="ghost" onClick={props.onDelete} disabled={props.busy}>
                  {language.t("config.action.delete")}
                </Button>
              }
            >
              <Button size="small" variant="secondary" onClick={props.onCreate}>
                {language.t("config.custom.new")}
              </Button>
            </Show>
            <Show when={props.onReload}>
              <Button
                size="small"
                variant="ghost"
                icon="reset"
                onClick={() => props.onReload?.()}
                disabled={props.busy || props.form.saving || props.form.deleting}
              >
                {language.t("command.server.reloadBackend")}
              </Button>
            </Show>
            <SaveButton
              label={language.t("config.custom.saveProvider")}
              onClick={props.onSave}
              disabled={props.busy || props.form.saving || props.form.deleting}
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="mx-auto flex max-w-[920px] flex-col gap-6">
            <div class="grid gap-4 lg:grid-cols-2">
              <TextField
                autofocus={props.form.mode === "create"}
                label={language.t("config.custom.field.providerID")}
                placeholder="my-provider"
                value={props.form.providerID}
                onChange={(value) => props.onField("providerID", value)}
                validationState={props.form.err.providerID ? "invalid" : undefined}
                error={props.form.err.providerID}
              />
              <TextField
                label={language.t("config.custom.field.npm")}
                placeholder="@ai-sdk/openai-compatible"
                value={props.form.npm}
                onChange={(value) => props.onField("npm", value)}
              />
              <TextField
                label={language.t("config.custom.field.name")}
                placeholder={language.t("config.custom.field.namePlaceholder")}
                value={props.form.name}
                onChange={(value) => props.onField("name", value)}
                validationState={props.form.err.name ? "invalid" : undefined}
                error={props.form.err.name}
              />
              <TextField
                label={language.t("config.custom.field.baseURL")}
                placeholder="https://api.example.com/v1"
                value={props.form.baseURL}
                onChange={(value) => props.onField("baseURL", value)}
                validationState={props.form.err.baseURL ? "invalid" : undefined}
                error={props.form.err.baseURL}
              />
            </div>

            <div class="space-y-2">
              <div class="text-12-medium text-text-weak">{language.t("config.custom.field.apiKey")}</div>
              <div class="rounded-xl border border-border-weak-base bg-background-base px-3 py-2.5">
                <div class="flex items-center gap-2">
                  <input
                    type={props.form.secret ? "password" : "text"}
                    placeholder="sk-... or {env:MY_PROVIDER_KEY}"
                    value={props.form.apiKey}
                    class="min-w-0 flex-1 bg-transparent text-13-regular text-text-base outline-none placeholder:text-text-weak"
                    onInput={(event) => props.onField("apiKey", event.currentTarget.value)}
                  />
                  <IconButton
                    type="button"
                    icon={props.form.secret ? "eye" : "close-small"}
                    variant="ghost"
                    onClick={props.onSecret}
                    aria-label={props.form.secret ? "Show API key" : "Hide API key"}
                  />
                </div>
              </div>
              <div class="text-12-regular text-text-weak">{language.t("config.custom.field.apiKeyDescription")}</div>
            </div>

            <div class="rounded-xl border border-border-weak-base bg-background-base p-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div class="text-13-medium text-text-strong">{language.t("config.custom.models.title")}</div>
                  <div class="text-12-regular text-text-weak">{language.t("config.custom.models.description")}</div>
                </div>
                <Button size="small" variant="ghost" icon="plus-small" onClick={props.onAddModel}>
                  {language.t("config.custom.models.add")}
                </Button>
              </div>
              <div class="flex flex-col gap-3">
                <For each={props.form.models}>
                  {(item, idx) => (
                    <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" data-row={item.row}>
                      <TextField
                        label={language.t("config.custom.models.id")}
                        hideLabel
                        placeholder="gpt-4.1"
                        value={item.id}
                        onChange={(value) => props.onModel(idx(), "id", value)}
                        validationState={item.err.id ? "invalid" : undefined}
                        error={item.err.id}
                      />
                      <TextField
                        label={language.t("config.custom.models.name")}
                        hideLabel
                        placeholder="GPT-4.1"
                        value={item.name}
                        onChange={(value) => props.onModel(idx(), "name", value)}
                        validationState={item.err.name ? "invalid" : undefined}
                        error={item.err.name}
                      />
                      <IconButton
                        type="button"
                        icon="trash"
                        variant="ghost"
                        class="mt-1.5"
                        onClick={() => props.onRemoveModel(idx())}
                        disabled={props.form.models.length <= 1}
                        aria-label={language.t("config.custom.models.remove")}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="rounded-xl border border-border-weak-base bg-background-base p-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div class="text-13-medium text-text-strong">{language.t("config.custom.headers.title")}</div>
                  <div class="text-12-regular text-text-weak">{language.t("config.custom.headers.description")}</div>
                </div>
                <Button size="small" variant="ghost" icon="plus-small" onClick={props.onAddHeader}>
                  {language.t("config.custom.headers.add")}
                </Button>
              </div>
              <div class="flex flex-col gap-3">
                <For each={props.form.headers}>
                  {(item, idx) => (
                    <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" data-row={item.row}>
                      <TextField
                        label={language.t("config.custom.headers.key")}
                        hideLabel
                        placeholder="Authorization"
                        value={item.key}
                        onChange={(value) => props.onHeader(idx(), "key", value)}
                        validationState={item.err.key ? "invalid" : undefined}
                        error={item.err.key}
                      />
                      <TextField
                        label={language.t("config.custom.headers.value")}
                        hideLabel
                        placeholder="Bearer ..."
                        value={item.value}
                        onChange={(value) => props.onHeader(idx(), "value", value)}
                        validationState={item.err.value ? "invalid" : undefined}
                        error={item.err.value}
                      />
                      <IconButton
                        type="button"
                        icon="trash"
                        variant="ghost"
                        class="mt-1.5"
                        onClick={() => props.onRemoveHeader(idx())}
                        disabled={props.form.headers.length <= 1}
                        aria-label={language.t("config.custom.headers.remove")}
                      />
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

export default function ConfigPage() {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams()
  const layout = useLayout()
  const [query] = useSearchParams<{ section?: string; pick?: string }>()

  onMount(() => {
    if (platform.platform !== "desktop") return
    if (!layout.sidebar.opened()) return
    layout.sidebar.close()
  })
  const cache = new Map<string, string>()
  const pending = new Map<string, Promise<string>>()
  const trees = new Map<string, TreeNode[]>()
  const treePending = new Map<string, Promise<TreeNode[]>>()
  let openRun = 0
  let jumpRun = 0
  let skillsList: HTMLDivElement | undefined
  const [state, setState] = createStore({
    section: "agents-md" as Section,
    pick: "",
    doc: "",
    text: "",
    saved: "",
    query: "",
    providerBusy: "",
    providerOffCollapsed: true,
    customID: "",
    customApiDirty: false,
    custom: providerCfg(undefined),
    claw: clawCfg(),
    ga: gaCfg(),
    hm: hmCfg(),
    skillTitle: "",
    skillErr: "",
    skillPath: "",
    skillNote: "",
    skillWarn: "",
    skillSaving: false,
    treeClosed: {} as Record<string, boolean>,
    busy: false,
    workspaceRev: 0,
    skillRev: 0,
    agentRev: 0,
    clawRev: 0,
    gaRev: 0,
    hmRev: 0,
  })

  function bump(...list: Array<"workspaceRev" | "skillRev" | "agentRev" | "clawRev" | "gaRev" | "hmRev">) {
    list.forEach((key) => setState(key, (value) => value + 1))
  }

  const [workspace] = createResource(
    () => state.workspaceRev,
    async () => {
      if (!platform.getConfigWorkspace) return undefined
      return platform.getConfigWorkspace()
    },
  )

  const [rawSkills] = createResource(
    () => state.skillRev,
    async () => {
      const resp = await globalSDK.client.app.skills({}, { throwOnError: true })
      return resp.data ?? []
    },
  )

  const [loaded] = createResource(
    () => state.agentRev,
    async () => {
      const resp = await globalSDK.client.app.agents({}, { throwOnError: true })
      return resp.data ?? []
    },
  )

  const [openclaw] = createResource(
    () => (state.section === "claws" ? state.clawRev : -1),
    async (rev) => {
      if (rev === -1) return undefined
      if (!platform.getOpenclawConfig) return undefined
      return platform.getOpenclawConfig()
    },
  )

  const [genericagent] = createResource(
    () => (state.section === "claws" ? state.gaRev : -1),
    async (rev) => {
      if (rev === -1) return undefined
      if (!platform.getGenericagentConfig) return undefined
      return platform.getGenericagentConfig()
    },
  )

  const [hermes] = createResource(
    () => (state.section === "claws" ? state.hmRev : -1),
    async (rev) => {
      if (rev === -1) return undefined
      if (!platform.getHermesConfig) return undefined
      return platform.getHermesConfig()
    },
  )

  const mainRoot = createMemo(() => globalSync.data.rootByDomain[mainDomain])
  const mainPath = createMemo(() => mainRoot()?.path ?? globalSync.data.path)
  const mainConfig = createMemo(() => mainRoot()?.config ?? globalSync.data.config)
  const mainProviderAuth = createMemo(() => mainRoot()?.provider_auth ?? globalSync.data.provider_auth)

  const space = createMemo<ConfigWorkspace | undefined>(() => {
    const data = workspace() as ConfigWorkspace | undefined
    const root = mainPath().config
    if (!data && !root) return
    if (!root) return data
    return {
      configRoot: root,
      agentsRoot: join(root, "agents"),
      skillsRoot: join(root, "skills"),
      pluginsRoot: join(root, "plugins"),
      agentsMdPath: join(root, "AGENTS.md"),
      agents: data?.agents ?? [],
      plugins: data?.plugins ?? [],
    }
  })
  const cfg = createMemo(() => globalSync.data.config)
  const mainProviders = createMemo(() => globalSync.data.rootByDomain[mainDomain]?.provider ?? globalSync.data.provider)
  const t = language.t

  const setMainProviders = (provider: ProviderListResponse) => {
    const root = globalSync.data.rootByDomain[mainDomain]
    globalSync.set("rootByDomain", mainDomain, {
      ready: root?.ready ?? globalSync.data.ready,
      error: root?.error ?? globalSync.data.error,
      path: root?.path ?? globalSync.data.path,
      provider,
      provider_auth: root?.provider_auth ?? globalSync.data.provider_auth,
      config: root?.config ?? globalSync.data.config,
      reload: root?.reload ?? globalSync.data.reload,
    })
    globalSync.set("provider", provider)
  }

  function agentModeLabel(mode?: string) {
    if (mode === "subagent") return t("config.agents.badge.subagent")
    if (mode === "primary") return t("config.agents.badge.primary")
    if (mode === "all") return t("config.agents.badge.all")
    return t("config.agents.badge.agent")
  }

  function back() {
    if (window.history.length > 1) {
      window.history.back()
      return
    }
    if (!params.dir) return
    navigate(`/${params.dir}/session`)
  }
  const clawsEnabled = createMemo(
    () => !!platform.getOpenclawConfig && !!platform.setOpenclawConfig && !!platform.testOpenclawConfig,
  )
  const gaPlatformEnabled = createMemo(
    () => !!platform.getGenericagentConfig && !!platform.setGenericagentConfig && !!platform.testGenericagentConfig,
  )
  const hmPlatformEnabled = createMemo(
    () => !!platform.getHermesConfig && !!platform.setHermesConfig && !!platform.testHermesConfig,
  )
  const clawsSectionEnabled = createMemo(() => clawsEnabled() || gaPlatformEnabled() || hmPlatformEnabled())
  const querySection = createMemo<Section | undefined>(() => {
    const value = query.section
    if (typeof value === "string" && isKnownSection(value)) {
      return value as Section
    }
  })
  const opened = createMemo(() =>
    Object.values(globalSync.data.projectByDomain)
      .flat()
      .filter((item): item is Project => !!item)
      .sort((a, b) => (a.name ?? name(a.worktree)).localeCompare(b.name ?? name(b.worktree))),
  )

  const agentsMd = createMemo<DocItem[]>(() => {
    if (!space()?.agentsMdPath) return []
    return [
      {
        id: "agents-md:global",
        label: t("config.agentsMd.title"),
        path: space()!.agentsMdPath!,
        editable: true,
        source: "opencode",
        note: t("config.agentsMd.note"),
      },
    ]
  })

  const globalAgents = createMemo<DocItem[]>(() =>
    (space()?.agents ?? []).map((item) => ({
      id: `agent:${item.path}`,
      label: item.name,
      path: item.path,
      editable: true,
      source: "opencode",
      note: t("config.agents.note"),
      group: "opencode" as const,
      origin: ".opencode",
    })),
  )

  const skills = createMemo<SkillItem[]>(() => {
    const root = local(space()?.skillsRoot ?? "")
    const claude = mainPath().home ? join(mainPath().home, ".claude", "skills") : undefined
    return (rawSkills() ?? []).map((item) => {
      const source = classifySkillSource(item.location, opened(), { opencodeRoot: root, claudeRoot: claude })
      const group: SkillGroup = source.group === "global" ? "external" : source.group
      return {
        ...item,
        location: local(item.location),
        editable: file(item.location),
        source: group === "project" ? "project" : group === "opencode" ? "opencode" : "external",
        group,
        project: group === "project" ? source.project : undefined,
        origin: source.origin,
        root: source.root,
        warn:
          !item.name.trim() || !item.description.trim()
            ? `Incomplete metadata. Add ${[!item.name.trim() && "`name`", !item.description.trim() && "`description`"]
                .filter((part): part is string => !!part)
                .join(t("config.common.and"))} ${t("config.skills.warn.metadataSuffix")}`
            : undefined,
      }
    })
  })

  const claudeRoot = createMemo(() => {
    if (mainPath().home) return join(mainPath().home, ".claude", "skills")

    const hit = skills().find((item) => item.group === "claude")
    if (hit) return norm(hit.location).split("/.claude/skills/")[0] + "/.claude/skills"

    const root = home(space()?.configRoot ?? "")
    if (root) return join(root, ".claude", "skills")
  })

  const scan = async (
    root: string,
    extra: Omit<SkillItem, "name" | "description" | "location" | "content" | "editable" | "warn">,
  ) => {
    if (!platform.listConfigDirectory || !platform.readConfigFile) return [] as SkillItem[]

    const walk = async (dir: string): Promise<SkillItem[]> => {
      const list = await platform.listConfigDirectory?.(dir).catch(() => [])
      if (!list?.length) return []

      return Promise.all(
        sortTree(list).map(async (item) => {
          if (item.kind === "directory") return walk(item.path)
          if (name(item.path) !== "SKILL.md") return []

          const text = await platform.readConfigFile?.(item.path).catch(() => null)
          if (!text) return []

          const meta = skillMeta(text, item.path)

          return [
            {
              name: meta.name,
              description: meta.description,
              location: item.path,
              content: text,
              editable: file(item.path),
              warn: meta.warn,
              ...extra,
            },
          ]
        }),
      ).then((list) => list.flat())
    }

    return walk(root)
  }

  const scanAgents = async (
    root: string,
    extra: Pick<DocItem, "source" | "group" | "project" | "origin" | "root">,
    opts?: { code?: boolean },
  ) => {
    if (!platform.listConfigDirectory) return [] as DocItem[]

    const walk = async (dir: string): Promise<DocItem[]> => {
      const list = await platform.listConfigDirectory?.(dir).catch(() => [] as ConfigTreeItem[])
      if (!list?.length) return []

      return Promise.all(
        sortTree(list).map(async (item) => {
          if (item.kind === "directory") return walk(item.path)
          const match = opts?.code ? /\.(?:mdx?|d\.ts|[cm]?[jt]s)$/i : /\.mdx?$/i
          if (!match.test(item.path)) return []

          const label = stem(rel(root, item.path))

          return [
            {
              id: `agent:${item.path}`,
              label,
              path: item.path,
              editable: file(item.path),
              note:
                extra.group === "plugin" && opts?.code
                  ? "Plugin agent prompt source file."
                  : extra.group === "plugin"
                    ? "Plugin agent prompt file."
                    : t("config.agents.note"),
              ...extra,
            },
          ]
        }),
      ).then((list) => list.flat())
    }

    const list = await walk(root)
    return list
  }

  const [diskAgents] = createResource(
    () => [state.agentRev, opened()] as const,
    async ([, list]) => {
      return Promise.all(
        list.map(async (item) => {
          const label = item.name ?? name(item.worktree)
          const roots = Array.from(new Set([item.worktree, ...(item.sandboxes ?? [])]))

          return Promise.all(
            roots.map(async (dir) => {
              const extra = dir === item.worktree ? undefined : name(dir)
              const suffix = extra ? ` · ${extra}` : ""

              return Promise.all([
                scanAgents(join(dir, ".opencode", "agent"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.opencode${suffix}`,
                }),
                scanAgents(join(dir, ".opencode", "agents"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.opencode${suffix}`,
                }),
                scanAgents(join(dir, ".agents", "agent"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.agents${suffix}`,
                }),
                scanAgents(join(dir, ".agents", "agents"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.agents${suffix}`,
                }),
              ]).then((list) => list.flat())
            }),
          ).then((list) => list.flat())
        }),
      ).then((list) => list.flat())
    },
  )

  const [pluginAgents] = createResource(
    () => [state.agentRev, mainPath().home, cfg().plugin] as const,
    async ([, home, plugins]) => {
      const cache = home ? join(home, ".cache", "opencode") : undefined
      if (!cache || !plugins?.length) return [] as DocItem[]

      return Promise.all(
        plugins
          .map(pkg)
          .filter((item): item is { name: string; version: string } => !!item)
          .flatMap((item) => [
            {
              root: join(cache, "node_modules", item.name),
              name: item.name,
            },
            {
              root: join(cache, "packages", `${item.name}@${item.version}`, "node_modules", item.name),
              name: item.name,
            },
          ])
          .map(async (item) => {
            return Promise.all([
              scanAgents(join(item.root, "agent"), {
                source: "external",
                group: "plugin",
                origin: item.name,
                root: item.root,
              }),
              scanAgents(join(item.root, "agents"), {
                source: "external",
                group: "plugin",
                origin: item.name,
                root: item.root,
              }),
              scanAgents(join(item.root, "dist", "agents"), {
                source: "external",
                group: "plugin",
                origin: item.name,
                root: item.root,
              }),
            ]).then((list) => list.flat())
          }),
      ).then((list) => list.flat())
    },
  )

  const runtimeAgents = createMemo<DocItem[]>(() => {
    const names = new Set(
      [...globalAgents(), ...(diskAgents() ?? []), ...(pluginAgents() ?? [])].map((item) => item.label),
    )
    return (loaded() ?? [])
      .filter((item) => !item.native && !item.hidden && !names.has(item.name))
      .map((item) => ({
        id: `agent-runtime:${item.name}`,
        label: item.name,
        path: `runtime:${item.name}`,
        editable: false,
        source: "external",
        group: "plugin" as const,
        origin: "runtime",
        note: item.description ?? "Loaded runtime agent from config or plugin.",
        content: item.prompt ?? "No prompt content is available for this runtime agent.",
      }))
  })

  const agents = createMemo<DocItem[]>(() => {
    const seen = new Set<string>()
    return [...globalAgents(), ...(diskAgents() ?? []), ...(pluginAgents() ?? []), ...runtimeAgents()]
      .filter((item) => {
        const key = norm(item.path)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label))
  })

  const agentOpenCode = createMemo(() => agents().filter((item) => item.group === "opencode"))
  const agentProject = createMemo(() => agents().filter((item) => item.group === "project"))
  const agentPlugin = createMemo(() => agents().filter((item) => item.group === "plugin"))

  const projectAgentGroups = createMemo(() => {
    const items = agentProject()
    const groups = new Map<string, DocItem[]>()
    for (const item of items) {
      const key = item.project ?? ""
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(item)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })

  const agentProjectOpen = (key: string) => !!state.treeClosed[`agent-project:${key}`]
  const toggleAgentProject = (key: string) => setState("treeClosed", `agent-project:${key}`, (v) => !v)

  const [diskClaude] = createResource(
    () => [state.skillRev, claudeRoot()] as const,
    async ([, root]) => {
      if (!root) return [] as SkillItem[]
      return scan(root, { source: "external", group: "claude", origin: ".claude" })
    },
  )

  const [diskOpenCode] = createResource(
    () => [state.skillRev, space()?.skillsRoot] as const,
    async ([, root]) => {
      if (!root) return [] as SkillItem[]
      return scan(root, { source: "opencode", group: "opencode", origin: ".opencode" })
    },
  )

  const [diskProject] = createResource(
    () => [state.skillRev, opened()] as const,
    async ([, list]) => {
      return Promise.all(
        list.map(async (item) => {
          const label = item.name ?? name(item.worktree)
          const roots = Array.from(new Set([item.worktree, ...(item.sandboxes ?? [])]))

          return Promise.all(
            roots.map(async (dir) => {
              const extra = dir === item.worktree ? undefined : name(dir)
              return Promise.all([
                scan(join(dir, ".opencode", "skill"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: extra ? `.opencode · ${extra}` : ".opencode",
                }),
                scan(join(dir, ".opencode", "skills"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: extra ? `.opencode · ${extra}` : ".opencode",
                }),
                scan(join(dir, ".claude", "skills"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: extra ? `.claude · ${extra}` : ".claude",
                }),
                scan(join(dir, ".agents", "skills"), {
                  source: "project",
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: extra ? `.agents · ${extra}` : ".agents",
                }),
              ]).then((list) => list.flat())
            }),
          ).then((list) => list.flat())
        }),
      ).then((list) => list.flat())
    },
  )

  const skillDocs = createMemo<DocItem[]>(() => {
    const seen = new Set<string>()
    return [...skills(), ...(diskOpenCode() ?? []), ...(diskClaude() ?? []), ...(diskProject() ?? [])]
      .filter((item) => {
        const key = norm(item.location)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((item) => ({
        id: `skill:${item.location}`,
        label: item.name,
        path: item.location,
        editable: item.editable,
        source: item.source,
        note: item.description,
        content: item.editable ? undefined : item.content,
        warn: item.warn,
        group: item.group,
        project: item.project,
        origin: item.origin,
        root: item.root,
      }))
  })

  const skillOpenCode = createMemo(() => skillDocs().filter((item) => item.group === "opencode"))
  const skillClaude = createMemo(() => skillDocs().filter((item) => item.group === "claude"))
  const skillProject = createMemo(() => skillDocs().filter((item) => item.group === "project"))
  const skillExternal = createMemo(() => skillDocs().filter((item) => item.group === "external"))
  const projectSkills = createMemo(() => {
    const map = new Map<string, { label: string; path?: string; items: DocItem[] }>()

    for (const item of skillProject()
      .slice()
      .sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || a.label.localeCompare(b.label))) {
      const key = item.root ?? item.project ?? item.path
      const prev = map.get(key)
      if (prev) {
        prev.items.push(item)
        continue
      }
      map.set(key, {
        label: item.project ?? name(item.root ?? item.path),
        path: item.root,
        items: [item],
      })
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  })

  const loadedMap = createMemo(() => new Map((loaded() ?? ([] as Agent[])).map((item) => [item.name, item] as const)))

  const scanPlugins = async (root: string, extra: PluginSource): Promise<PluginItem[]> => {
    if (!platform.listConfigDirectory) return []

    const walk = async (dir: string): Promise<PluginItem[]> => {
      const list = await platform.listConfigDirectory?.(dir).catch(() => [] as ConfigTreeItem[])
      if (!list?.length) return []

      return Promise.all(
        sortTree(list).map(async (item) => {
          if (item.kind === "directory") return walk(item.path)
          if (!/\.(?:ts|js|mjs|cjs|mts|cts)$/i.test(item.path)) return []

          const key = pluginKey(item.path)
          return [
            {
              id: `plugin:${key}`,
              label: plugin(item.path),
              name: plugin(item.path),
              enabled: false,
              exists: true,
              path: item.path,
              spec: spec(item.path),
              ...extra,
            },
          ]
        }),
      ).then((list) => list.flat())
    }

    return walk(root)
  }

  const [diskProjectPlugins] = createResource(
    () => [state.skillRev, opened()] as const,
    async ([, list]) => {
      return Promise.all(
        list.map(async (item) => {
          const label = item.name ?? name(item.worktree)
          const roots = Array.from(new Set([item.worktree, ...(item.sandboxes ?? [])]))

          return Promise.all(
            roots.map(async (dir) => {
              const extra = dir === item.worktree ? undefined : name(dir)
              const suffix = extra ? ` · ${extra}` : ""

              return Promise.all([
                scanPlugins(join(dir, ".opencode", "plugin"), {
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.opencode${suffix}`,
                }),
                scanPlugins(join(dir, ".opencode", "plugins"), {
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.opencode${suffix}`,
                }),
                scanPlugins(join(dir, ".agents", "plugin"), {
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.agents${suffix}`,
                }),
                scanPlugins(join(dir, ".agents", "plugins"), {
                  group: "project",
                  project: label,
                  root: item.worktree,
                  origin: `.agents${suffix}`,
                }),
              ]).then((list) => list.flat())
            }),
          ).then((list) => list.flat())
        }),
      ).then((list) => list.flat())
    },
  )

  const plugins = createMemo<PluginItem[]>(() => {
    const on = new Set(cfg().plugin ?? [])
    const map = new Map<string, PluginItem>()

    for (const item of space()?.plugins ?? []) {
      const key = pluginKey(item.path)
      map.set(key, {
        id: `plugin:${key}`,
        label: item.name,
        name: key,
        enabled: false,
        exists: true,
        path: item.path,
        spec: spec(item.path),
        group: "global",
        origin: ".opencode",
        root: space()?.configRoot,
      })
    }

    for (const item of diskProjectPlugins() ?? []) {
      const key = pluginKey(item.path ?? item.name)
      const existing = map.get(key)
      map.set(key, {
        ...item,
        enabled: existing?.enabled ?? false,
        spec: existing?.spec ?? item.spec,
      })
    }

    for (const spec of on) {
      const key = pluginKey(spec)
      const item = map.get(key)
      if (item) {
        item.enabled = true
        item.spec = spec
        map.set(key, item)
        continue
      }

      const project = classifyPluginSource(spec, opened())

      map.set(key, {
        id: `plugin:${key}`,
        label: plugin(spec),
        name: plugin(spec),
        enabled: true,
        exists: file(spec),
        spec,
        path: file(spec) ? local(spec) : undefined,
        group: project.scope === "project" ? "project" : "global",
        project: project.scope === "project" ? project.project : undefined,
        root: project.root,
        origin: project.origin,
      })
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  })

  const pluginGlobal = createMemo(() => (plugins() ?? []).filter((item) => item.group !== "project"))
  const pluginProject = createMemo(() => (plugins() ?? []).filter((item) => item.group === "project"))
  const projectPlugins = createMemo(() => {
    const map = new Map<string, { label: string; path?: string; items: PluginItem[] }>()

    for (const item of pluginProject()
      .slice()
      .sort((a, b) => (a.project ?? "").localeCompare(b.project ?? "") || a.label.localeCompare(b.label))) {
      const key = item.root ?? item.project ?? item.path ?? item.name
      const prev = map.get(key)
      if (prev) {
        prev.items.push(item)
        continue
      }
      map.set(key, {
        label: item.project ?? name(item.root ?? item.path ?? item.name),
        path: item.root,
        items: [item],
      })
    }

    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
  })

  const claws = createMemo<ClawItem[]>(() => {
    const list: ClawItem[] = []
    if (clawsEnabled()) {
      const cfg = openclaw()
      list.push({
        id: "claw:openclaw",
        label: "OpenClaw",
        note: t("config.claws.note.openclaw"),
        meta: cfg?.url?.trim() || "ws://127.0.0.1:18789",
        enabled: cfg?.enabled ?? false,
      })
    }
    if (hmPlatformEnabled()) {
      const cfg = hermes()
      list.push({
        id: "claw:hermes",
        label: "Hermes",
        note: t("config.claws.note.hermes"),
        meta: cfg?.hermesDir?.trim() || "/path/to/hermes-agent",
        enabled: cfg?.enabled ?? false,
      })
    }
    if (gaPlatformEnabled()) {
      const cfg = genericagent()
      list.push({
        id: "claw:genericagent",
        label: "GenericAgent",
        note: t("config.claws.note.genericagent"),
        meta: cfg?.genericAgentDir?.trim() || "/path/to/GenericAgent",
        enabled: cfg?.enabled ?? false,
      })
    }
    return list
  })

  const pluginDocs = createMemo<DocItem[]>(() =>
    (plugins() ?? [])
      .filter((item) => !!item.path)
      .map((item) => ({
        id: item.id,
        label: item.label,
        path: item.path!,
        editable: true,
        source: "opencode",
        note: undefined,
      })),
  )

  const providers = createMemo<ProviderItem[]>(() => {
    const data = mainProviders()
    const off = new Set(cfg().disabled_providers ?? [])
    const entries = cfg().provider ?? {}
    const on = new Set(data.connected ?? [])
    const list = data.all
      .map((item) => {
        const source: ProviderItem["source"] =
          "source" in item &&
          (item.source === "env" || item.source === "api" || item.source === "config" || item.source === "custom")
            ? item.source
            : undefined
        const cfgItem = entries[item.id] as ProviderCfg | undefined
        const sdk = cfgItem?.npm
        const custom = typeof sdk === "string" && sdk.startsWith("@ai-sdk/")
        return {
          id: item.id,
          name: item.name,
          connected: on.has(item.id),
          allowed: !off.has(item.id),
          custom,
          source,
          sdk,
          key: "key" in item && typeof item.key === "string" ? item.key : undefined,
          env: Array.isArray(item.env) ? item.env : cfgItem?.env,
          models: Object.keys(item.models).sort(),
        }
      })
      .filter((item) => item.connected || !off.has(item.id))
    const known = new Set(list.map((item) => item.id))
    const extra = Object.entries(entries)
      .filter(([, item]) => typeof item?.npm === "string" && item.npm.startsWith("@ai-sdk/"))
      .filter(([id]) => !known.has(id))
      .map(([id, item]) => ({
        id,
        name: item?.name ?? id,
        connected: false,
        allowed: !off.has(id),
        custom: true,
        source: "config" as const,
        sdk: item?.npm,
        key: undefined,
        env: item?.env,
        models: Object.keys(item?.models ?? {}).sort(),
      }))
    return [...list, ...extra].sort((a, b) => a.id.localeCompare(b.id))
  })

  const providerList = createMemo(() => {
    const result = providers().filter((item) => fuzzy(item.id, state.query))
    return result
  })
  const providerOn = createMemo(() => {
    const result = providerList().filter((item) => providerEnabled(item))
    return result
  })
  const providerOff = createMemo(() => {
    const result = providerList().filter((item) => !providerEnabled(item))
    return result
  })
  const providerVisible = createMemo(() => [...providerOn(), ...providerOff()])

  const docs = createMemo(() => {
    const map = new Map<string, DocItem>()
    for (const item of [...agentsMd(), ...agents(), ...skillDocs(), ...pluginDocs()]) map.set(item.id, item)
    return map
  })

  const currentDoc = createMemo(() => {
    if (state.section === "agents-md") return agentsMd().find((item) => item.id === state.doc)
    if (state.section === "agents") return agents().find((item) => item.id === state.doc)
    if (state.section === "plugins") return pluginDocs().find((item) => item.id === state.doc)
    if (state.section !== "skills") return

    const item = skillDocs().find((item) => item.id === state.doc)
    if (item) return item
    if (state.doc !== state.skillPath || !state.skillPath) return
    return {
      id: `skill:${state.skillPath}`,
      label: state.skillTitle.trim() || name(dir(state.skillPath)),
      path: state.skillPath,
      editable: true,
      source: "opencode",
      note: state.skillNote || undefined,
      warn: state.skillWarn || undefined,
      group: "opencode" as const,
    }
  })
  const currentPlugin = createMemo(() => plugins()?.find((item) => item.id === state.doc))
  const currentAgent = createMemo(() => agents().find((item) => item.id === state.doc))
  const currentSkill = createMemo(() => skillDocs().find((item) => item.id === state.doc))
  const selectedProvider = createMemo(() =>
    providers().find((item) => item.id === state.pick.replace(/^provider:/, "")),
  )
  const selectedPlugin = createMemo(() => plugins()?.find((item) => item.id === state.pick))
  const selectedClaw = createMemo(() => claws().find((item) => item.id === state.pick))
  const selectedCustom = createMemo(() =>
    providers().find((item) => item.id === state.pick.replace(/^provider:/, "") && item.custom),
  )
  const dirty = createMemo(() => !!currentDoc() && state.doc === state.pick && state.text !== state.saved)
  const clawDirty = createMemo(() => {
    const cfg = openclaw()
    if (!cfg || state.section !== "claws") return false
    return (
      state.claw.enabled !== (cfg.enabled ?? false) ||
      state.claw.url.trim() !== (cfg.url?.trim() ?? "") ||
      state.claw.token.trim() !== (cfg.token?.trim() ?? "")
    )
  })

  const gaDirty = createMemo(() => {
    const cfg = genericagent()
    if (!cfg || state.section !== "claws") return false
    return (
      state.ga.enabled !== (cfg.enabled ?? false) ||
      state.ga.pythonExecutable.trim() !== (cfg.pythonExecutable?.trim() ?? "") ||
      state.ga.genericAgentDir.trim() !== (cfg.genericAgentDir?.trim() ?? "")
    )
  })

  const hmDirty = createMemo(() => {
    const cfg = hermes()
    if (!cfg || state.section !== "claws") return false
    return (
      state.hm.enabled !== (cfg.enabled ?? false) ||
      state.hm.pythonExecutable.trim() !== (cfg.pythonExecutable?.trim() ?? "") ||
      state.hm.hermesDir.trim() !== (cfg.hermesDir?.trim() ?? "") ||
      state.hm.hermesHome.trim() !== (cfg.hermesHome?.trim() ?? "")
    )
  })

  const currentSkillRoot = createMemo(() => {
    const item = currentSkill()
    if (!item) return undefined
    return dir(item.path)
  })
  const agentWait = createMemo(
    () =>
      state.section === "agents" &&
      (loaded.loading || diskAgents.loading || pluginAgents.loading) &&
      agents().length === 0,
  )
  const skillWait = createMemo(
    () =>
      state.section === "skills" &&
      state.pick !== SKILL_NEW &&
      (rawSkills.loading || diskClaude.loading || diskOpenCode.loading || diskProject.loading) &&
      skillDocs().length === 0,
  )
  const pluginWait = createMemo(
    () => state.section === "plugins" && diskProjectPlugins.loading && (plugins()?.length ?? 0) === 0,
  )

  async function walk(root: string, depth = 0): Promise<TreeNode[]> {
    if (!platform.listConfigDirectory) return []
    const skip = new Set([".git", ".DS_Store", "node_modules", "dist", "build", "coverage"])
    return platform
      .listConfigDirectory(root)
      .then((list) =>
        Promise.all(
          sortTree(list)
            .filter((item) => !skip.has(name(item.path)))
            .map(async (item) => {
              const kind: TreeNode["kind"] = item.kind === "directory" ? "directory" : "file"
              return {
                path: item.path,
                kind,
                kids: kind === "directory" && depth < 2 ? await walk(item.path, depth + 1) : [],
              }
            }),
        ),
      )
      .catch(() => [])
  }

  function loadDoc(item: DocItem) {
    const hit = item.content ?? cache.get(item.path)
    if (hit !== undefined) return Promise.resolve(hit)
    const prev = pending.get(item.path)
    if (prev) return prev
    const next = (
      (platform.readConfigFile?.(item.path).catch(() => "") as Promise<string | null | undefined>) ??
      Promise.resolve("")
    ).then((text) => {
      const value = text ?? ""
      cache.set(item.path, value)
      return value
    })
    pending.set(item.path, next)
    void next.finally(() => {
      pending.delete(item.path)
    })
    return next
  }

  function loadTree(root: string) {
    const hit = trees.get(root)
    if (hit) return Promise.resolve(hit)
    const prev = treePending.get(root)
    if (prev) return prev
    const next = walk(root).then((list) => {
      trees.set(root, list)
      return list
    })
    treePending.set(root, next)
    void next.finally(() => {
      treePending.delete(root)
    })
    return next
  }

  const [tree] = createResource(currentSkillRoot, async (root) => loadTree(root))
  const treeOpen = (path: string) => !state.treeClosed[path]
  const toggleTree = (path: string) => setState("treeClosed", path, (value) => !value)
  const groupOpen = (key: string) => !!state.treeClosed[`skill-group:${key}`]
  const toggleGroup = (key: string) => setState("treeClosed", `skill-group:${key}`, (value) => !value)

  createEffect(
    on(
      () => openclaw(),
      (item) => {
        if (!item) return
        setState("claw", clawCfg(item))
      },
    ),
  )

  createEffect(
    on(
      () => genericagent(),
      (item) => {
        if (!item) return
        setState("ga", gaCfg(item))
      },
    ),
  )

  createEffect(
    on(
      () => hermes(),
      (item) => {
        if (!item) return
        setState("hm", hmCfg(item))
      },
    ),
  )

  createEffect(() => {
    const section = querySection()
    const pick = query.pick
    if (!section) return
    if (section === "claws" && !clawsSectionEnabled()) return
    batch(() => {
      setState("section", section)
      if (typeof pick === "string") setState("pick", pick)
    })
  })

  function keepSkillsScroll(run: () => void) {
    const top = skillsList?.scrollTop ?? 0
    run()
    requestAnimationFrame(() => {
      if (skillsList) skillsList.scrollTop = top
    })
  }

  function picks(section: Section) {
    if (section === "agents-md") return agentsMd().map((item) => item.id)
    if (section === "providers") {
      const list = providerVisible().map((item) => `provider:${item.id}`)
      return list.length > 0 ? list : [CUSTOM_NEW]
    }
    if (section === "agents") return agents().map((item) => item.id)
    if (section === "claws") return claws().map((item) => item.id)
    if (section === "skills") {
      const list = skillDocs().map((item) => item.id)
      return state.pick === SKILL_NEW ? [SKILL_NEW, ...list] : list
    }
    return (plugins() ?? []).map((item) => item.id)
  }

  async function jump(section: Section) {
    const run = ++jumpRun
    const list = picks(section)
    const next = list[0] ?? ""
    if (list.includes(state.pick)) {
      setState("section", section)
      return
    }
    const item = docs().get(next)
    const root = section === "skills" && item ? dir(item.path) : undefined
    const text = item ? (item.content ?? cache.get(item.path)) : undefined
    const tree = root ? trees.get(root) : undefined
    if (item && (text === undefined || (root && !tree))) {
      const values = await Promise.all([loadDoc(item), root ? loadTree(root) : Promise.resolve(undefined)])
      if (jumpRun !== run) return
      batch(() => {
        setState("section", section)
        setState("pick", next)
        setState({ doc: item.id, busy: false, text: values[0], saved: values[0] })
      })
      return
    }
    batch(() => {
      setState("section", section)
      setState("pick", next)
      if (item && text !== undefined) {
        setState({ doc: item.id, busy: false, text, saved: text })
      }
    })
    if (!item || text !== undefined) return
    void open(item)
  }

  createEffect(
    on(
      () => [
        state.section,
        agentsMd().length,
        providerVisible().length,
        agents().length,
        claws().length,
        skillDocs().length,
        plugins()?.length ?? 0,
      ],
      () => {
        const list = picks(state.section)
        if (list.includes(state.pick)) return
        if (list.length === 0 && (agentWait() || skillWait() || pluginWait())) {
          setState("pick", "")
          return
        }
        const next = list[0] ?? ""
        setState("pick", next)
        const item = docs().get(next)
        if (!item) {
          setState({ doc: "", text: "", saved: "", busy: false })
          return
        }
        void open(item)
      },
    ),
  )

  createEffect(
    on(
      () => [state.section, agentsMd().at(0)?.id] as const,
      ([section, id]) => {
        if (section !== "agents-md" || !id) return
        if (state.doc === id || state.pick === id) return
        const item = docs().get(id)
        if (!item) return
        void open(item)
      },
    ),
  )

  createEffect(
    on(
      () => selectedCustom()?.id,
      (id) => {
        if (!id) return
        if (state.customID === id) return
        const cfgItem = cfg().provider?.[id] as ProviderCfg | undefined
        const next = providerCfg(cfgItem)
        next.providerID = id
        if (cfgItem?.npm) next.npm = cfgItem.npm
        if (!next.apiKey) {
          const provider = selectedCustom()
          if (provider?.key) next.apiKey = provider.key
          else if (provider?.env?.[0]) next.apiKey = `{env:${provider.env[0]}}`
        }
        setState("customID", id)
        setState("customApiDirty", false)
        setState("custom", next)
        setState("custom", "secret", true)
      },
    ),
  )

  async function open(item: DocItem) {
    const run = ++openRun
    setState("pick", item.id)
    const cached = item.content ?? cache.get(item.path)
    if (cached !== undefined) {
      setState({ doc: item.id, busy: false, text: cached, saved: cached })
      return
    }
    const timeout = setTimeout(() => {
      if (openRun !== run) return
      setState("busy", true)
    }, 120)
    const text = await loadDoc(item)
    clearTimeout(timeout)
    if (openRun !== run || state.pick !== item.id) return
    setState({ doc: item.id, busy: false, text, saved: text })
  }

  async function save() {
    const item = currentDoc()
    if (!item?.editable || !platform.writeConfigFile) return
    await platform
      .writeConfigFile(item.path, state.text)
      .then(() => {
        cache.set(item.path, state.text)
        setState("saved", state.text)
        showToast({ title: t("common.save"), description: item.label })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  async function reload() {
    if (!platform.reloadBackend) return
    await platform
      .reloadBackend()
      .then(async () => {
        await globalSync.bootstrap()
        showToast({
          variant: "success",
          title: language.t("toast.server.reloadBackend.success.title"),
          description: language.t("toast.server.reloadBackend.success.description"),
        })
        bump("workspaceRev", "skillRev", "agentRev", "clawRev", "gaRev", "hmRev")
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
  }

  function validateClaw(required = state.claw.enabled) {
    const url = state.claw.url.trim()
    const err = required && !url ? t("config.claws.error.urlRequired") : ""
    setState("claw", "err", "url", err)
    return !err
  }

  function clawInput(): OpenclawConfig {
    return {
      enabled: state.claw.enabled,
      url: state.claw.url.trim() || undefined,
      token: state.claw.token.trim() || undefined,
    }
  }

  async function saveClaw() {
    if (!platform.setOpenclawConfig) return
    if (!validateClaw()) return
    setState("claw", "saving", true)
    setState("claw", "test", undefined)
    if (server.current?.integration === "openclaw" && !state.claw.enabled) {
      const key = server.lastNonExtraAgent
      if (key) {
        server.setActive(key)
      }
    }
    await Promise.resolve(platform.setOpenclawConfig(clawInput()))
      .then(async () => {
        bump("clawRev")
        showToast({ variant: "success", title: t("common.save"), description: selectedClaw()?.label ?? "OpenClaw" })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("claw", "saving", false))
  }

  async function testClaw() {
    if (!platform.testOpenclawConfig) return
    if (!validateClaw(true)) return
    const run = state.claw.run + 1
    setState("claw", "run", run)
    setState("claw", "testing", true)
    setState("claw", "test", undefined)
    await platform
      .testOpenclawConfig(clawInput())
      .then((item) => {
        if (state.claw.run !== run) return
        setState("claw", "test", { ok: item.ok, logs: item.logs })
        showToast({
          variant: item.ok ? "success" : "error",
          icon: item.ok ? "circle-check" : undefined,
          title: t("config.claws.action.test"),
          description: item.ok
            ? t("config.claws.test.success")
            : (item.logs[item.logs.length - 1] ?? t("common.requestFailed")),
        })
      })
      .catch((err: unknown) => {
        if (state.claw.run !== run) return
        const message = err instanceof Error ? err.message : String(err)
        setState("claw", "test", { ok: false, logs: [message] })
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => {
        if (state.claw.run !== run) return
        setState("claw", "testing", false)
      })
  }

  async function abortClaw() {
    setState("claw", "run", (value) => value + 1)
    setState("claw", "testing", false)
    setState("claw", "test", {
      ok: false,
      logs: ["Starting OpenClaw connection test", "Test aborted by user"],
    })
    await platform.abortOpenclawTest?.().catch(() => false)
  }

  function setClaw(key: "enabled" | "url" | "token", value: string | boolean) {
    setState("claw", key, value)
    if (key === "url") setState("claw", "err", "url", "")
    setState("claw", "test", undefined)
  }

  function validateGa(required = state.ga.enabled) {
    const dir = state.ga.genericAgentDir.trim()
    const err = required && !dir ? t("config.claws.error.gaDirRequired") : ""
    setState("ga", "err", "genericAgentDir", err)
    return !err
  }

  function gaInput(): GenericagentConfig {
    return {
      enabled: state.ga.enabled,
      pythonExecutable: state.ga.pythonExecutable.trim() || undefined,
      genericAgentDir: state.ga.genericAgentDir.trim() || undefined,
    }
  }

  async function saveGa() {
    if (!platform.setGenericagentConfig) return
    if (!validateGa()) return
    setState("ga", "saving", true)
    setState("ga", "test", undefined)
    if (server.current?.integration === "genericagent" && !state.ga.enabled) {
      const key = server.lastNonExtraAgent
      if (key) {
        server.setActive(key)
      }
    }
    await Promise.resolve(platform.setGenericagentConfig(gaInput()))
      .then(async () => {
        bump("gaRev")
        showToast({ variant: "success", title: t("common.save"), description: "GenericAgent" })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("ga", "saving", false))
  }

  async function testGa() {
    if (!platform.testGenericagentConfig) return
    if (!validateGa(true)) return
    const run = state.ga.run + 1
    setState("ga", "run", run)
    setState("ga", "testing", true)
    setState("ga", "test", undefined)
    await platform
      .testGenericagentConfig(gaInput())
      .then((item) => {
        if (state.ga.run !== run) return
        setState("ga", "test", { ok: item.ok, logs: item.logs })
        showToast({
          variant: item.ok ? "success" : "error",
          icon: item.ok ? "circle-check" : undefined,
          title: t("config.claws.action.test"),
          description: item.ok
            ? t("config.claws.test.success")
            : (item.logs[item.logs.length - 1] ?? t("common.requestFailed")),
        })
      })
      .catch((err: unknown) => {
        if (state.ga.run !== run) return
        const message = err instanceof Error ? err.message : String(err)
        setState("ga", "test", { ok: false, logs: [message] })
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => {
        if (state.ga.run !== run) return
        setState("ga", "testing", false)
      })
  }

  async function abortGa() {
    setState("ga", "run", (value) => value + 1)
    setState("ga", "testing", false)
    setState("ga", "test", {
      ok: false,
      logs: ["Starting GenericAgent connection test", "Test aborted by user"],
    })
    await platform.abortGenericagentTest?.().catch(() => false)
  }

  function setGa(key: "enabled" | "pythonExecutable" | "genericAgentDir", value: string | boolean) {
    setState("ga", key, value)
    if (key === "genericAgentDir") setState("ga", "err", "genericAgentDir", "")
    setState("ga", "test", undefined)
  }

  function validateHm(required = state.hm.enabled) {
    const dir = state.hm.hermesDir.trim()
    const err = required && !dir ? t("config.claws.error.hermesDirRequired") : ""
    setState("hm", "err", "hermesDir", err)
    return !err
  }

  function hmInput(): HermesConfig {
    return {
      enabled: state.hm.enabled,
      pythonExecutable: state.hm.pythonExecutable.trim() || undefined,
      hermesDir: state.hm.hermesDir.trim() || undefined,
      hermesHome: state.hm.hermesHome.trim() || undefined,
    }
  }

  async function saveHm() {
    if (!platform.setHermesConfig) return
    if (!validateHm()) return
    const cfg = hmInput()
    console.debug("[config] save hermes", {
      enabled: cfg.enabled,
      python: cfg.pythonExecutable ?? null,
      dir: cfg.hermesDir ?? null,
      home: cfg.hermesHome ?? null,
    })
    setState("hm", "saving", true)
    setState("hm", "test", undefined)
    if (server.current?.integration === "hermes" && !state.hm.enabled) {
      const key = server.lastNonExtraAgent
      if (key) {
        server.setActive(key)
      }
    }
    await Promise.resolve(platform.setHermesConfig(cfg))
      .then(async () => {
        console.debug("[config] save hermes ok")
        bump("hmRev")
        showToast({ variant: "success", title: t("common.save"), description: "Hermes" })
      })
      .catch((err: unknown) => {
        console.debug("[config] save hermes failed", { err })
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("hm", "saving", false))
  }

  async function testHm() {
    if (!platform.testHermesConfig) return
    if (!validateHm(true)) return
    const cfg = hmInput()
    console.debug("[config] test hermes", {
      enabled: cfg.enabled,
      python: cfg.pythonExecutable ?? null,
      dir: cfg.hermesDir ?? null,
      home: cfg.hermesHome ?? null,
    })
    const run = state.hm.run + 1
    setState("hm", "run", run)
    setState("hm", "testing", true)
    setState("hm", "test", undefined)
    await platform
      .testHermesConfig(cfg)
      .then((item) => {
        if (state.hm.run !== run) return
        console.debug("[config] test hermes done", { ok: item.ok, logs: item.logs.length })
        setState("hm", "test", { ok: item.ok, logs: item.logs })
        showToast({
          variant: item.ok ? "success" : "error",
          icon: item.ok ? "circle-check" : undefined,
          title: t("config.claws.action.test"),
          description: item.ok
            ? t("config.claws.test.success")
            : (item.logs[item.logs.length - 1] ?? t("common.requestFailed")),
        })
      })
      .catch((err: unknown) => {
        if (state.hm.run !== run) return
        console.debug("[config] test hermes failed", { err })
        const message = err instanceof Error ? err.message : String(err)
        setState("hm", "test", { ok: false, logs: [message] })
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => {
        if (state.hm.run !== run) return
        setState("hm", "testing", false)
      })
  }

  async function abortHm() {
    console.debug("[config] abort hermes test")
    setState("hm", "run", (value) => value + 1)
    setState("hm", "testing", false)
    setState("hm", "test", {
      ok: false,
      logs: ["Starting Hermes connection test", "Test aborted by user"],
    })
    await platform.abortHermesTest?.().catch(() => false)
  }

  function setHm(key: "enabled" | "pythonExecutable" | "hermesDir" | "hermesHome", value: string | boolean) {
    setState("hm", key, value)
    if (key === "hermesDir") setState("hm", "err", "hermesDir", "")
    setState("hm", "test", undefined)
  }

  function openFolder() {
    const item = currentDoc()
    if (!item || !platform.openInFinder) return
    void platform.openInFinder(dir(item.path))
  }

  function copyPath() {
    const item = currentDoc()
    if (!item?.path) return
    void navigator.clipboard.writeText(item.path).then(
      () => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: t("session.share.copy.copied"),
          description: item.path,
        })
      },
      (err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      },
    )
  }

  const setConfig = (next: Config) => globalSync.set("config", next)

  async function patchConfig(patch: Partial<Config>) {
    const next = { ...cfg(), ...patch }
    await globalSDK.client.global.config.update({ config: patch as Config })
    setConfig(next)
    return next
  }

  async function update(next: Partial<Config>) {
    await patchConfig(next).catch((err: unknown) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }

  function setCustomField(key: "providerID" | "npm" | "name" | "baseURL" | "apiKey", value: string) {
    setState("custom", key, value)
    if (key === "apiKey") setState("customApiDirty", true)
    if (key === "providerID" || key === "name" || key === "baseURL") setState("custom", "err", key, undefined)
  }

  function setCustomModel(index: number, key: "id" | "name", value: string) {
    setState("custom", "models", index, key, value)
    setState("custom", "models", index, "err", key, undefined)
  }

  function setCustomHeader(index: number, key: "key" | "value", value: string) {
    setState("custom", "headers", index, key, value)
    setState("custom", "headers", index, "err", key, undefined)
  }

  function addCustomModel() {
    setState("custom", "models", (rows) => [...rows, blankModelRow()])
  }

  function removeCustomModel(index: number) {
    if (state.custom.models.length <= 1) return
    setState("custom", "models", (rows) => rows.filter((_, idx) => idx !== index))
  }

  function addCustomHeader() {
    setState("custom", "headers", (rows) => [...rows, blankHeaderRow()])
  }

  function removeCustomHeader(index: number) {
    if (state.custom.headers.length <= 1) return
    setState("custom", "headers", (rows) => rows.filter((_, idx) => idx !== index))
  }

  function createCustomProvider() {
    setState("pick", CUSTOM_NEW)
    setState("customID", "")
    setState("customApiDirty", false)
    setState("custom", providerCfg(undefined))
  }

  const [refreshing, setRefreshing] = createSignal(false)

  const refreshProviders = async () => {
    if (refreshing()) return
    setRefreshing(true)
    try {
      const result = await globalSDK.forDomain(mainDomain).client.provider.list()
      setMainProviders(normalizeProviderList(result.data!))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: t("settings.providers.refreshed.title"),
        description: t("settings.providers.refreshed.description"),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: t("common.requestFailed"), description: message })
    } finally {
      setRefreshing(false)
    }
  }

  function createSkill() {
    const text = skillTemplate("")
    setState("pick", SKILL_NEW)
    setState("doc", SKILL_NEW)
    setState("text", text)
    setState("saved", text)
    setState("busy", false)
    setState("skillTitle", "")
    setState("skillErr", "")
    setState("skillPath", "")
    setState("skillNote", "")
    setState("skillWarn", "")
    setState("skillSaving", false)
  }

  function setSkillTitle(value: string) {
    const prev = state.skillTitle
    setState("skillTitle", value)
    setState("skillErr", "")
    if (state.text !== skillTemplate(prev)) return
    const text = skillTemplate(value)
    setState("text", text)
    setState("saved", text)
  }

  function validateSkillTitle() {
    const title = state.skillTitle.trim()
    if (!title) return t("config.skills.create.error.required")
    if (title === "." || title === "..") return t("config.skills.create.error.reserved")
    if (/[/\\]/.test(title)) return t("config.skills.create.error.slash")
    return ""
  }

  async function saveSkill() {
    const root = space()?.skillsRoot
    if (!root || !platform.createConfigFile) {
      setState("skillErr", t("config.error.globalConfigUnavailable"))
      return
    }
    const err = validateSkillTitle()
    if (err) {
      setState("skillErr", err)
      return
    }
    const title = state.skillTitle.trim()
    const path = join(root, title, "SKILL.md")
    const text = state.text
    setState("skillSaving", true)
    await platform
      .createConfigFile(path, text)
      .then(async () => {
        const meta = skillMeta(text, path)
        cache.set(path, text)
        setState("skillPath", path)
        setState("skillNote", meta.description)
        setState("skillWarn", meta.warn ?? "")
        bump("skillRev")
        showToast({ variant: "success", title: t("common.save"), description: title })
        await open({
          id: `skill:${path}`,
          label: meta.name,
          path,
          editable: true,
          source: "opencode",
          note: meta.description,
          warn: meta.warn,
          group: "opencode",
        })
      })
      .catch((err: unknown) => {
        setState("skillErr", err instanceof Error ? err.message : String(err))
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("skillSaving", false))
  }

  function toggleCustomSecret() {
    setState("custom", "secret", (value) => !value)
  }

  function validateCustom() {
    const output = validateCustomProvider({
      form: state.custom,
      t: language.t,
      disabledProviders: cfg().disabled_providers ?? [],
      existingProviderIDs: new Set(providers().map((item) => item.id)),
      currentProviderID: state.custom.mode === "edit" ? state.customID : undefined,
    })
    setState("custom", "err", output.err)
    output.models.forEach((err, index) => setState("custom", "models", index, "err", err))
    output.headers.forEach((err, index) => setState("custom", "headers", index, "err", err))
    return output.result
  }

  async function writeGlobalConfig(next: Config) {
    const list = await platform.listConfigFiles?.(null)
    const file = list?.find(
      (item) => item.scope === "global" && item.kind === "config" && item.label.includes("opencode"),
    )
    if (!file?.path || !platform.readConfigFile || !platform.writeConfigFile)
      throw new Error(t("config.error.globalConfigUnavailable"))
    const text = (await platform.readConfigFile(file.path)) ?? "{}"
    const json = patchText(text, ["provider"], next.provider ?? {})
    const disabled = patchText(json, ["disabled_providers"], next.disabled_providers ?? [])
    await platform.writeConfigFile(file.path, disabled)
  }

  async function saveCustom() {
    const result = validateCustom()
    if (!result) return
    setState("custom", "saving", true)
    const prev = state.custom.mode === "edit" ? state.customID : undefined
    const id = result.providerID
    const nextProvider = { ...(cfg().provider ?? {}) } as NonNullable<Config["provider"]>
    if (prev && prev !== id) delete nextProvider[prev]
    nextProvider[id] = result.config as ProviderCfg
    if (!nextProvider[id].options) nextProvider[id].options = {}
    nextProvider[id].options = {
      ...nextProvider[id].options,
      ...(result.key ? { apiKey: result.key } : {}),
    }
    if (!result.key && nextProvider[id].options && "apiKey" in nextProvider[id].options)
      delete nextProvider[id].options.apiKey
    const nextDisabled = (cfg().disabled_providers ?? []).filter((item) => item !== id && item !== prev)
    const next = { ...cfg(), provider: nextProvider, disabled_providers: nextDisabled }
    const tasks: Promise<unknown>[] = []
    if (prev && prev !== id) tasks.push(globalSDK.client.auth.remove({ providerID: prev }).catch(() => undefined))
    if (state.customApiDirty || result.key)
      tasks.push(globalSDK.client.auth.remove({ providerID: id }).catch(() => undefined))
    await Promise.all(tasks)
      .then(() => writeGlobalConfig(next))
      .then(() => {
        batch(() => {
          setConfig(next)
          if (prev && prev !== id) globalSync.provider.remove(prev)
          setState("pick", `provider:${id}`)
          setState("customID", id)
          setState("customApiDirty", false)
          setState("custom", "mode", "edit")
          setState("custom", "secret", true)
        })
        showToast({ variant: "success", title: t("common.save"), description: id })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("custom", "saving", false))
  }

  async function deleteCustom() {
    const id = state.custom.mode === "edit" ? state.customID : state.custom.providerID.trim()
    if (!id) return
    setState("custom", "deleting", true)
    const nextProvider = { ...(cfg().provider ?? {}) } as NonNullable<Config["provider"]>
    delete nextProvider[id]
    const nextDisabled = (cfg().disabled_providers ?? []).filter((item) => item !== id)
    const next = { ...cfg(), provider: nextProvider, disabled_providers: nextDisabled }
    await globalSDK.client.auth
      .remove({ providerID: id })
      .catch(() => undefined)
      .then(() => writeGlobalConfig(next))
      .then(() => {
        batch(() => {
          setConfig(next)
          globalSync.provider.remove(id)
          createCustomProvider()
        })
        showToast({ variant: "success", title: t("config.action.delete"), description: id })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("custom", "deleting", false))
  }

  function isConfigCustom(id: string) {
    const provider = cfg().provider?.[id]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }

  function toggleProviderConfig(id: string, enabled: boolean) {
    const prev = cfg().disabled_providers ?? []
    const next = enabled ? prev.filter((item) => item !== id) : Array.from(new Set([...prev, id]))
    void update({ disabled_providers: next })
  }

  async function disconnectProvider(item: ProviderItem) {
    if (item.source === "env") return
    if (isConfigCustom(item.id)) {
      await globalSDK.client.auth.remove({ providerID: item.id }).catch(() => undefined)
      const prev = cfg().disabled_providers ?? []
      const next = prev.includes(item.id) ? prev : [...prev, item.id]
      await patchConfig({ disabled_providers: next })
      await globalSDK.client.global.dispose()
      return
    }
    await globalSDK.client.auth.remove({ providerID: item.id })
    await globalSDK.client.global.dispose()
  }

  function toggleProvider(item: ProviderItem, enabled: boolean) {
    if (item.custom) {
      toggleProviderConfig(item.id, enabled)
      return
    }
    if (enabled) {
      dialog.show(() => <DialogConnectProvider provider={item.id} />)
      return
    }
    if (item.source === "env") return
    setState("providerBusy", item.id)
    void disconnectProvider(item)
      .then(() => {
        showToast({ variant: "success", title: t("common.disconnect"), description: item.name })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setState("providerBusy", ""))
  }

  function togglePlugin(item: PluginItem, enabled: boolean) {
    const prev = cfg().plugin ?? []
    const nextSpec = item.spec ?? (item.path ? spec(item.path) : item.name)
    const key = pluginKey(nextSpec)
    const next = enabled
      ? Array.from(new Set([...prev.filter((entry) => pluginKey(entry) !== key), nextSpec]))
      : prev.filter((entry) => pluginKey(entry) !== key)
    void update({ plugin: next })
  }

  return (
    <div class="size-full overflow-hidden bg-background-base">
      <div class="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.03),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.015),transparent_22%)] xl:flex-row">
        <aside class="shrink-0 border-b border-border-weak-base bg-surface-base/92 backdrop-blur xl:w-[200px] xl:border-r xl:border-b-0">
          <div class="flex h-full min-h-0 flex-col">
            <div class="border-b border-border-weak-base px-4 py-4">
              <div class="min-w-0">
                <div class="text-18-medium text-text-strong">{t("config.title")}</div>
                <div class="mt-1 text-12-regular text-text-weak">{t("config.description")}</div>
              </div>
            </div>
            <div class="flex-1 overflow-y-auto p-3">
              <div class="flex flex-col">
                <SectionButton
                  current={state.section === "agents-md"}
                  title="AGENTS.md"
                  icon={sectionIcon("agents-md")}
                  onClick={() => jump("agents-md")}
                />
                <SectionButton
                  current={state.section === "providers"}
                  title={t("config.providers.title")}
                  icon={sectionIcon("providers")}
                  onClick={() => jump("providers")}
                />
                <SectionButton
                  current={state.section === "agents"}
                  title={t("config.agents.title")}
                  icon={sectionIcon("agents")}
                  onClick={() => jump("agents")}
                />
                <SectionButton
                  current={state.section === "skills"}
                  title={t("config.skills.title")}
                  icon={sectionIcon("skills")}
                  onClick={() => jump("skills")}
                />
                <SectionButton
                  current={state.section === "plugins"}
                  title={t("config.plugins.title")}
                  icon={sectionIcon("plugins")}
                  onClick={() => jump("plugins")}
                />
                {clawsSectionEnabled() && (
                  <SectionButton
                    current={state.section === "claws"}
                    title={t("config.claws.title")}
                    icon={sectionIcon("claws")}
                    onClick={() => jump("claws")}
                  />
                )}
              </div>
            </div>
            <div class="border-t border-border-weak-base p-3">
              <Button
                variant="ghost"
                class="h-10 w-full justify-start gap-2 rounded-lg border border-border-weak-base bg-background-base px-3 text-13-medium text-text-weak hover:border-border-strong hover:bg-surface-base-hover hover:text-text-strong active:border-border-base active:bg-surface-base-active"
                onClick={back}
                aria-label={language.t("common.goBack")}
              >
                <Icon name="arrow-left" size="small" />
                {language.t("common.goBack")}
              </Button>
            </div>
          </div>
        </aside>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
          <section class="shrink-0 border-b border-border-weak-base bg-surface-base/80 backdrop-blur xl:w-[400px] xl:border-r xl:border-b-0">
            <div class="flex h-full min-h-0 flex-col">
              <div class="px-4 py-4">
                <Switch>
                  <Match when={state.section === "agents-md"}>
                    <div class="text-15-medium text-text-strong">AGENTS.md</div>
                    <div class="mt-1 text-12-regular text-text-weak">{t("config.agentsMd.header")}</div>
                  </Match>
                  <Match when={state.section === "providers"}>
                    <div class="text-15-medium text-text-strong">{t("config.providers.title")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">{t("config.providers.header")}</div>
                    <div class="mt-3 flex items-center gap-2">
                      <Button size="small" variant="secondary" icon="plus-small" onClick={createCustomProvider}>
                        {t("config.custom.new")}
                      </Button>
                      <Tooltip placement="top" value={t("settings.providers.refresh")}>
                        <IconButton
                          icon="arrow-sync"
                          variant="ghost"
                          iconSize="normal"
                          class="size-6"
                          disabled={refreshing()}
                          aria-label={t("settings.providers.refresh")}
                          onClick={() => void refreshProviders()}
                        />
                      </Tooltip>
                    </div>
                    <div class="mt-3 rounded-xl border border-border-weak-base bg-background-base px-3 py-2.5">
                      <input
                        type="text"
                        value={state.query}
                        placeholder={t("dialog.provider.search.placeholder")}
                        class="w-full bg-transparent text-13-regular text-text-base outline-none placeholder:text-text-weak"
                        onInput={(event) => setState("query", event.currentTarget.value)}
                      />
                    </div>
                  </Match>
                  <Match when={state.section === "agents"}>
                    <div class="text-15-medium text-text-strong">{t("config.agents.title")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">{t("config.agents.header")}</div>
                  </Match>
                  <Match when={state.section === "claws" && clawsSectionEnabled()}>
                    <div class="text-15-medium text-text-strong">{t("config.claws.title")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">{t("config.claws.header")}</div>
                  </Match>
                  <Match when={state.section === "skills"}>
                    <div class="text-15-medium text-text-strong">{t("config.skills.title")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">{t("config.skills.header")}</div>
                    <div class="mt-3">
                      <Button
                        size="small"
                        variant="ghost"
                        icon="folder-add-left"
                        class="h-8 rounded-lg border border-border-weak-base bg-background-base px-2.5 pr-3 text-12-medium text-text-base shadow-none transition-colors hover:border-border-strong hover:bg-surface-base-hover active:border-border-base active:bg-surface-base-active focus-visible:border-border-strong focus-visible:bg-surface-base-hover disabled:border-border-weak-base disabled:bg-background-base disabled:text-text-weaker"
                        onClick={createSkill}
                        disabled={!space()?.skillsRoot || !platform.createConfigFile}
                      >
                        {t("config.skills.create.action")}
                      </Button>
                    </div>
                  </Match>
                  <Match when={state.section === "plugins"}>
                    <div class="text-15-medium text-text-strong">{t("config.plugins.title")}</div>
                    <div class="mt-1 text-12-regular text-text-weak">{t("config.plugins.header")}</div>
                  </Match>
                </Switch>
              </div>
              <div
                ref={(el) => {
                  skillsList = el
                }}
                class="min-h-0 flex-1 overflow-y-auto p-3"
              >
                <div class="flex flex-col">
                  <Switch>
                    <Match when={state.section === "agents-md"}>
                      <For each={agentsMd()}>
                        {(item) => (
                          <ListButton
                            active={state.pick === item.id}
                            title={item.label}
                            note={item.note}
                            meta={short(item.path, space()?.configRoot)}
                            onClick={() => void open(item)}
                          />
                        )}
                      </For>
                    </Match>

                    <Match when={state.section === "providers"}>
                      <Show
                        when={providerList().length > 0}
                        fallback={
                          <div class="rounded-xl border border-dashed border-border-weak-base bg-surface-base px-4 py-8 text-12-regular text-text-weak">
                            {t("config.providers.empty", { query: state.query })}
                          </div>
                        }
                      >
                        <div class="flex flex-col gap-3">
                          <Show when={providerOn().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.providers.group.enabled")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {providerOn().length}
                                </div>
                              </div>
                              <For each={providerOn()}>
                                {(item) => (
                                  <ListButton
                                    active={state.pick === `provider:${item.id}`}
                                    title={item.id}
                                    note={
                                      item.custom
                                        ? t("config.providers.note.customEnabled", { count: item.models.length })
                                        : t("config.providers.note.models", { count: item.models.length })
                                    }
                                    meta={item.custom ? item.sdk : undefined}
                                    onClick={() => setState("pick", `provider:${item.id}`)}
                                    extra={
                                      <Toggle
                                        checked={item.custom ? item.allowed : item.connected}
                                        disabled={
                                          state.providerBusy === item.id || (!item.custom && item.source === "env")
                                        }
                                        onChange={(value) => toggleProvider(item, value)}
                                        hideLabel
                                      >
                                        {item.id}
                                      </Toggle>
                                    }
                                  />
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={providerOff().length > 0}>
                            <div class="flex flex-col gap-2">
                              <button
                                type="button"
                                class="flex items-center justify-between gap-3 px-1 cursor-pointer hover:opacity-80"
                                onClick={() => setState("providerOffCollapsed", !state.providerOffCollapsed)}
                              >
                                <div class="flex items-center gap-2">
                                  <Icon
                                    name={state.providerOffCollapsed ? "chevron-right" : "chevron-down"}
                                    size="small"
                                  />
                                  <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                    {t("config.providers.group.existing")}
                                  </div>
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {providerOff().length}
                                </div>
                              </button>
                              <Show when={!state.providerOffCollapsed}>
                                <div class="rounded-xl border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
                                  {t("config.providers.existingNote")}
                                </div>
                                <div class="flex flex-col">
                                  <For each={providerOff()}>
                                    {(item) => (
                                      <ListButton
                                        active={state.pick === `provider:${item.id}`}
                                        title={item.id}
                                        note={
                                          item.custom
                                            ? item.allowed
                                              ? t("config.providers.note.customEnabled", { count: item.models.length })
                                              : t("config.providers.note.customDisabled", { count: item.models.length })
                                            : t("config.providers.note.known", { count: item.models.length })
                                        }
                                        meta={item.custom ? item.sdk : undefined}
                                        onClick={() => setState("pick", `provider:${item.id}`)}
                                        extra={
                                          <Toggle
                                            checked={item.custom ? item.allowed : item.connected}
                                            disabled={state.providerBusy === item.id}
                                            onChange={(value) => toggleProvider(item, value)}
                                            hideLabel
                                          >
                                            {item.id}
                                          </Toggle>
                                        }
                                      />
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </Match>

                    <Match when={state.section === "agents"}>
                      <Show
                        when={!agentWait()}
                        fallback={<Wait text={`${t("common.loading")}${t("common.loading.ellipsis")}`} />}
                      >
                        <div class="flex flex-col gap-3">
                          <Show when={agentOpenCode().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.skills.group.opencode")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {agentOpenCode().length}
                                </div>
                              </div>
                              <For each={agentOpenCode()}>
                                {(item) => (
                                  <ListButton
                                    active={state.pick === item.id}
                                    title={item.label}
                                    note={
                                      loadedMap().get(item.label)?.description ||
                                      agentModeLabel(loadedMap().get(item.label)?.mode) ||
                                      item.note
                                    }
                                    meta={short(item.path, space()?.agentsRoot)}
                                    onClick={() => void open(item)}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={agentProject().length > 0}>
                            <div class="flex flex-col gap-1">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.skills.group.project")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {agentProject().length}
                                </div>
                              </div>
                              <For each={projectAgentGroups()}>
                                {([name, items]) => (
                                  <div class="flex flex-col rounded-xl border border-border-weak-base bg-background-base/70">
                                    <button
                                      type="button"
                                      class="flex items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2 text-left"
                                      onClick={() => toggleAgentProject(name)}
                                    >
                                      <div class="flex min-w-0 items-center gap-2">
                                        <div class="text-text-weak">
                                          <Icon
                                            name={agentProjectOpen(name) ? "chevron-down" : "chevron-right"}
                                            size="small"
                                          />
                                        </div>
                                        <div class="truncate text-12-medium text-text-strong">{name}</div>
                                      </div>
                                      <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                        {items.length}
                                      </div>
                                    </button>
                                    <Show when={agentProjectOpen(name)}>
                                      <div class="flex flex-col p-1">
                                        <For each={items}>
                                          {(item) => (
                                            <ListButton
                                              active={state.pick === item.id}
                                              title={item.label}
                                              note={
                                                loadedMap().get(item.label)?.description ||
                                                agentModeLabel(loadedMap().get(item.label)?.mode) ||
                                                item.note
                                              }
                                              meta={[item.origin, short(item.path, item.root)]
                                                .filter(Boolean)
                                                .join(" · ")}
                                              onClick={() => void open(item)}
                                            />
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={agentPlugin().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.plugins.title")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {agentPlugin().length}
                                </div>
                              </div>
                              <For each={agentPlugin()}>
                                {(item) => (
                                  <ListButton
                                    active={state.pick === item.id}
                                    title={item.label}
                                    note={
                                      loadedMap().get(item.label)?.description ||
                                      agentModeLabel(loadedMap().get(item.label)?.mode) ||
                                      item.note
                                    }
                                    meta={[item.project, item.origin, short(item.path, item.root)]
                                      .filter(Boolean)
                                      .join(" · ")}
                                    onClick={() => void open(item)}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </Match>

                    <Match when={state.section === "claws" && clawsSectionEnabled()}>
                      <For each={claws()}>
                        {(item) => (
                          <ListButton
                            active={state.pick === item.id}
                            title={item.label}
                            note={item.note}
                            meta={item.meta}
                            onClick={() => setState("pick", item.id)}
                            extra={
                              <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                {item.enabled ? t("config.claws.badge.enabled") : t("config.claws.badge.disabled")}
                              </span>
                            }
                          />
                        )}
                      </For>
                    </Match>

                    <Match when={state.section === "skills"}>
                      <Show
                        when={!skillWait()}
                        fallback={<Wait text={`${t("common.loading")}${t("common.loading.ellipsis")}`} />}
                      >
                        <div class="flex flex-col gap-3">
                          <Show when={skillOpenCode().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.skills.group.opencode")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {skillOpenCode().length}
                                </div>
                              </div>
                              <For each={skillOpenCode()}>
                                {(item) => (
                                  <ListButton
                                    active={state.pick === item.id}
                                    title={item.label}
                                    meta={short(item.path, space()?.skillsRoot)}
                                    warn={!!item.warn}
                                    tone={item.warn ? "danger" : undefined}
                                    extra={
                                      <Show when={item.warn}>
                                        <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-danger-base">
                                          {t("config.skills.badge.needsMetadata")}
                                        </span>
                                      </Show>
                                    }
                                    onClick={() => void open(item)}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={skillClaude().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.skills.group.claude")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {skillClaude().length}
                                </div>
                              </div>
                              <For each={skillClaude()}>
                                {(item) => (
                                  <ListButton
                                    active={state.pick === item.id}
                                    title={item.label}
                                    meta={item.path}
                                    warn={!!item.warn}
                                    tone={item.warn ? "danger" : undefined}
                                    extra={
                                      <Show when={item.warn}>
                                        <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-danger-base">
                                          {t("config.skills.badge.needsMetadata")}
                                        </span>
                                      </Show>
                                    }
                                    onClick={() => void open(item)}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={skillExternal().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.skills.group.external")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {skillExternal().length}
                                </div>
                              </div>
                              <For each={skillExternal()}>
                                {(item) => (
                                  <ListButton
                                    active={state.pick === item.id}
                                    title={item.label}
                                    meta={item.origin ? `${item.origin} · ${item.path}` : item.path}
                                    warn={!!item.warn}
                                    tone={item.warn ? "danger" : undefined}
                                    extra={
                                      <Show when={item.warn}>
                                        <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-danger-base">
                                          {t("config.skills.badge.needsMetadata")}
                                        </span>
                                      </Show>
                                    }
                                    onClick={() => void open(item)}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>

                          <Show when={skillProject().length > 0}>
                            <div class="flex flex-col">
                              <div class="flex items-center justify-between gap-3 px-1">
                                <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                                  {t("config.skills.group.project")}
                                </div>
                                <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                  {skillProject().length}
                                </div>
                              </div>
                              <div class="mt-2 flex flex-col gap-3">
                                <For each={projectSkills()}>
                                  {(group) => (
                                    <div class="flex flex-col rounded-xl border border-border-weak-base bg-background-base/70">
                                      <button
                                        type="button"
                                        class="flex items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2 text-left"
                                        onClick={() => keepSkillsScroll(() => toggleGroup(group.path ?? group.label))}
                                      >
                                        <div class="flex min-w-0 items-start gap-2">
                                          <div class="mt-0.5 text-text-weak">
                                            <Icon
                                              name={
                                                groupOpen(group.path ?? group.label) ? "chevron-down" : "chevron-right"
                                              }
                                              size="small"
                                            />
                                          </div>
                                          <div class="min-w-0">
                                            <div class="truncate text-12-medium text-text-strong">{group.label}</div>
                                            <Show when={group.path}>
                                              <div class="mt-1 break-all font-mono text-[11px] leading-5 text-text-weak">
                                                {group.path}
                                              </div>
                                            </Show>
                                          </div>
                                        </div>
                                        <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                          {group.items.length}
                                        </div>
                                      </button>
                                      <Show when={groupOpen(group.path ?? group.label)}>
                                        <For each={group.items}>
                                          {(item) => (
                                            <ListButton
                                              active={state.pick === item.id}
                                              title={item.label}
                                              meta={item.origin ? `${item.origin} · ${item.path}` : item.path}
                                              warn={!!item.warn}
                                              tone={item.warn ? "danger" : undefined}
                                              extra={
                                                <Show when={item.warn}>
                                                  <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-danger-base">
                                                    {t("config.skills.badge.needsMetadata")}
                                                  </span>
                                                </Show>
                                              }
                                              onClick={() => keepSkillsScroll(() => void open(item))}
                                            />
                                          )}
                                        </For>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </Match>

                    <Match when={state.section === "plugins"}>
                      <Show when={pluginGlobal().length > 0}>
                        <div class="flex flex-col">
                          <div class="flex items-center justify-between gap-3 px-1">
                            <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                              {t("config.plugins.group.global")}
                            </div>
                            <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                              {pluginGlobal().length}
                            </div>
                          </div>
                          <div class="mt-2 flex flex-col">
                            <For each={pluginGlobal()}>
                              {(item) => (
                                <ListButton
                                  active={state.pick === item.id}
                                  title={item.label}
                                  note={item.exists ? undefined : t("config.plugins.note.missing")}
                                  meta={item.path ? short(item.path, space()?.pluginsRoot) : undefined}
                                  warn={item.enabled && !item.exists}
                                  onClick={() => {
                                    setState("pick", item.id)
                                    const doc = docs().get(item.id)
                                    if (!doc) return
                                    void open(doc)
                                  }}
                                  extra={
                                    <Toggle
                                      checked={item.enabled}
                                      onChange={(value) => togglePlugin(item, value)}
                                      hideLabel
                                    >
                                      {item.label}
                                    </Toggle>
                                  }
                                />
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>

                      <Show when={pluginProject().length > 0}>
                        <div class="flex flex-col">
                          <div class="flex items-center justify-between gap-3 px-1">
                            <div class="text-11-medium uppercase tracking-[0.08em] text-text-weak">
                              {t("config.plugins.group.project")}
                            </div>
                            <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                              {pluginProject().length}
                            </div>
                          </div>
                          <div class="mt-2 flex flex-col gap-3">
                            <For each={projectPlugins()}>
                              {(group) => (
                                <div class="flex flex-col rounded-xl border border-border-weak-base bg-background-base/70">
                                  <button
                                    type="button"
                                    class="flex items-center justify-between gap-3 border-b border-border-weak-base px-3 py-2 text-left"
                                    onClick={() => toggleGroup(`plugin-group:${group.path ?? group.label}`)}
                                  >
                                    <div class="flex min-w-0 items-start gap-2">
                                      <div class="mt-0.5 text-text-weak">
                                        <Icon
                                          name={
                                            groupOpen(`plugin-group:${group.path ?? group.label}`)
                                              ? "chevron-down"
                                              : "chevron-right"
                                          }
                                          size="small"
                                        />
                                      </div>
                                      <div class="min-w-0">
                                        <div class="truncate text-12-medium text-text-strong">{group.label}</div>
                                        <Show when={group.path}>
                                          <div class="mt-1 break-all font-mono text-[11px] leading-5 text-text-weak">
                                            {group.path}
                                          </div>
                                        </Show>
                                      </div>
                                    </div>
                                    <div class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                                      {group.items.length}
                                    </div>
                                  </button>
                                  <Show when={groupOpen(`plugin-group:${group.path ?? group.label}`)}>
                                    <For each={group.items}>
                                      {(item) => (
                                        <ListButton
                                          active={state.pick === item.id}
                                          title={item.label}
                                          note={item.exists ? undefined : t("config.plugins.note.missing")}
                                          meta={item.origin ? `${item.origin} · ${item.path}` : item.path}
                                          warn={item.enabled && !item.exists}
                                          onClick={() => {
                                            setState("pick", item.id)
                                            const doc = docs().get(item.id)
                                            if (!doc) return
                                            void open(doc)
                                          }}
                                          extra={
                                            <Toggle
                                              checked={item.enabled}
                                              onChange={(value) => togglePlugin(item, value)}
                                              hideLabel
                                            >
                                              {item.label}
                                            </Toggle>
                                          }
                                        />
                                      )}
                                    </For>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </Match>
                  </Switch>
                </div>
              </div>
            </div>
          </section>

          <main class="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Switch>
              <Match when={state.section === "providers"}>
                <Show
                  when={selectedCustom() || state.pick === CUSTOM_NEW}
                  fallback={
                    <ProviderDetail
                      item={selectedProvider()}
                      busy={state.providerBusy === selectedProvider()?.id}
                      onToggle={toggleProvider}
                    />
                  }
                >
                  <CustomEditor
                    item={selectedCustom()}
                    form={state.custom}
                    busy={state.providerBusy === selectedCustom()?.id}
                    onToggle={toggleProvider}
                    onField={setCustomField}
                    onModel={setCustomModel}
                    onHeader={setCustomHeader}
                    onAddModel={addCustomModel}
                    onRemoveModel={removeCustomModel}
                    onAddHeader={addCustomHeader}
                    onRemoveHeader={removeCustomHeader}
                    onReload={platform.reloadBackend ? () => void reload() : undefined}
                    onSave={() => void saveCustom()}
                    onDelete={() => void deleteCustom()}
                    onCreate={createCustomProvider}
                    onSecret={toggleCustomSecret}
                  />
                </Show>
              </Match>

              <Match when={state.section === "claws" && clawsSectionEnabled()}>
                <Switch
                  fallback={
                    <ClawEditor
                      item={selectedClaw()}
                      form={state.claw}
                      dirty={clawDirty()}
                      busy={openclaw.loading}
                      canTest={!!platform.testOpenclawConfig}
                      onChange={setClaw}
                      onSave={() => void saveClaw()}
                      onTest={() => void testClaw()}
                      onAbort={platform.abortOpenclawTest ? () => void abortClaw() : undefined}
                    />
                  }
                >
                  <Match when={selectedClaw()?.id === "claw:hermes"}>
                    <HermesEditor
                      item={selectedClaw()}
                      form={state.hm}
                      dirty={hmDirty()}
                      busy={hermes.loading}
                      canTest={!!platform.testHermesConfig}
                      onChange={setHm}
                      onSave={() => void saveHm()}
                      onTest={() => void testHm()}
                      onAbort={platform.abortHermesTest ? () => void abortHm() : undefined}
                    />
                  </Match>
                  <Match when={selectedClaw()?.id === "claw:genericagent"}>
                    <GenericAgentEditor
                      item={selectedClaw()}
                      form={state.ga}
                      dirty={gaDirty()}
                      busy={genericagent.loading}
                      canTest={!!platform.testGenericagentConfig}
                      onChange={setGa}
                      onSave={() => void saveGa()}
                      onTest={() => void testGa()}
                      onAbort={platform.abortGenericagentTest ? () => void abortGa() : undefined}
                    />
                  </Match>
                </Switch>
              </Match>

              <Match when={state.section === "plugins"}>
                <Show
                  when={selectedPlugin()?.path}
                  fallback={
                    <div class="bg-surface-base px-4 py-10">
                      <div class="text-15-medium text-text-strong">
                        {selectedPlugin()?.label ?? t("config.plugins.select")}
                      </div>
                      <div class="mt-2 text-12-regular text-text-weak">
                        <Show when={selectedPlugin()} fallback={t("config.plugins.empty")}>
                          {t("config.plugins.missingDetail")}
                        </Show>
                      </div>
                      <Show when={selectedPlugin()}>
                        <div class="mt-4">
                          <Toggle
                            checked={!!selectedPlugin()?.enabled}
                            onChange={(value) => selectedPlugin() && togglePlugin(selectedPlugin()!, value)}
                          >
                            {t("config.provider.badge.enabled")}
                          </Toggle>
                        </div>
                      </Show>
                    </div>
                  }
                >
                  <Editor
                    item={currentDoc()}
                    text={state.text}
                    dirty={dirty()}
                    busy={state.busy}
                    onInput={(value) => setState("text", value)}
                    onSave={() => void save()}
                    onReload={() => void reload()}
                    onOpenFolder={currentDoc() ? openFolder : undefined}
                    extra={
                      <Toggle
                        checked={!!currentPlugin()?.enabled}
                        onChange={(value) => currentPlugin() && togglePlugin(currentPlugin()!, value)}
                      >
                        {t("config.provider.badge.enabled")}
                      </Toggle>
                    }
                    empty={t("config.plugins.empty")}
                  />
                </Show>
              </Match>

              <Match when={state.section === "skills"}>
                <Show
                  when={skillWait()}
                  fallback={
                    <Show
                      when={state.pick === SKILL_NEW}
                      fallback={
                        <Editor
                          item={currentDoc()}
                          text={state.text}
                          dirty={dirty()}
                          busy={state.busy}
                          tree={tree()}
                          treeRoot={currentSkillRoot()}
                          treeBusy={tree.loading}
                          treeOpen={treeOpen}
                          onTreeToggle={toggleTree}
                          onInput={(value) => setState("text", value)}
                          onSave={() => void save()}
                          onReload={() => void reload()}
                          onOpenFolder={currentDoc() ? openFolder : undefined}
                          onCopyPath={currentDoc() ? copyPath : undefined}
                          warn={currentDoc()?.warn}
                          empty={t("config.skills.empty")}
                          markdown
                        />
                      }
                    >
                      <SkillCreator
                        root={space()?.skillsRoot}
                        title={state.skillTitle}
                        text={state.text}
                        busy={state.skillSaving}
                        err={state.skillErr || undefined}
                        onTitle={setSkillTitle}
                        onInput={(value) => setState("text", value)}
                        onSave={() => void saveSkill()}
                      />
                    </Show>
                  }
                >
                  <Wait text={`${t("common.loading")}${t("common.loading.ellipsis")}`} />
                </Show>
              </Match>

              <Match when={state.section === "agents"}>
                <Show
                  when={!agentWait()}
                  fallback={<Wait text={`${t("common.loading")}${t("common.loading.ellipsis")}`} />}
                >
                  <Editor
                    item={currentDoc()}
                    text={state.text}
                    dirty={dirty()}
                    busy={state.busy}
                    onInput={(value) => setState("text", value)}
                    onSave={() => void save()}
                    onReload={() => void reload()}
                    onOpenFolder={file(currentDoc()?.path ?? "") ? openFolder : undefined}
                    onCopyPath={file(currentDoc()?.path ?? "") ? copyPath : undefined}
                    extra={
                      <Show when={currentAgent()}>
                        <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
                          {agentModeLabel(loadedMap().get(currentAgent()!.label)?.mode)}
                        </span>
                      </Show>
                    }
                    empty={t("config.agents.empty")}
                    markdown
                  />
                </Show>
              </Match>

              <Match when={state.section === "agents-md"}>
                <Editor
                  item={currentDoc()}
                  text={state.text}
                  dirty={dirty()}
                  busy={state.busy}
                  onInput={(value) => setState("text", value)}
                  onSave={() => void save()}
                  onReload={() => void reload()}
                  onOpenFolder={currentDoc() ? openFolder : undefined}
                  empty={t("config.agentsMd.empty")}
                  markdown
                />
              </Match>
            </Switch>
          </main>
        </div>
      </div>
    </div>
  )
}
const yaml = (value: string) => JSON.stringify(value.trim())

function skillTemplate(title: string) {
  const name = title.trim()
  return [
    "---",
    `name: ${yaml(name)}`,
    'description: "Describe when to use this skill."',
    "---",
    "",
    name ? `# ${name}` : "# New Skill",
    "",
    "Add instructions, workflows, and examples here.",
    "",
  ].join("\n")
}

function SkillCreator(props: {
  root?: string
  title: string
  text: string
  busy: boolean
  err?: string
  onTitle: (value: string) => void
  onInput: (value: string) => void
  onSave: () => void
}) {
  const language = useLanguage()

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="border-b border-border-weak-base px-5 py-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <div class="truncate text-15-medium text-text-strong">{language.t("config.skills.create.title")}</div>
            <span class="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-weak">
              {language.t("config.editor.badge.editable")}
            </span>
          </div>
          <div class="mt-1 text-12-regular text-text-weak">{language.t("config.skills.create.description")}</div>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <SaveButton
              label={language.t("common.save")}
              onClick={props.onSave}
              disabled={props.busy || !props.title.trim()}
            />
          </div>
        </div>
      </div>
      <div class="grid min-h-0 flex-1 auto-rows-fr gap-4 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div class="flex min-h-0 flex-col gap-4">
          <div class="rounded-xl border border-border-weak-base bg-background-base p-4">
            <TextField
              label={language.t("config.skills.create.field")}
              placeholder={language.t("config.skills.create.placeholder")}
              value={props.title}
              onChange={props.onTitle}
              validationState={props.err ? "invalid" : undefined}
              error={props.err}
            />
            <div class="mt-3 rounded-lg border border-border-weak-base bg-surface-secondary px-3 py-2 text-12-regular text-text-weak">
              {language.t("config.skills.create.preview", {
                root: props.root ?? "~/.config/opencode/skills",
                folder: props.title.trim() || language.t("config.skills.create.previewPending"),
              })}
            </div>
          </div>
          <div class="min-h-0 flex-1">
            <MarkdownField text={props.text} busy={props.busy} editable={true} onInput={props.onInput} paint={paint} />
          </div>
        </div>
        <div class="flex h-full min-h-0 flex-col rounded-xl border border-border-weak-base bg-background-base p-3">
          <div class="mb-3 text-11-medium uppercase tracking-[0.08em] text-text-weak">
            {language.t("config.editor.structure")}
          </div>
          <div class="text-12-regular text-text-weak">{language.t("config.skills.create.structure")}</div>
        </div>
      </div>
    </div>
  )
}
