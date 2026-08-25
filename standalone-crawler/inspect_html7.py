import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

# Get the About section content
# Look for the About header and the content that follows
about_header_idx = html.find('About</p>')
if about_header_idx < 0:
    about_header_idx = html.find('About</h2>')
if about_header_idx >= 0:
    # Get a large chunk after the About header
    chunk = html[about_header_idx:about_header_idx+3000].replace('\n', ' ')
    print(f"About section (pos {about_header_idx}):\n{chunk[:800]}")
    print()

# Look for profile data in JSON-like structures
print("=== Searching for profile data in JSON ===")
# LinkedIn sometimes embeds profile data in script tags or data attributes
for pattern in [
    r'"firstName"\s*:\s*"([^"]+)"',
    r'"lastName"\s*:\s*"([^"]+)"',
    r'"headline"\s*:\s*"([^"]+)"',
    r'"location"\s*:\s*"([^"]+)"',
    r'"summary"\s*:\s*"([^"]+)"',
    r'"industry"\s*:\s*"([^"]+)"',
]:
    matches = re.findall(pattern, html)
    if matches:
        print(f"  {pattern[:40]}: {matches[:2]}")

# Look for the actual profile text content
print("\n=== Profile text content ===")
# Search for the name and surrounding text
name_idx = html.find('Sashriya M</p>')
if name_idx >= 0:
    chunk = html[name_idx:name_idx+2000].replace('\n', ' ')
    print(f"After name (pos {name_idx}):\n{chunk[:500]}")

# Search for education section
print("\n=== Education section ===")
for keyword in ['education', 'Education', 'school', 'School', 'university', 'University', 'college', 'College']:
    idx = html.find(keyword)
    if idx >= 0:
        chunk = html[max(0, idx-100):idx+500].replace('\n', ' ')
        print(f"'{keyword}' at {idx}: {chunk[:300]}")
        print()
