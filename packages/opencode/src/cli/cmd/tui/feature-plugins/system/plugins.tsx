import { Keybind } from "@/util/keybind"
import { errorMessage } from "@/util/error"
import { installPlugin, patchPluginConfig, readPluginManifest } from "@/plugin/install"
import { Process } from "@/util/process"
import type { TuiPlugin, TuiPluginApi, TuiPluginStatus } from "@opencode-ai/plugin/tui"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { fileURLToPath } from "url"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createEffect, createMemo, createSignal } from "solid-js"

const id = "internal:plugin-manager"
const key = Keybind.parse("space").at(0)
const add = Keybind.parse("i").at(0)
const tab = Keybind.parse("tab").at(0)

function state(api: TuiPluginApi, item: TuiPluginStatus) {
  if (!item.enabled) {
    return <span style={{ fg: api.theme.current.textMuted }}>disabled</span>
  }

  return (
    <span style={{ fg: item.active ? api.theme.current.success : api.theme.current.error }}>
      {item.active ? "active" : "inactive"}
    </span>
  )
}

function source(spec: string) {
  if (!spec.startsWith("file://")) return
  return fileURLToPath(spec)
}

function meta(item: TuiPluginStatus, width: number) {
  if (item.source === "internal") {
    if (width >= 120) return "Built-in plugin"
    return "Built-in"
  }
  const next = source(item.spec)
  if (next) return next
  return item.spec
}

function cause(err: unknown) {
  if (!err || typeof err !== "object") return
  if (!("cause" in err)) return
  return (err as { cause?: unknown }).cause
}

function detail(err: unknown) {
  const hit = cause(err) ?? err
  if (!(hit instanceof Process.RunFailedError)) {
    return {
      msg: errorMessage(hit),
      miss: false,
    }
  }

  const lines = hit.stderr
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const errs = lines.filter((line) => line.startsWith("error:")).map((line) => line.replace(/^error:\s*/, ""))
  return {
    msg: errs[0] ?? lines.at(-1) ?? errorMessage(hit),
    miss: lines.some((line) => line.includes("No version matching")),
  }
}

async function apply(api: TuiPluginApi, mod: string, global: boolean) {
  if (!api.state.path.directory) {
    return {
      ok: false as const,
      msg: "Paths are still syncing. Try again in a moment.",
    }
  }

  const install = await installPlugin(mod)
  if (!install.ok) {
    const out = detail(install.error)
    return {
      ok: false as const,
      msg: out.msg,
      miss: out.miss,
    }
  }

  const manifest = await readPluginManifest(install.target)
  if (!manifest.ok) {
    if (manifest.code === "manifest_no_targets") {
      return {
        ok: false as const,
        msg: `"${mod}" does not declare supported targets in package.json`,
      }
    }

    return {
      ok: false as const,
      msg: `Installed "${mod}" but failed to read ${manifest.file}`,
    }
  }

  const patch = await patchPluginConfig({
    spec: mod,
    targets: manifest.targets,
    global,
    vcs: api.state.path.worktree && api.state.path.worktree !== "/" ? "git" : undefined,
    worktree: api.state.path.worktree,
    directory: api.state.path.directory,
  })
  if (!patch.ok) {
    if (patch.code === "invalid_json") {
      return {
        ok: false as const,
        msg: `Invalid JSON in ${patch.file} (${patch.parse} at line ${patch.line}, column ${patch.col})`,
      }
    }
    return {
      ok: false as const,
      msg: errorMessage(patch.error),
    }
  }

  return {
    ok: true as const,
    dir: patch.dir,
    tui: manifest.targets.some((item) => item.kind === "tui"),
  }
}

function Install(props: { api: TuiPluginApi }) {
  const [global, setGlobal] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  useKeyboard((evt) => {
    if (evt.name !== "tab") return
    evt.preventDefault()
    evt.stopPropagation()
    if (busy()) return
    setGlobal((x) => !x)
  })

  return (
    <props.api.ui.DialogPrompt
      title="Install plugin"
      placeholder="npm package name"
      description={() => (
        <box flexDirection="row" gap={1}>
          <text fg={props.api.theme.current.textMuted}>scope:</text>
          <text fg={props.api.theme.current.text}>{global() ? "global" : "local"}</text>
          <text fg={props.api.theme.current.textMuted}>({Keybind.toString(tab)} toggle)</text>
        </box>
      )}
      onConfirm={(raw) => {
        if (busy()) return
        const mod = raw.trim()
        if (!mod) {
          props.api.ui.toast({
            variant: "error",
            message: "Plugin package name is required",
          })
          return
        }

        setBusy(true)
        apply(props.api, mod, global())
          .then((out) => {
            if (!out.ok) {
              props.api.ui.toast({
                variant: "error",
                message: out.msg,
              })
              if ("miss" in out && out.miss) {
                props.api.ui.toast({
                  variant: "info",
                  message: "Check npm registry/auth settings and try again.",
                })
              }
              return
            }

            props.api.ui.toast({
              variant: "success",
              message: `Installed ${mod} (${global() ? "global" : "local"}: ${out.dir})`,
            })
            if (!out.tui) {
              props.api.ui.toast({
                variant: "info",
                message: "Package has no TUI target to load in this app.",
              })
              show(props.api)
              return
            }

            return props.api.plugins.add(mod).then((ok) => {
              if (!ok) {
                props.api.ui.toast({
                  variant: "warning",
                  message: "Installed plugin, but runtime load failed. See console/logs; restart TUI to retry.",
                })
                show(props.api)
                return
              }

              props.api.ui.toast({
                variant: "success",
                message: `Loaded ${mod} in current session.`,
              })
              show(props.api)
            })
          })
          .finally(() => {
            setBusy(false)
          })
      }}
      onCancel={() => {
        show(props.api)
      }}
    />
  )
}

function row(api: TuiPluginApi, item: TuiPluginStatus, width: number): DialogSelectOption<string> {
  return {
    title: item.id,
    value: item.id,
    category: item.source === "internal" ? "Internal" : "External",
    description: meta(item, width),
    footer: state(api, item),
    disabled: item.id === id,
  }
}

function showInstall(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <Install api={api} />)
}

function View(props: { api: TuiPluginApi }) {
  const size = useTerminalDimensions()
  const [list, setList] = createSignal(props.api.plugins.list())
  const [cur, setCur] = createSignal<string | undefined>()
  const [lock, setLock] = createSignal(false)

  createEffect(() => {
    const width = size().width
    if (width >= 128) {
      props.api.ui.dialog.setSize("xlarge")
      return
    }
    if (width >= 96) {
      props.api.ui.dialog.setSize("large")
      return
    }
    props.api.ui.dialog.setSize("medium")
  })

  const rows = createMemo(() =>
    [...list()]
      .sort((a, b) => {
        const x = a.source === "internal" ? 1 : 0
        const y = b.source === "internal" ? 1 : 0
        if (x !== y) return x - y
        return a.id.localeCompare(b.id)
      })
      .map((item) => row(props.api, item, size().width)),
  )

  const flip = (x: string) => {
    if (lock()) return
    const item = list().find((entry) => entry.id === x)
    if (!item) return
    setLock(true)
    const task = item.active ? props.api.plugins.deactivate(x) : props.api.plugins.activate(x)
    task
      .then((ok) => {
        if (!ok) {
          props.api.ui.toast({
            variant: "error",
            message: `Failed to update plugin ${item.id}`,
          })
        }
        setList(props.api.plugins.list())
      })
      .finally(() => {
        setLock(false)
      })
  }

  return (
    <DialogSelect
      title="Plugins"
      options={rows()}
      current={cur()}
      onMove={(item) => setCur(item.value)}
      keybind={[
        {
          title: "toggle",
          keybind: key,
          disabled: lock(),
          onTrigger: (item) => {
            setCur(item.value)
            flip(item.value)
          },
        },
        {
          title: "install",
          keybind: add,
          disabled: lock(),
          onTrigger: () => {
            showInstall(props.api)
          },
        },
      ]}
      onSelect={(item) => {
        setCur(item.value)
        flip(item.value)
      }}
    />
  )
}

function show(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <View api={api} />)
}

const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    {
      title: "Plugins",
      value: "plugins.list",
      keybind: "plugin_manager",
      category: "System",
      onSelect() {
        show(api)
      },
    },
    {
      title: "Install plugin",
      value: "plugins.install",
      category: "System",
      onSelect() {
        showInstall(api)
      },
    },
  ])
}

export default {
  id,
  tui,
}
