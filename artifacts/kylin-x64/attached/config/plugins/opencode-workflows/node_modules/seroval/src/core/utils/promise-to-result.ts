export default async function promiseToResult(
  current: Promise<unknown>,
): Promise<[0 | 1, unknown]> {
  try {
    return [1, await current];
  } catch (e) {
    return [0, e];
  }
}
