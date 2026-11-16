// @refresh reload

import "./diagnostics"
import "./styles.css"
import { render } from "solid-js/web"
import { api } from "./api"
import { DesktopApp } from "./desktop-app"
import { startDesktopMenu } from "./platform/menu"
import { startDeepLinks } from "./startup/deep-links"
import { requireRendererRoot } from "./startup/root"
import pkg from "../../package.json"

const root = requireRendererRoot()

const version = import.meta.env.OPENCODE_VERSION ?? pkg.version

startDesktopMenu(api)

startDeepLinks(api)

render(() => <DesktopApp api={api} version={version} />, root)
