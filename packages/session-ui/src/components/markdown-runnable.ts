// Languages whose fenced blocks hold a command the run button can execute. Deliberately narrower than the set used for
// shell *styling* (`shellLanguages` in markdown.tsx): `console` and `terminal` blocks usually show a transcript or
// command output rather than a command to run, so they get styled like a shell block but no run button.
export const runnableLanguages = new Set(["bash", "sh", "shell", "zsh", "fish"])

export function isRunnableCode(language: string | undefined) {
  return !!language && runnableLanguages.has(language.toLowerCase())
}
