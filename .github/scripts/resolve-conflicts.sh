#!/usr/bin/env bash
set -euo pipefail

RULES_FILE="${RULES_FILE:-.github/conflict-rules.conf}"
SUMMARY_FILE="${SUMMARY_FILE:-/tmp/resolution-summary.md}"
ESCALATION_LOG="${ESCALATION_LOG:-.github/conflict-escalations.log}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/tmp/resolve-conflicts-output}"

touch "$GITHUB_OUTPUT"

if [ ! -f "$RULES_FILE" ]; then
  echo "Error: conflict rules file not found: $RULES_FILE" >&2
  echo "can_complete_merge=false" >> "$GITHUB_OUTPUT"
  exit 1
fi

mkdir -p "$(dirname "$ESCALATION_LOG")"

patterns=()
strategies=()

trim() {
  sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  line="$(printf '%s' "$raw_line" | trim)"
  [ -z "$line" ] && continue
  [[ "$line" == \#* ]] && continue

  if [[ "$line" != *:* ]]; then
    echo "Error: invalid conflict rule '$line'. Expected pattern:strategy." >&2
    echo "can_complete_merge=false" >> "$GITHUB_OUTPUT"
    exit 1
  fi

  pattern="${line%%:*}"
  strategy="${line##*:}"
  pattern="$(printf '%s' "$pattern" | trim)"
  strategy="$(printf '%s' "$strategy" | trim)"

  case "$strategy" in
    ours|theirs|escalate) ;;
    *)
      echo "Error: invalid strategy '$strategy' for pattern '$pattern'. Use ours, theirs, or escalate." >&2
      echo "can_complete_merge=false" >> "$GITHUB_OUTPUT"
      exit 1
      ;;
  esac

  patterns+=("$pattern")
  strategies+=("$strategy")
done < "$RULES_FILE"

if [ "${#patterns[@]}" -eq 0 ]; then
  echo "Error: no active conflict rules found in $RULES_FILE" >&2
  echo "can_complete_merge=false" >> "$GITHUB_OUTPUT"
  exit 1
fi

resolved_files=()
resolved_details=()
escalated_files=()

conflicted_files="$(git diff --name-only --diff-filter=U || true)"

{
  echo "## Automated Upstream Sync Resolution Summary"
  echo
  echo "Rules file: \`$RULES_FILE\`"
  echo
  echo "Matching semantics: last matching rule wins. Broad rules should appear first; ANR/custom protected rules should appear later."
  echo
} > "$SUMMARY_FILE"

join_by_comma() {
  local IFS=,
  echo "$*"
}

has_local_mod_history() {
  local file="$1"
  git log --diff-filter=M --follow --format=%H -- "$file" | head -n 1 | grep -q .
}

strategy_for_file() {
  local file="$1"
  local selected="escalate"
  local i

  for i in "${!patterns[@]}"; do
    local pattern="${patterns[$i]}"
    if [[ "$file" == $pattern ]]; then
      selected="${strategies[$i]}"
    fi
  done

  echo "$selected"
}

append_unresolved_rule() {
  local file="$1"
  local now="$2"

  if ! grep -Fq "$file:" "$RULES_FILE"; then
    {
      echo
      echo "# UNRESOLVED (added $now): $file"
      echo "# $file:escalate"
    } >> "$RULES_FILE"
  fi
}

record_escalation() {
  local file="$1"
  local now="$2"

  touch "$ESCALATION_LOG"
  echo "$now,$file" >> "$ESCALATION_LOG"
  grep -F ",$file" "$ESCALATION_LOG" | wc -l | tr -d ' '
}

append_first_conflict_hunk() {
  local file="$1"

  echo
  echo "<details>"
  echo "<summary>First conflict hunk</summary>"
  echo
  echo '```'

  if [ -f "$file" ]; then
    awk '
      /^<<<<<<< / { in_hunk=1 }
      in_hunk {
        print
        count++
        if (/^>>>>>>> /) exit
        if (count >= 20) {
          print "..."
          exit
        }
      }
    ' "$file" || true
  else
    echo "File not available in workspace."
  fi

  echo '```'
  echo
  echo "</details>"
}

write_outputs() {
  local can_complete_merge="$1"
  local resolved_count="${#resolved_files[@]}"
  local escalated_count="${#escalated_files[@]}"

  {
    echo "resolved_count=$resolved_count"
    echo "escalated_count=$escalated_count"
    echo "resolved_files=$(join_by_comma "${resolved_files[@]+"${resolved_files[@]}"}")"
    echo "escalated_files=$(join_by_comma "${escalated_files[@]+"${escalated_files[@]}"}")"
    echo "can_complete_merge=$can_complete_merge"
  } >> "$GITHUB_OUTPUT"
}

if [ -z "$conflicted_files" ]; then
  echo "No conflicted files detected." >> "$SUMMARY_FILE"
  write_outputs "true"
  exit 0
fi

{
  echo "### Conflicted files"
  echo
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    echo "- \`$file\`"
  done <<< "$conflicted_files"
  echo
} >> "$SUMMARY_FILE"

while IFS= read -r file; do
  [ -z "$file" ] && continue

  strategy="$(strategy_for_file "$file")"
  reason=""

  if [ "$strategy" = "theirs" ] && has_local_mod_history "$file"; then
    strategy="escalate"
    reason="Matched a theirs rule, but local modification history exists; manual review required to protect customizations."
  fi

  case "$strategy" in
    ours)
      git checkout --ours -- "$file"
      git add "$file"
      resolved_files+=("$file")
      resolved_details+=("$file (ours)")
      ;;
    theirs)
      git checkout --theirs -- "$file"
      git add "$file"
      resolved_files+=("$file")
      resolved_details+=("$file (theirs, no local modification history detected)")
      ;;
    escalate)
      escalated_files+=("$file")
      now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
      append_unresolved_rule "$file" "$now"
      count="$(record_escalation "$file" "$now")"

      {
        echo "### Escalated: \`$file\`"
        echo
        if [ -n "$reason" ]; then
          echo "- Reason: $reason"
        else
          echo "- Reason: no safe auto-resolution rule matched or the matching rule requested escalation."
        fi
        echo "- Recorded escalation count: $count"
        if [ "$count" -ge 3 ]; then
          echo "- Recurring: yes — needs a permanent rule."
        fi
        echo "- Suggested next step: review the conflict, then uncomment or add a rule in \`$RULES_FILE\` with the correct strategy."
        append_first_conflict_hunk "$file"
        echo
      } >> "$SUMMARY_FILE"
      ;;
  esac
done <<< "$conflicted_files"

{
  echo "### Safely resolved files"
  echo
  if [ "${#resolved_details[@]}" -eq 0 ]; then
    echo "- None"
  else
    for detail in "${resolved_details[@]}"; do
      echo "- \`$detail\`"
    done
  fi
  echo
  echo "### Files requiring manual review"
  echo
  if [ "${#escalated_files[@]}" -eq 0 ]; then
    echo "- None"
  else
    for file in "${escalated_files[@]}"; do
      echo "- \`$file\`"
    done
  fi
  echo
} >> "$SUMMARY_FILE"

if [ "${#escalated_files[@]}" -gt 0 ]; then
  can_complete_merge="false"
else
  can_complete_merge="true"
fi

write_outputs "$can_complete_merge"

if [ "$can_complete_merge" = "false" ]; then
  echo "Automated conflict resolution escalated one or more files for manual review." >&2
fi
