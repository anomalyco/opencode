import type { TmuxPaneInfo } from "./types";
type ParsedPaneState = {
    windowWidth: number;
    windowHeight: number;
    panes: TmuxPaneInfo[];
};
export declare function parsePaneStateOutput(stdout: string): ParsedPaneState | null;
export {};
