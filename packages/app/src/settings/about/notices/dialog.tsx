import { For, Show } from "solid-js"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup, type DialogProps } from "@opencode/ui/dialog"
import { ScrollView } from "@opencode/ui/scroll-view"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { fonts } from "./fonts"
import { crateNotices, notices } from "./notices"

const licenseOf = new Map(crateNotices.texts.map((text) => [text.id, text.license]))

const texts = crateNotices.texts.map((text) => ({
  ...text,
  // Two versions of one crate (hashbrown) read as one name.
  crates: [...new Set(crateNotices.crates.filter((crate) => crate.texts.includes(text.id)).map((crate) => crate.name))],
}))

export default function DialogThirdPartyNotices(props: { onCloseAutoFocus?: DialogProps["onCloseAutoFocus"] }) {
  const language = useLanguage()

  return (
    <Dialog size="large" onCloseAutoFocus={props.onCloseAutoFocus}>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.about.notices.title")}
          description={language.t("settings.about.notices.description")}
        />
      </DialogHeader>
      <DialogBody>
        <ScrollView class="settings-notices-scroll">
          <div class="settings-notices">
            <For each={notices}>
              {(entry) => (
                <section class="settings-notice">
                  <div class="settings-notice-heading">
                    <ExternalLink href={entry.url}>{entry.name}</ExternalLink>
                    <span>{entry.license}</span>
                  </div>
                  <p>{entry.detailKey ? language.t(entry.detailKey) : entry.detail}</p>
                  <Show when={entry.notice}>{(notice) => <pre>{notice()}</pre>}</Show>
                  <details>
                    <summary>{language.t("settings.about.notices.license")}</summary>
                    <pre>{entry.text}</pre>
                  </details>
                </section>
              )}
            </For>
            <section class="settings-notice settings-crates">
              <h3 class="settings-notice-heading">{language.t("settings.about.notices.fonts.title")}</h3>
              <p>{language.t("settings.about.notices.fonts.description")}</p>
              <ul class="settings-crate-list">
                <For each={fonts.families}>
                  {(family) => (
                    <li class="settings-crate">
                      <div class="settings-crate-heading">
                        <ExternalLink href={family.url}>{family.name}</ExternalLink>
                      </div>
                      <p>{family.copyright.join("\n")}</p>
                    </li>
                  )}
                </For>
              </ul>
              <details>
                <summary>SIL Open Font License 1.1</summary>
                <pre>{fonts.license}</pre>
              </details>
            </section>
            <section class="settings-notice settings-crates">
              <h3 class="settings-notice-heading">{language.t("settings.about.notices.crates.title")}</h3>
              <p>{language.t("settings.about.notices.crates.description")}</p>
              <ul class="settings-crate-list">
                <For each={crateNotices.crates}>
                  {(crate) => {
                    const applied = new Set(crate.texts.map((id) => licenseOf.get(id)))

                    return (
                      <li class="settings-crate">
                        <div class="settings-crate-heading">
                          <span>
                            <ExternalLink href={crate.repository}>{crate.name}</ExternalLink> {crate.version}
                          </span>
                          <span>
                            <For each={crate.license.split(/([\s()]+)/)}>
                              {(part) => (applied.has(part) ? <strong>{part}</strong> : part)}
                            </For>
                          </span>
                        </div>
                        <p>{crate.copyright.join("\n")}</p>
                      </li>
                    )
                  }}
                </For>
              </ul>
              <h4>{language.t("settings.about.notices.crates.licenses")}</h4>
              <For each={texts}>
                {(text) => (
                  <details>
                    <summary>
                      {text.title}
                      <span>{language.plural("settings.about.notices.crates.count", text.crates.length)}</span>
                    </summary>
                    <p>
                      {language.rich("settings.about.notices.crates.appliesTo", { names: language.list(text.crates) })}
                    </p>
                    <pre>{text.text}</pre>
                  </details>
                )}
              </For>
            </section>
          </div>
        </ScrollView>
      </DialogBody>
    </Dialog>
  )
}
