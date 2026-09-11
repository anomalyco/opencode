// @ts-nocheck

import { Argus } from "@argus-ai/core"
import { ReadTool } from "@argus-ai/core/tools"

const argus = Argus.make({})

argus.tool.add(ReadTool)

argus.tool.add({
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

argus.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

argus.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await argus.session.create({
  agent: "build",
})

argus.subscribe((event) => {
  console.log(event)
})

await argus.session.prompt({
  sessionID,
  text: "hey what is up",
})

await argus.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await argus.session.wait()

console.log(await argus.session.messages(sessionID))
