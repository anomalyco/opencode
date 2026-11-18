import { expect, test } from "bun:test"
import path from "node:path"
import { localRegistrationFile, stateHome } from "./registration"

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
