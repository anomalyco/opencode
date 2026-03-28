def normalize_receipt(row):
    return {
        "store_name": row.get("store_name", ""),
        "total": row.get("total"),
        "items": row.get("items"),
    }
