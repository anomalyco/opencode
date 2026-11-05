import { type FFICallbackInstance, type Pointer } from "./platform/ffi.js";
import { type CursorStyle, type CursorStyleOptions, type TargetChannel, type DebugOverlayCorner, type WidthMethod, type TerminalCapabilities, type Highlight, type LineInfo } from "./types.js";
export type { LineInfo, AllocatorStats, AudioStreamCreateOptions, BuildOptions, NativeAudioStreamStats, NativeRenderStats, };
import { RGBA } from "./lib/RGBA.js";
import { OptimizedBuffer } from "./buffer.js";
import { TextBuffer } from "./text-buffer.js";
import type { NativeSpanFeedOptions, NativeSpanFeedStats, ReserveInfo, AudioCreateOptions, AudioStartOptions, AudioVoiceOptions, AudioStreamCreateOptions, NativeAudioStreamCloseReason as NativeAudioStreamCloseReasonType, NativeAudioStreamFormat as NativeAudioStreamFormatType, NativeAudioStreamState as NativeAudioStreamStateType, NativeAudioStreamStats, AudioStats, BuildOptions, AllocatorStats, NativeRenderStats } from "./zig-structs.js";
export declare const NativeAudioStreamState: {
    readonly Initializing: 0;
    readonly Buffering: 1;
    readonly Playing: 2;
    readonly Ended: 3;
    readonly Failed: 4;
    readonly Cancelled: 5;
    readonly Reconnecting: 6;
};
export type NativeAudioStreamState = NativeAudioStreamStateType;
export declare const NativeAudioStreamCloseReason: {
    readonly PreserveNativeTerminal: 0;
    readonly TransportError: 1;
    readonly Disposed: 2;
};
export type NativeAudioStreamCloseReason = NativeAudioStreamCloseReasonType;
export declare const NativeAudioStreamFormat: {
    readonly Mp3: 1;
    readonly Flac: 2;
};
export type NativeAudioStreamFormat = NativeAudioStreamFormatType;
export type NativeHandle<T extends string> = Pointer & {
    readonly __nativeHandle: T;
};
export type RendererHandle = NativeHandle<"renderer">;
export type OptimizedBufferHandle = NativeHandle<"optimized_buffer">;
export type TextBufferHandle = NativeHandle<"text_buffer">;
export type TextBufferViewHandle = NativeHandle<"text_buffer_view">;
export type EditBufferHandle = NativeHandle<"edit_buffer">;
export type EditorViewHandle = NativeHandle<"editor_view">;
export type SyntaxStyleHandle = NativeHandle<"syntax_style">;
export type EventSinkHandle = NativeHandle<"event_sink">;
export type AudioEngineHandle = NativeHandle<"audio_engine">;
export type NativeRenderableHandle = NativeHandle<"native_renderable">;
export declare enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3
}
/**
 * VisualCursor represents a cursor position with both visual and logical coordinates.
 * Visual coordinates (visualRow, visualCol) are VIEWPORT-RELATIVE.
 * This means visualRow=0 is the first visible line in the viewport, not the first line in the document.
 * Logical coordinates (logicalRow, logicalCol) are document-absolute.
 */
export interface VisualCursor {
    visualRow: number;
    visualCol: number;
    logicalRow: number;
    logicalCol: number;
    offset: number;
}
export interface LogicalCursor {
    row: number;
    col: number;
    offset: number;
}
export interface CursorState {
    x: number;
    y: number;
    visible: boolean;
    style: CursorStyle;
    blinking: boolean;
    color: RGBA;
}
export type NativeSpanFeedEventHandler = (eventId: number, arg0: Pointer, arg1: number | bigint) => void;
export type NativeBufferedOutput = "stdout" | "memory";
export interface NativeRendererCreateOptions {
    remote?: boolean;
    feedPtr?: Pointer | null;
    bufferedOutput?: NativeBufferedOutput;
}
export interface NativeRenderOperationResult {
    renderOffset: number;
    status: number;
}
export interface NativeYogaLayout {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}
export type NativeYogaMeasureCallback = (node: Pointer | null, width: number, widthMode: number, height: number, heightMode: number) => void;
export type NativeYogaDirtiedCallback = (node: Pointer | null) => void;
export declare const NativeMeasureTargetKind: {
    readonly None: 0;
    readonly TextBufferView: 1;
    readonly EditorView: 2;
};
export type NativeMeasureTargetKind = (typeof NativeMeasureTargetKind)[keyof typeof NativeMeasureTargetKind];
export type NativeMeasureTargetHandle = TextBufferViewHandle | EditorViewHandle;
export interface AudioEngineLib {
    createAudioEngine: (options?: AudioCreateOptions | null) => AudioEngineHandle | null;
    destroyAudioEngine: (engine: AudioEngineHandle) => void;
    audioRefreshPlaybackDevices: (engine: AudioEngineHandle) => number;
    audioGetPlaybackDeviceCount: (engine: AudioEngineHandle) => number;
    audioGetPlaybackDeviceName: (engine: AudioEngineHandle, index: number) => string;
    audioIsPlaybackDeviceDefault: (engine: AudioEngineHandle, index: number) => boolean;
    audioSelectPlaybackDevice: (engine: AudioEngineHandle, index: number) => number;
    audioClearPlaybackDeviceSelection: (engine: AudioEngineHandle) => void;
    audioStart: (engine: AudioEngineHandle, options?: AudioStartOptions | null) => number;
    audioStartMixer: (engine: AudioEngineHandle) => number;
    audioStop: (engine: AudioEngineHandle) => number;
    audioCreateStream: (engine: AudioEngineHandle, options: AudioStreamCreateOptions) => {
        status: number;
        streamId: number | null;
    };
    audioWriteStream: (engine: AudioEngineHandle, streamId: number, data: Uint8Array) => number;
    audioEndStream: (engine: AudioEngineHandle, streamId: number) => number;
    audioRestartStream: (engine: AudioEngineHandle, streamId: number) => number;
    audioSetStreamVolume: (engine: AudioEngineHandle, streamId: number, volume: number) => number;
    audioSetStreamPan: (engine: AudioEngineHandle, streamId: number, pan: number) => number;
    audioSetStreamGroup: (engine: AudioEngineHandle, streamId: number, groupId: number) => number;
    audioGetStreamStats: (engine: AudioEngineHandle, streamId: number) => NativeAudioStreamStats | null;
    audioCloseStream: (engine: AudioEngineHandle, streamId: number, reason: NativeAudioStreamCloseReason) => {
        status: number;
        stats: NativeAudioStreamStats | null;
    };
    audioLoad: (engine: AudioEngineHandle, data: Uint8Array) => {
        status: number;
        soundId: number | null;
    };
    audioUnload: (engine: AudioEngineHandle, soundId: number) => number;
    audioPlay: (engine: AudioEngineHandle, soundId: number, options?: AudioVoiceOptions) => {
        status: number;
        voiceId: number | null;
    };
    audioStopVoice: (engine: AudioEngineHandle, voiceId: number) => number;
    audioSetVoiceGroup: (engine: AudioEngineHandle, voiceId: number, groupId: number) => number;
    audioCreateGroup: (engine: AudioEngineHandle, name: string) => {
        status: number;
        groupId: number | null;
    };
    audioSetGroupVolume: (engine: AudioEngineHandle, groupId: number, volume: number) => number;
    audioSetMasterVolume: (engine: AudioEngineHandle, volume: number) => number;
    audioMixToBuffer: (engine: AudioEngineHandle, outBuffer: Float32Array, frameCount: number, channels: number) => number;
    audioEnableTap: (engine: AudioEngineHandle, enabled: boolean, capacityFrames: number) => number;
    audioReadTap: (engine: AudioEngineHandle, outBuffer: Float32Array, frameCount: number, channels: number) => {
        status: number;
        framesRead: number;
    };
    audioGetStats: (engine: AudioEngineHandle) => AudioStats | null;
}
export interface RenderLib extends AudioEngineLib {
    createRenderer: (width: number, height: number, options?: NativeRendererCreateOptions) => RendererHandle | null;
    setTerminalEnvVar: (renderer: RendererHandle, key: string, value: string) => boolean;
    destroyRenderer: (renderer: RendererHandle) => void;
    setUseThread: (renderer: RendererHandle, useThread: boolean) => void;
    setClearOnShutdown: (renderer: RendererHandle, clear: boolean) => void;
    setBackgroundColor: (renderer: RendererHandle, color: RGBA) => void;
    setRenderOffset: (renderer: RendererHandle, offset: number) => void;
    resetSplitScrollback: (renderer: RendererHandle, seedRows: number, pinnedRenderOffset: number) => number;
    syncSplitScrollback: (renderer: RendererHandle, pinnedRenderOffset: number) => number;
    getSplitOutputOffset: (renderer: RendererHandle, surfaceOffset: number) => number;
    setPendingSplitFooterTransition: (renderer: RendererHandle, mode: number, sourceTopLine: number, sourceHeight: number, targetTopLine: number, targetHeight: number, scrollLines: number) => void;
    clearPendingSplitFooterTransition: (renderer: RendererHandle) => void;
    updateStats: (renderer: RendererHandle, time: number, fps: number, frameCallbackTime: number) => void;
    updateMemoryStats: (renderer: RendererHandle, heapUsed: number, heapTotal: number, arrayBuffers: number) => void;
    getRenderStats: (renderer: RendererHandle) => NativeRenderStats;
    render: (renderer: RendererHandle, force: boolean) => number;
    repaintSplitFooter: (renderer: RendererHandle, pinnedRenderOffset: number, force: boolean) => NativeRenderOperationResult;
    commitSplitFooterSnapshot: (renderer: RendererHandle, snapshot: OptimizedBuffer, rowColumns: number, startOnNewLine: boolean, trailingNewline: boolean, pinnedRenderOffset: number, force: boolean, beginFrame?: boolean, finalizeFrame?: boolean) => NativeRenderOperationResult;
    getNextBuffer: (renderer: RendererHandle) => OptimizedBuffer;
    getCurrentBuffer: (renderer: RendererHandle) => OptimizedBuffer;
    rendererSetPaletteState: (renderer: RendererHandle, palette: readonly RGBA[], defaultForeground: RGBA, defaultBackground: RGBA, paletteEpoch: number) => void;
    createOptimizedBuffer: (width: number, height: number, widthMethod: WidthMethod, respectAlpha?: boolean, id?: string) => OptimizedBuffer;
    destroyOptimizedBuffer: (bufferPtr: OptimizedBufferHandle) => void;
    drawFrameBuffer: (targetBufferPtr: OptimizedBufferHandle, destX: number, destY: number, bufferPtr: OptimizedBufferHandle, sourceX?: number, sourceY?: number, sourceWidth?: number, sourceHeight?: number) => void;
    getBufferWidth: (buffer: OptimizedBufferHandle) => number;
    getBufferHeight: (buffer: OptimizedBufferHandle) => number;
    bufferClear: (buffer: OptimizedBufferHandle, color: RGBA) => void;
    bufferGetCharPtr: (buffer: OptimizedBufferHandle) => Pointer;
    bufferGetFgPtr: (buffer: OptimizedBufferHandle) => Pointer;
    bufferGetBgPtr: (buffer: OptimizedBufferHandle) => Pointer;
    bufferGetAttributesPtr: (buffer: OptimizedBufferHandle) => Pointer;
    bufferGetRespectAlpha: (buffer: OptimizedBufferHandle) => boolean;
    bufferSetRespectAlpha: (buffer: OptimizedBufferHandle, respectAlpha: boolean) => void;
    bufferGetId: (buffer: OptimizedBufferHandle) => string;
    bufferGetRealCharSize: (buffer: OptimizedBufferHandle) => number;
    bufferWriteResolvedChars: (buffer: OptimizedBufferHandle, outputBuffer: Uint8Array, addLineBreaks: boolean) => number;
    bufferDrawText: (buffer: OptimizedBufferHandle, text: string, x: number, y: number, color: RGBA, bgColor?: RGBA, attributes?: number) => void;
    bufferSetCellWithAlphaBlending: (buffer: OptimizedBufferHandle, x: number, y: number, char: string, color: RGBA, bgColor: RGBA, attributes?: number) => void;
    bufferSetCell: (buffer: OptimizedBufferHandle, x: number, y: number, char: string, color: RGBA, bgColor: RGBA, attributes?: number) => void;
    bufferFillRect: (buffer: OptimizedBufferHandle, x: number, y: number, width: number, height: number, color: RGBA) => void;
    bufferColorMatrix: (buffer: OptimizedBufferHandle, matrixPtr: Pointer, cellMaskPtr: Pointer, cellMaskCount: number, strength: number, target: TargetChannel) => void;
    bufferColorMatrixUniform: (buffer: OptimizedBufferHandle, matrixPtr: Pointer, strength: number, target: TargetChannel) => void;
    bufferDrawSuperSampleBuffer: (buffer: OptimizedBufferHandle, x: number, y: number, pixelDataPtr: Pointer, pixelDataLength: number, format: "bgra8unorm" | "rgba8unorm", alignedBytesPerRow: number) => void;
    bufferDrawPackedBuffer: (buffer: OptimizedBufferHandle, dataPtr: Pointer, dataLen: number, posX: number, posY: number, terminalWidthCells: number, terminalHeightCells: number) => void;
    bufferDrawGrayscaleBuffer: (buffer: OptimizedBufferHandle, posX: number, posY: number, intensitiesPtr: Pointer, srcWidth: number, srcHeight: number, fg: RGBA | null, bg: RGBA | null) => void;
    bufferDrawGrayscaleBufferSupersampled: (buffer: OptimizedBufferHandle, posX: number, posY: number, intensitiesPtr: Pointer, srcWidth: number, srcHeight: number, fg: RGBA | null, bg: RGBA | null) => void;
    bufferDrawGrid: (buffer: OptimizedBufferHandle, borderChars: Uint32Array, borderFg: RGBA, borderBg: RGBA, columnOffsets: Int32Array, columnCount: number, rowOffsets: Int32Array, rowCount: number, options: {
        drawInner: boolean;
        drawOuter: boolean;
    }) => void;
    bufferDrawBox: (buffer: OptimizedBufferHandle, x: number, y: number, width: number, height: number, borderChars: Uint32Array, packedOptions: number, borderColor: RGBA, backgroundColor: RGBA, titleColor: RGBA, title: string | null, bottomTitle: string | null) => void;
    bufferResize: (buffer: OptimizedBufferHandle, width: number, height: number) => void;
    resizeRenderer: (renderer: RendererHandle, width: number, height: number) => void;
    setCursorPosition: (renderer: RendererHandle, x: number, y: number, visible: boolean) => void;
    setCursorColor: (renderer: RendererHandle, color: RGBA) => void;
    getCursorState: (renderer: RendererHandle) => CursorState;
    setCursorStyleOptions: (renderer: RendererHandle, options: CursorStyleOptions) => void;
    setDebugOverlay: (renderer: RendererHandle, enabled: boolean, corner: DebugOverlayCorner) => void;
    clearTerminal: (renderer: RendererHandle) => void;
    setTerminalTitle: (renderer: RendererHandle, title: string) => void;
    copyToClipboardOSC52: (renderer: RendererHandle, target: number, textUtf8: Uint8Array) => boolean;
    clearClipboardOSC52: (renderer: RendererHandle, target: number) => boolean;
    triggerNotification: (renderer: RendererHandle, message: string, title?: string) => boolean;
    addToHitGrid: (renderer: RendererHandle, x: number, y: number, width: number, height: number, id: number) => void;
    clearCurrentHitGrid: (renderer: RendererHandle) => void;
    hitGridPushScissorRect: (renderer: RendererHandle, x: number, y: number, width: number, height: number) => void;
    hitGridPopScissorRect: (renderer: RendererHandle) => void;
    hitGridClearScissorRects: (renderer: RendererHandle) => void;
    addToCurrentHitGridClipped: (renderer: RendererHandle, x: number, y: number, width: number, height: number, id: number) => void;
    checkHit: (renderer: RendererHandle, x: number, y: number) => number;
    getHitGridDirty: (renderer: RendererHandle) => boolean;
    dumpHitGrid: (renderer: RendererHandle) => void;
    dumpBuffers: (renderer: RendererHandle, timestamp?: number) => void;
    dumpOutputBuffer: (renderer: RendererHandle, timestamp?: number) => void;
    restoreTerminalModes: (renderer: RendererHandle) => void;
    enableMouse: (renderer: RendererHandle, enableMovement: boolean) => void;
    disableMouse: (renderer: RendererHandle) => void;
    enableKittyKeyboard: (renderer: RendererHandle, flags: number) => void;
    disableKittyKeyboard: (renderer: RendererHandle) => void;
    setKittyKeyboardFlags: (renderer: RendererHandle, flags: number) => void;
    getKittyKeyboardFlags: (renderer: RendererHandle) => number;
    setupTerminal: (renderer: RendererHandle, useAlternateScreen: boolean) => void;
    suspendRenderer: (renderer: RendererHandle) => void;
    resumeRenderer: (renderer: RendererHandle) => void;
    queryPixelResolution: (renderer: RendererHandle) => void;
    queryThemeColors: (renderer: RendererHandle) => void;
    writeOut: (renderer: RendererHandle, data: string | Uint8Array) => void;
    yogaConfigCreate: () => Pointer;
    yogaConfigFree: (config: Pointer) => void;
    yogaConfigSetUseWebDefaults: (config: Pointer, enabled: boolean) => void;
    yogaConfigGetUseWebDefaults: (config: Pointer) => boolean;
    yogaConfigSetPointScaleFactor: (config: Pointer, pointScaleFactor: number) => void;
    yogaConfigGetPointScaleFactor: (config: Pointer) => number;
    yogaConfigSetErrata: (config: Pointer, errata: number) => void;
    yogaConfigGetErrata: (config: Pointer) => number;
    yogaConfigSetExperimentalFeatureEnabled: (config: Pointer, feature: number, enabled: boolean) => void;
    yogaConfigIsExperimentalFeatureEnabled: (config: Pointer, feature: number) => boolean;
    yogaNodeCreate: () => Pointer;
    yogaNodeCreateForOpenTUI: () => Pointer;
    yogaNodeCreateWithConfig: (config: Pointer) => Pointer;
    yogaNodeFree: (node: Pointer) => void;
    yogaNodeFreeRecursive: (node: Pointer) => void;
    yogaNodeReset: (node: Pointer) => void;
    yogaNodeCopyStyle: (dstNode: Pointer, srcNode: Pointer) => void;
    yogaNodeInsertChild: (node: Pointer, child: Pointer, index: number) => void;
    yogaNodeRemoveChild: (node: Pointer, child: Pointer) => void;
    yogaNodeRemoveAllChildren: (node: Pointer) => void;
    yogaNodeGetChild: (node: Pointer, index: number) => Pointer | null;
    yogaNodeGetChildCount: (node: Pointer) => number;
    yogaNodeGetParent: (node: Pointer) => Pointer | null;
    yogaNodeCalculateLayout: (node: Pointer, width: number, height: number, direction: number) => void;
    yogaNodeIsDirty: (node: Pointer) => boolean;
    yogaNodeMarkDirty: (node: Pointer) => void;
    yogaNodeGetHasNewLayout: (node: Pointer) => boolean;
    yogaNodeSetHasNewLayout: (node: Pointer, hasNewLayout: boolean) => void;
    yogaNodeSetIsReferenceBaseline: (node: Pointer, isReferenceBaseline: boolean) => void;
    yogaNodeIsReferenceBaseline: (node: Pointer) => boolean;
    yogaNodeSetAlwaysFormsContainingBlock: (node: Pointer, alwaysFormsContainingBlock: boolean) => void;
    yogaNodeGetAlwaysFormsContainingBlock: (node: Pointer) => boolean;
    yogaNodeGetComputedLayout: (node: Pointer) => NativeYogaLayout;
    yogaNodeLayoutGetEdge: (node: Pointer, kind: number, edge: number) => number;
    yogaNodeStyleSetEnum: (node: Pointer, kind: number, value: number) => void;
    yogaNodeStyleGetEnum: (node: Pointer, kind: number) => number;
    yogaNodeStyleSetFloat: (node: Pointer, kind: number, value: number) => void;
    yogaNodeStyleGetFloat: (node: Pointer, kind: number) => number;
    yogaNodeStyleSetBorder: (node: Pointer, edge: number, border: number) => void;
    yogaNodeStyleGetBorder: (node: Pointer, edge: number) => number;
    yogaNodeStyleSetValue: (node: Pointer, kind: number, edgeOrGutter: number, unit: number, value: number) => void;
    yogaNodeStyleGetValue: (node: Pointer, kind: number, edgeOrGutter: number) => number | bigint;
    yogaNodeSetMeasureFunc: (node: Pointer, enabled: boolean) => void;
    yogaNodeUnsetMeasureFunc: (node: Pointer) => void;
    yogaNodeHasMeasureFunc: (node: Pointer) => boolean;
    yogaNodeSetDirtiedFunc: (node: Pointer, enabled: boolean) => void;
    yogaNodeUnsetDirtiedFunc: (node: Pointer) => void;
    yogaStoreMeasureResult: (width: number, height: number) => void;
    yogaSetMeasureCallback: (callback: Pointer | null) => void;
    yogaSetDirtiedCallback: (callback: Pointer | null) => void;
    createYogaMeasureCallback: (callback: NativeYogaMeasureCallback) => FFICallbackInstance;
    createYogaDirtiedCallback: (callback: NativeYogaDirtiedCallback) => FFICallbackInstance;
    createTextBuffer: (widthMethod: WidthMethod) => TextBuffer;
    destroyTextBuffer: (buffer: TextBufferHandle) => void;
    textBufferGetLength: (buffer: TextBufferHandle) => number;
    textBufferGetByteSize: (buffer: TextBufferHandle) => number;
    textBufferReset: (buffer: TextBufferHandle) => void;
    textBufferClear: (buffer: TextBufferHandle) => void;
    textBufferRegisterMemBuffer: (buffer: TextBufferHandle, bytes: Uint8Array, owned?: boolean) => number;
    textBufferReplaceMemBuffer: (buffer: TextBufferHandle, memId: number, bytes: Uint8Array, owned?: boolean) => boolean;
    textBufferClearMemRegistry: (buffer: TextBufferHandle) => void;
    textBufferSetTextFromMem: (buffer: TextBufferHandle, memId: number) => void;
    textBufferAppend: (buffer: TextBufferHandle, bytes: Uint8Array) => void;
    textBufferAppendFromMemId: (buffer: TextBufferHandle, memId: number) => void;
    textBufferLoadFile: (buffer: TextBufferHandle, path: string) => boolean;
    textBufferSetStyledText: (buffer: TextBufferHandle, chunks: Array<{
        text: string;
        fg?: RGBA | null;
        bg?: RGBA | null;
        attributes?: number;
        link?: {
            url: string;
        };
    }>) => void;
    textBufferSetDefaultFg: (buffer: TextBufferHandle, fg: RGBA | null) => void;
    textBufferSetDefaultBg: (buffer: TextBufferHandle, bg: RGBA | null) => void;
    textBufferSetDefaultAttributes: (buffer: TextBufferHandle, attributes: number | null) => void;
    textBufferResetDefaults: (buffer: TextBufferHandle) => void;
    textBufferGetTabWidth: (buffer: TextBufferHandle) => number;
    textBufferSetTabWidth: (buffer: TextBufferHandle, width: number) => void;
    textBufferGetLineCount: (buffer: TextBufferHandle) => number;
    getPlainTextBytes: (buffer: TextBufferHandle, maxLength: number) => Uint8Array | null;
    textBufferGetTextRange: (buffer: TextBufferHandle, startOffset: number, endOffset: number, maxLength: number) => Uint8Array | null;
    textBufferGetTextRangeByCoords: (buffer: TextBufferHandle, startRow: number, startCol: number, endRow: number, endCol: number, maxLength: number) => Uint8Array | null;
    createTextBufferView: (textBuffer: TextBufferHandle) => TextBufferViewHandle;
    destroyTextBufferView: (view: TextBufferViewHandle) => void;
    textBufferViewSetSelection: (view: TextBufferViewHandle, start: number, end: number, bgColor: RGBA | null, fgColor: RGBA | null) => void;
    textBufferViewResetSelection: (view: TextBufferViewHandle) => void;
    textBufferViewGetSelection: (view: TextBufferViewHandle) => {
        start: number;
        end: number;
    } | null;
    textBufferViewSetLocalSelection: (view: TextBufferViewHandle, anchorX: number, anchorY: number, focusX: number, focusY: number, bgColor: RGBA | null, fgColor: RGBA | null) => boolean;
    textBufferViewUpdateSelection: (view: TextBufferViewHandle, end: number, bgColor: RGBA | null, fgColor: RGBA | null) => void;
    textBufferViewUpdateLocalSelection: (view: TextBufferViewHandle, anchorX: number, anchorY: number, focusX: number, focusY: number, bgColor: RGBA | null, fgColor: RGBA | null) => boolean;
    textBufferViewResetLocalSelection: (view: TextBufferViewHandle) => void;
    textBufferViewSetWrapWidth: (view: TextBufferViewHandle, width: number) => void;
    textBufferViewSetWrapMode: (view: TextBufferViewHandle, mode: "none" | "char" | "word") => void;
    textBufferViewSetFirstLineOffset: (view: TextBufferViewHandle, offset: number) => void;
    textBufferViewSetViewportSize: (view: TextBufferViewHandle, width: number, height: number) => void;
    textBufferViewSetViewport: (view: TextBufferViewHandle, x: number, y: number, width: number, height: number) => void;
    textBufferViewGetLineInfo: (view: TextBufferViewHandle) => LineInfo;
    textBufferViewGetLogicalLineInfo: (view: TextBufferViewHandle) => LineInfo;
    textBufferViewGetSelectedTextBytes: (view: TextBufferViewHandle, maxLength: number) => Uint8Array | null;
    textBufferViewGetPlainTextBytes: (view: TextBufferViewHandle, maxLength: number) => Uint8Array | null;
    textBufferViewSetTabIndicator: (view: TextBufferViewHandle, indicator: number) => void;
    textBufferViewSetTabIndicatorColor: (view: TextBufferViewHandle, color: RGBA) => void;
    textBufferViewSetTruncate: (view: TextBufferViewHandle, truncate: boolean) => void;
    textBufferViewMeasureForDimensions: (view: TextBufferViewHandle, width: number, height: number) => {
        lineCount: number;
        widthColsMax: number;
    } | null;
    textBufferViewGetVirtualLineCount: (view: TextBufferViewHandle) => number;
    readonly encoder: TextEncoder;
    readonly decoder: TextDecoder;
    bufferDrawTextBufferView: (buffer: OptimizedBufferHandle, view: TextBufferViewHandle, x: number, y: number) => void;
    bufferDrawEditorView: (buffer: OptimizedBufferHandle, view: EditorViewHandle, x: number, y: number) => void;
    createEditBuffer: (widthMethod: WidthMethod) => EditBufferHandle;
    destroyEditBuffer: (buffer: EditBufferHandle) => void;
    editBufferSetText: (buffer: EditBufferHandle, textBytes: Uint8Array) => void;
    editBufferSetTextFromMem: (buffer: EditBufferHandle, memId: number) => void;
    editBufferReplaceText: (buffer: EditBufferHandle, textBytes: Uint8Array) => void;
    editBufferReplaceTextFromMem: (buffer: EditBufferHandle, memId: number) => void;
    editBufferGetText: (buffer: EditBufferHandle, maxLength: number) => Uint8Array | null;
    editBufferInsertChar: (buffer: EditBufferHandle, char: string) => void;
    editBufferInsertText: (buffer: EditBufferHandle, text: string) => void;
    editBufferDeleteChar: (buffer: EditBufferHandle) => void;
    editBufferDeleteCharBackward: (buffer: EditBufferHandle) => void;
    editBufferDeleteRange: (buffer: EditBufferHandle, startLine: number, startCol: number, endLine: number, endCol: number) => void;
    editBufferNewLine: (buffer: EditBufferHandle) => void;
    editBufferDeleteLine: (buffer: EditBufferHandle) => void;
    editBufferMoveCursorLeft: (buffer: EditBufferHandle) => void;
    editBufferMoveCursorRight: (buffer: EditBufferHandle) => void;
    editBufferMoveCursorUp: (buffer: EditBufferHandle) => void;
    editBufferMoveCursorDown: (buffer: EditBufferHandle) => void;
    editBufferGotoLine: (buffer: EditBufferHandle, line: number) => void;
    editBufferSetCursor: (buffer: EditBufferHandle, line: number, col: number) => void;
    editBufferSetCursorToLineCol: (buffer: EditBufferHandle, line: number, col: number) => void;
    editBufferSetCursorByOffset: (buffer: EditBufferHandle, offset: number) => void;
    editBufferGetCursorPosition: (buffer: EditBufferHandle) => LogicalCursor;
    editBufferGetId: (buffer: EditBufferHandle) => number;
    editBufferGetTextBuffer: (buffer: EditBufferHandle) => TextBufferHandle;
    editBufferDebugLogRope: (buffer: EditBufferHandle) => void;
    editBufferUndo: (buffer: EditBufferHandle, maxLength: number) => Uint8Array | null;
    editBufferRedo: (buffer: EditBufferHandle, maxLength: number) => Uint8Array | null;
    editBufferCanUndo: (buffer: EditBufferHandle) => boolean;
    editBufferCanRedo: (buffer: EditBufferHandle) => boolean;
    editBufferClearHistory: (buffer: EditBufferHandle) => void;
    editBufferClear: (buffer: EditBufferHandle) => void;
    editBufferGetNextWordBoundary: (buffer: EditBufferHandle) => {
        row: number;
        col: number;
        offset: number;
    };
    editBufferGetPrevWordBoundary: (buffer: EditBufferHandle) => {
        row: number;
        col: number;
        offset: number;
    };
    editBufferGetEOL: (buffer: EditBufferHandle) => {
        row: number;
        col: number;
        offset: number;
    };
    editBufferOffsetToPosition: (buffer: EditBufferHandle, offset: number) => {
        row: number;
        col: number;
        offset: number;
    } | null;
    editBufferPositionToOffset: (buffer: EditBufferHandle, row: number, col: number) => number;
    editBufferGetLineStartOffset: (buffer: EditBufferHandle, row: number) => number;
    editBufferGetTextRange: (buffer: EditBufferHandle, startOffset: number, endOffset: number, maxLength: number) => Uint8Array | null;
    editBufferGetTextRangeByCoords: (buffer: EditBufferHandle, startRow: number, startCol: number, endRow: number, endCol: number, maxLength: number) => Uint8Array | null;
    createEditorView: (editBufferPtr: EditBufferHandle, viewportWidth: number, viewportHeight: number) => EditorViewHandle;
    destroyEditorView: (view: EditorViewHandle) => void;
    editorViewSetViewportSize: (view: EditorViewHandle, width: number, height: number) => void;
    editorViewSetViewport: (view: EditorViewHandle, x: number, y: number, width: number, height: number, moveCursor: boolean) => void;
    editorViewGetViewport: (view: EditorViewHandle) => {
        offsetY: number;
        offsetX: number;
        height: number;
        width: number;
    };
    editorViewSetScrollMargin: (view: EditorViewHandle, margin: number) => void;
    editorViewSetWrapMode: (view: EditorViewHandle, mode: "none" | "char" | "word") => void;
    editorViewGetVirtualLineCount: (view: EditorViewHandle) => number;
    editorViewGetTotalVirtualLineCount: (view: EditorViewHandle) => number;
    editorViewGetTextBufferView: (view: EditorViewHandle) => TextBufferViewHandle;
    editorViewSetSelection: (view: EditorViewHandle, start: number, end: number, bgColor: RGBA | null, fgColor: RGBA | null) => void;
    editorViewResetSelection: (view: EditorViewHandle) => void;
    editorViewGetSelection: (view: EditorViewHandle) => {
        start: number;
        end: number;
    } | null;
    editorViewSetLocalSelection: (view: EditorViewHandle, anchorX: number, anchorY: number, focusX: number, focusY: number, bgColor: RGBA | null, fgColor: RGBA | null, updateCursor: boolean, followCursor: boolean) => boolean;
    editorViewUpdateSelection: (view: EditorViewHandle, end: number, bgColor: RGBA | null, fgColor: RGBA | null) => void;
    editorViewUpdateLocalSelection: (view: EditorViewHandle, anchorX: number, anchorY: number, focusX: number, focusY: number, bgColor: RGBA | null, fgColor: RGBA | null, updateCursor: boolean, followCursor: boolean) => boolean;
    editorViewResetLocalSelection: (view: EditorViewHandle) => void;
    editorViewGetSelectedTextBytes: (view: EditorViewHandle, maxLength: number) => Uint8Array | null;
    editorViewGetCursor: (view: EditorViewHandle) => {
        row: number;
        col: number;
    };
    editorViewGetText: (view: EditorViewHandle, maxLength: number) => Uint8Array | null;
    editorViewGetVisualCursor: (view: EditorViewHandle) => VisualCursor;
    editorViewMoveUpVisual: (view: EditorViewHandle) => void;
    editorViewMoveDownVisual: (view: EditorViewHandle) => void;
    editorViewDeleteSelectedText: (view: EditorViewHandle) => void;
    editorViewSetCursorByOffset: (view: EditorViewHandle, offset: number) => void;
    editorViewGetNextWordBoundary: (view: EditorViewHandle) => VisualCursor;
    editorViewGetPrevWordBoundary: (view: EditorViewHandle) => VisualCursor;
    editorViewGetEOL: (view: EditorViewHandle) => VisualCursor;
    editorViewGetVisualSOL: (view: EditorViewHandle) => VisualCursor;
    editorViewGetVisualEOL: (view: EditorViewHandle) => VisualCursor;
    editorViewGetLineInfo: (view: EditorViewHandle) => LineInfo;
    editorViewGetLogicalLineInfo: (view: EditorViewHandle) => LineInfo;
    editorViewSetPlaceholderStyledText: (view: EditorViewHandle, chunks: Array<{
        text: string;
        fg?: RGBA | null;
        bg?: RGBA | null;
        attributes?: number;
    }>) => void;
    editorViewSetTabIndicator: (view: EditorViewHandle, indicator: number) => void;
    editorViewSetTabIndicatorColor: (view: EditorViewHandle, color: RGBA) => void;
    bufferPushScissorRect: (buffer: OptimizedBufferHandle, x: number, y: number, width: number, height: number) => void;
    bufferPopScissorRect: (buffer: OptimizedBufferHandle) => void;
    bufferClearScissorRects: (buffer: OptimizedBufferHandle) => void;
    bufferPushOpacity: (buffer: OptimizedBufferHandle, opacity: number) => void;
    bufferPopOpacity: (buffer: OptimizedBufferHandle) => void;
    bufferGetCurrentOpacity: (buffer: OptimizedBufferHandle) => number;
    bufferClearOpacity: (buffer: OptimizedBufferHandle) => void;
    textBufferAddHighlightByCharRange: (buffer: TextBufferHandle, highlight: Highlight) => void;
    textBufferAddHighlight: (buffer: TextBufferHandle, lineIdx: number, highlight: Highlight) => void;
    textBufferRemoveHighlightsByRef: (buffer: TextBufferHandle, hlRef: number) => void;
    textBufferClearLineHighlights: (buffer: TextBufferHandle, lineIdx: number) => void;
    textBufferClearAllHighlights: (buffer: TextBufferHandle) => void;
    textBufferSetSyntaxStyle: (buffer: TextBufferHandle, style: SyntaxStyleHandle | null) => boolean;
    textBufferGetLineHighlights: (buffer: TextBufferHandle, lineIdx: number) => Array<Highlight>;
    textBufferGetHighlightCount: (buffer: TextBufferHandle) => number;
    getArenaAllocatedBytes: () => number;
    getBuildOptions: () => BuildOptions;
    getAllocatorStats: () => AllocatorStats;
    createSyntaxStyle: () => SyntaxStyleHandle;
    destroySyntaxStyle: (style: SyntaxStyleHandle) => void;
    syntaxStyleRegister: (style: SyntaxStyleHandle, name: string, fg: RGBA | null, bg: RGBA | null, attributes: number) => number;
    syntaxStyleResolveByName: (style: SyntaxStyleHandle, name: string) => number | null;
    syntaxStyleGetStyleCount: (style: SyntaxStyleHandle) => number;
    getTerminalCapabilities: (renderer: RendererHandle) => TerminalCapabilities;
    processCapabilityResponse: (renderer: RendererHandle, response: string) => void;
    encodeUnicode: (text: string, widthMethod: WidthMethod) => {
        ptr: Pointer;
        data: Array<{
            width: number;
            char: number;
        }>;
    } | null;
    freeUnicode: (encoded: {
        ptr: Pointer;
        data: Array<{
            width: number;
            char: number;
        }>;
    }) => void;
    bufferDrawChar: (buffer: OptimizedBufferHandle, char: number, x: number, y: number, fg: RGBA, bg: RGBA, attributes?: number) => void;
    registerNativeSpanFeedStream: (stream: Pointer, handler: NativeSpanFeedEventHandler) => void;
    unregisterNativeSpanFeedStream: (stream: Pointer) => void;
    createNativeSpanFeed: (options?: NativeSpanFeedOptions | null) => Pointer;
    attachNativeSpanFeed: (stream: Pointer) => number;
    destroyNativeSpanFeed: (stream: Pointer) => void;
    streamWrite: (stream: Pointer, data: Uint8Array | string) => number;
    streamCommit: (stream: Pointer) => number;
    streamDrainSpans: (stream: Pointer, outBuffer: Uint8Array, maxSpans: number) => number;
    streamClose: (stream: Pointer) => number;
    streamSetOptions: (stream: Pointer, options: NativeSpanFeedOptions) => number;
    streamGetStats: (stream: Pointer) => NativeSpanFeedStats | null;
    streamReserve: (stream: Pointer, minLen: number) => {
        status: number;
        info: ReserveInfo | null;
    };
    streamCommitReserved: (stream: Pointer, length: number) => number;
    createNativeRenderable: () => NativeRenderableHandle;
    destroyNativeRenderable: (handle: NativeRenderableHandle) => void;
    nativeRenderableAttachYogaNode: (handle: NativeRenderableHandle, node: Pointer) => boolean;
    nativeRenderableSetMeasureTarget: (handle: NativeRenderableHandle, kind: NativeMeasureTargetKind, target: NativeMeasureTargetHandle | 0) => boolean;
    onNativeEvent: (name: string, handler: (data: ArrayBuffer) => void) => void;
    onceNativeEvent: (name: string, handler: (data: ArrayBuffer) => void) => void;
    offNativeEvent: (name: string, handler: (data: ArrayBuffer) => void) => void;
    onAnyNativeEvent: (handler: (name: string, data: ArrayBuffer) => void) => void;
}
export declare function setRenderLibPath(libPath: string): void;
export declare function resolveRenderLib(): RenderLib;
