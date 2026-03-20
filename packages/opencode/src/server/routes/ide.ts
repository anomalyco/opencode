import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Ide, type EditorSelection } from "@/ide"
import { lazy } from "@/util/lazy"

const SelectionSchema = z.object({
  file: z.string().describe("Absolute path to the file"),
  startLine: z.number().int().min(1).describe("Start line number (1-indexed)"),
  startColumn: z.number().int().min(1).describe("Start column number (1-indexed)"),
  endLine: z.number().int().min(1).describe("End line number (1-indexed)"),
  endColumn: z.number().int().min(1).describe("End column number (1-indexed)"),
  text: z.string().optional().describe("Selected text content"),
})

export const IdeRoutes = lazy(() =>
  new Hono()
    .post(
      "/selection",
      describeRoute({
        summary: "Publish editor selection",
        description:
          "Receive editor selection changes from IDE extensions. This allows the IDE to sync selected code ranges to opencode.",
        operationId: "ide.selection",
        responses: {
          200: {
            description: "Selection published successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
          400: {
            description: "Invalid selection data",
          },
        },
      }),
      validator("json", SelectionSchema),
      async (c) => {
        const selection = c.req.valid("json") as EditorSelection
        await Ide.publishSelection(selection)
        return c.json({ success: true })
      },
    )
    .post(
      "/selection/batch",
      describeRoute({
        summary: "Publish multiple editor selections",
        description: "Receive multiple selection changes at once (e.g., multi-cursor selections)",
        operationId: "ide.selection.batch",
        responses: {
          200: {
            description: "Selections published successfully",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean(), count: z.number() })),
              },
            },
          },
        },
      }),
      validator("json", z.object({ selections: z.array(SelectionSchema) })),
      async (c) => {
        const { selections } = c.req.valid("json")
        for (const selection of selections as EditorSelection[]) {
          await Ide.publishSelection(selection)
        }
        return c.json({ success: true, count: selections.length })
      },
    ),
)
