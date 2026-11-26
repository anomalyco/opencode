import { useI18n } from "~/context/i18n"
import { Marked } from "./marked"
import "./pair-panel.css"
import { createSignal, For, Match, onCleanup, Switch } from "solid-js"
import { useLanguage } from "~/context/language"
import { localize } from "~/i18n/content"
import { pairContent } from "~/lib/download-content"
import { pairQR } from "./pair-qr"
import { siteSettings } from "./settings"
import { Still, stillSizes } from "./media"

/**
 * "Connect your phone" on the Mobile page's Download section: what pairing is and how to do it, from
 * `opencode pair` (packages/cli/src/commands/handlers/pair.ts) and the iOS app. Settings › Pair style
 * (Design mode) shows it as numbered steps, an explanation beside what you'll see, or one callout card.
 */
export function PairPanel() {
  const language = useLanguage()
  const content = localize(language.locale(), "pair", pairContent())
  return (
    <div data-component="pair-panel" data-design="pairStyle" data-style={siteSettings.pairStyle}>
      <Switch>
        <Match when={siteSettings.pairStyle === "steps"}>
          <h3>{content.title}</h3>
          <p data-slot="intro">{content.intro}</p>
          <ol data-slot="steps">
            <For each={content.steps}>
              {(step, index) => (
                <li>
                  <span data-slot="number" aria-hidden="true">
                    {index() + 1}
                  </span>
                  <strong>{step.title}</strong>
                  <span>{step.body}</span>
                  {step.command ? <Command command={step.command} /> : undefined}
                </li>
              )}
            </For>
          </ol>
          <p data-slot="note">{content.note}</p>
        </Match>
        <Match when={siteSettings.pairStyle === "split"}>
          <div data-slot="split">
            <div data-slot="copy">
              <h3>{content.title}</h3>
              <p data-slot="intro">{content.intro}</p>
              <Command command={content.command} />
              <ol data-slot="plain-steps">
                <For each={content.steps}>{(step) => <li>{step.body}</li>}</For>
              </ol>
              <p data-slot="note">{content.note}</p>
            </div>
            <div data-slot="visual" aria-hidden="true">
              {/* What the command prints (its real layout; example code and address, see pair-qr.ts),
                  beside the iPhone app's sessions after pairing (real app footage). */}
              <pre data-slot="terminal">
                <span data-slot="prompt">$ {content.command}</span>
                {"\n\n  Open a link to connect. Links work once and expire in 5 minutes.\n\n"}
                {"  https://your-computer.opentunnel.xyz/auth/connect/…\n\n"}
                {pairQR
                  .split("\n")
                  .map((line) => `  ${line}`)
                  .join("\n")}
              </pre>
              <Still
                src="/product-videos/features/mobile-3.jpg"
                sizes={stillSizes.clip}
                alt=""
                width="1600"
                height="1000"
                loading="lazy"
              />
            </div>
          </div>
        </Match>
        <Match when={siteSettings.pairStyle === "card"}>
          <div data-slot="card">
            <h3>{content.cardTitle}</h3>
            <p data-slot="intro">{content.intro}</p>
            <Command command={content.command} />
            <ul data-slot="facts">
              <For each={content.facts}>{(fact) => <li>{fact}</li>}</For>
            </ul>
          </div>
        </Match>
      </Switch>
    </div>
  )
}

/** A command with a Copy button, in the Terminal install tabs' frame (on a static page, src/client/islands/download-list.ts copies). */
function Command(props: { command: string }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  return (
    <div data-slot="command" data-funnel-copy="pair">
      <code>{props.command}</code>
      <button
        type="button"
        data-component="site-button"
        data-variant="neutral"
        aria-live="polite"
        onClick={() =>
          void navigator.clipboard.writeText(props.command).then(() => {
            clearTimeout(timer)
            setCopied(true)
            timer = setTimeout(() => setCopied(false), 1500)
          })
        }
      >
        <Marked
          text={i18n.t(copied() ? "site.action.copiedThisCommand" : "site.action.copyThisCommand")}
          slots={{ sr: "sr-only" }}
        />
      </button>
    </div>
  )
}
