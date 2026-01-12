{
  hash,
  lib,
  stdenvNoCC,
  bun,
  cacert,
  curl,
}:
args:
let
  inherit (stdenvNoCC.hostPlatform) system;

  # Map Nix systems to Bun --cpu values
  cpuMap = {
    "aarch64-linux" = "arm64";
    "x86_64-linux" = "x64";
    "aarch64-darwin" = "arm64";
    "x86_64-darwin" = "x64";
    "i686-linux" = "ia32";
    "armv7l-linux" = "arm";
  };

  # Map Nix systems to Bun --os values
  osMap = {
    "aarch64-linux" = "linux";
    "x86_64-linux" = "linux";
    "aarch64-darwin" = "darwin";
    "x86_64-darwin" = "darwin";
    "i686-linux" = "linux";
    "armv7l-linux" = "linux";
  };

  # Fallback to "*" for unknown systems
  targetCpu = cpuMap.${system} or "*";
  targetOs = osMap.${system} or "*";
in
stdenvNoCC.mkDerivation {
  pname = "opencode-node_modules";
  inherit (args) version src;

  impureEnvVars = lib.fetchers.proxyImpureEnvVars ++ [
    "GIT_PROXY_COMMAND"
    "SOCKS_SERVER"
  ];

  nativeBuildInputs = [
    bun
    cacert
    curl
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME=$(mktemp -d)
    export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
    bun install \
      --cpu="${targetCpu}" \
      --os="${targetOs}" \
      --frozen-lockfile \
      --ignore-scripts \
      --no-progress \
      --linker=isolated
    bun --bun ${args.canonicalizeScript}
    bun --bun ${args.normalizeBinsScript}
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    while IFS= read -r dir; do
      rel="''${dir#./}"
      dest="$out/$rel"
      mkdir -p "$(dirname "$dest")"
      cp -R "$dir" "$dest"
    done < <(find . -type d -name node_modules -prune | sort)
    runHook postInstall
  '';

  dontFixup = true;

  outputHashAlgo = "sha256";
  outputHashMode = "recursive";
  outputHash = hash;
}
