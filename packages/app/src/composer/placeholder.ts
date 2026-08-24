export function composerPlaceholder(
  mode: "normal" | "shell",
  t: (key: string, params?: Record<string, string>) => string,
) {
  if (mode === "shell") return t("prompt.placeholder.shell", { example: "git status" })
  return t("ui.promptInput.placeholder.normal", { slash: "/", at: "@" })
}
