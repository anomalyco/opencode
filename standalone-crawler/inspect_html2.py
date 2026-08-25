import re

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

# Extract name from <p> tag after aria-label="Sashriya M"
m = re.search(r'aria-label="Sashriya M"[^>]*>.*?<p[^>]*>([^<]+)</p>', html, re.DOTALL)
if m:
    print(f"Name from aria-label+<p>: {m.group(1).strip()}")

# Extract name from title
m = re.search(r'<title[^>]*>([^|]+)\s*\|', html)
if m:
    print(f"Name from title: {m.group(1).strip()}")

# Extract headline - look for span after the name
# Pattern: after the name <p> tag, there's a div with headline text
m = re.search(r'Sashriya M</p>.*?<span[^>]*>([^<]+)</span>', html, re.DOTALL)
if m:
    headline = m.group(1).strip()
    print(f"Headline: {headline}")

# Location - search for text with comma (city, state pattern)
# LinkedIn often has location in a specific span
m = re.search(r'Punjab[^<]*', html)
if m:
    print(f"Location (Punjab): {m.group(0)[:200]}")

# Search for "India" near profile content
idx = html.find('India')
if idx >= 0:
    snippet = html[max(0, idx-200):idx+100].replace('\n', ' ')
    print(f"India at {idx}: ...{snippet}...")

# About section content
m = re.search(r'About</h2>.*?<span[^>]*>(.*?)</span>', html, re.DOTALL)
if m:
    about_text = m.group(1).strip()
    # Clean up HTML tags
    about_text = re.sub(r'<[^>]+>', '', about_text)
    print(f"\nAbout section:\n{about_text[:500]}")

# Experience section
idx = html.find('Experience</h2>')
if idx < 0:
    idx = html.find('experience')
print(f"\nExperience section search:")
for pattern in [r'Experience</h2>', r'"experience"', r'Experience.*?alt="([^"]+)"']:
    matches = re.findall(pattern, html[:100000])
    if matches:
        print(f"  Pattern '{pattern[:40]}...': {matches[:3]}")

# Education section
idx = html.find('Education</h2>')
if idx < 0:
    idx = html.find('education')
print(f"\nEducation section search:")
for pattern in [r'Education</h2>', r'"education"', r'Education.*?alt="([^"]+)"']:
    matches = re.findall(pattern, html[:100000])
    if matches:
        print(f"  Pattern '{pattern[:40]}...': {matches[:3]}")

# Current company
m = re.search(r'alt="([^"]+)"[^>]*class="[^"]*avatar', html)
if m:
    print(f"\nAvatar alt text: {m.group(1)}")

# Look for text with "at Company" pattern
m = re.search(r'at\s+([A-Z][a-zA-Z\s&]+)', html[30000:40000])
if m:
    print(f"Company: {m.group(1).strip()}")
