import { expect, test } from "bun:test"
import { deepLinkArguments, relaunchArguments } from "./arguments"

const link = "opencode://console/authorized?window=window-a"

const other = "opencode://open?project=/repo"

// What each platform puts on the command line of the process it starts for a link. macOS puts nothing there: its
// link arrives as an `open-url` event.
test.each([
  { launch: "Windows, installed", argv: ["C:\\Programs\\OpenCode\\OpenCode.exe", link], links: [link], relaunch: [] },
  {
    launch: "Linux, installed",
    argv: ["/opt/OpenCode/opencode", "--no-sandbox", link],
    links: [link],
    relaunch: ["--no-sandbox"],
  },
  {
    launch: "a source build",
    argv: ["C:\\checkout\\electron.exe", ".", "--remote-debugging-port=9222", link],
    links: [link],
    relaunch: [".", "--remote-debugging-port=9222"],
  },
  { launch: "macOS", argv: ["/Applications/OpenCode.app/Contents/MacOS/OpenCode"], links: [], relaunch: [] },
  { launch: "two links", argv: ["/opt/OpenCode/opencode", link, other], links: [link, other], relaunch: [] },
  {
    launch: "paths and switches that only mention a link",
    argv: ["/opt/OpenCode/opencode", "/repo/opencode:/notes.txt", `--url=${link}`, "C:\\repo\\opencode"],
    links: [],
    relaunch: ["/repo/opencode:/notes.txt", `--url=${link}`, "C:\\repo\\opencode"],
  },
])("$launch: links $links, relaunch with $relaunch", (input) => {
  expect(deepLinkArguments(input.argv)).toEqual(input.links)
  expect(relaunchArguments(input.argv)).toEqual(input.relaunch)
})
