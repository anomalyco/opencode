---
name: codex-pr-body
description: Update the title and body of one or more pull requests.
---

## Determining the PR(s)

When this skill is invoked, the PR(s) to update may be specified explicitly, but in the common case, the PR(s) to update will be inferred from the branch / commit that the user is currently working on. For ordinary Git usage (i.e., not Sapling as discussed below), you may have to use a combination of `git branch` and `gh pr view <branch> --repo openai/codex --json number --jq '.number'` to determine the PR associated with the current branch / commit.

## PR Body Contents

When invoked, use `gh` to edit the pull request body and title to reflect the contents of the specified PR. Make sure to check the existing pull request body to see if there is key information that should be preserved. For example, NEVER remove an image in the existing pull request body, as the author may have no way to recover it if you remove it.

It is critically important to explain _why_ the change is being made. If the current conversation in which this skill is invoked has discussed the motivation, be sure to capture this in the pull request body.

The body should also explain _what_ changed, but this should appear after the _why_.

Limit discussion to the _net change_ of the commit. It is generally frowned upon to discuss changes that were attempted but later undone in the course of the development of the pull request. When rewriting the pull request body, you may need to eliminate details such as these when they are no longer appropriate / of interest to future readers.

Avoid references to absolute paths on my local disk. When talking about a path that is within the repository, simply use the repo-relative path.

It is generally helpful to discuss how the change was verified. That said, it is unnecessary to mention things that CI checks automatically, e.g., do not include "ran `just fmt`" as part of the test plan. Though identifying the new tests that were purposely introduced to verify the new behavior introduced by the pull request is often appropriate.

Make use of Markdown to format the pull request professionally. Ensure "code things" appear in single backticks when referenced inline. Fenced code blocks are useful when referencing code or showing a shell transcript. Also, make use of GitHub permalinks when citing existing pieces of code that are relevant to the change.

Make sure to reference any relevant pull requests or issues, though there should be no need to reference the pull request in its own PR body.

If there is documentation that should be updated on https://developers.openai.com/codex as a result of this change, please note that in a separate section near the end of the pull request. Omit this section if there is no documentation that needs to be updated.

## Working with Stacks

Sometimes a pull request is composed of a stack of commits that build on one another. In these cases, the PR body should reflect the _net_ change introduced by the stack as a whole, rather than the individual commits that make up the stack.

Similarly, sometimes a user may be using a tool like Sapling to leverage _stacked pull requests_, in which case the `base` of the PR may be the a branch that is the `head` of another PR in the stack rather than `main`. In this case, be sure to discuss only the net change between the `base` and `head` of the PR that is being opened against that stacked base, rather than the changes relative to `main`.

## Sapling

If `.git/sl/store` is present, then this Git repository is governed by Sapling SCM (https://sapling-scm.com).

In Sapling, run the following to see if there is a GitHub pull request associated with the current revision:

```shell
sl log --template '{github_pull_request_url}' -r .
```

Alternatively, you can run `sl sl` to see the current development branch and whether there is a GitHub pull request associated with the current commit. For example, if the output were:

```
  @  cb032b31cf  72 minutes ago  mbolin  #11412
╭─╯  tui: show non-file layer content in /debug-config
│
o  fdd0cd1de9  Today at 20:09  origin/main
│
~
```

- `@` indicates the current commit is `cb032b31cf`
- it is a development branch containing a single commit branched off of `origin/main`
- it is associated with GitHub pull request #11412
