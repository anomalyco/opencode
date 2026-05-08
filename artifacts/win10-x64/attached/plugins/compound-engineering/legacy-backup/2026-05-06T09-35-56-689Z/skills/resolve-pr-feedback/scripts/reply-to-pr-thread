#!/usr/bin/env bash

# Replies to a PR review thread. Body is read from stdin to avoid
# shell escaping issues with markdown (quotes, newlines, etc.).

set -e

if [ $# -lt 1 ]; then
    echo "Usage: echo 'reply body' | reply-to-pr-thread THREAD_ID"
    echo "Example: echo 'Addressed: added null check' | reply-to-pr-thread PRRT_kwDOABC123"
    exit 1
fi

THREAD_ID=$1
BODY=$(cat)

if [ -z "$BODY" ]; then
    echo "Error: No body provided on stdin."
    exit 1
fi

gh api graphql -f threadId="$THREAD_ID" -f body="$BODY" -f query='
mutation ReplyToReviewThread($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: $threadId
    body: $body
  }) {
    comment {
      id
      url
    }
  }
}'
