go through each PR merged since the last tag

for each PR spawn a subagent to summarize what the PR was about. focus on user facing changes. if it was entirely internal or code related you can ignore it. also skip docs updates. each subagent should append its summary to UPCOMING_CHANGELOG.md

once that is done, read UPCOMING_CHANGELOG.md and group it into sections for better readability. make sure all PR references are preserved
