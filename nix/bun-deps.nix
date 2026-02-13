# Bun dependencies fetched using bun2nix
#
# This derivation creates a Bun-compatible cache from the bun.nix lockfile
# that can be used for offline installs during the build.
{
  bun2nix',
  stdenv,
}:
bun2nix'.fetchBunDeps {
  bunNix = ./bun.nix;

  # Use hoisted linker for compatibility with tools that expect node_modules structure
  # On Darwin, use copyfile backend since clonefile doesn't work with nix store permissions
  bunInstallFlags =
    if stdenv.hostPlatform.isDarwin then
      [
        "--linker=hoisted"
        "--backend=copyfile"
      ]
    else
      [ "--linker=hoisted" ];
}
