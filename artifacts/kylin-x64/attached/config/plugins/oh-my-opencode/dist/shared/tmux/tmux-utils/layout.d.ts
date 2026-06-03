import type { TmuxLayout } from "../../../config/schema";
type TmuxSpawnCommand = (args: string[], options: {
    stdout: "ignore";
    stderr: "ignore";
}) => {
    exited: Promise<number>;
};
interface LayoutDeps {
    spawnCommand?: TmuxSpawnCommand;
}
interface MainPaneWidthOptions {
    mainPaneSize?: number;
    mainPaneMinWidth?: number;
    agentPaneMinWidth?: number;
}
export declare function applyLayout(tmux: string, layout: TmuxLayout, mainPaneSize: number, deps?: LayoutDeps): Promise<void>;
export declare function enforceMainPaneWidth(mainPaneId: string, windowWidth: number, mainPaneSizeOrOptions?: number | MainPaneWidthOptions): Promise<void>;
export {};
