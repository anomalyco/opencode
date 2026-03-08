import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Dialog } from "@opencode-ai/ui/dialog"
import { prefersReducedMotion } from "@opencode-ai/ui/hooks"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { animate, type AnimationPlaybackControls, clearFadeStyles, FAST_SPRING } from "@opencode-ai/ui/motion"
import { showToast } from "@opencode-ai/ui/toast"
import { errorMessage } from "@/pages/layout/helpers"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function SessionTimelineHeader(props: {
  centered: boolean
  showHeader: () => boolean
  sessionKey: () => string
  sessionID: () => string | undefined
  parentID: () => string | undefined
  titleValue: () => string | undefined
  headerTitle: () => string | undefined
  placeholderTitle: () => boolean
}) {
  const navigate = useNavigate()
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const reduce = prefersReducedMotion

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    saving: false,
    menuOpen: false,
    pendingRename: false,
  })
  const [headerText, setHeaderText] = createStore({
    session: props.sessionKey(),
    value: props.headerTitle(),
    prev: undefined as string | undefined,
    muted: props.placeholderTitle(),
    prevMuted: false,
  })
  let headerAnim: AnimationPlaybackControls | undefined
  let enterAnim: AnimationPlaybackControls | undefined
  let leaveAnim: AnimationPlaybackControls | undefined
  let titleRef: HTMLInputElement | undefined
  let headerRef: HTMLDivElement | undefined
  let enterRef: HTMLSpanElement | undefined
  let leaveRef: HTMLSpanElement | undefined

  const clearHeaderAnim = () => {
    headerAnim?.stop()
    headerAnim = undefined
  }

  const animateHeader = () => {
    const el = headerRef
    if (!el) return

    clearHeaderAnim()
    if (!headerText.muted || reduce()) {
      el.style.opacity = "1"
      return
    }

    headerAnim = animate(el, { opacity: [0, 1] }, { type: "spring", visualDuration: 1.0, bounce: 0 })
    headerAnim.finished.then(() => {
      if (headerRef !== el) return
      clearFadeStyles(el)
    })
  }

  const clearTitleAnims = () => {
    enterAnim?.stop()
    enterAnim = undefined
    leaveAnim?.stop()
    leaveAnim = undefined
  }

  const settleTitleEnter = () => {
    if (enterRef) clearFadeStyles(enterRef)
  }

  const hideLeave = () => {
    if (!leaveRef) return
    leaveRef.style.opacity = "0"
    leaveRef.style.filter = ""
    leaveRef.style.transform = ""
  }

  const animateEnterSpan = () => {
    if (!enterRef) return
    if (reduce()) {
      settleTitleEnter()
      return
    }
    enterAnim = animate(
      enterRef,
      { opacity: [0, 1], filter: ["blur(2px)", "blur(0px)"], transform: ["translateY(-2px)", "translateY(0)"] },
      FAST_SPRING,
    )
    enterAnim.finished.then(() => settleTitleEnter())
  }

  const crossfadeTitle = (nextTitle: string, nextMuted: boolean) => {
    clearTitleAnims()
    setHeaderText({ prev: headerText.value, prevMuted: headerText.muted })
    setHeaderText({ value: nextTitle, muted: nextMuted })

    if (reduce()) {
      setHeaderText({ prev: undefined, prevMuted: false })
      hideLeave()
      settleTitleEnter()
      return
    }

    if (leaveRef) {
      leaveAnim = animate(
        leaveRef,
        { opacity: [1, 0], filter: ["blur(0px)", "blur(2px)"], transform: ["translateY(0)", "translateY(2px)"] },
        FAST_SPRING,
      )
      leaveAnim.finished.then(() => {
        setHeaderText({ prev: undefined, prevMuted: false })
        hideLeave()
      })
    }

    animateEnterSpan()
  }

  const fadeInTitle = (nextTitle: string, nextMuted: boolean) => {
    clearTitleAnims()
    setHeaderText({ value: nextTitle, muted: nextMuted, prev: undefined, prevMuted: false })
    animateEnterSpan()
  }

  const snapTitle = (nextTitle: string | undefined, nextMuted: boolean) => {
    clearTitleAnims()
    setHeaderText({ value: nextTitle, muted: nextMuted, prev: undefined, prevMuted: false })
    settleTitleEnter()
  }

  createEffect(
    on(props.showHeader, (show, prev) => {
      if (!show) {
        clearHeaderAnim()
        return
      }
      if (show === prev) return
      animateHeader()
    }),
  )

  createEffect(
    on(
      () => [props.sessionKey(), props.headerTitle(), props.placeholderTitle()] as const,
      ([nextSession, nextTitle, nextMuted]) => {
        if (nextSession !== headerText.session) {
          setHeaderText("session", nextSession)
          if (nextTitle && nextMuted) {
            fadeInTitle(nextTitle, nextMuted)
            return
          }
          snapTitle(nextTitle, nextMuted)
          return
        }
        if (nextTitle === headerText.value && nextMuted === headerText.muted) return
        if (!nextTitle) {
          snapTitle(undefined, false)
          return
        }
        if (!headerText.value) {
          fadeInTitle(nextTitle, nextMuted)
          return
        }
        if (title.saving || title.editing) {
          snapTitle(nextTitle, nextMuted)
          return
        }
        crossfadeTitle(nextTitle, nextMuted)
      },
    ),
  )

  onCleanup(() => {
    clearHeaderAnim()
    clearTitleAnims()
  })

  const toastError = (err: unknown) => errorMessage(err, language.t("common.requestFailed"))

  createEffect(
    on(
      props.sessionKey,
      () => setTitle({ draft: "", editing: false, saving: false, menuOpen: false, pendingRename: false }),
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!props.sessionID()) return
    setTitle({ editing: true, draft: props.titleValue() ?? "" })
    requestAnimationFrame(() => {
      titleRef?.focus()
      titleRef?.select()
    })
  }

  const closeTitleEditor = () => {
    if (title.saving) return
    setTitle({ editing: false, saving: false })
  }

  const saveTitleEditor = async () => {
    const id = props.sessionID()
    if (!id) return
    if (title.saving) return

    const next = title.draft.trim()
    if (!next || next === (props.titleValue() ?? "")) {
      setTitle({ editing: false, saving: false })
      return
    }

    setTitle("saving", true)
    await sdk.client.session
      .update({ sessionID: id, title: next })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((session) => session.id === id)
            if (index !== -1) draft.session[index].title = next
          }),
        )
        setTitle({ editing: false, saving: false })
      })
      .catch((err) => {
        setTitle("saving", false)
        showToast({
          title: language.t("common.requestFailed"),
          description: toastError(err),
        })
      })
  }

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    if (parentID) {
      navigate(`/${params.dir}/session/${parentID}`)
      return
    }
    if (nextSessionID) {
      navigate(`/${params.dir}/session/${nextSessionID}`)
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const archiveSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((item) => item.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((item) => item.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: toastError(err),
        })
      })
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((item) => !item.parentID && !item.time?.archived)
    const index = sessions.findIndex((item) => item.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: toastError(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])
        const byParent = new Map<string, string[]>()

        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue

          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((item) => !removed.has(item.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  const navigateParent = () => {
    const id = props.parentID()
    if (!id) return
    navigate(`/${params.dir}/session/${id}`)
  }

  function DialogDeleteSession(input: { sessionID: string }) {
    const name = createMemo(() => sync.session.get(input.sessionID)?.title ?? language.t("command.session.new"))

    const handleDelete = async () => {
      await deleteSession(input.sessionID)
      dialog.close()
    }

    return (
      <Dialog title={language.t("session.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              {language.t("session.delete.confirm", { name: name() })}
            </span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              {language.t("session.delete.button")}
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  return (
    <Show when={props.showHeader()}>
      <div
        data-session-title
        ref={(el) => {
          headerRef = el
          el.style.opacity = "0"
        }}
        class="pointer-events-none absolute inset-x-0 top-0 z-30"
      >
        <div
          classList={{
            "bg-[linear-gradient(to_bottom,var(--background-stronger)_38px,transparent)]": true,
            "w-full": true,
            "pb-10": true,
            "px-4 md:px-5": true,
            "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
          }}
        >
          <div class="pointer-events-auto h-12 w-full flex items-center justify-between gap-2">
            <div class="flex items-center gap-1 min-w-0 flex-1">
              <Show when={props.parentID()}>
                <div>
                  <IconButton
                    tabIndex={-1}
                    icon="arrow-left"
                    variant="ghost"
                    onClick={navigateParent}
                    aria-label={language.t("common.goBack")}
                  />
                </div>
              </Show>
              <Show when={!!headerText.value || title.editing}>
                <Show
                  when={title.editing}
                  fallback={
                    <h1 class="text-14-medium text-text-strong grow-1 min-w-0" onDblClick={openTitleEditor}>
                      <span class="grid min-w-0" style={{ overflow: "clip" }}>
                        <span ref={enterRef} class="col-start-1 row-start-1 min-w-0 truncate">
                          <span classList={{ "opacity-60": headerText.muted }}>{headerText.value}</span>
                        </span>
                        <span
                          ref={leaveRef}
                          class="col-start-1 row-start-1 min-w-0 truncate pointer-events-none"
                          style={{ opacity: "0" }}
                        >
                          <span classList={{ "opacity-60": headerText.prevMuted }}>{headerText.prev}</span>
                        </span>
                      </span>
                    </h1>
                  }
                >
                  <InlineInput
                    ref={(el) => {
                      titleRef = el
                    }}
                    value={title.draft}
                    disabled={title.saving}
                    class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px]"
                    style={{ "--inline-input-shadow": "var(--shadow-xs-border-select)" }}
                    onInput={(event) => setTitle("draft", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === "Enter") {
                        event.preventDefault()
                        void saveTitleEditor()
                        return
                      }
                      if (event.key === "Escape") {
                        event.preventDefault()
                        closeTitleEditor()
                      }
                    }}
                    onBlur={closeTitleEditor}
                  />
                </Show>
              </Show>
            </div>
            <Show when={props.sessionID()}>
              {(id) => (
                <div class="shrink-0 flex items-center gap-3">
                  <SessionContextUsage placement="bottom" />
                  <DropdownMenu
                    gutter={4}
                    placement="bottom-end"
                    open={title.menuOpen}
                    onOpenChange={(open) => setTitle("menuOpen", open)}
                  >
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                      aria-label={language.t("common.moreOptions")}
                    />
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        style={{ "min-width": "104px" }}
                        onCloseAutoFocus={(event) => {
                          if (!title.pendingRename) return
                          event.preventDefault()
                          setTitle("pendingRename", false)
                          openTitleEditor()
                        }}
                      >
                        <DropdownMenu.Item
                          onSelect={() => {
                            setTitle("pendingRename", true)
                            setTitle("menuOpen", false)
                          }}
                        >
                          <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => void archiveSession(id())}>
                          <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item onSelect={() => dialog.show(() => <DialogDeleteSession sessionID={id()} />)}>
                          <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
