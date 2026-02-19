type WindowTarget = {
  focus: () => void
  location: {
    assign: (href: string) => void
  }
}

export const handleNotificationClick = (href?: string, target: WindowTarget = window) => {
  target.focus()
  if (!href) return
  target.location.assign(href)
}
