import { UI } from "../ui"

export interface ConsoleAccountDisplay {
  readonly email: string
  readonly url: string
}

export interface ConsoleOrgDisplay extends ConsoleAccountDisplay {
  readonly id: string
  readonly name: string
}

const dim = (value: string) => UI.Style.TEXT_DIM + value + UI.Style.TEXT_NORMAL

export const formatConsoleAccountLabel = (account: ConsoleAccountDisplay, isActive: boolean) =>
  `${account.email} ${dim(account.url)}${isActive ? UI.Style.TEXT_DIM + " (active)" : ""}`

export const formatConsoleOrgLine = (org: ConsoleOrgDisplay, isActive: boolean) => {
  const dot = isActive ? UI.Style.TEXT_SUCCESS + "●" + UI.Style.TEXT_NORMAL : " "
  const name = isActive ? UI.Style.TEXT_HIGHLIGHT_BOLD + org.name + UI.Style.TEXT_NORMAL : org.name
  return `  ${dot} ${name}  ${dim(org.email)}  ${dim(org.url)}  ${dim(org.id)}`
}
