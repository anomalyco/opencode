import importlib.util
from datetime import timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("collect_issue_digest.py")
MODULE_SPEC = importlib.util.spec_from_file_location(
    "collect_issue_digest", MODULE_PATH
)
collect_issue_digest = importlib.util.module_from_spec(MODULE_SPEC)
assert MODULE_SPEC.loader is not None
MODULE_SPEC.loader.exec_module(collect_issue_digest)


def test_build_search_queries_uses_each_owner_and_kind_label():
    since = collect_issue_digest.parse_timestamp("2026-04-25T12:34:56Z", "--since")

    queries = collect_issue_digest.build_search_queries(
        "openai/codex", ["tui", "exec"], since
    )

    assert queries == [
        "repo:openai/codex is:issue updated:>=2026-04-25 label:tui label:bug",
        "repo:openai/codex is:issue updated:>=2026-04-25 label:tui label:enhancement",
        "repo:openai/codex is:issue updated:>=2026-04-25 label:exec label:bug",
        "repo:openai/codex is:issue updated:>=2026-04-25 label:exec label:enhancement",
    ]


def test_build_search_queries_can_scan_all_labels():
    since = collect_issue_digest.parse_timestamp("2026-04-25T12:34:56Z", "--since")

    queries = collect_issue_digest.build_search_queries(
        "openai/codex", [], since, all_labels=True
    )

    assert queries == [
        "repo:openai/codex is:issue updated:>=2026-04-25 label:bug",
        "repo:openai/codex is:issue updated:>=2026-04-25 label:enhancement",
    ]


def test_normalize_requested_labels_accepts_all_area_phrases():
    assert collect_issue_digest.normalize_requested_labels(["all", "areas"]) == (
        [],
        True,
    )
    assert collect_issue_digest.normalize_requested_labels(["all-labels"]) == (
        [],
        True,
    )


def test_summarize_issue_keeps_new_comments_and_reaction_signals():
    since = collect_issue_digest.parse_timestamp("2026-04-25T00:00:00Z", "--since")
    until = collect_issue_digest.parse_timestamp("2026-04-26T00:00:00Z", "--until")
    issue = {
        "number": 123,
        "title": "TUI does not redraw",
        "html_url": "https://github.com/openai/codex/issues/123",
        "state": "open",
        "created_at": "2026-04-24T20:00:00Z",
        "updated_at": "2026-04-25T10:00:00Z",
        "user": {"login": "alice"},
        "author_association": "NONE",
        "comments": 2,
        "body": "The terminal freezes after resize.",
        "labels": [{"name": "bug"}, {"name": "tui"}],
        "reactions": {"total_count": 3, "+1": 2, "rocket": 1},
    }
    comments = [
        {
            "id": 1,
            "created_at": "2026-04-25T11:00:00Z",
            "updated_at": "2026-04-25T11:00:00Z",
            "html_url": "https://github.com/openai/codex/issues/123#issuecomment-1",
            "user": {"login": "bob"},
            "author_association": "MEMBER",
            "body": "I can reproduce this on main.",
            "reactions": {"total_count": 4, "heart": 1, "+1": 3},
        },
        {
            "id": 2,
            "created_at": "2026-04-24T11:00:00Z",
            "updated_at": "2026-04-24T11:00:00Z",
            "html_url": "https://github.com/openai/codex/issues/123#issuecomment-2",
            "user": {"login": "carol"},
            "author_association": "NONE",
            "body": "Older comment.",
            "reactions": {"total_count": 1, "eyes": 1},
        },
    ]

    summary = collect_issue_digest.summarize_issue(
        issue,
        comments,
        ["tui", "exec"],
        since,
        until,
        body_chars=200,
        comment_chars=200,
    )

    assert summary == {
        "number": 123,
        "title": "TUI does not redraw",
        "description": "TUI does not redraw",
        "url": "https://github.com/openai/codex/issues/123",
        "state": "open",
        "author": "alice",
        "author_association": "NONE",
        "created_at": "2026-04-24T20:00:00Z",
        "updated_at": "2026-04-25T10:00:00Z",
        "labels": ["bug", "tui"],
        "kind_labels": ["bug"],
        "owner_labels": ["tui"],
        "comments_total": 2,
        "comments_hydration": {
            "fetched": 2,
            "since": None,
            "truncated": False,
            "max_pages": None,
        },
        "issue_reactions": {"+1": 2, "rocket": 1},
        "issue_reaction_total": 3,
        "comment_reaction_total": 5,
        "new_comment_reaction_total": 4,
        "new_issue_reactions": 0,
        "new_issue_upvotes": 0,
        "new_comment_reactions": 0,
        "new_comment_upvotes": 0,
        "new_reactions": 0,
        "new_upvotes": 0,
        "user_interactions": 1,
        "attention": False,
        "attention_level": 0,
        "attention_marker": "",
        "engagement_score": 12,
        "activity": {
            "new_issue": False,
            "new_comments": 1,
            "new_human_comments": 1,
            "new_reactions": 0,
            "new_upvotes": 0,
            "updated_without_visible_new_post": False,
        },
        "body_excerpt": "The terminal freezes after resize.",
        "new_comments": [
            {
                "id": 1,
                "author": "bob",
                "author_association": "MEMBER",
                "created_at": "2026-04-25T11:00:00Z",
                "updated_at": "2026-04-25T11:00:00Z",
                "url": "https://github.com/openai/codex/issues/123#issuecomment-1",
                "human_user_interaction": True,
                "reactions": {"+1": 3, "heart": 1},
                "reaction_total": 4,
                "new_reactions": 0,
                "new_upvotes": 0,
                "new_reaction_counts": {},
                "body_excerpt": "I can reproduce this on main.",
            }
        ],
    }


def test_summarize_issue_filters_non_owner_or_non_kind_labels():
    since = collect_issue_digest.parse_timestamp("2026-04-25T00:00:00Z", "--since")
    until = collect_issue_digest.parse_timestamp("2026-04-26T00:00:00Z", "--until")
    base_issue = {
        "number": 1,
        "title": "Question",
        "created_at": "2026-04-25T01:00:00Z",
        "updated_at": "2026-04-25T01:00:00Z",
        "labels": [{"name": "question"}, {"name": "tui"}],
    }

    assert (
        collect_issue_digest.summarize_issue(
            base_issue,
            [],
            ["tui"],
            since,
            until,
            body_chars=100,
            comment_chars=100,
        )
        is None
    )

    issue_without_owner = dict(base_issue)
    issue_without_owner["labels"] = [{"name": "bug"}, {"name": "app"}]

    assert (
        collect_issue_digest.summarize_issue(
            issue_without_owner,
            [],
            ["tui"],
            since,
            until,
            body_chars=100,
            comment_chars=100,
        )
        is None
    )


def test_resolve_window_defaults_to_previous_hours():
    class Args:
        since = None
        until = "2026-04-26T12:00:00Z"
        window_hours = 24

    since, until = collect_issue_digest.resolve_window(Args())

    assert since.isoformat() == "2026-04-25T12:00:00+00:00"
    assert until.tzinfo == timezone.utc


def test_parse_duration_hours_accepts_common_phrases():
    assert collect_issue_digest.parse_duration_hours("past week") == 168
    assert collect_issue_digest.parse_duration_hours("48h") == 48
    assert collect_issue_digest.parse_duration_hours("2 days") == 48
    assert collect_issue_digest.parse_duration_hours("1w") == 168


def test_attention_thresholds_scale_by_window_length():
    one_day = collect_issue_digest.attention_thresholds_for_window(24)
    assert one_day["elevated"] == 10
    assert one_day["very_high"] == 20

    half_day = collect_issue_digest.attention_thresholds_for_window(12)
    assert half_day["elevated"] == 5
    assert half_day["very_high"] == 10

    week = collect_issue_digest.attention_thresholds_for_window(168)
    assert week["elevated"] == 70
    assert week["very_high"] == 140
    assert collect_issue_digest.attention_marker_for(69, week) == ""
    assert collect_issue_digest.attention_marker_for(107, week) == "🔥"
    assert collect_issue_digest.attention_marker_for(140, week) == "🔥🔥"


def test_fetch_comments_uses_since_filter_and_page_cap(monkeypatch):
    calls = []

    def fake_gh_json(args):
        calls.append(args)
        return [{"id": idx} for idx in range(100)]

    monkeypatch.setattr(collect_issue_digest, "gh_json", fake_gh_json)
    since = collect_issue_digest.parse_timestamp("2026-04-25T00:00:00Z", "--since")

    payload = collect_issue_digest.fetch_comments(
        "openai/codex", 123, since=since, max_pages=1
    )

    assert len(payload["items"]) == 100
    assert payload["truncated"] is True
    assert payload["max_pages"] == 1
    assert calls == [
        [
            "api",
            "repos/openai/codex/issues/123/comments?since=2026-04-25T00%3A00%3A00Z&per_page=100&page=1",
        ]
    ]


def test_issue_description_prefers_title_over_body_noise():
    issue = {
        "title": "Codex.app GUI: MCP child processes not reaped after task completion",
        "body": "A later crash mention should not override the title-level symptom.",
        "labels": [{"name": "app"}, {"name": "bug"}],
    }

    description = collect_issue_digest.issue_description(issue)
    assert "MCP child processes" in description
    assert "crash" not in description.casefold()


def test_attention_markers_count_human_user_interactions():
    since = collect_issue_digest.parse_timestamp("2026-04-25T00:00:00Z", "--since")
    until = collect_issue_digest.parse_timestamp("2026-04-26T00:00:00Z", "--until")
    issue = {
        "number": 456,
        "title": "Agent context is exploding",
        "html_url": "https://github.com/openai/codex/issues/456",
        "state": "open",
        "created_at": "2026-04-25T01:00:00Z",
        "updated_at": "2026-04-25T12:00:00Z",
        "user": {"login": "alice"},
        "labels": [{"name": "bug"}, {"name": "agent"}],
    }
    comments = [
        {
            "id": idx,
            "created_at": "2026-04-25T02:00:00Z",
            "updated_at": "2026-04-25T02:00:00Z",
            "user": {"login": f"user-{idx}"},
            "body": "same here",
        }
        for idx in range(9)
    ]
    comments.append(
        {
            "id": 99,
            "created_at": "2026-04-25T02:00:00Z",
            "updated_at": "2026-04-25T02:00:00Z",
            "user": {"login": "github-actions[bot]"},
            "body": "duplicate bot note",
        }
    )

    summary = collect_issue_digest.summarize_issue(
        issue,
        comments,
        ["agent"],
        since,
        until,
        body_chars=100,
        comment_chars=100,
    )

    assert summary["user_interactions"] == 10
    assert summary["activity"]["new_human_comments"] == 9
    assert summary["attention"] is True
    assert summary["attention_level"] == 1
    assert summary["attention_marker"] == "🔥"

    issue["created_at"] = "2026-04-24T01:00:00Z"
    comments.extend(
        {
            "id": idx,
            "created_at": "2026-04-25T03:00:00Z",
            "updated_at": "2026-04-25T03:00:00Z",
            "user": {"login": f"extra-user-{idx}"},
            "body": "also seeing this",
        }
        for idx in range(11)
    )

    summary = collect_issue_digest.summarize_issue(
        issue,
        comments,
        ["agent"],
        since,
        until,
        body_chars=100,
        comment_chars=100,
    )

    assert summary["user_interactions"] == 20
    assert summary["attention_level"] == 2
    assert summary["attention_marker"] == "🔥🔥"


def test_reactions_count_toward_attention_markers():
    since = collect_issue_digest.parse_timestamp("2026-04-25T00:00:00Z", "--since")
    until = collect_issue_digest.parse_timestamp("2026-04-26T00:00:00Z", "--until")
    issue = {
        "number": 789,
        "title": "Support 1M token context",
        "html_url": "https://github.com/openai/codex/issues/789",
        "state": "open",
        "created_at": "2026-04-24T01:00:00Z",
        "updated_at": "2026-04-25T12:00:00Z",
        "user": {"login": "alice"},
        "labels": [{"name": "enhancement"}, {"name": "context"}],
        "reactions": {"total_count": 20, "+1": 20},
    }
    comments = [
        {
            "id": 1,
            "created_at": "2026-04-25T02:00:00Z",
            "updated_at": "2026-04-25T02:00:00Z",
            "user": {"login": "commenter"},
            "body": "please",
            "reactions": {"total_count": 2, "+1": 2},
        }
    ]
    issue_reactions = [
        {
            "content": "+1",
            "created_at": "2026-04-25T03:00:00Z",
            "user": {"login": f"reactor-{idx}"},
        }
        for idx in range(18)
    ]
    comment_reactions_by_id = {
        1: [
            {
                "content": "heart",
                "created_at": "2026-04-25T04:00:00Z",
                "user": {"login": "human-reactor"},
            },
            {
                "content": "+1",
                "created_at": "2026-04-25T04:00:00Z",
                "user": {"login": "github-actions[bot]"},
            },
        ]
    }

    summary = collect_issue_digest.summarize_issue(
        issue,
        comments,
        ["context"],
        since,
        until,
        body_chars=100,
        comment_chars=100,
        issue_reaction_events=issue_reactions,
        comment_reactions_by_id=comment_reactions_by_id,
    )

    assert summary["new_reactions"] == 19
    assert summary["new_upvotes"] == 18
    assert summary["user_interactions"] == 20
    assert summary["attention_level"] == 2
    assert summary["attention_marker"] == "🔥🔥"
    assert summary["new_comments"][0]["new_reactions"] == 1
    assert summary["new_comments"][0]["new_upvotes"] == 0


def test_digest_rows_are_table_ready_with_concise_descriptions():
    rows = collect_issue_digest.digest_rows(
        [
            {
                "number": 1,
                "title": "Quiet bug",
                "description": "Quiet bug",
                "url": "https://github.com/openai/codex/issues/1",
                "owner_labels": ["context"],
                "kind_labels": ["bug"],
                "state": "open",
                "attention": False,
                "attention_level": 0,
                "attention_marker": "",
                "user_interactions": 1,
                "new_reactions": 0,
                "new_upvotes": 0,
                "engagement_score": 3,
                "issue_reaction_total": 0,
                "comment_reaction_total": 0,
                "updated_at": "2026-04-25T01:00:00Z",
                "activity": {
                    "new_issue": True,
                    "new_comments": 0,
                    "new_reactions": 0,
                    "updated_without_visible_new_post": False,
                },
            },
            {
                "number": 2,
                "title": "Busy bug",
                "description": "High-volume bug report",
                "url": "https://github.com/openai/codex/issues/2",
                "owner_labels": ["agent"],
                "kind_labels": ["bug"],
                "state": "open",
                "attention": True,
                "attention_level": 1,
                "attention_marker": "🔥",
                "user_interactions": 17,
                "new_reactions": 3,
                "new_upvotes": 2,
                "engagement_score": 20,
                "issue_reaction_total": 5,
                "comment_reaction_total": 2,
                "updated_at": "2026-04-25T02:00:00Z",
                "activity": {
                    "new_issue": False,
                    "new_comments": 16,
                    "new_reactions": 3,
                    "updated_without_visible_new_post": False,
                },
            },
        ]
    )

    assert rows[0] == {
        "ref": 1,
        "ref_markdown": "[1](https://github.com/openai/codex/issues/2)",
        "marker": "🔥",
        "attention_marker": "🔥",
        "number": 2,
        "description": "High-volume bug report",
        "title": "Busy bug",
        "url": "https://github.com/openai/codex/issues/2",
        "area": "agent",
        "kind": "bug",
        "state": "open",
        "interactions": 17,
        "user_interactions": 17,
        "new_reactions": 3,
        "new_upvotes": 2,
        "current_reactions": 7,
    }


def test_summary_inputs_are_model_ready_without_preclustering():
    issues = [
        {
            "number": 20,
            "title": "Windows app Browser Use external navigation fails",
            "description": "Browser Use navigation or app-server failure",
            "url": "https://github.com/openai/codex/issues/20",
            "labels": ["app", "bug"],
            "owner_labels": ["app"],
            "kind_labels": ["bug"],
            "attention": False,
            "attention_level": 0,
            "attention_marker": "",
            "user_interactions": 3,
            "new_reactions": 1,
            "engagement_score": 8,
            "updated_at": "2026-04-25T04:00:00Z",
            "activity": {"new_comments": 2},
        },
        {
            "number": 21,
            "title": "On Windows, cmake output waits until timeout",
            "description": "Windows command timeout/capture problem",
            "url": "https://github.com/openai/codex/issues/21",
            "labels": ["app", "bug"],
            "owner_labels": ["app"],
            "kind_labels": ["bug"],
            "attention": False,
            "attention_level": 0,
            "attention_marker": "",
            "user_interactions": 3,
            "new_reactions": 0,
            "engagement_score": 7,
            "updated_at": "2026-04-25T03:00:00Z",
            "activity": {"new_comments": 3},
        },
        {
            "number": 22,
            "title": "Windows computer use tool fails to click buttons",
            "description": "Computer-use workflow failure",
            "url": "https://github.com/openai/codex/issues/22",
            "labels": ["app", "bug"],
            "owner_labels": ["app"],
            "kind_labels": ["bug"],
            "attention": False,
            "attention_level": 0,
            "attention_marker": "",
            "user_interactions": 3,
            "new_reactions": 0,
            "engagement_score": 6,
            "updated_at": "2026-04-25T02:00:00Z",
            "activity": {"new_comments": 3},
        },
    ]

    rows = collect_issue_digest.summary_inputs(issues, ref_map={20: 1, 21: 2, 22: 3})

    assert rows == [
        {
            "ref": 1,
            "ref_markdown": "[1](https://github.com/openai/codex/issues/20)",
            "number": 20,
            "title": "Windows app Browser Use external navigation fails",
            "description": "Browser Use navigation or app-server failure",
            "url": "https://github.com/openai/codex/issues/20",
            "labels": ["app", "bug"],
            "owner_labels": ["app"],
            "kind_labels": ["bug"],
            "state": "",
            "attention_marker": "",
            "interactions": 3,
            "new_comments": 2,
            "new_reactions": 1,
            "new_upvotes": 0,
            "current_reactions": 0,
        },
        {
            "ref": 2,
            "ref_markdown": "[2](https://github.com/openai/codex/issues/21)",
            "number": 21,
            "title": "On Windows, cmake output waits until timeout",
            "description": "Windows command timeout/capture problem",
            "url": "https://github.com/openai/codex/issues/21",
            "labels": ["app", "bug"],
            "owner_labels": ["app"],
            "kind_labels": ["bug"],
            "state": "",
            "attention_marker": "",
            "interactions": 3,
            "new_comments": 3,
            "new_reactions": 0,
            "new_upvotes": 0,
            "current_reactions": 0,
        },
        {
            "ref": 3,
            "ref_markdown": "[3](https://github.com/openai/codex/issues/22)",
            "number": 22,
            "title": "Windows computer use tool fails to click buttons",
            "description": "Computer-use workflow failure",
            "url": "https://github.com/openai/codex/issues/22",
            "labels": ["app", "bug"],
            "owner_labels": ["app"],
            "kind_labels": ["bug"],
            "state": "",
            "attention_marker": "",
            "interactions": 3,
            "new_comments": 3,
            "new_reactions": 0,
            "new_upvotes": 0,
            "current_reactions": 0,
        },
    ]
