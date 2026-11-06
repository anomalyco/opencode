import "./byos-options.css"
import { For, Show } from "solid-js"
import { useI18n } from "~/context/i18n"
import { rich } from "~/i18n/rich"
import { byos } from "~/lib/byos"
import { byosOptions } from "~/lib/byos-options"
import { docsUrl } from "~/lib/docs"
import { linkPhrases } from "~/lib/home-content"
import { providerLogo, providerMarks } from "~/lib/providers"
import { Rich } from "./rich-text"

/**
 * Settings › Subscriptions style A, B and C in "Bring your own subs" (lib/byos-options.ts): ways
 * to show that OpenCode works with nearly every subscription, provider and model. Like the section's
 * other styles, every option renders in development and the section's data-style shows one
 * (byos-options.css); production renders none while the default is "grid" (script/fold-settings.ts).
 */

// The providers with a mark (lib/providers.ts), never Anthropic's.
const marks = providerMarks.filter((provider) => provider.id !== "anthropic")
// Marks the subscriptions and local rows already show.
const shown = new Set(["github-copilot", "gitlab", "ollama", "lmstudio"])
const providers = marks.filter((provider) => !shown.has(provider.id))

/** Each option's lead, in place of the section's own (inside its lead paragraph). */
export function ByosOptionLeads() {
  const link = (text: string) => (
    <Rich
      value={linkPhrases(
        text,
        byos.planLinks.map((phrase) => ({ text: phrase, href: byos.plansHref })),
      )}
    />
  )
  return (
    <>
      <span data-option="A rows">{link(byosOptions.leads.rows)}</span>
      <span data-option="B wall">{link(byosOptions.leads.wall)}</span>
      <span data-option="C names">{link(byosOptions.leads.names)}</span>
    </>
  )
}

export function ByosOptions() {
  const i18n = useI18n()
  const providersLink = docsUrl("/providers/")
  return (
    <div data-slot="options">
      {/* A: a ruled row for each way in, its kind in the first column. */}
      <dl data-option="A rows">
        <div>
          <dt>{byosOptions.rows.subscriptions}</dt>
          <dd>
            <ul data-slot="names">
              <For each={byosOptions.subscriptions}>
                {(item) => (
                  <li>
                    <Mark logo={item.logo} />
                    {item.name}
                  </li>
                )}
              </For>
            </ul>
          </dd>
        </div>
        <div>
          <dt>{byosOptions.rows.providers}</dt>
          <dd>
            <ul data-slot="marks">
              <For each={providers}>
                {(provider) => (
                  <li data-tip={provider.name}>
                    <Mark logo={providerLogo(provider.id)} name={provider.name} />
                  </li>
                )}
              </For>
            </ul>
            <a href={providersLink}>{byosOptions.rows.providersMore}</a>
          </dd>
        </div>
        <div>
          <dt>{byosOptions.rows.local}</dt>
          <dd>
            <ul data-slot="names">
              <For each={byosOptions.local}>
                {(item) => (
                  <li>
                    <Show when={"logo" in item && item.logo}>{(logo) => <Mark logo={logo()} />}</Show>
                    {item.name}
                  </li>
                )}
              </For>
            </ul>
          </dd>
        </div>
        <div>
          <dt>{byosOptions.rows.opencode}</dt>
          <dd>
            <ul data-slot="names">
              <For each={byosOptions.opencode}>
                {(item) => (
                  <li>
                    <a href={item.href}>{item.name}</a>
                  </li>
                )}
              </For>
            </ul>
          </dd>
        </div>
      </dl>

      {/* B: every provider's mark in the tools grid's ruled cells, in whole rows of six or four (a
          multiple of 12), then the count. */}
      <div data-option="B wall">
        <ul aria-label={i18n.t("home.providers.aria")}>
          <For each={marks.slice(0, marks.length - (marks.length % 12))}>
            {(provider) => (
              <li data-tip={provider.name}>
                <Mark logo={providerLogo(provider.id)} name={provider.name} />
              </li>
            )}
          </For>
        </ul>
        <p>
          <Rich
            value={rich(i18n.t("home.providers.grid"), {
              modelsdev: "https://models.dev",
              providers: providersLink,
            })}
          />
        </p>
      </div>

      {/* C: the names as one wrapping run, the subscriptions in ink, each with its mark. */}
      <ul data-option="C names" aria-label={i18n.t("home.providers.aria")}>
        <For each={byosOptions.subscriptions}>
          {(item) => (
            <li data-kind="subscription">
              <Mark logo={item.logo} />
              {item.name}
            </li>
          )}
        </For>
        <For
          each={[
            ...providers.map((provider) => ({ ...provider, logo: providerLogo(provider.id) })),
            ...byosOptions.local,
          ]}
        >
          {(item) => (
            <li>
              <Show when={"logo" in item && item.logo}>{(logo) => <Mark logo={logo()} />}</Show>
              {item.name}
            </li>
          )}
        </For>
        <li>
          <a href={providersLink}>{byosOptions.all}</a>
        </li>
      </ul>
    </div>
  )
}

/** A provider's mark in the text colour; named only where no text beside it says the name. */
function Mark(props: { logo: string; name?: string }) {
  return (
    <span
      data-slot="mark"
      role={props.name ? "img" : undefined}
      aria-label={props.name}
      aria-hidden={props.name ? undefined : "true"}
      style={{ "--logo": `url(${props.logo})` }}
    />
  )
}
