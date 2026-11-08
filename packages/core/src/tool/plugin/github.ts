export * as GithubTools from "./github.js"

import { ToolFailure } from "@Mackery6969/ai/effect"
import type { Context } from "@Mackery6969/plugin/effect/plugin"
import { Session } from "@Mackery6969/schema/session"
import { Effect, Schema } from "effect"
import { Github } from "../../github.js"
import { Permission } from "../../permission.js"

// --- Input/Output schemas ---

export const DetectPrInput = Schema.Struct({})
const DetectPrOutput = Schema.Struct({
  found: Schema.Boolean,
  pr: Schema.NullOr(Schema.Struct({
    owner: Schema.String,
    repo: Schema.String,
    number: Schema.Number,
    title: Schema.String.pipe(Schema.optional),
    url: Schema.String.pipe(Schema.optional),
    state: Schema.Literals(["open", "closed", "merged"]).pipe(Schema.optional),
  })),
})

export const LinkPrInput = Schema.Struct({
  owner: Schema.String.check(Schema.isNonEmpty()).annotate({ description: "Repository owner (user or organization)." }),
  repo: Schema.String.check(Schema.isNonEmpty()).annotate({ description: "Repository name." }),
  number: Schema.Int.check(Schema.isGreaterThan(0)).annotate({ description: "PR number." }),
})
const LinkPrOutput = Schema.Struct({
  success: Schema.Boolean,
  pr: Schema.NullOr(Schema.Struct({
    owner: Schema.String,
    repo: Schema.String,
    number: Schema.Number,
    title: Schema.String,
    url: Schema.String,
    state: Schema.Literals(["open", "closed", "merged"]),
  })),
})

export const UnlinkPrInput = Schema.Struct({
  sessionID: Schema.optionalKey(Session.ID).annotate({ description: "Omit to unlink the current session." }),
})
const UnlinkPrOutput = Schema.Struct({ success: Schema.Boolean })

export const CreatePrInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "PR title." }),
  body: Schema.optionalKey(Schema.String).annotate({ description: "PR body/description." }),
  draft: Schema.optionalKey(Schema.Boolean).annotate({ description: "Create as draft PR." }),
})
const CreatePrOutput = Schema.Struct({
  success: Schema.Boolean,
  pr: Schema.NullOr(Schema.Struct({
    owner: Schema.String,
    repo: Schema.String,
    number: Schema.Number,
    title: Schema.String,
    url: Schema.String,
    state: Schema.Literals(["open", "closed", "merged"]),
  })),
})

// --- Plugin ---

export const Plugin = {
  id: "github.tools",
  effect: Effect.fn("GithubTools.Plugin")(function* (ctx: Context) {
    const github = yield* Github.Service
    const permission = yield* Permission.Service

    // Only register if GitHub is authenticated (token efficiency).
    if (!github.authenticated) return

    yield* ctx.tool.transform((draft) => {
      draft.namespace({
        name: "github",
        description: "GitHub repository and PR operations.",
      })

      // detect_pr: find the open PR for the current branch.
      draft.add({
        name: "detect_pr",
        description: [
          "Detect the open GitHub PR for the current branch.",
          "Only call when you need PR info and don't already have a PR linked.",
        ].join("\n"),
        input: DetectPrInput,
        output: DetectPrOutput,
        options: { namespace: "github", codemode: true },
        execute: (input, toolContext) =>
          Effect.gen(function* () {
            yield* permission.assert({
              action: "github",
              resources: ["*"],
              save: ["*"],
              metadata: { input },
              ...Permission.invocation(toolContext),
            })
            const pr = yield* github.detectPr()
            return {
              output: {
                found: pr !== undefined,
                pr: pr ? { owner: pr.owner, repo: pr.repo, number: pr.number } : null,
              },
              content: pr
                ? `Found PR #${pr.number}: ${pr.owner}/${pr.repo}#<${pr.number}>`
                : "No open PR found for the current branch.",
            }
          }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to detect PR", error }))),
      })

      // link_pr: manually link a PR to the current session.
      draft.add({
        name: "link_pr",
        description: [
          "Link a GitHub PR to the current session so it can receive PR update notifications.",
          "Use when you want to track a specific PR's changes during a session.",
        ].join("\n"),
        input: LinkPrInput,
        output: LinkPrOutput,
        options: { namespace: "github", codemode: true },
        execute: (input, toolContext) =>
          Effect.gen(function* () {
            yield* permission.assert({
              action: "github",
              resources: ["*"],
              save: ["*"],
              metadata: { input },
              ...Permission.invocation(toolContext),
            })
            const prInfo = yield* github.prInfo({ owner: input.owner, repo: input.repo, number: input.number })
            yield* ctx.session.update({
              sessionID: toolContext.sessionID,
              metadata: { githubPr: { owner: input.owner, repo: input.repo, number: input.number } },
            })
            return {
              output: {
                success: true,
                pr: {
                  owner: prInfo.head.repo.owner,
                  repo: prInfo.head.repo.name,
                  number: prInfo.number,
                  title: prInfo.title,
                  url: prInfo.html_url,
                  state: prInfo.state,
                },
              },
              content: `Linked PR #${prInfo.number}: ${prInfo.title} (${prInfo.html_url})`,
            }
          }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to link PR", error }))),
      })

      // unlink_pr: remove the PR link from the current session.
      draft.add({
        name: "unlink_pr",
        description: [
          "Remove the GitHub PR link from the current session.",
          "Use when you no longer want PR update notifications.",
        ].join("\n"),
        input: UnlinkPrInput,
        output: UnlinkPrOutput,
        options: { namespace: "github", codemode: true },
        execute: (input, toolContext) =>
          Effect.gen(function* () {
            yield* permission.assert({
              action: "github",
              resources: ["*"],
              save: ["*"],
              metadata: { input },
              ...Permission.invocation(toolContext),
            })
            yield* ctx.session.update({ sessionID: toolContext.sessionID, metadata: { githubPr: null } })
            return { output: { success: true }, content: "Unlinked PR from session." }
          }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to unlink PR", error }))),
      })

      // create_pr: create a new PR for the current branch.
      draft.add({
        name: "create_pr",
        description: [
          "Create a new GitHub PR for the current branch.",
          "Branch naming: max 3 words, hyphen-separated, no prefixes.",
          "Example: 'fix-scroll-state', 'session-recovery', 'add-auth-feature'.",
        ].join("\n"),
        input: CreatePrInput,
        output: CreatePrOutput,
        options: { namespace: "github", codemode: true },
        execute: (input, toolContext) =>
          Effect.gen(function* () {
            yield* permission.assert({
              action: "github",
              resources: ["*"],
              save: ["*"],
              metadata: { input },
              ...Permission.invocation(toolContext),
            })
            const prInfo = yield* github.createPr({
              title: input.title,
              body: input.body,
              draft: input.draft,
            })
            return {
              output: {
                success: true,
                pr: {
                  owner: prInfo.head.repo.owner,
                  repo: prInfo.head.repo.name,
                  number: prInfo.number,
                  title: prInfo.title,
                  url: prInfo.html_url,
                  state: prInfo.state,
                },
              },
              content: `Created PR #${prInfo.number}: ${prInfo.title} (${prInfo.html_url})`,
            }
          }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to create PR", error }))),
      })
    })
  }),
}
