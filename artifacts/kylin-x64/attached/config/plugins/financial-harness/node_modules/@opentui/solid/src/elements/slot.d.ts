import { BaseRenderable, TextNodeRenderable, Yoga } from "@opentui/core";
declare class SlotBaseRenderable extends BaseRenderable {
    constructor(id: string);
    add(obj: BaseRenderable | unknown, index?: number): number;
    getChildren(): BaseRenderable[];
    remove(id: string): void;
    insertBefore(obj: BaseRenderable | unknown, anchor: BaseRenderable | unknown): void;
    getRenderable(id: string): BaseRenderable | undefined;
    getChildrenCount(): number;
    requestRender(): void;
    findDescendantById(id: string): BaseRenderable | undefined;
}
export declare class TextSlotRenderable extends TextNodeRenderable {
    protected slotParent?: SlotRenderable;
    protected destroyed: boolean;
    constructor(id: string, parent?: SlotRenderable);
    destroy(): void;
}
export declare class LayoutSlotRenderable extends SlotBaseRenderable {
    protected yogaNode: Yoga.Node;
    protected slotParent?: SlotRenderable;
    protected destroyed: boolean;
    constructor(id: string, parent?: SlotRenderable);
    getLayoutNode(): Yoga.Node;
    updateFromLayout(): void;
    updateLayout(): void;
    onRemove(): void;
    destroy(): void;
}
export declare class SlotRenderable extends SlotBaseRenderable {
    layoutNode?: LayoutSlotRenderable;
    textNode?: TextSlotRenderable;
    protected destroyed: boolean;
    constructor(id: string);
    getSlotChild(parent: BaseRenderable): TextSlotRenderable | LayoutSlotRenderable;
    destroy(): void;
}
export {};
