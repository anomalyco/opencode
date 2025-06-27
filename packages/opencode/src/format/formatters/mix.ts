import { App } from "../../app/app"
import type {Definition} from "../definition"

const mix: Definition = {
    name: "mix",
    command: ["mix", "format", "$FILE"],
    extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
    async enabled() {
        try {
            const proc = Bun.spawn({
                cmd: ["mix", "--version"],
                cwd: App.info().path.cwd,
                stdout: "ignore",
                stderr: "ignore",
            })
            const exit = await proc.exited
            return exit === 0
        } catch {
            return false
        }
    },
}

export default mix
