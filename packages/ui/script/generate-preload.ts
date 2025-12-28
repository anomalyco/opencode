/**
 * Generates the theme preload script content.
 * Run this to get the script that should be embedded in index.html.
 */

import { generatePreloadScript, generatePreloadScriptFormatted } from "../src/theme/preload"

const formatted = process.argv.includes("--formatted")

if (formatted) {
  console.log("<script>")
  console.log(generatePreloadScriptFormatted())
  console.log("</script>")
} else {
  console.log("<script>" + generatePreloadScript() + "</script>")
}
