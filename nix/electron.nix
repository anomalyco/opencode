{ callPackage, path }:
let
  version = (builtins.fromJSON (builtins.readFile ../packages/desktop/package.json)).devDependencies.electron;
in
(callPackage (path + "/pkgs/development/tools/electron/binary/generic.nix") { }) version {
  # Electron 42.10.1 SHASUMS256.txt; update with the desktop package version.
  aarch64-linux = "20e68d6c4e47f3ebf59de7c6b1f8b8bec6a6ebda6a451132f9b465f3f13ce467";
  x86_64-linux = "2452b27112d92387471fa2488aafac85d79ea3f2ee1216c0abd5150d6c12362b";
  aarch64-darwin = "ac7194a3dfd81930ba35355c01620262c1254752859b42dcb8f4b9e4d174a871";
  x86_64-darwin = "4489aba55477a0082266cb690db1c829503ba3338048599d8fd243953df37dab";
  # fetchzip hashes the unpacked headers, not the release tarball.
  headers = "sha256-4eUy3BZVvxTl7KUOsxio7769lL6ag/ecbeK+qLURWMI=";
}
