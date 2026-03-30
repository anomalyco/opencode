import { createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useLocal } from "@tui/context/local"
import { useTheme } from "@tui/context/theme"
import { Global } from "@/global"
import { Agent } from "@/agent/agent"
import { Instance } from "@/project/instance"
import { ModelID, ProviderID } from "@/provider/schema"
import { Keybind } from "@/util/keybind"
import { Editor } from "@tui/util/editor"
import { useRenderer } from "@opentui/solid"
import path from "path"
import { pipe, sortBy, flatMap, entries, filter, map } from "remeda"
import matter from "gray-matter"

// ─── Shared helpers ───────────────────────────────────────────────────────────

const PERMISSION_LIST = [
  { key: "read",               title: "Read files",      description: "View file contents",               category: "File Operations"  },
  { key: "edit",               title: "Edit files",      description: "Modify, write, apply patches",     category: "File Operations"  },
  { key: "glob",               title: "Glob patterns",   description: "Match files by pattern",           category: "File Operations"  },
  { key: "grep",               title: "Search content",  description: "Search file contents with regex",  category: "File Operations"  },
  { key: "list",               title: "List directory",  description: "View directory contents",          category: "File Operations"  },
  { key: "bash",               title: "Run commands",    description: "Execute shell commands",           category: "Execution"        },
  { key: "external_directory", title: "External access", description: "Access outside project directory", category: "Execution"        },
  { key: "task",               title: "Launch agents",   description: "Create and run sub-agents",        category: "Agent Management" },
  { key: "skill",              title: "Load skills",     description: "Load skill modules",               category: "Agent Management" },
  { key: "webfetch",           title: "Fetch URLs",      description: "Download web content",             category: "Web & Search"     },
  { key: "websearch",          title: "Web search",      description: "Search the internet",              category: "Web & Search"     },
  { key: "codesearch",         title: "Code search",     description: "Search code repositories",         category: "Web & Search"     },
  { key: "lsp",                title: "Language server", description: "Use LSP for code intelligence",    category: "Advanced"         },
  { key: "todowrite",          title: "Todo list",       description: "Manage task list",                 category: "Advanced"         },
  { key: "question",           title: "Ask questions",   description: "Prompt user for input",            category: "Advanced"         },
  { key: "plan_enter",         title: "Enter planning",  description: "Switch to plan mode",              category: "Advanced"         },
  { key: "plan_exit",          title: "Exit planning",   description: "Leave plan mode",                  category: "Advanced"         },
  { key: "doom_loop",          title: "Loop detection",  description: "Detect repeated actions",          category: "Advanced"         },
]

const NAMED_COLORS = ["primary", "secondary", "accent", "success", "warning", "error", "info"] as const

// Returns first path on disk where the agent .md file exists, or undefined
async function findAgentFile(name: string, worktree?: string): Promise<string | undefined> {
  const fs = await import("fs/promises")
  const cwd = worktree || process.cwd()
  const filename = `${name}.md`
  const candidates = [
    path.join(cwd, ".opencode", "agents", filename),
    path.join(cwd, ".opencode", "agent",  filename),
    path.join(cwd, "agents",              filename),
    path.join(cwd, "agent",               filename),
    path.join(Global.Path.config, "agents", filename),
    path.join(Global.Path.config, "agent",  filename),
  ]
  for (const p of candidates) {
    try {
      await fs.access(p)
      return p
    } catch {
      // try next
    }
  }
  return undefined
}

function buildPermissionBlock(permissions: Record<string, "allow" | "deny" | "ask">): string {
  const lines = Object.entries(permissions).map(([k, v]) => `  ${k}: ${v}`).join("\n")
  return lines ? `permission:\n${lines}` : "permission: {}"
}

// Shared permission-toggle select — used by both create and edit flows
function PermissionSelect(props: {
  title: string
  initial: Record<string, "allow" | "deny" | "ask">
  onDone: (permissions: Record<string, "allow" | "deny" | "ask">) => void
}) {
  const [permissions, setPermissions] = createStore<Record<string, "allow" | "deny" | "ask">>({ ...props.initial })

  const proceed = () => props.onDone({ ...permissions })

  const options = createMemo(() => [
    ...PERMISSION_LIST.map((perm) => {
      const cur = permissions[perm.key]
      const status = cur === "allow" ? "✓ Allow" : cur === "deny" ? "✗ Deny" : cur === "ask" ? "? Ask" : "○ Not set"
      return {
        value: perm.key,
        title: `${perm.title} - ${status}`,
        description: perm.description,
        category: perm.category,
        onSelect: () => {
          const next: "allow" | "deny" | "ask" = cur === "allow" ? "deny" : cur === "deny" ? "ask" : "allow"
          setPermissions(perm.key, next)
        },
      }
    }),
    {
      value: "continue",
      title: "→ Continue",
      description: "Proceed with selected permissions",
      category: "Actions",
      onSelect: proceed,
    },
  ])

  return (
    <DialogSelect
      title={props.title}
      options={options()}
      keybind={[{ keybind: Keybind.parse("enter")[0], title: "Toggle", onTrigger: () => {} }]}
    />
  )
}

// ─── Create flow ──────────────────────────────────────────────────────────────

export function DialogAgentCreate() {
  const dialog = useDialog()

  const options: DialogSelectOption<string>[] = [
    {
      value: "manual",
      title: "Manual",
      description: "Write agent instructions directly",
      onSelect: () => dialog.replace(() => <DialogAgentManual />),
    },
    {
      value: "file",
      title: "From file",
      description: "Load instructions from a text file",
      onSelect: () => dialog.replace(() => <DialogAgentFromFile />),
    },
    {
      value: "generate",
      title: "Generate with OpenCode",
      description: "AI generates instructions from your description",
      onSelect: () => dialog.replace(() => <DialogAgentGenerate />),
    },
  ]

  return <DialogSelect title="Create agent" options={options} onSelect={() => {}} />
}

function DialogAgentManual() {
  const dialog = useDialog()
  const renderer = useRenderer()

  if (process.env["VISUAL"] || process.env["EDITOR"]) {
    ;(async () => {
      const edited = await Editor.open({ value: "", renderer })
      if (!edited?.trim()) {
        await DialogAlert.show(dialog, "Error", "Instructions cannot be empty")
        dialog.replace(() => <DialogAgentManual />)
        return
      }
      dialog.replace(() => <DialogAgentReview instructions={edited} />)
    })()
    return <DialogSelect title="Opening editor..." options={[]} onSelect={() => {}} />
  }

  return (
    <DialogPrompt
      title="Enter agent instructions"
      placeholder="You are an expert code reviewer..."
      onConfirm={(instructions) => {
        if (!instructions.trim()) {
          dialog.replace(() => (
            <DialogAlert title="Error" message="Instructions cannot be empty" onConfirm={() => dialog.replace(() => <DialogAgentManual />)} />
          ))
          return
        }
        dialog.replace(() => <DialogAgentReview instructions={instructions} />)
      }}
    />
  )
}

function DialogAgentFromFile() {
  const dialog = useDialog()
  return (
    <DialogPrompt
      title="Enter file path"
      placeholder="/path/to/agent-instructions.txt"
      onConfirm={async (filepath) => {
        if (!filepath.trim()) {
          dialog.replace(() => (
            <DialogAlert title="Error" message="File path cannot be empty" onConfirm={() => dialog.replace(() => <DialogAgentFromFile />)} />
          ))
          return
        }
        try {
          const fs = await import("fs/promises")
          const content = await fs.readFile(filepath, "utf-8")
          dialog.replace(() => <DialogAgentReview instructions={content} />)
        } catch (error) {
          dialog.replace(() => (
            <DialogAlert
              title="Error"
              message={`Could not read file: ${error instanceof Error ? error.message : String(error)}`}
              onConfirm={() => dialog.replace(() => <DialogAgentFromFile />)}
            />
          ))
        }
      }}
    />
  )
}

function DialogAgentGenerate() {
  const dialog = useDialog()
  const sync = useSync()
  const local = useLocal()

  const options = createMemo(() =>
    pipe(
      sync.data.provider,
      sortBy(
        (p) => p.id !== "opencode",
        (p) => p.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description: provider.name,
            category: provider.name,
            onSelect() {
              dialog.replace(() => <DialogAgentDescribe model={{ providerID: provider.id as ProviderID, modelID: model as ModelID }} />)
            },
          })),
        ),
      ),
    ),
  )

  return <DialogSelect title="Select model for generation" options={options()} current={local.model.current()} />
}

function DialogAgentDescribe(props: { model: { providerID: ProviderID; modelID: ModelID } }) {
  const dialog = useDialog()
  const sync = useSync()
  const [generating, setGenerating] = createSignal(false)

  return (
    <DialogPrompt
      title={generating() ? "Generating..." : "Describe what the agent should do"}
      placeholder="Review code for best practices and security issues"
      onConfirm={async (description) => {
        if (!description.trim()) {
          dialog.replace(() => (
            <DialogAlert title="Error" message="Description cannot be empty" onConfirm={() => dialog.replace(() => <DialogAgentDescribe model={props.model} />)} />
          ))
          return
        }
        setGenerating(true)
        try {
          const result = await Instance.provide({
            directory: sync.data.path.worktree || process.cwd(),
            fn: async () => Agent.generate({ description, model: props.model }),
          })
          dialog.replace(() => <DialogAgentReview instructions={result.systemPrompt} />)
        } catch (error) {
          dialog.replace(() => (
            <DialogAlert
              title="Generation failed"
              message={error instanceof Error ? error.message : "Failed to generate agent"}
              onConfirm={() => dialog.replace(() => <DialogAgentDescribe model={props.model} />)}
            />
          ))
        }
      }}
    />
  )
}

function DialogAgentReview(props: { instructions: string }) {
  const dialog = useDialog()

  const options: DialogSelectOption<"global" | "project">[] = [
    {
      value: "global",
      title: "Global",
      description: "Available across all projects",
      onSelect: () => dialog.replace(() => <DialogAgentPermissions instructions={props.instructions} location="global" />),
    },
    {
      value: "project",
      title: "Project",
      description: "Available only in current project",
      onSelect: () => dialog.replace(() => <DialogAgentPermissions instructions={props.instructions} location="project" />),
    },
  ]

  return <DialogSelect title="Save agent to" options={options} onSelect={() => {}} />
}

function DialogAgentPermissions(props: { instructions: string; location: "global" | "project" }) {
  const dialog = useDialog()
  const defaults: Record<string, "allow" | "deny" | "ask"> = { read: "allow", edit: "allow", bash: "allow", webfetch: "allow", grep: "allow" }

  return (
    <PermissionSelect
      title="Configure permissions"
      initial={defaults}
      onDone={(perms) => dialog.replace(() => <DialogAgentName instructions={props.instructions} location={props.location} permissions={perms} />)}
    />
  )
}

function DialogAgentName(props: {
  instructions: string
  location: "global" | "project"
  permissions: Record<string, "allow" | "deny" | "ask">
}) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  return (
    <DialogPrompt
      title="Agent name"
      placeholder="code-reviewer"
      onConfirm={async (name) => {
        if (!name.trim()) {
          await DialogAlert.show(dialog, "Error", "Agent name is required")
          return
        }
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-")
        if (!/[a-z0-9]/.test(slug)) {
          await DialogAlert.show(dialog, "Error", "Agent name must contain at least one letter or number")
          return
        }
        const file = slug + ".md"
        const base =
          props.location === "global"
            ? path.join(Global.Path.config, "agents")
            : path.join(sync.data.path.worktree || process.cwd(), ".opencode", "agents")
        const fm = ["---", `description: ${name}`, `mode: all`, buildPermissionBlock(props.permissions), "---"].join("\n")
        try {
          const fs = await import("fs/promises")
          await fs.mkdir(base, { recursive: true })
          await fs.writeFile(path.join(base, file), `${fm}\n${props.instructions}`, "utf-8")
          await sdk.client.instance.dispose()
          toast.show({ message: `Agent "${name}" created`, variant: "success" })
          dialog.clear()
        } catch (error) {
          await DialogAlert.show(dialog, "Save failed", error instanceof Error ? error.message : "Failed to save agent")
        }
      }}
    />
  )
}

// ─── Delete flow ──────────────────────────────────────────────────────────────

export function DialogAgentDelete() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  const options = createMemo(() =>
    sync.data.agent
      .filter((agent) => !agent.native)
      .map((agent) => ({
        value: agent.name,
        title: agent.name,
        description: "custom",
        onSelect: async () => {
          const confirmed = await DialogConfirm.show(dialog, `Delete ${agent.name}?`, "This will permanently remove the agent file.")
          if (!confirmed) return
          const found = await findAgentFile(agent.name, sync.data.path.worktree)
          if (found) {
            const fs = await import("fs/promises")
            await fs.unlink(found)
            await sdk.client.instance.dispose()
            toast.show({ message: `Agent "${agent.name}" deleted`, variant: "success" })
            dialog.clear()
          } else {
            await DialogAlert.show(dialog, "Could not delete", "Agent file not found. It may be defined in opencode.json — remove it manually.")
            dialog.clear()
          }
        },
      })),
  )

  return <DialogSelect title="Delete agent" options={options()} onSelect={() => {}} />
}

// ─── Edit flow ────────────────────────────────────────────────────────────────

export function DialogAgentEdit() {
  const dialog = useDialog()
  const sync = useSync()

  const options = createMemo(() =>
    sync.data.agent
      .filter((agent) => !agent.native)
      .map((agent) => ({
        value: agent.name,
        title: agent.name,
        description: "custom",
        onSelect: () => dialog.replace(() => <DialogAgentEditMenu name={agent.name} />),
      })),
  )

  return <DialogSelect title="Edit agent — select agent" options={options()} onSelect={() => {}} />
}

function DialogAgentEditMenu(props: { name: string }) {
  const dialog = useDialog()

  const options: DialogSelectOption<string>[] = [
    {
      value: "permissions",
      title: "Permissions",
      description: "Configure tool access",
      onSelect: () => dialog.replace(() => <DialogAgentEditPermissions name={props.name} />),
    },
    {
      value: "rename",
      title: "Rename",
      description: "Change the agent name",
      onSelect: () => dialog.replace(() => <DialogAgentEditRename name={props.name} />),
    },
    {
      value: "color",
      title: "Color",
      description: "Set the agent accent color",
      onSelect: () => dialog.replace(() => <DialogAgentEditColor name={props.name} />),
    },
    {
      value: "instructions",
      title: "Instructions",
      description: "Edit the system prompt in $EDITOR",
      onSelect: () => dialog.replace(() => <DialogAgentEditInstructions name={props.name} />),
    },
  ]

  return <DialogSelect title={`Edit "${props.name}"`} options={options} onSelect={() => {}} />
}

// Edit — Permissions

function DialogAgentEditPermissions(props: { name: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  ;(async () => {
    const found = await findAgentFile(props.name, sync.data.path.worktree)
    if (!found) {
      await DialogAlert.show(dialog, "Not found", "Could not locate the agent file.")
      dialog.replace(() => <DialogAgentEdit />)
      return
    }
    try {
      const fs = await import("fs/promises")
      const parsed = matter(await fs.readFile(found, "utf-8"))
      const perms: Record<string, "allow" | "deny" | "ask"> = {}
      for (const [k, v] of Object.entries(parsed.data?.permission ?? {})) {
        if (v === "allow" || v === "deny" || v === "ask") perms[k] = v
      }
      dialog.replace(() => (
        <PermissionSelect
          title={`Permissions for "${props.name}"`}
          initial={perms}
          onDone={async (permissions) => {
            try {
              const latest = matter(await fs.readFile(found, "utf-8"))
              latest.data.permission = permissions
              await fs.writeFile(found, matter.stringify(latest.content, latest.data), "utf-8")
              await sdk.client.instance.dispose()
              toast.show({ message: `Permissions updated for "${props.name}"`, variant: "success" })
              dialog.clear()
            } catch (err) {
              await DialogAlert.show(dialog, "Save failed", err instanceof Error ? err.message : "Failed to save")
            }
          }}
        />
      ))
    } catch (err) {
      await DialogAlert.show(dialog, "Error", err instanceof Error ? err.message : "Could not read agent file")
      dialog.replace(() => <DialogAgentEditMenu name={props.name} />)
    }
  })()

  return <DialogSelect title="Loading..." options={[]} onSelect={() => {}} />
}

// Edit — Rename

function DialogAgentEditRename(props: { name: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  return (
    <DialogPrompt
      title={`Rename "${props.name}"`}
      placeholder={props.name}
      onConfirm={async (raw) => {
        const name = raw.trim()
        if (!name) {
          await DialogAlert.show(dialog, "Error", "Name cannot be empty")
          return
        }
        const found = await findAgentFile(props.name, sync.data.path.worktree)
        if (!found) {
          await DialogAlert.show(dialog, "Not found", "Could not locate the agent file.")
          return
        }
        const dest = path.join(path.dirname(found), name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + ".md")
        try {
          const fs = await import("fs/promises")
          const parsed = matter(await fs.readFile(found, "utf-8"))
          parsed.data.description = name
          await fs.writeFile(found, matter.stringify(parsed.content, parsed.data), "utf-8")
          await fs.rename(found, dest)
          await sdk.client.instance.dispose()
          toast.show({ message: `Agent renamed to "${name}"`, variant: "success" })
          dialog.clear()
        } catch (error) {
          await DialogAlert.show(dialog, "Rename failed", error instanceof Error ? error.message : "Failed to rename")
        }
      }}
    />
  )
}

// Edit — Color

function DialogAgentEditColor(props: { name: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const applyColor = async (color: string | undefined) => {
    const found = await findAgentFile(props.name, sync.data.path.worktree)
    if (!found) {
      await DialogAlert.show(dialog, "Not found", "Could not locate the agent file.")
      return
    }
    try {
      const fs = await import("fs/promises")
      const parsed = matter(await fs.readFile(found, "utf-8"))
      if (color) {
        parsed.data.color = color
      } else {
        delete parsed.data.color
      }
      await fs.writeFile(found, matter.stringify(parsed.content, parsed.data), "utf-8")
      await sdk.client.instance.dispose()
      toast.show({ message: color ? `Color set to "${color}"` : "Color removed", variant: "success" })
      dialog.clear()
    } catch (error) {
      await DialogAlert.show(dialog, "Save failed", error instanceof Error ? error.message : "Failed to save")
    }
  }

  const options = [
    ...NAMED_COLORS.map((c) => ({
      value: c,
      title: c,
      description: "Theme color",
      gutter: <text fg={theme[c]}>●</text>,
      onSelect: () => applyColor(c),
    })),
    {
      value: "hex",
      title: "Custom hex...",
      description: "Enter a #RRGGBB value",
      onSelect: () => dialog.replace(() => <DialogAgentEditColorHex name={props.name} applyColor={applyColor} />),
    },
    {
      value: "none",
      title: "None (remove color)",
      description: "Use the default rotating palette",
      onSelect: () => applyColor(undefined),
    },
  ]

  return <DialogSelect title={`Color for "${props.name}"`} options={options} onSelect={() => {}} />
}

function DialogAgentEditColorHex(props: { name: string; applyColor: (color: string | undefined) => Promise<void> }) {
  const dialog = useDialog()

  return (
    <DialogPrompt
      title="Enter hex color"
      placeholder="#fab283"
      onConfirm={async (raw) => {
        const hex = raw.trim()
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
          await DialogAlert.show(dialog, "Invalid color", "Must be a 6-digit hex color, e.g. #fab283")
          dialog.replace(() => <DialogAgentEditColorHex name={props.name} applyColor={props.applyColor} />)
          return
        }
        await props.applyColor(hex)
      }}
    />
  )
}

// Edit — Instructions

function DialogAgentEditInstructions(props: { name: string }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const renderer = useRenderer()

  ;(async () => {
    const found = await findAgentFile(props.name, sync.data.path.worktree)
    if (!found) {
      await DialogAlert.show(dialog, "Not found", "Could not locate the agent file.")
      dialog.replace(() => <DialogAgentEdit />)
      return
    }
    if (!process.env["VISUAL"] && !process.env["EDITOR"]) {
      await DialogAlert.show(dialog, "No editor set", "Set the $EDITOR or $VISUAL environment variable to use this feature.")
      dialog.replace(() => <DialogAgentEditMenu name={props.name} />)
      return
    }
    try {
      const fs = await import("fs/promises")
      const parsed = matter(await fs.readFile(found, "utf-8"))
      const current = parsed.content.trimStart()
      const edited = await Editor.open({ value: current, renderer })
      if (edited === undefined || edited.trim() === current.trim()) {
        dialog.replace(() => <DialogAgentEditMenu name={props.name} />)
        return
      }
      // Re-read to preserve any frontmatter changes since we opened the editor
      const latest = matter(await fs.readFile(found, "utf-8"))
      await fs.writeFile(found, matter.stringify("\n" + edited.trimStart(), latest.data), "utf-8")
      await sdk.client.instance.dispose()
      toast.show({ message: `Instructions updated for "${props.name}"`, variant: "success" })
      dialog.clear()
    } catch (error) {
      await DialogAlert.show(dialog, "Edit failed", error instanceof Error ? error.message : "Failed to edit instructions")
      dialog.replace(() => <DialogAgentEditMenu name={props.name} />)
    }
  })()

  return <DialogSelect title="Opening editor..." options={[]} onSelect={() => {}} />
}
