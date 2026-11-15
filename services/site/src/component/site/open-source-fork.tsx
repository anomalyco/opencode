import { Rich } from "./rich-text"
import { rich } from "~/i18n/rich"
import { useI18n } from "~/context/i18n"
import "./open-source-fork.css"
import { createSignal, For, onCleanup } from "solid-js"
import { docsUrl } from "~/lib/docs"
import { designCopy } from "./design-copy"
import { revealMotion } from "./reveal"
import { createWash } from "./use-wash"
import { siteSettings } from "./settings"

// The steps from CONTRIBUTING.md (Development: Bun 1.3 or newer, `bun install`, `bun dev [directory]`),
// after `gh repo fork --clone`. Output lines are what gh and git print (gh's "✓" marks left out: OpenTUI
// Mono has no check mark); comments explain.
const transcript = [
  { kind: "command", text: "gh repo fork anomalyco/opencode --clone" },
  { kind: "output", text: "Created fork you/opencode" },
  { kind: "output", text: "Cloning into 'opencode'..." },
  { kind: "output", text: "Cloned fork" },
  { kind: "command", text: "cd opencode" },
  { kind: "command", text: "bun install" },
  { kind: "comment", text: "# Bun 1.3 or newer" },
  { kind: "command", text: "bun dev ." },
  { kind: "comment", text: "# runs the CLI and TUI from your fork" },
] as const

/**
 * Settings › Open source variant "fork": a "fork it" block under the open source proof. A short
 * terminal transcript of forking and running OpenCode types in, line by line, the first time it
 * scrolls into view (the shared entrance, reveal.ts, in its "type" style; static with reduced
 * motion), beside three things a fork lets you do. In development it always renders and the
 * section's data-oss-variant (set before first paint from Settings) shows it; production renders it
 * only when "fork" is the default (index.tsx, script/fold-settings.ts).
 */
export function OpenSourceFork() {
  const i18n = useI18n()
  let terminal: HTMLDivElement | undefined
  const wash = createWash(() => terminal)
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const copy = () => {
    const commands = transcript.filter((line) => line.kind === "command").map((line) => line.text)
    void navigator.clipboard.writeText(commands.join("\n")).then(() => {
      clearTimeout(timer)
      setCopied(true)
      timer = setTimeout(() => setCopied(false), 1500)
    })
  }

  // Each line starts once the one before has had time to type.
  const delay = (index: number) => {
    const start = wash.start()
    if (start === undefined) return undefined
    return Math.max(0, Math.round(start + index * 240 - performance.now()))
  }

  return (
    <div data-component="oss-fork" data-design="ossVariant">
      <h3 data-slot="heading" data-design-copy="home.fork.title">
        {designCopy("home.fork.title", i18n.t("home.fork.title"))}
      </h3>
      <div
        data-slot="terminal"
        data-funnel-copy="fork"
        ref={terminal}
        data-entrance
        data-mounted={wash.mounted() ? "" : undefined}
        data-reveal={wash.armed() ? "" : undefined}
        data-armed={wash.armed() ? "" : undefined}
        data-animation={wash.armed() ? "type" : undefined}
        style={wash.armed() ? revealMotion("type", siteSettings.logoTuning) : undefined}
      >
        <div data-slot="bar">
          <span>{i18n.t("home.install.terminal")}</span>
          <button type="button" data-slot="copy" aria-live="polite" onClick={copy}>
            {copied() ? i18n.t("site.action.copied") : i18n.t("home.fork.copy")}
          </button>
        </div>
        <pre>
          <code>
            <For each={transcript}>
              {(line, index) => (
                <span
                  data-slot="brand"
                  data-kind={line.kind}
                  data-state={delay(index()) === undefined ? undefined : "in"}
                  style={
                    delay(index()) === undefined
                      ? undefined
                      : { "--logo-delay": `${delay(index())}ms`, "--wipe-delay": `${delay(index())}ms` }
                  }
                >
                  <span data-slot="mark">
                    {line.kind === "command" ? (
                      <span data-slot="prompt" aria-hidden="true">
                        ›{" "}
                      </span>
                    ) : null}
                    {line.text}
                  </span>
                </span>
              )}
            </For>
          </code>
        </pre>
      </div>
      <ul data-slot="points">
        <li>
          <h4>{i18n.t("home.fork.interface.title")}</h4>
          <p>{i18n.t("home.fork.interface.body")}</p>
        </li>
        <li>
          <h4>{i18n.t("home.fork.agents.title")}</h4>
          <p>
            <Rich
              value={rich(i18n.t("home.fork.agents.body"), { plugins: `https://opencode.ai${docsUrl("/plugins/")}` })}
            />
          </p>
        </li>
        <li>
          <h4>{i18n.t("home.fork.build.title")}</h4>
          <p>{i18n.t("home.fork.build.body")}</p>
        </li>
      </ul>
    </div>
  )
}
