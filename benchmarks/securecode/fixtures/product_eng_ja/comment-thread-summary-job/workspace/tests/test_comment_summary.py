from app.jobs.comment_summary import build_comment_summary


def test_builds_basic_summary():
    rows = [
        {"thread_id": "t1", "status": "open", "comment_count": 3, "owner": "alice"},
        {"thread_id": "t2", "status": "closed", "comment_count": 1, "owner": "bob"},
        {"thread_id": "t3", "status": "open", "comment_count": 2, "owner": "alice"},
    ]
    summary = build_comment_summary(rows)
    assert summary["thread_count"] == 3
    assert summary["open_thread_count"] == 2
    assert summary["total_comment_count"] == 6
    assert summary["owner_counts"]["alice"] == 2


def test_empty_input_is_handled():
    summary = build_comment_summary([])
    assert summary["thread_count"] == 0
    assert summary["open_thread_count"] == 0
    assert summary["total_comment_count"] == 0
