import pkg from "../../../package.json"
import type { WslDistroProbe, WslInstalledDistro, WslOnlineDistro, WslOpencodeCheck, WslServersState } from "../types"

/** Pick which mock setup to show in desktop dev on macOS/Linux. */
export type WslMockScenario =
  | "ready"
  | "addServer"
  | "onboarding"
  | "wslUnavailable"
  | "versionMismatch"
  | "failedServer"
  | "pendingRestart"

export const ACTIVE_WSL_MOCK_SCENARIO: WslMockScenario = "addServer"

const desktopVersion = pkg.version
const mockSidecarUrl = "http://127.0.0.1:4096"

const onlineDistros: WslOnlineDistro[] = [
  { name: "Ubuntu-24.04", label: "Ubuntu 24.04 LTS" },
  { name: "Ubuntu-22.04", label: "Ubuntu 22.04 LTS" },
  { name: "Ubuntu-20.04", label: "Ubuntu 20.04 LTS" },
  { name: "Ubuntu-18.04", label: "Ubuntu 18.04 LTS" },
  { name: "Debian", label: "Debian GNU/Linux" },
  { name: "FedoraLinux-42", label: "Fedora Linux 42" },
  { name: "openSUSE-Tumbleweed", label: "openSUSE Tumbleweed" },
  { name: "openSUSE-Leap-15.6", label: "openSUSE Leap 15.6" },
  { name: "openSUSE-Leap-15.5", label: "openSUSE Leap 15.5" },
  { name: "kali-linux", label: "Kali Linux Rolling" },
  { name: "AlmaLinux-9", label: "AlmaLinux OS 9" },
  { name: "Rocky-9", label: "Rocky Linux 9" },
  { name: "OracleLinux_9_5", label: "Oracle Linux 9.5" },
  { name: "archlinux", label: "Arch Linux" },
  { name: "SUSE-Linux-Enterprise-15-SP6", label: "SUSE Linux Enterprise 15 SP6" },
]

/** Online-only distros for add-server catalog scroll/search testing (not in addServerInstalled). */
const addServerOnlineExtras: WslOnlineDistro[] = [
  { name: "FedoraLinux-41", label: "Fedora Linux 41" },
  { name: "Ubuntu-24.10", label: "Ubuntu 24.10" },
  { name: "Debian-12", label: "Debian 12 Bookworm" },
  { name: "Alpine-WSL", label: "Alpine Linux 3.20" },
  { name: "NixOS-WSL", label: "NixOS 24.05" },
  { name: "Gentoo-WSL", label: "Gentoo Linux" },
  { name: "Wolfi-Linux", label: "Wolfi Linux" },
  { name: "AzureLinux-3", label: "Azure Linux 3.0" },
  { name: "CBL-Mariner-2", label: "CBL-Mariner 2.0" },
  { name: "Pengwin", label: "Pengwin 16" },
  { name: "Ubuntu-NVIDIA", label: "Ubuntu with NVIDIA drivers" },
  { name: "openSUSE-Leap-15.4", label: "openSUSE Leap 15.4" },
  { name: "AlmaLinux-8", label: "AlmaLinux OS 8" },
  { name: "Rocky-8", label: "Rocky Linux 8" },
  { name: "OracleLinux_8_10", label: "Oracle Linux 8.10" },
]

const addServerOnline: WslOnlineDistro[] = [...onlineDistros, ...addServerOnlineExtras]

const addServerInstalled: WslInstalledDistro[] = [
  { name: "FedoraLinux-42", version: 2, isDefault: true },
  { name: "Ubuntu-24.04", version: 2, isDefault: false },
  { name: "Ubuntu-22.04", version: 2, isDefault: false },
  { name: "Ubuntu-20.04", version: 2, isDefault: false },
  { name: "Debian", version: 1, isDefault: false },
  { name: "openSUSE-Tumbleweed", version: 2, isDefault: false },
  { name: "openSUSE-Leap-15.6", version: 2, isDefault: false },
  { name: "kali-linux", version: 2, isDefault: false },
  { name: "AlmaLinux-9", version: 2, isDefault: false },
  { name: "Rocky-9", version: 2, isDefault: false },
  { name: "OracleLinux_9_5", version: 2, isDefault: false },
  { name: "archlinux", version: 2, isDefault: false },
  { name: "SUSE-Linux-Enterprise-15-SP6", version: 2, isDefault: false },
]

const readyInstalled: WslInstalledDistro[] = [
  { name: "Ubuntu-24.04", version: 2, isDefault: true },
  { name: "Ubuntu-22.04", version: 2, isDefault: false },
  { name: "Ubuntu-20.04", version: 2, isDefault: false },
  { name: "Debian", version: 2, isDefault: false },
  { name: "FedoraLinux-42", version: 2, isDefault: false },
  { name: "openSUSE-Tumbleweed", version: 2, isDefault: false },
  { name: "openSUSE-Leap-15.6", version: 2, isDefault: false },
  { name: "kali-linux", version: 2, isDefault: false },
  { name: "AlmaLinux-9", version: 2, isDefault: false },
  { name: "Rocky-9", version: 2, isDefault: false },
  { name: "OracleLinux_9_5", version: 2, isDefault: false },
  { name: "archlinux", version: 2, isDefault: false },
  { name: "SUSE-Linux-Enterprise-15-SP6", version: 2, isDefault: false },
]

function readyProbe(name: string): WslDistroProbe {
  return { name, canExecute: true, hasBash: true, hasCurl: true, error: null }
}

function missingToolsProbe(name: string): WslDistroProbe {
  return { name, canExecute: true, hasBash: false, hasCurl: false, error: null }
}

function missingOpencode(distro: string): WslOpencodeCheck {
  return {
    distro,
    resolvedPath: null,
    version: null,
    expectedVersion: desktopVersion,
    matchesDesktop: null,
    error: null,
  }
}

function readyOpencode(distro: string, version = desktopVersion): WslOpencodeCheck {
  return {
    distro,
    resolvedPath: `/home/dev/.opencode/bin/opencode`,
    version,
    expectedVersion: desktopVersion,
    matchesDesktop: version === desktopVersion,
    error: null,
  }
}

function staleOpencode(distro: string): WslOpencodeCheck {
  return {
    distro,
    resolvedPath: `/home/dev/.opencode/bin/opencode`,
    version: "1.14.35",
    expectedVersion: desktopVersion,
    matchesDesktop: false,
    error: null,
  }
}

function probesFor(installed: WslInstalledDistro[], overrides: Record<string, WslDistroProbe>) {
  return Object.fromEntries(installed.map((item) => [item.name, overrides[item.name] ?? readyProbe(item.name)]))
}

function opencodeFor(names: string[], check: (name: string) => WslOpencodeCheck) {
  return Object.fromEntries(names.map((name) => [name, check(name)]))
}

/** Edit these builders to change what the WSL UI shows during local development. */
export const wslMockScenarios = {
  ready(): WslServersState {
    const probes = probesFor(readyInstalled, {})
    const opencodeChecks = opencodeFor(
      readyInstalled.map((item) => item.name),
      readyOpencode,
    )
    return {
      runtime: { available: true, version: "WSL version: 2.6.1.0", error: null },
      installed: readyInstalled,
      online: onlineDistros,
      distroProbes: probes,
      opencodeChecks,
      pendingRestart: false,
      job: null,
      servers: [
        {
          config: { id: "wsl:Ubuntu-24.04", distro: "Ubuntu-24.04" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:Ubuntu-22.04", distro: "Ubuntu-22.04" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:Ubuntu-20.04", distro: "Ubuntu-20.04" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:Debian", distro: "Debian" },
          runtime: { kind: "failed", message: "WSL server exited before becoming healthy (code=1 signal=null)" },
        },
        {
          config: { id: "wsl:FedoraLinux-42", distro: "FedoraLinux-42" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:openSUSE-Tumbleweed", distro: "openSUSE-Tumbleweed" },
          runtime: { kind: "stopped" },
        },
        {
          config: { id: "wsl:openSUSE-Leap-15.6", distro: "openSUSE-Leap-15.6" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:kali-linux", distro: "kali-linux" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:AlmaLinux-9", distro: "AlmaLinux-9" },
          runtime: { kind: "failed", message: "Sidecar health check timed out after 30s" },
        },
        {
          config: { id: "wsl:Rocky-9", distro: "Rocky-9" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:OracleLinux_9_5", distro: "OracleLinux_9_5" },
          runtime: { kind: "stopped" },
        },
        {
          config: { id: "wsl:archlinux", distro: "archlinux" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
        {
          config: { id: "wsl:SUSE-Linux-Enterprise-15-SP6", distro: "SUSE-Linux-Enterprise-15-SP6" },
          runtime: { kind: "ready", url: mockSidecarUrl, username: "opencode", password: "mock-wsl-password" },
        },
      ],
    }
  },

  addServer(): WslServersState {
    return {
      runtime: { available: true, version: "WSL version: 2.6.1.0", error: null },
      installed: addServerInstalled,
      online: addServerOnline,
      distroProbes: probesFor(addServerInstalled, {
        "Ubuntu-24.04": missingToolsProbe("Ubuntu-24.04"),
        Debian: readyProbe("Debian"),
        "AlmaLinux-9": missingToolsProbe("AlmaLinux-9"),
      }),
      opencodeChecks: {
        "FedoraLinux-42": missingOpencode("FedoraLinux-42"),
        "Ubuntu-22.04": readyOpencode("Ubuntu-22.04"),
        "openSUSE-Tumbleweed": missingOpencode("openSUSE-Tumbleweed"),
        "kali-linux": readyOpencode("kali-linux"),
        "Rocky-9": staleOpencode("Rocky-9"),
        OracleLinux_9_5: missingOpencode("OracleLinux_9_5"),
        archlinux: readyOpencode("archlinux"),
      },
      pendingRestart: false,
      job: null,
      servers: [],
    }
  },

  onboarding(): WslServersState {
    return {
      runtime: null,
      installed: [],
      online: [],
      distroProbes: {},
      opencodeChecks: {},
      pendingRestart: false,
      job: null,
      servers: [],
    }
  },

  wslUnavailable(): WslServersState {
    return {
      runtime: { available: false, version: null, error: "WSL is not installed. Run `wsl --install` to enable it." },
      installed: [],
      online: [],
      distroProbes: {},
      opencodeChecks: {},
      pendingRestart: false,
      job: null,
      servers: [],
    }
  },

  versionMismatch(): WslServersState {
    const distro = readyInstalled[0]
    return {
      runtime: { available: true, version: "WSL version: 2.6.1.0", error: null },
      installed: [distro],
      online: onlineDistros,
      distroProbes: { [distro.name]: readyProbe(distro.name) },
      opencodeChecks: { [distro.name]: staleOpencode(distro.name) },
      pendingRestart: false,
      job: null,
      servers: [
        {
          config: { id: `wsl:${distro.name}`, distro: distro.name },
          runtime: {
            kind: "ready",
            url: mockSidecarUrl,
            username: "opencode",
            password: "mock-wsl-password",
          },
        },
      ],
    }
  },

  failedServer(): WslServersState {
    const distro = readyInstalled[0]
    return {
      runtime: { available: true, version: "WSL version: 2.6.1.0", error: null },
      installed: [distro],
      online: onlineDistros,
      distroProbes: { [distro.name]: readyProbe(distro.name) },
      opencodeChecks: { [distro.name]: readyOpencode(distro.name) },
      pendingRestart: false,
      job: null,
      servers: [
        {
          config: { id: `wsl:${distro.name}`, distro: distro.name },
          runtime: { kind: "stopped" },
        },
      ],
    }
  },

  pendingRestart(): WslServersState {
    return {
      runtime: { available: false, version: null, error: null },
      installed: [],
      online: [],
      distroProbes: {},
      opencodeChecks: {},
      pendingRestart: true,
      job: null,
      servers: [],
    }
  },
} satisfies Record<WslMockScenario, () => WslServersState>

export function createWslMockState(scenario: WslMockScenario = ACTIVE_WSL_MOCK_SCENARIO) {
  return structuredClone(wslMockScenarios[scenario]())
}
