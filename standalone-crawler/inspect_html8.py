import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

# The profile content is likely in the section after the name
# Let's find the section that contains the profile info
# Look for the section with the profile details

# Find all <p> tags with text content
print("=== All <p> tags with substantial text ===")
p_tags = re.findall(r'<p[^>]*>(.*?)</p>', html, re.DOTALL)
for i, p in enumerate(p_tags):
    clean = re.sub(r'<[^>]+>', '', p).strip()
    if len(clean) > 20 and not clean.startswith('{') and not clean.startswith('"'):
        print(f"  [{i}]: {clean[:200]}")

print("\n=== Looking for profile section after name ===")
# Find the section that comes after the name and headline
name_pos = html.find('Sashriya M</p>')
if name_pos >= 0:
    # Get a larger chunk after the name
    chunk = html[name_pos:name_pos+5000]
    # Find all text content
    texts = re.findall(r'>([^<]{10,})<', chunk)
    print(f"Texts after name:")
    for t in texts:
        clean = t.strip()
        if clean and not clean.startswith('{') and not clean.startswith('"'):
            print(f"  {clean[:200]}")
