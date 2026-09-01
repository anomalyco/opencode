#!/usr/bin/env python3
"""
Compares two SWE-bench evaluation run reports (e.g. Vanilla Baseline vs. OpenCode-Evolve).
Calculates Pass@1 delta, newly resolved bugs, regressions, and resolution rates.
"""

import argparse
import json
import sys
from pathlib import Path

def load_report(report_path: Path) -> dict:
    if not report_path.exists():
        print(f"[-] Error: Report file {report_path} not found.")
        sys.exit(1)
    with open(report_path) as f:
        return json.load(f)

def main():
    parser = argparse.ArgumentParser(description="Compare SWE-bench Evaluation Reports")
    parser.add_argument("--baseline", required=True, help="Path to Vanilla Baseline JSON report (e.g. vanilla_eval.json)")
    parser.add_argument("--evolved", required=True, help="Path to Evolved OpenCode JSON report (e.g. evolve_eval.json)")
    args = parser.parse_args()

    r_base = load_report(Path(args.baseline))
    r_evolved = load_report(Path(args.evolved))

    def get_resolved(report: dict) -> set:
        if "resolved_ids" in report and isinstance(report["resolved_ids"], list):
            return set(report["resolved_ids"])
        if "resolved" in report and isinstance(report["resolved"], list):
            return set(report["resolved"])
        return set()

    base_resolved = get_resolved(r_base)
    evolved_resolved = get_resolved(r_evolved)

    total_base = r_base.get("total_instances") or (len(base_resolved) + len(r_base.get("unresolved_ids", r_base.get("unresolved", []))))
    total_evolved = r_evolved.get("total_instances") or (len(evolved_resolved) + len(r_evolved.get("unresolved_ids", r_evolved.get("unresolved", []))))

    base_rate = (len(base_resolved) / total_base * 100) if total_base > 0 else 0
    evolved_rate = (len(evolved_resolved) / total_evolved * 100) if total_evolved > 0 else 0

    newly_resolved = evolved_resolved - base_resolved
    regressions = base_resolved - evolved_resolved

    print("\n=========================================================================")
    print("         SWE-BENCH HEAD-TO-HEAD COMPARATIVE STUDY REPORT                 ")
    print("=========================================================================")
    print(f"• Baseline (Vanilla OpenCode):  {len(base_resolved)}/{total_base} ({base_rate:.1f}%)")
    print(f"• Evolved (OpenCode-Evolve):    {len(evolved_resolved)}/{total_evolved} ({evolved_rate:.1f}%)")
    print(f"• Net Improvement:             +{evolved_rate - base_rate:.1f}% Pass Rate Delta")
    print(f"• Newly Fixed Bugs (Evolved):   {len(newly_resolved)} instances")
    for inst in newly_resolved:
        print(f"    ✓ {inst}")
    print(f"• Regressions:                 {len(regressions)} instances")
    for inst in regressions:
        print(f"    ✗ {inst}")
    print("=========================================================================\n")

if __name__ == "__main__":
    main()
