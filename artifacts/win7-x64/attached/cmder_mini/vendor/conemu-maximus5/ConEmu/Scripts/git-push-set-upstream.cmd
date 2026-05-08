@echo off

rem Using alias "gppu=git-push-set-upstream.cmd & GitShowBranch.cmd" in ConEmu's
rem Environment it's easy to push new branches to remote repository.
rem The script takes current local branch and push it with --set-upstream flag.

setlocal
for /F "tokens=* USEBACKQ" %%F in (`git rev-parse --abbrev-ref HEAD`) do (
  set "gitbranch=%%F"
)
echo on
git push origin --set-upstream %gitbranch% %*
