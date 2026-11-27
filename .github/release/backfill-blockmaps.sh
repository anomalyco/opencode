#!/usr/bin/env bash
# backfill-blockmaps.sh <version>...: builds the .blockmap for each published Windows installer and macOS zip of
# the given stable versions from the signed files on opencode.ai/files and uploads it next to them. Releases before
# publish-desktop.sh built blockmaps shipped without them, so electron-updater could not update differentially
# from them. A blockmap that already exists is left alone; a file the version never shipped is skipped.
. "$(dirname "$0")/lib.sh"

actor=${GITHUB_TRIGGERING_ACTOR:-${GITHUB_ACTOR:-}}
if ! (shopt -s nocasematch; [[ "$actor" = thdxr || "$actor" = Hona || "$actor" = rekram1-node ]]); then
  die "${actor:-An unknown actor} is not allowed to backfill release files"
fi
[ $# -gt 0 ] || die "No versions given"
for version in "$@"; do
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] && [[ "$version" != 0.0.0-* ]] ||
    die "Invalid release version: $version"
done

names=(opencode-desktop-win-arm64.exe opencode-desktop-win-x64.exe opencode-desktop-mac-arm64.zip opencode-desktop-mac-x64.zip)
status() {
  curl -sS -o /dev/null -w '%{http_code}' --head "$1"
}

credentials=false
for version in "$@"; do
  dir=$(mktemp -d)
  for name in "${names[@]}"; do
    url="https://opencode.ai/files/bin/$version/$name"
    case "$(status "$url.blockmap")" in
      200) echo "$version/$name.blockmap exists" && continue ;;
      404) ;;
      *) die "Could not check $url.blockmap" ;;
    esac
    case "$(status "$url")" in
      200) ;;
      404) echo "$version/$name was not published" && continue ;;
      *) die "Could not check $url" ;;
    esac
    curl -fsSL --retry 3 -o "$dir/$name" "$url"
    node "$release_dir/blockmap.mjs" "$dir/$name"
    if dry_run; then
      echo "dry-run upload: bin/$version/$name.blockmap ($(size "$dir/$name.blockmap") bytes)"
      continue
    fi
    if [ "$credentials" = false ]; then
      r2_credentials
      credentials=true
    fi
    OPENCODE_VERSION=$version upload_file "$dir/$name.blockmap" "$name.blockmap" application/octet-stream ||
      die "Upload failed: $version/$name.blockmap"
    echo "uploaded bin/$version/$name.blockmap"
  done
  rm -rf "$dir"
done
