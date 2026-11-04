import { BaseRenderable, TextNodeRenderable, Yoga } from "@opentui/core";
declare class SlotBaseRenderable extends BaseRenderable {
    constructor(id: string);
    add(obj: BaseRenderable | unknown, index?: number): number;
    getChildren(): BaseRenderable[];
    remove(child: BaseRenderable): void;
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
    detachFromSlot(): void;
    disposeWithoutSlotCascade(): void;
    destroy(): void;
}
export declare class LayoutSlotRenderable extends SlotBaseRenderable {
    protected yogaNode: Yoga.Node;
    protected slotParent?: SlotRenderable;
    protected destroyed: boolean;
    private yogaNodeConstructor;
    private yogaNodeFreed;
    constructor(id: string, parent?: SlotRenderable, layoutParent?: BaseRenderable);
    getLayoutNode(): Yoga.Node;
    updateFromLayout(): void;
    updateLayout(): void;
    onRemove(): void;
    isCompatibleWith(layoutParent?: BaseRenderable): boolean;
    detachFromSlot(): void;
    private freeYogaNode;
    disposeWithoutSlotCascade(): void;
    destroy(): void;
}
export declare class SlotRenderable extends SlotBaseRenderable {
    protected destroyed: boolean;
    private readonly layoutNodesByParent;
    private readonly textNodesByParent;
    private layoutNodeCount;
    private textNodeCount;
    constructor(id: string);
    get layoutNode(): LayoutSlotRenderable | undefined;
    get textNode(): TextSlotRenderable | undefined;
    private isTextSlotParent;
    private getCurrentSlotChild;
    private getTextNodeForParent;
    private getLayoutNodeForParent;
    private takeReusableTextNode;
    private takeReusableLayoutNode;
    private disposeDetachedTextNodes;
    private disposeDetachedIncompatibleLayoutNodes;
    private getAttachedSlotParent;
    private hasOtherAttachedSlotChildren;
    getSlotChild(parent: BaseRenderable): TextSlotRenderable | LayoutSlotRenderable;
    getSlotChildForRemoval(parent: BaseRenderable): BaseRenderable | undefined;
    didRemoveSlotChild(parent: BaseRenderable, child: BaseRenderable): void;
    destroy(): void;
}
export {};
