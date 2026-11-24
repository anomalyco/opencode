/**
 * The text one paste types into a terminal. A terminal reads a line break as CR, so a clipboard that separates lines
 * with CR LF (Windows) or LF (macOS, Linux) types one CR per line break instead of a CR and a line feed, which a shell
 * running under Windows PowerShell or cmd reads as Enter followed by a stray empty line.
 */
export function terminalPasteText(text: string) {
  return text.replace(/\r?\n/g, "\r")
}
