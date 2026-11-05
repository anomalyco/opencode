import { useI18n } from "~/context/i18n"
import type { Key } from "~/i18n"
import "./signup.css"
import { action, useAction } from "@solidjs/router"
import { Resource } from "@opencode/console-resource"
import { createEffect, createSignal, createUniqueId, Match, on, onCleanup, Show, Switch, untrack } from "solid-js"
import { z } from "zod"
import { designCopy } from "./design-copy"
import { siteSettings } from "./settings"

/**
 * The home page's email sign-up. It adds the address to the same EmailOctopus list as the live
 * site's form (component/email-signup.tsx), from a server action, so the API key never reaches the
 * browser. Settings › Sign-up style picks one of three forms; all are real forms with an email
 * field, and without JavaScript they still post to the action.
 */

const listId = "8b9bb82c-9d5f-11f0-975f-0df6fd1e4945"

// The fields of EmailOctopus's contact that tell a new address from one already on the list.
const contact = z.object({
  status: z.enum(["pending", "subscribed", "unsubscribed"]),
  created_at: z.string(),
})

type Result = {
  status: "subscribed" | "confirm" | "already" | "invalid" | "error"
  // Set only in development without the EmailOctopus key: nothing was sent.
  dev?: boolean
}

const signup = action(async (form: FormData): Promise<Result> => {
  "use server"
  const email = String(form.get("email") ?? "").trim()
  if (!validEmail(email)) return { status: "invalid" }
  const key = apiKey()
  if (!key) return import.meta.env.DEV ? { status: "subscribed", dev: true } : { status: "error" }
  const response = await fetch(`https://api.emailoctopus.com/lists/${listId}/contacts`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email_address: email }),
  }).catch(() => undefined)
  if (!response?.ok) {
    console.error("EmailOctopus sign-up failed:", response?.status, await response?.text().catch(() => ""))
    return { status: "error" }
  }
  const saved = contact.safeParse(await response.json().catch(() => undefined))
  if (!saved.success) return { status: "subscribed" }
  // The call creates or updates, so a contact made more than a minute ago was already there.
  const existing = Date.now() - Date.parse(saved.data.created_at) > 60_000
  if (saved.data.status === "pending") return { status: "confirm" }
  if (saved.data.status === "unsubscribed") return { status: "error" }
  return { status: existing ? "already" : "subscribed" }
}, "site-signup")

// Outside development the Resource is always linked; in plain `vite dev` it throws.
function apiKey() {
  try {
    return Resource.EMAILOCTOPUS_API_KEY.value
  } catch {
    return undefined
  }
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)
}

const messages = {
  empty: "home.signup.empty",
  invalid: "home.signup.invalid",
  error: "home.signup.error",
  subscribed: "home.signup.subscribed",
  confirm: "home.signup.confirm",
  already: "home.signup.already",
} as const satisfies Record<string, Key>

// Shorter, to read on from the sentence.
const sentenceErrors = {
  empty: "home.signup.sentenceEmpty",
  invalid: "home.signup.sentenceInvalid",
  error: "home.signup.sentenceError",
} as const satisfies Record<string, Key>

type State =
  | { status: "idle" | "pending" }
  | { status: "empty" | "invalid" | "error"; email: string }
  | { status: "subscribed" | "confirm" | "already"; email: string; dev?: boolean }

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The form state every style shares: the typed address, validation and the submission. */
function createSignup() {
  const i18n = useI18n()
  const submit = useAction(signup)
  const [value, setValue] = createSignal("")
  const [state, setState] = createSignal<State>({ status: "idle" })
  const id = createUniqueId()
  let input: HTMLInputElement | undefined

  const done = () => ["subscribed", "confirm", "already"].includes(state().status)
  const problem = () => {
    const current = state()
    return current.status === "empty" || current.status === "invalid" || current.status === "error"
      ? current.status
      : undefined
  }
  const message = () => {
    const current = state()
    if (current.status === "idle" || current.status === "pending") return ""
    return i18n.t(messages[current.status])
  }

  return {
    id,
    value,
    state,
    done,
    problem,
    message,
    dev: () => {
      const current = state()
      return "dev" in current && !!current.dev
    },
    email: () => {
      const current = state()
      return "email" in current ? current.email : value().trim()
    },
    ref: (element: HTMLInputElement) => (input = element),
    focus: () => input?.focus(),
    input: (event: InputEvent & { currentTarget: HTMLInputElement }) => {
      setValue(event.currentTarget.value)
      if (problem()) setState({ status: "idle" })
    },
    submit: (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
      event.preventDefault()
      if (state().status === "pending" || done()) return
      const email = value().trim()
      if (!email) return setState({ status: "empty", email })
      if (!validEmail(email)) return setState({ status: "invalid", email })
      setState({ status: "pending" })
      const form = new FormData()
      form.set("email", email)
      submit(form).then(
        (result) => setState({ ...result, email }),
        () => setState({ status: "error", email }),
      )
    },
    reset: () => {
      setState({ status: "idle" })
      setValue("")
      // After the field is editable again.
      queueMicrotask(() => input?.focus())
    },
  }
}

type Signup = ReturnType<typeof createSignup>

export function SignupSection() {
  const i18n = useI18n()
  const title = () => designCopy("home.signup.title", i18n.t("home.signup.title"))
  const body = () => designCopy("home.signup.body", i18n.t("home.signup.body"))
  return (
    <section
      id="updates"
      data-component="block"
      data-section="signup"
      data-off={siteSettings.signupSection === "off" ? "" : undefined}
      data-design="signupStyle spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
      data-columns="2"
    >
      <h2 data-slot="label" data-design-copy="home.signup.title">
        {title()}
      </h2>
      <div data-slot="body">
        <p data-slot="lead" data-design-copy="home.signup.body">
          {body()}
        </p>
        <div data-component="signup" data-style={siteSettings.signupStyle}>
          <Switch>
            <Match when={siteSettings.signupStyle === "sentence"}>
              <SentenceForm signup={createSignup()} />
            </Match>
            <Match when={siteSettings.signupStyle === "input"}>
              <InputForm signup={createSignup()} />
            </Match>
            <Match when={siteSettings.signupStyle === "terminal"}>
              <TerminalForm signup={createSignup()} />
            </Match>
          </Switch>
        </div>
      </div>
    </section>
  )
}

/** The live site's form in this site's style: a field and a grey button. */
function InputForm(props: { signup: Signup }) {
  const i18n = useI18n()
  const s = props.signup
  return (
    <form data-slot="input-form" action={signup} method="post" novalidate onSubmit={s.submit}>
      <Show
        when={s.done()}
        fallback={
          <div data-slot="row">
            <label for={s.id} data-slot="sr-only">
              Email address
            </label>
            <input
              ref={s.ref}
              id={s.id}
              name="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              autocapitalize="off"
              spellcheck={false}
              enterkeyhint="send"
              placeholder={i18n.t("home.signup.placeholder")}
              required
              value={s.value()}
              onInput={s.input}
              aria-invalid={s.problem() ? "true" : undefined}
              aria-describedby={`${s.id}-message`}
            />
            <button
              type="submit"
              data-component="site-button"
              aria-disabled={s.state().status === "pending" ? "true" : "false"}
            >
              {s.state().status === "pending" ? i18n.t("home.signup.subscribing") : i18n.t("changelog.subscribe")}
            </button>
          </div>
        }
      >
        <div data-slot="row" data-done>
          <Check />
          <strong>{i18n.t(s.state().status === "already" ? messages.already : messages.subscribed)}</strong>
          <button type="button" data-slot="again" onClick={s.reset}>
            {i18n.t("home.signup.again")}
          </button>
        </div>
      </Show>
      <p id={`${s.id}-message`} data-slot="message" data-tone={s.problem() ? "error" : undefined} role="status">
        <Show when={s.done()} fallback={s.message()}>
          <span data-slot="sr-only">
            {i18n.t(s.state().status === "already" ? messages.already : messages.subscribed)}{" "}
          </span>
          {s.state().status === "confirm"
            ? i18n.t("home.signup.checkInbox", { email: s.email() })
            : i18n.t("home.signup.tellFirst", { email: s.email() })}
        </Show>
      </p>
      <DevNote signup={s} />
    </form>
  )
}

/**
 * A sentence with the address typed in place. The field is a real email input, as wide as what's
 * in it; Enter (or the button under the sentence) sends it, and the sentence rewrites itself.
 */
function SentenceForm(props: { signup: Signup }) {
  const i18n = useI18n()
  const s = props.signup
  // The words before the address: none while typing, then what happened.
  const verb = () => {
    const status = s.state().status
    if (status === "already") return i18n.t("home.signup.alreadyAt")
    if (status === "subscribed" || status === "confirm") return i18n.t("home.signup.onListAt")
    return ""
  }
  const ready = () => !s.done() && validEmail(s.value().trim())
  let swap: HTMLSpanElement | undefined
  // Text fields always match :focus-visible, so the ring follows where focus came from instead:
  // shown for the keyboard, not for a click or tap (the caret is enough there).
  const [ring, setRing] = createSignal(false)
  let pointer = false

  // The opening words change with a short cross-fade while its box eases to the new width.
  createEffect(
    on(
      verb,
      (next) => {
        if (!swap) return
        const from = swap.offsetWidth
        const old = [...swap.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
        const word = Object.assign(document.createElement("span"), { textContent: next })
        word.dataset.slot = "word"
        swap.append(word)
        old.forEach((element) => (element.dataset.leaving = ""))
        if (reduced()) return old.forEach((element) => element.remove())
        const to = word.offsetWidth
        const easing = "cubic-bezier(0.23, 1, 0.32, 1)"
        swap.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: 420, easing })
        old.forEach((element) =>
          element
            .animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-0.3em)", filter: "blur(3px)" }], {
              duration: 200,
              easing: "ease-out",
              fill: "forwards",
            })
            .finished.then(
              () => element.remove(),
              () => element.remove(),
            ),
        )
        word.animate(
          [
            { opacity: 0, transform: "translateY(0.3em)", filter: "blur(3px)" },
            { opacity: 1, transform: "none", filter: "none" },
          ],
          { duration: 380, delay: 80, easing, fill: "backwards" },
        )
      },
      { defer: true },
    ),
  )

  return (
    <form data-slot="sentence-form" action={signup} method="post" novalidate onSubmit={s.submit}>
      <p
        data-slot="sentence"
        data-state={s.state().status}
        onPointerDown={() => (pointer = true)}
        onClick={() => !s.done() && s.focus()}
      >
        {/* The words are swapped by hand (above), so the first render's text never updates. */}
        <span data-slot="swap" ref={swap}>
          <span data-slot="word">{untrack(verb)}</span>
        </span>
        <span data-slot="field" data-empty={s.value() ? undefined : ""} data-ring={ring() ? "" : undefined}>
          <span data-slot="mirror" aria-hidden="true">
            {s.value() || i18n.t("home.signup.placeholder")}
          </span>
          <input
            ref={s.ref}
            id={s.id}
            name="email"
            type="email"
            inputmode="email"
            autocomplete="email"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="send"
            placeholder={i18n.t("home.signup.placeholder")}
            required
            readonly={s.done() || s.state().status === "pending"}
            value={s.value()}
            onInput={s.input}
            aria-label={i18n.t("home.signup.label")}
            onFocus={() => {
              setRing(!pointer)
              pointer = false
            }}
            onBlur={() => setRing(false)}
            aria-invalid={s.problem() ? "true" : undefined}
            aria-describedby={`${s.id}-message`}
          />
        </span>
        {/* No full stop after the address, in any state; an error reads on its own line below. */}
        <Show when={s.problem()}>
          {(status) => (
            <>
              <span data-slot="error" aria-hidden="true">
                {i18n.t(sentenceErrors[status()])}
              </span>
            </>
          )}
        </Show>
      </p>
      <div data-slot="foot">
        <Show
          when={s.done()}
          fallback={
            // Shown once the address is valid; Enter submits either way.
            <button
              type="submit"
              data-component="site-button"
              data-visible={ready() ? "" : undefined}
              data-design-copy="home.signup.button"
              aria-hidden={ready() ? undefined : "true"}
              tabindex={ready() ? undefined : -1}
              aria-disabled={s.state().status === "pending" ? "true" : "false"}
            >
              {s.state().status === "pending"
                ? i18n.t("home.signup.sending")
                : designCopy("home.signup.button", i18n.t("home.signup.button"))}
            </button>
          }
        >
          <Show when={s.state().status === "confirm"}>
            <span data-slot="note">{i18n.t("home.signup.confirmNote")}</span>
          </Show>
          <button type="button" data-slot="again" onClick={s.reset}>
            {i18n.t("home.signup.again")}
          </button>
        </Show>
      </div>
      <p id={`${s.id}-message`} data-slot="sr-only" role="status">
        {s.message()}
      </p>
      <DevNote signup={s} />
    </form>
  )
}

/**
 * A prompt in a terminal block, like a CLI's interactive question: type the address and press
 * Enter, and the answer prints below. It asks a question rather than showing a command, so nobody
 * tries to run a command that doesn't exist.
 */
function TerminalForm(props: { signup: Signup }) {
  const i18n = useI18n()
  const s = props.signup
  const frames = ["◐", "◓", "◑", "◒"]
  const [frame, setFrame] = createSignal(0)
  createEffect(() => {
    if (s.state().status !== "pending" || reduced()) return
    const timer = setInterval(() => setFrame((index) => (index + 1) % frames.length), 120)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <form data-slot="terminal-form" action={signup} method="post" novalidate onSubmit={s.submit}>
      <div data-slot="window">
        <div data-slot="bar" aria-hidden="true">
          <span>early-access</span>
          <span>email</span>
        </div>
        <div data-slot="screen" onClick={() => !s.done() && s.focus()}>
          <div data-slot="line">
            <span data-slot="mark" data-tone={s.done() ? "ok" : s.problem() ? "error" : undefined} aria-hidden="true">
              {s.done() ? "✔" : s.problem() ? "▲" : "?"}
            </span>
            <label for={s.id}>{i18n.t("home.signup.label")}</label>
            <span data-slot="dim" aria-hidden="true">
              {s.done() ? "·" : "›"}
            </span>
            <span data-slot="field" data-empty={s.value() ? undefined : ""}>
              <span data-slot="mirror" aria-hidden="true">
                {s.value() || i18n.t("home.signup.placeholder")}
              </span>
              <span data-slot="caret" aria-hidden="true" />
              <input
                ref={s.ref}
                id={s.id}
                name="email"
                type="email"
                inputmode="email"
                autocomplete="email"
                autocapitalize="off"
                spellcheck={false}
                enterkeyhint="send"
                placeholder={i18n.t("home.signup.placeholder")}
                required
                readonly={s.done() || s.state().status === "pending"}
                value={s.value()}
                onInput={s.input}
                aria-invalid={s.problem() ? "true" : undefined}
                aria-describedby={`${s.id}-message`}
              />
            </span>
          </div>
          <div id={`${s.id}-message`} role="status" data-slot="output">
            <Switch>
              <Match when={s.state().status === "pending"}>
                <div data-slot="dim">
                  <span aria-hidden="true">{frames[frame()]}</span> {i18n.t("home.signup.subscribing")}
                </div>
              </Match>
              <Match when={s.problem()}>
                <div data-slot="branch" data-tone="error">
                  <span aria-hidden="true">└</span>
                  <span>{s.message()}</span>
                </div>
              </Match>
              <Match when={s.done()}>
                <div data-slot="dim" aria-hidden="true">
                  │
                </div>
                <div data-slot="branch">
                  <span data-slot="dim" aria-hidden="true">
                    └
                  </span>
                  <span>
                    {i18n.t(s.state().status === "already" ? messages.already : messages.subscribed)}
                    <Show when={s.state().status === "confirm"}>
                      <span data-slot="dim"> {i18n.t("home.signup.confirmNote")}</span>
                    </Show>
                  </span>
                </div>
              </Match>
            </Switch>
          </div>
          <Show
            when={s.done()}
            fallback={
              <div data-slot="hint">
                <button
                  type="submit"
                  data-slot="key"
                  aria-label={i18n.t("changelog.subscribe")}
                  aria-disabled={s.state().status === "pending" ? "true" : "false"}
                >
                  enter
                </button>{" "}
                <span aria-hidden="true">{i18n.t("home.signup.toSubscribe")}</span>
              </div>
            }
          >
            <div data-slot="hint">
              <button type="button" data-slot="key" onClick={s.reset}>
                {i18n.t("home.signup.againLower")}
              </button>
            </div>
          </Show>
        </div>
      </div>
      <DevNote signup={s} />
    </form>
  )
}

function DevNote(props: { signup: Signup }) {
  return (
    <Show when={props.signup.dev()}>
      <p data-slot="dev">Development: not sent. EMAILOCTOPUS_API_KEY isn't linked; run with `sst shell`.</p>
    </Show>
  )
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
    </svg>
  )
}
