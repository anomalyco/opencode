#!/usr/bin/env python3
"""Generate docs/changelog.json from kanban items marked as Highlight=Yes."""

import subprocess, json, os, sys, tempfile

PROJECT_ID = "PVT_kwHOBM87Yc4Bfu74"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HIGHLIGHT_FIELD = "PVTSSF_lAHOBM87Yc4Bfu74zhZ_wbs"
HIGHLIGHT_YES = "573cc802"

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


def gql(query):
    fd, filename = tempfile.mkstemp(prefix=".chlog-json-", suffix=".gql", dir=BASE_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(query)
        result = subprocess.run(
            ["gh", "api", "graphql", "-F", f"query=@{filename}"],
            capture_output=True, encoding="utf-8", timeout=30,
        )
    finally:
        os.remove(filename)
    if result.returncode != 0:
        raise RuntimeError(f"gh api failed: {result.stderr}")
    data = json.loads(result.stdout)
    if data.get("errors"):
        raise RuntimeError(f"GraphQL errors: {data['errors']}")
    return data


def get_all_items():
    items = []
    cursor = None
    while True:
        after = f',after:"{cursor}"' if cursor else ""
        data = gql(
            f'{{node(id:"{PROJECT_ID}"){{...on ProjectV2{{'
            f'items(first:100{after}){{pageInfo{{hasNextPage,endCursor}},nodes{{id,'
            f'content{{...on Issue{{number,title,body,state}}}}'
            f'fieldValues(first:50){{nodes{{'
            f'...on ProjectV2ItemFieldSingleSelectValue{{field{{...on ProjectV2FieldCommon{{name}}}},name}}'
            f'}}}}}}}}}}}}}}'
        )
        connection = data["data"]["node"]["items"]
        items.extend(connection["nodes"])
        if not connection["pageInfo"]["hasNextPage"]:
            return items
        cursor = connection["pageInfo"]["endCursor"]


def main():
    print("Generating changelog.json from kanban highlights...")
    items = get_all_items()

    by_version = {}
    for item in items:
        ct = item.get("content", {})
        if not ct or "number" not in ct or ct.get("state") != "CLOSED":
            continue

        fields = {}
        for fv in item.get("fieldValues", {}).get("nodes", []):
            name = fv.get("field", {}).get("name", "?")
            val = fv.get("name", "?")
            if val != "?":
                fields[name] = val

        if fields.get("Status") != "Changelog":
            continue

        # Check Highlight field
        hl_val = fields.get("HighLighted", fields.get("Highlight", fields.get("HighLight", "No")))
        if hl_val != "Yes":
            continue

        # Determine version
        ver = (
            fields.get("Versión")
            or fields.get("Version")
            or fields.get("versión")
            or fields.get("versi")
            or "Sin asignar"
        )

        title = ct.get("title", "?").replace("✅ ", "")
        body = ct.get("body", "") or ""
        # First meaningful content line (skip headings, empty, comments)
        desc = title
        for line in body.split("\n"):
            stripped = line.strip()
            if not stripped or stripped.startswith("<!--"):
                continue
            if stripped.startswith("#"):
                continue
            desc = stripped
            break

        by_version.setdefault(ver, []).append({"title": title, "description": desc})

    version_order = ["v0.1.5", "v0.1.4", "v0.1.3", "v0.1.2", "v0.1.1", "v0.1.0"]
    sorted_versions = [v for v in version_order if v in by_version]
    # Include any versions not in the predefined order
    for v in sorted(by_version.keys()):
        if v not in sorted_versions:
            sorted_versions.append(v)

    json_data = {"releases": []}
    for ver in sorted_versions:
        json_data["releases"].append({
            "tag": ver,
            "highlights": [{
                "source": "desktop",
                "items": by_version[ver],
            }],
        })

    out_path = os.path.join(BASE_DIR, "..", "docs", "changelog.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    hl_total = sum(len(v) for v in by_version.values())
    print(f"  OK changelog.json regenerated ({hl_total} highlights across {len(sorted_versions)} versions)")


if __name__ == "__main__":
    main()
