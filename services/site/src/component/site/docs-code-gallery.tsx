import { createSignal, For, Show, type JSX } from "solid-js"
import { CodeCollapse, CodeFrame, CodeLines, CopyButton } from "./code-frame"
import { FileTree, FileTypeIcon } from "./file-type-icon"
import { docsInstalls } from "~/lib/docs-content"

/**
 * Every docs code block type at once, in Vercel square (the chosen code style), whatever the
 * kitchen sink's switchers say: docs-variants.css styles [data-slot="code-gallery"] as option 6.
 * Content is from the docs (src/docs/content), with models reading Claude Opus 5.5.
 */
export function DocsCodeGallery(props: { reference?: boolean }) {
  return (
    <div data-slot="code-gallery">
      <Item name="Plain code" when="A snippet that isn't a file and isn't run, like a type or a short example.">
        <CodeFrame variant="code" kind="code" label="TypeScript" copy={permissionType}>
          <pre>
            <code>{permissionType}</code>
          </pre>
        </CodeFrame>
      </Item>

      <Item name="File name header" when="Tells the reader which file the code goes in.">
        <CodeFrame variant="codeTitle" kind="file" label="opencode.jsonc" copy={configFile}>
          <pre>
            <code>{configFile}</code>
          </pre>
        </CodeFrame>
      </Item>

      <Show when={!props.reference}>
        <Item
          name="File icon options"
          when="The desktop app's file-type icons, in colour or in the label grey. ★ Colour is recommended."
        >
          <div data-slot="gallery-options">
            <For
              each={
                [
                  ["color", "★ Colour (the desktop app's icons)"],
                  ["mono", "Monochrome (currentColor)"],
                ] as const
              }
            >
              {([mode, name]) => (
                <div data-file-icons={mode}>
                  <p data-slot="option-name">{name}</p>
                  <Tabs files label="Files" items={files} />
                  <CodeFrame variant="fileTree" kind="tree" label="Files">
                    <FileTree tree={tree} />
                  </CodeFrame>
                </div>
              )}
            </For>
          </div>
        </Item>
      </Show>

      <Item name="Multi-file tabs" when="One change across several files, one tab per file.">
        <Tabs files label="Files" items={files} />
      </Item>

      <Item name="Package-manager tabs" when="The same install command in npm, bun, pnpm and yarn.">
        <Tabs
          label="Package manager"
          items={docsInstalls
            .filter((item) => ["npm", "bun", "pnpm", "yarn"].includes(item.label))
            .map((item) => ({ label: item.label, code: item.code, shell: true }))}
        />
      </Item>

      <Item name="Terminal command" when="Something to paste into a shell; Copy drops the $ prompt.">
        <Terminal lines={['$ opencode run "Explain this repository"']} />
      </Item>

      <Show when={!props.reference}>
        <Item
          name="Terminal icon options"
          when="The mark in a terminal's header, 16px at a 1.5 stroke like the file mark. ★ Window is recommended."
        >
          <div data-slot="gallery-options">
            <For
              each={
                [
                  ["window", "★ Window (a square with a prompt)"],
                  ["prompt", "Prompt (the chevron and cursor alone)"],
                  ["titlebar", "Window with a title bar"],
                ] as const
              }
            >
              {([icon, name]) => (
                <div>
                  <p data-slot="option-name">{name}</p>
                  <CodeFrame variant="terminal" kind="terminal" label="Terminal" icon={icon} copy="$ opencode">
                    <pre data-component="code-block">
                      <code>
                        <span data-token="prompt">$ </span>
                        <span data-token="command">opencode</span>
                      </code>
                    </pre>
                  </CodeFrame>
                </div>
              )}
            </For>
          </div>
        </Item>
      </Show>

      <Item name="Command with output" when="What the reader should see after a command, so they can check it worked.">
        <Terminal
          lines={[
            "$ opencode pair",
            "",
            "  Open a link to connect. Links work once and expire in 5 minutes.",
            "",
            "  http://127.0.0.1:49374/auth/connect/...",
          ]}
          copy="opencode pair"
        />
      </Item>

      <Item name="Long multi-command script" when="A setup run top to bottom, one command per line.">
        <Terminal
          lines={[
            "$ curl -fsSL https://opencode.ai/v2/install | bash",
            "$ cd my-app",
            "$ opencode auth login",
            '$ opencode run --model opencode/claude-opus-5-5 "Add a health check route"',
            "$ opencode service restart",
          ]}
        />
      </Item>

      <Item name="Line numbers" when="Only when the text refers to lines by number.">
        <CodeFrame variant="codeLines" kind="file" label=".opencode/tools/count-lines.ts" copy={countLines.join("\n")}>
          <CodeLines lines={countLines} />
        </CodeFrame>
      </Item>

      <Item name="Highlighted lines" when="Points at the lines that matter in a longer example.">
        <CodeFrame variant="codeLines" kind="file" label=".opencode/tools/count-lines.ts" copy={countLines.join("\n")}>
          <CodeLines lines={countLines} mark={[4, 5]} plain />
        </CodeFrame>
      </Item>

      <Item name="Diff" when="Shows a change, like a renamed key, a migration or a fix.">
        <CodeFrame variant="codeDiff" kind="file" label="opencode.jsonc" copy={diffAfter}>
          <pre data-component="code-diff">
            <For each={diff}>
              {([sign, line]) => (
                <code data-diff={sign}>
                  <span data-slot="sign">{sign}</span>
                  {line}
                  {"\n"}
                </code>
              )}
            </For>
          </pre>
        </CodeFrame>
      </Item>

      <Item name="Focus and collapse" when="A long example where only part matters; the rest folds away.">
        <CodeFrame
          variant="codeLines"
          kind="file"
          label="opencode.jsonc"
          copy={[...focusLines, ...hiddenLines].join("\n")}
        >
          <CodeCollapse
            count={hiddenLines.length}
            visible={<CodeLines lines={focusLines} focus={[3, 4, 5, 6, 7]} plain />}
            hidden={<CodeLines lines={hiddenLines} start={focusLines.length + 1} plain />}
          />
        </CodeFrame>
      </Item>

      <Show when={!props.reference}>
        <Item
          name="Collapse options"
          when="Three ways to fold lines away. ★ The gutter marker is the default; the other two are old."
        >
          <div data-slot="gallery-options" data-stack="">
            <For
              each={
                [
                  ["marker", "★ Gutter marker, in place (GitHub, Expressive Code)"],
                  ["fade", "Old · fade with a centred button (Vercel, Mintlify)"],
                  ["bar", "Old · full-width bar"],
                ] as const
              }
            >
              {([style, name]) => (
                <div>
                  <p data-slot="option-name">{name}</p>
                  <CodeFrame
                    variant="codeLines"
                    kind="file"
                    label="opencode.jsonc"
                    copy={[...focusLines, ...hiddenLines].join("\n")}
                  >
                    <CodeCollapse
                      style={style}
                      count={hiddenLines.length}
                      visible={<CodeLines lines={focusLines} plain />}
                      hidden={<CodeLines lines={hiddenLines} start={focusLines.length + 1} plain />}
                    />
                  </CodeFrame>
                </div>
              )}
            </For>
          </div>
        </Item>
      </Show>

      <Item name="Long lines" when="Wider than the column, so the block scrolls sideways; code never wraps.">
        <Terminal
          lines={[
            '$ opencode run --standalone --model opencode/claude-opus-5-5 "Review this repository for correctness and summarize any issues with file and line references"',
          ]}
        />
      </Item>

      <Item name="Config (opencode.jsonc)" when="Config is JSON with comments; $schema gives editor completion.">
        <CodeFrame variant="codeTitle" kind="file" label="opencode.jsonc" copy={permissionsFile}>
          <pre>
            <code>{permissionsFile}</code>
          </pre>
        </CodeFrame>
      </Item>

      <Item name="YAML" when="Agent frontmatter and CI workflows.">
        <CodeFrame variant="codeTitle" kind="file" label=".github/workflows/opencode.yml" copy={workflow}>
          <pre>
            <code>{workflow}</code>
          </pre>
        </CodeFrame>
      </Item>

      <Item name=".env file" when="Secrets and switches set outside the config, loaded by your shell or CI.">
        <CodeFrame variant="codeTitle" kind="file" label=".env" copy={env}>
          <pre>
            <code>{env}</code>
          </pre>
        </CodeFrame>
      </Item>

      <Item name="File tree" when="Shows where files go.">
        <CodeFrame variant="fileTree" kind="tree" label="Files">
          <FileTree tree={tree} />
        </CodeFrame>
      </Item>

      <Item name="CLI reference" when="Each command, its flags and an example.">
        <CodeFrame variant="cli" kind="usage" label="Usage" copy="opencode run [message..]">
          <pre>
            <code>opencode run [message..]</code>
          </pre>
        </CodeFrame>
        <Table
          head={["Flag", "Short", "Description"]}
          kinds={["code", "code", "text"]}
          rows={[
            ["--model", "-m", "Model to use, as provider/model"],
            ["--continue", "-c", "Continue the last session"],
            ["--file", "-f", "Attach a file to the message"],
            ["--standalone", "", "Run a private server for this command"],
          ]}
        />
      </Item>

      <Item name="Config reference table" when="Every option with its type, default and meaning.">
        <CodeFrame variant="config" kind="config" label="opencode.jsonc options">
          <Table
            head={["Option", "Type", "Default", "Description"]}
            kinds={["code", "type", "code", "text"]}
            rows={[
              ["model", "string", "", "The default model, as provider/model"],
              ["instructions", "string[]", "[]", "Extra instruction files, as paths or globs"],
              ["compaction.auto", "boolean", "true", "Summarize near the context limit"],
              ["permissions", "Rule[]", "[]", "Ordered allow, deny and ask rules"],
            ]}
          />
        </CodeFrame>
      </Item>

      <Item name="API request and response" when="An endpoint, its parameters, a request and what comes back.">
        <ApiExample />
      </Item>

      <Item name="Code inside a callout" when="A tip or warning that carries a command.">
        <aside data-component="callout" data-type="tip" aria-label="Tip">
          <strong>Tip</strong>
          <div>
            <p>Skip project instructions for one run.</p>
            <Terminal lines={["$ OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode"]} />
          </div>
        </aside>
      </Item>

      <Item name="Code inside steps" when="Setup steps where each step runs or adds something.">
        <ol data-slot="gallery-steps">
          <li>
            <p>
              <strong>Create the plugin.</strong> Add <code>.opencode/plugins/notify.ts</code>.
            </p>
            <CodeFrame variant="codeTitle" kind="file" label=".opencode/plugins/notify.ts" copy={notifyPlugin}>
              <pre>
                <code>{notifyPlugin}</code>
              </pre>
            </CodeFrame>
          </li>
          <li>
            <p>
              <strong>Restart OpenCode.</strong> Plugins load on start.
            </p>
            <Terminal lines={["$ opencode service restart"]} />
          </li>
        </ol>
      </Item>

      <Item name="Inline code" when="Names in running text: files, keys, commands.">
        <p>
          Set <code>model</code> to <code>opencode/claude-opus-5-5</code> in <code>opencode.jsonc</code>, then run{" "}
          <code>opencode run "fix the tests"</code>.
        </p>
      </Item>
    </div>
  )
}

function Item(props: { name: string; when: string; children: JSX.Element }) {
  return (
    <figure data-slot="gallery-item">
      <figcaption>
        <b>{props.name}</b> · {props.when}
      </figcaption>
      {props.children}
    </figure>
  )
}

// A shell block: "$ " lines are commands (coloured, copied without the prompt), the rest output.
function Terminal(props: { lines: string[]; copy?: string; label?: string }) {
  const commands = () => props.lines.filter((line) => line.startsWith("$ ")).join("\n")
  return (
    <CodeFrame variant="terminal" kind="terminal" label={props.label ?? "Terminal"} copy={props.copy ?? commands()}>
      <pre data-component="code-block">
        <code>
          <For each={props.lines}>
            {(line, index) => (
              <>
                <Show when={line.startsWith("$ ")} fallback={<span data-token="output">{line}</span>}>
                  <span data-token="prompt">$ </span>
                  <Shell command={line.slice(2)} />
                </Show>
                {index() < props.lines.length - 1 ? "\n" : ""}
              </>
            )}
          </For>
        </code>
      </pre>
    </CodeFrame>
  )
}

// A rough shell highlighter: the first word, flags, quoted strings, URLs, pipes and assignments.
function Shell(props: { command: string }) {
  const parts = () => props.command.match(/"[^"]*"|'[^']*'|\s+|[^\s]+/g) ?? []
  const first = () => parts().findIndex((part) => part.trim() && !/^[A-Z_]+=/.test(part))
  const token = (part: string, index: number) => {
    if (!part.trim()) return undefined
    if (index === first()) return "command"
    if (/^[A-Z_]+=/.test(part) || part.startsWith("-")) return "flag"
    if (/^["']/.test(part) || /^https?:/.test(part)) return "string"
    if (part === "|" || part === "&&") return "operator"
    return undefined
  }
  return (
    <For each={parts()}>
      {(part, index) => (
        <Show when={token(part, index())} fallback={part}>
          {(kind) => <span data-token={kind()}>{part}</span>}
        </Show>
      )}
    </For>
  )
}

// A reference table: "code" cells are mono names in ink, "type" cells muted mono, the rest text.
function Table(props: { head: string[]; kinds: ("code" | "type" | "text")[]; rows: string[][] }) {
  return (
    <div data-slot="gallery-table">
      <table>
        <thead>
          <tr>
            <For each={props.head}>{(cell) => <th>{cell}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <For each={row}>
                  {(cell, index) => (
                    <td>
                      <Show when={cell && props.kinds[index()] !== "text" && props.kinds[index()]} fallback={cell}>
                        {(kind) => (kind() === "code" ? <code>{cell}</code> : <span data-slot="ref-type">{cell}</span>)}
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

/**
 * The API reference's endpoint card (option 7, the default): the method and path in the header, the
 * description, the parameters as a definition table, then a request and the responses by status,
 * all on the code surface. Shared by the gallery and the kitchen sink's API sample.
 */
export function ApiExample() {
  const [status, setStatus] = createSignal(0)
  const responses = [
    { label: "200 OK", body: response },
    { label: "404 Not found", body: notFound },
  ]
  return (
    <div data-component="api-operation">
      <p data-slot="api-head">
        <span data-component="badge" data-method="get">
          GET
        </span>{" "}
        <code>/session/{"{sessionID}"}/message</code>
      </p>
      <div data-slot="api-body">
        <p>List the messages in a session, oldest first.</p>
        <div data-slot="api-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>In</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <For each={apiParameters}>
                {(row) => (
                  <tr>
                    <td>
                      <code>{row.name}</code>
                    </td>
                    <td>{row.in}</td>
                    <td>
                      <span data-slot="ref-type">{row.type}</span>
                    </td>
                    <td>
                      <span data-slot="ref-required" data-required={row.required ? "" : undefined}>
                        {row.required ? "Required" : "Optional"}
                      </span>
                    </td>
                    <td>{row.description}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <Terminal lines={["$ curl http://127.0.0.1:4096/session/ses_01JC4X/message?limit=1"]} label="Request" />
        <div data-component="code-tabs" data-status="">
          <div data-slot="tabs" role="tablist" aria-label="Response status">
            <For each={responses}>
              {(item, index) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={status() === index() ? "true" : "false"}
                  tabIndex={status() === index() ? 0 : -1}
                  onClick={() => setStatus(index())}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
          <div data-slot="code" role="tabpanel">
            <code>{responses[status()].body}</code>
            <CopyButton slot="copy" text={responses[status()].body} />
          </div>
        </div>
      </div>
    </div>
  )
}

const apiParameters = [
  { name: "sessionID", in: "path", type: "string", required: true, description: "The session to read." },
  { name: "limit", in: "query", type: "number", required: false, description: "How many messages to return." },
]

const notFound = `{
  "error": "session_not_found",
  "message": "No session with ID ses_01JC4X."
}`

// Tabs in the block's header (package managers or files), with a working Copy for the open tab.
function Tabs(props: { label: string; files?: boolean; items: { label: string; code: string; shell?: boolean }[] }) {
  const [open, setOpen] = createSignal(0)
  const keyDown = (event: KeyboardEvent, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
    event.preventDefault()
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + props.items.length) % props.items.length
    setOpen(next)
    const tab = (event.currentTarget as HTMLElement).parentElement?.children[next]
    if (tab instanceof HTMLElement) tab.focus()
  }
  return (
    <div data-component="code-tabs" data-files={props.files ? "" : undefined}>
      <div data-slot="tabs" role="tablist" aria-label={props.label}>
        <For each={props.items}>
          {(item, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={open() === index() ? "true" : "false"}
              tabIndex={open() === index() ? 0 : -1}
              onClick={() => setOpen(index())}
              onKeyDown={(event) => keyDown(event, index())}
            >
              <Show when={props.files}>
                <FileTypeIcon path={item.label} />
              </Show>
              {item.label}
            </button>
          )}
        </For>
      </div>
      <div data-slot="code" role="tabpanel">
        <code>
          <Show when={props.items[open()].shell} fallback={props.items[open()].code}>
            <Shell command={props.items[open()].code} />
          </Show>
        </code>
        <CopyButton slot="copy" text={props.items[open()].code} />
      </div>
    </div>
  )
}

const permissionType = `type Permission = {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}`

const configFile = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/claude-opus-5-5",
  "instructions": ["AGENTS.md"]
}`

const files = [
  { label: "opencode.jsonc", code: configFile },
  {
    label: "AGENTS.md",
    code: `# Project instructions

- Run \`bun typecheck\` after changing TypeScript.
- Keep database queries in \`src/database\`.`,
  },
  {
    label: ".opencode/agents/reviewer.md",
    code: `---
description: Reviews changes for correctness and regressions
mode: subagent
model: opencode/claude-opus-5-5
---

Review the current changes. List findings in severity order.`,
  },
]

const countLines = [
  'import { tool } from "@opencode-ai/plugin"',
  "",
  "export default tool({",
  '  description: "Count lines in a file",',
  "  args: { path: tool.schema.string() },",
  "  async execute(args) {",
  "    const text = await Bun.file(args.path).text()",
  '    return String(text.split("\\n").length)',
  "  },",
  "})",
]

const diff = [
  [" ", "{"],
  [" ", '  "model": "opencode/claude-opus-5-5",'],
  ["+", '  "instructions": ["AGENTS.md"],'],
  [" ", '  "permissions": ['],
  ["-", '    { "action": "shell", "resource": "git push *", "effect": "allow" },'],
  ["+", '    { "action": "shell", "resource": "git push *", "effect": "ask" },'],
  [" ", "  ],"],
  [" ", "}"],
]

const diffAfter = diff
  .filter((entry) => entry[0] !== "-")
  .map((entry) => entry[1])
  .join("\n")

const focusLines = [
  "{",
  '  "$schema": "https://opencode.ai/config.json",',
  '  "permissions": [',
  "    {",
  '      "action": "shell",',
  '      "resource": "git push *",',
  '      "effect": "ask",',
  "    },",
]

const hiddenLines = [
  "  ],",
  '  "experimental": {',
  '    "policies": [',
  '      { "action": "provider.use", "resource": "*", "effect": "deny" },',
  '      { "action": "provider.use", "resource": "opencode", "effect": "allow" },',
  "    ],",
  "  },",
  "}",
]

const permissionsFile = `{
  "$schema": "https://opencode.ai/config.json",
  // Ask before any git push; everything else follows the defaults.
  "permissions": [
    {
      "action": "shell",
      "resource": "git push *",
      "effect": "ask",
    },
  ],
}`

const workflow = `name: OpenCode review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install --global @opencode/cli
      - run: opencode run --standalone --model opencode/claude-opus-5-5 "Review this repository"`

const env = `# Loaded by your shell or CI, never committed
ANTHROPIC_API_KEY=sk-ant-...
OPENCODE_DISABLE_PROJECT_CONFIG=1`

const tree = `.opencode/
├── agents/
│   └── reviewer.md
├── commands/
│   └── release.md
├── plugins/
│   └── notify.ts
├── tools/
│   └── count-lines.ts
└── opencode.jsonc`

const response = `[
  {
    "id": "msg_01JC4Y",
    "role": "assistant",
    "model": "opencode/claude-opus-5-5",
    "parts": [{ "type": "text", "text": "The tests pass." }]
  }
]`

const notifyPlugin = `export const Notify = async () => ({
  "session.idle": async () => console.log("Done"),
})`
