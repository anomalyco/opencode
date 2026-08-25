import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

print(f"HTML length: {len(html)} chars\n")

# Search for location patterns
print("=== LOCATION ===")
for pattern in [
    r'Chennai[^<"]{0,100}',
    r'Punjab[^<"]{0,100}',
    r'India[^<"]{0,100}',
    r'([A-Z][a-z]+,\s*[A-Z][a-z]+,\s*[A-Z][a-z]+)',
]:
    matches = re.findall(pattern, html)
    if matches:
        unique = list(dict.fromkeys(matches))[:3]
        print(f"  Pattern '{pattern[:50]}': {unique}")

# Search for About section
print("\n=== ABOUT ===")
idx = html.find('About')
if idx >= 0:
    snippet = html[idx:idx+1000].replace('\n', ' ')
    print(f"  'About' at {idx}: {snippet[:300]}")

# Search for education
print("\n=== EDUCATION ===")
for pattern in [
    r'University[^<"]{0,100}',
    r'College[^<"]{0,100}',
    r'Institute[^<"]{0,100}',
    r'School[^<"]{0,100}',
]:
    matches = re.findall(pattern, html)
    if matches:
        unique = list(dict.fromkeys(matches))[:3]
        print(f"  Pattern '{pattern[:50]}': {unique}")

# Search for company
print("\n=== COMPANY ===")
for pattern in [
    r'Zenteiq[^<"]{0,100}',
    r'alt="([^"]{3,50})"[^>]*class="[^"]*avatar',
    r'Intern[^<]{0,100}',
]:
    matches = re.findall(pattern, html)
    if matches:
        unique = list(dict.fromkeys(matches))[:3]
        print(f"  Pattern '{pattern[:50]}': {unique}")

# Search for connections
print("\n=== CONNECTIONS ===")
m = re.search(r'(\d+)\+?\s*connections?', html, re.IGNORECASE)
if m:
    print(f"  Connections: {m.group(1)}")

# Search for headline in the HTML
print("\n=== HEADLINE CHECK ===")
m = re.search(r'Intern @ Zenteiq', html)
if m:
    print(f"  Found 'Intern @ Zenteiq' at position {m.start()}")
    snippet = html[m.start()-200:m.start()+200].replace('\n', ' ')
    print(f"  Context: {snippet[:300]}")
