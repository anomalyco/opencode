import re

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

print(f"HTML length: {len(html)} chars\n")

# Title
m = re.search(r'<title[^>]*>([^<]+)</title>', html)
if m:
    print(f"Title: {m.group(1)}")

# Name: look for person-name or heading patterns
for pattern, label in [
    (r'data-anonymize="person-name"[^>]*>([^<]+)', 'person-name'),
    (r'alt="([^"]+)"[^>]*class="[^"]*avatar', 'avatar alt'),
]:
    matches = re.findall(pattern, html)
    if matches:
        print(f"{label}: {matches[:3]}")

# Search around "Sashriya" mentions
sashriya_positions = [m.start() for m in re.finditer(r'Sashriya', html, re.IGNORECASE)]
print(f"\n'Sashriya' found at {len(sashriya_positions)} positions")
for pos in sashriya_positions[:5]:
    snippet = html[max(0, pos-100):pos+200]
    # clean up
    snippet = snippet.replace('\n', ' ')[:300]
    print(f"  pos {pos}: ...{snippet}...")

# Search for headline text near profile
print("\n--- Searching for profile text patterns ---")
# Look for patterns with quotes around text values
for pattern, label in [
    (r'"headline"[^}]*"text"\s*:\s*"([^"]+)"', 'headline json'),
    (r'"summary"[^}]*"text"\s*:\s*"([^"]+)"', 'summary json'),
    (r'"location"[^}]*"text"\s*:\s*"([^"]+)"', 'location json'),
    (r'"firstName"\s*:\s*"([^"]+)"', 'firstName json'),
    (r'"lastName"\s*:\s*"([^"]+)"', 'lastName json'),
    (r'"occupation"\s*:\s*"([^"]+)"', 'occupation json'),
]:
    matches = re.findall(pattern, html)
    if matches:
        print(f"{label}: {matches[:3]}")

# Look for text after About section header
about_idx = html.find('"About"')
if about_idx < 0:
    about_idx = html.find('>About<')
if about_idx >= 0:
    snippet = html[about_idx:about_idx+1000].replace('\n', ' ')
    print(f"\nAbout section context (pos {about_idx}):\n{snippet[:500]}")

# Look for JSON data blocks
print("\n--- Searching for embedded JSON data ---")
json_blocks = re.findall(r'publicProfilePrefetchInfo\s*[=:]\s*(\{[^}]+\})', html)
if json_blocks:
    for i, block in enumerate(json_blocks[:3]):
        print(f"JSON block {i}: {block[:300]}")

# Look for serverSideSVGPersonDataSet or similar
for label in ['serverSideSVGPerson', 'profilePrefetchInfo', 'ProfileData']:
    idx = html.find(label)
    if idx >= 0:
        snippet = html[idx:idx+500].replace('\n', ' ')
        print(f"\n{label} at {idx}: {snippet[:300]}")
