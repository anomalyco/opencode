import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

# Find all componentkey values
componentkeys = re.findall(r'componentkey="([^"]+)"', html)
print(f"Found {len(componentkeys)} componentkey values:")
for ck in componentkeys[:20]:
    print(f"  {ck}")

# Search for "About" in any context
print("\n=== 'About' occurrences ===")
for m in re.finditer(r'About', html):
    idx = m.start()
    snippet = html[max(0, idx-50):idx+100].replace('\n', ' ')
    print(f"  pos {idx}: ...{snippet}...")

# Search for expandable text
print("\n=== expandable-text-box ===")
matches = re.findall(r'data-testid="expandable-text-box">(.*?)</span>', html, re.DOTALL)
for i, m in enumerate(matches[:3]):
    clean = re.sub(r'<[^>]+>', '', m).strip()
    print(f"  [{i}]: {clean[:200]}")

# Search for education/school
print("\n=== Education patterns ===")
for pattern in [
    r'"schoolName"[^}]*"text"\s*:\s*"([^"]+)"',
    r'"fieldOfStudy"[^}]*"text"\s*:\s*"([^"]+)"',
    r'"degree"[^}]*"text"\s*:\s*"([^"]+)"',
    r'>([A-Z][a-zA-Z\s]+(?:University|College|Institute))<',
]:
    matches = re.findall(pattern, html)
    if matches:
        print(f"  Pattern '{pattern[:60]}': {matches[:3]}")

# Search for experience
print("\n=== Experience patterns ===")
for pattern in [
    r'"companyName"[^}]*"text"\s*:\s*"([^"]+)"',
    r'"title"[^}]*"text"\s*:\s*"([^"]+)"',
    r'Zenteiq[^<"]{0,200}',
]:
    matches = re.findall(pattern, html)
    if matches:
        print(f"  Pattern '{pattern[:60]}': {matches[:3]}")

# Search for connections
print("\n=== Connections ===")
m = re.search(r'(\d+)\+?\s*[Cc]onnection', html)
if m:
    print(f"  {m.group(0)}")
