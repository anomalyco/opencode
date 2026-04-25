import json
import urllib.request

def get_comments():
    url = "https://api.github.com/repos/anomalyco/opencode/issues/24162/comments"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + open("auth.txt").read().strip()
    })
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)

if __name__ == "__main__":
    comments = get_comments()
    for c in comments:
        user = c.get("user", {}).get("login", "?")
        body = c.get("body", "")[:300]
        print(f"[{user}]: {body}\n")