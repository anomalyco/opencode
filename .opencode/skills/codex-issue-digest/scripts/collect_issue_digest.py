#!/usr/bin/env python3
"""Collect recent openai/codex issue activity for owner-focused digests."""

import argparse
import json
import math
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

SCRIPT_VERSION = 2
QUALIFYING_KIND_LABELS = ("bug", "enhancement")
REACTION_KEYS = ("+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes")
BASE_ATTENTION_WINDOW_HOURS = 24.0
ONE_ATTENTION_INTERACTION_THRESHOLD = 10
TWO_ATTENTION_INTERACTION_THRESHOLD = 20
ALL_LABEL_PHRASES = {"all", "all areas", "all labels", "all-areas", "all-labels", "*"}


class GhCommandError(RuntimeError):
    pass


def parse_args():
    parser = argparse.ArgumentParser(
        description="Collect recent GitHub issue activity for a Codex owner digest."
    )
    parser.add_argument(
        "--repo", default="openai/codex", help="OWNER/REPO, default openai/codex"
    )
    parser.add_argument(
        "--labels",
        nargs="+",
        default=[],
        help="Feature-area labels owned by the digest recipient, for example: tui exec",
    )
    parser.add_argument(
        "--all-labels",
        action="store_true",
        help="Collect bug/enhancement issues across all feature-area labels",
    )
    parser.add_argument(
        "--window",
        help='Lookback duration such as "24h", "7d", "1w", or "past week"',
    )
    parser.add_argument(
        "--window-hours", type=float, default=24.0, help="Lookback window"
    )
    parser.add_argument(
        "--since", help="UTC ISO timestamp override for the window start"
    )
    parser.add_argument("--until", help="UTC ISO timestamp override for the window end")
    parser.add_argument(
        "--limit-issues",
        type=int,
        default=200,
        help="Maximum candidate issues to hydrate after search",
    )
    parser.add_argument(
        "--body-chars", type=int, default=1200, help="Issue body excerpt length"
    )
    parser.add_argument(
        "--comment-chars", type=int, default=900, help="Comment excerpt length"
    )
    parser.add_argument(
        "--max-comment-pages",
        type=int,
        default=3,
        help=(
            "Maximum pages of issue comments to hydrate per issue after applying the "
            "window filter. Use 0 with --fetch-all-comments for no page cap."
        ),
    )
    parser.add_argument(
        "--fetch-all-comments",
        action="store_true",
        help="Hydrate complete issue comment histories instead of only window-updated comments.",
    )
    return parser.parse_args()


def parse_timestamp(value, arg_name):
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as err:
        raise ValueError(f"{arg_name} must be an ISO timestamp") from err
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_timestamp(value):
    return (
        value.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def resolve_window(args):
    until = parse_timestamp(args.until, "--until") or datetime.now(timezone.utc)
    since = parse_timestamp(args.since, "--since")
    if since is None:
        hours = parse_duration_hours(getattr(args, "window", None))
        if hours is None:
            hours = getattr(args, "window_hours", 24.0)
        if hours <= 0:
            raise ValueError("window duration must be > 0")
        since = until - timedelta(hours=hours)
    if since >= until:
        raise ValueError("--since must be before --until")
    return since, until


def parse_duration_hours(value):
    if value is None:
        return None
    text = value.strip().casefold().replace("_", " ")
    if not text:
        return None
    text = re.sub(r"^(past|last)\s+", "", text)
    aliases = {
        "day": 24.0,
        "24h": 24.0,
        "week": 168.0,
        "7d": 168.0,
    }
    if text in aliases:
        return aliases[text]
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)", text)
    if match:
        return float(match.group(1))
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(d|day|days)", text)
    if match:
        return float(match.group(1)) * 24.0
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(w|week|weeks)", text)
    if match:
        return float(match.group(1)) * 168.0
    raise ValueError(f"Unsupported duration: {value}")


def normalize_requested_labels(labels, all_labels=False):
    out = []
    seen = set()
    for raw in labels:
        for piece in raw.split(","):
            label = piece.strip()
            if not label:
                continue
            key = label.casefold()
            if key not in seen:
                out.append(label)
                seen.add(key)
    phrase = " ".join(label.casefold() for label in out)
    if all_labels or phrase in ALL_LABEL_PHRASES:
        return [], True
    if not out:
        raise ValueError(
            "At least one feature-area label is required, or use --all-labels"
        )
    return out, False


def quote_label(label):
    if re.fullmatch(r"[A-Za-z0-9_.:-]+", label):
        return f"label:{label}"
    escaped = label.replace('"', '\\"')
    return f'label:"{escaped}"'


def build_search_queries(
    repo, owner_labels, since, kind_labels=QUALIFYING_KIND_LABELS, all_labels=False
):
    since_date = since.date().isoformat()
    queries = []
    if all_labels:
        for kind_label in kind_labels:
            queries.append(
                " ".join(
                    [
                        f"repo:{repo}",
                        "is:issue",
                        f"updated:>={since_date}",
                        quote_label(kind_label),
                    ]
                )
            )
        return queries
    for owner_label in owner_labels:
        for kind_label in kind_labels:
            queries.append(
                " ".join(
                    [
                        f"repo:{repo}",
                        "is:issue",
                        f"updated:>={since_date}",
                        quote_label(owner_label),
                        quote_label(kind_label),
                    ]
                )
            )
    return queries


def _format_gh_error(cmd, err):
    stdout = (err.stdout or "").strip()
    stderr = (err.stderr or "").strip()
    parts = [f"GitHub CLI command failed: {' '.join(cmd)}"]
    if stdout:
        parts.append(f"stdout: {stdout}")
    if stderr:
        parts.append(f"stderr: {stderr}")
    return "\n".join(parts)


def gh_json(args):
    cmd = ["gh", *args]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except FileNotFoundError as err:
        raise GhCommandError("`gh` command not found") from err
    except subprocess.CalledProcessError as err:
        raise GhCommandError(_format_gh_error(cmd, err)) from err
    raw = proc.stdout.strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise GhCommandError(
            f"Failed to parse JSON from gh output for {' '.join(args)}"
        ) from err


def gh_text(args):
    cmd = ["gh", *args]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return ""
    return proc.stdout.strip()


def git_head():
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return proc.stdout.strip() or None


def skill_relative_path():
    try:
        return str(Path(__file__).resolve().relative_to(Path.cwd().resolve()))
    except ValueError:
        return str(Path(__file__).resolve())


def gh_api_list_paginated(endpoint, per_page=100, max_pages=None, with_metadata=False):
    items = []
    page = 1
    truncated = False
    while True:
        sep = "&" if "?" in endpoint else "?"
        page_endpoint = f"{endpoint}{sep}per_page={per_page}&page={page}"
        payload = gh_json(["api", page_endpoint])
        if payload is None:
            break
        if not isinstance(payload, list):
            raise GhCommandError(f"Unexpected paginated payload from gh api {endpoint}")
        items.extend(payload)
        if len(payload) < per_page:
            break
        if max_pages is not None and page >= max_pages:
            truncated = True
            break
        page += 1
    if with_metadata:
        return {
            "items": items,
            "truncated": truncated,
            "pages": page,
            "max_pages": max_pages,
        }
    return items


def search_issue_numbers(queries, limit):
    numbers = {}
    for query in queries:
        page = 1
        while True:
            payload = gh_json(
                [
                    "api",
                    "search/issues",
                    "-X",
                    "GET",
                    "-f",
                    f"q={query}",
                    "-f",
                    "per_page=100",
                    "-f",
                    f"page={page}",
                ]
            )
            if not isinstance(payload, dict):
                raise GhCommandError("Unexpected payload from GitHub issue search")
            items = payload.get("items") or []
            if not isinstance(items, list):
                raise GhCommandError("Expected search `items` to be a list")
            for item in items:
                if not isinstance(item, dict):
                    continue
                number = item.get("number")
                if isinstance(number, int):
                    numbers[number] = str(item.get("updated_at") or "")
            if len(items) < 100 or len(numbers) >= limit:
                break
            page += 1
    ordered = sorted(
        numbers, key=lambda number: (numbers[number], number), reverse=True
    )
    return ordered[:limit]


def fetch_issue(repo, number):
    payload = gh_json(["api", f"repos/{repo}/issues/{number}"])
    if not isinstance(payload, dict):
        raise GhCommandError(f"Unexpected issue payload for #{number}")
    return payload


def fetch_comments(repo, number, since=None, max_pages=None):
    endpoint = f"repos/{repo}/issues/{number}/comments"
    if since is not None:
        endpoint = f"{endpoint}?since={quote(format_timestamp(since), safe='')}"
    return gh_api_list_paginated(
        endpoint,
        max_pages=max_pages,
        with_metadata=True,
    )


def fetch_reactions_for_item(endpoint, item):
    if reaction_summary(item)["total"] <= 0:
        return []
    return gh_api_list_paginated(endpoint)


def fetch_comment_reactions(repo, comments):
    reactions_by_comment_id = {}
    for comment in comments:
        comment_id = comment.get("id")
        if comment_id in (None, ""):
            continue
        endpoint = f"repos/{repo}/issues/comments/{comment_id}/reactions"
        reactions_by_comment_id[comment_id] = fetch_reactions_for_item(
            endpoint, comment
        )
    return reactions_by_comment_id


def extract_login(user_obj):
    if isinstance(user_obj, dict):
        return str(user_obj.get("login") or "")
    return ""


def is_bot_login(login):
    return bool(login) and login.lower().endswith("[bot]")


def is_human_user(user_obj):
    login = extract_login(user_obj)
    return bool(login) and not is_bot_login(login)


def label_names(issue):
    labels = []
    for label in issue.get("labels") or []:
        if isinstance(label, dict) and label.get("name"):
            labels.append(str(label["name"]))
    return sorted(labels, key=str.casefold)


def matching_labels(labels, requested):
    labels_by_key = {label.casefold(): label for label in labels}
    return [label for label in requested if label.casefold() in labels_by_key]


def area_labels(labels):
    kind_keys = {label.casefold() for label in QUALIFYING_KIND_LABELS}
    return [label for label in labels if label.casefold() not in kind_keys]


def attention_thresholds_for_window(window_hours):
    if window_hours <= 0:
        raise ValueError("window_hours must be > 0")
    window_hours = round(window_hours, 6)
    scale = window_hours / BASE_ATTENTION_WINDOW_HOURS
    elevated = max(1, math.ceil(ONE_ATTENTION_INTERACTION_THRESHOLD * scale))
    very_high = max(
        elevated + 1, math.ceil(TWO_ATTENTION_INTERACTION_THRESHOLD * scale)
    )
    return {
        "base_window_hours": BASE_ATTENTION_WINDOW_HOURS,
        "window_hours": round(window_hours, 3),
        "scale": round(scale, 3),
        "elevated": elevated,
        "very_high": very_high,
    }


def attention_level_for(user_interactions, attention_thresholds=None):
    thresholds = attention_thresholds or attention_thresholds_for_window(
        BASE_ATTENTION_WINDOW_HOURS
    )
    if user_interactions >= thresholds["very_high"]:
        return 2
    if user_interactions >= thresholds["elevated"]:
        return 1
    return 0


def attention_marker_for(user_interactions, attention_thresholds=None):
    return "🔥" * attention_level_for(user_interactions, attention_thresholds)


def reaction_summary(item):
    reactions = item.get("reactions")
    if not isinstance(reactions, dict):
        return {"total": 0, "counts": {}}
    counts = {}
    for key in REACTION_KEYS:
        value = reactions.get(key, 0)
        if isinstance(value, int) and value:
            counts[key] = value
    total = reactions.get("total_count")
    if not isinstance(total, int):
        total = sum(counts.values())
    return {"total": total, "counts": counts}


def reaction_event_summary(reactions, since, until):
    counts = {}
    total = 0
    for reaction in reactions or []:
        if not isinstance(reaction, dict):
            continue
        if not is_in_window(str(reaction.get("created_at") or ""), since, until):
            continue
        if not is_human_user(reaction.get("user")):
            continue
        content = str(reaction.get("content") or "")
        if not content:
            continue
        counts[content] = counts.get(content, 0) + 1
        total += 1
    return {
        "total": total,
        "counts": counts,
        "upvotes": counts.get("+1", 0),
    }


def compact_text(value, limit):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if limit <= 0:
        return ""
    if len(text) <= limit:
        return text
    return f"{text[: max(limit - 1, 0)].rstrip()}..."


def clean_title_for_description(title):
    cleaned = re.sub(r"\s+", " ", str(title or "")).strip()
    cleaned = re.sub(
        r"^(codex(?: desktop| app|\.app| cli)?|desktop|windows codex app)\s*[:,-]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"^on windows,\s*", "Windows: ", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" -:;")
    return compact_text(cleaned, 80) or "Issue needs owner review"


def issue_description(issue):
    return clean_title_for_description(issue.get("title"))


def is_in_window(timestamp, since, until):
    parsed = parse_timestamp(timestamp, "timestamp")
    if parsed is None:
        return False
    return since <= parsed < until


def summarize_comment(
    comment, comment_chars, reaction_events=None, since=None, until=None
):
    reactions = reaction_summary(comment)
    new_reactions = (
        reaction_event_summary(reaction_events, since, until)
        if since is not None and until is not None
        else {"total": 0, "counts": {}, "upvotes": 0}
    )
    human_user_interaction = is_human_user(comment.get("user"))
    return {
        "id": comment.get("id"),
        "author": extract_login(comment.get("user")),
        "author_association": str(comment.get("author_association") or ""),
        "created_at": str(comment.get("created_at") or ""),
        "updated_at": str(comment.get("updated_at") or ""),
        "url": str(comment.get("html_url") or ""),
        "human_user_interaction": human_user_interaction,
        "reactions": reactions["counts"],
        "reaction_total": reactions["total"],
        "new_reactions": new_reactions["total"],
        "new_upvotes": new_reactions["upvotes"],
        "new_reaction_counts": new_reactions["counts"],
        "body_excerpt": compact_text(comment.get("body"), comment_chars),
    }


def summarize_issue(
    issue,
    comments,
    requested_labels,
    since,
    until,
    body_chars,
    comment_chars,
    issue_reaction_events=None,
    comment_reactions_by_id=None,
    all_labels=False,
    comments_hydration=None,
    attention_thresholds=None,
):
    labels = label_names(issue)
    labels_by_key = {label.casefold() for label in labels}
    kind_labels = [
        label for label in QUALIFYING_KIND_LABELS if label.casefold() in labels_by_key
    ]
    if all_labels:
        owner_labels = area_labels(labels) or ["unlabeled"]
    else:
        owner_labels = matching_labels(labels, requested_labels)
    if not kind_labels or not owner_labels:
        return None

    updated_at = str(issue.get("updated_at") or "")
    if not is_in_window(updated_at, since, until):
        return None

    new_issue = is_in_window(str(issue.get("created_at") or ""), since, until)
    comment_reactions_by_id = comment_reactions_by_id or {}
    new_comments = [
        summarize_comment(
            comment,
            comment_chars,
            reaction_events=comment_reactions_by_id.get(comment.get("id")),
            since=since,
            until=until,
        )
        for comment in comments
        if is_in_window(str(comment.get("created_at") or ""), since, until)
    ]
    new_comments.sort(key=lambda item: (item["created_at"], str(item["id"])))

    issue_reactions = reaction_summary(issue)
    issue_reaction_events_summary = reaction_event_summary(
        issue_reaction_events, since, until
    )
    comment_reaction_events_summary = reaction_event_summary(
        [
            reaction
            for reactions in comment_reactions_by_id.values()
            for reaction in reactions
        ],
        since,
        until,
    )
    new_reactions = (
        issue_reaction_events_summary["total"]
        + comment_reaction_events_summary["total"]
    )
    new_upvotes = (
        issue_reaction_events_summary["upvotes"]
        + comment_reaction_events_summary["upvotes"]
    )
    all_comment_reaction_total = sum(
        reaction_summary(comment)["total"] for comment in comments
    )
    new_comment_reaction_total = sum(
        comment["reaction_total"] for comment in new_comments
    )
    new_issue_user_interaction = new_issue and is_human_user(issue.get("user"))
    new_comment_user_interactions = sum(
        1 for comment in new_comments if comment["human_user_interaction"]
    )
    user_interactions = (
        int(new_issue_user_interaction) + new_comment_user_interactions + new_reactions
    )
    attention_level = attention_level_for(user_interactions, attention_thresholds)
    attention_marker = attention_marker_for(user_interactions, attention_thresholds)
    updated_without_visible_new_post = (
        not new_issue and not new_comments and new_reactions == 0
    )

    engagement_score = (
        len(new_comments) * 3
        + new_reactions
        + issue_reactions["total"]
        + new_comment_reaction_total
        + min(int(issue.get("comments") or len(comments) or 0), 10)
    )

    return {
        "number": issue.get("number"),
        "title": str(issue.get("title") or ""),
        "description": issue_description(issue),
        "url": str(issue.get("html_url") or ""),
        "state": str(issue.get("state") or ""),
        "author": extract_login(issue.get("user")),
        "author_association": str(issue.get("author_association") or ""),
        "created_at": str(issue.get("created_at") or ""),
        "updated_at": updated_at,
        "labels": labels,
        "kind_labels": kind_labels,
        "owner_labels": owner_labels,
        "comments_total": int(issue.get("comments") or len(comments) or 0),
        "comments_hydration": comments_hydration
        or {
            "fetched": len(comments),
            "since": None,
            "truncated": False,
            "max_pages": None,
        },
        "issue_reactions": issue_reactions["counts"],
        "issue_reaction_total": issue_reactions["total"],
        "comment_reaction_total": all_comment_reaction_total,
        "new_comment_reaction_total": new_comment_reaction_total,
        "new_issue_reactions": issue_reaction_events_summary["total"],
        "new_issue_upvotes": issue_reaction_events_summary["upvotes"],
        "new_comment_reactions": comment_reaction_events_summary["total"],
        "new_comment_upvotes": comment_reaction_events_summary["upvotes"],
        "new_reactions": new_reactions,
        "new_upvotes": new_upvotes,
        "user_interactions": user_interactions,
        "attention": attention_level > 0,
        "attention_level": attention_level,
        "attention_marker": attention_marker,
        "engagement_score": engagement_score,
        "activity": {
            "new_issue": new_issue,
            "new_comments": len(new_comments),
            "new_human_comments": new_comment_user_interactions,
            "new_reactions": new_reactions,
            "new_upvotes": new_upvotes,
            "updated_without_visible_new_post": updated_without_visible_new_post,
        },
        "body_excerpt": compact_text(issue.get("body"), body_chars),
        "new_comments": new_comments,
    }


def count_by_label(issues, labels):
    out = {}
    for label in labels:
        matching = [issue for issue in issues if label in issue["owner_labels"]]
        out[label] = {
            "issues": len(matching),
            "new_issues": sum(
                1 for issue in matching if issue["activity"]["new_issue"]
            ),
            "new_comments": sum(
                issue["activity"]["new_comments"] for issue in matching
            ),
        }
    return out


def count_by_kind(issues):
    out = {}
    for kind in QUALIFYING_KIND_LABELS:
        matching = [issue for issue in issues if kind in issue["kind_labels"]]
        out[kind] = {
            "issues": len(matching),
            "new_issues": sum(
                1 for issue in matching if issue["activity"]["new_issue"]
            ),
            "new_comments": sum(
                issue["activity"]["new_comments"] for issue in matching
            ),
        }
    return out


def hot_items(issues, limit=8):
    ranked = sorted(
        issues,
        key=lambda issue: (
            issue["attention"],
            issue["attention_level"],
            issue["user_interactions"],
            issue["engagement_score"],
            issue["activity"]["new_comments"],
            issue["issue_reaction_total"] + issue["comment_reaction_total"],
            issue["updated_at"],
        ),
        reverse=True,
    )
    return [
        {
            "number": issue["number"],
            "title": issue["title"],
            "url": issue["url"],
            "owner_labels": issue["owner_labels"],
            "kind_labels": issue["kind_labels"],
            "attention": issue["attention"],
            "attention_level": issue["attention_level"],
            "attention_marker": issue["attention_marker"],
            "user_interactions": issue["user_interactions"],
            "new_reactions": issue["new_reactions"],
            "new_upvotes": issue["new_upvotes"],
            "engagement_score": issue["engagement_score"],
            "new_comments": issue["activity"]["new_comments"],
            "reaction_total": issue["issue_reaction_total"]
            + issue["comment_reaction_total"],
        }
        for issue in ranked[:limit]
        if issue["engagement_score"] > 0
    ]


def ranked_digest_issues(issues):
    return sorted(
        issues,
        key=lambda issue: (
            issue["attention"],
            issue["attention_level"],
            issue["user_interactions"],
            issue["engagement_score"],
            issue["activity"]["new_comments"],
            issue["updated_at"],
        ),
        reverse=True,
    )


def digest_rows(issues, limit=10, ref_map=None):
    ranked = ranked_digest_issues(issues)
    if ref_map is None:
        ref_map = {issue["number"]: ref for ref, issue in enumerate(ranked, start=1)}
    rows = []
    for issue in ranked[:limit]:
        ref = ref_map[issue["number"]]
        reaction_total = issue["issue_reaction_total"] + issue["comment_reaction_total"]
        rows.append(
            {
                "ref": ref,
                "ref_markdown": f"[{ref}]({issue['url']})",
                "marker": issue["attention_marker"],
                "attention_marker": issue["attention_marker"],
                "number": issue["number"],
                "description": issue["description"],
                "title": issue["title"],
                "url": issue["url"],
                "area": ", ".join(issue["owner_labels"]),
                "kind": ", ".join(issue["kind_labels"]),
                "state": issue["state"],
                "interactions": issue["user_interactions"],
                "user_interactions": issue["user_interactions"],
                "new_reactions": issue["new_reactions"],
                "new_upvotes": issue["new_upvotes"],
                "current_reactions": reaction_total,
            }
        )
    return rows


def issue_ref_markdown(issue, ref_map):
    ref = ref_map[issue["number"]]
    return f"[{ref}]({issue['url']})"


def summary_inputs(issues, limit=80, ref_map=None):
    ranked = ranked_digest_issues(issues)
    if ref_map is None:
        ref_map = {issue["number"]: ref for ref, issue in enumerate(ranked, start=1)}
    rows = []
    for issue in ranked[:limit]:
        rows.append(
            {
                "ref": ref_map[issue["number"]],
                "ref_markdown": issue_ref_markdown(issue, ref_map),
                "number": issue["number"],
                "title": issue["title"],
                "description": issue["description"],
                "url": issue["url"],
                "labels": issue["labels"],
                "owner_labels": issue["owner_labels"],
                "kind_labels": issue["kind_labels"],
                "state": issue.get("state", ""),
                "attention_marker": issue.get("attention_marker", ""),
                "interactions": issue["user_interactions"],
                "new_comments": issue["activity"].get("new_comments", 0),
                "new_reactions": issue.get("new_reactions", 0),
                "new_upvotes": issue.get("new_upvotes", 0),
                "current_reactions": issue.get("issue_reaction_total", 0)
                + issue.get("comment_reaction_total", 0),
            }
        )
    return rows


def collect_digest(args):
    since, until = resolve_window(args)
    window_hours = (until - since).total_seconds() / 3600
    attention_thresholds = attention_thresholds_for_window(window_hours)
    requested_labels, all_labels = normalize_requested_labels(
        args.labels, all_labels=args.all_labels
    )
    queries = build_search_queries(
        args.repo, requested_labels, since, all_labels=all_labels
    )
    numbers = search_issue_numbers(queries, args.limit_issues)
    gh_version_output = gh_text(["--version"])

    issues = []
    max_comment_pages = None if args.max_comment_pages <= 0 else args.max_comment_pages
    for number in numbers:
        issue = fetch_issue(args.repo, number)
        comments_since = None if args.fetch_all_comments else since
        comments_payload = fetch_comments(
            args.repo,
            number,
            since=comments_since,
            max_pages=max_comment_pages,
        )
        comments = comments_payload["items"]
        issue_reaction_events = fetch_reactions_for_item(
            f"repos/{args.repo}/issues/{number}/reactions", issue
        )
        comment_reactions_by_id = fetch_comment_reactions(args.repo, comments)
        comments_hydration = {
            "fetched": len(comments),
            "total": int(issue.get("comments") or len(comments) or 0),
            "since": format_timestamp(comments_since) if comments_since else None,
            "truncated": comments_payload["truncated"],
            "max_pages": comments_payload["max_pages"],
            "fetch_all_comments": args.fetch_all_comments,
        }
        summary = summarize_issue(
            issue,
            comments,
            requested_labels,
            since,
            until,
            args.body_chars,
            args.comment_chars,
            issue_reaction_events=issue_reaction_events,
            comment_reactions_by_id=comment_reactions_by_id,
            all_labels=all_labels,
            comments_hydration=comments_hydration,
            attention_thresholds=attention_thresholds,
        )
        if summary is not None:
            issues.append(summary)

    issues.sort(
        key=lambda issue: (issue["updated_at"], int(issue["number"] or 0)), reverse=True
    )
    totals = {
        "candidate_issues": len(numbers),
        "included_issues": len(issues),
        "new_issues": sum(1 for issue in issues if issue["activity"]["new_issue"]),
        "issues_with_new_comments": sum(
            1 for issue in issues if issue["activity"]["new_comments"] > 0
        ),
        "new_comments": sum(issue["activity"]["new_comments"] for issue in issues),
        "comments_fetched": sum(
            issue["comments_hydration"]["fetched"] for issue in issues
        ),
        "issues_with_truncated_comment_hydration": sum(
            1 for issue in issues if issue["comments_hydration"]["truncated"]
        ),
        "updated_without_visible_new_post": sum(
            1
            for issue in issues
            if issue["activity"]["updated_without_visible_new_post"]
        ),
        "issue_reactions_current_total": sum(
            issue["issue_reaction_total"] for issue in issues
        ),
        "comment_reactions_current_total": sum(
            issue["comment_reaction_total"] for issue in issues
        ),
        "new_reactions": sum(issue["new_reactions"] for issue in issues),
        "new_upvotes": sum(issue["new_upvotes"] for issue in issues),
        "user_interactions": sum(issue["user_interactions"] for issue in issues),
    }
    ranked = ranked_digest_issues(issues)
    ref_map = {issue["number"]: ref for ref, issue in enumerate(ranked, start=1)}
    filter_label = "all" if all_labels else requested_labels

    return {
        "generated_at": format_timestamp(datetime.now(timezone.utc)),
        "source": {
            "repo": args.repo,
            "skill": "codex-issue-digest",
            "collector": skill_relative_path(),
            "script_version": SCRIPT_VERSION,
            "git_head": git_head(),
            "gh_version": gh_version_output.splitlines()[0]
            if gh_version_output
            else None,
        },
        "window": {
            "since": format_timestamp(since),
            "until": format_timestamp(until),
            "hours": round(window_hours, 3),
        },
        "attention_thresholds": attention_thresholds,
        "filters": {
            "owner_labels": filter_label,
            "all_labels": all_labels,
            "kind_labels": list(QUALIFYING_KIND_LABELS),
        },
        "collection_notes": [
            "Issues are selected when they currently have bug or enhancement plus at least one requested owner label and were updated during the window.",
            "By default, issue comments are fetched with since=window_start and a max page cap to avoid long historical threads; use --fetch-all-comments when exhaustive comment history is needed.",
            "New issue comments are filtered by comment creation time within the window from the fetched comment set.",
            "Reaction events are counted by GitHub reaction created_at timestamps for hydrated issues and fetched comments.",
            "Current reaction totals are standing engagement signals; new_reactions and new_upvotes are windowed activity.",
            "The collector does not assign semantic clusters; use summary_inputs as model-ready evidence for report-time clustering.",
            "Pure reaction-only issues may be missed if GitHub issue search does not surface them via updated_at.",
            "Issues updated during the window without a new issue body or new comment are retained because label/status edits can still be useful owner signals.",
        ],
        "totals": totals,
        "by_owner_label": count_by_label(
            issues,
            sorted(
                {area for issue in issues for area in issue["owner_labels"]},
                key=str.casefold,
            )
            if all_labels
            else requested_labels,
        ),
        "by_kind_label": count_by_kind(issues),
        "hot_items": hot_items(issues),
        "summary_inputs": summary_inputs(issues, ref_map=ref_map),
        "digest_rows": digest_rows(issues, ref_map=ref_map),
        "issues": issues,
    }


def main():
    args = parse_args()
    try:
        digest = collect_digest(args)
    except (GhCommandError, RuntimeError, ValueError) as err:
        sys.stderr.write(f"collect_issue_digest.py error: {err}\n")
        return 1
    sys.stdout.write(json.dumps(digest, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
