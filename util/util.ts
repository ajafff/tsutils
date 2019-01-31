import * as ts from 'typescript';
import { NodeWrap } from './convert-ast';
import {
    isBlockLike, isLiteralExpression, isPropertyDeclaration, isJsDoc, isImportDeclaration, isTextualLiteral,
    isImportEqualsDeclaration, isModuleDeclaration, isCallExpression, isExportDeclaration, isLiteralTypeNode, isTypeReferenceNode,
} from '../typeguard/node';
import { isBigIntLiteral } from '../typeguard/3.2';

export function getChildOfKind<T extends ts.SyntaxKind>(node: ts.Node, kind: T, sourceFile?: ts.SourceFile) {
    for (const child of node.getChildren(sourceFile))
        if (child.kind === kind)
            return <ts.Token<T>>child;
}

export function isTokenKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstToken && kind <= ts.SyntaxKind.LastToken;
}

export function isNodeKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstNode;
}

export function isAssignmentKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export function isTypeNodeKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstTypeNode && kind <= ts.SyntaxKind.LastTypeNode;
}

export function isJsDocKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstJSDocNode && kind <= ts.SyntaxKind.LastJSDocNode;
}

export function isKeywordKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword;
}

export function isThisParameter(parameter: ts.ParameterDeclaration): boolean {
    return parameter.name.kind === ts.SyntaxKind.Identifier && parameter.name.originalKeywordKind === ts.SyntaxKind.ThisKeyword;
}

export function getModifier(node: ts.Node, kind: ts.Modifier['kind']): ts.Modifier | undefined {
    if (node.modifiers !== undefined)
        for (const modifier of node.modifiers)
            if (modifier.kind === kind)
                return modifier;
}

export function hasModifier(modifiers: ts.ModifiersArray | undefined, ...kinds: Array<ts.Modifier['kind']>) {
    if (modifiers === undefined)
        return false;
    for (const modifier of modifiers)
        if (kinds.includes(modifier.kind))
            return true;
    return false;
}

export function isParameterProperty(node: ts.ParameterDeclaration) {
    return hasModifier(node.modifiers,
                       ts.SyntaxKind.PublicKeyword,
                       ts.SyntaxKind.ProtectedKeyword,
                       ts.SyntaxKind.PrivateKeyword,
                       ts.SyntaxKind.ReadonlyKeyword);
}

export function hasAccessModifier(node: ts.ClassElement | ts.ParameterDeclaration) {
    return hasModifier(node.modifiers,
                       ts.SyntaxKind.PublicKeyword,
                       ts.SyntaxKind.ProtectedKeyword,
                       ts.SyntaxKind.PrivateKeyword);
}

function isFlagSet(obj: {flags: number}, flag: number) {
    return (obj.flags & flag) !== 0;
}

export const isNodeFlagSet: (node: ts.Node, flag: ts.NodeFlags) => boolean = isFlagSet;
export const isTypeFlagSet: (type: ts.Type, flag: ts.TypeFlags) => boolean = isFlagSet;
export const isSymbolFlagSet: (symbol: ts.Symbol, flag: ts.SymbolFlags) => boolean = isFlagSet;

export function isObjectFlagSet(objectType: ts.ObjectType, flag: ts.ObjectFlags) {
    return (objectType.objectFlags & flag) !== 0;
}

export function isModifierFlagSet(node: ts.Node, flag: ts.ModifierFlags) {
    return (ts.getCombinedModifierFlags(<ts.Declaration>node) & flag) !== 0;
}

export function getPreviousStatement(statement: ts.Statement): ts.Statement | undefined {
    const parent = statement.parent!;
    if (isBlockLike(parent)) {
        const index = parent.statements.indexOf(statement);
        if (index > 0)
            return parent.statements[index - 1];
    }
}

export function getNextStatement(statement: ts.Statement): ts.Statement | undefined {
    const parent = statement.parent!;
    if (isBlockLike(parent)) {
        const index = parent.statements.indexOf(statement);
        if (index < parent.statements.length)
            return parent.statements[index + 1];
    }
}

/** Returns the token before the start of `node` or `undefined` if there is none. */
export function getPreviousToken(node: ts.Node, sourceFile?: ts.SourceFile) {
    let parent = node.parent;
    while (parent !== undefined && parent.pos === node.pos)
        parent = parent.parent;
    if (parent === undefined)
        return;
    outer: while (true) {
        const children = parent.getChildren(sourceFile);
        for (let i = children.length - 1; i >= 0; --i) {
            const child = children[i];
            if (child.pos < node.pos && child.kind !== ts.SyntaxKind.JSDocComment) {
                if (isTokenKind(child.kind))
                    return child;
                // previous token is nested in another node
                parent = child;
                continue outer;
            }
        }
        return;
    }
}

/** Returns the next token that begins after the end of `node`. Returns `undefined` for SourceFile and EndOfFileToken */
export function getNextToken(node: ts.Node, sourceFile = node.getSourceFile()) {
    if (node.kind === ts.SyntaxKind.SourceFile || node.kind === ts.SyntaxKind.EndOfFileToken)
        return;
    const end = node.end;
    node = node.parent!;
    while (node.end === end) {
        if (node.parent === undefined)
            return (<ts.SourceFile>node).endOfFileToken;
        node = node.parent;
    }
    return getTokenAtPositionWorker(node, end, sourceFile, false);
}

/** Returns the token at or following the specified position or undefined if none is found inside `parent`. */
export function getTokenAtPosition(parent: ts.Node, pos: number, sourceFile?: ts.SourceFile, allowJsDoc?: boolean) {
    if (pos < parent.pos || pos >= parent.end)
        return;
    if (isTokenKind(parent.kind))
        return parent;
    if (sourceFile === undefined)
        sourceFile = parent.getSourceFile();
    return getTokenAtPositionWorker(parent, pos, sourceFile, allowJsDoc === true);
}

function getTokenAtPositionWorker(node: ts.Node, pos: number, sourceFile: ts.SourceFile, allowJsDoc: boolean) {
    outer: while (true) {
        for (const child of node.getChildren(sourceFile)) {
            if (child.end > pos && (allowJsDoc || child.kind !== ts.SyntaxKind.JSDocComment)) {
                if (isTokenKind(child.kind))
                    return child;
                // next token is nested in another node
                node = child;
                continue outer;
            }
        }
        return;
    }
}

/**
 * Return the comment at the specified position.
 * You can pass an optional `parent` to avoid some work finding the corresponding token starting at `sourceFile`.
 * If the `parent` parameter is passed, `pos` must be between `parent.pos` and `parent.end`.
*/
export function getCommentAtPosition(sourceFile: ts.SourceFile, pos: number, parent: ts.Node = sourceFile): ts.CommentRange | undefined {
    const token = getTokenAtPosition(parent, pos, sourceFile);
    if (token === undefined || token.kind === ts.SyntaxKind.JsxText || pos >= token.end - (ts.tokenToString(token.kind) || '').length)
        return;
    const startPos = token.pos === 0
        ? (ts.getShebang(sourceFile.text) || '').length
        : token.pos ;
    return  startPos !== 0 && ts.forEachTrailingCommentRange(sourceFile.text, startPos, commentAtPositionCallback, pos) ||
        ts.forEachLeadingCommentRange(sourceFile.text, startPos, commentAtPositionCallback, pos);
}

function commentAtPositionCallback(pos: number, end: number, kind: ts.CommentKind, _nl: boolean, at: number): ts.CommentRange | undefined {
    return at >= pos && at < end ? {pos, end, kind} : undefined;
}

/**
 * Returns whether the specified position is inside a comment.
 * You can pass an optional `parent` to avoid some work finding the corresponding token starting at `sourceFile`.
 * If the `parent` parameter is passed, `pos` must be between `parent.pos` and `parent.end`.
 */
export function isPositionInComment(sourceFile: ts.SourceFile, pos: number, parent?: ts.Node): boolean {
    return getCommentAtPosition(sourceFile, pos, parent) !== undefined;
}

export function commentText(sourceText: string, comment: ts.CommentRange): string {
    return sourceText.substring(comment.pos + 2, comment.kind === ts.SyntaxKind.SingleLineCommentTrivia ? comment.end : comment.end - 2);
}

/**
 * Returns the NodeWrap of deepest AST node that contains `pos` between its `pos` and `end`.
 * Only returns undefined if pos is outside of `wrap`
 */
export function getWrappedNodeAtPosition(wrap: NodeWrap, pos: number): NodeWrap | undefined {
    if (wrap.node.pos > pos || wrap.node.end <= pos)
        return;
    outer: while (true) {
        for (const child of wrap.children) {
            if (child.node.pos > pos)
                return wrap;
            if (child.node.end > pos) {
                wrap = child;
                continue outer;
            }
        }
        return wrap;
    }
}

export function getPropertyName(propertyName: ts.PropertyName): string | undefined {
    if (propertyName.kind === ts.SyntaxKind.ComputedPropertyName) {
        if (!isLiteralExpression(propertyName.expression))
            return;
        if (isBigIntLiteral(propertyName.expression))
            // handle BigInt, even though TypeScript doesn't allow BigInt as computed property name
            return propertyName.expression.text.slice(0, -1);
        return propertyName.expression.text;
    }
    return propertyName.text;
}

export function forEachDestructuringIdentifier<T>(
    pattern: ts.BindingPattern,
    fn: (element: ts.BindingElement & { name: ts.Identifier }) => T,
): T | undefined {
    for (const element of pattern.elements) {
        if (element.kind !== ts.SyntaxKind.BindingElement)
            continue;
        let result: T | undefined;
        if (element.name.kind === ts.SyntaxKind.Identifier) {
            result = fn(<ts.BindingElement & { name: ts.Identifier }>element);
        } else {
            result = forEachDestructuringIdentifier(element.name, fn);
        }
        if (result)
            return result;
    }
}

export function forEachDeclaredVariable<T>(
    declarationList: ts.VariableDeclarationList,
    cb: (element: (ts.VariableDeclaration | ts.BindingElement) & { name: ts.Identifier }) => T,
) {
    for (const declaration of declarationList.declarations) {
        let result: T | undefined;
        if (declaration.name.kind === ts.SyntaxKind.Identifier) {
            result = cb(<ts.VariableDeclaration & { name: ts.Identifier }>declaration);
        } else {
            result = forEachDestructuringIdentifier(declaration.name, cb);
        }
        if (result)
            return result;
    }
}

export const enum VariableDeclarationKind {
    Var,
    Let,
    Const,
}

export function getVariableDeclarationKind(declarationList: ts.VariableDeclarationList): VariableDeclarationKind {
    if (declarationList.flags & ts.NodeFlags.Let)
        return VariableDeclarationKind.Let;
    if (declarationList.flags & ts.NodeFlags.Const)
        return VariableDeclarationKind.Const;
    return VariableDeclarationKind.Var;
}

export function isBlockScopedVariableDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
    return (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
}

export function isBlockScopedVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
    const parent = declaration.parent!;
    return parent.kind === ts.SyntaxKind.CatchClause ||
        isBlockScopedVariableDeclarationList(parent);
}

export function isBlockScopedDeclarationStatement(statement: ts.Statement): statement is ts.DeclarationStatement {
    switch (statement.kind) {
        case ts.SyntaxKind.VariableStatement:
            return isBlockScopedVariableDeclarationList((<ts.VariableStatement>statement).declarationList);
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.EnumDeclaration:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
            return true;
        default:
            return false;
    }
}

export function isInSingleStatementContext(statement: ts.Statement): boolean {
    switch (statement.parent!.kind) {
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.WithStatement:
        case ts.SyntaxKind.LabeledStatement:
            return true;
        default:
            return false;
    }
}

export const enum ScopeBoundary {
    None = 0,
    Function = 1,
    Block = 2,
    Type = 4,
    ConditionalType = 8,
}
export const enum ScopeBoundarySelector {
    Function = ScopeBoundary.Function,
    Block = ScopeBoundarySelector.Function | ScopeBoundary.Block,
    Type = ScopeBoundarySelector.Block | ScopeBoundary.Type,
    InferType = ScopeBoundary.ConditionalType,
}

export function isScopeBoundary(node: ts.Node): ScopeBoundary {
    return isFunctionScopeBoundary(node) || isBlockScopeBoundary(node) || isTypeScopeBoundary(node);
}

export function isTypeScopeBoundary(node: ts.Node): ScopeBoundary {
    switch (node.kind) {
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.MappedType:
            return ScopeBoundary.Type;
        case ts.SyntaxKind.ConditionalType:
            return ScopeBoundary.ConditionalType;
        default:
            return ScopeBoundary.None;
    }
}

export function isFunctionScopeBoundary(node: ts.Node): ScopeBoundary {
    switch (node.kind) {
        case ts.SyntaxKind.FunctionExpression:
        case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.Constructor:
        case ts.SyntaxKind.ModuleDeclaration:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
        case ts.SyntaxKind.EnumDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.MethodSignature:
        case ts.SyntaxKind.CallSignature:
        case ts.SyntaxKind.ConstructSignature:
        case ts.SyntaxKind.ConstructorType:
        case ts.SyntaxKind.FunctionType:
            return ScopeBoundary.Function;
        case ts.SyntaxKind.SourceFile:
            // if SourceFile is no module, it contributes to the global scope and is therefore no scope boundary
            return ts.isExternalModule(<ts.SourceFile>node) ? ScopeBoundary.Function : ScopeBoundary.None;
        default:
            return ScopeBoundary.None;
    }
}

export function isBlockScopeBoundary(node: ts.Node): ScopeBoundary {
    switch (node.kind) {
        case ts.SyntaxKind.Block:
            const parent = node.parent!;
            return parent.kind !== ts.SyntaxKind.CatchClause &&
                   // blocks inside SourceFile are block scope boundaries
                   (parent.kind === ts.SyntaxKind.SourceFile ||
                    // blocks that are direct children of a function scope boundary are no scope boundary
                    // for example the FunctionBlock is part of the function scope of the containing function
                    !isFunctionScopeBoundary(parent))
                        ? ScopeBoundary.Block
                        : ScopeBoundary.None;
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.CaseBlock:
        case ts.SyntaxKind.CatchClause:
        case ts.SyntaxKind.WithStatement:
            return ScopeBoundary.Block;
        default:
            return ScopeBoundary.None;
    }
}

/** Returns true for scope boundaries that have their own `this` reference instead of inheriting it from the containing scope */
export function hasOwnThisReference(node: ts.Node): boolean {
    switch (node.kind) {
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
        case ts.SyntaxKind.FunctionExpression:
            return true;
        case ts.SyntaxKind.FunctionDeclaration:
            return (<ts.FunctionDeclaration>node).body !== undefined;
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
            return node.parent!.kind === ts.SyntaxKind.ObjectLiteralExpression;
        default:
            return false;
    }
}

export function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & {body: {}} {
    switch (node.kind) {
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.Constructor:
            return (<ts.FunctionLikeDeclaration>node).body !== undefined;
        case ts.SyntaxKind.FunctionExpression:
        case ts.SyntaxKind.ArrowFunction:
            return true;
        default:
            return false;
    }
}

/**
 * Iterate over all tokens of `node`
 *
 * @param node The node whose tokens should be visited
 * @param cb Is called for every token contained in `node`
 */
export function forEachToken(node: ts.Node, cb: (node: ts.Node) => void, sourceFile: ts.SourceFile = node.getSourceFile()) {
    return (function iterate(child): void {
        if (isTokenKind(child.kind))
            return cb(child); // tokens have no children -> no need to recurse deeper
        /* Exclude everything contained in JsDoc, it will be handled with the other trivia anyway.
         * When we would handle JsDoc tokens like regular ones, we would scan some trivia multiple times.
         * Even worse, we would scan for trivia inside the JsDoc comment, which yields unexpected results.*/
        if (child.kind !== ts.SyntaxKind.JSDocComment)
            return child.getChildren(sourceFile).forEach(iterate);
    })(node);
}

export type ForEachTokenCallback = (fullText: string, kind: ts.SyntaxKind, range: ts.TextRange, parent: ts.Node) => void;
/**
 * Iterate over all tokens and trivia of `node`
 *
 * @description JsDoc comments are treated like regular comments
 *
 * @param node The node whose tokens should be visited
 * @param cb Is called for every token contained in `node` and trivia before the token
 */
export function forEachTokenWithTrivia(node: ts.Node, cb: ForEachTokenCallback, sourceFile: ts.SourceFile = node.getSourceFile()) {
    const fullText = sourceFile.text;
    const scanner = ts.createScanner(sourceFile.languageVersion, false, sourceFile.languageVariant, fullText);
    return forEachToken(
        node,
        (token) => {
            const tokenStart = token.kind === ts.SyntaxKind.JsxText || token.pos === token.end ? token.pos : token.getStart(sourceFile);
            if (tokenStart !== token.pos) {
                // we only have to handle trivia before each token. whitespace at the end of the file is followed by EndOfFileToken
                scanner.setTextPos(token.pos);
                let kind = scanner.scan();
                let pos = scanner.getTokenPos();
                while (pos < tokenStart) {
                    const textPos = scanner.getTextPos();
                    cb(fullText, kind, {pos, end: textPos}, token.parent!);
                    if (textPos === tokenStart)
                        break;
                    kind = scanner.scan();
                    pos = scanner.getTokenPos();
                }
            }
            return cb(fullText, token.kind, {end: token.end, pos: tokenStart}, token.parent!);
        },
        sourceFile);
}

export type ForEachCommentCallback = (fullText: string, comment: ts.CommentRange) => void;

/** Iterate over all comments owned by `node` or its children */
export function forEachComment(node: ts.Node, cb: ForEachCommentCallback, sourceFile: ts.SourceFile = node.getSourceFile()) {
    /* Visit all tokens and skip trivia.
       Comment ranges between tokens are parsed without the need of a scanner.
       forEachTokenWithWhitespace does intentionally not pay attention to the correct comment ownership of nodes as it always
       scans all trivia before each token, which could include trailing comments of the previous token.
       Comment onwership is done right in this function*/
    const fullText = sourceFile.text;
    const notJsx = sourceFile.languageVariant !== ts.LanguageVariant.JSX;
    return forEachToken(
        node,
        (token) => {
            if (token.pos === token.end)
                return;
            if (token.kind !== ts.SyntaxKind.JsxText)
                ts.forEachLeadingCommentRange(
                    fullText,
                    // skip shebang at position 0
                    token.pos === 0 ? (ts.getShebang(fullText) || '').length : token.pos,
                    commentCallback,
                );
            if (notJsx || canHaveTrailingTrivia(token))
                return ts.forEachTrailingCommentRange(fullText, token.end, commentCallback);
        },
        sourceFile,
    );
    function commentCallback(pos: number, end: number, kind: ts.CommentKind) {
        cb(fullText, {pos, end, kind});
    }
}

/** Exclude trailing positions that would lead to scanning for trivia inside JsxText */
function canHaveTrailingTrivia(token: ts.Node): boolean {
    switch (token.kind) {
        case ts.SyntaxKind.CloseBraceToken:
            // after a JsxExpression inside a JsxElement's body can only be other JsxChild, but no trivia
            return token.parent!.kind !== ts.SyntaxKind.JsxExpression || !isJsxElementOrFragment(token.parent!.parent!);
        case ts.SyntaxKind.GreaterThanToken:
            switch (token.parent!.kind) {
                case ts.SyntaxKind.JsxOpeningElement:
                    // if end is not equal, this is part of the type arguments list. in all other cases it would be inside the element body
                    return token.end !== token.parent!.end;
                case ts.SyntaxKind.JsxOpeningFragment:
                    return false; // would be inside the fragment
                case ts.SyntaxKind.JsxSelfClosingElement:
                    return token.end !== token.parent!.end || // if end is not equal, this is part of the type arguments list
                        !isJsxElementOrFragment(token.parent!.parent!); // there's only trailing trivia if it's the end of the top element
                case ts.SyntaxKind.JsxClosingElement:
                case ts.SyntaxKind.JsxClosingFragment:
                    // there's only trailing trivia if it's the end of the top element
                    return !isJsxElementOrFragment(token.parent!.parent!.parent!);
            }
    }
    return true;
}

function isJsxElementOrFragment(node: ts.Node): node is ts.JsxElement | ts.JsxFragment {
    return node.kind === ts.SyntaxKind.JsxElement || node.kind === ts.SyntaxKind.JsxFragment;
}

export interface LineRange extends ts.TextRange {
    contentLength: number;
}

export function getLineRanges(sourceFile: ts.SourceFile): LineRange[] {
    const lineStarts = sourceFile.getLineStarts();
    const result: LineRange[] = [];
    const length = lineStarts.length;
    const sourceText = sourceFile.text;
    let pos = 0;
    for (let i = 1; i < length; ++i) {
        const end = lineStarts[i];
        let lineEnd = end;
        for (; lineEnd > pos; --lineEnd)
            if (!ts.isLineBreak(sourceText.charCodeAt(lineEnd - 1)))
                break;
        result.push({
            pos,
            end,
            contentLength: lineEnd - pos,
        });
        pos = end;
    }
    result.push({
        pos,
        end: sourceFile.end,
        contentLength: sourceFile.end - pos,
    });
    return result;
}

/** Get the line break style used in sourceFile. This function only looks at the first line break. If there is none, \n is assumed. */
export function getLineBreakStyle(sourceFile: ts.SourceFile) {
    const lineStarts = sourceFile.getLineStarts();
    return lineStarts.length === 1 || lineStarts[1] < 2 || sourceFile.text[lineStarts[1] - 2] !== '\r'
        ? '\n'
        : '\r\n';
}

let cachedScanner: ts.Scanner | undefined;
function scanToken(text: string) {
    if (cachedScanner === undefined) // cache scanner
        cachedScanner = ts.createScanner(ts.ScriptTarget.Latest, false);
    cachedScanner.setText(text);
    cachedScanner.scan();
    return cachedScanner;
}

export function isValidIdentifier(text: string): boolean {
    const scan = scanToken(text);
    return scan.isIdentifier() && scan.getTextPos() === text.length && scan.getTokenPos() === 0;
}

export function isValidPropertyAccess(text: string): boolean {
    if (text.length === 0 || !ts.isIdentifierStart(text.charCodeAt(0), ts.ScriptTarget.Latest))
        return false;
    for (let i = 1; i < text.length; ++i)
        if (!ts.isIdentifierPart(text.charCodeAt(i), ts.ScriptTarget.Latest))
            return false;
    return true;
}

export function isValidPropertyName(text: string) {
    if (isValidPropertyAccess(text))
        return true;
    const scan = scanToken(text);
    return scan.getTextPos() === text.length &&
        scan.getToken() === ts.SyntaxKind.NumericLiteral && scan.getTokenValue() === text; // ensure stringified number equals literal
}

export function isValidNumericLiteral(text: string): boolean {
    const scan = scanToken(text);
    return scan.getToken() === ts.SyntaxKind.NumericLiteral && scan.getTextPos() === text.length && scan.getTokenPos() === 0;
}

export function isValidJsxIdentifier(text: string): boolean {
    if (text.length === 0 || !ts.isIdentifierStart(text.charCodeAt(0), ts.ScriptTarget.Latest))
        return false;
    for (let i = 1; i < text.length; ++i)
        if (!ts.isIdentifierPart(text.charCodeAt(i), ts.ScriptTarget.Latest) && text[i] !== '-')
            return false;
    return true;
}

export function isSameLine(sourceFile: ts.SourceFile, pos1: number, pos2: number) {
    return ts.getLineAndCharacterOfPosition(sourceFile, pos1).line === ts.getLineAndCharacterOfPosition(sourceFile, pos2).line;
}

export const enum SideEffectOptions {
    None = 0,
    TaggedTemplate = 1,
    Constructor = 2,
    JsxElement = 4,
}

export function hasSideEffects(node: ts.Expression, options?: SideEffectOptions): boolean {
    switch (node.kind) {
        case ts.SyntaxKind.CallExpression:
        case ts.SyntaxKind.PostfixUnaryExpression:
        case ts.SyntaxKind.AwaitExpression:
        case ts.SyntaxKind.YieldExpression:
        case ts.SyntaxKind.DeleteExpression:
            return true;
        case ts.SyntaxKind.TypeAssertionExpression:
        case ts.SyntaxKind.AsExpression:
        case ts.SyntaxKind.ParenthesizedExpression:
        case ts.SyntaxKind.NonNullExpression:
        case ts.SyntaxKind.VoidExpression:
        case ts.SyntaxKind.TypeOfExpression:
        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.SpreadElement:
        case ts.SyntaxKind.PartiallyEmittedExpression:
            return hasSideEffects(
                (<ts.AssertionExpression | ts.ParenthesizedExpression | ts.NonNullExpression | ts.VoidExpression | ts.TypeOfExpression |
                  ts.PropertyAccessExpression | ts.SpreadElement | ts.PartiallyEmittedExpression>node).expression,
                options,
            );
        case ts.SyntaxKind.BinaryExpression:
            return isAssignmentKind((<ts.BinaryExpression>node).operatorToken.kind) ||
                hasSideEffects((<ts.BinaryExpression>node).left, options) ||
                hasSideEffects((<ts.BinaryExpression>node).right, options);
        case ts.SyntaxKind.PrefixUnaryExpression:
            switch ((<ts.PrefixUnaryExpression>node).operator) {
                case ts.SyntaxKind.PlusPlusToken:
                case ts.SyntaxKind.MinusMinusToken:
                    return true;
                default:
                    return hasSideEffects((<ts.PrefixUnaryExpression>node).operand, options);
            }
        case ts.SyntaxKind.ElementAccessExpression:
            return hasSideEffects((<ts.ElementAccessExpression>node).expression, options) ||
                // wotan-disable-next-line no-useless-predicate
                (<ts.ElementAccessExpression>node).argumentExpression !== undefined && // for compatibility with typescript@<2.9.0
                hasSideEffects((<ts.ElementAccessExpression>node).argumentExpression, options);
        case ts.SyntaxKind.ConditionalExpression:
            return hasSideEffects((<ts.ConditionalExpression>node).condition, options) ||
                hasSideEffects((<ts.ConditionalExpression>node).whenTrue, options) ||
                hasSideEffects((<ts.ConditionalExpression>node).whenFalse, options);
        case ts.SyntaxKind.NewExpression:
            if (options! & SideEffectOptions.Constructor || hasSideEffects((<ts.NewExpression>node).expression, options))
                return true;
            if ((<ts.NewExpression>node).arguments !== undefined)
                for (const child of (<ts.NewExpression>node).arguments!)
                    if (hasSideEffects(child, options))
                        return true;
            return false;
        case ts.SyntaxKind.TaggedTemplateExpression:
            if (options! & SideEffectOptions.TaggedTemplate || hasSideEffects((<ts.TaggedTemplateExpression>node).tag, options))
                return true;
            if ((<ts.TaggedTemplateExpression>node).template.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral)
                return false;
            node = (<ts.TaggedTemplateExpression>node).template;
            // falls through
        case ts.SyntaxKind.TemplateExpression:
            for (const child of (<ts.TemplateExpression>node).templateSpans)
                if (hasSideEffects(child.expression, options))
                    return true;
            return false;
        case ts.SyntaxKind.ClassExpression:
            return classExpressionHasSideEffects(<ts.ClassExpression>node, options);
        case ts.SyntaxKind.ArrayLiteralExpression:
            for (const child of (<ts.ArrayLiteralExpression>node).elements)
                if (hasSideEffects(child, options))
                    return true;
            return false;
        case ts.SyntaxKind.ObjectLiteralExpression:
            for (const child of (<ts.ObjectLiteralExpression>node).properties) {
                if (child.name !== undefined && child.name.kind === ts.SyntaxKind.ComputedPropertyName &&
                    hasSideEffects(child.name.expression, options))
                    return true;
                switch (child.kind) {
                    case ts.SyntaxKind.PropertyAssignment:
                        if (hasSideEffects(child.initializer, options))
                            return true;
                        break;
                    case ts.SyntaxKind.SpreadAssignment:
                        if (hasSideEffects(child.expression, options))
                            return true;
                }
            }
            return false;
        case ts.SyntaxKind.JsxExpression:
            return (<ts.JsxExpression>node).expression !== undefined && hasSideEffects((<ts.JsxExpression>node).expression!, options);
        case ts.SyntaxKind.JsxElement:
        case ts.SyntaxKind.JsxFragment:
            for (const child of (<ts.JsxElement | ts.JsxFragment>node).children)
                if (child.kind !== ts.SyntaxKind.JsxText && hasSideEffects(child, options))
                    return true;
            if (node.kind === ts.SyntaxKind.JsxFragment)
                return false;
            node = (<ts.JsxElement>node).openingElement;
            // falls through
        case ts.SyntaxKind.JsxSelfClosingElement:
        case ts.SyntaxKind.JsxOpeningElement:
            if (options! & SideEffectOptions.JsxElement)
                return true;
            for (const child of (<ts.JsxOpeningLikeElement>node).attributes.properties) {
                if (child.kind === ts.SyntaxKind.JsxSpreadAttribute) {
                    if (hasSideEffects(child.expression, options))
                        return true;
                } else if (child.initializer !== undefined && hasSideEffects(child.initializer, options)) {
                    return true;
                }
            }
            return false;
        case ts.SyntaxKind.CommaListExpression:
            for (const child of (<ts.CommaListExpression>node).elements)
                if (hasSideEffects(child, options))
                    return true;
            return false;
        default:
            return false;
    }
}

function classExpressionHasSideEffects(node: ts.ClassExpression, options?: SideEffectOptions): boolean {
    if (node.heritageClauses !== undefined && node.heritageClauses[0].token === ts.SyntaxKind.ExtendsKeyword)
        for (const base of node.heritageClauses[0].types)
            if (hasSideEffects(base.expression, options))
                return true;
    for (const child of node.members)
        if (child.name !== undefined && child.name.kind === ts.SyntaxKind.ComputedPropertyName &&
            hasSideEffects(child.name.expression, options) ||
            isPropertyDeclaration(child) && child.initializer !== undefined &&
            hasSideEffects(child.initializer, options))
            return true;
    return false;
}

/** Returns the VariableDeclaration or ParameterDeclaration that contains the BindingElement */
export function getDeclarationOfBindingElement(node: ts.BindingElement): ts.VariableDeclaration | ts.ParameterDeclaration {
    let parent = node.parent!.parent!;
    while (parent.kind === ts.SyntaxKind.BindingElement)
        parent = parent.parent!.parent!;
    return parent;
}

export function isExpressionValueUsed(node: ts.Expression): boolean {
    while (true) {
        const parent = node.parent!;
        switch (parent.kind) {
            case ts.SyntaxKind.CallExpression:
            case ts.SyntaxKind.NewExpression:
            case ts.SyntaxKind.ElementAccessExpression:
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.DoStatement:
            case ts.SyntaxKind.WithStatement:
            case ts.SyntaxKind.ThrowStatement:
            case ts.SyntaxKind.ReturnStatement:
            case ts.SyntaxKind.JsxExpression:
            case ts.SyntaxKind.JsxSpreadAttribute:
            case ts.SyntaxKind.JsxElement:
            case ts.SyntaxKind.JsxFragment:
            case ts.SyntaxKind.JsxSelfClosingElement:
            case ts.SyntaxKind.ComputedPropertyName:
            case ts.SyntaxKind.ArrowFunction:
            case ts.SyntaxKind.ExportSpecifier:
            case ts.SyntaxKind.ExportAssignment:
            case ts.SyntaxKind.ImportDeclaration:
            case ts.SyntaxKind.ExternalModuleReference:
            case ts.SyntaxKind.Decorator:
            case ts.SyntaxKind.TaggedTemplateExpression:
            case ts.SyntaxKind.TemplateSpan:
            case ts.SyntaxKind.ExpressionWithTypeArguments:
            case ts.SyntaxKind.TypeOfExpression:
            case ts.SyntaxKind.AwaitExpression:
            case ts.SyntaxKind.YieldExpression:
            case ts.SyntaxKind.LiteralType:
            case ts.SyntaxKind.JsxAttributes:
            case ts.SyntaxKind.JsxOpeningElement:
            case ts.SyntaxKind.JsxClosingElement:
            case ts.SyntaxKind.IfStatement:
            case ts.SyntaxKind.CaseClause:
            case ts.SyntaxKind.SwitchStatement:
                return true;
            case ts.SyntaxKind.PropertyAccessExpression:
                return (<ts.PropertyAccessExpression>parent).expression === node;
            case ts.SyntaxKind.QualifiedName:
                return (<ts.QualifiedName>parent).left === node;
            case ts.SyntaxKind.ShorthandPropertyAssignment:
                return (<ts.ShorthandPropertyAssignment>parent).objectAssignmentInitializer === node ||
                    !isInDestructuringAssignment(<ts.ShorthandPropertyAssignment>parent);
            case ts.SyntaxKind.PropertyAssignment:
                return (<ts.PropertyAssignment>parent).initializer === node && !isInDestructuringAssignment(<ts.PropertyAssignment>parent);
            case ts.SyntaxKind.SpreadAssignment:
            case ts.SyntaxKind.SpreadElement:
            case ts.SyntaxKind.ArrayLiteralExpression:
                return !isInDestructuringAssignment(<ts.SpreadAssignment | ts.SpreadElement | ts.ArrayLiteralExpression>parent);
            case ts.SyntaxKind.ParenthesizedExpression:
            case ts.SyntaxKind.AsExpression:
            case ts.SyntaxKind.TypeAssertionExpression:
            case ts.SyntaxKind.PostfixUnaryExpression:
            case ts.SyntaxKind.PrefixUnaryExpression:
            case ts.SyntaxKind.NonNullExpression:
                node = <ts.Expression>parent;
                break;
            case ts.SyntaxKind.ForStatement:
                return (<ts.ForStatement>parent).condition === node;
            case ts.SyntaxKind.ForInStatement:
            case ts.SyntaxKind.ForOfStatement:
                return (<ts.ForInStatement | ts.ForOfStatement>parent).expression === node;
            case ts.SyntaxKind.ConditionalExpression:
                if ((<ts.ConditionalExpression>parent).condition === node)
                    return true;
                node = <ts.Expression>parent;
                break;
            case ts.SyntaxKind.PropertyDeclaration:
            case ts.SyntaxKind.BindingElement:
            case ts.SyntaxKind.VariableDeclaration:
            case ts.SyntaxKind.Parameter:
            case ts.SyntaxKind.EnumMember:
                return (<ts.HasExpressionInitializer>parent).initializer === node;
            case ts.SyntaxKind.ImportEqualsDeclaration:
                return (<ts.ImportEqualsDeclaration>parent).moduleReference === node;
            case ts.SyntaxKind.CommaListExpression:
                if ((<ts.CommaListExpression>parent).elements[(<ts.CommaListExpression>parent).elements.length - 1] !== node)
                    return false;
                node = <ts.Expression>parent;
                break;
            case ts.SyntaxKind.BinaryExpression:
                if ((<ts.BinaryExpression>parent).right === node) {
                    if ((<ts.BinaryExpression>parent).operatorToken.kind === ts.SyntaxKind.CommaToken) {
                        node = <ts.Expression>parent;
                        break;
                    }
                    return true;
                }
                switch ((<ts.BinaryExpression>parent).operatorToken.kind) {
                    case ts.SyntaxKind.CommaToken:
                    case ts.SyntaxKind.EqualsToken:
                        return false;
                    case ts.SyntaxKind.EqualsEqualsEqualsToken:
                    case ts.SyntaxKind.EqualsEqualsToken:
                    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                    case ts.SyntaxKind.ExclamationEqualsToken:
                    case ts.SyntaxKind.InstanceOfKeyword:
                    case ts.SyntaxKind.PlusToken:
                    case ts.SyntaxKind.MinusToken:
                    case ts.SyntaxKind.AsteriskToken:
                    case ts.SyntaxKind.SlashToken:
                    case ts.SyntaxKind.PercentToken:
                    case ts.SyntaxKind.AsteriskAsteriskToken:
                    case ts.SyntaxKind.GreaterThanToken:
                    case ts.SyntaxKind.GreaterThanGreaterThanToken:
                    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
                    case ts.SyntaxKind.GreaterThanEqualsToken:
                    case ts.SyntaxKind.LessThanToken:
                    case ts.SyntaxKind.LessThanLessThanToken:
                    case ts.SyntaxKind.LessThanEqualsToken:
                    case ts.SyntaxKind.AmpersandToken:
                    case ts.SyntaxKind.BarToken:
                    case ts.SyntaxKind.CaretToken:
                    case ts.SyntaxKind.BarBarToken:
                    case ts.SyntaxKind.AmpersandAmpersandToken:
                    case ts.SyntaxKind.InKeyword:
                        return true;
                    default:
                        node = <ts.Expression>parent;
                }
                break;
            default:
                return false;
        }
    }
}

function isInDestructuringAssignment(
    node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | ts.SpreadAssignment | ts.SpreadElement |
          ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
): boolean {
    switch (node.kind) {
        case ts.SyntaxKind.ShorthandPropertyAssignment:
            if (node.objectAssignmentInitializer !== undefined)
                return true;
            // falls through
        case ts.SyntaxKind.PropertyAssignment:
        case ts.SyntaxKind.SpreadAssignment:
            node = <ts.ArrayLiteralExpression | ts.ObjectLiteralExpression>node.parent;
            break;
        case ts.SyntaxKind.SpreadElement:
            if (node.parent!.kind !== ts.SyntaxKind.ArrayLiteralExpression)
                return false;
            node = <ts.ArrayLiteralExpression>node.parent;
    }
    while (true) {
        switch (node.parent!.kind) {
            case ts.SyntaxKind.BinaryExpression:
                return (<ts.BinaryExpression>node.parent).left === node &&
                    (<ts.BinaryExpression>node.parent).operatorToken.kind === ts.SyntaxKind.EqualsToken;
            case ts.SyntaxKind.ForOfStatement:
                return (<ts.ForOfStatement>node.parent).initializer === node;
            case ts.SyntaxKind.ArrayLiteralExpression:
            case ts.SyntaxKind.ObjectLiteralExpression:
                node = <ts.ArrayLiteralExpression | ts.ObjectLiteralExpression>node.parent;
                break;
            case ts.SyntaxKind.SpreadAssignment:
            case ts.SyntaxKind.PropertyAssignment:
                node = <ts.ObjectLiteralExpression>node.parent!.parent;
                break;
            case ts.SyntaxKind.SpreadElement:
                if (node.parent!.parent!.kind !== ts.SyntaxKind.ArrayLiteralExpression)
                    return false;
                node = <ts.ArrayLiteralExpression>node.parent!.parent;
                break;
            default:
                return false;
        }
    }
}

export function isReassignmentTarget(node: ts.Expression): boolean {
    const parent = node.parent!;
    switch (parent.kind) {
        case ts.SyntaxKind.PostfixUnaryExpression:
        case ts.SyntaxKind.DeleteExpression:
            return true;
        case ts.SyntaxKind.PrefixUnaryExpression:
            return (<ts.PrefixUnaryExpression>parent).operator === ts.SyntaxKind.PlusPlusToken ||
                (<ts.PrefixUnaryExpression>parent).operator === ts.SyntaxKind.MinusMinusToken;
        case ts.SyntaxKind.BinaryExpression:
            return (<ts.BinaryExpression>parent).left === node &&
                isAssignmentKind((<ts.BinaryExpression>parent).operatorToken.kind);
        case ts.SyntaxKind.ShorthandPropertyAssignment:
            return (<ts.ShorthandPropertyAssignment>parent).name === node &&
                isInDestructuringAssignment(<ts.ShorthandPropertyAssignment>parent);
        case ts.SyntaxKind.PropertyAssignment:
            return (<ts.PropertyAssignment>parent).initializer === node &&
                isInDestructuringAssignment(<ts.PropertyAssignment>parent);
        case ts.SyntaxKind.ArrayLiteralExpression:
        case ts.SyntaxKind.SpreadElement:
        case ts.SyntaxKind.SpreadAssignment:
            return isInDestructuringAssignment(<ts.SpreadElement | ts.SpreadAssignment | ts.ArrayLiteralExpression>parent);
        case ts.SyntaxKind.ParenthesizedExpression:
        case ts.SyntaxKind.NonNullExpression:
        case ts.SyntaxKind.TypeAssertionExpression:
        case ts.SyntaxKind.AsExpression:
            // (<number>foo! as {})++
            return isReassignmentTarget(<ts.Expression>parent); // this assertion is not correct, but necessary to keep the API sane
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.ForInStatement:
            return (<ts.ForOfStatement | ts.ForInStatement>parent).initializer === node;
    }
    return false;
}

export function canHaveJsDoc(node: ts.Node): node is ts.HasJSDoc {
    const kind = (<ts.HasJSDoc>node).kind;
    switch (kind) {
        case ts.SyntaxKind.Parameter:
        case ts.SyntaxKind.CallSignature:
        case ts.SyntaxKind.ConstructSignature:
        case ts.SyntaxKind.MethodSignature:
        case ts.SyntaxKind.PropertySignature:
        case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.ParenthesizedExpression:
        case ts.SyntaxKind.SpreadAssignment:
        case ts.SyntaxKind.ShorthandPropertyAssignment:
        case ts.SyntaxKind.PropertyAssignment:
        case ts.SyntaxKind.FunctionExpression:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.LabeledStatement:
        case ts.SyntaxKind.ExpressionStatement:
        case ts.SyntaxKind.VariableStatement:
        case ts.SyntaxKind.Constructor:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.EnumMember:
        case ts.SyntaxKind.EnumDeclaration:
        case ts.SyntaxKind.ModuleDeclaration:
        case ts.SyntaxKind.ImportEqualsDeclaration:
        case ts.SyntaxKind.IndexSignature:
        case ts.SyntaxKind.FunctionType:
        case ts.SyntaxKind.ConstructorType:
        case ts.SyntaxKind.JSDocFunctionType:
        case ts.SyntaxKind.EndOfFileToken:
        case ts.SyntaxKind.ExportDeclaration:
            return true;
        default:
            return <AssertNever<typeof kind>>false;
    }
}

type AssertNever<T extends never> = T;

/** Gets the JSDoc of any node. For performance reasons this function should only be called when `canHaveJsDoc` return true. */
export function getJsDoc(node: ts.Node, sourceFile?: ts.SourceFile): ts.JSDoc[] {
    if (node.kind === ts.SyntaxKind.EndOfFileToken)
        return parseJsDocWorker(node, sourceFile || <ts.SourceFile>node.parent);
    const result = [];
    for (const child of node.getChildren(sourceFile)) {
        if (!isJsDoc(child))
            break;
        result.push(child);
    }

    return result;
}

/**
 * Parses the JsDoc of any node. This function is made for nodes that don't get their JsDoc parsed by the TypeScript parser.
 *
 * @param considerTrailingComments When set to `true` this function uses the trailing comments if the node starts on the same line
 *                                 as the previous node ends.
 */
export function parseJsDocOfNode(node: ts.Node, considerTrailingComments?: boolean, sourceFile = node.getSourceFile()): ts.JSDoc[] {
    if (canHaveJsDoc(node) && node.kind !== ts.SyntaxKind.EndOfFileToken) {
        const result = getJsDoc(node, sourceFile);
        if (result.length !== 0 || !considerTrailingComments)
            return result;
    }
    return parseJsDocWorker(node, sourceFile, considerTrailingComments);
}

function parseJsDocWorker(node: ts.Node, sourceFile: ts.SourceFile, considerTrailingComments?: boolean) {
    const nodeStart = node.getStart(sourceFile);
    const start = ts[
        considerTrailingComments && isSameLine(sourceFile, node.pos, nodeStart)
            ? 'forEachTrailingCommentRange'
            : 'forEachLeadingCommentRange'
    ](
        sourceFile.text,
        node.pos,
        // return object to make `0` a truthy value
        (pos, _end, kind) => kind === ts.SyntaxKind.MultiLineCommentTrivia && sourceFile.text[pos + 2] === '*' ? {pos} : undefined,
    );
    if (start === undefined)
        return [];
    const startPos = start.pos;
    const text = sourceFile.text.slice(startPos, nodeStart);
    const newSourceFile = ts.createSourceFile('jsdoc.ts', `${text}var a;`, sourceFile.languageVersion);
    const result = getJsDoc(newSourceFile.statements[0], newSourceFile);
    for (const doc of result)
        updateNode(doc, node);
    return result;

    function updateNode(n: ts.Node, parent: ts.Node): void {
        n.pos += startPos;
        n.end += startPos;
        n.parent = parent;
        return ts.forEachChild(
            n,
            (child) => updateNode(child, n),
            (children) => {
                children.pos += startPos;
                children.end += startPos;
                for (const child of children)
                    updateNode(child, n);
            },
        );
    }
}

export const enum ImportKind {
    ImportDeclaration = 1,
    ImportEquals = 2,
    ExportFrom = 4,
    DynamicImport = 8,
    Require = 16,
    ImportType = 32,
    All = ImportDeclaration | ImportEquals | ExportFrom | DynamicImport | Require | ImportType,
    AllImports = ImportDeclaration | ImportEquals | DynamicImport | Require | ImportType,
    AllStaticImports = ImportDeclaration | ImportEquals,
    AllImportExpressions = DynamicImport | Require,
    AllRequireLike = ImportEquals | Require,
    // @internal
    AllNestedImports = AllImportExpressions | ImportType,
    // @internal
    AllTopLevelImports = AllStaticImports | ExportFrom,
}

export function findImports(sourceFile: ts.SourceFile, kinds: ImportKind) {
    const result: Array<ts.StringLiteral | ts.NoSubstitutionTemplateLiteral> = [];
    for (const node of findImportLikeNodes(sourceFile, kinds)) {
        switch (node.kind) {
            case ts.SyntaxKind.ImportDeclaration:
                addIfTextualLiteral(node.moduleSpecifier);
                break;
            case ts.SyntaxKind.ImportEqualsDeclaration:
                addIfTextualLiteral(node.moduleReference.expression);
                break;
            case ts.SyntaxKind.ExportDeclaration:
                addIfTextualLiteral(node.moduleSpecifier);
                break;
            case ts.SyntaxKind.CallExpression:
                addIfTextualLiteral(node.arguments[0]);
                break;
            case ts.SyntaxKind.ImportType:
                if (isLiteralTypeNode(node.argument))
                    addIfTextualLiteral(node.argument.literal);
                break;
            default:
                throw <AssertNever<typeof node>>new Error('unexpected node');
        }
    }
    return result;

    function addIfTextualLiteral(node: ts.Expression) {
        if (isTextualLiteral(node))
            result.push(node);
    }
}

export type ImportLike =
    | ts.ImportDeclaration
    | ts.ImportEqualsDeclaration & {moduleReference: ts.ExternalModuleReference}
    | ts.ExportDeclaration & {moduleSpecifier: {}}
    | ts.CallExpression
        & {expression: ts.Token<ts.SyntaxKind.ImportKeyword> | ts.Identifier & {text: 'require'}, arguments: [ts.Expression]}
    | ts.ImportTypeNode;
export function findImportLikeNodes(sourceFile: ts.SourceFile, kinds: ImportKind): ImportLike[] {
    return new ImportFinder(sourceFile, kinds).find();
}

class ImportFinder {
    constructor(private _sourceFile: ts.SourceFile, private _options: ImportKind) {}

    private _result: ImportLike[] = [];

    public find() {
        if (this._sourceFile.isDeclarationFile)
            this._options &= ~ImportKind.AllImportExpressions;
        if (this._options & ImportKind.AllTopLevelImports)
            this._findImports(this._sourceFile.statements);
        if (this._options & ImportKind.AllNestedImports)
            this._findNestedImports();
        return this._result;
    }

    private _findImports(statements: ReadonlyArray<ts.Statement>) {
        for (const statement of statements) {
            if (isImportDeclaration(statement)) {
                if (this._options & ImportKind.ImportDeclaration)
                    this._result.push(statement);
            } else if (isImportEqualsDeclaration(statement)) {
                if (this._options & ImportKind.ImportEquals &&
                    statement.moduleReference.kind === ts.SyntaxKind.ExternalModuleReference)
                    this._result.push(<any>statement);
            } else if (isExportDeclaration(statement)) {
                if (statement.moduleSpecifier !== undefined && this._options & ImportKind.ExportFrom)
                    this._result.push(<any>statement);
            } else if (isModuleDeclaration(statement) && statement.body !== undefined) {
                this._findImports((<ts.ModuleBlock>statement.body).statements);
            }
        }
    }

    private _findNestedImports() {
        let re;
        if ((this._options & ImportKind.AllNestedImports) === ImportKind.Require) {
            re = /\brequire\s*[</(]/g;
        } else if (this._options & ImportKind.Require) {
            re = /\b(?:import|require)\s*[</(]/g;
        } else {
            re = /\bimport\s*[</(]/g;
        }
        const isJavaScriptFile = (this._sourceFile.flags & ts.NodeFlags.JavaScriptFile) !== 0;
        for (let match = re.exec(this._sourceFile.text); match !== null; match = re.exec(this._sourceFile.text)) {
            const token = getTokenAtPositionWorker(
                this._sourceFile,
                match.index,
                this._sourceFile,
                // only look for ImportTypeNode within JSDoc in JS files
                match[0][0] === 'i' && isJavaScriptFile,
            )!;
            if (token.kind === ts.SyntaxKind.ImportKeyword) {
                if (token.end - 'import'.length !== match.index)
                    continue;
                switch (token.parent!.kind) {
                    case ts.SyntaxKind.ImportType:
                        this._result.push(<ts.ImportTypeNode>token.parent);
                        break;
                    case ts.SyntaxKind.CallExpression:
                        if ((<ts.CallExpression>token.parent).arguments.length === 1)
                            this._result.push(<any>token.parent);
                }
            } else if (
                token.kind === ts.SyntaxKind.Identifier &&
                token.end - 'require'.length === match.index &&
                token.parent!.kind === ts.SyntaxKind.CallExpression &&
                (<ts.CallExpression>token.parent).expression === token &&
                (<ts.CallExpression>token.parent).arguments.length === 1
            ) {
                this._result.push(<any>token.parent);
            }
        }
    }
}

/**
 * Ambient context means the statement itself has the `declare` keyword
 * or is inside a `declare namespace`,  `delcare module` or `declare global`.
 */
export function isStatementInAmbientContext(node: ts.Statement): boolean {
    while (node.flags & ts.NodeFlags.NestedNamespace)
        node = <ts.NamespaceDeclaration>node.parent;
    return hasModifier(node.modifiers, ts.SyntaxKind.DeclareKeyword) || isAmbientModuleBlock(node.parent!);
}

/** Includes `declare namespace`, `declare module` and `declare global` and namespace nested in one of the aforementioned. */
export function isAmbientModuleBlock(node: ts.Node): node is ts.ModuleBlock {
    while (node.kind === ts.SyntaxKind.ModuleBlock) {
        do
            node = node.parent!;
        while (node.flags & ts.NodeFlags.NestedNamespace);
        if (hasModifier(node.modifiers, ts.SyntaxKind.DeclareKeyword))
            return true;
        node = node.parent!;
    }
    return false;
}

export function getIIFE(func: ts.FunctionExpression | ts.ArrowFunction): ts.CallExpression | undefined {
    let node = func.parent!;
    while (node.kind === ts.SyntaxKind.ParenthesizedExpression)
        node = node.parent!;
    return isCallExpression(node) && func.end <= node.expression.end ? node : undefined;
}

export type StrictCompilerOption =
    | 'noImplicitAny'
    | 'noImplicitThis'
    | 'strictNullChecks'
    | 'strictFunctionTypes'
    | 'strictPropertyInitialization'
    | 'alwaysStrict'
    | 'strictBindCallApply';

export function isStrictCompilerOptionEnabled(options: ts.CompilerOptions, option: StrictCompilerOption): boolean {
    return (options.strict ? options[option] !== false : options[option] === true) &&
        (option !== 'strictPropertyInitialization' || isStrictCompilerOptionEnabled(options, 'strictNullChecks'));
}

export type BooleanCompilerOptions = {
    [K in keyof ts.CompilerOptions]: NonNullable<ts.CompilerOptions[K]> extends boolean ? K : never
} extends {[_ in keyof ts.CompilerOptions]: infer U} ? U : never; // tslint:disable-line no-unused
// https://github.com/ajafff/tslint-consistent-codestyle/issues/85

/**
 * Checks if a given compiler option is enabled.
 * It handles dependencies of options, e.g. `declaration` is implicitly enabled by `composite` or `strictNullChecks` is enabled by `strict`.
 * However, it does not check dependencies that are already checked and reported as errors, e.g. `checkJs` without `allowJs`.
 * This function only handles boolean flags.
 */
export function isCompilerOptionEnabled(options: ts.CompilerOptions, option: BooleanCompilerOptions | 'stripInternal'): boolean {
    switch (option) {
        case 'stripInternal':
            return options.stripInternal === true && isCompilerOptionEnabled(options, 'declaration');
        case 'declaration':
            return options.declaration || isCompilerOptionEnabled(options, 'composite');
        case 'skipDefaultLibCheck':
            return options.skipDefaultLibCheck || isCompilerOptionEnabled(options, 'skipLibCheck');
        case 'suppressImplicitAnyIndexErrors':
            return options.suppressImplicitAnyIndexErrors === true && isCompilerOptionEnabled(options, 'noImplicitAny');
        case 'allowSyntheticDefaultImports':
            return options.allowSyntheticDefaultImports !== undefined
                ? options.allowSyntheticDefaultImports
                : isCompilerOptionEnabled(options, 'esModuleInterop') || options.module === ts.ModuleKind.System;
        case 'noImplicitAny':
        case 'noImplicitThis':
        case 'strictNullChecks':
        case 'strictFunctionTypes':
        case 'strictPropertyInitialization':
        case 'alwaysStrict':
        case 'strictBindCallApply':
            type AssertEqual<T, U extends T> = U; // make sure all strict options are handled here
            return isStrictCompilerOptionEnabled(options, <AssertEqual<typeof option, StrictCompilerOption>>option);
    }
    return options[option] === true;
}

/**
 * Has nothing to do with `isAmbientModuleBlock`.
 *
 * @returns `true` if it's a global augmentation or has a string name.
 */
export function isAmbientModule(node: ts.ModuleDeclaration): boolean {
    return node.name.kind === ts.SyntaxKind.StringLiteral || (node.flags & ts.NodeFlags.GlobalAugmentation) !== 0;
}

/** @returns the last `// @ts-check` or `// @ts-nocheck` directive in the given file. */
export function getCheckJsDirective(source: string) {
    let directive: ts.CheckJsDirective | undefined;
    // needs to work around a shebang issue until https://github.com/Microsoft/TypeScript/issues/28477 is resolved
    ts.forEachLeadingCommentRange(source, (ts.getShebang(source) || '').length, (pos, end, kind) => {
        if (kind === ts.SyntaxKind.SingleLineCommentTrivia) {
            const text = source.slice(pos, end);
            const match = /^\/{2,3}\s*@ts-(no)?check(?:\s|$)/i.exec(text);
            if (match !== null)
                directive = {pos, end, enabled: match[1] === undefined};
        }
    });
    return directive;
}

export function isConstAssertion(node: ts.AssertionExpression) {
    return isTypeReferenceNode(node.type) &&
        node.type.typeName.kind === ts.SyntaxKind.Identifier &&
        node.type.typeName.escapedText === 'const';
}
