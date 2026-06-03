import type { DoctorOptions } from "./types";
export declare function doctor(options?: DoctorOptions): Promise<number>;
export * from "./types";
export { runDoctor } from "./runner";
export { formatDoctorOutput, formatJsonOutput } from "./formatter";
