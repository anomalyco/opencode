/**
 * context7-enforcer: makes the agent consult Context7 (the `context7` tool) for
 * real documentation on action requests that involve a library/framework/API.
 *
 * Implemented as a standing directive injected into the system prompt on every
 * request. This is INVISIBLE to the user (it never touches the user's message
 * text) yet always present for the model, so it reliably applies to action
 * requests like "hazme/quiero/realiza/arregla ... con <library>".
 */
import type { Plugin } from "@opencode-ai/plugin"

const DIRECTIVE =
  "Context7 policy: when the user asks you to DO / MAKE / BUILD / FIX / IMPLEMENT something that " +
  "involves a specific library, framework, SDK, tool or API (e.g. Astro, React, Next.js, Tailwind, " +
  "Drizzle, etc.), you MUST call the `context7` tool to fetch real, current documentation for that " +
  "library BEFORE writing code or giving an answer. Infer the library name and a focused query from " +
  "the request. Only skip this for purely conceptual questions that do not depend on any specific library."

export default (async () => {
  return {
    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: any },
      output: { system: string[] },
    ) => {
      if (!output.system.some((s) => s.includes("Context7 policy:"))) {
        output.system.push(DIRECTIVE)
      }
    },
  }
}) satisfies Plugin
