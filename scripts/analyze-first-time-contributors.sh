#!/bin/bash

# First-Time Contributor Analyzer
# Analyzes PRs from first-time contributors over the last 4 weeks
# Usage: ./scripts/analyze-first-time-contributors.sh

set -euo pipefail

REPO="sst/opencode"
GITHUB_API="https://api.github.com/repos"
FOUR_WEEKS_AGO=$(date -u -v-28d '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -u -d '4 weeks ago' '+%Y-%m-%dT00:00:00Z')

echo "Analyzing first-time contributors from last 4 weeks..."
echo "Start date: $FOUR_WEEKS_AGO"
echo ""

# Create temp files
TEMP_PRS=$(mktemp)
TEMP_CONTRIBUTORS=$(mktemp)
trap "rm -f $TEMP_PRS $TEMP_CONTRIBUTORS" EXIT

# Fetch all PRs from the last 4 weeks
echo "Fetching PRs..."
ALL_PRS="[]"
for page in {1..10}; do
  echo "  Page $page..."
  PAGE_DATA=$(curl -s "${GITHUB_API}/${REPO}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}")
  
  COUNT=$(echo "$PAGE_DATA" | jq 'length')
  if [ "$COUNT" -eq 0 ]; then
    break
  fi
  
  FILTERED=$(echo "$PAGE_DATA" | jq "[.[] | select(.created_at >= \"${FOUR_WEEKS_AGO}\")]")
  ALL_PRS=$(echo "$ALL_PRS" "$FILTERED" | jq -s '.[0] + .[1]')
  
  OLDEST=$(echo "$PAGE_DATA" | jq -r '.[-1].created_at')
  if [[ "$OLDEST" < "$FOUR_WEEKS_AGO" ]]; then
    break
  fi
done

echo "$ALL_PRS" > "$TEMP_PRS"
PR_COUNT=$(jq 'length' "$TEMP_PRS")
echo "  Found $PR_COUNT PRs"

echo ""
echo "Checking contributor status for each PR..."

# Get contributors list (people with previous PRs)
# For each PR, check if the author has "first-time contributor" label or 
# if this is their first PR to the repo

# Extract PR data with author info
jq -r '.[] | "\(.number)|\(.user.login)|\(.created_at)|\(.author_association)"' "$TEMP_PRS" > "$TEMP_CONTRIBUTORS"

echo ""

# Analyze with Python
PYTHON_SCRIPT=$(mktemp)
trap "rm -f $PYTHON_SCRIPT $TEMP_PRS $TEMP_CONTRIBUTORS" EXIT

cat > "$PYTHON_SCRIPT" << 'EOF'
import json
import sys
from datetime import datetime
from collections import defaultdict

# Read PR data
pr_data = []
with open(sys.argv[1], 'r') as f:
    for line in f:
        if line.strip():
            parts = line.strip().split('|')
            pr_data.append({
                'number': parts[0],
                'author': parts[1],
                'created_at': parts[2],
                'author_association': parts[3]
            })

print(f"Analyzing {len(pr_data)} PRs...\n")

# Categorize by week
def get_week_label(date_str):
    date = datetime.fromisoformat(date_str.replace('Z', '+00:00')).replace(tzinfo=None)
    
    if date >= datetime(2025, 12, 22):
        return "Week 51: Dec 22-26"
    elif date >= datetime(2025, 12, 15):
        return "Week 50: Dec 15-21"
    elif date >= datetime(2025, 12, 8):
        return "Week 49: Dec 8-14"
    elif date >= datetime(2025, 12, 1):
        return "Week 48: Dec 1-7"
    else:
        return "Earlier"

# First-time contributors have author_association of "FIRST_TIME_CONTRIBUTOR" or "NONE"
# or sometimes "CONTRIBUTOR" for their first few PRs

by_week = defaultdict(lambda: {
    'total': 0,
    'first_time': 0,
    'returning': 0,
    'first_time_authors': set()
})

all_authors = defaultdict(int)

for pr in pr_data:
    week = get_week_label(pr['created_at'])
    author = pr['author']
    assoc = pr['author_association']
    
    by_week[week]['total'] += 1
    all_authors[author] += 1
    
    # GitHub marks first-time contributors explicitly
    # FIRST_TIME_CONTRIBUTOR = first PR to this repo
    # NONE = no association (could be first time)
    # For more accuracy, we check if author appears only once in our dataset
    
    if assoc == 'FIRST_TIME_CONTRIBUTOR' or (assoc == 'NONE' and all_authors[author] == 1):
        by_week[week]['first_time'] += 1
        by_week[week]['first_time_authors'].add(author)
    else:
        by_week[week]['returning'] += 1

# Print results
print("="*90)
print("FIRST-TIME CONTRIBUTOR ANALYSIS - LAST 4 WEEKS")
print("="*90 + "\n")

weeks = ["Week 48: Dec 1-7", "Week 49: Dec 8-14", "Week 50: Dec 15-21", "Week 51: Dec 22-26"]

print("PRs by Contributor Type:\n")
for week in weeks:
    if week in by_week:
        data = by_week[week]
        total = data['total']
        first_time = data['first_time']
        returning = data['returning']
        first_time_pct = (first_time / total * 100) if total > 0 else 0
        
        print(f"{week}: {total} PRs")
        print(f"  ✨ First-time contributors: {first_time} ({first_time_pct:.1f}%)")
        print(f"  ↩️  Returning contributors:  {returning} ({100-first_time_pct:.1f}%)")
        print()

# Overall summary
total_prs = sum(data['total'] for data in by_week.values())
total_first_time = sum(data['first_time'] for data in by_week.values())
total_returning = sum(data['returning'] for data in by_week.values())
overall_first_time_pct = (total_first_time / total_prs * 100) if total_prs > 0 else 0

print("="*90)
print("OVERALL SUMMARY")
print("="*90 + "\n")

print(f"Total PRs (4 weeks):              {total_prs}")
print(f"From first-time contributors:     {total_first_time} ({overall_first_time_pct:.1f}%)")
print(f"From returning contributors:      {total_returning} ({100-overall_first_time_pct:.1f}%)")

# Count unique first-time contributors
all_first_time_authors = set()
for data in by_week.values():
    all_first_time_authors.update(data['first_time_authors'])

print(f"\nUnique first-time contributors:   {len(all_first_time_authors)}")

# Week by week trend
print("\n" + "="*90)
print("TREND ANALYSIS")
print("="*90 + "\n")

print("First-Time Contributor Rate by Week:\n")
for week in weeks:
    if week in by_week:
        data = by_week[week]
        rate = (data['first_time'] / data['total'] * 100) if data['total'] > 0 else 0
        bar = "█" * int(rate / 2)
        print(f"  {week}: {rate:5.1f}% {bar}")

print("\n" + "="*90)
print("KEY INSIGHTS")
print("="*90 + "\n")

insights = []

if total_first_time > 0:
    insights.append(
        f"1. New Contributors: {total_first_time} PRs from first-timers shows healthy\n" +
        f"   community growth and welcoming environment for new contributors."
    )

if overall_first_time_pct > 20:
    insights.append(
        f"2. High New Contributor Rate: {overall_first_time_pct:.1f}% from first-timers is\n" +
        f"   excellent. Indicates strong onboarding and accessible contribution process."
    )
elif overall_first_time_pct > 10:
    insights.append(
        f"2. Moderate New Contributor Rate: {overall_first_time_pct:.1f}% from first-timers\n" +
        f"   is healthy. Good balance of new and returning contributors."
    )
else:
    insights.append(
        f"2. Low New Contributor Rate: {overall_first_time_pct:.1f}% from first-timers.\n" +
        f"   Most PRs from established contributors (mature project pattern)."
    )

# Check for trend
week_rates = []
for week in weeks:
    if week in by_week:
        data = by_week[week]
        rate = (data['first_time'] / data['total'] * 100) if data['total'] > 0 else 0
        week_rates.append(rate)

if len(week_rates) >= 3:
    if week_rates[-1] > week_rates[0]:
        insights.append(
            f"3. Growing Trend: First-time contributor rate increasing\n" +
            f"   ({week_rates[0]:.1f}% → {week_rates[-1]:.1f}%). Project attracting more new contributors."
        )
    elif week_rates[-1] < week_rates[0]:
        insights.append(
            f"3. Declining Trend: First-time contributor rate decreasing\n" +
            f"   ({week_rates[0]:.1f}% → {week_rates[-1]:.1f}%). May indicate shifting to core contributors."
        )
    else:
        insights.append(
            f"3. Stable Trend: First-time contributor rate relatively stable\n" +
            f"   across weeks. Consistent new contributor engagement."
        )

insights.append(
    f"4. Unique Contributors: {len(all_first_time_authors)} unique new people made their\n" +
    f"   first contribution. Shows breadth of community involvement."
)

for insight in insights:
    print(f"{insight}\n")

print("="*90 + "\n")
EOF

python3 "$PYTHON_SCRIPT" "$TEMP_CONTRIBUTORS"
