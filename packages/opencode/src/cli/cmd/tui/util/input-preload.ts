import { InputBuffer } from "./input-buffer"

const args = process.argv.slice(2)
const command = args.find((arg) => !arg.startsWith("-"))

if (command === undefined || command === "attach") {
  InputBuffer.install()
}
