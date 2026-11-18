# Testing a Windows build by hand

The automated Windows test, `crates/cli/tests/windows_smoke.rs`, checks on a pseudoconsole that the TUI reaches its
home screen and that Ctrl+C leaves the alternate screen. It cannot check what a person sees and does in a real
terminal. Go through this list on a real Windows machine (Windows 11 24H2, or Windows 10 1809 or later) before a
Windows build ships, and again when a release changes console code.

## Setup

1. Unzip `opencode-native-<version>-x86_64-pc-windows-msvc.zip` (or `aarch64-pc-windows-msvc`) into a folder without
   spaces, for example `C:\tools\opencode-native`. It holds `opencode-native.exe` and the `opencode.exe` server it
   starts: keep them together. Run `Unblock-File *` in that folder from PowerShell, because the build is not signed.
2. Run `opencode-native --version`. It prints the release version.
3. Install `nvim` (`winget install Neovim.Neovim`) for the external editor check.
4. Open a project folder that is a git repository and has a few files.

Do every check in each of these terminals:

- **WT**: Windows Terminal, with PowerShell 7 and with `cmd.exe`.
- **VS Code**: the integrated terminal of VS Code (ConPTY with xterm.js).

conhost (the old console window, `conhost.exe` started directly) is supported with known limits: it has no OSC 52
copy and weaker key reporting. Run the checks there too if you can, and write down what differs. mintty and Git Bash
without ConPTY are not supported: there the program's standard input is a pipe, not a console.

Put `ok`, `fail`, or `n/a` in each cell. For each `fail`, add a note under the table with what you did, what you
expected, and what happened.

## Checks

| # | Check | How | Expected | WT | VS Code |
| --- | --- | --- | --- | --- | --- |
| 1 | Start and quit | Run `opencode-native`, wait for the home screen, then press Ctrl+C | The logo and "Ask anything" show. Ctrl+C exits with code 0 (`$LASTEXITCODE` in PowerShell, `%ERRORLEVEL%` in cmd). The shell prompt comes back on a clean screen, without stray escape text, and typing at the prompt echoes normally | | |
| 2 | Keys | In the prompt: type text, use Left, Right, Home, End, Ctrl+Left and Ctrl+Right, Backspace, Delete, Shift+Enter for a new line, Up and Down for history. Press Ctrl+P (command palette), Esc to close it, and Ctrl+X then M (models) | Each key acts once. No key repeats, is lost, or prints escape text. Key release events do not show as extra input | | |
| 3 | Keys in mini | Run `opencode-native mini` and repeat check 2 | As in check 2 | | |
| 4 | Mouse | Click a session in the session list, scroll a long transcript with the wheel, click buttons in a dialog | Clicks select what is under the pointer. The wheel scrolls the view, not the terminal's scrollback | | |
| 5 | Selection and copy | Drag over text in a message, release, then paste into Notepad. Also try Ctrl+X then Y (copy message) | The selection highlights while dragging. The copied text pastes in Notepad. In conhost, copy does nothing (known limit) | | |
| 6 | Paste | Copy several lines in Notepad, then paste into the prompt with Ctrl+V and with the terminal's own paste (right-click, or Ctrl+Shift+V) | The text arrives once, as one paste, and is not sent. Three or more lines show as `[Pasted ~N lines]` | | |
| 7 | Image paste | Copy a screenshot (Win+Shift+S), then press Ctrl+V in the prompt | The image attaches as `[Image 1]`. If it does not, write down what happens | | |
| 8 | Resize | Drag the window edge, maximize, restore, and change the font size (Ctrl+= and Ctrl+-) | The layout redraws at the new size each time, without leftovers or a garbled frame | | |
| 9 | Close the window | Close the tab or window with its close button while the TUI runs. Then run `opencode-native` in a new tab | The process exits (Task Manager shows no `opencode-native.exe`). The new run starts normally. The background service keeps running (`opencode-native service status`) | | |
| 10 | Theme | Start in the dark color scheme, then in a light one (WT: Settings, Color scheme; VS Code: a light theme). Open the theme list from the command palette and switch themes | The TUI picks the matching light or dark theme at start. Start-up is not slowed by the theme query. Switching themes redraws everything | | |
| 11 | Links | Ctrl+click a URL in a message, then open a link from a dialog (for example the documentation link in the command palette) | The default browser opens the URL | | |
| 12 | Sounds | Let a session finish while the window is not focused | The attention sound plays. Windows Terminal may show a notification. Unknown OSC sequences print no text | | |
| 13 | External editor | Set `EDITOR=nvim` (PowerShell: `$env:EDITOR = "nvim"`), type some text in the prompt, press Ctrl+X then E, edit, save with `:wq` | nvim takes the whole screen with a normal cursor and no mouse reporting garbage. After `:wq` the TUI comes back with the edited text in the prompt | | |
| 14 | External editor, GUI | Set `EDITOR=notepad` and `EDITOR=code --wait`, then repeat check 13 | The editor opens the file, and the edited text comes back after you close it | | |
| 15 | CLI prompts | Run `opencode-native auth login` (or another command that asks questions) and step through it with arrows, Enter, and Ctrl+C | The prompts draw and redraw in place, lines start at the left edge, and Ctrl+C prints "Cancelled" and exits | | |
| 16 | Piped input | Run `echo hi \| opencode-native mini` | mini reads `hi`, then takes keys from the keyboard | | |

## Notes

<!-- One entry per fail: check number, terminal, what you did, what you expected, what happened. -->

## Result

- Machine and Windows version:
- Windows Terminal version:
- VS Code version:
- `opencode-native --version`:
- Date and tester:
