import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Doc } from "./index"
import { ActorID, DocID } from "./schema"
import { SessionID } from "@/session/schema"
import { errors } from "../server/error"

export const SessionDocRoutes = () =>
  new Hono()
    .get(
      "/:sessionID/prompt-doc",
      describeRoute({
        summary: "Get session prompt doc",
        description: "Get or create the collaborative prompt doc for a session.",
        operationId: "session.promptDoc",
        responses: {
          200: {
            description: "Prompt doc",
            content: {
              "application/json": {
                schema: resolver(Doc.PromptDocInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(Doc.prompt(c.req.valid("param").sessionID))
      },
    )
    .post(
      "/:sessionID/prompt-doc/advance",
      describeRoute({
        summary: "Advance session prompt doc",
        description:
          "Create a new collaborative prompt doc for the session.",
        operationId: "session.promptDoc.advance",
        responses: {
          200: {
            description: "New prompt doc",
            content: {
              "application/json": {
                schema: resolver(Doc.PromptDocInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        const body = await c.req.json().catch(() => undefined)
        const json = z.object({ clientID: z.string().optional() }).optional().parse(body)
        return c.json(
          Doc.promptAdvance({
            sessionID: c.req.valid("param").sessionID,
            clientID: json?.clientID,
          }),
        )
      },
    )
    .post(
      "/:sessionID/prompt-doc/ready",
      describeRoute({
        summary: "Activate session prompt doc",
        description:
          "Mark a collaborative prompt doc as ready for the session and notify connected clients to switch.",
        operationId: "session.promptDoc.ready",
        responses: {
          200: {
            description: "Ready prompt doc",
            content: {
              "application/json": {
                schema: resolver(Doc.PromptDocInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        const body = await c.req.json()
        const json = z.object({ docID: DocID.zod, clientID: z.string().optional() }).parse(body)
        return c.json(
          Doc.promptReady({
            sessionID: c.req.valid("param").sessionID,
            docID: json.docID,
            clientID: json.clientID,
          }),
        )
      },
    )
    .post(
      "/:sessionID/actor",
      describeRoute({
        summary: "Register session actor",
        description: "Register or refresh a collaborative actor for a session.",
        operationId: "session.actor.upsert",
        responses: {
          200: {
            description: "Actor",
            content: {
              "application/json": {
                schema: resolver(Doc.ActorInfo),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      validator(
        "json",
        z.object({
          actorID: ActorID.zod.optional(),
          userID: z.string().optional(),
          name: z.string().optional(),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(
          Doc.actorUpsert({
            sessionID: param.sessionID,
            actorID: body.actorID,
            userID: body.userID,
            name: body.name,
          }),
        )
      },
    )
    .get(
      "/:sessionID/actor",
      describeRoute({
        summary: "List session actors",
        description: "List collaborative actors registered for a session.",
        operationId: "session.actor.list",
        responses: {
          200: {
            description: "Actors",
            content: {
              "application/json": {
                schema: resolver(Doc.ActorInfo.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: SessionID.zod })),
      async (c) => {
        return c.json(Doc.actorList(c.req.valid("param").sessionID))
      },
    )
