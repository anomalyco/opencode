// @ts-nocheck

import { Pencode } from "@pencode-ai/core"
import { ReadTool } from "@pencode-ai/core/tools"

const pencode = Pencode.make({})

pencode.tool.add(ReadTool)

pencode.tool.add({
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

pencode.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

pencode.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await pencode.session.create({
  agent: "build",
})

pencode.subscribe((event) => {
  console.log(event)
})

await pencode.session.prompt({
  sessionID,
  text: "hey what is up",
})

await pencode.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await pencode.session.wait()

console.log(await pencode.session.messages(sessionID))
