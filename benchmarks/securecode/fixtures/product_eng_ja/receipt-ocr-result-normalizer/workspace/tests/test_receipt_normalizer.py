from app.normalizers.receipt import normalize_receipt


def test_missing_fields_are_normalized():
    row = normalize_receipt({"total": "1,280"})
    assert row["store_name"] == "unknown-store"
    assert row["total"] == 1280
    assert row["items"] == []


def test_existing_items_are_preserved():
    row = normalize_receipt({"store_name": "Cafe", "total": "320", "items": [{"name": "coffee"}]})
    assert row["store_name"] == "Cafe"
    assert row["total"] == 320
    assert row["items"] == [{"name": "coffee"}]
