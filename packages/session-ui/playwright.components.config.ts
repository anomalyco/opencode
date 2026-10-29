import { fileURLToPath } from "node:url"
import { componentConfig } from "../stories/playwright/config"

export default componentConfig(fileURLToPath(new URL(".", import.meta.url)))
