// @ts-nocheck

import { Octopus } from "@octopus-ai/core"
import { ReadTool } from "@octopus-ai/core/tools"

const octopus = Octopus.make({})

octopus.tool.add(ReadTool)

octopus.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

octopus.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

octopus.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await octopus.session.create({
  agent: "build",
})

octopus.subscribe((event) => {
  console.log(event)
})

await octopus.session.prompt({
  sessionID,
  text: "hey what is up",
})

await octopus.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await octopus.session.wait()

console.log(await octopus.session.messages(sessionID))
