import { For, type JSX } from "solid-js"
import { useI18n } from "~/context/i18n"
import { CodeTabs } from "./CodeTabs"
import { SlotScope } from "./Slot"

// Starlight's tabs (the V1 docs, remark-starlight.ts), with `tabs` as JSON: each tab's label, and its
// code when every tab is one code block, which makes them code tabs. Others are the plan tabs' look,
// a panel per tab from the `<Slot name="0">`, `<Slot name="1">`, … children. Both switch through
// client.ts.
export function Tabs(props: { id: string; tabs: string; children?: JSX.Element }) {
  const i18n = useI18n()
  const tabs: { label: string; code?: string }[] = JSON.parse(props.tabs)
  if (tabs.every((tab) => tab.code !== undefined))
    return (
      <CodeTabs
        id={props.id}
        label={i18n.t("docs.codeExamples")}
        tabs={tabs.map((tab) => ({ label: tab.label, code: tab.code! }))}
      />
    )
  return (
    <div data-component="plan-tabs" data-code-tabs>
      <div role="tablist">
        <For each={tabs}>
          {(tab, index) => (
            <button
              type="button"
              role="tab"
              id={`${props.id}-tab-${index()}`}
              aria-controls={`${props.id}-panel-${index()}`}
              aria-selected={index() === 0 ? "true" : "false"}
              tabindex={index() === 0 ? 0 : -1}
              data-code-tab
              data-funnel={`code-tab:${tab.label}`}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <For each={tabs}>
        {(_, index) => (
          <div
            role="tabpanel"
            id={`${props.id}-panel-${index()}`}
            aria-labelledby={`${props.id}-tab-${index()}`}
            hidden={index() !== 0}
          >
            <SlotScope name={String(index())}>{props.children}</SlotScope>
          </div>
        )}
      </For>
    </div>
  )
}
