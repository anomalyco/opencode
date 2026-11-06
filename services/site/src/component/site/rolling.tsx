import "@kitlangton/rolling-number/styles.css"
import { RollingNumber, RollingText } from "@kitlangton/rolling-number/solid"
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js"

// The home page's rolling-number variants (Settings › Hero text and Stats). The page loads this
// module only when one of them is picked, so the default page leaves the library out.

// Letters and digits roll through a wheel; other glyphs crossfade in place.
const heroCharset = " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"

/**
 * The hero title shuffled in with rolling-number: it starts as blank slots of the same length and
 * rolls (or flaps) into the title once the page is on screen. Words are separate hosts so the
 * title still wraps between them.
 */
export function HeroTitle(props: { text: string; mode: "roll" | "flap" }) {
  const [shown, setShown] = createSignal(false)
  onMount(() => requestAnimationFrame(() => setShown(true)))
  const words = () => props.text.split(" ")
  return (
    <h1 aria-label={props.text} data-design-copy="home.hero.title" data-rolling={props.mode}>
      <For each={words()}>
        {(word, index) => (
          <>
            {index() > 0 ? " " : ""}
            <RollingText
              aria-hidden="true"
              text={shown() ? word : " ".repeat(word.length)}
              mode={props.mode}
              charset={heroCharset}
              stagger="start"
              duration={1400}
              motionBlur
            />
          </>
        )}
      </For>
    </h1>
  )
}

/**
 * A stat like "205K" or "1K+": the number rolls up from zero with rolling-number when the stats
 * come into view, and the suffix sits after it.
 */
export function RollingStat(props: { value: string; visible: boolean }) {
  const parts = () => /^([\d.,]+)(.*)$/.exec(props.value)
  // Start the roll a beat after the stats come into view, once the library has measured them.
  // A digit only rolls when it changes, so a 0 in the target (the middle of "205") would sit still.
  // Each 0 first heads towards 5, then the roll retargets upwards and carries on round to 0.
  const [stage, setStage] = createSignal<"start" | "spin" | "done">("start")
  createEffect(() => {
    if (!props.visible) return
    const spin = setTimeout(() => setStage("spin"), 100)
    const done = setTimeout(() => setStage("done"), 350)
    onCleanup(() => {
      clearTimeout(spin)
      clearTimeout(done)
    })
  })
  const digits = () => (parts()?.[1] ?? "0").replace(/,/g, "")
  const value = () => {
    if (stage() === "start") return 0
    return Number(stage() === "spin" ? digits().replace(/0/g, "5") : digits())
  }
  return (
    <span data-component="rolling-stat" aria-label={props.value} role="img">
      <RollingNumber
        aria-hidden="true"
        value={value()}
        direction="up"
        locales="en-US"
        // Every digit slot is there from the start ("000" for 205), so the digits only roll in
        // place and nothing slides in from the side.
        format={{ minimumIntegerDigits: (parts()?.[1] ?? "0").replace(/\D/g, "").length, useGrouping: false }}
        // About as long as the avatars' wash (~1.3s), which starts at the same moment.
        duration={1200}
        stagger="start"
        motionBlur
        // The stats observer already waits until they're on screen; the library's own offscreen
        // check would otherwise race it and skip the roll.
        pauseOffscreen={false}
      />
      <span aria-hidden="true">{parts()?.[2] ?? ""}</span>
    </span>
  )
}
