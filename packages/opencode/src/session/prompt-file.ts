import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageID, PartID } from "./schema"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { Plugin } from "../plugin"
import { MCP } from "../mcp"
import { Image } from "@/image/image"
import { Effect } from "effect"


import type { PromptInput } from "./prompt"

// MAIN SERVICE

export const simplePrompt = Effect.gen(function* () {

  // Get required services
  const sessions = yield* Session.Service
  const agents = yield* Agent.Service
  const provider = yield* Provider.Service
  const revert = yield* SessionRevert.Service
  const plugin = yield* Plugin.Service
  const mcp = yield* MCP.Service
  const image = yield* Image.Service


  
  // 1. CREATE USER MESSAGE

  const createUserMessage = Effect.fn(
    "Simple.createUserMessage"
  )(function* (input: PromptInput) {


    // Step 1: Get Agent

    let agent

    if (input.agent) {
      agent = yield* agents.get(input.agent)
    } else {
      agent = yield* agents.defaultInfo()
    }

    if (!agent) {
      throw new Error("Agent not found")
    }


    // Step 2: Get Model

    let model

    if (agent.model) {

      model = agent.model

    } else {

      model =yield* agents.defaultModel()

    } 


    // Step 3: Create User Message object

    const message: SessionV1.User = {

      id:
        input.messageID ??
        MessageID.ascending(),

      role: "user",

      sessionID:
        input.sessionID,

      time: {
        created: Date.now()
      },

      tools:
        input.tools,

      agent:
        agent.name,

      model: {
        providerID:
          model.providerID,

        modelID:
          model.modelID,

        variant:
          input.variant
      },

      system:
        input.system,

      format:
        input.format
    }


    // Step 4: Check Session

    const session =yield* sessions.get(input.sessionID)


    // Step 6: Process Parts

    const parts: SessionV1.Part[] = []


    for (const part of input.parts) {


      // Text
      if (part.type === "text") {

        parts.push({

          ...part,

          id:
            part.id ??
            PartID.ascending(),

          messageID:
            message.id,

          sessionID:
            input.sessionID
        })
      }


      // File / Image / MCP resource
      else if (part.type === "file") {

        // MCP Resource
        if (
          part.source?.type === "resource"
        ) {

          const resource =
            yield* mcp.readResource(
              part.source.clientName,
              part.source.uri
            )

          parts.push({

            id:
              part.id ??
              PartID.ascending(),

            type: "text",

            text:
              String(resource),

            messageID:
              message.id,

            sessionID:
              input.sessionID
          })
        }


        // Image
        else if (
          part.mime.startsWith("image/")
        ) {

          const imagePart =
            yield* image.normalize(part as any)

          parts.push({

            ...imagePart,

            id:
              imagePart.id ??
              PartID.ascending(),

            messageID:
              message.id,

            sessionID:
              input.sessionID
          })
        }


        // Normal File
        else {

          parts.push({

            ...part,

            id:
              part.id ??
              PartID.ascending(),

            messageID:
              message.id,

            sessionID:
              input.sessionID
          })
        }
      }


      else {

        parts.push({

          ...part,

          id:
            part.id ??
            PartID.ascending(),

          messageID:
            message.id,

          sessionID:
            input.sessionID
        })
      }
    }


    // Step 7: Tell Plugins

    yield* plugin.trigger(

      "chat.message",

      {
        sessionID:
          input.sessionID,

        agent:
          input.agent,

        model:
          input.model,

        messageID:
          input.messageID,

        variant:
          input.variant
      },

      {
        message,
        parts
      }
    )


    // Step 8: Save Message

    yield* sessions.updateMessage(
      message
    )


    // Step 9: Save Parts

    for (const part of parts) {

      yield* sessions.updatePart(
        part
      )
    }


    // Step 10: Return

    return {

      info:
        message,

      parts:
        parts
    }
  })


  // 2. PROMPT FUNCTION

  const prompt = Effect.fn("Simple.prompt")(function* (input: PromptInput) {

 // Step 1: Get Session

    const session =yield* sessions.get(input.sessionID)


    // Step 2: Clean Revert State

    yield* revert.cleanup(session)


    // Step 3: Create User Message

    const message =yield* createUserMessage(input)


    // Step 4: Touch Session

    yield* sessions.touch(input.sessionID)


    // Step 5: Set Tool Permissions

    const permissions:PermissionV1.Rule[] = []


    for (
      const [tool, enabled]
      of Object.entries(
        input.tools ?? {}
      )
    ) {

      permissions.push({

        permission:
          tool,

        action:
          enabled
            ? "allow"
            : "deny",

        pattern:
          "*"
      })
    }


    // Save permissions
    if (permissions.length > 0) {

      session.permission =permissions

      yield* sessions.setPermission({

        sessionID:
          session.id,

        permission:
          permissions
      })
    }


    // Step 6: No Reply?

    if (input.noReply === true) {

      return;  
     }

    return message


     })


  // Return the two functions
  return {

    createUserMessage,
    prompt
  }
})