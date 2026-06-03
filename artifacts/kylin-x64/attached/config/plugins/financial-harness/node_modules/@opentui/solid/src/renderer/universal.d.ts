export function createRenderer({ createElement, createTextNode, createSlotNode, isTextNode, replaceText, insertNode, removeNode, setProperty, getParentNode, getFirstChild, getNextSibling, }: {
    createElement: any;
    createTextNode: any;
    createSlotNode: any;
    isTextNode: any;
    replaceText: any;
    insertNode: any;
    removeNode: any;
    setProperty: any;
    getParentNode: any;
    getFirstChild: any;
    getNextSibling: any;
}): {
    render(code: any, element: any): undefined;
    insert: (parent: any, accessor: any, marker: any, initial: any) => any;
    spread(node: any, accessor: any, skipChildren: any): void;
    createElement: any;
    createTextNode: any;
    insertNode: any;
    setProp(node: any, name: any, value: any, prev: any): any;
    mergeProps: typeof mergeProps;
    effect: typeof createRenderEffect;
    memo: (fn: any) => import("solid-js").Accessor<any>;
    createComponent: typeof createComponent;
    use(fn: any, element: any, arg: any): any;
};
import { mergeProps } from "solid-js";
import { createRenderEffect } from "solid-js";
import { createComponent } from "solid-js";
