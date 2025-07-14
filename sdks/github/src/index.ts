#!/usr/bin/env bun

import os from "os";
import path from "path";
import { $ } from "bun";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import * as core from "@actions/core";
import * as github from "@actions/github";
import type { IssueCommentEvent } from "@octokit/webhooks-types";
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueQueryResponse,
  PullRequestQueryResponse,
} from "./types";

if (github.context.eventName !== "issue_comment") {
  core.setFailed(`Unsupported event type: ${github.context.eventName}`);
  process.exit(1);
}

const { owner, repo } = github.context.repo;
const payload = github.context.payload as IssueCommentEvent;
const actor = github.context.actor;
const issueId = payload.issue.number;
const body = payload.comment.body;

let appToken: string;
let octoRest: Octokit;
let octoGraph: typeof graphql;
let commentId: number;
let gitCredentials: string;
let shareUrl: string | undefined;
let state:
  | {
      type: "issue";
      issue: GitHubIssue;
    }
  | {
      type: "local-pr";
      pr: GitHubPullRequest;
    }
  | {
      type: "fork-pr";
      pr: GitHubPullRequest;
    };

async function run() {
  try {
    const match = body.match(/^hey\s*opencode,?\s*(.*)$/);
    if (!match?.[1]) throw new Error("Command must start with `hey opencode`");
    const userPrompt = match[1];

    const oidcToken = await generateGitHubToken();
    appToken = await exchangeForAppToken(oidcToken);
    octoRest = new Octokit({ auth: appToken });
    octoGraph = graphql.defaults({
      headers: { authorization: `token ${appToken}` },
    });

    await configureGit(appToken);
    await assertPermissions();

    const comment = await createComment("opencode started...");
    commentId = comment.data.id;

    // Set state
    const repoData = await fetchRepo();
    if (payload.issue.pull_request) {
      const prData = await fetchPR();
      state = {
        type:
          prData.headRepository.nameWithOwner ===
          prData.baseRepository.nameWithOwner
            ? "local-pr"
            : "fork-pr",
        pr: prData,
      };
    } else {
      state = {
        type: "issue",
        issue: await fetchIssue(),
      };
    }

    // Setup git branch
    if (state.type === "local-pr") await checkoutLocalBranch(state.pr);
    else if (state.type === "fork-pr") await checkoutForkBranch(state.pr);

    // Prompt
    const share = process.env.INPUT_SHARE === "true" || !repoData.data.private;
    const promptData =
      state.type === "issue"
        ? buildPromptDataForIssue(state.issue)
        : buildPromptDataForPR(state.pr);
    const responseRet = await runOpencode(`${userPrompt}\n\n${promptData}`, {
      share,
    });

    const response = responseRet.stdout;
    shareUrl = responseRet.stderr.match(/https:\/\/opencode\.ai\/s\/\w+/)?.[0];

    // Comment and push changes
    if (await branchIsDirty()) {
      const summary =
        (
          await runOpencode(
            `Summarize the following in less than 40 characters:\n\n${response}`,
            { share: false }
          )
        )?.stdout || `Fix issue: ${payload.issue.title}`;

      if (state.type === "issue") {
        const branch = await pushToNewBranch(summary);
        const pr = await createPR(
          repoData.data.default_branch,
          branch,
          summary,
          `${response}\n\nCloses #${issueId}`
        );
        await updateComment(`opencode created pull request #${pr}`);
      } else if (state.type === "local-pr") {
        await pushToCurrentBranch(summary);
        await updateComment(response);
      } else if (state.type === "fork-pr") {
        await pushToForkBranch(summary, state.pr);
        await updateComment(response);
      }
    } else {
      await updateComment(response);
    }
    await restoreGitConfig();
    await revokeAppToken();
  } catch (e: any) {
    await restoreGitConfig();
    await revokeAppToken();
    console.error(e);
    let msg = e;
    if (e instanceof $.ShellError) {
      msg = e.stderr.toString();
    } else if (e instanceof Error) {
      msg = e.message;
    }
    if (commentId) await updateComment(msg);
    core.setFailed(`opencode failed with error: ${msg}`);
    // Also output the clean error message for the action to capture
    //core.setOutput("prepare_error", e.message);
    process.exit(1);
  }
}

if (import.meta.main) {
  run();
}

async function generateGitHubToken() {
  try {
    return await core.getIDToken("opencode-github-action");
  } catch (error) {
    console.error("Failed to get OIDC token:", error);
    throw new Error(
      "Could not fetch an OIDC token. Make sure to add `id-token: write` to your workflow permissions."
    );
  }
}

async function exchangeForAppToken(oidcToken: string) {
  const response = await fetch(
    "https://api.frank.dev.opencode.ai/exchange_github_app_token",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oidcToken}`,
      },
    }
  );

  if (!response.ok) {
    const responseJson = (await response.json()) as { error?: string };
    throw new Error(
      `App token exchange failed: ${response.status} ${response.statusText} - ${responseJson.error}`
    );
  }

  const responseJson = (await response.json()) as { token: string };
  return responseJson.token;
}

async function configureGit(appToken: string) {
  console.log("Configuring git...");
  const config = "http.https://github.com/.extraheader";
  const ret = await $`git config --local --get ${config}`;
  gitCredentials = ret.stdout.toString().trim();

  const newCredentials = Buffer.from(
    `x-access-token:${appToken}`,
    "utf8"
  ).toString("base64");

  await $`git config --local --unset-all ${config}`;
  await $`git config --local ${config} "AUTHORIZATION: basic ${newCredentials}"`;
  await $`git config --global user.name "opencode-agent[bot]"`;
  await $`git config --global user.email "opencode-agent[bot]@users.noreply.github.com"`;
}

async function checkoutLocalBranch(pr: GitHubPullRequest) {
  console.log("Checking out local branch...");

  const branch = pr.headRefName;
  const depth = Math.max(pr.commits.totalCount, 20);

  await $`git fetch origin --depth=${depth} ${branch}`;
  await $`git checkout ${branch}`;
}

async function checkoutForkBranch(pr: GitHubPullRequest) {
  console.log("Checking out fork branch...");

  const remoteBranch = pr.headRefName;
  const localBranch = generateBranchName();
  const depth = Math.max(pr.commits.totalCount, 20);

  await $`git remote add fork https://github.com/${pr.headRepository.nameWithOwner}.git`;
  await $`git fetch fork --depth=${depth} ${remoteBranch}`;
  await $`git checkout -b ${localBranch} fork/${remoteBranch}`;
}

async function restoreGitConfig() {
  if (!gitCredentials) return;
  const config = "http.https://github.com/.extraheader";
  await $`git config --local ${config} "${gitCredentials}"`;
}

async function assertPermissions() {
  console.log(`Asserting permissions for user ${actor}...`);

  let permission;
  try {
    const response = await octoRest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: actor,
    });

    permission = response.data.permission;
    console.log(`  permission: ${permission}`);
  } catch (error) {
    console.error(`Failed to check permissions: ${error}`);
    throw new Error(`Failed to check permissions for user ${actor}: ${error}`);
  }

  if (!["admin", "write"].includes(permission))
    throw new Error(`User ${actor} does not have write permissions`);
}

function buildComment(content: string) {
  const runId = process.env.GITHUB_RUN_ID!;
  const runUrl = `/${owner}/${repo}/actions/runs/${runId}`;
  return [
    content,
    "\n\n",
    shareUrl ? `[view session](${shareUrl}) | ` : "",
    `[view log](${runUrl})`,
  ].join("");
}

async function createComment(body: string) {
  console.log("Creating comment...");
  return await octoRest.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueId,
    body: buildComment(body),
  });
}

async function updateComment(body: string) {
  console.log("Updating comment...");
  return await octoRest.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body: buildComment(body),
  });
}

function generateBranchName() {
  const type = state.type === "issue" ? "issue" : "pr";
  const timestamp = new Date()
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z/, "")
    .split("T")
    .join("_");
  return `opencode/${type}${issueId}-${timestamp}`;
}

async function pushToCurrentBranch(summary: string) {
  console.log("Pushing to current branch...");
  await $`git add .`;
  await $`git commit -m "${summary}
  
Co-authored-by: ${actor} <${actor}@users.noreply.github.com>"`;
  await $`git push`;
}

async function pushToForkBranch(summary: string, pr: GitHubPullRequest) {
  console.log("Pushing to fork branch...");

  const remoteBranch = pr.headRefName;

  await $`git add .`;
  await $`git commit -m "${summary}
  
Co-authored-by: ${actor} <${actor}@users.noreply.github.com>"`;
  await $`git push fork HEAD:${remoteBranch}`;
}

async function pushToNewBranch(summary: string) {
  console.log("Pushing to new branch...");
  const branch = generateBranchName();
  await $`git checkout -b ${branch}`;
  await $`git add .`;
  await $`git commit -m "${summary}
  
Co-authored-by: ${actor} <${actor}@users.noreply.github.com>"`;
  await $`git push -u origin ${branch}`;
  return branch;
}

async function createPR(
  base: string,
  branch: string,
  title: string,
  body: string
) {
  console.log("Creating pull request...");
  const pr = await octoRest.rest.pulls.create({
    owner,
    repo,
    head: branch,
    base,
    title,
    body: buildComment(body),
  });
  return pr.data.number;
}

async function runOpencode(
  prompt: string,
  opts?: {
    share?: boolean;
  }
) {
  console.log("Running opencode...");

  const promptPath = path.join(os.tmpdir(), "PROMPT");
  await Bun.write(promptPath, prompt);
  const ret = await $`cat ${promptPath} | opencode run -m ${
    process.env.INPUT_MODEL
  } ${opts?.share ? "--share" : ""}`;
  return {
    stdout: ret.stdout.toString().trim(),
    stderr: ret.stderr.toString().trim(),
  };
}

async function branchIsDirty() {
  console.log("Checking if branch is dirty...");
  const ret = await $`git status --porcelain`;
  return ret.stdout.toString().trim().length > 0;
}

async function fetchRepo() {
  return await octoRest.rest.repos.get({ owner, repo });
}

async function fetchIssue() {
  console.log("Fetching prompt data for issue...");
  const issueResult = await octoGraph<IssueQueryResponse>(
    `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      title
      body
      author {
        login
      }
      createdAt
      state
      comments(first: 100) {
        nodes {
          id
          databaseId
          body
          author {
            login
          }
          createdAt
        }
      }
    }
  }
}`,
    {
      owner,
      repo,
      number: issueId,
    }
  );

  const issue = issueResult.repository.issue;
  if (!issue) throw new Error(`Issue #${issueId} not found`);

  return issue;
}

function buildPromptDataForIssue(issue: GitHubIssue) {
  const comments = (issue.comments?.nodes || [])
    .filter((c) => {
      const id = parseInt(c.databaseId);
      return id !== commentId && id !== payload.comment.id;
    })
    .map((c) => `  - ${c.author.login} at ${c.createdAt}: ${c.body}`);

  return [
    "Here is the context for the issue:",
    `- Title: ${issue.title}`,
    `- Body: ${issue.body}`,
    `- Author: ${issue.author.login}`,
    `- Created At: ${issue.createdAt}`,
    `- State: ${issue.state}`,
    ...(comments.length > 0 ? ["- Comments:", ...comments] : []),
  ].join("\n");
}

async function fetchPR() {
  console.log("Fetching prompt data for PR...");
  const prResult = await octoGraph<PullRequestQueryResponse>(
    `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      body
      author {
        login
      }
      baseRefName
      headRefName
      headRefOid
      createdAt
      additions
      deletions
      state
      baseRepository {
        nameWithOwner
      }
      headRepository {
        nameWithOwner
      }
      commits(first: 100) {
        totalCount
        nodes {
          commit {
            oid
            message
            author {
              name
              email
            }
          }
        }
      }
      files(first: 100) {
        nodes {
          path
          additions
          deletions
          changeType
        }
      }
      comments(first: 100) {
        nodes {
          id
          databaseId
          body
          author {
            login
          }
          createdAt
        }
      }
      reviews(first: 100) {
        nodes {
          id
          databaseId
          author {
            login
          }
          body
          state
          submittedAt
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              path
              line
              author {
                login
              }
              createdAt
            }
          }
        }
      }
    }
  }
}`,
    {
      owner,
      repo,
      number: issueId,
    }
  );

  const pr = prResult.repository.pullRequest;
  if (!pr) throw new Error(`PR #${issueId} not found`);

  return pr;
}

function buildPromptDataForPR(pr: GitHubPullRequest) {
  const comments = (pr.comments?.nodes || [])
    .filter((c) => {
      const id = parseInt(c.databaseId);
      return id !== commentId && id !== payload.comment.id;
    })
    .map((c) => `  - ${c.author.login} at ${c.createdAt}: ${c.body}`);

  const files = (pr.files.nodes || []).map(
    (f) => `  - ${f.path} (${f.changeType}) +${f.additions}/-${f.deletions}`
  );
  const reviewData = (pr.reviews.nodes || []).map((r) => {
    const comments = (r.comments.nodes || []).map(
      (c) => `      - ${c.path}:${c.line ?? "?"}: ${c.body}`
    );
    return [
      `  - ${r.author.login} at ${r.submittedAt}:`,
      `    - Review body: ${r.body}`,
      ...(comments.length > 0 ? ["    - Comments:", ...comments] : []),
    ];
  });

  return [
    "Here is the context for the pull request:",
    `- Title: ${pr.title}`,
    `- Body: ${pr.body}`,
    `- Author: ${pr.author.login}`,
    `- Created At: ${pr.createdAt}`,
    `- Base Branch: ${pr.baseRefName}`,
    `- Head Branch: ${pr.headRefName}`,
    `- State: ${pr.state}`,
    `- Additions: ${pr.additions}`,
    `- Deletions: ${pr.deletions}`,
    `- Total Commits: ${pr.commits.totalCount}`,
    `- Changed Files: ${pr.files.nodes.length} files`,
    ...(comments.length > 0 ? ["- Comments:", ...comments] : []),
    ...(files.length > 0 ? ["- Changed files:", ...files] : []),
    ...(reviewData.length > 0 ? ["- Reviews:", ...reviewData] : []),
  ].join("\n");
}

async function revokeAppToken() {
  if (!appToken) return;

  await fetch("https://api.github.com/installation/token", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${appToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}
