// @refresh reload

import "./diagnostics"
import "./styles.css"
import { render } from "solid-js/web"
import { api } from "./api"
import { DesktopApp } from "./desktop-app"
import { startDesktopMenu } from "./platform/menu"
import { startDesktopUpdater } from "./platform/updater"
import { startDeepLinks } from "./startup/deep-links"
import { requireRendererRoot } from "./startup/root"
import { desktopVersion, initializeSentry } from "./startup/sentry"

const root = requireRendererRoot()
const version = desktopVersion()
await initializeSentry(version)

const updater = startDesktopUpdater(api)
startDesktopMenu(api)
startDeepLinks(api)

render(() => <DesktopApp api={api} updater={updater} version={version} />, root)

if (import.meta.env.DEV) void import("virtual:vite-opencode-picker/client")
