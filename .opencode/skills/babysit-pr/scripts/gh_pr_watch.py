#!/usr/bin/env python3
"""Watch GitHub PR CI and review activity for Codex PR babysitting workflows."""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

FAILED_RUN_CONCLUSIONS = {
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
    "startup_failure",
    "stale",
}
PENDING_CHECK_STATES = {
    "QUEUED",
    "IN_PROGRESS",
    "PENDING",
    "WAITING",
    "REQUESTED",
}
REVIEW_BOT_LOGIN_KEYWORDS = {
    "codex",
}
TRUSTED_AUTHOR_ASSOCIATIONS = {
    "OWNER",
    "MEMBER",
    "COLLABORATOR",
}
MERGE_BLOCKING_REVIEW_DECISIONS = {
    "REVIEW_REQUIRED",
    "CHANGES_REQUESTED",
}
MERGE_CONFLICT_OR_BLOCKING_STATES = {
    "BLOCKED",
    "DIRTY",
    "DRAFT",
    "UNKNOWN",
}


class GhCommandError(RuntimeError):
    pass


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Normalize PR/CI/review state for Codex PR babysitting and optionally "
            "trigger flaky reruns."
        )
    )
    parser.add_argument("--pr", default="auto", help="auto, PR number, or PR URL")
    parser.add_argument("--repo", help="Optional OWNER/REPO override")
    parser.add_argument("--poll-seconds", type=int, default=30, help="Watch poll interval")
    parser.add_argument(
        "--max-flaky-retries",
        type=int,
        default=3,
        help="Max rerun cycles per head SHA before stop recommendation",
    )
    parser.add_argument("--state-file", help="Path to state JSON file")
    parser.add_argument("--once", action="store_true", help="Emit one snapshot and exit")
    parser.add_argument("--watch", action="store_true", help="Continuously emit JSONL snapshots")
    parser.add_argument(
        "--retry-failed-now",
        action="store_true",
        help="Rerun failed jobs for current failed workflow runs when policy allows",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable output (default behavior for --once and --retry-failed-now)",
    )
    args = parser.parse_args()

    if args.poll_seconds <= 0:
        parser.error("--poll-seconds must be > 0")
    if args.max_flaky_retries < 0:
        parser.error("--max-flaky-retries must be >= 0")
    if args.watch and args.retry_failed_now:
        parser.error("--watch cannot be combined with --retry-failed-now")
    if not args.once and not args.watch and not args.retry_failed_now:
        args.once = True
    return args


def _format_gh_error(cmd, err):
    stdout = (err.stdout or "").strip()
    stderr = (err.stderr or "").strip()
    parts = [f"GitHub CLI command failed: {' '.join(cmd)}"]
    if stdout:
        parts.append(f"stdout: {stdout}")
    if stderr:
        parts.append(f"stderr: {stderr}")
    return "\n".join(parts)


def gh_text(args, repo=None):
    cmd = ["gh"]
    # `gh api` does not accept `-R/--repo` on all gh versions. The watcher's
    # API calls use explicit endpoints (e.g. repos/{owner}/{repo}/...), so the
    # repo flag is unnecessary there.
    if repo and (not args or args[0] != "api"):
        cmd.extend(["-R", repo])
    cmd.extend(args)
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except FileNotFoundError as err:
        raise GhCommandError("`gh` command not found") from err
    except subprocess.CalledProcessError as err:
        raise GhCommandError(_format_gh_error(cmd, err)) from err
    return proc.stdout


def gh_json(args, repo=None):
    raw = gh_text(args, repo=repo).strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise GhCommandError(f"Failed to parse JSON from gh output for {' '.join(args)}") from err


def parse_pr_spec(pr_spec):
    if pr_spec == "auto":
        return {"mode": "auto", "value": None}
    if re.fullmatch(r"\d+", pr_spec):
        return {"mode": "number", "value": pr_spec}
    parsed = urlparse(pr_spec)
    if parsed.scheme and parsed.netloc and "/pull/" in parsed.path:
        return {"mode": "url", "value": pr_spec}
    raise ValueError("--pr must be 'auto', a PR number, or a PR URL")


def pr_view_fields():
    return (
        "number,url,state,mergedAt,closedAt,headRefName,headRefOid,"
        "headRepository,headRepositoryOwner,mergeable,mergeStateStatus,reviewDecision"
    )


def checks_fields():
    return "name,state,bucket,link,workflow,event,startedAt,completedAt"


def resolve_pr(pr_spec, repo_override=None):
    parsed = parse_pr_spec(pr_spec)
    cmd = ["pr", "view"]
    if parsed["value"] is not None:
        cmd.append(parsed["value"])
    cmd.extend(["--json", pr_view_fields()])
    data = gh_json(cmd, repo=repo_override)
    if not isinstance(data, dict):
        raise GhCommandError("Unexpected PR payload from `gh pr view`")

    pr_url = str(data.get("url") or "")
    repo = (
        repo_override
        or extract_repo_from_pr_url(pr_url)
        or extract_repo_from_pr_view(data)
    )
    if not repo:
        raise GhCommandError("Unable to determine OWNER/REPO for the PR")

    state = str(data.get("state") or "")
    merged = bool(data.get("mergedAt"))
    closed = bool(data.get("closedAt")) or state.upper() == "CLOSED"

    return {
        "number": int(data["number"]),
        "url": pr_url,
        "repo": repo,
        "head_sha": str(data.get("headRefOid") or ""),
        "head_branch": str(data.get("headRefName") or ""),
        "state": state,
        "merged": merged,
        "closed": closed,
        "mergeable": str(data.get("mergeable") or ""),
        "merge_state_status": str(data.get("mergeStateStatus") or ""),
        "review_decision": str(data.get("reviewDecision") or ""),
    }


def extract_repo_from_pr_view(data):
    head_repo = data.get("headRepository")
    head_owner = data.get("headRepositoryOwner")
    owner = None
    name = None
    if isinstance(head_owner, dict):
        owner = head_owner.get("login") or head_owner.get("name")
    elif isinstance(head_owner, str):
        owner = head_owner
    if isinstance(head_repo, dict):
        name = head_repo.get("name")
        repo_owner = head_repo.get("owner")
        if not owner and isinstance(repo_owner, dict):
            owner = repo_owner.get("login") or repo_owner.get("name")
    elif isinstance(head_repo, str):
        name = head_repo
    if owner and name:
        return f"{owner}/{name}"
    return None
def extract_repo_from_pr_url(pr_url):
    parsed = urlparse(pr_url)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) >= 4 and parts[2] == "pull":
        return f"{parts[0]}/{parts[1]}"
    return None


def load_state(path):
    if path.exists():
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as err:
            raise RuntimeError(f"State file is not valid JSON: {path}") from err
        if not isinstance(data, dict):
            raise RuntimeError(f"State file must contain an object: {path}")
        return data, False
    return {
        "pr": {},
        "started_at": None,
        "last_seen_head_sha": None,
        "retries_by_sha": {},
        "seen_issue_comment_ids": [],
        "seen_review_comment_ids": [],
        "seen_review_ids": [],
        "last_snapshot_at": None,
    }, True


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(state, indent=2, sort_keys=True) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
            tmp_file.write(payload)
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def default_state_file_for(pr):
    repo_slug = pr["repo"].replace("/", "-")
    return Path(f"/tmp/codex-babysit-pr-{repo_slug}-pr{pr['number']}.json")


def get_pr_checks(pr_spec, repo):
    parsed = parse_pr_spec(pr_spec)
    cmd = ["pr", "checks"]
    if parsed["value"] is not None:
        cmd.append(parsed["value"])
    cmd.extend(["--json", checks_fields()])
    data = gh_json(cmd, repo=repo)
    if data is None:
        return []
    if not isinstance(data, list):
        raise GhCommandError("Unexpected payload from `gh pr checks`")
    return data


def is_pending_check(check):
    bucket = str(check.get("bucket") or "").lower()
    state = str(check.get("state") or "").upper()
    return bucket == "pending" or state in PENDING_CHECK_STATES


def summarize_checks(checks):
    pending_count = 0
    failed_count = 0
    passed_count = 0
    for check in checks:
        bucket = str(check.get("bucket") or "").lower()
        if is_pending_check(check):
            pending_count += 1
        if bucket == "fail":
            failed_count += 1
        if bucket == "pass":
            passed_count += 1
    return {
        "pending_count": pending_count,
        "failed_count": failed_count,
        "passed_count": passed_count,
        "all_terminal": pending_count == 0,
    }


def get_workflow_runs_for_sha(repo, head_sha):
    endpoint = f"repos/{repo}/actions/runs"
    data = gh_json(
        ["api", endpoint, "-X", "GET", "-f", f"head_sha={head_sha}", "-f", "per_page=100"],
        repo=repo,
    )
    if not isinstance(data, dict):
        raise GhCommandError("Unexpected payload from actions runs API")
    runs = data.get("workflow_runs") or []
    if not isinstance(runs, list):
        raise GhCommandError("Expected `workflow_runs` to be a list")
    return runs


def failed_runs_from_workflow_runs(runs, head_sha):
    failed_runs = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        if str(run.get("head_sha") or "") != head_sha:
            continue
        conclusion = str(run.get("conclusion") or "")
        if conclusion not in FAILED_RUN_CONCLUSIONS:
            continue
        failed_runs.append(
            {
                "run_id": run.get("id"),
                "workflow_name": run.get("name") or run.get("display_title") or "",
                "status": str(run.get("status") or ""),
                "conclusion": conclusion,
                "html_url": str(run.get("html_url") or ""),
            }
        )
    failed_runs.sort(key=lambda item: (str(item.get("workflow_name") or ""), str(item.get("run_id") or "")))
    return failed_runs


def get_authenticated_login():
    data = gh_json(["api", "user"])
    if not isinstance(data, dict) or not data.get("login"):
        raise GhCommandError("Unable to determine authenticated GitHub login from `gh api user`")
    return str(data["login"])


def comment_endpoints(repo, pr_number):
    return {
        "issue_comment": f"repos/{repo}/issues/{pr_number}/comments",
        "review_comment": f"repos/{repo}/pulls/{pr_number}/comments",
        "review": f"repos/{repo}/pulls/{pr_number}/reviews",
    }


def gh_api_list_paginated(endpoint, repo=None, per_page=100):
    items = []
    page = 1
    while True:
        sep = "&" if "?" in endpoint else "?"
        page_endpoint = f"{endpoint}{sep}per_page={per_page}&page={page}"
        payload = gh_json(["api", page_endpoint], repo=repo)
        if payload is None:
            break
        if not isinstance(payload, list):
            raise GhCommandError(f"Unexpected paginated payload from gh api {endpoint}")
        items.extend(payload)
        if len(payload) < per_page:
            break
        page += 1
    return items


def normalize_issue_comments(items):
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "kind": "issue_comment",
                "id": str(item.get("id") or ""),
                "author": extract_login(item.get("user")),
                "author_association": str(item.get("author_association") or ""),
                "created_at": str(item.get("created_at") or ""),
                "body": str(item.get("body") or ""),
                "path": None,
                "line": None,
                "url": str(item.get("html_url") or ""),
            }
        )
    return out


def normalize_review_comments(items):
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        line = item.get("line")
        if line is None:
            line = item.get("original_line")
        out.append(
            {
                "kind": "review_comment",
                "id": str(item.get("id") or ""),
                "author": extract_login(item.get("user")),
                "author_association": str(item.get("author_association") or ""),
                "created_at": str(item.get("created_at") or ""),
                "body": str(item.get("body") or ""),
                "path": item.get("path"),
                "line": line,
                "url": str(item.get("html_url") or ""),
            }
        )
    return out


def normalize_reviews(items):
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "kind": "review",
                "id": str(item.get("id") or ""),
                "author": extract_login(item.get("user")),
                "author_association": str(item.get("author_association") or ""),
                "created_at": str(item.get("submitted_at") or item.get("created_at") or ""),
                "body": str(item.get("body") or ""),
                "path": None,
                "line": None,
                "url": str(item.get("html_url") or ""),
            }
        )
    return out


def extract_login(user_obj):
    if isinstance(user_obj, dict):
        return str(user_obj.get("login") or "")
    return ""


def is_bot_login(login):
    return bool(login) and login.endswith("[bot]")


def is_actionable_review_bot_login(login):
    if not is_bot_login(login):
        return False
    lower_login = login.lower()
    return any(keyword in lower_login for keyword in REVIEW_BOT_LOGIN_KEYWORDS)


def is_trusted_human_review_author(item, authenticated_login):
    author = str(item.get("author") or "")
    if not author:
        return False
    if authenticated_login and author == authenticated_login:
        return True
    association = str(item.get("author_association") or "").upper()
    return association in TRUSTED_AUTHOR_ASSOCIATIONS


def fetch_new_review_items(pr, state, fresh_state, authenticated_login=None):
    repo = pr["repo"]
    pr_number = pr["number"]
    endpoints = comment_endpoints(repo, pr_number)

    issue_payload = gh_api_list_paginated(endpoints["issue_comment"], repo=repo)
    review_comment_payload = gh_api_list_paginated(endpoints["review_comment"], repo=repo)
    review_payload = gh_api_list_paginated(endpoints["review"], repo=repo)

    issue_items = normalize_issue_comments(issue_payload)
    review_comment_items = normalize_review_comments(review_comment_payload)
    review_items = normalize_reviews(review_payload)
    all_items = issue_items + review_comment_items + review_items

    seen_issue = {str(x) for x in state.get("seen_issue_comment_ids") or []}
    seen_review_comment = {str(x) for x in state.get("seen_review_comment_ids") or []}
    seen_review = {str(x) for x in state.get("seen_review_ids") or []}

    # On a brand-new state file, surface existing review activity instead of
    # silently treating it as seen. This avoids missing already-pending review
    # feedback when monitoring starts after comments were posted.

    new_items = []
    for item in all_items:
        item_id = item.get("id")
        if not item_id:
            continue
        author = item.get("author") or ""
        if not author:
            continue
        if is_bot_login(author):
            if not is_actionable_review_bot_login(author):
                continue
        elif not is_trusted_human_review_author(item, authenticated_login):
            continue

        kind = item["kind"]
        if kind == "issue_comment" and item_id in seen_issue:
            continue
        if kind == "review_comment" and item_id in seen_review_comment:
            continue
        if kind == "review" and item_id in seen_review:
            continue

        new_items.append(item)
        if kind == "issue_comment":
            seen_issue.add(item_id)
        elif kind == "review_comment":
            seen_review_comment.add(item_id)
        elif kind == "review":
            seen_review.add(item_id)

    new_items.sort(key=lambda item: (item.get("created_at") or "", item.get("kind") or "", item.get("id") or ""))
    state["seen_issue_comment_ids"] = sorted(seen_issue)
    state["seen_review_comment_ids"] = sorted(seen_review_comment)
    state["seen_review_ids"] = sorted(seen_review)
    return new_items


def current_retry_count(state, head_sha):
    retries = state.get("retries_by_sha") or {}
    value = retries.get(head_sha, 0)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def set_retry_count(state, head_sha, count):
    retries = state.get("retries_by_sha")
    if not isinstance(retries, dict):
        retries = {}
    retries[head_sha] = int(count)
    state["retries_by_sha"] = retries


def unique_actions(actions):
    out = []
    seen = set()
    for action in actions:
        if action not in seen:
            out.append(action)
            seen.add(action)
    return out


def is_pr_ready_to_merge(pr, checks_summary, new_review_items):
    if pr["closed"] or pr["merged"]:
        return False
    if not checks_summary["all_terminal"]:
        return False
    if checks_summary["failed_count"] > 0 or checks_summary["pending_count"] > 0:
        return False
    if new_review_items:
        return False
    if str(pr.get("mergeable") or "") != "MERGEABLE":
        return False
    if str(pr.get("merge_state_status") or "") in MERGE_CONFLICT_OR_BLOCKING_STATES:
        return False
    if str(pr.get("review_decision") or "") in MERGE_BLOCKING_REVIEW_DECISIONS:
        return False
    return True


def recommend_actions(pr, checks_summary, failed_runs, new_review_items, retries_used, max_retries):
    actions = []
    if pr["closed"] or pr["merged"]:
        if new_review_items:
            actions.append("process_review_comment")
        actions.append("stop_pr_closed")
        return unique_actions(actions)

    if is_pr_ready_to_merge(pr, checks_summary, new_review_items):
        actions.append("ready_to_merge")
        return unique_actions(actions)

    if new_review_items:
        actions.append("process_review_comment")

    has_failed_pr_checks = checks_summary["failed_count"] > 0
    if has_failed_pr_checks:
        if checks_summary["all_terminal"] and retries_used >= max_retries:
            actions.append("stop_exhausted_retries")
        else:
            actions.append("diagnose_ci_failure")
            if checks_summary["all_terminal"] and failed_runs and retries_used < max_retries:
                actions.append("retry_failed_checks")

    if not actions:
        actions.append("idle")
    return unique_actions(actions)


def collect_snapshot(args):
    pr = resolve_pr(args.pr, repo_override=args.repo)
    state_path = Path(args.state_file) if args.state_file else default_state_file_for(pr)
    state, fresh_state = load_state(state_path)

    if not state.get("started_at"):
        state["started_at"] = int(time.time())

    authenticated_login = get_authenticated_login()
    new_review_items = fetch_new_review_items(
        pr,
        state,
        fresh_state=fresh_state,
        authenticated_login=authenticated_login,
    )
    # Surface review feedback before drilling into CI and mergeability details.
    # That keeps the babysitter responsive to new comments even when other
    # actions are also available.
    # `gh pr checks -R <repo>` requires an explicit PR/branch/url argument.
    # After resolving `--pr auto`, reuse the concrete PR number.
    checks = get_pr_checks(str(pr["number"]), repo=pr["repo"])
    checks_summary = summarize_checks(checks)
    workflow_runs = get_workflow_runs_for_sha(pr["repo"], pr["head_sha"])
    failed_runs = failed_runs_from_workflow_runs(workflow_runs, pr["head_sha"])

    retries_used = current_retry_count(state, pr["head_sha"])
    actions = recommend_actions(
        pr,
        checks_summary,
        failed_runs,
        new_review_items,
        retries_used,
        args.max_flaky_retries,
    )

    state["pr"] = {"repo": pr["repo"], "number": pr["number"]}
    state["last_seen_head_sha"] = pr["head_sha"]
    state["last_snapshot_at"] = int(time.time())
    save_state(state_path, state)

    snapshot = {
        "pr": pr,
        "checks": checks_summary,
        "failed_runs": failed_runs,
        "new_review_items": new_review_items,
        "actions": actions,
        "retry_state": {
            "current_sha_retries_used": retries_used,
            "max_flaky_retries": args.max_flaky_retries,
        },
    }
    return snapshot, state_path


def retry_failed_now(args):
    snapshot, state_path = collect_snapshot(args)
    pr = snapshot["pr"]
    checks_summary = snapshot["checks"]
    failed_runs = snapshot["failed_runs"]
    retries_used = snapshot["retry_state"]["current_sha_retries_used"]
    max_retries = snapshot["retry_state"]["max_flaky_retries"]

    result = {
        "snapshot": snapshot,
        "state_file": str(state_path),
        "rerun_attempted": False,
        "rerun_count": 0,
        "rerun_run_ids": [],
        "reason": None,
    }

    if pr["closed"] or pr["merged"]:
        result["reason"] = "pr_closed"
        return result
    if checks_summary["failed_count"] <= 0:
        result["reason"] = "no_failed_pr_checks"
        return result
    if not failed_runs:
        result["reason"] = "no_failed_runs"
        return result
    if not checks_summary["all_terminal"]:
        result["reason"] = "checks_still_pending"
        return result
    if retries_used >= max_retries:
        result["reason"] = "retry_budget_exhausted"
        return result

    for run in failed_runs:
        run_id = run.get("run_id")
        if run_id in (None, ""):
            continue
        gh_text(["run", "rerun", str(run_id), "--failed"], repo=pr["repo"])
        result["rerun_run_ids"].append(run_id)

    if result["rerun_run_ids"]:
        state, _ = load_state(state_path)
        new_count = current_retry_count(state, pr["head_sha"]) + 1
        set_retry_count(state, pr["head_sha"], new_count)
        state["last_snapshot_at"] = int(time.time())
        save_state(state_path, state)
        result["rerun_attempted"] = True
        result["rerun_count"] = len(result["rerun_run_ids"])
        result["reason"] = "rerun_triggered"
    else:
        result["reason"] = "failed_runs_missing_ids"

    return result


def print_json(obj):
    sys.stdout.write(json.dumps(obj, sort_keys=True) + "\n")
    sys.stdout.flush()


def print_event(event, payload):
    print_json({"event": event, "payload": payload})


def is_ci_green(snapshot):
    checks = snapshot.get("checks") or {}
    return (
        bool(checks.get("all_terminal"))
        and int(checks.get("failed_count") or 0) == 0
        and int(checks.get("pending_count") or 0) == 0
    )


def snapshot_change_key(snapshot):
    pr = snapshot.get("pr") or {}
    checks = snapshot.get("checks") or {}
    review_items = snapshot.get("new_review_items") or []
    return (
        str(pr.get("head_sha") or ""),
        str(pr.get("state") or ""),
        str(pr.get("mergeable") or ""),
        str(pr.get("merge_state_status") or ""),
        str(pr.get("review_decision") or ""),
        int(checks.get("passed_count") or 0),
        int(checks.get("failed_count") or 0),
        int(checks.get("pending_count") or 0),
        tuple(
            (str(item.get("kind") or ""), str(item.get("id") or ""))
            for item in review_items
            if isinstance(item, dict)
        ),
        tuple(snapshot.get("actions") or []),
    )


def run_watch(args):
    poll_seconds = args.poll_seconds
    last_change_key = None
    while True:
        snapshot, state_path = collect_snapshot(args)
        print_event(
            "snapshot",
            {
                "snapshot": snapshot,
                "state_file": str(state_path),
                "next_poll_seconds": poll_seconds,
            },
        )
        actions = set(snapshot.get("actions") or [])
        if (
            "stop_pr_closed" in actions
            or "stop_exhausted_retries" in actions
        ):
            print_event("stop", {"actions": snapshot.get("actions"), "pr": snapshot.get("pr")})
            return 0

        current_change_key = snapshot_change_key(snapshot)
        changed = current_change_key != last_change_key
        green = is_ci_green(snapshot)
        pr = snapshot.get("pr") or {}
        pr_open = not bool(pr.get("closed")) and not bool(pr.get("merged"))

        if not green or pr_open:
            poll_seconds = args.poll_seconds
        elif changed or last_change_key is None:
            poll_seconds = args.poll_seconds

        last_change_key = current_change_key
        time.sleep(poll_seconds)


def main():
    args = parse_args()
    try:
        if args.retry_failed_now:
            print_json(retry_failed_now(args))
            return 0
        if args.watch:
            return run_watch(args)
        snapshot, state_path = collect_snapshot(args)
        snapshot["state_file"] = str(state_path)
        print_json(snapshot)
        return 0
    except (GhCommandError, RuntimeError, ValueError) as err:
        sys.stderr.write(f"gh_pr_watch.py error: {err}\n")
        return 1
    except KeyboardInterrupt:
        sys.stderr.write("gh_pr_watch.py interrupted\n")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
