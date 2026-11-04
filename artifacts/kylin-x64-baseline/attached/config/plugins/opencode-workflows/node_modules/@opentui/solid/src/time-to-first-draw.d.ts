import { TimeToFirstDrawRenderable } from "@opentui/core";
import type { ExtendedComponentProps } from "./types/elements.js";
declare module "@opentui/solid" {
    interface OpenTUIComponents {
        time_to_first_draw: typeof TimeToFirstDrawRenderable;
    }
}
export type TimeToFirstDrawProps = ExtendedComponentProps<typeof TimeToFirstDrawRenderable>;
export declare const TimeToFirstDraw: (props: TimeToFirstDrawProps) => any;
