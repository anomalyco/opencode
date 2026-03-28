from collections import Counter


def build_comment_summary(rows):
    counts = Counter(item["owner"] for item in rows)
    return {
        "thread_count": len(rows),
        "owner_counts": dict(counts),
    }
