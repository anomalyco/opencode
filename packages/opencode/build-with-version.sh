#!/bin/bash

export OPENCODE_CHANNEL=latest
export OPENCODE_VERSION=1.2.27

rm -rf dist
bun run script/build.ts

echo "Build complete with version 1.2.27"
echo "Now test the binary:"
./dist/opencode-linux-x64/bin/opencode --version