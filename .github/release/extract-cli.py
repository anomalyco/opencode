"""Extract the two regular files a platform CLI signer consumes."""

import json
import pathlib
import shutil
import sys
import tarfile

archive, destination, target, version = sys.argv[1:]
binary = "opencode.exe" if target.startswith("windows-") else "opencode"
expected = {"package/package.json", f"package/bin/{binary}"}
root = pathlib.Path(destination)
with tarfile.open(archive, "r:gz") as package:
    files = [member for member in package if not member.isdir()]
    if len(files) != 2 or {member.name for member in files} != expected:
        sys.exit("Unexpected files in CLI signing input")
    for member in files:
        if not member.isfile() or member.size > 512 * 1024 * 1024:
            sys.exit("Invalid CLI signing input")
        path = root / member.name
        path.parent.mkdir(parents=True, exist_ok=True)
        with package.extractfile(member) as source, path.open("xb") as output:
            shutil.copyfileobj(source, output)

metadata = json.loads((root / "package/package.json").read_bytes())
if metadata.get("name") != f"opencode-{target}" or metadata.get("version") != version:
    sys.exit("Unexpected package identity in CLI signing input")
