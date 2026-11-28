import { fileURLToPath } from "node:url"
import { componentConfig } from "../lab/playwright/config"

export default componentConfig(fileURLToPath(new URL(".", import.meta.url)))
