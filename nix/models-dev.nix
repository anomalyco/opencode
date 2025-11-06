{ hash, stdenvNoCC, fetchurl }:
stdenvNoCC.mkDerivation {
  pname = "models-dev";
  version = "unstable";

  src = fetchurl {
    url = "https://models.dev/api.json";
    hash = hash;
  };

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    mkdir -p $out/dist
    cp $src $out/dist/_api.json
  '';
}
