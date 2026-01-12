import { Config } from "./packages/opencode/src/config/config"
import { Instance } from "./packages/opencode/src/project/instance"
import { InstanceBootstrap } from "./packages/opencode/src/project/bootstrap"

async function main() {
    await Instance.provide({
        directory: "/Users/ash/Desktop/Personal_Projects/opencode",
        init: InstanceBootstrap,
        fn: async () => {
            console.log("Directories:", await Config.directories())
        }
    })
}

main().catch(console.error)
