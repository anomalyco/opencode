import { useI18n } from "~/context/i18n"
import "./sound-toggle.css"
import { Show } from "solid-js"
import { audible, muted, setMuted, unlockAudio } from "./sound"

/**
 * The arcade's sound switch, styled like the site's theme switcher. Pressed means sound is audible.
 * Clicking is a gesture, so it also starts sound that autoplay blocked. Needs `startAudio()` to have
 * run (the arcade does it on mount).
 */
export function SoundToggle() {
  const i18n = useI18n()
  return (
    <div data-component="arcade-sound" role="group" aria-label={i18n.t("site.arcade.sound")}>
      <button
        type="button"
        aria-label={i18n.t("site.arcade.sound")}
        aria-pressed={audible() ? "true" : "false"}
        data-tip={audible() ? i18n.t("site.arcade.mute") : i18n.t("site.arcade.unmute")}
        onClick={() => {
          if (audible()) setMuted(true)
          else if (muted()) setMuted(false)
          unlockAudio()
        }}
      >
        <SpeakerIcon on={audible()} />
      </button>
    </div>
  )
}

// A speaker on the 16px icon grid, drawn like the theme icons: waves when on, a cross when muted.
export function SpeakerIcon(props: { on: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      aria-hidden="true"
    >
      <path d="M2.625 6.125H5L8.375 3.125V12.875L5 9.875H2.625V6.125Z" stroke-linejoin="round" />
      <Show
        when={props.on}
        fallback={
          <>
            <path d="M10.875 6.125L14.125 9.375" />
            <path d="M14.125 6.125L10.875 9.375" />
          </>
        }
      >
        <path d="M10.75 5.75Q12 8 10.75 10.25" />
        <path d="M12.75 4Q15 8 12.75 12" />
      </Show>
    </svg>
  )
}
