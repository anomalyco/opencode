import { createSignal, For, type JSX } from "solid-js"
import { ogImage } from "~/lib/og"
import { CodeFrame, CopyButton } from "./code-frame"
import { ApiExample, DocsCodeGallery } from "./docs-code-gallery"
import { FileTree, FileTypeIcon } from "./file-type-icon"
import type { DocsVariantKey } from "./settings"

/**
 * Every docs component sample, grouped as the docs use them. Shared by the review page
 * (/dev/docs-components), which wraps each sample in its option switcher and status, and the docs
 * reference page (/dev/docs), which shows each one once in its locked option under a plain heading.
 * The pages pass in how a group (Section), a sample (Sample) and a review-only note (Note) render.
 */
export function DocsSamples(props: {
  Section: (props: { id: DocsSampleSection["id"]; children: JSX.Element }) => JSX.Element
  Sample: (props: { variant: DocsVariantKey; label?: string; children: JSX.Element }) => JSX.Element
  Note: (props: { children: JSX.Element }) => JSX.Element
  /** Extra content at the end of the Docs chrome group (the review page's version notice demo). */
  chrome?: JSX.Element
  /** Leaves the code gallery's comparisons of old options out. */
  reference?: boolean
}) {
  const [tab, setTab] = createSignal(0)
  const [plan, setPlan] = createSignal(0)
  const [file, setFile] = createSignal(0)
  return (
    <>
      <props.Section id="typography">
        <props.Sample variant="typography">
          <h1>Heading 1 · Configure OpenCode</h1>
          <h2>Heading 2 · Providers</h2>
          <h3>Heading 3 · Local models</h3>
          <h4>Heading 4 · Ollama</h4>
          <h5>Heading 5 · Context limits</h5>
          <h6>Heading 6 · Notes</h6>
          <p data-slot="lead">Lead · OpenCode is an open source coding agent for the terminal, desktop and web.</p>
          <p>
            Body · Run <code>opencode</code> in a project to open the terminal interface. See{" "}
            <a href="#config">Config</a> for every option, or read the{" "}
            <a href="https://github.com/anomalyco/opencode" target="_blank">
              source on GitHub
            </a>
            .
          </p>
          <p>
            <small>Small · Requires OpenCode 2.0 or later.</small> The <abbr title="Agent Client Protocol">ACP</abbr>{" "}
            server speaks JSON-RPC.
          </p>
        </props.Sample>
        <props.Sample variant="kbd">
          <p>
            Press <kbd>Ctrl</kbd> + <kbd>X</kbd> then <kbd>N</kbd> to start a new session, or <kbd>Esc</kbd> to stop the
            agent.
          </p>
        </props.Sample>
        <props.Sample variant="inlineCode">
          <p>
            Set <code>model</code> in <code>opencode.jsonc</code>, then run <code>opencode run "fix the tests"</code>.
          </p>
        </props.Sample>
      </props.Section>

      <props.Section id="lists">
        <props.Sample variant="lists">
          <ul>
            <li>Agents read your project's instructions first.</li>
            <li>
              Then they can use tools
              <ul>
                <li>
                  <code>read</code>, <code>edit</code> and <code>write</code>
                </li>
                <li>
                  <code>bash</code>, with permissions
                </li>
              </ul>
            </li>
            <li>Sessions are saved, so you can come back to them.</li>
          </ul>
          <ol>
            <li>Install OpenCode.</li>
            <li>
              Connect a provider with <code>/connect</code>.
            </li>
            <li>Ask for a change.</li>
          </ol>
          <ul data-slot="tasks">
            <li>
              <input type="checkbox" checked disabled /> Add <code>AGENTS.md</code>
            </li>
            <li>
              <input type="checkbox" disabled /> Configure MCP servers
            </li>
          </ul>
          <ul data-component="downloads">
            <li>
              <strong>macOS</strong> · <a href="#lists">Apple silicon</a> · <a href="#lists">Intel</a>
            </li>
            <li>
              <strong>Linux</strong> · <a href="#lists">x64</a> · <a href="#lists">ARM64</a>
            </li>
          </ul>
        </props.Sample>
      </props.Section>

      <props.Section id="blockquote">
        <props.Sample variant="blockquote">
          <blockquote>
            <p>
              Homebrew's own <code>brew install opencode</code> formula also installs OpenCode 2. Each release publishes
              first to the <code>anomalyco/tap/opencode-v2</code> formula.
            </p>
          </blockquote>
        </props.Sample>
      </props.Section>

      <props.Section id="callouts">
        <props.Sample variant="callout">
          <For
            each={
              [
                ["note", "Note", "Config files are merged, so a project config overrides only the keys it sets."],
                [
                  "tip",
                  "Tip",
                  <>
                    Run <code>opencode auth login</code> to store a provider key once for every project.
                  </>,
                ],
                ["caution", "Warning", "Plugins run with your permissions. Install only plugins you trust."],
                ["danger", "Danger", "This deletes every snapshot for the project and can't be undone."],
              ] as [string, string, JSX.Element][]
            }
          >
            {([type, title, body]) => (
              <aside data-component="callout" data-type={type} aria-label={title}>
                <strong>{title}</strong>
                <div>{body}</div>
              </aside>
            )}
          </For>
          <aside data-component="callout" data-type="tip" aria-label="Tip">
            <strong>Tip</strong>
            <div>
              <p>Skip project instructions for one run.</p>
              <CodeFrame
                variant="terminal"
                kind="terminal"
                label="Terminal"
                copy="$ OPENCODE_DISABLE_PROJECT_CONFIG=1 opencode"
              >
                <pre data-component="code-block">
                  <code>
                    <span data-token="prompt">$ </span>
                    <span data-token="flag">OPENCODE_DISABLE_PROJECT_CONFIG=1</span>{" "}
                    <span data-token="command">opencode</span>
                  </code>
                </pre>
              </CodeFrame>
            </div>
          </aside>
        </props.Sample>
        <props.Note>
          v2 uses note, tip and warning. v1 (Starlight) uses note, tip, caution and info. Danger is shown for
          completeness.
        </props.Note>
      </props.Section>

      <props.Section id="code-blocks">
        <props.Note>
          Vercel square is the docs code style. Each block below is a different type, in that style whatever the
          switchers further down say. Switch the page theme to see dark.
        </props.Note>
        <DocsCodeGallery reference={props.reference} />
      </props.Section>

      <props.Section id="tabs">
        <props.Sample variant="tabs">
          <div data-component="code-tabs">
            <div data-slot="tabs" role="tablist" aria-label="Install method">
              <For each={["curl", "npm", "brew"]}>
                {(label, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === index() ? "true" : "false"}
                    tabIndex={tab() === index() ? 0 : -1}
                    onClick={() => setTab(index())}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
            <div data-slot="code" role="tabpanel">
              <code>
                {
                  [
                    "curl -fsSL https://opencode.ai/v2/install | bash",
                    "npm install -g @opencode/cli",
                    "brew install anomalyco/tap/opencode-v2",
                  ][tab()]
                }
              </code>
              <CopyButton
                slot="copy"
                text={
                  [
                    "curl -fsSL https://opencode.ai/v2/install | bash",
                    "npm install -g @opencode/cli",
                    "brew install anomalyco/tap/opencode-v2",
                  ][tab()]
                }
              />
            </div>
          </div>
          <div data-component="code-tabs" data-files="">
            <div data-slot="tabs" role="tablist" aria-label="Files">
              <For each={["opencode.jsonc", "AGENTS.md"]}>
                {(label, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={file() === index() ? "true" : "false"}
                    tabIndex={file() === index() ? 0 : -1}
                    onClick={() => setFile(index())}
                  >
                    <FileTypeIcon path={label} />
                    {label}
                  </button>
                )}
              </For>
            </div>
            <div data-slot="code" role="tabpanel">
              <code>
                {
                  [
                    `{\n  "$schema": "https://opencode.ai/config.json",\n  "instructions": ["AGENTS.md"]\n}`,
                    "# Project instructions\n\n- Run bun typecheck after changing TypeScript.",
                  ][file()]
                }
              </code>
              <CopyButton
                slot="copy"
                text={
                  [
                    `{\n  "$schema": "https://opencode.ai/config.json",\n  "instructions": ["AGENTS.md"]\n}`,
                    "# Project instructions\n\n- Run bun typecheck after changing TypeScript.",
                  ][file()]
                }
              />
            </div>
          </div>
          <div data-component="plan-tabs">
            <div role="tablist" aria-label="Plan">
              <For each={["Go", "Go Plus"]}>
                {(label, index) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={plan() === index() ? "true" : "false"}
                    onClick={() => setPlan(index())}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
            <p>
              {plan() === 0
                ? "Go includes 50 requests a day on the fast models."
                : "Go Plus raises the limits and adds the large-context models."}
            </p>
          </div>
        </props.Sample>
      </props.Section>

      <props.Section id="code">
        <props.Sample variant="terminal" label="long line">
          <CodeFrame
            variant="terminal"
            kind="terminal"
            label="Terminal"
            copy={`$ opencode run --model opencode/claude-opus-5-5 "Explain the session runner and list every place that schedules a wake, with file paths"`}
          >
            <pre data-component="code-block">
              <code>
                <span data-token="prompt">$ </span>
                <span data-token="command">opencode</span> <span data-token="plain">run</span>{" "}
                <span data-token="flag">--model</span> <span data-token="string">opencode/claude-opus-5-5</span>{" "}
                <span data-token="string">
                  "Explain the session runner and list every place that schedules a wake, with file paths"
                </span>
                {"\n\n"}
                <span data-token="output">Reading packages/core/src/session/execution.ts…</span>
              </code>
            </pre>
          </CodeFrame>
        </props.Sample>
        <props.Sample variant="code" label="plain">
          <CodeFrame
            variant="code"
            kind="code"
            label="TypeScript"
            copy={`export default {\n  model: "opencode/claude-opus-5-5",\n}`}
          >
            <pre>
              <code>{`export default {
  model: "opencode/claude-opus-5-5",
}`}</code>
            </pre>
          </CodeFrame>
        </props.Sample>
        <props.Sample variant="codeTitle">
          <CodeFrame
            variant="codeTitle"
            kind="file"
            label="opencode.jsonc"
            copy={`{\n  "$schema": "https://opencode.ai/config.json",\n  "model": "opencode/claude-opus-5-5",\n  "permission": { "bash": "ask" }\n}`}
          >
            <figure data-component="code-figure">
              <figcaption>opencode.jsonc</figcaption>
              <pre>
                <code>{`{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/claude-opus-5-5",
  "permission": { "bash": "ask" }
}`}</code>
              </pre>
            </figure>
          </CodeFrame>
        </props.Sample>
        <props.Sample variant="codeLines" label="highlighted lines">
          <CodeFrame
            variant="codeLines"
            kind="file"
            label=".opencode/tools/count-lines.ts"
            copy={countLines.join("\n")}
          >
            <pre data-component="code-lines">
              <For each={countLines}>
                {(line, index) => (
                  <code data-line={index() + 1} data-mark={index() === 3 || index() === 4 ? "" : undefined}>
                    {line || " "}
                    {"\n"}
                  </code>
                )}
              </For>
            </pre>
          </CodeFrame>
        </props.Sample>
        <props.Sample variant="codeDiff">
          <CodeFrame
            variant="codeDiff"
            kind="file"
            label="opencode.jsonc"
            copy={'{\n  "model": "opencode/claude-opus-5-5",\n  "permission": { "bash": "ask" },\n}'}
          >
            <pre data-component="code-diff">
              <For
                each={[
                  [" ", "  {"],
                  [" ", '    "model": "opencode/claude-opus-5-5",'],
                  ["-", '    "permission": { "bash": "allow" },'],
                  ["+", '    "permission": { "bash": "ask" },'],
                  [" ", "  }"],
                ]}
              >
                {([sign, line]) => (
                  <code data-diff={sign}>
                    <span data-slot="sign">{sign}</span>
                    {line.slice(1)}
                    {"\n"}
                  </code>
                )}
              </For>
            </pre>
          </CodeFrame>
        </props.Sample>
      </props.Section>

      <props.Section id="file-tree">
        <props.Sample variant="fileTree">
          <CodeFrame variant="fileTree" kind="tree" label="Files">
            <FileTree
              tree={`.opencode/
└── plugins/
    ├── concise.ts
    ├── reviewer.js
    └── acme-package/`}
            />
          </CodeFrame>
        </props.Sample>
      </props.Section>

      <props.Section id="steps">
        <props.Sample variant="steps">
          <ol data-component="steps">
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
                <strong>Export a hook.</strong> Listen for <code>session.idle</code>.
              </p>
            </li>
            <li>
              <p>
                <strong>Restart OpenCode.</strong> Plugins load on start.
              </p>
              <CodeFrame variant="terminal" kind="terminal" label="Terminal" copy="$ opencode service restart">
                <pre data-component="code-block">
                  <code>
                    <span data-token="prompt">$ </span>
                    <span data-token="command">opencode</span> service restart
                  </code>
                </pre>
              </CodeFrame>
            </li>
          </ol>
        </props.Sample>
      </props.Section>

      <props.Section id="cards">
        <props.Sample variant="cards">
          <div data-component="card-group">
            <For
              each={[
                ["Plugins", "Hook into sessions, tools and events."],
                ["Client", "Talk to a running OpenCode server from JavaScript."],
                ["SDK", "Embed OpenCode in your own app."],
              ]}
            >
              {([title, body]) => (
                <a data-component="docs-card" href="#cards">
                  <strong>{title}</strong>
                  <div>{body}</div>
                </a>
              )}
            </For>
          </div>
        </props.Sample>
      </props.Section>

      <props.Section id="tables">
        <props.Sample variant="tables" label="simple and wide with code">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <kbd>Ctrl</kbd> <kbd>X</kbd> <kbd>N</kbd>
                </td>
                <td>New session</td>
              </tr>
              <tr>
                <td>
                  <kbd>Ctrl</kbd> <kbd>X</kbd> <kbd>M</kbd>
                </td>
                <td>Switch model</td>
              </tr>
            </tbody>
          </table>
          <div data-slot="scroll">
            <table>
              <thead>
                <tr>
                  <th>Option</th>
                  <th>Type</th>
                  <th>Default</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>compaction.auto</code>
                  </td>
                  <td>
                    <code>boolean</code>
                  </td>
                  <td>
                    <code>true</code>
                  </td>
                  <td>
                    Summarize the conversation when it nears the model's context limit, keeping the newest messages.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>permission.bash</code>
                  </td>
                  <td>
                    <code>"ask" | "allow" | "deny"</code>
                  </td>
                  <td>
                    <code>"ask"</code>
                  </td>
                  <td>Whether shell commands need your approval before they run.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </props.Sample>
      </props.Section>

      <props.Section id="badges">
        <props.Sample variant="badges">
          <p>
            <span data-component="badge">New</span> <span data-component="badge">Experimental</span>{" "}
            <span data-component="badge">Deprecated</span> <span data-component="badge">v2</span>
          </p>
        </props.Sample>
      </props.Section>

      <props.Section id="details">
        <props.Sample variant="details">
          <details>
            <summary>Why does OpenCode ask before running commands?</summary>
            <p>
              The default <code>bash</code> permission is <code>ask</code>, so nothing runs without your approval.
            </p>
          </details>
          <details>
            <summary>Can I use my own model provider?</summary>
            <p>Yes. Connect any of 75+ providers, or a local model through an OpenAI-compatible endpoint.</p>
          </details>
        </props.Sample>
      </props.Section>

      <props.Section id="media">
        <props.Sample variant="media" label="image and video">
          <figure>
            <img src={ogImage("/docs").src} alt="The OpenCode docs" width="1200" height="630" />
            <figcaption>The OpenCode terminal interface.</figcaption>
          </figure>
          <figure>
            <video controls muted playsinline preload="none" poster={ogImage("/docs").src} width="1200" height="630" />
            <figcaption>A video embed (no docs page uses one yet).</figcaption>
          </figure>
        </props.Sample>
      </props.Section>

      <props.Section id="api">
        <props.Sample variant="api">
          <ApiExample />
        </props.Sample>
      </props.Section>

      <props.Section id="config">
        <props.Sample variant="config">
          <CodeFrame variant="config" kind="config" label="opencode.jsonc options">
            <dl data-component="config-reference">
              <dt>
                <code>model</code> <span data-component="badge">string</span>
              </dt>
              <dd>
                The default model, as <code>provider/model</code>.
              </dd>
              <dt>
                <code>instructions</code> <span data-component="badge">string[]</span>
              </dt>
              <dd>Extra instruction files to load, as paths or globs.</dd>
            </dl>
          </CodeFrame>
        </props.Sample>
      </props.Section>

      <props.Section id="cli">
        <props.Sample variant="cli">
          <div data-component="cli-command">
            <CodeFrame variant="cli" kind="usage" label="Usage" copy="opencode run [message..]">
              <pre>
                <code>opencode run [message..]</code>
              </pre>
            </CodeFrame>
            <p>Run OpenCode with a message, without the terminal interface.</p>
            <table>
              <thead>
                <tr>
                  <th>Flag</th>
                  <th>Short</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>--model</code>
                  </td>
                  <td>
                    <code>-m</code>
                  </td>
                  <td>Model to use, as provider/model</td>
                </tr>
                <tr>
                  <td>
                    <code>--continue</code>
                  </td>
                  <td>
                    <code>-c</code>
                  </td>
                  <td>Continue the last session</td>
                </tr>
              </tbody>
            </table>
          </div>
        </props.Sample>
      </props.Section>

      <props.Section id="navigation">
        <props.Sample variant="breadcrumbs">
          <nav aria-label="Breadcrumb" data-component="breadcrumbs">
            <a href="#navigation">Docs</a> / <a href="#navigation">Configure</a> /{" "}
            <span aria-current="page">Agents</span>
          </nav>
        </props.Sample>
        <props.Sample variant="pagination">
          <nav aria-label="Pages" data-component="pagination">
            <a href="#navigation" rel="prev">
              <small>Previous</small> Config
            </a>{" "}
            <a href="#navigation" rel="next">
              <small>Next</small> Models
            </a>
          </nav>
        </props.Sample>
        <props.Sample variant="editLink" label="last updated">
          <p data-component="edit-link">
            <a href="https://github.com/anomalyco/opencode" target="_blank">
              Edit this page on GitHub
            </a>{" "}
            <span>Last updated 2 Nov 2026</span>
          </p>
        </props.Sample>
        <props.Sample variant="feedback">
          <p data-component="feedback">
            Was this page helpful? <button type="button">Yes</button> <button type="button">No</button>
          </p>
          <props.Note>No feedback widget exists in the real docs.</props.Note>
        </props.Sample>
        <props.Sample variant="switchers" label="language (v1)">
          <select aria-label="Language">
            <option>English</option>
            <option>Deutsch</option>
            <option>日本語</option>
            <option>العربية</option>
          </select>
        </props.Sample>
      </props.Section>

      <props.Section id="chrome">
        <props.Sample variant="search" label="the aside's search">
          <p data-slot="aside-pointer">The search box is at the top of the right aside.</p>
        </props.Sample>
        <props.Sample variant="contents" label="the aside's rail">
          <p data-slot="aside-pointer">The Contents rail is in the right aside, under the search box.</p>
        </props.Sample>
        {props.chrome}
      </props.Section>
    </>
  )
}

export type DocsSampleSection = (typeof docsSampleSections)[number]

export const docsSampleSections = [
  {
    id: "typography",
    title: "Typography",
    source: "Markdown · prose",
    components: ["typography", "kbd", "inlineCode"],
  },
  { id: "lists", title: "Lists", source: "Markdown · ul, ol, nested, task", components: ["lists"] },
  { id: "blockquote", title: "Blockquote", source: "Markdown · >", components: ["blockquote"] },
  {
    id: "callouts",
    title: "Callouts",
    source: "Callout.astro (note, tip, warning) · Starlight asides",
    components: ["callout"],
  },
  {
    id: "code-blocks",
    title: "Code block types",
    source: "Every code and terminal block type in Vercel square, no switching",
    components: [
      "tabs",
      "code",
      "codeTitle",
      "codeLines",
      "codeDiff",
      "terminal",
      "fileTree",
      "api",
      "config",
      "cli",
      "inlineCode",
    ],
  },
  { id: "tabs", title: "Tabs", source: "CodeTabs.astro · PlanTabs.astro · Starlight Tabs", components: ["tabs"] },
  {
    id: "code",
    title: "Code blocks",
    source: "Shiki · title=… transformer · Expressive Code (v1)",
    components: ["terminal", "code", "codeTitle", "codeLines", "codeDiff"],
  },
  { id: "file-tree", title: "File tree", source: "Starlight FileTree (not used yet)", components: ["fileTree"] },
  { id: "steps", title: "Steps", source: "Numbered lists (v2) · Starlight Steps (v1)", components: ["steps"] },
  { id: "cards", title: "Cards", source: "Card.astro · CardGroup.astro", components: ["cards"] },
  { id: "tables", title: "Tables", source: "Markdown tables (36 pages)", components: ["tables"] },
  { id: "badges", title: "Badges", source: "Not used in the docs yet", components: ["badges"] },
  { id: "details", title: "Details", source: "HTML details/summary", components: ["details"] },
  { id: "media", title: "Images and video", source: "Markdown images · video embeds", components: ["media"] },
  { id: "api", title: "API reference", source: "OpenApiReference.astro · OpenApiSchema.astro", components: ["api"] },
  { id: "config", title: "Config reference", source: "config.json schema · jsonc examples", components: ["config"] },
  { id: "cli", title: "CLI reference", source: "cli/commands.mdx · public/cli.json", components: ["cli"] },
  {
    id: "navigation",
    title: "Page navigation",
    source: "Prev/next · breadcrumbs · edit on GitHub · last updated",
    components: ["breadcrumbs", "pagination", "editLink", "feedback", "switchers"],
  },
  {
    id: "chrome",
    title: "Docs chrome",
    source: "docs-lockup · search · Contents rail · V1 notice",
    components: ["search", "contents"],
  },
] as const satisfies readonly { id: string; title: string; source: string; components: readonly DocsVariantKey[] }[]

const countLines = [
  'import { tool } from "@opencode-ai/plugin"',
  "",
  "export default tool({",
  '  description: "Count lines in a file",',
  "  args: { path: tool.schema.string() },",
  "})",
]

const notifyPlugin = `export const Notify = async () => ({
  "session.idle": async () => console.log("Done"),
})`
