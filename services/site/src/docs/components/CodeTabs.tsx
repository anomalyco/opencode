import { For, Show } from "solid-js"
import { CopyButton } from "~/component/site/code-frame"
import { FileTypeIcon } from "~/component/site/file-type-icon"

// Tabs in the code block's header (package managers, or files when every label is a file name, which
// then leads with its icon) and Copy for the open tab. The tabs switch through client.ts.
export function CodeTabs(props: { id: string; label: string; tabs: { label: string; code: string }[] }) {
  const files = props.tabs.every((tab) => /\.\w+$/.test(tab.label) && !/\s/.test(tab.label))
  return (
    <div data-component="code-tabs" data-code-tabs data-files={files ? "" : undefined}>
      <div data-slot="tabs" role="tablist" aria-label={props.label}>
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
              <Show when={files}>
                <FileTypeIcon path={tab.label} />
              </Show>
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <For each={props.tabs}>
        {(tab, index) => (
          <div
            data-slot="code"
            role="tabpanel"
            id={`${props.id}-panel-${index()}`}
            aria-labelledby={`${props.id}-tab-${index()}`}
            hidden={index() !== 0}
            tabindex={0}
            data-code-panel
            data-funnel-copy="snippet"
          >
            <code>{tab.code}</code>
            <CopyButton slot="copy" text={tab.code} />
          </div>
        )}
      </For>
    </div>
  )
}
