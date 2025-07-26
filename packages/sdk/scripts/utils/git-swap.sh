#!/usr/bin/env bash
set -exuo pipefail
# the package is published to NPM from ./dist
# we want the final file structure for git installs to match the npm installs, so we

# delete everything except ./dist and ./node_modules
find . -maxdepth 1 -mindepth 1 ! -name 'dist' ! -name 'node_modules' -exec rm -rf '{}' +

# move everything from ./dist to .
mv dist/* .

# delete the now-empty ./dist
rmdir dist
