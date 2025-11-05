{ stdenvNoCC, fetchurl }:
stdenvNoCC.mkDerivation {
  pname = "models-dev";
  version = "unstable";

  src = fetchurl {
    url = "https://models.dev/api.json";
    hash = "sha256-Dff3OWJ7pD7LfVbZZ0Gf/QA65uw4ft14mdfBun0qDBg=";
  };

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    mkdir -p $out/dist
    cp $src $out/dist/_api.json
  '';
}
