// Writes src/component/site/settings-defaults.json: the default settings, which production renders
// without building the settings schema, so zod stays out of the browser's bundle (settings.ts). Run
// after changing a setting or its default; test/settings-defaults.test.ts fails while the file is out
// of date.
import path from "node:path"
import { siteSettingsSchema } from "../src/component/site/settings"

const file = path.join(import.meta.dir, "../src/component/site/settings-defaults.json")
const defaults = siteSettingsSchema().parse({})
await Bun.write(file, JSON.stringify(defaults, null, 2) + "\n")
console.log(`settings-defaults.json: ${Object.keys(defaults).length} settings`)
