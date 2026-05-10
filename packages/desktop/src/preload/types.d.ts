export type InitStep = {
    phase: "server_waiting";
} | {
    phase: "sqlite_waiting";
} | {
    phase: "done";
};
export type ServerReadyData = {
    url: string;
    username: string | null;
    password: string | null;
};
export type SqliteMigrationProgress = {
    type: "InProgress";
    value: number;
} | {
    type: "Done";
};
export type WslConfig = {
    enabled: boolean;
};
export type LinuxDisplayBackend = "wayland" | "auto";
export type TitlebarTheme = {
    mode: "light" | "dark";
};
export type WindowConfig = {
    updaterEnabled: boolean;
};
export type BrowserBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type BrowserNavigationState = {
    url: string;
    title: string;
};
export type BrowserState = {
    visible: boolean;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
    inspectMode: boolean;
};
export type BrowserAPI = {
    setBounds: (bounds: BrowserBounds) => void;
    show: () => void;
    hide: () => void;
    attach: () => void;
    navigate: (url: string) => Promise<BrowserNavigationState>;
    back: () => Promise<BrowserNavigationState>;
    forward: () => Promise<BrowserNavigationState>;
    reload: () => Promise<void>;
    clearData: () => Promise<void>;
    clearAnnotationMarkers: () => Promise<void>;
    getState: () => Promise<BrowserState>;
    screenshot: () => Promise<string | null>;
    startInspectMode: () => Promise<BrowserInspectResult | null>;
    stopInspectMode: () => Promise<void>;
    getAnnotationData: (selector: string) => Promise<BrowserAnnotationData | null>;
    toolClick: (selector: string) => Promise<void>;
    toolType: (selector: string, text: string) => Promise<void>;
    toolPress: (key: string) => Promise<void>;
    toolUploadFile: (selector: string, fileRef: string) => Promise<void>;
    toolListDownloads: () => Promise<BrowserDownload[]>;
    toolInspect: {
        (): Promise<BrowserSnapshot>;
        (selector: string): Promise<BrowserAnnotationData | null>;
    };
    toolGetSnapshot: () => Promise<BrowserSnapshot>;
};
export type ElectronAPI = {
    killSidecar: () => Promise<void>;
    installCli: () => Promise<string>;
    awaitInitialization: (onStep: (step: InitStep) => void) => Promise<ServerReadyData>;
    getWindowConfig: () => Promise<WindowConfig>;
    consumeInitialDeepLinks: () => Promise<string[]>;
    getDefaultServerUrl: () => Promise<string | null>;
    setDefaultServerUrl: (url: string | null) => Promise<void>;
    getWslConfig: () => Promise<WslConfig>;
    setWslConfig: (config: WslConfig) => Promise<void>;
    getDisplayBackend: () => Promise<LinuxDisplayBackend | null>;
    setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>;
    parseMarkdownCommand: (markdown: string) => Promise<string>;
    checkAppExists: (appName: string) => Promise<boolean>;
    wslPath: (path: string, mode: "windows" | "linux" | null) => Promise<string>;
    resolveAppPath: (appName: string) => Promise<string | null>;
    storeGet: (name: string, key: string) => Promise<string | null>;
    storeSet: (name: string, key: string, value: string) => Promise<void>;
    storeDelete: (name: string, key: string) => Promise<void>;
    storeClear: (name: string) => Promise<void>;
    storeKeys: (name: string) => Promise<string[]>;
    storeLength: (name: string) => Promise<number>;
    getWindowCount: () => Promise<number>;
    onSqliteMigrationProgress: (cb: (progress: SqliteMigrationProgress) => void) => () => void;
    onMenuCommand: (cb: (id: string) => void) => () => void;
    onDeepLink: (cb: (urls: string[]) => void) => () => void;
    openDirectoryPicker: (opts?: {
        multiple?: boolean;
        title?: string;
        defaultPath?: string;
    }) => Promise<string | string[] | null>;
    openFilePicker: (opts?: {
        multiple?: boolean;
        title?: string;
        defaultPath?: string;
        accept?: string[];
        extensions?: string[];
    }) => Promise<string | string[] | null>;
    saveFilePicker: (opts?: {
        title?: string;
        defaultPath?: string;
    }) => Promise<string | null>;
    openLink: (url: string) => void;
    openPath: (path: string, app?: string) => Promise<void>;
    readClipboardImage: () => Promise<{
        buffer: ArrayBuffer;
        width: number;
        height: number;
    } | null>;
    showNotification: (title: string, body?: string) => void;
    getWindowFocused: () => Promise<boolean>;
    setWindowFocus: () => Promise<void>;
    showWindow: () => Promise<void>;
    relaunch: () => void;
    getZoomFactor: () => Promise<number>;
    setZoomFactor: (factor: number) => Promise<void>;
    setTitlebar: (theme: TitlebarTheme) => Promise<void>;
    loadingWindowComplete: () => void;
    runUpdater: (alertOnFail: boolean) => Promise<void>;
    checkUpdate: () => Promise<{
        updateAvailable: boolean;
        version?: string;
    }>;
    installUpdate: () => Promise<void>;
    setBackgroundColor: (color: string) => Promise<void>;
    browser: BrowserAPI;
};
import type { BrowserAnnotationData, BrowserDownload, BrowserInspectResult, BrowserSnapshot } from "../main/browser/types";
