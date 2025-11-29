import { Accordion } from "./accordion"
import { Button } from "./button"
import { Diff } from "./diff"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { type FileDiff } from "@opencode-ai/sdk"
import { PreloadMultiFileDiffResult } from "@pierre/precision-diffs/ssr"

export interface SessionReviewProps {
  split?: boolean
  class?: string
  classList?: Record<string, boolean | undefined>
  classes?: { root?: string; header?: string; container?: string }
  actions?: JSX.Element
  diffs: (FileDiff & { preloaded?: PreloadMultiFileDiffResult<any> })[]
}

export const SessionReview = (props: SessionReviewProps) => {
  const [store, setStore] = createStore({
    open: props.diffs.map((d) => d.file),
  })

  const handleChange = (open: string[]) => {
    setStore("open", open)
  }

  const handleExpandOrCollapseAll = () => {
    if (store.open.length > 0) {
      setStore("open", [])
    } else {
      setStore(
        "open",
        props.diffs.map((d) => d.file),
      )
    }
  }

  return (
    <div
      data-component="session-review"
      classList={{
        ...(props.classList ?? {}),
        [props.classes?.root ?? ""]: !!props.classes?.root,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div
        data-slot="session-review-header"
        classList={{
          [props.classes?.header ?? ""]: !!props.classes?.header,
        }}
      >
        <div data-slot="session-review-title">Session changes</div>
        <div data-slot="session-review-actions">
          <Button size="normal" icon="chevron-grabber-vertical" onClick={handleExpandOrCollapseAll}>
            <Switch>
              <Match when={store.open.length > 0}>Collapse all</Match>
              <Match when={true}>Expand all</Match>
            </Switch>
          </Button>
          {props.actions}
        </div>
      </div>
      <div
        data-slot="session-review-container"
        classList={{
          [props.classes?.container ?? ""]: !!props.classes?.container,
        }}
      >
        <Accordion multiple value={store.open} onChange={handleChange}>
          <For each={props.diffs}>
            {(diff) => (
              <Accordion.Item forceMount value={diff.file} data-slot="session-review-accordion-item">
                <StickyAccordionHeader>
                  <Accordion.Trigger>
                    <div data-slot="session-review-trigger-content">
                      <div data-slot="session-review-file-info">
                        <FileIcon node={{ path: diff.file, type: "file" }} />
                        <div data-slot="session-review-file-name-container">
                          <Show when={diff.file.includes("/")}>
                            <span data-slot="session-review-directory">{getDirectory(diff.file)}&lrm;</span>
                          </Show>
                          <span data-slot="session-review-filename">{getFilename(diff.file)}</span>
                        </div>
                      </div>
                      <div data-slot="session-review-trigger-actions">
                        <DiffChanges changes={diff} />
                        <Icon name="chevron-grabber-vertical" size="small" />
                      </div>
                    </div>
                  </Accordion.Trigger>
                </StickyAccordionHeader>
                <Accordion.Content data-slot="session-review-accordion-content">
                  <Diff
                    preloadedDiff={diff.preloaded}
                    diffStyle={props.split ? "split" : "unified"}
                    before={{
                      name: diff.file!,
                      contents: diff.before!,
                    }}
                    after={{
                      name: diff.file!,
                      contents: diff.after!,
                    }}
                  />
                </Accordion.Content>
              </Accordion.Item>
            )}
          </For>
        </Accordion>
      </div>
    </div>
  )
}
