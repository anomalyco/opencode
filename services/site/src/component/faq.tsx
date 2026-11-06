import { createEffect, createSignal, createUniqueId, on, ParentProps, Show } from "solid-js"

/**
 * A question that opens its answer, the site's one accordion row (the FAQs, the press boilerplate and
 * the phone feature list). Every answer is in the server's HTML: a closed one is `hidden="until-found"`,
 * so search engines and readers without JavaScript have it, and find-in-page opens it. `open` and
 * `onOpenChange` make it controlled, for "one open at a time"; `heading` puts the button in an h3, for
 * rows that are section headings. The answer animates its height (faq-open and faq-close in site.css,
 * from --kb-collapsible-content-height) and stays shown until the closing animation ends.
 */
export function Faq(
  props: ParentProps & {
    question: string
    open?: boolean
    onOpenChange?: (open: boolean) => void
    heading?: boolean
  },
) {
  const id = createUniqueId()
  const [own, setOwn] = createSignal(false)
  const open = () => props.open ?? own()
  const [closing, setClosing] = createSignal(false)
  let panel: HTMLDivElement | undefined

  const change = (next: boolean) => {
    if (props.open === undefined) setOwn(next)
    props.onOpenChange?.(next)
  }

  // The animations need the answer's height; a close keeps it shown until its animation ends (at
  // once when there is none, as with reduced motion).
  createEffect(
    on(
      open,
      (isOpen) => {
        if (!panel) return
        panel.style.setProperty("--kb-collapsible-content-height", `${panel.scrollHeight}px`)
        if (isOpen) return setClosing(false)
        setClosing(true)
        if (getComputedStyle(panel).animationName === "none") setClosing(false)
      },
      { defer: true },
    ),
  )

  const state = () => (open() ? { "data-expanded": "" } : { "data-closed": "" })
  const trigger = () => (
    <button
      type="button"
      id={`${id}-question`}
      data-slot="faq-question"
      aria-expanded={open() ? "true" : "false"}
      aria-controls={`${id}-answer`}
      onClick={() => change(!open())}
      {...state()}
    >
      <svg
        data-slot="faq-icon-plus"
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M12.5 11.5H19V12.5H12.5V19H11.5V12.5H5V11.5H11.5V5H12.5V11.5Z" fill="currentColor" />
      </svg>
      <svg
        data-slot="faq-icon-minus"
        aria-hidden="true"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M5 11.5H19V12.5H5Z" fill="currentColor" />
      </svg>
      <div data-slot="faq-question-text">{props.question}</div>
    </button>
  )
  return (
    <div data-slot="faq-item" {...state()}>
      <Show when={props.heading} fallback={trigger()}>
        <h3 data-slot="faq-heading">{trigger()}</h3>
      </Show>
      <div
        ref={panel}
        id={`${id}-answer`}
        role="region"
        aria-labelledby={`${id}-question`}
        data-slot="faq-answer"
        // An attribute, so the server writes "until-found" (the hidden property would make it plain hidden).
        {...({ "attr:hidden": open() || closing() ? undefined : "until-found" } as object)}
        on:beforematch={() => change(true)}
        onAnimationEnd={() => !open() && setClosing(false)}
        {...state()}
      >
        <div data-slot="faq-answer-inner">{props.children}</div>
      </div>
    </div>
  )
}
