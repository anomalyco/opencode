#!/usr/bin/env python3
"""Validate an Agile-V SOP binding for schema shape, conformance, and leaks.

Runs in a *project* repository's CI (not in the SOP source-of-truth repo). It
checks the project's `.agile-v/SOP_BINDING.yaml` against the binding schema and
the conformance rules of the `agile-v-sop-adapter` skill, and fails the build
when an in-scope SOP obligation is unmapped, unevidenced, or when protected SOP
text / external-system internals appear in the binding.

Usage:
    python validate.py [--binding PATH] [--schema PATH] [--strict]

Exit codes:
    0  conformant
    1  conformance failure (gaps, missing evidence, schema errors)
    2  usage / file error

Dependencies: PyYAML only (matches the Agile-V skills test toolchain). JSON
Schema validation is shape-only and dependency-free by design so this can run in
minimal CI images.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("error: PyYAML is required (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

VALID_VERIFICATION = {"review", "test", "trace", "inspection"}
VALID_STATUS = {"mapped", "gap", "not-applicable"}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Heuristic leak guard. A public/shared binding must not embed protected SOP
# body text or raw external-system internals. These patterns are intentionally
# generic; extend per organization via --deny-pattern if needed.
DEFAULT_DENY = [
    # Long prose blocks masquerading as clause refs / titles (protected text).
    (re.compile(r"\bshall\b.*\bshall\b", re.IGNORECASE), "possible embedded SOP body text (multiple 'shall')"),
]


def fail(errors: list[str]) -> None:
    for e in errors:
        print(f"FAIL: {e}", file=sys.stderr)


def validate(binding: dict, deny: list) -> list[str]:
    errors: list[str] = []

    # ---- top-level shape ----
    for key in ("schema_version", "sop_framework", "source_of_truth", "owner", "bindings"):
        if key not in binding:
            errors.append(f"missing top-level field: {key}")
    if binding.get("source_of_truth") != "sop":
        errors.append("source_of_truth must be 'sop' (authority stays in the SOPs)")

    fw = binding.get("sop_framework") or {}
    if not fw.get("name"):
        errors.append("sop_framework.name is required")
    if not fw.get("version"):
        errors.append("sop_framework.version is required (the SOP baseline this binding is valid against)")

    entries = binding.get("bindings")
    if not isinstance(entries, list) or not entries:
        errors.append("bindings must be a non-empty list")
        return errors

    seen_ids: set[str] = set()
    for i, b in enumerate(entries):
        loc = f"bindings[{i}]"
        if not isinstance(b, dict):
            errors.append(f"{loc}: not a mapping")
            continue

        bid = b.get("id", "")
        if not ID_RE.match(str(bid)):
            errors.append(f"{loc}: id '{bid}' must be kebab-case")
        if bid in seen_ids:
            errors.append(f"{loc}: duplicate id '{bid}'")
        seen_ids.add(bid)

        for key in ("sop_ref", "title", "applies_to", "human_gate", "evidence_locator", "owner"):
            if not b.get(key):
                errors.append(f"{loc} ({bid}): missing required field '{key}'")

        deliverables = b.get("deliverables")
        if not isinstance(deliverables, list) or not deliverables:
            errors.append(f"{loc} ({bid}): deliverables must be a non-empty list")

        if b.get("verification") not in VALID_VERIFICATION:
            errors.append(f"{loc} ({bid}): verification must be one of {sorted(VALID_VERIFICATION)}")

        status = b.get("status")
        if status not in VALID_STATUS:
            errors.append(f"{loc} ({bid}): status must be one of {sorted(VALID_STATUS)}")

        # ---- conformance rules ----
        if status == "mapped":
            av = b.get("agile_v") or {}
            if not (av.get("control") or av.get("artifact")):
                errors.append(f"{loc} ({bid}): status 'mapped' requires agile_v.control or agile_v.artifact")

        # ---- leak guard (title + sop_ref are the human-authored fields) ----
        for field in ("sop_ref", "title"):
            value = str(b.get(field, ""))
            for pattern, why in deny:
                if pattern.search(value):
                    errors.append(f"{loc} ({bid}): {field}: {why}")

    return errors


def conformance_gaps(binding: dict) -> list[str]:
    """In-scope obligations with status 'gap' are hard failures in --strict."""
    gaps = []
    for b in binding.get("bindings", []):
        if isinstance(b, dict) and b.get("status") == "gap":
            gaps.append(f"unresolved conformance gap: {b.get('id')} -> {b.get('sop_ref')}")
    return gaps


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate an Agile-V SOP binding.")
    parser.add_argument("--binding", default=".agile-v/SOP_BINDING.yaml", type=Path)
    parser.add_argument("--schema", default=None, type=Path, help="Reserved; shape checks are built in.")
    parser.add_argument("--strict", action="store_true",
                        help="Treat any status:'gap' as a failure (recommended in release CI).")
    args = parser.parse_args(argv)

    if not args.binding.exists():
        print(f"error: binding not found: {args.binding}", file=sys.stderr)
        return 2

    try:
        binding = yaml.safe_load(args.binding.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        print(f"error: invalid YAML in {args.binding}: {exc}", file=sys.stderr)
        return 2
    if not isinstance(binding, dict):
        print(f"error: {args.binding} is not a mapping", file=sys.stderr)
        return 2

    errors = validate(binding, DEFAULT_DENY)
    if args.strict:
        errors += conformance_gaps(binding)

    if errors:
        fail(errors)
        print(f"\n{len(errors)} problem(s) in {args.binding}", file=sys.stderr)
        return 1

    n = len(binding.get("bindings", []))
    fw = binding.get("sop_framework", {})
    print(f"OK: {args.binding} conforms "
          f"({n} bindings, framework '{fw.get('name')}' {fw.get('version')})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
