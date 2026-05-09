import path from "node:path"
import os from "node:os"

const xdgDataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")

const root = () => process.env["OPENCODE_INSIGHTS_DIR"] ?? path.join(xdgDataHome(), "opencode", "insights")

export const facetsDir = () => path.join(root(), "facets")
export const reportsDir = () => path.join(root(), "reports")

export * as InsightsPaths from "./paths"
