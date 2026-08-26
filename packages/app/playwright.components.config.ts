import { fileURLToPath } from "node:url"
import { componentConfig } from "../storybook/playwright/config"

export default componentConfig(fileURLToPath(new URL(".", import.meta.url)), 6007)
