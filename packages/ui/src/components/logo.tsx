export const Mark = (props: { class?: string }) => {
  return (
    <img
      src="/icon.png"
      alt="OpenWork"
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      style={{ display: "block" }}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <img
      src="/logo.png"
      alt="OpenWork"
      data-component="logo"
      classList={{ [props.class ?? ""]: !!props.class }}
      style={{ display: "block" }}
    />
  )
}
