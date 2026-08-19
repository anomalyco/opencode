import { shellEscape } from "./runtime"

export function wslSidecarShell(opencode: string, port: number, username: string, password: string, packaged: boolean) {
  return {
    // Explicit WSL commands skip login startup files. Load the same user environment
    // as a terminal launch, then replace the interactive shell before reading stdin.
    args: [
      "bash",
      "--noprofile",
      "--norc",
      "-ic",
      'for file in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do [[ ! -r "$file" ]] || { source "$file"; break; }; done; exec bash -se',
    ],
    script: [
      "set -euo pipefail",
      'cd "$HOME" || cd /',
      'PATH=$(awk -v RS=: -v ORS=: \'$0 !~ /^\\/mnt\\//\' <<<"$PATH" | sed "s/:$//")',
      "export PATH",
      "export WSLENV=",
      "export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true",
      "export OPENCODE_CLIENT=desktop",
      `export OPENCODE_SERVER_USERNAME=${shellEscape(username)}`,
      `export OPENCODE_SERVER_PASSWORD=${shellEscape(password)}`,
      'export XDG_STATE_HOME="$HOME/.local/state"',
      `exec ${shellEscape(opencode)} --print-logs --log-level ${packaged ? "WARN" : "INFO"} serve --hostname 0.0.0.0 --port ${port}`,
    ].join("\n"),
  }
}
