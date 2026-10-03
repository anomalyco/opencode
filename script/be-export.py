# -*- coding: utf-8 -*-
"""Export the Belarusian translation for native-speaker review.

Produces, in the repository root:
  - be-translation-review.csv   (domain, key, english, belarusian) - edit in Excel
  - be-translation-review.html  (searchable / filterable review page)
  - be-translation-review.json  (machine-readable, for re-import)

Usage:
    python script/be-export.py
"""
import csv
import html
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DOMAINS = [
    ("app", "packages/app/src/i18n", "Асноўны дадатак (TUI/desktop)"),
    ("ui", "packages/ui/src/i18n", "UI-кампаненты (diff, session review)"),
    ("desktop", "packages/desktop/src/renderer/i18n", "Натыўнае меню desktop"),
    ("console", "packages/console/app/src/i18n", "Вэб-кансоль"),
]

PATTERN = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.MULTILINE)


def unescape(raw):
    inner = raw[1:-1]
    out = []
    i = 0
    while i < len(inner):
        ch = inner[i]
        if ch == "\\" and i + 1 < len(inner):
            n = inner[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}.get(n, n))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def parse(path):
    if not os.path.exists(path):
        return {}
    src = open(path, encoding="utf-8").read()
    return {m.group(1): unescape(m.group(2)) for m in PATTERN.finditer(src)}


rows = []
for domain, rel, title in DOMAINS:
    en = parse(os.path.join(ROOT, rel, "en.ts"))
    be = parse(os.path.join(ROOT, rel, "be.ts"))
    # keep English key order
    keys = list(en.keys())
    for k in be:
        if k not in en:
            keys.append(k)
    for k in keys:
        rows.append({"domain": domain, "domain_title": title, "key": k,
                     "english": en.get(k, ""), "belarusian": be.get(k, "")})

# ---- CSV (UTF-8 BOM so Excel opens Cyrillic correctly) ----
csv_path = os.path.join(ROOT, "be-translation-review.csv")
with open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["domain", "key", "english", "belarusian", "comment"])
    for r in rows:
        w.writerow([r["domain"], r["key"], r["english"], r["belarusian"], ""])

# ---- JSON ----
json_path = os.path.join(ROOT, "be-translation-review.json")
with open(json_path, "w", encoding="utf-8") as fh:
    json.dump(rows, fh, ensure_ascii=False, indent=1)

# ---- HTML review page ----
domains_html = []
for domain, rel, title in DOMAINS:
    sub = [r for r in rows if r["domain"] == domain]
    body = []
    for r in sub:
        body.append(
            '<tr data-search="{search}">'
            '<td class="k">{key}</td>'
            '<td class="en">{en}</td>'
            '<td class="be" contenteditable="true" data-key="{key}" data-domain="{domain}">{be}</td>'
            "</tr>".format(
                search=html.escape((r["key"] + " " + r["english"] + " " + r["belarusian"]).lower()),
                key=html.escape(r["key"]),
                en=html.escape(r["english"]),
                be=html.escape(r["belarusian"]),
                domain=domain,
            )
        )
    domains_html.append(
        '<section data-domain="{d}"><h2>{t} <small>({n})</small></h2>'
        '<table><thead><tr>'
        '<th class="sortable" data-col="0">Ключ</th>'
        '<th class="sortable" data-col="1">English (крыніца)</th>'
        '<th class="sortable" data-col="2">Беларуская (правіце тут)</th>'
        "</tr></thead>"
        "<tbody>{rows}</tbody></table></section>".format(
            d=domain, t=html.escape(title), n=len(sub), rows="".join(body)
        )
    )

page = """<!DOCTYPE html>
<html lang="be"><head><meta charset="utf-8">
<title>Вычытка беларускага перакладу OpenCode</title>
<style>
 body{{font-family:ui-sans-serif,system-ui,"Segoe UI",Arial,sans-serif;margin:0;background:#0b0e14;color:#e7ecf3}}
 header{{position:sticky;top:0;background:#11151d;border-bottom:1px solid #232a38;padding:14px 20px;z-index:10}}
 h1{{margin:0 0 8px;font-size:18px}}
 .bar{{display:flex;gap:10px;align-items:center;flex-wrap:wrap}}
 input,select{{font:inherit;background:#161b26;border:1px solid #232a38;color:#e7ecf3;border-radius:8px;padding:8px 10px}}
 .count{{color:#8a94a6;font-size:13px}}
 main{{padding:16px 20px 60px}}
 section{{margin-bottom:28px}}
 h2{{font-size:15px;color:#9fb2d8;border-bottom:1px solid #232a38;padding-bottom:6px}}
 h2 small{{color:#8a94a6;font-weight:400}}
 table{{width:100%;border-collapse:collapse;font-size:13px}}
 th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid #1a2029;vertical-align:top}}
 th{{color:#8a94a6;font-weight:600;position:sticky;top:74px;background:#0b0e14}}
 td.k{{font-family:ui-monospace,Consolas,monospace;color:#7f8ea8;white-space:nowrap;font-size:12px}}
 td.en{{color:#b9c6dd;width:40%}}
 td.be{{color:#e7ecf3}}
 td.be:focus{{outline:2px solid #6c8cff;border-radius:6px;background:#141a26}}
 th.sortable{{cursor:pointer;user-select:none;white-space:nowrap}}
 th.sortable:hover{{color:#cfe0ff}}
 th[data-dir=asc]::after{{content:" ▲"}}
 th[data-dir=desc]::after{{content:" ▼"}}
 .hidden{{display:none}}
 .btn{{background:#6c8cff;border:none;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600}}
 .btn.ghost{{background:transparent;border:1px solid #232a38;color:#e7ecf3}}
 .hint{{color:#8a94a6;font-size:12px}}
</style></head><body>
<header>
 <h1>Вычытка беларускага перакладу OpenCode</h1>
 <div class="bar">
  <input id="q" placeholder="Пошук па ключы/тэксце…" style="min-width:320px">
  <select id="dom">
   <option value="">Усе раздзелы</option>
   {opts}
  </select>
  <span class="count" id="count"></span>
  <button class="btn ghost" id="dl">Спампаваць праўкі (CSV)</button>
 </div>
 <div class="hint">Клікніце на беларускі тэкст і правіце прама тут. Калонка «Беларуская» рэдагуецца.</div>
</header>
<main id="main">
{domains}
</main>
<script>
const q = document.getElementById('q'), dom = document.getElementById('dom');
const rows = Array.from(document.querySelectorAll('tr[data-search]'));
function apply(){{
  const s = q.value.trim().toLowerCase();
  const d = dom.value;
  let n = 0;
  rows.forEach(r => {{
    const ok = (!s || r.dataset.search.includes(s)) && (!d || r.closest('section').dataset.domain === d);
    r.classList.toggle('hidden', !ok); if (ok) n++;
  }});
  document.querySelectorAll('section').forEach(sec => {{
    const vis = sec.querySelectorAll('tr[data-search]:not(.hidden)').length;
    sec.classList.toggle('hidden', vis === 0);
  }});
  document.getElementById('count').textContent = n + ' / ' + rows.length;
}}
q.addEventListener('input', apply); dom.addEventListener('change', apply);
q.value = ''; dom.value = ''; apply();
// click a header to sort (asc/desc) within each section
document.querySelectorAll('th.sortable').forEach(th => th.addEventListener('click', () => {{
  const table = th.closest('table'), tbody = table.querySelector('tbody');
  const idx = Number(th.dataset.col);
  const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
  table.querySelectorAll('th').forEach(h => h.removeAttribute('data-dir'));
  th.dataset.dir = dir;
  Array.from(tbody.querySelectorAll('tr'))
    .sort((a, b) => {{
      const av = a.children[idx].textContent.toLowerCase();
      const bv = b.children[idx].textContent.toLowerCase();
      return dir === 'asc' ? av.localeCompare(bv, 'be') : bv.localeCompare(av, 'be');
    }})
    .forEach(r => tbody.appendChild(r));
}}));
document.getElementById('dl').addEventListener('click', () => {{
  const edits = Array.from(document.querySelectorAll('td.be')).map(td => ({{
    domain: td.dataset.domain, key: td.dataset.key, belarusian: td.textContent
  }}));
  const blob = new Blob([JSON.stringify(edits, null, 1)], {{type:'application/json'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'be-edits.json'; a.click();
}});
</script></body></html>
""".format(
    opts="".join('<option value="{d}">{t}</option>'.format(d=d, t=html.escape(tt)) for d, _, tt in DOMAINS),
    domains="".join(domains_html),
)

html_path = os.path.join(ROOT, "be-translation-review.html")
with open(html_path, "w", encoding="utf-8") as fh:
    fh.write(page)

# ---- XLSX (nicer for Excel review), if openpyxl is available ----
try:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "be-translation"
    ws.append(["domain", "key", "english", "belarusian", "comment"])
    head_fill = PatternFill("solid", fgColor="1F2A44")
    head_font = Font(color="FFFFFF", bold=True)
    for c in range(1, 6):
        cell = ws.cell(row=1, column=c)
        cell.fill = head_fill
        cell.font = head_font
    for r in rows:
        ws.append([r["domain"], r["key"], r["english"], r["belarusian"], ""])
    widths = [10, 50, 60, 60, 24]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:E%d" % (len(rows) + 1)
    xlsx_path = os.path.join(ROOT, "be-translation-review.xlsx")
    wb.save(xlsx_path)
    print("wrote:", xlsx_path)
except Exception as exc:
    print("xlsx skipped:", exc)

print("rows:", len(rows))
print("wrote:", csv_path)
print("wrote:", html_path)
print("wrote:", json_path)
