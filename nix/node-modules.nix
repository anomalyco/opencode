{
  hash,
  lib,
  stdenvNoCC,
  bun,
  cacert,
  curl,
  bunCpu,
  bunOs,
}:
args:
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
      --cpu="${bunCpu}" \
      --os="${bunOs}" \
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
