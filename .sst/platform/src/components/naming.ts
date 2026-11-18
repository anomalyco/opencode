import crypto from "crypto";

export function logicalName(name: string) {
  name = name.replace(/[^a-zA-Z0-9]/g, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function physicalName(max: number, name: string, suffix: string = "") {
  // This function does the following:
  // - Removes all non-alphanumeric characters
  // - Prefixes the name with the app name and stage
  // - Truncates the name if it's too long
  // - Adds a random suffix
  // - Adds a suffix if provided
  const main = prefixName(max - 9 - suffix.length, name);
  const random = hashStringToPrettyString(
    crypto.randomBytes(8).toString("hex"),
    8,
  );
  return `${main}-${random}${suffix}`;
}

export function prefixName(max: number, name: string) {
  // This function does the following:
  // - Removes all non-alphanumeric characters
  // - Prefixes the name with the app name and stage
  // - Truncates the name if it's too long
  // ie. foo => app-stage-foo

  name = name.replace(/[^a-zA-Z0-9]/g, "");

  const stageLen = $app.stage.length;
  const nameLen = name.length;
  const strategy =
    nameLen + 1 >= max
      ? ("name" as const)
      : nameLen + stageLen + 2 >= max
        ? ("stage+name" as const)
        : ("app+stage+name" as const);

  if (strategy === "name") return `${name.substring(0, max)}`;
  if (strategy === "stage+name")
    return `${$app.stage.substring(0, max - nameLen - 1)}-${name}`;
  return `${$app.name.substring(0, max - stageLen - nameLen - 2)}-${
    $app.stage
  }-${name}`;
}

export function hashNumberToPrettyString(number: number, length: number) {
  const charLength = PRETTY_CHARS.length;
  let hash = "";
  while (number > 0) {
    hash = PRETTY_CHARS[number % charLength] + hash;
    number = Math.floor(number / charLength);
  }

  // Padding with 's'
  hash = hash.slice(0, length);
  while (hash.length < length) {
    hash = "s" + hash;
  }

  return hash;
}

export function hashStringToPrettyString(str: string, length: number) {
  const hash = crypto.createHash("sha256");
  hash.update(str);
  const num = Number("0x" + hash.digest("hex").substring(0, 16));
  return hashNumberToPrettyString(num, length);
}

export const PRETTY_CHARS = "abcdefhkmnorstuvwxz";
