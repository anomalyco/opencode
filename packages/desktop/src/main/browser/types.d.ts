export type BrowserBoundingBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type BrowserSnapshotElement = {
    selector: string;
    tagName: string;
    role?: string;
    accessibleName?: string;
    visibleText?: string;
    attributes: Record<string, string>;
    boundingBox: BrowserBoundingBox;
};
export type BrowserSnapshot = {
    url: string;
    title: string;
    elements: BrowserSnapshotElement[];
};
export type BrowserAnnotationData = BrowserSnapshotElement & {
    xpath?: string;
    nearbyDomSanitized: string;
};
export type BrowserInspectResult = {
    annotation: BrowserAnnotationData;
    pageUrl: string;
    pageTitle: string;
    userComment: string;
};
export type BrowserAnnotation = {
    id: string;
    pageUrl: string;
    pageTitle: string;
    userComment: string;
    element: {
        tagName: string;
        role?: string;
        accessibleName?: string;
        visibleText?: string;
        attributes: Record<string, string>;
        selector: string;
        xpath?: string;
        boundingBox: BrowserBoundingBox;
    };
    preview: {
        screenshotCrop?: string;
        viewportScreenshotId?: string;
    };
    context: {
        nearbyDomSanitized?: string;
        accessibilitySnapshotNearby?: unknown;
    };
    createdAt: number;
};
export type BrowserScreenshot = {
    id: string;
    pageUrl: string;
    pageTitle: string;
    imageData: string;
    viewport: {
        width: number;
        height: number;
        deviceScaleFactor: number;
    };
    createdAt: number;
};
export type BrowserPanelState = {
    visible: boolean;
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
    inspectMode: boolean;
};
export type AgentToolPayload = {
    tool: "browser.open";
} | {
    tool: "browser.navigate";
    url: string;
} | {
    tool: "browser.back";
} | {
    tool: "browser.forward";
} | {
    tool: "browser.reload";
} | {
    tool: "browser.click";
    selector: string;
} | {
    tool: "browser.type";
    selector: string;
    text: string;
} | {
    tool: "browser.press";
    key: string;
} | {
    tool: "browser.screenshot";
} | {
    tool: "browser.inspect";
    selector?: string;
} | {
    tool: "browser.get_snapshot";
} | {
    tool: "browser.annotation.get_detail";
    id: string;
} | {
    tool: "browser.clear_data";
} | {
    tool: "browser.upload_file";
    selector: string;
    fileRef: string;
} | {
    tool: "browser.downloads.list";
};
