import { createComponent, createElement, spread } from "@opentui/solid";
function normalizeProps(props) {
    if (!props) {
        return {};
    }
    if (!("key" in props)) {
        return props;
    }
    const { key: _key, ...rest } = props;
    return rest;
}
function createIntrinsicElement(type, props) {
    const element = createElement(type);
    spread(element, props);
    return element;
}
export function jsx(type, props = {}) {
    const normalizedProps = normalizeProps(props);
    if (typeof type === "function") {
        return createComponent(type, normalizedProps);
    }
    return createIntrinsicElement(type, normalizedProps);
}
export const jsxs = jsx;
export function jsxDEV(type, props = {}) {
    return jsx(type, props);
}
export function Fragment(props) {
    return props.children ?? null;
}
//# sourceMappingURL=jsx-runtime.js.map