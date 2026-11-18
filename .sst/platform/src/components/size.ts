export type Size = `${number} ${"MB" | "GB"}`;
export type SizeGbTb = `${number} ${"GB" | "TB"}`;

export function toMBs(size: Size | SizeGbTb) {
  const [count, unit] = size.split(" ");
  const countNum = parseFloat(count);
  if (unit === "MB") {
    return countNum;
  } else if (unit === "GB") {
    return countNum * 1024;
  } else if (unit === "TB") {
    return countNum * 1024 * 1024;
  }
  throw new Error(`Invalid size ${size}`);
}

export function toGBs(size: Size | SizeGbTb) {
  const [count, unit] = size.split(" ");
  const countNum = parseFloat(count);
  if (unit === "MB") {
    return countNum / 1024;
  } else if (unit === "GB") {
    return countNum;
  } else if (unit === "TB") {
    return countNum * 1024;
  }
  throw new Error(`Invalid size ${size}`);
}
