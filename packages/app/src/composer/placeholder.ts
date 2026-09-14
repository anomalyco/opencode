export function composerPlaceholder(
  mode: "normal" | "shell",
  t: (key: string, params?: Record<string, string>) => string,
  followUp?: boolean,
) {
  if (mode === "shell") return t("prompt.placeholder.shell", { example: "git status" })
  if (followUp) return t("ui.promptInput.placeholder.followUp", { slash: "/", at: "@" })
  return t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" })
}
