/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
export declare enum Align {
    Auto = 0,
    FlexStart = 1,
    Center = 2,
    FlexEnd = 3,
    Stretch = 4,
    Baseline = 5,
    SpaceBetween = 6,
    SpaceAround = 7,
    SpaceEvenly = 8
}
export declare enum BoxSizing {
    BorderBox = 0,
    ContentBox = 1
}
export declare enum Dimension {
    Width = 0,
    Height = 1
}
export declare enum Direction {
    Inherit = 0,
    LTR = 1,
    RTL = 2
}
export declare enum Display {
    Flex = 0,
    None = 1,
    Contents = 2
}
export declare enum Edge {
    Left = 0,
    Top = 1,
    Right = 2,
    Bottom = 3,
    Start = 4,
    End = 5,
    Horizontal = 6,
    Vertical = 7,
    All = 8
}
export declare enum Errata {
    None = 0,
    StretchFlexBasis = 1,
    AbsolutePositionWithoutInsetsExcludesPadding = 2,
    AbsolutePercentAgainstInnerSize = 4,
    All = 2147483647,
    Classic = 2147483646
}
export declare enum ExperimentalFeature {
    WebFlexBasis = 0
}
export declare enum FlexDirection {
    Column = 0,
    ColumnReverse = 1,
    Row = 2,
    RowReverse = 3
}
export declare enum Gutter {
    Column = 0,
    Row = 1,
    All = 2
}
export declare enum Justify {
    FlexStart = 0,
    Center = 1,
    FlexEnd = 2,
    SpaceBetween = 3,
    SpaceAround = 4,
    SpaceEvenly = 5
}
export declare enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Verbose = 4,
    Fatal = 5
}
export declare enum MeasureMode {
    Undefined = 0,
    Exactly = 1,
    AtMost = 2
}
export declare enum NodeType {
    Default = 0,
    Text = 1
}
export declare enum Overflow {
    Visible = 0,
    Hidden = 1,
    Scroll = 2
}
export declare enum PositionType {
    Static = 0,
    Relative = 1,
    Absolute = 2
}
export declare enum Unit {
    Undefined = 0,
    Point = 1,
    Percent = 2,
    Auto = 3
}
export declare enum Wrap {
    NoWrap = 0,
    Wrap = 1,
    WrapReverse = 2
}
declare const constants: {
    ALIGN_AUTO: Align;
    ALIGN_FLEX_START: Align;
    ALIGN_CENTER: Align;
    ALIGN_FLEX_END: Align;
    ALIGN_STRETCH: Align;
    ALIGN_BASELINE: Align;
    ALIGN_SPACE_BETWEEN: Align;
    ALIGN_SPACE_AROUND: Align;
    ALIGN_SPACE_EVENLY: Align;
    BOX_SIZING_BORDER_BOX: BoxSizing;
    BOX_SIZING_CONTENT_BOX: BoxSizing;
    DIMENSION_WIDTH: Dimension;
    DIMENSION_HEIGHT: Dimension;
    DIRECTION_INHERIT: Direction;
    DIRECTION_LTR: Direction;
    DIRECTION_RTL: Direction;
    DISPLAY_FLEX: Display;
    DISPLAY_NONE: Display;
    DISPLAY_CONTENTS: Display;
    EDGE_LEFT: Edge;
    EDGE_TOP: Edge;
    EDGE_RIGHT: Edge;
    EDGE_BOTTOM: Edge;
    EDGE_START: Edge;
    EDGE_END: Edge;
    EDGE_HORIZONTAL: Edge;
    EDGE_VERTICAL: Edge;
    EDGE_ALL: Edge;
    ERRATA_NONE: Errata;
    ERRATA_STRETCH_FLEX_BASIS: Errata;
    ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING: Errata;
    ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE: Errata;
    ERRATA_ALL: Errata;
    ERRATA_CLASSIC: Errata;
    EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS: ExperimentalFeature;
    FLEX_DIRECTION_COLUMN: FlexDirection;
    FLEX_DIRECTION_COLUMN_REVERSE: FlexDirection;
    FLEX_DIRECTION_ROW: FlexDirection;
    FLEX_DIRECTION_ROW_REVERSE: FlexDirection;
    GUTTER_COLUMN: Gutter;
    GUTTER_ROW: Gutter;
    GUTTER_ALL: Gutter;
    JUSTIFY_FLEX_START: Justify;
    JUSTIFY_CENTER: Justify;
    JUSTIFY_FLEX_END: Justify;
    JUSTIFY_SPACE_BETWEEN: Justify;
    JUSTIFY_SPACE_AROUND: Justify;
    JUSTIFY_SPACE_EVENLY: Justify;
    LOG_LEVEL_ERROR: LogLevel;
    LOG_LEVEL_WARN: LogLevel;
    LOG_LEVEL_INFO: LogLevel;
    LOG_LEVEL_DEBUG: LogLevel;
    LOG_LEVEL_VERBOSE: LogLevel;
    LOG_LEVEL_FATAL: LogLevel;
    MEASURE_MODE_UNDEFINED: MeasureMode;
    MEASURE_MODE_EXACTLY: MeasureMode;
    MEASURE_MODE_AT_MOST: MeasureMode;
    NODE_TYPE_DEFAULT: NodeType;
    NODE_TYPE_TEXT: NodeType;
    OVERFLOW_VISIBLE: Overflow;
    OVERFLOW_HIDDEN: Overflow;
    OVERFLOW_SCROLL: Overflow;
    POSITION_TYPE_STATIC: PositionType;
    POSITION_TYPE_RELATIVE: PositionType;
    POSITION_TYPE_ABSOLUTE: PositionType;
    UNIT_UNDEFINED: Unit;
    UNIT_POINT: Unit;
    UNIT_PERCENT: Unit;
    UNIT_AUTO: Unit;
    WRAP_NO_WRAP: Wrap;
    WRAP_WRAP: Wrap;
    WRAP_WRAP_REVERSE: Wrap;
};
export default constants;
