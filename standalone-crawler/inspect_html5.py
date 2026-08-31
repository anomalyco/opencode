import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

# Find About section - look for the section header and content
# LinkedIn uses componentkey for sections
about_idx = html.find('componentkey="com.linkedin.sdui.profile.card.refACoAAEeRKMgBDeYZZGLAf9S6yKCzRBuLQdPwxiQAbout"')
if about_idx >= 0:
    snippet = html[about_idx:about_idx+2000].replace('\n', ' ')
    print(f"About section (componentkey):\n{snippet[:500]}")
    print()

# Look for expandable text box (About content)
m = re.search(r'data-testid="expandable-text-box">(.*?)</span>', html, re.DOTALL)
if m:
    about_text = re.sub(r'<[^>]+>', '', m.group(1)).strip()
    print(f"About content (expandable-text-box):\n{about_text[:500]}")
    print()

# Location from aria-label or specific div
m = re.search(r'Chennai, Tamil Nadu, India', html)
if m:
    # Get surrounding context
    idx = m.start()
    snippet = html[max(0, idx-200):idx+100].replace('\n', ' ')
    print(f"Location context:\n{snippet[:400]}")
    print()

# Education - look for school/university names
for pattern in [
    r'Education.*?alt="([^"]+)"',
    r'"school"[^}]*"text"\s*:\s*"([^"]+)"',
    r'>([A-Z][a-zA-Z\s]+(?:University|College|Institute|School))<',
]:
    matches = re.findall(pattern, html, re.DOTALL)
    if matches:
        unique = list(dict.fromkeys(matches))[:3]
        print(f"Education pattern '{pattern[:50]}': {unique}")

# Experience - look for company names
for pattern in [
    r'Experience.*?alt="([^"]+)"',
    r'"company"[^}]*"text"\s*:\s*"([^"]+)"',
    r'at\s+([A-Z][a-zA-Z\s&]+)',
]:
    matches = re.findall(pattern, html[:200000])
    if matches:
        unique = list(dict.fromkeys(matches))[:5]
        print(f"Experience pattern '{pattern[:50]}': {unique}")
