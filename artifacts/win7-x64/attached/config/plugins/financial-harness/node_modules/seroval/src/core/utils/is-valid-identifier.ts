const IDENTIFIER_CHECK = /^[$A-Z_][0-9A-Z_$]*$/i;

export function isValidIdentifier(name: string): boolean {
  const char = name[0];
  return (
    (char === '$' ||
      char === '_' ||
      (char >= 'A' && char <= 'Z') ||
      (char >= 'a' && char <= 'z')) &&
    IDENTIFIER_CHECK.test(name)
  );
}
