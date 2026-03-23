import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Show, Switch, Match, type JSX } from "solid-js"
import FileTree from "@/components/file-tree"
import { useLanguage } from "@/context/language"
import { useFile } from "@/context/file"
import { useFileTreePanel } from "@/pages/session/use-file-tree-panel"

type MobileFullscreenPanelProps = {
  active: "review" | "fileTree" | null
  onClose: () => void
  reviewPanel: () => JSX.Element
}

export function MobileFullscreenPanel(props: MobileFullscreenPanelProps) {
  const language = useLanguage()
  const file = useFile()
  const {
    diffFiles,
    kinds,
    empty,
    nofiles,
    openTab,
    fileTreeTab,
    setFileTreeTabValue,
    showAllFiles,
    hasReview,
    diffsReady,
    reviewEmptyKey,
    reviewCount,
  } = useFileTreePanel()

  const isOpen = () => props.active === "review" || props.active === "fileTree"

  return (
    <Show when={isOpen()}>
      <div class="fixed inset-0 z-40 flex flex-col bg-background-base md:hidden">
        <div class="flex items-center justify-between h-11 px-2 border-b border-border-weak-base shrink-0">
          <IconButton
            icon="arrow-left"
            variant="ghost"
            onClick={props.onClose}
            aria-label={language.t("common.back")}
          />
          <span class="text-14-medium">
            {props.active === "review" ? language.t("session.tab.review") : language.t("session.files.title")}
          </span>
          <div class="w-8" />
        </div>

        <div class="flex-1 min-h-0 overflow-hidden">
          <Show when={props.active === "review"}>{props.reviewPanel()}</Show>

          <Show when={props.active === "fileTree"}>
            <div class="h-full flex flex-col overflow-hidden">
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {reviewCount()}{" "}
                    {language.t(reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                  <Switch>
                    <Match when={hasReview()}>
                      <Show
                        when={diffsReady()}
                        fallback={
                          <div class="px-2 py-2 text-12-regular text-text-weak">
                            {language.t("common.loading")}
                            {language.t("common.loading.ellipsis")}
                          </div>
                        }
                      >
                        <FileTree
                          path=""
                          class="pt-3"
                          allowed={diffFiles()}
                          kinds={kinds()}
                          draggable={false}
                          onFileClick={(node) => {
                            showAllFiles()
                            openTab(file.tab(node.path))
                            props.onClose()
                          }}
                        />
                      </Show>
                    </Match>
                    <Match when={true}>{empty(language.t(reviewEmptyKey()))}</Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                  <Switch>
                    <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                    <Match when={true}>
                      <FileTree
                        path=""
                        class="pt-3"
                        modified={diffFiles()}
                        kinds={kinds()}
                        onFileClick={(node) => {
                          openTab(file.tab(node.path))
                          props.onClose()
                        }}
                      />
                    </Match>
                  </Switch>
                </Tabs.Content>
              </Tabs>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
