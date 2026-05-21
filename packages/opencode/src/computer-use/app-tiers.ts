/**
 * App tier classification for Computer Use permissions.
 *
 * Three restricted categories land at a reduced tier:
 *   - browser  → "read"  (visible, NO interaction)
 *   - terminal → "click" (visible + clickable, NO typing)
 *   - trading  → "read"  (visible, NO interaction)
 *
 * Uncategorized apps default to "full".
 * Policy-denied apps cannot be granted at all.
 *
 * Adapted from cc-haha's deniedApps.ts (554 lines).
 */

export type AppTier = "read" | "click" | "full"
export type DeniedCategory = "browser" | "terminal" | "trading"

export function categoryToTier(cat: DeniedCategory | null): AppTier {
  if (cat === "browser" || cat === "trading") return "read"
  if (cat === "terminal") return "click"
  return "full"
}

// ─── Bundle-ID sets (macOS) ──────────────────────────────────────────

const BROWSER_BIDS = new Set([
  "com.apple.Safari", "com.apple.SafariTechnologyPreview",
  "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
  "com.microsoft.edgemac", "com.microsoft.edgemac.Beta", "com.microsoft.edgemac.Dev",
  "org.mozilla.firefox", "org.mozilla.firefoxdeveloperedition", "org.mozilla.nightly",
  "org.chromium.Chromium", "com.brave.Browser", "com.brave.Browser.beta",
  "com.operasoftware.Opera", "com.operasoftware.OperaGX", "com.vivaldi.Vivaldi",
  "company.thebrowser.Browser", "company.thebrowser.dia",
  "org.torproject.torbrowser", "com.duckduckgo.macos.browser",
  "ai.perplexity.comet", "com.sigmaos.sigmaos.macos", "com.kagi.kagimacOS",
])

const TERMINAL_BIDS = new Set([
  "com.apple.Terminal", "com.googlecode.iterm2",
  "dev.warp.Warp-Stable", "dev.warp.Warp-Beta",
  "com.github.wez.wezterm", "org.alacritty", "io.alacritty",
  "net.kovidgoyal.kitty", "co.zeit.hyper", "com.mitchellh.ghostty",
  "com.termius-dmg.mac",
  // IDEs
  "com.microsoft.VSCode", "com.microsoft.VSCodeInsiders", "com.vscodium",
  "com.todesktop.230313mzl4w4u92", "com.exafunction.windsurf",
  "dev.zed.Zed", "dev.zed.Zed-Preview",
  "com.jetbrains.intellij", "com.jetbrains.intellij.ce",
  "com.jetbrains.pycharm", "com.jetbrains.pycharm.ce",
  "com.jetbrains.WebStorm", "com.jetbrains.CLion", "com.jetbrains.goland",
  "com.jetbrains.rubymine", "com.jetbrains.PhpStorm", "com.jetbrains.datagrip",
  "com.jetbrains.rider", "com.jetbrains.AppCode", "com.jetbrains.rustrover",
  "com.google.android.studio",
  "com.sublimetext.4", "com.sublimetext.3", "org.vim.MacVim",
  "com.neovim.neovim", "org.gnu.Emacs",
  "com.apple.dt.Xcode", "org.eclipse.platform.ide",
  "com.apple.ScriptEditor2", "com.apple.Automator",
])

const TRADING_BIDS = new Set([
  "com.webull.desktop.v1", "com.webull.trade.mac.v1",
  "com.tastytrade.desktop", "com.tradingview.tradingviewapp.desktop",
  "com.fidelity.activetrader", "com.fmr.activetrader",
  "com.install4j.5889-6375-8446-2021",
  "com.binance.BinanceDesktop", "com.electron.exodus",
  "org.pythonmac.unspecified.Electrum", "com.ledger.live", "io.trezor.TrezorSuite",
])

// ─── Policy deny (cannot be granted at all) ──────────────────────────

const POLICY_DENIED_BIDS = new Set([
  "com.apple.TV", "com.apple.Music", "com.apple.iBooksX", "com.apple.podcasts",
  "com.spotify.client", "com.amazon.music", "com.tidal.desktop",
  "com.deezer.deezer-desktop", "com.pandora.desktop",
  "com.electron.pocket-casts", "au.com.shiftyjelly.PocketCasts",
  "tv.plex.desktop", "tv.plex.htpc", "tv.plex.plexamp",
  "com.amazon.aiv.AIVApp", "com.amazon.Kindle", "com.amazon.Lassen",
  "net.kovidgoyal.calibre", "com.kobo.desktop.Kobo",
])

const POLICY_DENIED_NAMES = [
  "netflix", "disney+", "hulu", "prime video", "apple tv", "peacock",
  "paramount+", "tubi", "crunchyroll", "vudu",
  "kindle", "apple books", "kobo", "calibre", "libby", "audible",
  "spotify", "apple music", "amazon music", "youtube music", "tidal",
]

// ─── Display-name substring fallback ─────────────────────────────────

const BROWSER_NAMES = [
  "safari", "chrome", "firefox", "microsoft edge", "brave", "opera",
  "vivaldi", "chromium", "arc browser", "tor browser", "duckduckgo",
  "yandex", "orion browser", "sigmaos", "dia browser",
]

const TERMINAL_NAMES = [
  "terminal", "iterm", "wezterm", "alacritty", "kitty", "ghostty",
  "tabby", "termius", "script editor", "automator",
  "powershell", "cmd.exe", "command prompt", "git bash",
  "visual studio code", "visual studio", "vscode", "vs code",
  "vscodium", "cursor", "windsurf",
  "intellij", "pycharm", "webstorm", "clion", "goland", "rubymine",
  "phpstorm", "datagrip", "rider", "appcode", "rustrover",
  "android studio", "sublime text", "macvim", "neovim", "emacs",
  "xcode", "eclipse", "netbeans",
]

const TRADING_NAMES = [
  "bloomberg", "ameritrade", "thinkorswim", "schwab", "fidelity",
  "e*trade", "interactive brokers", "trader workstation", "tradestation",
  "webull", "robinhood", "tastytrade", "ninjatrader", "tradingview",
  "moomoo", "coinbase", "kraken", "binance", "okx", "bybit",
  "crypto.com", "electrum", "ledger live", "trezor",
]

// ─── Public API ──────────────────────────────────────────────────────

export function isPolicyDenied(bundleId: string | undefined, displayName: string): boolean {
  if (bundleId && POLICY_DENIED_BIDS.has(bundleId)) return true
  const lower = displayName.toLowerCase()
  return POLICY_DENIED_NAMES.some((s) => lower.includes(s))
}

export function getCategoryForApp(bundleId: string | undefined, displayName: string): DeniedCategory | null {
  if (bundleId) {
    if (BROWSER_BIDS.has(bundleId)) return "browser"
    if (TERMINAL_BIDS.has(bundleId)) return "terminal"
    if (TRADING_BIDS.has(bundleId)) return "trading"
  }
  const lower = displayName.toLowerCase()
  for (const s of TRADING_NAMES) if (lower.includes(s)) return "trading"
  for (const s of BROWSER_NAMES) if (lower.includes(s)) return "browser"
  for (const s of TERMINAL_NAMES) if (lower.includes(s)) return "terminal"
  return null
}

export function getDefaultTierForApp(bundleId: string | undefined, displayName: string): AppTier {
  return categoryToTier(getCategoryForApp(bundleId, displayName))
}

/** Check if a tier satisfies a required permission level. */
export function tierSatisfies(granted: AppTier, required: AppTier): boolean {
  const levels: Record<AppTier, number> = { read: 0, click: 1, full: 2 }
  return levels[granted] >= levels[required]
}

/** What tier a tool requires. */
export function requiredTierForTool(toolName: string): AppTier {
  const READ_TOOLS = ["screenshot", "zoom", "list_running_apps"]
  const CLICK_TOOLS = ["left_click", "double_click", "right_click", "scroll"]
  const KEYBOARD_TOOLS = ["type", "key", "drag", "open_app", "read_clipboard"]
  if (READ_TOOLS.includes(toolName)) return "read"
  if (CLICK_TOOLS.includes(toolName)) return "click"
  if (KEYBOARD_TOOLS.includes(toolName)) return "full"
  return "full"
}
