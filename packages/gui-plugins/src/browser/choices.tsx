import { Show } from "solid-js"
import { usePlugin, type IconName } from "@opencode/plugin/gui"
import type { ProfileSource } from "./profile/ipc"

/** One profile of an installed browser, as a row or a choice. */
export type Choice = { readonly source: ProfileSource; readonly profile: ProfileSource["profiles"][number] }

/** One choice per profile with cookies, the browser used last first. */
export function profileChoices(sources: readonly ProfileSource[]): Choice[] {
  return sources.flatMap((source) => source.profiles.map((profile) => ({ source, profile })))
}

/** The browser's name, with the profile's only for a browser that has several. */
export function choiceLabel(choice: Choice) {
  return choice.source.profiles.length > 1 ? `${choice.source.name} · ${choice.profile.name}` : choice.source.name
}

/** Encoded: a select finds its options by value in a CSS selector. */
export function choiceValue(choice: Choice) {
  return `${encodeURIComponent(choice.source.id)}:${encodeURIComponent(choice.profile.id)}`
}

/** A browser's or an extension's own icon, or a muted glyph where it has none. */
export function Glyph(props: { image?: string; fallback: IconName; class?: string }) {
  const ctx = usePlugin()

  return (
    <Show
      when={props.image}
      fallback={
        <span
          class={`flex size-5 shrink-0 items-center justify-center text-v2-icon-icon-muted ${props.class ?? ""}`}
          aria-hidden="true"
        >
          <ctx.ui.Icon name={props.fallback} />
        </span>
      }
    >
      {(image) => <img src={image()} alt="" class={`size-5 shrink-0 ${props.class ?? ""}`} />}
    </Show>
  )
}
