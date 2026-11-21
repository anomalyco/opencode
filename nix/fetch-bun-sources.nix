fetchurl: sources:
builtins.mapAttrs (
  _: source:
  let
    archive = fetchurl source;
  in
  archive
  // {
    # Archive hosts do not define Bun's configured registry namespace.
    passthru = builtins.removeAttrs (archive.passthru or { }) [ "url" ];
  }
) sources
