#!/bin/bash

# GitHub Issues Analyzer for Recent Weeks
# Analyzes Dec 15-21 (Week 50) and Dec 22-26 (Week 51)
# Usage: ./scripts/analyze-recent-weeks.sh

set -euo pipefail

REPO="sst/opencode"
GITHUB_API="https://api.github.com/repos"

# Start from Dec 15
START_DATE="2025-12-15T00:00:00Z"

echo "Analyzing GitHub issues from Dec 15 onwards..."
echo "Start date: $START_DATE"
echo ""

# Create temp file
TEMP_FILE=$(mktemp)
trap "rm -f $TEMP_FILE" EXIT

echo "[]" > "$TEMP_FILE"

# Fetch all issues from Dec 15 onwards (paginate through results)
for page in {1..5}; do
  echo "  Fetching page $page..."
  PAGE_DATA=$(curl -s "${GITHUB_API}/${REPO}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}")
  
  # Check if we got any results
  COUNT=$(echo "$PAGE_DATA" | jq 'length')
  if [ "$COUNT" -eq 0 ]; then
    echo "  No more results on page $page"
    break
  fi
  
  # Filter issues from Dec 15 onwards
  FILTERED=$(echo "$PAGE_DATA" | jq "[.[] | select(.created_at >= \"${START_DATE}\")]")
  FILTERED_COUNT=$(echo "$FILTERED" | jq 'length')
  echo "  Found $FILTERED_COUNT issues from Dec 15 onwards on page $page"
  
  # Append to temp file
  CURRENT=$(cat "$TEMP_FILE")
  MERGED=$(echo "$CURRENT" "$FILTERED" | jq -s '.[0] + .[1]')
  echo "$MERGED" > "$TEMP_FILE"
  
  # If we've started getting old data, we can stop
  OLDEST=$(echo "$PAGE_DATA" | jq -r '.[-1].created_at')
  if [[ "$OLDEST" < "$START_DATE" ]]; then
    echo "  Reached data older than Dec 15, stopping"
    break
  fi
done

echo ""

# Create Python analysis script
PYTHON_SCRIPT=$(mktemp)
trap "rm -f $PYTHON_SCRIPT $TEMP_FILE" EXIT

cat > "$PYTHON_SCRIPT" << 'EOF'
import json
import sys
from datetime import datetime
from collections import defaultdict

# Read the issues data from file
with open(sys.argv[1], 'r') as f:
    data = json.load(f)

if not data:
    print("No issues found from Dec 15 onwards")
    sys.exit(0)

print(f"Analyzing {len(data)} issues...\n")

# Categorize and group by week
issues_by_week = defaultdict(lambda: defaultdict(int))
week_totals = defaultdict(int)
week_order = []

# Response tracking
response_by_week = defaultdict(lambda: {
    'total': 0,
    'with_response': 0,
    'no_response': 0
})

def get_week_label(date_str):
    """Convert date to week label"""
    date = datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
    
    # Manual week grouping for clarity
    if date >= datetime(2025, 12, 22):
        return "Week 51: Dec 22-26"
    elif date >= datetime(2025, 12, 15):
        return "Week 50: Dec 15-21"
    else:
        return "Earlier"

def categorize_issue(item):
    """Categorize an issue"""
    if item.get('pull_request'):
        return "PR"
    
    labels = [label['name'] for label in item.get('labels', [])]
    title = item['title'].lower()
    
    if 'discussion' in labels:
        return "Feature Request"
    elif 'help-wanted' in labels:
        return "Help Question"
    elif 'bug' in labels:
        return "Bug Report"
    elif any(x in title for x in ['[feature]', 'feature request', '[feat]']):
        return "Feature Request"
    elif title.endswith('?') and 'bug' not in title:
        return "Help Question"
    else:
        return "Other"

# Process each issue
for item in data:
    week_label = get_week_label(item['created_at'])
    if week_label not in week_order:
        week_order.append(week_label)
    
    category = categorize_issue(item)
    
    # Check if it's an actual issue (not PR)
    if not item.get('pull_request'):
        response_by_week[week_label]['total'] += 1
        if item['comments'] > 0:
            response_by_week[week_label]['with_response'] += 1
        else:
            response_by_week[week_label]['no_response'] += 1
    
    issues_by_week[week_label][category] += 1
    week_totals[week_label] += 1

# Sort weeks (most recent first)
week_order = sorted([w for w in week_order if w != "Earlier"], reverse=True)

# Print results
print("="*80)
print("GITHUB ISSUES BREAKDOWN - RECENT WEEKS")
print("="*80 + "\n")

for week in week_order:
    print(f"{week}: {week_totals[week]} total")
    for category in sorted(issues_by_week[week].keys()):
        count = issues_by_week[week][category]
        print(f"  • {category}: {count}")
    print()

print("---")
total = sum(week_totals[w] for w in week_order)
print(f"TOTAL: {total} issues/PRs\n")

print("OVERALL SUMMARY:")
all_counts = defaultdict(int)
for week in week_order:
    for category, count in issues_by_week[week].items():
        all_counts[category] += count

for category in sorted(all_counts.keys(), key=lambda x: -all_counts[x]):
    count = all_counts[category]
    pct = (count / total) * 100
    print(f"  • {category}: {count} ({pct:.1f}%)")

# Response rates
print("\n" + "="*80)
print("ISSUE RESPONSE RATES")
print("="*80 + "\n")

for week in week_order:
    data = response_by_week[week]
    if data['total'] > 0:
        rate = (data['with_response'] / data['total'] * 100)
        print(f"{week}:")
        print(f"  Total issues: {data['total']}")
        print(f"  With response: {data['with_response']} ({rate:.1f}%)")
        print(f"  No response: {data['no_response']}")
        print()

# Week over week comparison
print("="*80)
print("WEEK-OVER-WEEK COMPARISON")
print("="*80 + "\n")

if len(week_order) >= 2:
    w1 = week_order[0]  # Most recent
    w2 = week_order[1]  # Previous
    
    vol_change = week_totals[w1] - week_totals[w2]
    vol_pct = (vol_change / week_totals[w2] * 100) if week_totals[w2] > 0 else 0
    
    print(f"Volume Change: {week_totals[w2]} → {week_totals[w1]} ({vol_pct:+.1f}%)")
    print()
    
    print("Category Changes:")
    for category in sorted(all_counts.keys()):
        old_val = issues_by_week[w2].get(category, 0)
        new_val = issues_by_week[w1].get(category, 0)
        change = new_val - old_val
        direction = "↑" if change > 0 else "↓" if change < 0 else "→"
        print(f"  {category:18s}: {old_val:3d} → {new_val:3d}  {direction} {abs(change)}")
    
    print()
    if response_by_week[w1]['total'] > 0 and response_by_week[w2]['total'] > 0:
        r1 = (response_by_week[w1]['with_response'] / response_by_week[w1]['total'] * 100)
        r2 = (response_by_week[w2]['with_response'] / response_by_week[w2]['total'] * 100)
        print(f"Response Rate: {r2:.1f}% → {r1:.1f}% ({r1-r2:+.1f}pp)")

print("\n" + "="*80 + "\n")
EOF

# Run the analysis
python3 "$PYTHON_SCRIPT" "$TEMP_FILE"
