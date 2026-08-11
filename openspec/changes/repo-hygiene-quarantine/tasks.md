## 1. Quarantine tracked-but-gitignored files

- [x] 1.1 Run `git rm --cached -r <path>` for each offending prefix (.opencode/, .vscode/, packages/) and commit.
- [x] 1.2 Verify `git ls-files --cached -i --exclude-standard` returns empty.
