// @refresh reload

import "./diagnostics"
import "./styles.css"
import { render } from "solid-js/web"
import { DesktopApp } from "./desktop-app"
import { startDesktopMenu } from "./platform/menu"
import { startDesktopUpdater } from "./platform/updater"
import { startDeepLinks } from "./startup/deep-links"
import { requireRendererRoot } from "./startup/root"
import { desktopVersion, initializeSentry } from "./startup/sentry"

const root = requireRendererRoot()
const version = desktopVersion()
initializeSentry(version)

const updater = startDesktopUpdater(window.api)
startDesktopMenu(window.api)
startDeepLinks(window.api)

render(() => <DesktopApp api={window.api} updater={updater} version={version} />, root)
