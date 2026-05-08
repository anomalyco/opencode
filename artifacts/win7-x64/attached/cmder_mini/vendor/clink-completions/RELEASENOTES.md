# Release Notes

## 0.5.1 (Mar 8, 2024)

  * Add completions for [`dirx`](https://github.com/chrisant996/dirx).
  * Add completions for [`eza`](https://github.com/eza-community/eza).
  * Add completions for [`fd`](https://github.com/sharkdp/fd).
  * Add completions for [`rg`](https://github.com/BurntSushi/ripgrep) (ripgrep).
  * Update many of the completion scripts to support icons when [Icons in File Completions](https://github.com/chrisant996/clink-gizmos#setting-up-icons-in-file-completions) from [clink-gizmos](https://github.com/chrisant966/clink-gizmos) is loaded and enabled.
  * Update `git status` to include `-unormal`.
  * Update `net` completions to support `net use /d`.
  * Update `wt` and `start` completions so that completions also work while inputing the commands for `wt` or `start` to launch.

## 0.5.0 (Nov 28, 2023)

  * `b192f9` Improve syntax handling for `doskey` completions.
  * `35296a` Fix quoting scheme names when using `colortool`.
  * `d4ef79` Add completions for Windows Terminal (`wt`).
  * `d10a4a` Add completions for the Windows `sort` command (including its undocumented `/uniq` flag).
  * `09aaaf` Add completions for CMD's built-in `dir` command.
  * `4e897a` Add completions for `robocopy`'s `/copy:` and `/dcopy:` flags.
  * `f5fe5b` Completions work within the `doskey` macro definition when using recent versions of Clink (e.g. `doskey macroname=completions_work_here`).
  * `932ce8` Add completions for CMD's built-in `for` and `start` commands.
  * `6ebf67` Add completions for `winget`'s logging flags.
  * `57722e` Add completions for [`bat`](https://github.com/sharkdp/bat), [`cmdkey`](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmdkey), and [`delta`](https://github.com/dandavison/delta).

## 0.4.11 (Oct 1, 2023)

  * `4e40a6` [ssh] Add option completions (#179).
  * `4e89a8` [git] Improve completions for git:
    * Use colors to categorize git command names (common, aliases, other).
    * Add more flag completions for the `git help` command.
	* Fix `git add` completions to work for the 2nd, 3rd, etc arguments.
    * Fix to include git external commands when generating command completions.
    * Fix to include aliases even when current directory is outside a repo.
    * Fix to generate completions for `git help` even when using older versions of Clink.
  * `836a66` [git] Fix completing stash names (need quotes).
  * `367bb4` [git] Fix compatibility with older versions of Clink.

## 0.4.10 (Jun 10, 2023)

  * `22ebe4` [git] Fix to remove leftover test code (#176).

## 0.4.9 (Jun 10, 2023)

  * `9c16b1` [git] Add `--no-optional-locks` when invoking git.
  * `9c16b1` [git] Add completions for `gitk`.
  * `beffd8` [git] Fix `git add` completions to not list staged files (#173).
  * `59fe66` Add completions for `ping`.
  * `7a6e05` Update `ssh` and `ping` completions (#175).
  * `06ae0b` Add completions for `signtool`.
  * `50b2bc` [git] Fix script error when directory name in a git repo contains a `%` character.
  * `bb6758` [git] Add a global DISABLE_GIT_REMOTE_IN_PROMPT variable that can disable adding " -> {remote}" after a branch name.
  * `bcfcfa` [git] Small performance improvement in repos with very large git config files.

## 0.4.8 (May 15, 2023)

  * `3e3d9e` Add completions for `nmake` and GNU `make` (#172).
  * `792451` (internal) Add "directory" keyword in GNU help parser.
  * `dd6767` [git] Fix `git add` completions to be relative to cwd (#171).
  * `44937d` [scoop] Add commands "cat", "download", and "import" (#167).
  * `0a0792` [common] Clarify installation steps in the README.
  * `46de38` [git] Add missing description for `git add -A`.

## 0.4.7 (Feb 15, 2023)

  * `504a55` Add completions for `gsudo` (from [gsudo](https://github.com/gerardog/gsudo)).
  * `19d2f7` Update quoting support in `winget` completions.
  * `bdb67a` Improve completions when `sudo` from [sudo-windows](https://github.com/chrisant996/sudo-windows) is used.

## 0.4.6 (Feb 1, 2023)

  * `7c22a6` Add descriptions for `winget` flag and arg completions.
  * `190f6d` (internal) Add `arghelper.make_arg_hider_func()` helper function that argmatchers can use.

## 0.4.5 (Jan 28, 2023)

  * `af42a5` Fix error in `openssl` completions (#165).
  * `af01e4` Improve `winget` completions (#164).

## 0.4.4 (Jan 14, 2023)

  * `c3433f` Fix error in ssh completions (#163).

## 0.4.3 (Jan 14, 2023)

  * `d57a33` Add completions for wireless devices for `adb` and `scrcpy` (#162).
  * `992fad` Add completions for `openssl` and enhance completions for `ssh`.
  * `8e222c` Fix chocolatey completion script when chocolatey is not installed.
  * `5a9b90` Add another flag for `code` completions (VSCode).

## 0.4.2 (Dec 1, 2022)

  * `a83181` Add completions for `code` (VSCode).
  * `fa1873` Fix `adb` and `scrcpy` initialization (#159).
  * `3df1c9` [git] Add `--staged` for `git diff`.
  * `a7a430` [git] Add `--no-index`, `--cached`, `--merge-base` for `git diff`.
  * `fca377` [common] Fix completions after a sub-parser (e.g. `git show --diff-merges=1 -`<kbd>Tab</kbd>).
  * `a07bb2` [git] Add `git rev-parse` completions.
  * `2cac40` Add completions for `colortool`.
  * `7d666b` [git] Add `git tag` completions.
  * `8d5738` [git] Add descriptions for some `git` command flags.

## 0.4.1 (Aug 30, 2022)

  * `d1de7d` Fix `fastboot` and `scrcpy` script errors (#158)
  * `1e3adb` Fix `abd` script errors (#157)
  * `8b99d9` [git] Complete tags for `git checkout` (#61)

## 0.4.0 (Aug 25, 2022)

This update includes many improvements.  Using the latest version of [Clink](https://github.com/chrisant996/clink) is always recommended.  Older versions of Clink may be used, but some features will not be available.

  * `8519ae` [git] Add file match colors in `git add` and `git checkout`
  * `fd6c9d` Major enhancements and fixes (#156)
    * Better display of `yarn` completions (#76).
    * Add completions for `adb`, `fastboot`, and `scrcpy` tools for Android devices.
    * Add completions for GNU `grep` and `sed`.
    * Add completions for `msbuild` and `premake5`.
    * Add completions for `attrib`, `dir`, `doskey`, `findstr`, `less`, `robocopy`, and `xcopy`.
    * Add completions for `winget` (#131)
    * Smarter completions for `git add` and `git checkout`.
    * Add completions for `sudo` (#145)
    * Add completions for `curl` (#16)
    * .init.lua isn't copied by some file sync tools (#117)
    * Show remote remote branches in `git merge` (#103)
  * `90275b` [common] Add `matchers.ext_files(wildcard)` helper function (#122)
  * `292814` Many improvements (#149)
    * Major improvements to `git` completions.
    * `scoop` completions get the HOME directory optimally.
    * Enhanced support for newer versions of Clink.
  * `9ab934` [git] Add `git revert` completions (#144)
  * `0e240d` [yarn] Completions for `yarn` scripts/bins when used without `run` (#143)
  * `1e5f40` [git] Fast git prompt filter (#142)

And misc other minor changes.

## 0.3.7 (Apr 10, 2021)

  * `0a9ea6b` [ssh] Allow - in known hosts (#139)
  * `e2784e0` [cmder] Check for global cmderGitStatusOptIn var (#141)
  * `dc590e8` [git] Colored completions for `git checkout ...` with Clink v1.1.12 popup list (#135)
  * `a9b3134` [common] Update JSON.lua (#137)
  * `4cf49eb` [scoop] Fix scoop config discovery (#134)

## 0.3.6 (Dec 16, 2020)

  * `c9ed54d` [git] Fix stash completions (0 based). (#133)
  * `82a0311` [git] Fix stash completion to work west of GMT. (#132)
  * `a63cbca` [git] Add completions for git-worktree (#130)
  * `b6a521f` [scoop] added commands "hold" and "unhold" (#129)
  * `f639287` [npm] Extend completions (#125)
  * `04541ff` [git] Add support for `git remote get-url ...` (#124)

## 0.3.5 (Dec 5, 2019)

  * `eb3099e` [git] Add `restore` and `switch` commands (#119)
  * `50954bc` [.net] Add completions for dotnet (#120)
  * `aa0541f` [k8s] Basic kubectl completion script (#113)
  * `a3339f8` [py] Added pipenv completion (#111)
  * `8228a33` [py] Added pip completion (#110)
  * `b366d5d` [scoop] Added scoop completions (#109)
  * `4a8056d` [.net] Add netcoreapp3.1 (#123)

## 0.3.4 (Aug 19, 2019)

Improvements/bugfixes for git completions/prompt

  * `f85c7a1` [git] fix gsub branch (#114)
  * `bf114aa` [git] Add support for detecting branch names in worktrees (#96)
  * `5d33037` [git] Add missing clone options for git (#106)
  * `b2d207d` [net] Add three remaining help topics (#107)
  * `781c0bf` Don't default to origin if no remote is configured (#102)

## 0.3.3 (Oct 24, 2017)

A lot of improvements for vagrant completions (thanks to @Andegawen) and a few bugfixes for `yarn`, `ssh` and `git`.

  * `af5f6d1` [git] Fix git main worktree detection (#95)
  * `032ff0c` [vagrant] Close Vagrantfile after usage (#93)
  * `757c096` [vagrant] Enhance regex for finding provision names (#91)
  * `84884db` [vagrant] Vagrant list provisions on `--provision-with`  (#88)
  * `59055f7` [vagrant] add `global-status` and `snapshot` commands  (#86)
  * `e4d562a` [ssh] Improves pattern matching for searching hosts (#85)
  * `34d3c0c` [common] Make luacheck happy (#83)
  * `f1898a0` [git] Support completing files for `git diff` (#82)
  * `c288656` [yarn] Suggest installed executables for yarn run
  * `162d402` [common] Fix arguments clobbering 'table' class
  * `a552d8c` [chore] Remove trailing whitespace to pass CI (#70)
  * `3f635f9` [yarn] Upgrade commands for Yarn v0.17.8 (#69)
  * `b76867a` [git] Add support for fetch --all (#68)
  * `8edbf28` Add completions for angular-cli (#67)
  * `9cc940c` [common] Enable luacheck
  * `a369227` [common] Configure CI
  * `0714e67` [common] Add tests for funclib and color modules
  * `a4c83df` [test] Add test harness and instructions
  * `834dbf3` [git] Display git push destination in prompt

## 0.3.2 (Nov 6, 2016)

This release adds completions for `yarn` package manager and a bunch of minor improvements and bugfixes

  * `9789bc8` [npm] Improve prompt output in some situations
  * `795f6a9` [npm] Resolve lua error when package.json is empty
  * `fea1e21` [git] Add completions for 'git difftool'
  * `f840079` Add completions for Yarn v0.14
  * `8400a8b` [git] Add basic completions for cherry-pick
  * `f411878` [git] Complete branches in `git reset`
  * `83c71e1` [vagrant] Fix help parser for Vagrant completions
  * `2845966` [npm] Add version flag
  * `1e3931f` [git] '--prune' option for 'fetch'
  * `cc51616` [cordova] Add statusbar to core plugins


## 0.3.1 (June 11, 2016)

This release adds a few fixes and small improvements for `npm` prompt and completions

  * `f2e335d` [npm] Do not query global modules when completing FS paths in 'npm link'
  * `c59c0d9` [npm] Improve package.json handling for npm prompt
  * `6edf054` [npm] Do not fetch package name and version for private packages
  * `23d7599` [npm] Improve package.json parsing

## 0.3.0 (May 8, 2016)

This release adds support for completions inside of git submodules and a completions for a couple of new commands (`ssh` and `nvm`)

  * `21464d1` [ssh] Refactor hosts search logic
  * `26f4f99` [ssh] Add ssh completion from known_hosts file
  * `9a4d308` [nvm] Add basic nvm completions
  * `3c25f96` [git] Housekeeping
  * `b39e617` [git] Fix fetch --tags completion
  * `99140d1` [git] Allow multiple branches for git branch -d
  * `087874b` [cordova] Add a couple of new completions for coho
  * `e4cf69d` [cordova] Remove old core plugin IDs from 'plugin add/rm'
  * `a14af9c` [git] Adds basic support for submodules
  * `e2467f6` [choco] Fix chocolatey non-meta packages listing
  * `9540aa6` [npm] Adds 'npm outdated' flags
  * `91cef45` [ssh] Adds ssh autocomplete script

## 0.2.2 (Dec 10, 2015)

Another bugfix release. Multiple small fixes for git inclded.

  * `83ef129` [git] Fixes failure when trying to complete git commmands outside of repo
  * `7f4c223` [git] add merge strategies and options parsers to pull/rebase/checkout
  * `faf92f2` [git] Distinguish real and suggestes branch names
  * `ad24a7f` [git] Adds "core.trustctime" to available options
  * `e6921a3` [npm] Query npm config lazily (only when required by completions)
  * `03bec42` [git] Adds completions for `git remote update`
  * `2ea5f33` [git] Close packed-refs after reading
  * `e92d5a2` [git] Complete non-checked local branches based on remote ones.
  * `a68ed47` [git] List remote branches based on packed-refs file.

## 0.2.1 (Oct 21, 2015)

Minor bugfix release for 0.2.0. This release mostly fixes various bugs, found after 0.2.0 is out.

  * `1cea322` [npm] Fix npm prompt failure when parsing malformed package.json
  * `cfaf17d` [git] Remove ugly error message when trying to complete git aliases without git in PATH
  * `d2ac838` [git] Fixes broken 'git add'. This closes #34
  * `e09a9b0` [git] Adds user.name and user.email to known options
  * `6999fdf` [npm] Fixes issue with completing 'npm run' in non-npm directory. This fixes #33
  * `46fd830` [npm] Handle package scripts with quotes properly
  * `c20e421` [common] Merge npm prompt into regular 'npm' module
  * `4050dc9` [npm] Complete global packages and local dirs for npm link

## 0.2.0 (Oct 05, 2015)

#### Git

  * `b9a80e8` [git] Complete remotes using gitconfig
  * `c8e1ac5` [git] Adds local branches to git checkout (was broken by 751ed21)
  * `2f1ea08` [git] Improves branches completion for git push
  * `751ed21` [git] Fixes checkout completion to list branches correctly.
  * `33a086a` [git] Adds completion for git config
  * `822e92e` [git] Adds git stash completion
  * `b9be7d8` [git] Adds completion of nested branches (prefix/branch)
  * `c7e4f3d` [git] Refactors git completions logic
  * `5c589fd` [git] Fixes matchers usage
  * `9eb775f` [git] Refactors git completions logic, adds git reset completion
  * `94b6a71` [git] Adds alias autocompletion
  * `7f1ea3b` [git] Adds autcompletion for remote branches
  * `579ff78` [git] Adds git-svn autocompletion
  * `dea2c04` [git] Adds completions for git remote command
  * `f692cd4` [git] Removes unexistent commands like rebase--*

#### Chocolatey

  * `e6efea2` [choco] Adds feature parser
  * `2fbb271` [choco] Updates choco completions according to v0.9.9

#### Cordova

  * `524b88e` [coho] Adds more commands
  * `57762ef` [cordova] Adds --browserify flag
  * `a1caddb` [coho] Complete repo names
  * `2258ff9` [coho] Adds merge-pr command
  * `04d46e9` [coho] Adds npm-link

#### NPM

  * `f9af8fe` [npm] Adds support for 'npm publish'
  * `5875a6e` [npm] Fixes module loading when Node is not installed
  * `7132894` [npm] Adds npm update and npm cache completions

#### Common

  * `3e4c88d` [common] Refactor to reuse table wrapper where possible
  * `f2ba478` [common] Fixes problem with dirs matchers
  * `7869df4` [common] Implements tables wrapper
  * `eafc11b` [common] Removes unwanted . and .. directories in some completions
  * `3f8cd6b` [common] Adds development/contribution notes
  * `7920243` [common] Slightly updates funclib, adds luadoc
  * `f66b0c2` Remove outdated info about extended branch.
  * `3c023d3` Fix for Nil needle value when calling clink.is_match()
  * `2491d21` [common] Updates completions to depend on shared modules
  * `d91ba44` [common] Factors various util functions into modules system
  * `1b48a48` [common] Merges extended completions into master
  * `eaefce3` [common] Adds link to Clink to README

## 0.1.0 (Mar 20, 2015)

Initial release. No changelog until this moment.
