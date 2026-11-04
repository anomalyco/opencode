import type { CliRenderer } from "../renderer.js";
import type { TerminalCapabilities, TerminalInfo } from "../types.js";
export interface TerminalCapabilitiesOverrides extends Partial<Omit<TerminalCapabilities, "terminal">> {
    terminal?: Partial<TerminalInfo>;
}
export declare function createTerminalCapabilities(overrides?: TerminalCapabilitiesOverrides): TerminalCapabilities;
export declare function setRendererCapabilities(renderer: CliRenderer, overrides?: TerminalCapabilitiesOverrides): TerminalCapabilities;
