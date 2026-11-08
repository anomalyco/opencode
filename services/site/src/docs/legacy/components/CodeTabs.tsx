import { For } from "solid-js"
import { CodeBlock } from "./CodeBlock"

// The tabs switch through client.ts.
export function CodeTabs(props: { id: string; label: string; tabs: { label: string; code: string }[] }) {
  return (
    <div class="docs-code-tabs" data-code-tabs>
      <div class="docs-code-tabs-list" role="tablist" aria-label={props.label}>
        <For each={props.tabs}>
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
      <For each={props.tabs}>
        {(tab, index) => (
          <div
            role="tabpanel"
            id={`${props.id}-panel-${index()}`}
            aria-labelledby={`${props.id}-tab-${index()}`}
            hidden={index() !== 0}
            data-code-panel
          >
            <CodeBlock code={tab.code} />
          </div>
        )}
      </For>
    </div>
  )
}
