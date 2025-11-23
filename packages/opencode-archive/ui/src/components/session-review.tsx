import { Accordion } from "./accordion"
import { Button } from "./button"
import { Diff } from "./diff"
import { DiffChanges } from "./diff-changes"
import { FileIcon } from "./file-icon"
import { Icon } from "./icon"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { For, Match, Show, Switch, type JSX, splitProps } from "solid-js"
import { createStore } from "solid-js/store"
import { type FileDiff } from "@opencode-ai/sdk"

export interface SessionReviewProps {
  split?: boolean
  class?: string
  classList?: Record<string, boolean | undefined>
  actions?: JSX.Element
  diffs: FileDiff[]
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

  const [split, rest] = splitProps(props, ["class", "classList"])

  return (
    <div
      data-component="session-review"
      classList={{
        ...(split.classList ?? {}),
        [split.class ?? ""]: !!split.class,
      }}
    >
      <div data-slot="session-review-header">
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
      <Accordion multiple value={store.open} onChange={handleChange}>
        <For each={props.diffs}>
          {(diff) => (
            <Accordion.Item value={diff.file}>
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
              <Accordion.Content>
                <Diff
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
  )
}
