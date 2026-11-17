#!/usr/bin/env bash
# Builds the press page's media from the real product videos in public/product-videos: extra stills
# (frames picked by hand from the archived real-straight films, the stills only), small JPG thumbnails for the gallery, one zip
# per product (images/ and videos/ folders) and one zip with everything. Writes public/press-media/manifest.json with the frame
# times and zip sizes, which src/lib/press-content.ts reads. Run from packages/console/app.
set -euo pipefail

videos=public/product-videos
# The stills come from the real-straight films, archived with the other panning cuts (Nov 3 2026)
# next to the checkout; the films and posters come from the "locked" set.
stills=${PRESS_STILLS_DIR:-../../../../archive/product-videos/real-straight}
# Terminal's stills track the TUI on dev: four held close-ups (home, diff, permission, themes) cut by
# product-videos/cinematic/edits/press-terminal.json from the capture-assets.ts terminal-feature film.
terminal_stills=${PRESS_TERMINAL_STILLS:-../../../../product-videos/cinematic/out/v2/press/terminal-landscape.mp4}
out=public/press-media
rm -rf "$out"
mkdir -p "$out/frames" "$out/thumbs" "$out/zips"

# Seconds into $stills/<slug>-landscape.mp4 ($terminal_stills for terminal) where the UI is still and readable.
frames() {
  case "$1" in
    desktop) echo "2.2 11.4 14.2 22.2" ;;
    mobile) echo "3.4 14.6 22.2" ;;
    terminal) echo "0.5 1.5 2.5 3.4" ;;
    sdk) echo "4.4 8.4 18 23" ;;
  esac
}

thumb() { # source, name, width
  ffmpeg -v error -y -i "$1" -vf "scale=$3:-2" -q:v 4 "$out/thumbs/$2.jpg"
}

manifest="{"
for slug in desktop mobile terminal sdk; do
  index=0
  for time in $(frames "$slug"); do
    index=$((index + 1))
    source="$stills/$slug-landscape.mp4"
    [ "$slug" = terminal ] && source="$terminal_stills"
    ffmpeg -v error -y -ss "$time" -i "$source" -frames:v 1 -q:v 2 \
      "$out/frames/$slug-frame-$index.jpg"
    thumb "$out/frames/$slug-frame-$index.jpg" "$slug-frame-$index" 960
  done
  for set in locked; do
    thumb "$videos/$set/$slug-landscape.jpg" "$slug-$set-landscape" 960
    thumb "$videos/$set/$slug-portrait.jpg" "$slug-$set-portrait" 640
  done
  for clip in 1 2 3; do
    thumb "$videos/features/$slug-$clip.jpg" "$slug-feature-$clip" 960
  done

  # The product's zip: every still and poster in images/, every video in videos/, with plain names.
  staging=$(mktemp -d)
  root="$staging/opencode-$slug"
  mkdir -p "$root/images" "$root/videos"
  cp "$out"/frames/"$slug"-frame-*.jpg "$root/images/"
  for set in locked; do
    name=film
    for aspect in landscape portrait; do
      cp "$videos/$set/$slug-$aspect.jpg" "$root/images/$slug-$name-$aspect.jpg"
      cp "$videos/$set/$slug-$aspect.mp4" "$root/videos/$slug-$name-$aspect.mp4"
    done
  done
  for clip in 1 2 3; do
    cp "$videos/features/$slug-$clip.jpg" "$root/images/$slug-feature-$clip.jpg"
    cp "$videos/features/$slug-$clip.mp4" "$root/videos/$slug-feature-$clip.mp4"
  done
  (cd "$staging" && zip -q -X -r "$OLDPWD/$out/zips/opencode-$slug-media.zip" "opencode-$slug")
  mkdir -p "$out/all"
  mv "$staging/opencode-$slug" "$out/all/"
  rm -rf "$staging"

  bytes=$(stat -f %z "$out/zips/opencode-$slug-media.zip")
  times=$(frames "$slug" | sed 's/ /, /g')
  manifest+="\"$slug\": { \"frames\": [$times], \"zipBytes\": $bytes },"
done

rm -f public/opencode-press-media.zip
(cd "$out/all" && zip -q -X -r "$OLDPWD/public/opencode-press-media.zip" .)
rm -rf "$out/all"
all=$(stat -f %z public/opencode-press-media.zip)
manifest+="\"allZipBytes\": $all }"
echo "$manifest" > "$out/manifest.json"
echo "Wrote $out and public/opencode-press-media.zip"
