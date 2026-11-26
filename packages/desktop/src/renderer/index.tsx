// @refresh reload

import "./diagnostics"
import "./styles.css"
import { render } from "solid-js/web"
import { api } from "./api"
import { DesktopApp } from "./desktop-app"
import { startDesktopMenu } from "./platform/menu"
import { requireRendererRoot } from "./startup/root"
import { desktopVersion, initializeSentry } from "./startup/sentry"

const root = requireRendererRoot()

const version = desktopVersion()

startDesktopMenu(api)

render(() => <DesktopApp api={api} version={version} />, root)

void initializeSentry(version)
