import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Show, Switch, Match, type JSX, createMemo } from "solid-js"
import FileTree from "@/components/file-tree"
import { useLanguage } from "@/context/language"
import { useFile } from "@/context/file"
import { useFileTreePanel } from "@/pages/session/use-file-tree-panel"
import { createSessionTabs } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { FileTabContent } from "@/pages/session/file-tabs"

type MobileFullscreenPanelProps = {
  active: "review" | "fileTree" | "file" | null
  onClose: () => void
  onShowFile: () => void
  onShowFileTree: () => void
  reviewPanel: () => JSX.Element
}

export function MobileFullscreenPanel(props: MobileFullscreenPanelProps) {
  const language = useLanguage()
  const file = useFile()
  const { tabs } = useSessionLayout()
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

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })

  const activeFileTab = tabState.activeFileTab

  const isOpen = () => props.active === "review" || props.active === "fileTree" || props.active === "file"

  const handleFileClick = (node: { path: string }) => {
    openTab(file.tab(node.path))
    props.onShowFile()
  }

  const titleText = createMemo(() => {
    if (props.active === "review") return language.t("session.tab.review")
    if (props.active === "file") {
      const tab = activeFileTab()
      if (tab) {
        const path = file.pathFromTab(tab)
        if (path) return path.split("/").pop() ?? tab
      }
      return language.t("session.files.title")
    }
    return language.t("session.files.title")
  })

  const handleBack = () => {
    if (props.active === "file") {
      props.onShowFileTree()
    } else {
      props.onClose()
    }
  }

  return (
    <Show when={isOpen()}>
      <div class="fixed inset-0 z-40 flex flex-col bg-background-base md:hidden">
        <div class="flex items-center justify-between h-11 px-2 border-b border-border-weak-base shrink-0">
          <IconButton icon="arrow-left" variant="ghost" onClick={handleBack} aria-label={language.t("common.back")} />
          <span class="text-14-medium truncate max-w-[60%]">{titleText()}</span>
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
                          onFileClick={handleFileClick}
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
                        onFileClick={handleFileClick}
                      />
                    </Match>
                  </Switch>
                </Tabs.Content>
              </Tabs>
            </div>
          </Show>

          <Show when={props.active === "file"}>
            <Show when={activeFileTab()} keyed>
              {(tab) => <FileTabContent tab={tab} />}
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  )
}
