import { tabKey, type Tab } from "@/context/tabs"

let lastTabKeyBeforeHome: string | undefined

export function rememberTabBeforeHome(tab: Tab) {
  lastTabKeyBeforeHome = tabKey(tab)
}

export function resolveTabBeforeHome(tabs: readonly Tab[]) {
  if (!lastTabKeyBeforeHome) return
  return tabs.find((item) => tabKey(item) === lastTabKeyBeforeHome)
}

export function isHomePath(pathname: string) {
  return (pathname.replace(/\/+$/, "") || "/") === "/"
}
