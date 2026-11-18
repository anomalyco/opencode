import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { DialogBody, DialogFooter } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { ownKeyboard } from "@opencode/ui/hooks"
import { IconButton } from "@opencode/ui/icon-button"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, createUniqueId, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { guardActivation } from "./activation-delay"
import { promptKeyOwner } from "./prompt-keys"
import type definition from "./index"
import { PROMPT_TEXT_MAX, SIGN_IN_TEXT_MAX, type PromptAnswer, type PromptSite, type PromptView } from "./ipc"

type Ask<Kind extends PromptView["ask"]["kind"]> = Extract<PromptView["ask"], { kind: Kind }>

/** Whether the prompt blocks its page, so it shows as a dialog over the page's still rather than a bar above it. */
export function blocking(view: PromptView | undefined) {
  return view?.ask.kind === "dialog" || view?.ask.kind === "leave" || view?.ask.kind === "auth"
}

/**
 * What blocks a tab's page, as the app's own dialog, over a dimmed still of the page and inside its box only: the
 * chat, the strip and the address field stay usable, and another tab shows its own page. The page's text is shown as
 * text under a title that names the asking site, so it cannot pass for the app's own words. Focus stays inside
 * while it is open; Escape answers as the page's cancel does.
 */
export function PromptDialog(props: {
  view: PromptView
  answer: (answer: PromptAnswer) => void
  /** Whether to take keyboard focus as it opens; false while the user works elsewhere in the window. */
  focus: boolean
  /** Moves the keyboard out to the pane's address field, with the dialog left open. */
  leave: () => void
  /** While true nothing in the dialog answers: an agent's show request has just put its tab in front of the person. */
  held?: boolean
}) {
  const ctx = usePlugin<typeof definition>()
  const title = createUniqueId()
  const description = createUniqueId()
  let box: HTMLDivElement | undefined
  // Where the keyboard last was inside the dialog, which a click on the dimmed page returns it to.
  let last: HTMLElement | undefined
  // A page can open a dialog under a click or key press already in flight: its default answer waits for a new one,
  // from each dialog it shows on and each time the page asks again.
  let guard: ReturnType<typeof guardActivation> | undefined
  createKeyed(
    () => `${props.view.id}:${props.view.asked}`,
    () => guard?.changed(),
  )
  // Where the keyboard was in the window, which gets it back once the dialog ends; a page that had it gets it back from
  // main instead (`page`), and focus the window left behind earlier is not where the user was.
  const before = !props.view.page && document.hasFocus() ? document.activeElement : null
  const previous = before instanceof HTMLElement && before !== document.body && !before.closest("[data-browser-prompt]") ? before : undefined
  const pageDialog = () => (props.view.ask.kind === "dialog" ? props.view.ask : undefined)
  const signIn = () => (props.view.ask.kind === "auth" ? props.view.ask : undefined)

  // Only text that is there describes the dialog: an empty alert has none.
  const described = () => {
    const ask = props.view.ask

    if (ask.kind === "dialog") return !!ask.message

    if (ask.kind === "auth") return ask.failed || !!ask.realm

    return true
  }

  const cancel = () => {
    const ask = props.view.ask

    if (ask.kind === "dialog") return props.answer({ kind: "dialog", accept: false, text: "", stop: false })

    if (ask.kind === "leave") return props.answer({ kind: "leave", leave: false })
    props.answer({ kind: "dismiss" })
  }

  onMount(() => {
    if (!box) return
    guard = guardActivation(box, () => !!props.held)
    onCleanup(guard.dispose)
    // The command layer and the native menu run no shortcut while the keyboard is here.
    onCleanup(ownKeyboard(box))
    // A listener on the dialog itself, not Solid's on the document, so the dialog's keys stop here.
    const root = box
    root.addEventListener("keydown", keyDown)
    onCleanup(() => root.removeEventListener("keydown", keyDown))
    onCleanup(() => {
      const active = document.activeElement

      // Only while the keyboard is still on the dialog or nowhere: the user may have moved it on.
      if (previous?.isConnected && (!active || active === document.body || box?.contains(active)))
        previous.focus({ preventScroll: true })
    })

    if (!props.focus) return
    const target = box.querySelector<HTMLElement>("[autofocus]") ?? box
    target.focus({ preventScroll: true })
  })

  // The dialog's keys are its own (prompt-keys.ts): the command layer and the native menu run no shortcut while the
  // keyboard is inside it (`ownKeyboard`), no other handler of the window sees them, and what the window would do
  // behind it, as its own reload or zoom, is cancelled. Tab and Shift+Tab cycle inside the dialog; the page behind it is
  // a still.
  const keyDown = (event: KeyboardEvent) => {
    const text =
      event.target instanceof HTMLInputElement && (event.target.type === "text" || event.target.type === "password")

    const owner = promptKeyOwner(event, { inside: true, mac, text })

    if (owner !== "window") event.stopPropagation()

    if (owner === "swallowed") return event.preventDefault()

    if (owner === "exit") {
      event.preventDefault()

      return props.leave()
    }

    if (cancelKey(event)) {
      event.preventDefault()
      event.stopPropagation()

      return cancel()
    }

    // A click on the dialog's text focuses the dialog, or the page's text, where Enter answers as the main button does.
    const pageText = event.target instanceof HTMLElement && event.target.dataset.pageText !== undefined

    if (event.key === "Enter" && !composing(event) && box && (event.target === box || pageText)) {
      event.preventDefault()

      return box.querySelector("form")?.requestSubmit()
    }

    if (event.key !== "Tab" || !box) return

    const focusable = Array.from(
      box.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']"),
    ).filter((element) => element.getClientRects().length > 0)

    const first = focusable[0]
    const last = focusable.at(-1)

    if (!first || !last) return event.preventDefault()

    if (event.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    }

    if (!event.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      data-component="dialog-v2"
      data-fit
      data-browser-prompt={props.view.ask.kind}
      // Typing here never moves to the chat composer, and Escape here is the dialog's.
      data-prevent-autofocus
      // The app's dialog, scoped to the page's box instead of the window; the scrim dims the page's still.
      style={{
        position: "absolute",
        "z-index": 20,
        padding: "16px",
        "pointer-events": "auto",
        "background-color": "var(--v2-overlay-simple-overlay-scrim)",
      }}
      // The dimmed page is the dialog's: a click there keeps the keyboard in the dialog, or brings it back, rather than
      // giving it to the pane behind. The strip, the address field and the chat stay the user's to click.
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || !box) return
        event.preventDefault()

        if (box.contains(document.activeElement)) return

        const target =
          last?.isConnected && box.contains(last) ? last : (box.querySelector<HTMLElement>("[autofocus]") ?? box)

        target.focus({ preventScroll: true })
      }}
    >
      <div
        ref={box}
        data-slot="dialog-container"
        role="alertdialog"
        aria-modal="true"
        onFocusIn={(event) => {
          if (event.target instanceof HTMLElement) last = event.target
        }}
        aria-labelledby={title}
        aria-describedby={described() ? description : undefined}
        tabIndex={-1}
        style={{ width: "min(100%, 480px)", "max-height": "100%", outline: "none" }}
      >
        <Switch>
          <Match when={pageDialog()}>
            {(ask) => (
              <PageDialog ask={ask()} view={props.view} title={title} description={description} answer={props.answer} />
            )}
          </Match>
          <Match when={props.view.ask.kind === "leave"}>
            <Frame
              title={title}
              description={description}
              heading={ctx.t("prompt.leave.title")}
              detail={ctx.t("prompt.leave.description")}
              waiting={props.view.waiting}
              submit={() => props.answer({ kind: "leave", leave: true })}
              actions={
                <>
                  <Button variant="ghost" onClick={() => props.answer({ kind: "leave", leave: false })}>
                    {ctx.t("prompt.leave.stay")}
                  </Button>
                  <Button type="submit" variant="contrast" autofocus>
                    {ctx.t("prompt.leave.leave")}
                  </Button>
                </>
              }
            />
          </Match>
          <Match when={signIn()}>
            {(ask) => <SignIn ask={ask()} view={props.view} title={title} description={description} answer={props.answer} />}
          </Match>
        </Switch>
      </div>
    </div>
  )
}

/** A page's `alert`, `confirm` or `prompt`. */
function PageDialog(props: {
  ask: Ask<"dialog">
  view: PromptView
  title: string
  description: string
  answer: (answer: PromptAnswer) => void
}) {
  const ctx = usePlugin<typeof definition>()
  const [text, setText] = createSignal(props.ask.value)
  const [stop, setStop] = createSignal(false)

  const reply = (accept: boolean) =>
    props.answer({ kind: "dialog", accept, text: accept && props.ask.dialog === "prompt" ? text() : "", stop: stop() })

  return (
    <Frame
      title={props.title}
      description={props.description}
      heading={siteSays(ctx, props.ask.site)}
      waiting={props.view.waiting}
      submit={() => reply(true)}
      body={
        <>
          <Show when={props.ask.message}>
            <PageText id={props.description}>{props.ask.message}</PageText>
          </Show>
          <Show when={props.ask.dialog === "prompt"}>
            <TextInput
              appearance="large"
              class="!w-full self-stretch"
              value={text()}
              aria-label={ctx.t("prompt.value")}
              maxLength={PROMPT_TEXT_MAX}
              autofocus
              autocomplete="off"
              spellcheck={false}
              onFocus={(event) => event.currentTarget.select()}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          </Show>
        </>
      }
      start={
        <Show when={props.ask.stop}>
          <Checkbox appearance="compact" checked={stop()} onChange={setStop}>
            {ctx.t("prompt.stop")}
          </Checkbox>
        </Show>
      }
      actions={
        <>
          <Show when={props.ask.dialog !== "alert"}>
            <Button variant="ghost" onClick={() => reply(false)}>
              {ctx.t("prompt.cancel")}
            </Button>
          </Show>
          <Button type="submit" variant="contrast" autofocus={props.ask.dialog !== "prompt"}>
            {ctx.t("prompt.ok")}
          </Button>
        </>
      }
    />
  )
}

/** A site's HTTP sign-in. The user name and password live in this form only until it is sent or closed. */
function SignIn(props: {
  ask: Ask<"auth">
  view: PromptView
  title: string
  description: string
  answer: (answer: PromptAnswer) => void
}) {
  const ctx = usePlugin<typeof definition>()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")

  return (
    <Frame
      title={props.title}
      description={props.description}
      heading={ctx.t("prompt.auth.title", { host: props.ask.host })}
      waiting={props.view.waiting}
      submit={() => {
        const answer = { kind: "auth" as const, username: username(), password: password() }
        setUsername("")
        setPassword("")
        props.answer(answer)
      }}
      body={
        <>
          <div id={props.description} class="flex flex-col gap-1">
            <Show when={props.ask.failed}>
              <p role="alert" class="text-[13px] font-[440] leading-[20px] text-v2-state-fg-danger">
                {ctx.t("prompt.auth.failed")}
              </p>
            </Show>
            <Show when={props.ask.realm}>
              <p class="text-[13px] font-[440] leading-[20px] text-v2-text-text-muted [overflow-wrap:anywhere]">
                {/* First-strong isolates keep a right-to-left realm from reordering the sentence around it. */}
                {ctx.t("prompt.auth.realm", { realm: `\u2068${props.ask.realm}\u2069` })}
              </p>
            </Show>
          </div>
          <TextInput
            appearance="large"
            class="!w-full self-stretch"
            value={username()}
            placeholder={ctx.t("prompt.auth.username")}
            aria-label={ctx.t("prompt.auth.username")}
            maxLength={SIGN_IN_TEXT_MAX}
            autofocus
            autocomplete="off"
            spellcheck={false}
            onInput={(event) => setUsername(event.currentTarget.value)}
          />
          <TextInput
            type="password"
            appearance="large"
            class="!w-full self-stretch"
            value={password()}
            placeholder={ctx.t("prompt.auth.password")}
            aria-label={ctx.t("prompt.auth.password")}
            maxLength={SIGN_IN_TEXT_MAX}
            autocomplete="off"
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => props.answer({ kind: "dismiss" })}>
            {ctx.t("prompt.cancel")}
          </Button>
          <Button type="submit" variant="contrast">
            {ctx.t("prompt.auth.submit")}
          </Button>
        </>
      }
    />
  )
}

/** The app dialog's header, body and footer; Enter submits, as in the app's own prompt dialog. */
function Frame(props: {
  title: string
  description: string
  heading: string
  detail?: string
  waiting: number
  body?: JSX.Element
  start?: JSX.Element
  actions: JSX.Element
  submit: () => void
}) {
  const ctx = usePlugin<typeof definition>()

  return (
    <form
      data-slot="dialog-content"
      onSubmit={(event) => {
        event.preventDefault()
        props.submit()
      }}
    >
      <div data-slot="dialog-header" data-hide-close>
        <div data-slot="dialog-title-group">
          <h2 id={props.title} data-slot="dialog-title" class="max-w-full [overflow-wrap:anywhere]" dir="auto">
            {props.heading}
          </h2>
          <Show when={props.detail}>
            <p id={props.description} data-slot="dialog-description">
              {props.detail}
            </p>
          </Show>
        </div>
      </div>
      <Show when={props.body}>
        <DialogBody class="gap-3 px-4">{props.body}</DialogBody>
      </Show>
      <DialogFooter>
        <div class="me-auto flex min-h-8 min-w-0 items-center gap-3">
          {props.start}
          <Show when={props.waiting > 0}>
            <span class="text-[13px] font-[440] leading-[20px] text-v2-text-text-muted">
              {ctx.plural("prompt.waiting", props.waiting)}
            </span>
          </Show>
        </div>
        {props.actions}
      </DialogFooter>
    </form>
  )
}

/**
 * Text a page wrote: plain, in the page's direction, bounded, scrolling inside its own box, which keyboard users can
 * focus to scroll; Enter there answers as the dialog's main button does.
 */
function PageText(props: { id: string; children: string }) {
  return (
    <p
      id={props.id}
      dir="auto"
      tabIndex={0}
      data-scrollable
      data-page-text
      class="max-h-[160px] overflow-y-auto whitespace-pre-wrap text-[13px] font-[440] leading-[20px] text-v2-text-text-base outline-none [overflow-wrap:anywhere] [unicode-bidi:plaintext]"
    >
      {props.children}
    </p>
  )
}

/**
 * A site's permission request, above its page: the page keeps working while the user reads on. One at a time, with
 * the count of the rest; Escape or the close button answers "not now", which keeps nothing.
 */
export function PromptBar(props: {
  view: PromptView
  answer: (answer: PromptAnswer) => void
  focus: boolean
  /** While true nothing in the bar answers: an agent's show request has just put its tab in front of the person. */
  held?: boolean
}) {
  const ctx = usePlugin<typeof definition>()
  const text = createUniqueId()
  let first: HTMLButtonElement | undefined
  let bar: HTMLElement | undefined
  // The bar appears where the page was: a click or key press already in flight, or a page's double-click target, must
  // not land on its answers, for each request it shows and each time the page asks again.
  let guard: ReturnType<typeof guardActivation> | undefined
  createKeyed(
    () => `${props.view.id}:${props.view.asked}`,
    () => guard?.changed(),
  )

  onMount(() => {
    if (props.focus) first?.focus({ preventScroll: true })

    if (!bar) return
    guard = guardActivation(bar, () => !!props.held)
    onCleanup(guard.dispose)
  })

  const permission = () => (props.view.ask.kind === "permission" ? props.view.ask : undefined)
  const system = () => (props.view.ask.kind === "system" ? props.view.ask : undefined)

  return (
    <section
      ref={bar}
      data-component="browser-prompt"
      // Not modal: the app's shortcuts work here; only Escape, which dismisses the bar, is the bar's alone.
      data-prevent-autofocus
      role={permission() ? "alertdialog" : "status"}
      aria-label={permission() ? ctx.t("prompt.permission.label") : undefined}
      aria-describedby={text}
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2"
      onKeyDown={(event) => {
        if (!cancelKey(event)) return
        event.preventDefault()
        event.stopPropagation()
        props.answer({ kind: "dismiss" })
      }}
    >
      <Icon name={permission() ? "outline-globe" : "warning"} class="shrink-0 text-v2-icon-icon-muted" />
      <p id={text} class="min-w-0 flex-[1_1_200px] text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base [overflow-wrap:anywhere]">
        <Show
          when={permission()}
          fallback={<Show when={system()}>{(ask) => <>{ctx.t(`prompt.system.${ask().device}.${ask().platform}`)}</>}</Show>}
        >
          {(ask) => (
            <>
              {permissionText(ctx, ask())}
              <Show when={ask().agent}>
                <span class="ms-1 font-[530]">{ctx.t("prompt.permission.agent")}</span>
              </Show>
              <Show when={ask().system}>
                <span class="ms-1">{ctx.t("prompt.permission.system")}</span>
              </Show>
            </>
          )}
        </Show>
        <Show when={props.view.waiting > 0}>
          <span class="ms-2 text-v2-text-text-muted">{ctx.plural("prompt.waiting", props.view.waiting)}</span>
        </Show>
      </p>
      <div class="ms-auto flex shrink-0 items-center gap-1">
        <Show when={permission()}>
          {(ask) => (
            <>
              <Button
                ref={first}
                data-activation-guard
                size="small"
                variant="ghost"
                onClick={() => props.answer({ kind: "permission", allow: false, remember: ask().remember !== "none" })}
              >
                {ctx.t(ask().remember === "kept" ? "prompt.permission.never" : "prompt.permission.block")}
              </Button>
              <Button
                data-activation-guard
                size="small"
                variant={ask().remember !== "none" ? "neutral" : "contrast"}
                onClick={() => props.answer({ kind: "permission", allow: true, remember: false })}
              >
                {ctx.t("prompt.permission.once")}
              </Button>
              <Show when={ask().remember !== "none"}>
                <Button
                  data-activation-guard
                  size="small"
                  variant="contrast"
                  onClick={() => props.answer({ kind: "permission", allow: true, remember: true })}
                >
                  {ctx.t(ask().remember === "kept" ? "prompt.permission.always" : "prompt.permission.session")}
                </Button>
              </Show>
            </>
          )}
        </Show>
        <Tooltip placement="top" value={ctx.t("prompt.dismiss")}>
          <IconButton
            variant="ghost-muted"
            size="large"
            icon={<Icon name="close" />}
            aria-label={ctx.t("prompt.dismiss")}
            onClick={() => props.answer({ kind: "dismiss" })}
          />
        </Tooltip>
      </div>
    </section>
  )
}

type Plugin = ReturnType<typeof usePlugin<typeof definition>>

// Chromium reports the key that ends an IME composition with keyCode 229 once isComposing is already false.
const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229

const cancelKey = (event: KeyboardEvent) => !composing(event) && event.key === "Escape"

const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)

function siteSays(ctx: Plugin, site: PromptSite) {
  if (site.kind === "web") return ctx.t(site.embedded ? "prompt.site.embedded" : "prompt.site.web", { host: site.host })

  if (site.kind === "page") return ctx.t(site.embedded ? "prompt.site.embedded.page" : "prompt.site.page")

  return ctx.t("prompt.site.file")
}

function permissionText(ctx: Plugin, ask: Ask<"permission">) {
  // A page asks for one feature at a time, or for the camera and microphone together; each is a whole sentence.
  const feature = ask.permissions.length > 1 ? "camera-microphone" : (ask.permissions[0] ?? "camera")

  return ask.site.kind === "web"
    ? ctx.t(`prompt.permission.web.${feature}`, { host: ask.site.host })
    : ctx.t(`prompt.permission.file.${feature}`)
}
