import { expect, test } from "bun:test"
import path from "node:path"
import { localRegistrationFile, servicePort, stateHome } from "./registration"

const home = path.resolve("home")

const root = path.resolve("root")

const profile = path.join(home, "AppData", "ai.opencode.desktop.dev")

const registered = (state: string) => path.join(state, "opencode", "service-local.json")

// The folder the source CLI registers under must never be the real home's when a test root is set.
// Windows has no login shell to ask, so its rows are the ones without a shell value.
test.each([
  { shell: undefined, testRoot: undefined, isolated: true, userData: profile, expected: registered(profile) },
  {
    shell: undefined,
    testRoot: undefined,
    isolated: false,
    userData: profile,
    expected: registered(path.join(home, ".local", "state")),
  },
  {
    shell: undefined,
    testRoot: root,
    isolated: true,
    userData: path.join(root, "desktop"),
    expected: registered(path.join(root, "desktop")),
  },
  {
    shell: undefined,
    testRoot: root,
    isolated: false,
    userData: path.join(root, "desktop"),
    expected: registered(path.join(root, "state")),
  },
  { shell: "/shell/state", testRoot: undefined, isolated: true, userData: profile, expected: registered(profile) },
  {
    shell: "/shell/state",
    testRoot: undefined,
    isolated: false,
    userData: profile,
    expected: registered("/shell/state"),
  },
  {
    shell: "/shell/state",
    testRoot: root,
    isolated: true,
    userData: path.join(root, "desktop"),
    expected: registered(path.join(root, "desktop")),
  },
  {
    shell: "/shell/state",
    testRoot: root,
    isolated: false,
    userData: path.join(root, "desktop"),
    expected: registered(path.join(root, "state")),
  },
])("registration with shell state $shell, test root $testRoot, isolated $isolated", (input) => {
  expect(localRegistrationFile({ stateHome: stateHome(input), home })).toBe(input.expected)
})

// Sixty-four checkouts' registrations: each service gets a port no channel service or ephemeral range uses, and the
// ports spread, so two apps on one machine rarely need the override.
test("a source build's service port is fixed per registration and stays in the reserved block", () => {
  const ports = Array.from({ length: 64 }, (_, index) =>
    servicePort(`/checkout-${index}/desktop/opencode/service-local.json`),
  )

  expect(ports.every((port) => port >= 0x7100 && port < 0x7900)).toBe(true)
  expect(new Set(ports).size).toBeGreaterThan(56)
})

test.each([
  ["4321", 4321],
  ["65535", 65_535],
  [undefined, servicePort(registered(root))],
  ["", servicePort(registered(root))],
  ["0", servicePort(registered(root))],
  ["65536", servicePort(registered(root))],
  ["4321junk", servicePort(registered(root))],
])("service port override %s gives %s", (override, expected) => {
  expect(servicePort(registered(root), override)).toBe(expected)
})
