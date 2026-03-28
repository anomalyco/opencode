from app.exporters.customer_export import build_customer_export


def test_inactive_rows_are_removed_and_sorted():
    rows = [
        {"customer_id": "c3", "status": "active", "created_at": "2026-03-20T12:00:00Z"},
        {"customer_id": "c1", "status": "inactive", "created_at": "2026-03-18T12:00:00Z"},
        {"customer_id": "c2", "status": "active", "created_at": "2026-03-19T12:00:00Z"},
    ]
    chunks = build_customer_export(rows, chunk_size=1)
    assert chunks == [[{"customer_id": "c2", "status": "active", "created_at": "2026-03-19T12:00:00Z"}], [{"customer_id": "c3", "status": "active", "created_at": "2026-03-20T12:00:00Z"}]]


def test_chunk_size_groups_rows():
    rows = [
        {"customer_id": "c1", "status": "active", "created_at": "2026-03-18T12:00:00Z"},
        {"customer_id": "c2", "status": "active", "created_at": "2026-03-19T12:00:00Z"},
        {"customer_id": "c3", "status": "active", "created_at": "2026-03-20T12:00:00Z"},
    ]
    chunks = build_customer_export(rows, chunk_size=2)
    assert len(chunks) == 2
    assert len(chunks[0]) == 2
    assert len(chunks[1]) == 1
