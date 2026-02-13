/**
 * Environment sanitization for PTY sessions.
 *
 * Allowlist-based: only explicitly allowed variables pass through.
 * Prefix-based passthrough for OPENCODE_* and CLAXEDO_*.
 * Explicit deny list for dangerous variables.
 */

const ALLOWED_VARS = new Set([
  // Shell core
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "TMPDIR", "PWD", "OLDPWD",
  "HOSTNAME", "SHLVL", "_",

  // Localization
  "LANG", "LC_ALL", "LC_COLLATE", "LC_CTYPE", "LC_MESSAGES", "LC_MONETARY",
  "LC_NUMERIC", "LC_TIME", "TZ",

  // SSH
  "SSH_AUTH_SOCK", "SSH_AGENT_PID",

  // Language managers
  "NVM_DIR", "NVM_BIN", "NVM_INC", "NVM_CD_FLAGS", "NVM_RC_VERSION",
  "PYENV_ROOT", "PYENV_SHELL",
  "GOPATH", "GOROOT", "GOBIN",
  "CARGO_HOME", "RUSTUP_HOME",
  "DENO_DIR", "DENO_INSTALL",
  "BUN_INSTALL", "PNPM_HOME", "VOLTA_HOME",
  "ASDF_DIR", "ASDF_DATA_DIR",
  "FNM_DIR", "FNM_MULTISHELL_PATH",
  "SDKMAN_DIR",

  // Proxies
  "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
  "NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy",
  "FTP_PROXY", "ftp_proxy",

  // Homebrew
  "HOMEBREW_PREFIX", "HOMEBREW_CELLAR", "HOMEBREW_REPOSITORY",

  // XDG
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
  "XDG_RUNTIME_DIR",

  // Editor
  "EDITOR", "VISUAL", "PAGER",

  // SSL
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE",

  // Git
  "GIT_SSH_COMMAND", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",

  // Cloud tools
  "AWS_PROFILE", "AWS_DEFAULT_REGION", "AWS_CONFIG_FILE",
  "DOCKER_HOST", "KUBECONFIG", "CLOUDSDK_CONFIG",

  // SDKs
  "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "FLUTTER_ROOT", "DOTNET_ROOT",

  // Windows
  "COMSPEC", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "SYSTEMROOT", "WINDIR",
  "TEMP", "TMP", "PATHEXT", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",

  // macOS
  "__CF_USER_TEXT_ENCODING", "Apple_PubSub_Socket_Render",

  // Terminal metadata
  "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM",
  "ITERM_SESSION_ID", "ITERM_PROFILE", "TERM_SESSION_ID",
  "WT_SESSION", "WT_PROFILE_ID",
  "WEZTERM_EXECUTABLE", "WEZTERM_CONFIG_DIR",
  "KITTY_PID", "ALACRITTY_SOCKET", "GHOSTTY_RESOURCES_DIR",

  // Misc
  "MANPATH", "INFOPATH", "LESS", "LESSOPEN", "LESSCLOSE",
  "DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS",
  "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "DESKTOP_SESSION",
  "GPG_TTY", "GNUPGHOME",
  "CLICOLOR", "CLICOLOR_FORCE", "FORCE_COLOR", "NO_COLOR",
  "COLUMNS", "LINES",
])

const DENY_LIST = new Set([
  "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "NODE_PATH",
])

const DEFAULT_PREFIXES = ["OPENCODE_", "CLAXEDO_"]

export function buildSafeEnv(
  env: Record<string, string | undefined>,
  options?: { platform?: NodeJS.Platform; customPrefix?: string },
): Record<string, string> {
  const platform = options?.platform ?? process.platform
  const isWindows = platform === "win32"
  const prefixes = [...DEFAULT_PREFIXES]
  if (options?.customPrefix) {
    prefixes.push(options.customPrefix + "_")
  }

  // For Windows, build an uppercase set for case-insensitive matching
  let allowedUpper: Set<string> | undefined
  let denyUpper: Set<string> | undefined
  if (isWindows) {
    allowedUpper = new Set<string>()
    for (const v of ALLOWED_VARS) allowedUpper.add(v.toUpperCase())
    denyUpper = new Set<string>()
    for (const v of DENY_LIST) denyUpper.add(v.toUpperCase())
  }

  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue

    const checkKey = isWindows ? key.toUpperCase() : key

    // Deny list takes priority
    if (isWindows ? denyUpper!.has(checkKey) : DENY_LIST.has(key)) continue

    // Check allowlist
    if (isWindows ? allowedUpper!.has(checkKey) : ALLOWED_VARS.has(key)) {
      result[key] = value
      continue
    }

    // Check prefix matching
    const prefixKey = isWindows ? checkKey : key
    if (prefixes.some((p) => prefixKey.startsWith(isWindows ? p.toUpperCase() : p))) {
      result[key] = value
    }
  }

  return result
}

export function getLocale(env: Record<string, string | undefined>): string {
  for (const key of ["LC_ALL", "LANG"]) {
    const val = env[key]
    if (val && /utf-?8/i.test(val)) return val
  }
  return "en_US.UTF-8"
}
