#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

version=${GITHUB_REF_NAME#process-daemon-v}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || die 'Invalid daemon version'
registry=https://registry.npmjs.org
# Validate every package before the first write. Publish the dispatcher last.
packages=(pty-darwin-{arm64,x64} pty-linux-{arm64,x64}-{gnu,musl} pty-win32-{arm64,x64} pty)
for package in "${packages[@]}"; do
  file="$1/opencode-$package-$version.tgz"
  tar -xOzf "$file" package/package.json | jq -es --arg name "@opencode/$package" --arg version "$version" '
    length == 1 and (.[0] | .name == $name and .version == $version and
      ((.publishConfig // {}) | del(.access) == {}))' >/dev/null || die "Unexpected manifest for $package"
done
for package in "${packages[@]}"; do
  if ! npm view --registry="$registry" "@opencode/$package@$version" version >/dev/null 2>&1; then
    npm publish --registry="$registry" --ignore-scripts --access public --provenance "$1/opencode-$package-$version.tgz"
  fi
done
