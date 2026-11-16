import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { DialogBody, DialogFooter } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { createSignal, createUniqueId, Match, onMount, Show, Switch, type JSX } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import type definition from "./index"
import type { PromptAnswer, PromptSite, PromptView } from "./ipc"

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
}) {
  const ctx = usePlugin<typeof definition>()
  const title = createUniqueId()
  const description = createUniqueId()
  let box: HTMLDivElement | undefined
  const pageDialog = () => (props.view.ask.kind === "dialog" ? props.view.ask : undefined)
  const signIn = () => (props.view.ask.kind === "auth" ? props.view.ask : undefined)

  const cancel = () => {
    const ask = props.view.ask

    if (ask.kind === "dialog") return props.answer({ kind: "dialog", accept: false, text: "", stop: false })

    if (ask.kind === "leave") return props.answer({ kind: "leave", leave: false })
    props.answer({ kind: "dismiss" })
  }

  onMount(() => {
    if (!props.focus || !box) return
    const target = box.querySelector<HTMLElement>("[autofocus]") ?? box
    target.focus({ preventScroll: true })
  })

  // Tab and Shift+Tab cycle inside the dialog; the page behind it is a still.
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault()
      event.stopPropagation()

      return cancel()
    }

    // A click on the dialog's text focuses the dialog itself, where Enter answers as its main button does.
    if (event.key === "Enter" && !event.isComposing && event.target === box) {
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
      // The app's dialog, scoped to the page's box instead of the window; the scrim dims the page's still.
      style={{
        position: "absolute",
        "z-index": 20,
        padding: "16px",
        "pointer-events": "auto",
        "background-color": "var(--v2-overlay-simple-overlay-scrim)",
      }}
    >
      <div
        ref={box}
        data-slot="dialog-container"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title}
        aria-describedby={description}
        tabIndex={-1}
        style={{ width: "min(100%, 480px)", "max-height": "100%", outline: "none" }}
        onKeyDown={keyDown}
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
                {ctx.t("prompt.auth.realm")} <bdi class="text-v2-text-text-base">“{props.ask.realm}”</bdi>
              </p>
            </Show>
          </div>
          <TextInput
            appearance="large"
            class="!w-full self-stretch"
            value={username()}
            placeholder={ctx.t("prompt.auth.username")}
            aria-label={ctx.t("prompt.auth.username")}
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

/** Text a page wrote: plain, in the page's direction, bounded, scrolling inside its own box. */
function PageText(props: { id: string; children: string }) {
  return (
    <p
      id={props.id}
      dir="auto"
      tabIndex={0}
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
export function PromptBar(props: { view: PromptView; answer: (answer: PromptAnswer) => void; focus: boolean }) {
  const ctx = usePlugin<typeof definition>()
  let first: HTMLButtonElement | undefined

  onMount(() => {
    if (props.focus) first?.focus({ preventScroll: true })
  })

  const permission = () => (props.view.ask.kind === "permission" ? props.view.ask : undefined)
  const system = () => (props.view.ask.kind === "system" ? props.view.ask : undefined)

  return (
    <section
      data-component="browser-prompt"
      role={permission() ? "alertdialog" : "status"}
      aria-label={permission() ? ctx.t("prompt.permission.label") : undefined}
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-[0.5px] border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-2"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        props.answer({ kind: "dismiss" })
      }}
    >
      <Icon name={permission() ? "outline-globe" : "warning"} class="shrink-0 text-v2-icon-icon-muted" />
      <p class="min-w-0 flex-[1_1_200px] text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base [overflow-wrap:anywhere]">
        <Show
          when={permission()}
          fallback={<Show when={system()}>{(ask) => <>{ctx.t(`prompt.system.${ask().device}.${ask().platform}`)}</>}</Show>}
        >
          {(ask) => <>{permissionText(ctx, ask())}</>}
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
                size="small"
                variant="ghost"
                onClick={() => props.answer({ kind: "permission", allow: false, remember: ask().remember })}
              >
                {ctx.t(ask().remember ? "prompt.permission.never" : "prompt.permission.block")}
              </Button>
              <Button
                size="small"
                variant={ask().remember ? "neutral" : "contrast"}
                onClick={() => props.answer({ kind: "permission", allow: true, remember: false })}
              >
                {ctx.t("prompt.permission.once")}
              </Button>
              <Show when={ask().remember}>
                <Button size="small" variant="contrast" onClick={() => props.answer({ kind: "permission", allow: true, remember: true })}>
                  {ctx.t("prompt.permission.always")}
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

function siteSays(ctx: Plugin, site: PromptSite) {
  if (site.kind === "web") return ctx.t(site.embedded ? "prompt.site.embedded" : "prompt.site.web", { host: site.host })

  return ctx.t(site.kind === "file" ? "prompt.site.file" : "prompt.site.page")
}

function permissionText(ctx: Plugin, ask: Ask<"permission">) {
  // A page asks for one feature at a time, or for the camera and microphone together.
  const wants = ctx.t(
    ask.permissions.length > 1 ? "prompt.permission.camera-microphone" : `prompt.permission.${ask.permissions[0] ?? "camera"}`,
  )

  return ask.site.kind === "web"
    ? ctx.t("prompt.permission.web", { host: ask.site.host, features: wants })
    : ctx.t("prompt.permission.file", { features: wants })
}