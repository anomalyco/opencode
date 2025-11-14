import { useLocal } from "@/context/local"
import { useSession } from "@/context/session"
import { FileIcon } from "@/ui"
import { getDirectory, getFilename } from "@/utils"
import { Accordion, Button, Diff, DiffChanges, Icon, IconButton, Tooltip } from "@opencode-ai/ui"
import { For, Match, Show, Switch } from "solid-js"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { createStore } from "solid-js/store"

export const SessionReview = (props: { split?: boolean; class?: string; hideExpand?: boolean }) => {
  const local = useLocal()
  const session = useSession()
  const [store, setStore] = createStore({
    open: session.diffs().map((d) => d.file),
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
        session.diffs().map((d) => d.file),
      )
    }
  }

  return (
    <div
      classList={{
        "flex flex-col gap-3 h-full overflow-y-auto no-scrollbar": true,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div class="sticky top-0 z-20 bg-background-stronger h-8 shrink-0 flex justify-between items-center self-stretch">
        <div class="text-14-medium text-text-strong">Session changes</div>
        <div class="flex items-center gap-x-4 pr-px">
          <Button size="normal" icon="chevron-grabber-vertical" onClick={handleExpandOrCollapseAll}>
            <Switch>
              <Match when={store.open.length > 0}>Collapse all</Match>
              <Match when={true}>Expand all</Match>
            </Switch>
          </Button>
          <Show when={!props.hideExpand}>
            <Tooltip value="Open in tab">
              <IconButton
                icon="expand"
                variant="ghost"
                onClick={() => {
                  local.layout.review.tab()
                  session.layout.setActiveTab("review")
                }}
              />
            </Tooltip>
          </Show>
        </div>
      </div>
      <Accordion multiple value={store.open} onChange={handleChange}>
        <For each={session.diffs()}>
          {(diff) => (
            <Accordion.Item value={diff.file}>
              <StickyAccordionHeader class="top-11 data-expanded:before:-top-11">
                <Accordion.Trigger class="bg-background-stronger">
                  <div class="flex items-center justify-between w-full gap-5">
                    <div class="grow flex items-center gap-5 min-w-0">
                      <FileIcon node={{ path: diff.file, type: "file" }} class="shrink-0 size-4" />
                      <div class="flex grow min-w-0">
                        <Show when={diff.file.includes("/")}>
                          <span class="text-text-base truncate-start">{getDirectory(diff.file)}&lrm;</span>
                        </Show>
                        <span class="text-text-strong shrink-0">{getFilename(diff.file)}</span>
                      </div>
                    </div>
                    <div class="shrink-0 flex gap-4 items-center justify-end">
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
