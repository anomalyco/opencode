// opentui v0.3.0+ auto-detects SSH/mosh sessions (SSH_CONNECTION, SSH_CLIENT,
// SSH_TTY, MOSH_CONNECTION) as "remote" and stops reading the process
// environment for terminal capability detection unless the host environment is
// forwarded explicitly. Without forwarding, ssh sessions ignore TERM, COLORTERM,
// TMUX, and the OPENTUI_FORCE_* overrides and render with a 16-color,
// query-only capability floor, which breaks the TUI (#31284).
//
// Forwarding the same env keys opentui inspects for local sessions restores
// pre-1.16 capability detection while keeping remote-mode behavior like OSC52
// clipboard. Mirrors DEFAULT_FORWARDED_ENV_KEYS in @opentui/core, which is not
// exported as of 0.3.4.
export const TERMINAL_ENV_KEYS = [
  "TMUX",
  "ZELLIJ",
  "ZELLIJ_SESSION_NAME",
  "ZELLIJ_PANE_ID",
  "TERM",
  "OPENTUI_GRAPHICS",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_FEATURES",
  "ALACRITTY_SOCKET",
  "ALACRITTY_LOG",
  "COLORTERM",
  "TERMUX_VERSION",
  "VHS_RECORD",
  "OPENTUI_FORCE_WCWIDTH",
  "OPENTUI_FORCE_UNICODE",
  "OPENTUI_FORCE_NOZWJ",
  "OPENTUI_FORCE_EXPLICIT_WIDTH",
  "OPENTUI_NOTIFICATION_PROTOCOL",
  "OPENTUI_NOTIFICATIONS",
  "WT_SESSION",
  "STY",
  "WSL_DISTRO_NAME",
  "WSL_INTEROP",
]
