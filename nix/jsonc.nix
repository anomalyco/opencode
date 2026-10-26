text:
let
  quoted = ''("([^"\\]|\\.)*")'';
  replace =
    pattern: other: input:
    builtins.concatStringsSep "" (
      map (
        token:
        if builtins.isString token then
          token
        else if builtins.head token != null then
          builtins.head token
        else
          other token
      ) (builtins.split pattern input)
    );

  # Comments are whitespace, not empty text: 1/* comment */2 must stay invalid.
  uncommented = replace "${quoted}|//[^\r\n]*|/\\*([^*]|\\*+[^*/])*\\*+/" (_: " ") text;
  # Quoted strings stay intact. Commas in empty containers remain invalid.
  normalized = replace ''${quoted}|([\[{][[:space:]]*,[[:space:]]*[]}])|,([[:space:]]*[]}])'' (
    token:
    if builtins.elemAt token 2 != null then
      throw "Invalid JSONC: comma in an empty container"
    else
      builtins.elemAt token 3
  ) uncommented;
in
builtins.fromJSON normalized
