import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open(r"C:\projects\crawler\linkedin_raw.html", "r", encoding="utf-8") as f:
    html = f.read()

print(f"HTML length: {len(html)} chars\n")

# === NAME ===
m = re.search(r'<title[^>]*>([^|]+)\s*\|', html)
if m:
    print(f"NAME: {m.group(1).strip()}")

# === HEADLINE ===
m = re.search(r'Sashriya M</p>.*?<span[^>]*>([^<]+)</span>', html, re.DOTALL)
if m:
    print(f"HEADLINE: {m.group(1).strip()}")

# === LOCATION ===
m = re.search(r'Chennai, Tamil Nadu, India', html)
if m:
    print(f"LOCATION: Chennai, Tamil Nadu, India")
else:
    # Try other location patterns
    m = re.search(r'([A-Z][a-z]+,\s*[A-Z][a-z]+,\s*India)', html)
    if m:
        print(f"LOCATION: {m.group(1)}")

# === ABOUT ===
m = re.search(r'About</h2>.*?<span[^>]*>(.*?)</span>', html, re.DOTALL)
if m:
    about_text = m.group(1).strip()
    about_text = re.sub(r'<[^>]+>', '', about_text)
    print(f"ABOUT: {about_text[:300]}")

# === CURRENT COMPANY ===
# Look for the first alt="Company" pattern that's an avatar
company_patterns = [
    r'alt="(Zenteiq[^"]*)"',
    r'alt="([A-Z][a-zA-Z\s&]+)"[^>]*class="[^"]*avatar',
]
for p in company_patterns:
    m = re.search(p, html)
    if m:
        print(f"COMPANY: {m.group(1).strip()}")
        break

# === EDUCATION ===
# Look for university/school names
edu_patterns = [
    r'([A-Z][a-zA-Z\s]+University)',
    r'([A-Z][a-zA-Z\s]+College)',
    r'([A-Z][a-zA-Z\s]+Institute)',
    r'([A-Z][a-zA-Z\s]+School)',
]
for p in edu_patterns:
    m = re.search(p, html)
    if m:
        print(f"EDUCATION: {m.group(1).strip()}")
        break

# === EXPERIENCE ===
# Look for job titles
exp_patterns = [
    r'(?:Intern|Software Engineer|Developer|Manager|Director|Lead|Analyst)[^<]{0,50}',
    r'at\s+([A-Z][a-zA-Z\s&]+)',
]
for p in exp_patterns:
    matches = re.findall(p, html[30000:80000])
    if matches:
        # Deduplicate and take first few
        unique = list(dict.fromkeys(matches))[:3]
        print(f"EXPERIENCE: {unique}")
        break

# === CONNECTIONS ===
m = re.search(r'(\d+)\+?\s*connections?', html, re.IGNORECASE)
if m:
    print(f"CONNECTIONS: {m.group(1)}")

# === PROFILE PHOTO ===
m = re.search(r'profile-framedphoto-shrink_[^"]+', html)
if m:
    print(f"PROFILE_PHOTO: {m.group(0)[:200]}")

# === BACKGROUND IMAGE ===
m = re.search(r'profile-displaybackgroundimage-shrink_[^"]+', html)
if m:
    print(f"BACKGROUND_IMAGE: {m.group(0)[:200]}")
