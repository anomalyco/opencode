export type Cpu = `${number} ${"vCPU"}`;

export function toNumber(cpu: Cpu) {
  const [count, unit] = cpu.split(" ");
  const countNum = parseFloat(count);
  if (unit === "vCPU") {
    return countNum * 1024;
  }
  throw new Error(`Invalid CPU ${cpu}`);
}
