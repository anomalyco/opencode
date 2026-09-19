// minimal node-side shim for imports that (mis)use the "bun" bare specifier.
import { fileURLToPath, pathToFileURL } from "node:url"
export { fileURLToPath, pathToFileURL }
export const $ = async () => ""
export default { fileURLToPath, pathToFileURL, $ }
