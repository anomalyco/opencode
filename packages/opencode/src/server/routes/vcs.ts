import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Vcs } from "../../project/vcs"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const VcsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get VCS info",
        description:
          "Retrieve version control system (VCS) information for the current project, such as git branch.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const branch = await Vcs.branch()
        return c.json({ branch })
      },
    )
    .get(
      "/status",
      describeRoute({
        summary: "Get VCS status",
        description: "Get the current git working tree status including staged, unstaged, and untracked files.",
        operationId: "vcs.status",
        responses: {
          200: {
            description: "VCS status",
            content: {
              "application/json": {
                schema: resolver(Vcs.Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Vcs.status())
      },
    )
    .post(
      "/stage",
      describeRoute({
        summary: "Stage files",
        description: "Stage files for commit (git add).",
        operationId: "vcs.stage",
        responses: {
          200: {
            description: "Files staged",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ files: z.string().array() })),
      async (c) => {
        const { files } = c.req.valid("json")
        await Vcs.stage(files)
        return c.json(true)
      },
    )
    .post(
      "/unstage",
      describeRoute({
        summary: "Unstage files",
        description: "Unstage files from the index (git reset HEAD).",
        operationId: "vcs.unstage",
        responses: {
          200: {
            description: "Files unstaged",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ files: z.string().array() })),
      async (c) => {
        const { files } = c.req.valid("json")
        await Vcs.unstage(files)
        return c.json(true)
      },
    )
    .post(
      "/commit",
      describeRoute({
        summary: "Commit changes",
        description: "Create a git commit with the given message.",
        operationId: "vcs.commit",
        responses: {
          200: {
            description: "Commit created",
            content: {
              "application/json": {
                schema: resolver(Vcs.CommitResult),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Vcs.CommitInput),
      async (c) => {
        const input = c.req.valid("json")
        return c.json(await Vcs.commit(input))
      },
    )
    .post(
      "/stash",
      describeRoute({
        summary: "Stash changes",
        description: "Stash current working tree changes.",
        operationId: "vcs.stash",
        responses: {
          200: {
            description: "Changes stashed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ message: z.string().optional() })),
      async (c) => {
        const { message } = c.req.valid("json")
        await Vcs.stash(message)
        return c.json(true)
      },
    )
    .post(
      "/stash/pop",
      describeRoute({
        summary: "Pop stash",
        description: "Apply and remove the most recent stash entry.",
        operationId: "vcs.stash.pop",
        responses: {
          200: {
            description: "Stash popped",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Vcs.stashPop()
        return c.json(true)
      },
    )
    .post(
      "/push",
      describeRoute({
        summary: "Push commits",
        description: "Push local commits to the remote repository.",
        operationId: "vcs.push",
        responses: {
          200: {
            description: "Pushed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ force: z.boolean().optional() })),
      async (c) => {
        const { force } = c.req.valid("json")
        await Vcs.push(force)
        return c.json(true)
      },
    )
    .get(
      "/diff",
      describeRoute({
        summary: "Get diff",
        description: "Get git diff output, optionally for a specific file.",
        operationId: "vcs.diff",
        responses: {
          200: {
            description: "Diff output",
            content: {
              "application/json": {
                schema: resolver(z.object({ diff: z.string() })),
              },
            },
          },
        },
      }),
      validator("query", z.object({ file: z.string().optional() })),
      async (c) => {
        const { file } = c.req.valid("query")
        const diff = await Vcs.diff(file)
        return c.json({ diff })
      },
    ),
)
