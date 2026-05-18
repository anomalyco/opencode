#!/usr/bin/env bash
#
# detect-project-type.sh — inspect signature files at the repo root (and, if
# no root match is found, probe shallow subdirectories) to emit a project-type
# identifier on stdout.
#
# Usage:
#   detect-project-type.sh
#
# Output grammar (one line on stdout):
#
#   <type>                              — single signature match at root
#                                         e.g. "next", "rails", "vite"
#
#   <type>@<relative-dir>              — single monorepo hit (no root match)
#                                         e.g. "next@apps/web"
#
#   multiple                            — two or more disjoint root signatures
#                                         (caller must prompt for disambiguation)
#
#   multiple:<type>@<dir>,<type>@<dir>  — multiple monorepo hits (no root match)
#                                         e.g. "multiple:next@apps/web,rails@apps/api"
#
#   unknown                             — no signatures found at root or in probe
#
# Supported root types: rails, next, vite, nuxt, astro, remix, sveltekit, procfile
#
# Monorepo probe:
#   Runs only when root detection finds ZERO matches. Searches subdirectories
#   up to depth 3 (e.g. services/api/server/vite.config.ts) for framework
#   signature files. Deeper nesting is ignored to avoid false positives.
#
#   Excluded directories (not real project roots):
#     node_modules .git vendor dist build coverage .next .nuxt
#     .svelte-kit .turbo tmp fixtures
#
# `multiple` vs `rails`: Rails apps commonly ship a Procfile.dev alongside
# bin/dev. To avoid treating every Rails app as a monorepo, the `rails`
# signature takes precedence over a bare `procfile` match. `multiple` is
# reserved for genuine disambiguation cases (e.g., Rails + Next, Next + Vite).

set -u

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: not in a git repository" >&2
  exit 1
fi

cd "$REPO_ROOT" || { echo "ERROR: cannot cd to repo root" >&2; exit 1; }

MATCHES=()

# Rails: bin/dev AND Gemfile together. A Gemfile alone (or bin/dev alone) is
# insufficient -- plenty of gems have Gemfiles without bin/dev, and bin/dev
# may exist in non-Rails projects.
if [ -f "bin/dev" ] && [ -f "Gemfile" ]; then
  MATCHES+=("rails")
fi

# Next.js
if [ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "next.config.ts" ] || [ -f "next.config.cjs" ]; then
  MATCHES+=("next")
fi

# Vite
if [ -f "vite.config.js" ] || [ -f "vite.config.ts" ] || [ -f "vite.config.mjs" ] || [ -f "vite.config.cjs" ]; then
  MATCHES+=("vite")
fi

# Nuxt
if [ -f "nuxt.config.js" ] || [ -f "nuxt.config.mjs" ] || [ -f "nuxt.config.ts" ]; then
  MATCHES+=("nuxt")
fi

# Astro
if [ -f "astro.config.js" ] || [ -f "astro.config.mjs" ] || [ -f "astro.config.ts" ]; then
  MATCHES+=("astro")
fi

# Remix (classic — Remix on Vite uses vite.config.ts, detected as vite)
if [ -f "remix.config.js" ] || [ -f "remix.config.ts" ]; then
  MATCHES+=("remix")
fi

# SvelteKit
if [ -f "svelte.config.js" ] || [ -f "svelte.config.mjs" ] || [ -f "svelte.config.ts" ]; then
  MATCHES+=("sveltekit")
fi

# Procfile / Overmind / Foreman — only if we didn't already detect rails
if [ ${#MATCHES[@]} -eq 0 ] || [ "${MATCHES[0]}" != "rails" ]; then
  if [ -f "Procfile" ] || [ -f "Procfile.dev" ]; then
    MATCHES+=("procfile")
  fi
fi

# ── Root result ──────────────────────────────────────────────────────────────
case ${#MATCHES[@]} in
  0)
    # No root match — run monorepo probe (shallow find, depth <= 3).
    ;;
  1)
    echo "${MATCHES[0]}"
    exit 0
    ;;
  *)
    echo "multiple"
    exit 0
    ;;
esac

# ── Monorepo probe ─────────────────────────────────────────────────────────
# When root detection returns zero matches, descend up to depth 3 looking for
# framework signatures in workspace directories. Common layouts:
#   apps/web/next.config.js        (depth 2)
#   packages/frontend/vite.config.ts (depth 2)
#   services/api/server/vite.config.ts (depth 3)
#
# Exclusion list: directories that ship framework configs as fixtures or build
# output, not as real project roots.

EXCLUDE_DIRS="node_modules .git vendor dist build coverage .next .nuxt .svelte-kit .turbo tmp fixtures"
EXCLUDE_ARGS=""
for d in $EXCLUDE_DIRS; do
  EXCLUDE_ARGS="$EXCLUDE_ARGS -path './$d' -prune -o -path '*/$d' -prune -o"
done

# Signature file patterns to look for
SIGNATURE_PATTERNS=(
  "next.config.js" "next.config.mjs" "next.config.ts" "next.config.cjs"
  "vite.config.js" "vite.config.ts" "vite.config.mjs" "vite.config.cjs"
  "nuxt.config.js" "nuxt.config.mjs" "nuxt.config.ts"
  "astro.config.js" "astro.config.mjs" "astro.config.ts"
  "remix.config.js" "remix.config.ts"
  "svelte.config.js" "svelte.config.mjs" "svelte.config.ts"
)

# Build the find -name arguments
NAME_ARGS=""
for i in "${!SIGNATURE_PATTERNS[@]}"; do
  if [ "$i" -gt 0 ]; then
    NAME_ARGS="$NAME_ARGS -o"
  fi
  NAME_ARGS="$NAME_ARGS -name '${SIGNATURE_PATTERNS[$i]}'"
done

# Run find. Use eval because the dynamically built arguments contain quoted
# strings that must be expanded by the shell.
FOUND_FILES=$(eval "find . -maxdepth 4 $EXCLUDE_ARGS \\( $NAME_ARGS \\) -print" 2>/dev/null | sort)

# Also check for Rails signature (bin/dev + Gemfile in the same subdir)
RAILS_HITS=""
# Find all Gemfiles at depth <= 3, check each dir for bin/dev
while IFS= read -r gemfile; do
  [ -z "$gemfile" ] && continue
  gdir=$(dirname "$gemfile")
  if [ -f "$gdir/bin/dev" ]; then
    RAILS_HITS="$RAILS_HITS
$gdir"
  fi
done < <(eval "find . -maxdepth 4 $EXCLUDE_ARGS -name 'Gemfile' -print" 2>/dev/null)

# Parse found files into (type, relative-dir) pairs. Use a newline-delimited
# string instead of an associative array so the script works on macOS's default
# Bash 3.2 as well as newer Bash versions.
MONO_HITS=""

add_mono_hit() {
  hit="$1"
  if printf '%s\n' "$MONO_HITS" | grep -Fxq "$hit"; then
    return 0
  fi
  MONO_HITS="${MONO_HITS}
${hit}"
}

if [ -n "$FOUND_FILES" ]; then
  for f in $FOUND_FILES; do
    [ -z "$f" ] && continue
    fname=$(basename "$f")
    fdir=$(dirname "$f")
    # Normalize dir: strip leading ./
    fdir="${fdir#./}"

    # Enforce depth cap of 3: count slashes in the relative path of the file.
    # A file at apps/web/next.config.js has dir apps/web (1 slash = depth 2).
    # A file at a/b/c/d/next.config.js has dir a/b/c/d (3 slashes = depth 4 = too deep).
    # We want maxdepth 3 for the directory, meaning at most 2 slashes in fdir.
    slash_count=$(echo "$fdir" | tr -cd '/' | wc -c | tr -d ' ')
    if [ "$slash_count" -gt 2 ]; then
      continue
    fi

    case "$fname" in
      next.config.*) ftype="next" ;;
      vite.config.*) ftype="vite" ;;
      nuxt.config.*) ftype="nuxt" ;;
      astro.config.*) ftype="astro" ;;
      remix.config.*) ftype="remix" ;;
      svelte.config.*) ftype="sveltekit" ;;
      *) continue ;;
    esac

    # Skip root hits (those would have been caught by root detection)
    if [ "$fdir" = "." ]; then continue; fi

    add_mono_hit "${ftype}@${fdir}"
  done
fi

# Add Rails monorepo hits
if [ -n "$RAILS_HITS" ]; then
  for rdir in $RAILS_HITS; do
    [ -z "$rdir" ] && continue
    rdir="${rdir#./}"
    if [ "$rdir" != "." ] && [ -n "$rdir" ]; then
      # Enforce depth cap for Rails hits too
      slash_count=$(echo "$rdir" | tr -cd '/' | wc -c | tr -d ' ')
      if [ "$slash_count" -le 2 ]; then
        add_mono_hit "rails@${rdir}"
      fi
    fi
  done
fi

MONO_HITS=$(printf '%s\n' "$MONO_HITS" | sed '/^$/d' | sort)
MONO_COUNT=$(printf '%s\n' "$MONO_HITS" | sed '/^$/d' | wc -l | tr -d ' ')

case $MONO_COUNT in
  0)
    echo "unknown"
    ;;
  1)
    # Single monorepo hit: emit type@cwd
    printf '%s\n' "$MONO_HITS"
    ;;
  *)
    # Multiple hits: emit multiple:type1@cwd1,type2@cwd2,...
    result=$(printf '%s\n' "$MONO_HITS" | paste -sd, -)
    echo "multiple:$result"
    ;;
esac
