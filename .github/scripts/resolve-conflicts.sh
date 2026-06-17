#!/usr/bin/env bash
set -euo pipefail

SUMMARY_FILE="/tmp/resolution-summary.md"

resolved_files=()
escalated_files=()

conflicted_files=$(git diff --name-only --diff-filter=U || true)

{
  echo "## Automated Upstream Sync Resolution Summary"
  echo
  echo "### Conflicted Files"
  echo
} > "$SUMMARY_FILE"

if [ -z "$conflicted_files" ]; then
  echo "No conflicted files detected." >> "$SUMMARY_FILE"
  echo "resolved_count=0" >> "$GITHUB_OUTPUT"
  echo "escalated_count=0" >> "$GITHUB_OUTPUT"
  echo "resolved_files=" >> "$GITHUB_OUTPUT"
  echo "escalated_files=" >> "$GITHUB_OUTPUT"
  echo "can_complete_merge=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

while IFS= read -r file; do
  [ -z "$file" ] && continue

  echo "- \`$file\`" >> "$SUMMARY_FILE"

  case "$file" in
    README*|*.md|docs/*|doco/*)
      git checkout --theirs -- "$file"
      git add "$file"
      resolved_files+=("$file")
      ;;

    *.snap|*.lock|bun.lock|*.json|*.jsonc)
      git checkout --theirs -- "$file"
      git add "$file"
      resolved_files+=("$file")
      ;;

    .github/workflows/*|packages/anr-core/*|*auth*|*telemetry*|*provider*|*bedrock*|*aws*|*oidc*|*federation*)
      git checkout --ours -- "$file"
      git add "$file"
      resolved_files+=("$file")
      ;;

    *)
      escalated_files+=("$file")
      ;;
  esac
done <<< "$conflicted_files"

remaining_conflicts=$(git diff --name-only --diff-filter=U || true)

resolved_csv=$(IFS=, ; echo "${resolved_files[*]:-}")
escalated_csv=$(IFS=, ; echo "${escalated_files[*]:-}")

{
  echo
  echo "### Automated Resolution"
  echo
  echo "- Resolved files: ${#resolved_files[@]}"
  echo "- Escalated files: ${#escalated_files[@]}"
  echo
  echo "### Resolved Files"
  echo
  if [ ${#resolved_files[@]} -eq 0 ]; then
    echo "None"
  else
    for file in "${resolved_files[@]}"; do
      echo "- \`$file\`"
    done
  fi
  echo
  echo "### Escalated Files"
  echo
  if [ ${#escalated_files[@]} -eq 0 ]; then
    echo "None"
  else
    for file in "${escalated_files[@]}"; do
      echo "- \`$file\`"
    done
  fi
  echo
  echo "### Remaining Conflicts"
  echo
  if [ -z "$remaining_conflicts" ]; then
    echo "None"
  else
    echo "$remaining_conflicts" | sed 's/^/- `/' | sed 's/$/`/'
  fi
} >> "$SUMMARY_FILE"

echo "resolved_count=${#resolved_files[@]}" >> "$GITHUB_OUTPUT"
echo "escalated_count=${#escalated_files[@]}" >> "$GITHUB_OUTPUT"
echo "resolved_files=$resolved_csv" >> "$GITHUB_OUTPUT"
echo "escalated_files=$escalated_csv" >> "$GITHUB_OUTPUT"

if [ -z "$remaining_conflicts" ] && [ ${#escalated_files[@]} -eq 0 ]; then
  echo "can_complete_merge=true" >> "$GITHUB_OUTPUT"
else
  echo "can_complete_merge=false" >> "$GITHUB_OUTPUT"
fi