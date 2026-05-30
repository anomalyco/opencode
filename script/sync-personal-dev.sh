#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FORK_REMOTE="fork"
UPSTREAM_REMOTE="origin"
PERSONAL_BRANCH="personal/dev"
UPSTREAM_BRANCH="origin/dev"

echo -e "${GREEN}Syncing ${PERSONAL_BRANCH} with upstream...${NC}"

# Fetch upstream
echo -e "${YELLOW}Fetching upstream...${NC}"
git fetch "$UPSTREAM_REMOTE"

# Check if personal/dev exists
if ! git show-ref --verify --quiet "refs/heads/${PERSONAL_BRANCH}"; then
    echo -e "${RED}Branch ${PERSONAL_BRANCH} does not exist locally.${NC}"
    echo -e "${YELLOW}Create it first with:${NC}"
    echo "  git checkout -b ${PERSONAL_BRANCH} ${UPSTREAM_BRANCH}"
    exit 1
fi

# Checkout personal/dev
git checkout "$PERSONAL_BRANCH"

# Rebase onto upstream dev
echo -e "${YELLOW}Rebasing ${PERSONAL_BRANCH} onto ${UPSTREAM_BRANCH}...${NC}"
if git rebase "$UPSTREAM_BRANCH"; then
    echo -e "${GREEN}Rebase successful!${NC}"
else
    echo -e "${RED}Rebase failed with conflicts.${NC}"
    echo -e "${YELLOW}Resolve conflicts manually, then:${NC}"
    echo "  git add <resolved-files>"
    echo "  git rebase --continue"
    echo "  ${0} --force"
    exit 1
fi

# Push to fork
echo -e "${YELLOW}Pushing to ${FORK_REMOTE}/${PERSONAL_BRANCH}...${NC}"
if [[ "${1:-}" == "--force" ]]; then
    git push "$FORK_REMOTE" "$PERSONAL_BRANCH" --force-with-lease --no-verify
else
    git push "$FORK_REMOTE" "$PERSONAL_BRANCH" --no-verify
fi

echo -e "${GREEN}Done! ${PERSONAL_BRANCH} is now up to date with upstream.${NC}"
echo ""
git log --oneline -5
