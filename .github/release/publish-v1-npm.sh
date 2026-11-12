#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
in=$(cd "$1" && pwd)
group=$2
cd "$(mktemp -d)"
export NPM_CONFIG_USERCONFIG="$PWD/npmrc"
printf 'registry=https://registry.npmjs.org/\nignore-scripts=true\n' > "$NPM_CONFIG_USERCONFIG"
case $OPENCODE_CHANNEL in dev|latest) ;; *) die 'Unexpected npm dist-tag' ;; esac

publish() {
  local name=$1 dir=$2 filename manifest current
  filename=${name#@}; filename=${filename/\//-}-$OPENCODE_VERSION.tgz
  manifest=$(tar -xzOf "$in/$dir/$filename" package/package.json)
  jq -e --arg name "$name" --arg version "$OPENCODE_VERSION" \
    '.name==$name and .version==$version and (((.publishConfig // {}) | keys - ["access"]) == [])' \
    <<< "$manifest" >/dev/null || die "Unexpected manifest in $filename"
  if ! npm view "$name@$OPENCODE_VERSION" version >/dev/null 2>&1; then
    npm publish "$in/$dir/$filename" --tag "$OPENCODE_CHANNEL" --access public --ignore-scripts --registry=https://registry.npmjs.org/
  fi
}

targets=(linux-arm64 linux-x64 linux-x64-baseline linux-arm64-musl linux-x64-musl linux-x64-baseline-musl darwin-arm64 darwin-x64 darwin-x64-baseline windows-arm64 windows-x64 windows-x64-baseline)
case $group in
  dependencies)
    for target in "${targets[@]}"; do
      case $target in darwin-*) dir=sign-macos ;; windows-*) dir=sign-windows ;; *) dir=build-npm ;; esac
      publish "opencode-$target" "$dir"
    done
    for lib in sdk plugin ui; do publish "@opencode-ai/$lib" build-npm; done
    ;;
  wrapper)
    for target in "${targets[@]}"; do
      for attempt in {1..120}; do
        if npm view --prefer-online "opencode-$target@$OPENCODE_VERSION" version >/dev/null 2>&1; then break; fi
        [[ $attempt -lt 120 ]] || die "opencode-$target is not available at $OPENCODE_VERSION"
        sleep 5
      done
    done
    publish opencode-ai build-npm
    ;;
  *) die 'Unknown publish group' ;;
esac
