function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var constants;
var hasRequiredConstants;

function requireConstants () {
	if (hasRequiredConstants) return constants;
	hasRequiredConstants = 1;

	constants = {
	    BUILD: {
	        COMPTIME: true
	    },
	    NODE_TYPE: {
	        ATTRIBUTE: 'ATTRIBUTE',
	        CONTENT: 'CONTENT',
	        ELEMENT: 'ELEMENT',
	        ROOT: 'ROOT'
	    },
	    TOKEN_TYPE: {
	        OPEN_BRACKET: 'OPEN_BRACKET',
	        ELEMENT_TYPE: 'ELEMENT_TYPE',
	        CLOSE_ELEMENT: 'CLOSE_ELEMENT',
	        ATTRIB_NAME: 'ATTRIB_NAME',
	        ATTRIB_VALUE: 'ATTRIB_VALUE',
	        ASSIGN: 'ASSIGN',
	        CLOSE_BRACKET: 'CLOSE_BRACKET',
	        CONTENT: 'CONTENT',
	        EOF: 'EOF'
	    }
	};
	return constants;
}

var astToJson;
var hasRequiredAstToJson;

function requireAstToJson () {
	if (hasRequiredAstToJson) return astToJson;
	hasRequiredAstToJson = 1;

	const { NODE_TYPE } = requireConstants();

	const convertToJSON = ast => {
	    return buildJSONFromNode(ast.value.children[0])
	};

	const buildJSONFromNode = node => {
	    if (!node) return null
	    const json = {};
	    switch (node.type) {
	        case "ELEMENT": {
	            let element = {};
	            const attribs = buildAttributes(node.value.attributes);
	            const children = buildJSONFromNode(node.value.children);
	            if (attribs) {
	                element = Object.assign(element, attribs);
	            }
	            if (children) {
	                const jsonChildren = buildChildren(node.value.children);
	                element = Object.assign(element, jsonChildren);
	            }
	            json[node.value.type] = element;
	            break
	        }
	        case "ATTRIBUTE": {
	            const attribNameAndValue = node.value;
	            json[attribNameAndValue.name] = attribNameAndValue.value;
	            break
	        }
	        case "CONTENT": {
	            return {content: node.value}
	        }
	    }

	    return json
	};

	const buildChildren = children => {
	    if (!children || !Array.isArray(children) || children.length === 0) return null
	    if (isContentChildren(children)) {
	        return {
	            content: children[0].value
	        }
	    }
	    return {
	        children: children.map(buildJSONFromNode)
	    }
	};

	const isContentChildren = children => children && Array.isArray(children) && children.length === 1 && children[0].type === "CONTENT";

	const buildAttributes = arrayNodes => {
	    if (arrayNodes && Array.isArray(arrayNodes)) {
	        const jsonArray = arrayNodes.map(buildJSONFromNode);
	        return jsonArray.reduce((agg, j) => Object.assign(agg, j), {})
	    }
	    return null
	};

	astToJson = {
	    convert: convertToJSON
	};
	return astToJson;
}

var model;
var hasRequiredModel;

function requireModel () {
	if (hasRequiredModel) return model;
	hasRequiredModel = 1;

	const Token = (type, value) => ({
	    type,
	    value
	});

	model = {
	    Token
	};
	return model;
}

var lexer;
var hasRequiredLexer;

function requireLexer () {
	if (hasRequiredLexer) return lexer;
	hasRequiredLexer = 1;

	const { BUILD, TOKEN_TYPE } = requireConstants();
	const { Token } = requireModel();

	const EOF_TOKEN = Token("EOF");

	const isCharBlank = (char) =>
	    char === ' ' || char === '\n' || char === '\r' || char === '\t';

	const skipXMLDocumentHeader = (xmlAsString, pos) => {
	    if (xmlAsString.startsWith('<?xml', pos)) {
	        const len = xmlAsString.length;
	        while (pos < len) {
	            if (xmlAsString[pos] !== '?') {
	                pos++;
	            } else if (xmlAsString[pos + 1] === '>') {
	                return pos + 2 // skip "?>""
	            } else {
	                pos++;
	            }
	        }
	    }
	    return pos
	};

	const replaceQuotes = (str) => str.replace(/'/g, "'");

	const getInitialPosForLexer = (xmlAsString) => {
	    let pos = 0;
	    while (pos < xmlAsString.length && isCharBlank(xmlAsString[pos])) pos++;
	    return skipXMLDocumentHeader(xmlAsString, pos)
	};

	function createLexer(xmlAsString) {
	    let currentToken = null;
	    let pos = getInitialPosForLexer(xmlAsString);
	    let scopingElement = [];

	    const peek = () => xmlAsString[pos];
	    const hasNext = () => currentToken !== EOF_TOKEN && pos < xmlAsString.length;
	    const isBlankSpace = () => isCharBlank(xmlAsString[pos]);

	    const skipQuotes = () => {
	        if (hasNext() && isQuote(peek())) pos++;
	    };

	    const isQuote = (char) => '"' === char || "'" === char;

	    const skipSpaces = () => {
	        while (hasNext() && isBlankSpace()) pos++;
	    };

	    const readAlphaNumericCharsOrBrackets = (areSpecialCharsSupported) => {
	        if (hasNext()) {
	            if (xmlAsString[pos] === '<') {
	                let buffer = '<';
	                pos++;
	                if (hasNext() && xmlAsString[pos] === '/') {
	                    pos++;
	                    buffer = '</';
	                } else if (
	                    hasNext() &&
	                    xmlAsString[pos] === '!' &&
	                    xmlAsString[pos + 1] === '-' &&
	                    xmlAsString[pos + 2] === '-'
	                ) {
	                    // its a comment
	                    pos++;
	                    pos++;
	                    pos++;
	                    buffer = '<!--';
	                }
	                return buffer
	            } else if (peek() === '/') {
	                let buffer = '/';
	                pos++;
	                if (hasNext() && peek() === '>') {
	                    pos++;
	                    buffer = '/>';
	                }
	                return buffer
	            } else if (xmlAsString[pos] === '=' || xmlAsString[pos] === '>') {
	                const buffer = xmlAsString[pos];
	                pos++;
	                return buffer
	            }
	        }
	        return readAlphaNumericChars(!!areSpecialCharsSupported)
	    };

	    const readAlphaNumericChars = (areSpecialCharsSupported) => {
	        const ELEMENT_TYPE_MATCHER = /[a-zA-Z0-9_:-]/;
	        const NAMES_VALS_CONTENT_MATCHER = /[^>=<]/u;
	        const matcher = areSpecialCharsSupported
	            ? NAMES_VALS_CONTENT_MATCHER
	            : ELEMENT_TYPE_MATCHER;
	        let start = pos;
	        while (hasNext() && xmlAsString[pos].match(matcher)) pos++;
	        return replaceQuotes(xmlAsString.substring(start, pos))
	    };

	    const isElementBegin = () =>
	        currentToken && currentToken.type === "OPEN_BRACKET";
	    const isAssignToAttribute = () =>
	        currentToken && currentToken.type === "ASSIGN";

	    const next = () => {
	        const prevPos = pos;
	        skipSpaces();
	        const numOfSpacesSkipped = pos - prevPos;
	        if (!hasNext()) {
	            currentToken = EOF_TOKEN;
	        } else if (isElementBegin()) {
	            // starting new element
	            skipSpaces();
	            const buffer = readAlphaNumericCharsOrBrackets(false);
	            currentToken = Token("ELEMENT_TYPE", buffer);
	            scopingElement.push(buffer);
	        } else if (isAssignToAttribute()) {
	            // assign value to attribute
	            skipQuotes();
	            const openingQuote = xmlAsString[pos - 1];
	            let start = pos;
	            while (hasNext() && peek() !== openingQuote) pos++;
	            const buffer = replaceQuotes(xmlAsString.substring(start, pos));
	            pos++;
	            currentToken = Token("ATTRIB_VALUE", buffer);
	        } else {
	            skipSpaces();
	            let buffer = readAlphaNumericCharsOrBrackets(true);
	            switch (buffer) {
	                case '=': {
	                    if (currentToken.type === "ATTRIB_NAME") {
	                        currentToken = Token("ASSIGN");
	                    } else {
	                        currentToken = Token("CONTENT", buffer);
	                    }
	                    break
	                }
	                case '</': {
	                    const start = pos;
	                    while (xmlAsString[pos] !== '>') pos++;
	                    currentToken = Token(
	                        "CLOSE_ELEMENT",
	                        xmlAsString.substring(start, pos)
	                    );
	                    pos++; // skip the ">"
	                    scopingElement.pop();
	                    break
	                }
	                case '/>': {
	                    const scopingElementName = scopingElement.pop();
	                    currentToken = Token(
	                        "CLOSE_ELEMENT",
	                        scopingElementName
	                    );
	                    break
	                }
	                case '<!--': {
	                    // skipComment contents
	                    const closingBuff = ['!', '-', '-'];
	                    while (
	                        hasNext() &&
	                        (closingBuff[2] !== '>' ||
	                            closingBuff[1] !== '-' ||
	                            closingBuff[0] !== '-')
	                    ) {
	                        closingBuff.shift();
	                        closingBuff.push(xmlAsString[pos]);
	                        pos++;
	                    }
	                    return next()
	                }
	                case '>': {
	                    currentToken = Token("CLOSE_BRACKET");
	                    break
	                }
	                case '<': {
	                    currentToken = Token("OPEN_BRACKET");
	                    break
	                }
	                default: {
	                    // here we fall if we have alphanumeric string, which can be related to attributes, content or nothing
	                    if (buffer && buffer.length > 0) {
	                        if (currentToken.type === "CLOSE_BRACKET") {
	                            let suffix = '';
	                            if (peek() !== '<') {
	                                suffix = readAlphaNumericChars(true);
	                            }
	                            currentToken = Token(
	                                "CONTENT",
	                                buffer + suffix
	                            );
	                        } else if (
	                            currentToken.type !== "ATTRIB_NAME" &&
	                            currentToken.type !== "CONTENT"
	                        ) {
	                            if (
	                                currentToken.type === "CLOSE_ELEMENT"
	                            ) {
	                                // we're assuming this is content, part of unstructured data
	                                buffer = ' '.repeat(numOfSpacesSkipped) + buffer;
	                                currentToken = Token("CONTENT", buffer);
	                            } else {
	                                // it should be an attribute name token
	                                currentToken = Token(
	                                    "ATTRIB_NAME",
	                                    buffer
	                                );
	                            }
	                        } else {
	                            const contentBuffer =
	                                ' '.repeat(numOfSpacesSkipped) + buffer; // spaces included as content
	                            currentToken = Token(
	                                "CONTENT",
	                                contentBuffer
	                            );
	                        }
	                        break
	                    } else {
	                        const errMsg =
	                            'Unknown Syntax : "' + xmlAsString[pos] + '"';
	                        throw new Error(errMsg)
	                    }
	                }
	            }
	        }

	        return currentToken
	    };

	    return {
	        peek,
	        next,
	        hasNext,
	        // prettier-ignore
	        ...({})
	    }
	}

	lexer = {
	    createLexer
	};
	return lexer;
}

var transpiler;
var hasRequiredTranspiler;

function requireTranspiler () {
	if (hasRequiredTranspiler) return transpiler;
	hasRequiredTranspiler = 1;

	const { TOKEN_TYPE } = requireConstants();
	const { createLexer } = requireLexer();
	const { Token } = requireModel();
	// AST Node types
	const [ROOT, ELEMENT, ATTRIBUTE, CONTENT] = [
	    'ROOT',
	    'ELEMENT',
	    'ATTRIBUTE',
	    'CONTENT'
	];

	const Node = (type, value) => ({
	    type,
	    value
	});

	const ContentNode = (value) => Node(CONTENT, value);

	const ElementNode = (type, attributes, children) => {
	    return Node(ELEMENT, {
	        type,
	        attributes,
	        children
	    })
	};

	const AttribNode = (name, value) => {
	    return Node(ATTRIBUTE, {
	        name,
	        value
	    })
	};

	const parseXML = (lexer) => {
	    /*
	    How does the grammar look?
	    | expr: StructuredXML | UnstructuredXML | Content
	    | StructuredXML: (openBracket + ElementName) + (AttributeList)* + closeBracket + (expr)* + closeElement
	    | UnstructuredXML: Content* + expr* + Content*
	    | Content: String
	    | openBracket: <
	    | closeBracket: >
	    | closeElement: </ + ElementName + closeBracket
	    | ElementName: String
	    | AttributeList: AttributeName + "=" + AttributeValue + AttributeList*
	    | AttributeName: String
	    | AttributeValue: String
	    */
	    const rootNode = Node(ROOT, {
	        children: parseExpr(lexer, Token(ROOT, 'ROOT'))
	    });
	    return rootNode
	};

	const parseExpr = (lexer, scopingElement) => {
	    const children = [];
	    while (lexer.hasNext()) {
	        const lexem = lexer.next();
	        switch (lexem.type) {
	            case "OPEN_BRACKET": {
	                const elementLexem = lexer.next();
	                const [elementAttributes, currentToken] =
	                    parseElementAttributes(lexer);
	                let elementChildren = [];
	                if (currentToken.type !== "CLOSE_ELEMENT") {
	                    elementChildren = parseExpr(lexer, elementLexem);
	                }
	                if (
	                    elementChildren &&
	                    elementChildren.length > 0 &&
	                    elementChildren[0].type === "CONTENT"
	                ) {
	                    elementChildren = reduceChildrenElements(elementChildren);
	                }
	                children.push(
	                    ElementNode(
	                        elementLexem.value,
	                        elementAttributes,
	                        elementChildren
	                    )
	                );
	                break
	            }
	            case "CLOSE_ELEMENT": {
	                if (lexem.value === scopingElement.value) return children
	                break
	            }
	            case "CONTENT": {
	                children.push(ContentNode(lexem.value));
	                break
	            }
	            case "EOF": {
	                return children
	            }
	            default: {
	                throw new Error(
	                    `Unknown Lexem type: ${lexem.type} "${lexem.value}, scoping element: ${scopingElement.value}"`
	                )
	            }
	        }
	    }
	    return children
	};

	const parseElementAttributes = (lexer) => {
	    const attribs = [];
	    let currentToken = lexer.peek();
	    if (
	        !lexer.hasNext() ||
	        (currentToken && currentToken.type === "CLOSE_BRACKET") ||
	        (currentToken && currentToken.type === "CLOSE_ELEMENT")
	    ) {
	        return [attribs, currentToken]
	    }
	    currentToken = lexer.next();
	    while (
	        lexer.hasNext() &&
	        currentToken &&
	        currentToken.type !== "CLOSE_BRACKET" &&
	        currentToken.type !== "CLOSE_ELEMENT"
	    ) {
	        const attribName = currentToken;
	        if (attribName.value === 'content') {
	            attribName.value = '@content';
	        }
	        lexer.next(); //assignment token
	        const attribValue = lexer.next();
	        const attributeNode = AttribNode(attribName.value, attribValue.value);
	        attribs.push(attributeNode);
	        currentToken = lexer.next();
	    }
	    return [attribs, currentToken]
	};

	function reduceChildrenElements(elementChildren) {
	    let reduced = [],
	        buffer = '';

	    elementChildren.forEach((child) => {
	        if (child.type === "CONTENT") {
	            buffer += child.value;
	        } else {
	            if (buffer.length) {
	                reduced.push(ContentNode(buffer));
	                buffer = '';
	            }
	            reduced.push(child);
	        }
	    });

	    if (buffer.length) reduced.push(ContentNode(buffer));

	    return reduced
	}

	function transpile(xmlAsString, astConverter) {
	    const lexer = createLexer(xmlAsString);
	    const ast = parseXML(lexer);
	    if (astConverter) {
	        return astConverter.convert(ast)
	    }
	    return ast
	}

	transpiler = {
	    AttribNode,
	    ContentNode,
	    ElementNode,
	    Node,
	    transpile
	};
	return transpiler;
}

var xmlToJson;
var hasRequiredXmlToJson;

function requireXmlToJson () {
	if (hasRequiredXmlToJson) return xmlToJson;
	hasRequiredXmlToJson = 1;

	const jsonConverter = requireAstToJson();
	const { transpile } = requireTranspiler();

	function convertXML(xmlAsString, customConverter) {
	    return transpile(xmlAsString, customConverter || jsonConverter)
	}

	function createAST(xmlAsString) {
	    return transpile(xmlAsString)
	}

	xmlToJson = {
	    convertXML,
	    createAST
	};
	return xmlToJson;
}

var xmlToJsonExports = requireXmlToJson();
var cjs = /*@__PURE__*/getDefaultExportFromCjs(xmlToJsonExports);

const convertXML = cjs.convertXML;
const createAST = cjs.createAST;

export { convertXML, createAST, cjs as default };
