// Type definitions for xmlbuilder
// Project: https://github.com/oozcitak/xmlbuilder-js
// Definitions by: Wallymathieu <https://github.com/wallymathieu>
//               : GaikwadPratik <https://github.com/GaikwadPratik>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

export = xmlbuilder;

declare namespace xmlbuilder {

    class XMLDocType {
        clone(): XMLDocType;
        element(name: string, value?: Object): XMLDocType;
        attList(elementName: string, attributeName: string, attributeType: string, defaultValueType?: string, defaultValue?: any): XMLDocType;
        entity(name: string, value: any): XMLDocType;
        pEntity(name: string, value: any): XMLDocType;
        notation(name: string, value: any): XMLDocType;
        cdata(value: string): XMLDocType;
        comment(value: string): XMLDocType;
        instruction(target: string, value: any): XMLDocType;
        root(): XMLDocType;
        document(): any;
        toString(options?: XMLToStringOptions, level?: Number): string;

        ele(name: string, value?: Object): XMLDocType;
        att(elementName: string, attributeName: string, attributeType: string, defaultValueType?: string, defaultValue?: any): XMLDocType;
        ent(name: string, value: any): XMLDocType;
        pent(name: string, value: any): XMLDocType;
        not(name: string, value: any): XMLDocType;
        dat(value: string): XMLDocType;
        com(value: string): XMLDocType;
        ins(target: string, value: any): XMLDocType;
        up(): XMLDocType;
        doc(): any;
    }

    class XMLElementOrXMLNode {
        // XMLElement:
        clone(): XMLElementOrXMLNode;
        attribute(name: any, value?: any): XMLElementOrXMLNode;
        att(name: any, value?: any): XMLElementOrXMLNode;
        removeAttribute(name: string): XMLElementOrXMLNode;
        instruction(target: string, value: any): XMLElementOrXMLNode;
        instruction(array: Array<any>): XMLElementOrXMLNode;
        instruction(obj: Object): XMLElementOrXMLNode;
        ins(target: string, value: any): XMLElementOrXMLNode;
        ins(array: Array<any>): XMLElementOrXMLNode;
        ins(obj: Object): XMLElementOrXMLNode;
        a(name: any, value?: any): XMLElementOrXMLNode;
        i(target: string, value: any): XMLElementOrXMLNode;
        i(array: Array<any>): XMLElementOrXMLNode;
        i(obj: Object): XMLElementOrXMLNode;
        toString(options?: XMLToStringOptions, level?: Number): string;
        // XMLNode:
        element(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        ele(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        insertBefore(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        insertAfter(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        remove(): XMLElementOrXMLNode;
        node(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        text(value: string): XMLElementOrXMLNode;
        cdata(value: string): XMLElementOrXMLNode;
        comment(value: string): XMLElementOrXMLNode;
        raw(value: string): XMLElementOrXMLNode;
        declaration(version: string, encoding: string, standalone: boolean): XMLElementOrXMLNode;
        doctype(pubID: string, sysID: string): XMLDocType;
        up(): XMLElementOrXMLNode;
        importDocument(input: XMLElementOrXMLNode): XMLElementOrXMLNode;
        root(): XMLElementOrXMLNode;
        document(): any;
        end(options?: XMLEndOptions): string;
        prev(): XMLElementOrXMLNode;
        next(): XMLElementOrXMLNode;
        nod(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        txt(value: string): XMLElementOrXMLNode;
        dat(value: string): XMLElementOrXMLNode;
        com(value: string): XMLElementOrXMLNode;
        doc(): XMLElementOrXMLNode;
        dec(version: string, encoding: string, standalone: boolean): XMLElementOrXMLNode;
        dtd(pubID: string, sysID: string): XMLDocType;
        e(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        n(name: any, attributes?: Object, text?: any): XMLElementOrXMLNode;
        t(value: string): XMLElementOrXMLNode;
        d(value: string): XMLElementOrXMLNode;
        c(value: string): XMLElementOrXMLNode;
        r(value: string): XMLElementOrXMLNode;
        u(): XMLElementOrXMLNode;
    }

    interface XMLDec {
        version?: string;
        encoding?: string;
        standalone?: boolean;
    }

    interface XMLDtd {
        pubID?: string;
        sysID?: string;
    }

    interface XMLStringifier {
        [x: string]: ((v: any) => string) | string;
    }

    interface XMLWriter {
        [x: string]: ((e: XMLElementOrXMLNode, options: WriterOptions, level?: number) => void);
    }

    interface XMLCreateOptions {
        headless?: boolean;
        keepNullNodes?: boolean;
        keepNullAttributes?: boolean;
        ignoreDecorators?: boolean;
        separateArrayItems?: boolean;
        noDoubleEncoding?: boolean;
        stringify?: XMLStringifier;
    }

    interface XMLToStringOptions {
        pretty?: boolean;
        indent?: string;
        offset?: number;
        newline?: string;
        allowEmpty?: boolean;
        spacebeforeslash?: string;
    }

    interface XMLEndOptions extends XMLToStringOptions {
        writer?: XMLWriter;
    }

    interface WriterOptions {
        pretty?: boolean;
        indent?: string;
        newline?: string;
        offset?: number;
        allowEmpty?: boolean;
        dontPrettyTextNodes?: boolean;
        spaceBeforeSlash?: string | boolean;
        user? :any;
        state?: WriterState;
    }

    enum WriterState {
        None = 0,
        OpenTag = 1,
        InsideTag = 2,
        CloseTag = 3
    }

    function create(nameOrObjSpec: string | { [name: string]: Object }, xmldecOrOptions?: XMLDec | XMLCreateOptions, doctypeOrOptions?: XMLDtd | XMLCreateOptions, options?: XMLCreateOptions): XMLElementOrXMLNode;
    function begin(): XMLElementOrXMLNode;
}