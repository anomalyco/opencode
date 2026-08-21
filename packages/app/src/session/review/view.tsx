import { SessionReviewEmptyChangesV2 } from "@opencode-ai/session-ui/v2/session-review-empty-changes-v2"
import { SessionReviewV2SidebarToggle } from "@opencode-ai/session-ui/v2/session-review-v2"
import { Select } from "@opencode-ai/ui/select"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Match, Show, Suspense, Switch } from "solid-js"
import { useLanguage } from "@/context/language"
import { SessionSidePanel } from "../files/session-side-panel"
import { ReviewPanel } from "./panel"
import { SessionReviewTab } from "./review-tab"
import type { ChangeMode, SessionReviewModel } from "./model"

export function SessionMobileTabs(props: { review: SessionReviewModel; compact?: boolean; bottom?: boolean }) {
  const language = useLanguage()
  return (
    <Tabs value={props.review.mobile.tab()} class="h-auto">
      <Tabs.List
        classList={{
          "!h-9": props.compact,
          "[&::after]:!border-b-0 [&::after]:!border-t [&::after]:!border-border-weak-base": props.bottom,
        }}
      >
        <Tabs.Trigger
          value="session"
          classes={{ button: props.compact ? "w-full !py-2" : "w-full" }}
          classList={{
            "!w-1/2 !max-w-none": true,
            "!border-b-0 !border-t !border-border-weak-base [&:has([data-selected])]:!border-t-transparent":
              props.bottom,
          }}
          onClick={() => props.review.mobile.setTab("session")}
        >
          {language.t("session.tab.session")}
        </Tabs.Trigger>
        <Tabs.Trigger
          value="changes"
          classes={{ button: props.compact ? "w-full !py-2" : "w-full" }}
          classList={{
            "!w-1/2 !max-w-none !border-r-0": true,
            "!border-b-0 !border-t !border-border-weak-base [&:has([data-selected])]:!border-t-transparent":
              props.bottom,
          }}
          onClick={() => props.review.mobile.setTab("changes")}
        >
          {props.review.hasChanges()
            ? language.t("session.review.filesChanged", { count: props.review.count() })
            : language.plural("session.review.change", 0)}
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs>
  )
}

export function SessionMobileReview(props: { review: SessionReviewModel }) {
  return (
    <div class="relative h-full overflow-hidden">
      <ReviewContent review={props.review} />
    </div>
  )
}

export function SessionDesktopReview(props: { review: SessionReviewModel }) {
  return (
    <Suspense>
      <SessionSidePanel
        canReview={props.review.canReview()}
        diffs={props.review.diffs()}
        diffsReady={props.review.ready()}
        hasReview={props.review.hasChanges()}
        reviewHasFocusableContent={props.review.hasChanges() || props.review.panelState.sidebarOpened()}
        reviewCount={props.review.count()}
        reviewPanel={() => <ReviewPanelContent review={props.review} />}
        reviewSidebarToggle={(disabled) => (
          <SessionReviewV2SidebarToggle
            opened={props.review.panelState.sidebarOpened()}
            disabled={disabled}
            onToggle={props.review.panelState.toggleSidebar}
          />
        )}
        fileBrowserState={props.review.panelState}
        activeDiff={props.review.activeFile()}
        focusReviewDiff={props.review.focusFile}
        reviewSnap={props.review.screen.review.snap()}
        size={props.review.screen.size}
        stacked={props.review.screen.side.layout().stacked}
      />
    </Suspense>
  )
}

function ReviewContent(props: { review: SessionReviewModel }) {
  return (
    <Show when={!props.review.deferRender()}>
      <SessionReviewTab
        title={<ReviewTitle review={props.review} />}
        empty={<ReviewEmpty review={props.review} loadingClass="px-4 py-4 text-text-weak" />}
        diffs={props.review.diffs()}
        view={props.review.view()}
        diffStyle="unified"
        onScrollRef={props.review.setScroll}
        focusedFile={props.review.activeFile()}
        onLineComment={props.review.comments.add}
        onLineCommentUpdate={props.review.comments.update}
        onLineCommentDelete={props.review.comments.remove}
        lineCommentActions={props.review.comments.actions()}
        commentMentions={{ items: props.review.comments.mentions }}
        comments={props.review.comments.all()}
        focusedComment={props.review.comments.focus()}
        onFocusedCommentChange={props.review.comments.setFocus}
        onViewFile={props.review.openFile}
        classes={{
          root: "pb-8 [&_[data-slot=session-review-list]]:pb-0",
          header: "px-4 !h-16 !pb-4",
          container: "px-4",
        }}
      />
    </Show>
  )
}

function ReviewPanelContent(props: { review: SessionReviewModel }) {
  return (
    <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
      <Show when={props.review.panelRendered()}>
        <ReviewPanel
          title={<ReviewTitle review={props.review} />}
          empty={<ReviewPanelEmpty review={props.review} />}
          diffs={props.review.diffs()}
          diffsReady={props.review.ready()}
          diffVersion={props.review.diffVersion()}
          loadDiff={props.review.loadDiff}
          activeFile={props.review.activeFile()}
          onSelectFile={props.review.focusFile}
          diffStyle={props.review.diffStyle.current()}
          onDiffStyleChange={props.review.diffStyle.set}
          state={props.review.panelState}
          onLineComment={props.review.comments.add}
          onLineCommentUpdate={props.review.comments.update}
          onLineCommentDelete={props.review.comments.remove}
          lineCommentActions={props.review.comments.actions()}
          comments={props.review.comments.all()}
          focusedComment={props.review.comments.focus()}
          onFocusedCommentChange={props.review.comments.changeFocus}
        />
      </Show>
    </div>
  )
}

function ReviewTitle(props: { review: SessionReviewModel }) {
  const language = useLanguage()
  const label = (option: ChangeMode) => {
    if (option === "git") return language.t("ui.sessionReview.title.git")
    if (option === "branch") return language.t("ui.sessionReview.title.branch")
    return language.t("ui.sessionReview.title.lastTurn")
  }
  return (
    <Show when={props.review.canReview()}>
      <Select
        options={props.review.options()}
        current={props.review.mode()}
        label={label}
        placement="bottom-start"
        gutter={6}
        onSelect={(option) => option && props.review.setMode(option)}
      />
    </Show>
  )
}

function ReviewEmpty(props: { review: SessionReviewModel; loadingClass: string }) {
  const language = useLanguage()
  const loading = () => (props.review.mode() === "git" || props.review.mode() === "branch") && !props.review.ready()
  const noGit = () => props.review.mode() === "turn" && props.review.noGit()
  const text = () => {
    if (props.review.mode() === "git") return language.t("session.review.noUncommittedChanges")
    if (props.review.mode() === "branch") return language.t("session.review.noBranchChanges")
    return language.t("session.review.noChanges")
  }
  return (
    <Switch>
      <Match when={loading()}>
        <div class={props.loadingClass}>{language.t("session.review.loadingChanges")}</div>
      </Match>
      <Match when={noGit()}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="flex flex-col gap-3">
            <div class="text-14-medium text-text-strong">{language.t("session.review.noVcs.createGit.title")}</div>
            <div class="text-14-regular text-text-base max-w-md" style={{ "line-height": "var(--line-height-normal)" }}>
              {language.t("session.review.noVcs.createGit.description")}
            </div>
          </div>
        </div>
      </Match>
      <Match when={true}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="text-14-regular text-text-weak max-w-56">{text()}</div>
        </div>
      </Match>
    </Switch>
  )
}

function ReviewPanelEmpty(props: { review: SessionReviewModel }) {
  const language = useLanguage()
  const loading = () => (props.review.mode() === "git" || props.review.mode() === "branch") && !props.review.ready()
  const noGit = () => props.review.mode() === "turn" && props.review.noGit()
  return (
    <Switch>
      <Match when={loading()}>
        <div class="px-6 py-4 text-text-weak">{language.t("session.review.loadingChanges")}</div>
      </Match>
      <Match when={noGit()}>
        <div class="h-full pb-64 -mt-4 flex flex-col items-center justify-center text-center gap-6">
          <div class="text-14-regular text-text-weak max-w-56">
            {language.t("session.review.noVcs.createGit.description")}
          </div>
        </div>
      </Match>
      <Match when={true}>
        <SessionReviewEmptyChangesV2 />
      </Match>
    </Switch>
  )
}
