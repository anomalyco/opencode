import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { getPrButtonContainerStyle, getPrButtonDividerStyle } from "@/utils/pr-style"
import { CreatePrDialog } from "./dialog-create-pr"
import { MergePrDialog } from "./dialog-merge-pr"
import { AddressCommentsDialog } from "./dialog-address-comments"

export function PrButton() {
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()

  const [menu, setMenu] = createStore({ open: false })

  const vcs = createMemo(() => sync.data.vcs)
  const pr = createMemo(() => vcs()?.pr)
  const github = createMemo(() => vcs()?.github)
  const defaultBranch = createMemo(() => vcs()?.defaultBranch)
  const branch = createMemo(() => vcs()?.branch)

  const isOnDefaultBranch = createMemo(() => {
    const b = branch()
    const db = defaultBranch()
    if (!b || !db) return false
    return b === db
  })

  const hidden = createMemo(() => {
    if (!vcs()) return true
    if (!github()?.available) return true
    if (isOnDefaultBranch()) return true
    return false
  })

  const canMutate = createMemo(() => {
    return server.isLocal() && github()?.authenticated
  })

  const tooltipText = createMemo(() => {
    if (!github()?.authenticated) return language.t("pr.tooltip.not_authenticated")
    if (!server.isLocal()) return language.t("pr.tooltip.not_local")
    return undefined
  })

  const isOpen = createMemo(() => {
    const p = pr()
    return p?.state === "OPEN"
  })

  const isMerged = createMemo(() => pr()?.state === "MERGED")
  const isClosed = createMemo(() => pr()?.state === "CLOSED")

  const containerStyle = createMemo(() => getPrButtonContainerStyle(pr()))
  const dividerStyle = createMemo(() => getPrButtonDividerStyle(pr()))

  const ciLabel = createMemo(() => {
    const p = pr()
    if (!p?.checksState) return undefined
    const summary = p.checksSummary
    if (p.checksState === "SUCCESS") return language.t("pr.menu.ci.success")
    if (p.checksState === "FAILURE" && summary) {
      return language.t("pr.menu.ci.failure", {
        failed: String(summary.failed),
        total: String(summary.total),
      })
    }
    if (p.checksState === "PENDING" && summary) {
      return language.t("pr.menu.ci.pending", {
        pending: String(summary.pending),
        plural: summary.pending === 1 ? "" : "s",
      })
    }
    return language.t("pr.menu.ci")
  })

  const ciIconName = createMemo(() => {
    const p = pr()
    if (p?.checksState === "SUCCESS") return "circle-check" as const
    if (p?.checksState === "FAILURE") return "circle-x" as const
    return "loader" as const
  })

  const ciIconColor = createMemo(() => {
    const p = pr()
    if (p?.checksState === "SUCCESS") return "text-icon-success-base"
    if (p?.checksState === "FAILURE") return "text-icon-critical-base"
    return "text-icon-warning-base"
  })

  const ciIconSpin = createMemo(() => pr()?.checksState === "PENDING")

  const commentLabel = createMemo(() => {
    const p = pr()
    if (!p) return language.t("pr.menu.comments")
    if (p.unresolvedCommentCount === undefined) return language.t("pr.menu.comments")
    if (p.unresolvedCommentCount === 0) return language.t("pr.menu.comments.none")
    if (p.unresolvedCommentCount === 1) return language.t("pr.menu.comments.one")
    return language.t("pr.menu.comments.count", { count: String(p.unresolvedCommentCount) })
  })

  const openPr = () => {
    const p = pr()
    if (!p?.url) return
    platform.openLink(p.url)
  }

  const copyLink = () => {
    const p = pr()
    if (!p?.url) return
    navigator.clipboard
      .writeText(p.url)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("pr.toast.copied"),
          description: p.url,
        })
      })
      .catch(() => {
        // Clipboard write can fail in non-secure contexts; not actionable
      })
  }

  const viewCI = () => {
    const p = pr()
    if (!p?.checksUrl) return
    platform.openLink(p.checksUrl)
  }

  const openCreateDialog = () => {
    dialog.show(() => <CreatePrDialog />)
  }

  const openAddressDialog = () => {
    dialog.show(() => <AddressCommentsDialog />)
  }

  const openMergeDialog = () => {
    dialog.show(() => <MergePrDialog />)
  }

  const handleDeleteBranch = async () => {
    const p = pr()
    if (!p?.headRefName) return
    try {
      await sdk.client.vcs.pr.deleteBranch({
        directory: sdk.directory,
        prDeleteBranchInput: { branch: p.headRefName },
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("pr.toast.branch_deleted"),
      })
    } catch {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: language.t("pr.error.delete_branch_failed"),
      })
    }
  }

  return (
    <Show when={!hidden()}>
      <div class="flex items-center">
        <div class="relative">
          <Show when={(pr()?.unresolvedCommentCount ?? 0) > 0}>
            <div class="absolute -top-px -right-px z-10 size-1.5 rounded-full bg-text-interactive-base" />
          </Show>
          <div
            class={`flex h-[24px] box-border items-center rounded-md border overflow-hidden transition-colors ${containerStyle()}`}
          >
            <Show
              when={pr()}
              fallback={
                <Tooltip value={tooltipText()} placement="top" gutter={8} disabled={!tooltipText()}>
                  <Button
                    variant="ghost"
                    class="rounded-none h-full py-0 pr-3 pl-1.5 gap-1.5 border-none shadow-none"
                    disabled={!canMutate()}
                    onClick={openCreateDialog}
                  >
                    <Icon name="github" size="small" class="text-text-strong" />
                    <span class="text-12-regular text-text-strong">{language.t("pr.button.create")}</span>
                  </Button>
                </Tooltip>
              }
            >
              {(currentPr) => (
                <>
                  <Button
                    variant="ghost"
                    class="rounded-none h-full py-0 pr-3 pl-1.5 gap-1.5 border-none shadow-none"
                    onClick={openPr}
                  >
                    <Icon name="github" size="small" class="text-text-strong" />
                    <span class="text-12-regular text-text-strong">
                      {language.t("pr.button.open", { number: String(currentPr().number) })}
                    </span>
                  </Button>
                  <div class={`self-stretch w-px ${dividerStyle()}`} />
                  <DropdownMenu
                    gutter={4}
                    placement="bottom-end"
                    open={menu.open}
                    onOpenChange={(open) => setMenu("open", open)}
                  >
                    <DropdownMenu.Trigger
                      as={Button}
                      variant="ghost"
                      class="rounded-none h-full w-[24px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active relative group"
                      aria-label={language.t("common.moreOptions")}
                    >
                      <Icon name="chevron-down" size="small" class="text-icon-base" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        {/* Copy link — always visible */}
                        <DropdownMenu.Item
                          onSelect={() => {
                            setMenu("open", false)
                            copyLink()
                          }}
                        >
                          <Icon name="copy" size="small" class="text-icon-weak" />
                          <DropdownMenu.ItemLabel>{language.t("pr.menu.copy")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>

                        {/* CI status — shown when checks exist */}
                        <Show when={currentPr().checksState}>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            onSelect={() => {
                              setMenu("open", false)
                              viewCI()
                            }}
                          >
                            <Icon
                              name={ciIconName()}
                              size="small"
                              class={`${ciIconColor()}${ciIconSpin() ? " animate-spin" : ""}`}
                            />
                            <DropdownMenu.ItemLabel>{ciLabel()}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>

                        {/* Merge — only for open, non-draft PRs */}
                        <Show when={isOpen() && !currentPr().isDraft}>
                          <DropdownMenu.Separator />
                          <Tooltip value={tooltipText()} placement="left" gutter={8} disabled={!tooltipText()}>
                            <DropdownMenu.Item
                              disabled={!canMutate()}
                              onSelect={() => {
                                setMenu("open", false)
                                openMergeDialog()
                              }}
                            >
                              <Icon name="branch" size="small" class="text-icon-weak" />
                              <DropdownMenu.ItemLabel>{language.t("pr.menu.merge")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </Tooltip>
                        </Show>

                        {/* Address comments — only for open/draft PRs */}
                        <Show when={isOpen() || currentPr().isDraft}>
                          <DropdownMenu.Separator />
                          <Tooltip value={tooltipText()} placement="left" gutter={8} disabled={!tooltipText()}>
                            <DropdownMenu.Item
                              disabled={!canMutate() || currentPr().unresolvedCommentCount === 0}
                              onSelect={() => {
                                setMenu("open", false)
                                openAddressDialog()
                              }}
                            >
                              <Icon name="speech-bubble" size="small" class="text-icon-weak" />
                              <DropdownMenu.ItemLabel>{commentLabel()}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </Tooltip>
                        </Show>

                        {/* Status info for merged/closed */}
                        <Show when={isMerged() || isClosed()}>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item disabled>
                            <Icon
                              name={isMerged() ? "circle-check-fill" : "circle-x"}
                              size="small"
                              class={isMerged() ? "text-icon-info-base" : "text-icon-critical-base"}
                            />
                            <DropdownMenu.ItemLabel>
                              {isMerged() ? language.t("pr.menu.status.merged") : language.t("pr.menu.status.closed")}
                            </DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>

                        {/* Delete branch — only for merged PRs */}
                        <Show when={isMerged()}>
                          <DropdownMenu.Item
                            disabled={!canMutate()}
                            onSelect={() => {
                              setMenu("open", false)
                              handleDeleteBranch()
                            }}
                          >
                            <Icon name="trash" size="small" class="text-icon-weak" />
                            <DropdownMenu.ItemLabel>{language.t("pr.menu.delete_branch")}</DropdownMenu.ItemLabel>
                          </DropdownMenu.Item>
                        </Show>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
