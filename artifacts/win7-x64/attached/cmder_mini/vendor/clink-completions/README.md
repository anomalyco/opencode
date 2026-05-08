
[![Build status](https://github.com/vladimir-kotikov/clink-completions/actions/workflows/code-check.yml/badge.svg?branch=master)](https://github.com/vladimir-kotikov/clink-completions/actions/workflows/code-check.yml)
[![codecov](https://codecov.io/gh/vladimir-kotikov/clink-completions/branch/master/graph/badge.svg)](https://codecov.io/gh/vladimir-kotikov/clink-completions)

clink-completions
=================

Completion files for [Clink](https://github.com/chrisant996/clink) util. Bundled with [Cmder](https://github.com/cmderdev/cmder).

Requirements
============

These completions requires Clink v0.4.3 or newer.

Notes
=====

The `master` branch of this repo contains all available completions. If you lack some functionality, post a feature request.

Some completion generators in this bundle use features from the latest Clink distribution. If you get an error messages while using these completions, consider upgrading Clink to the latest version.

If this doesn't help, feel free to submit an issue.

Installation
============

If you're using [Cmder](https://github.com/cmderdev/cmder), then the clink-completions are already bundled with it.

Otherwise, here is the easiest way to install the clink-completions scripts, when using a recent version of [Clink](https://github.com/chrisant996/clink):

1. Make sure you have [git](https://www.git-scm.com/downloads) installed.
2. Clone this repo into a new local directory via `git clone https://github.com/vladimir-kotikov/clink-completions local_directory` (replace `local_directory` with the name of the directory where you want to install the scripts).
  - **Note:** avoid naming it `completions`, because that's a reserved subdirectory name in Clink.  See [Completion directories](https://chrisant996.github.io/clink/clink.html#completion-directories) for more info.
3. Tell Clink to load scripts from the repo via `clink installscripts full_path_to_local_directory`.
  - **Note:** it is important to specify the full path to the directory.
4. Start a new session of Clink.

Repo structure
==============

Script files in the root directory are loaded when Clink starts.

Scripts in the `completions\` directory are not loaded until the associated command is actually used.  Most completion scripts could be located in the completions directory, except that older versions of Clink don't load scripts from the completions directory.

Scripts in the `modules\` directory contain helper functions.  The `!init.lua` script (or `.init.lua` script) tells Clink about the modules and completions directories.

Scripts in the `spec\` directory are tests which the `busted` package can run.


Development and contribution
============================

The new flow is single `master` branch for all more or less valuable changes. The `master` should be clean and show nice history of project. The bugfixes are made and land directly into `master`.

Feature development should be done in a separate topic branch per feature. Submit a pull request for merging the feature into the `master` branch, and include a meaning commit description for the feature changes.

Avoid reusing a topic branch after it's been merged into `master`, because reusing leads to unnecessary merge conflicts. The more the topic branch is reused, the harder it will become to accurately resolve the merge conflicts.

The `dev` branch is volatile and should not be used by contributors.

Test
====

You will need `busted` package to be installed locally (to `lua_modules` directory). To install it
using Luarocks call `luarocks install --tree=lua_modules busted`. You might also want to install
`luacov` to get the coverage information.

After installing call `test.bat` from repo root and watch tests passing. That's it.
