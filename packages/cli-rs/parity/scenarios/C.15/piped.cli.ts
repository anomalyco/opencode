// `debug paths --wizard` with keys from a pipe: the first prompt takes "y" and loses the rest of the chunk, as
// each Effect prompt reads from a queue of its own; the next prompt meets the end of input and the wizard is
// cancelled with exit 0. stdout keeps every cursor movement and erase, without colors.
import { defineCli } from "../../cli/run"

export default defineCli({ args: ["debug", "paths", "--wizard"], stdin: "y\x1b[B\r" })
