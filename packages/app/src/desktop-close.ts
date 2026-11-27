/** What closing the last desktop window does. `ask` shows the native close dialog. */
export const desktopCloseChoices = ["ask", "hide", "quit"] as const

export type DesktopCloseChoice = (typeof desktopCloseChoices)[number]
