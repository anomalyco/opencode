import { SystemPrompt } from "./packages/opencode/src/session/system"
import { Instance } from "./packages/opencode/src/project/instance"

async function test() {
    await Instance.provide({
        directory: process.cwd(),
        fn: async () => {
            const skills = await SystemPrompt.skills()
            console.log("--- Skills Prompt ---")
            console.log(skills[0] || "No skills found")
            console.log("---------------------")
        }
    })
}

test()
