import { fileURLToPath } from "node:url"
import type { PlaywrightTestConfig } from "@playwright/test"
import { componentConfig } from "../storybook/playwright/config"

const config: PlaywrightTestConfig = componentConfig(fileURLToPath(new URL(".", import.meta.url)))

export default config
