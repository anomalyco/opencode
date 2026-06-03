export interface ReplaceEdit {
    op: "replace";
    pos: string;
    end?: string;
    lines: string | string[];
}
export interface AppendEdit {
    op: "append";
    pos?: string;
    lines: string | string[];
}
export interface PrependEdit {
    op: "prepend";
    pos?: string;
    lines: string | string[];
}
export type HashlineEdit = ReplaceEdit | AppendEdit | PrependEdit;
