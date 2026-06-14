// @refresh reload
const LOGO_SRC = "/daemon-protocol-logo.png"
const LOGO_TONE = "invert dark:invert-0"

export const Mark = (props: { class?: string }) => (
  <img
    data-component="logo-mark"
    src={LOGO_SRC}
    alt=""
    class={`${props.class ?? "size-5"} object-contain object-left ${LOGO_TONE}`}
  />
)

export const Splash = (props: { class?: string }) => (
  <img
    data-component="logo-splash"
    src={LOGO_SRC}
    alt=""
    class={`${props.class ?? "size-12"} object-contain ${LOGO_TONE}`}
  />
)

export const Logo = (props: { class?: string }) => (
  <img
    data-component="logo"
    src={LOGO_SRC}
    alt="Daemon Protocol"
    class={`${props.class ?? "h-8"} w-auto object-contain object-left ${LOGO_TONE}`}
  />
)
