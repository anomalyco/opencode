import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Vcs } from "../../project/vcs"
import { PR } from "../../project/pr"
import { PrComments } from "../../project/pr-comments"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const CommitInput = z
  .object({
    message: z.string(),
  })
  .meta({ ref: "VcsCommitInput" })

export const VcsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get VCS info",
        description:
          "Retrieve version control system (VCS) information for the current project, including branch, PR, and GitHub capability.",
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
        const data = await Vcs.info()
        return c.json(data)
      },
    )
    .get(
      "/branches",
      describeRoute({
        summary: "List remote branches",
        description: "List all remote branches for the current repository.",
        operationId: "vcs.branches",
        responses: {
          200: {
            description: "Branch list",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const branches = await Vcs.fetchBranches()
        return c.json(branches)
      },
    )
    .get(
      "/pr",
      describeRoute({
        summary: "Get current PR",
        description: "Retrieve the pull request associated with the current branch, if any.",
        operationId: "vcs.pr.get",
        responses: {
          200: {
            description: "PR info or null",
            content: {
              "application/json": {
                schema: resolver(Vcs.PrInfo.nullable()),
              },
            },
          },
        },
      }),
      async (c) => {
        const pr = await PR.get()
        return c.json(pr ?? null)
      },
    )
    .post(
      "/pr",
      describeRoute({
        summary: "Create PR",
        description: "Create a pull request for the current branch. Idempotent — returns existing PR if one exists.",
        operationId: "vcs.pr.create",
        responses: {
          200: {
            description: "Created or existing PR",
            content: {
              "application/json": {
                schema: resolver(Vcs.PrInfo),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", PR.CreateInput),
      async (c) => {
        try {
          const input = c.req.valid("json")
          const pr = await PR.create(input)
          return c.json(pr)
        } catch (e) {
          if (e instanceof PR.PrError) {
            return c.json({ code: e.code, message: e.message }, { status: 400 })
          }
          throw e
        }
      },
    )
    .get(
      "/pr/comments",
      describeRoute({
        summary: "Get unresolved review comments",
        description:
          "Fetch unresolved review threads for the current PR, with a pre-formatted prompt block for the agent.",
        operationId: "vcs.pr.comments",
        responses: {
          200: {
            description: "Unresolved review threads and prompt block",
            content: {
              "application/json": {
                schema: resolver(PrComments.CommentsResponse),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        try {
          const data = await PrComments.fetch()
          return c.json(data)
        } catch (e) {
          if (e instanceof PR.PrError) {
            const status = e.code === "NO_PR" ? 404 : 400
            return c.json({ code: e.code, message: e.message }, { status })
          }
          throw e
        }
      },
    )
    .post(
      "/pr/merge",
      describeRoute({
        summary: "Merge PR",
        description: "Merge the pull request for the current branch.",
        operationId: "vcs.pr.merge",
        responses: {
          200: {
            description: "Merged PR",
            content: {
              "application/json": {
                schema: resolver(Vcs.PrInfo),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", PR.MergeInput),
      async (c) => {
        try {
          const input = c.req.valid("json")
          const pr = await PR.merge(input)
          return c.json(pr)
        } catch (e) {
          if (e instanceof PR.PrError) {
            const status = e.code === "NO_PR" ? 404 : 400
            return c.json({ code: e.code, message: e.message }, { status })
          }
          throw e
        }
      },
    )
    .post(
      "/pr/ready",
      describeRoute({
        summary: "Mark PR as ready",
        description: "Mark a draft pull request as ready for review.",
        operationId: "vcs.pr.ready",
        responses: {
          200: {
            description: "PR marked as ready",
            content: {
              "application/json": {
                schema: resolver(Vcs.PrInfo),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", PR.ReadyInput),
      async (c) => {
        try {
          const input = c.req.valid("json")
          const pr = await PR.ready(input)
          return c.json(pr)
        } catch (e) {
          if (e instanceof PR.PrError) {
            const status = e.code === "NO_PR" ? 404 : 400
            return c.json({ code: e.code, message: e.message }, { status })
          }
          throw e
        }
      },
    )
    .post(
      "/pr/delete-branch",
      describeRoute({
        summary: "Delete branch",
        description: "Delete the remote branch after a PR has been merged.",
        operationId: "vcs.pr.deleteBranch",
        responses: {
          200: {
            description: "Branch deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", PR.DeleteBranchInput),
      async (c) => {
        try {
          const input = c.req.valid("json")
          await PR.deleteBranch(input)
          return c.json({ ok: true })
        } catch (e) {
          if (e instanceof PR.PrError) {
            const status = e.code === "NO_PR" ? 404 : 400
            return c.json({ code: e.code, message: e.message }, { status })
          }
          throw e
        }
      },
    )
    .post(
      "/commit",
      describeRoute({
        summary: "Commit all changes",
        description: "Stage all changes and commit with the given message.",
        operationId: "vcs.commit",
        responses: {
          200: {
            description: "Commit succeeded",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CommitInput),
      async (c) => {
        try {
          const input = c.req.valid("json")
          await Vcs.commit(input.message)
          return c.json({ ok: true })
        } catch (e) {
          if (e instanceof Error) {
            return c.json({ code: "COMMIT_FAILED", message: e.message }, { status: 400 })
          }
          throw e
        }
      },
    ),
)
