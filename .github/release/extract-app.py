"""Unpack one macOS application into an empty staging directory before signing."""

import pathlib
import sys
import tarfile

archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
if any(root.iterdir()):
    sys.exit("App staging directory must be empty")

with tarfile.open(archive, "r:") as package:
    for entry in package:
        path = pathlib.PurePosixPath(entry.name)
        if not path.parts or path.parts[0] != "OpenCode.app" or ".." in path.parts:
            sys.exit("Unexpected path in desktop signing input")
        if not (entry.isfile() or entry.isdir() or entry.issym()):
            sys.exit("Unexpected member type in desktop signing input")
        # Electron frameworks use relative symlinks. The data filter also
        # checks their resolved destination against the extraction root.
        package.extract(entry, root, filter="data")
