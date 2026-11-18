const alreadyWarned = new Set<string>();

export function warnOnce(message: string) {
  if (alreadyWarned.has(message)) return;
  alreadyWarned.add(message);
  console.warn(message);
}
