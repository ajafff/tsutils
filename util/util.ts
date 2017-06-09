import * as ts from 'typescript';
import { isBlockLike, isIfStatement, isLiteralExpression, isSwitchStatement, isPropertyDeclaration } from '../typeguard/node';

export function getChildOfKind(node: ts.Node, kind: ts.SyntaxKind, sourceFile?: ts.SourceFile) {
    for (const child of node.getChildren(sourceFile))
        if (child.kind === kind)
            return child;
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

export function isThisParameter(parameter: ts.ParameterDeclaration): boolean {
    return parameter.name.kind === ts.SyntaxKind.Identifier && parameter.name.originalKeywordKind === ts.SyntaxKind.ThisKeyword;
}

export function hasModifier(modifiers: ts.Modifier[] | undefined, ...kinds: Array<ts.Modifier['kind']>) {
    if (modifiers === undefined)
        return false;
    for (const modifier of modifiers)
        if (kinds.indexOf(modifier.kind) !== -1)
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
    return (ts.getCombinedModifierFlags(node) & flag) !== 0;
}

/**
 * @deprecated Use isModifierFlagSet.
 */
export function isModfierFlagSet(node: ts.Node, flag: ts.ModifierFlags) {
    return isModifierFlagSet(node, flag);
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
    return getTokenAtPositionWorker(node, end, sourceFile);
}

/** Returns the token at or following the specified position or undefined if none is found inside `parent`. */
export function getTokenAtPosition(parent: ts.Node, pos: number, sourceFile?: ts.SourceFile) {
    if (pos < parent.pos || pos >= parent.end)
        return;
    if (isTokenKind(parent.kind))
        return parent;
    if (sourceFile === undefined)
        sourceFile = parent.getSourceFile();
    return getTokenAtPositionWorker(parent, pos, sourceFile);
}

function getTokenAtPositionWorker(node: ts.Node, pos: number, sourceFile: ts.SourceFile) {
    outer: while (true) {
        for (const child of node.getChildren(sourceFile)) {
            if (child.end > pos && child.kind !== ts.SyntaxKind.JSDocComment) {
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
    const cb = (start: number, end: number, kind: ts.CommentKind): ts.CommentRange | undefined =>
        pos >= start && pos < end ? {end, kind, pos: start} : undefined;
    return  token.pos !== 0 && ts.forEachTrailingCommentRange(sourceFile.text, token.pos, cb) ||
        ts.forEachLeadingCommentRange(sourceFile.text, token.pos, cb);
}

/**
 * Returns whether the specified position is inside a comment.
 * You can pass an optional `parent` to avoid some work finding the corresponding token starting at `sourceFile`.
 * If the `parent` parameter is passed, `pos` must be between `parent.pos` and `parent.end`.
 */
export function isPositionInComment(sourceFile: ts.SourceFile, pos: number, parent?: ts.Node): boolean {
    return getCommentAtPosition(sourceFile, pos, parent) !== undefined;
}

export function getPropertyName(propertyName: ts.PropertyName): string | undefined {
    if (propertyName.kind === ts.SyntaxKind.ComputedPropertyName) {
        if (!isLiteralExpression(propertyName.expression))
            return;
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
    cb: (element: ts.VariableLikeDeclaration & { name: ts.Identifier }) => T,
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

export const enum ScopeBoundary {
    None,
    Function,
    Block,
}
export function isScopeBoundary(node: ts.Node): ScopeBoundary {
    if (isFunctionScopeBoundary(node))
        return ScopeBoundary.Function;
    if (isBlockScopeBoundary(node))
        return ScopeBoundary.Block;
    return ScopeBoundary.None;
}

export function isFunctionScopeBoundary(node: ts.Node): boolean {
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
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.MethodSignature:
        case ts.SyntaxKind.CallSignature:
        case ts.SyntaxKind.ConstructSignature:
        case ts.SyntaxKind.ConstructorType:
        case ts.SyntaxKind.FunctionType:
        case ts.SyntaxKind.MappedType:
            return true;
        case ts.SyntaxKind.SourceFile:
            // if SourceFile is no module, it contributes to the global scope and is therefore no scope boundary
            return ts.isExternalModule(<ts.SourceFile>node);
        default:
            return false;
    }
}

export function isBlockScopeBoundary(node: ts.Node): boolean {
    switch (node.kind) {
        case ts.SyntaxKind.Block:
            const parent = node.parent!;
            return parent.kind !== ts.SyntaxKind.CatchClause &&
                   // blocks inside SourceFile are block scope boundaries
                   (parent.kind === ts.SyntaxKind.SourceFile ||
                    // blocks that are direct children of a function scope boundary are no scope boundary
                    // for example the FunctionBlock is part of the function scope of the containing function
                    !isFunctionScopeBoundary(parent));
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.CaseBlock:
        case ts.SyntaxKind.CatchClause:
            return true;
        default:
            return false;
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
            return (<ts.FunctionLikeDeclaration>node).body !== undefined;
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
            return node.parent!.kind === ts.SyntaxKind.ObjectLiteralExpression;
        default:
            return false;
    }
}

export function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration {
    switch (node.kind) {
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
            return (<ts.FunctionLikeDeclaration>node).body !== undefined;
        case ts.SyntaxKind.FunctionExpression:
        case ts.SyntaxKind.Constructor:
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
    return (function iterate(child: ts.Node): void {
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
    const notJsx = sourceFile.languageVariant !== ts.LanguageVariant.JSX;
    const scanner = ts.createScanner(sourceFile.languageVersion, false, sourceFile.languageVariant, fullText);
    return forEachToken(
        node,
        (token: ts.Node) => {
            const tokenStart = token.getStart(sourceFile);
            const end = token.end;
            if (tokenStart !== token.pos && (notJsx || canHaveLeadingTrivia(token))) {
                // we only have to handle trivia before each token. whitespace at the end of the file is followed by EndOfFileToken
                scanner.setTextPos(token.pos);
                let position: number;
                // we only get here if token.getFullStart() !== token.getStart(), so we can scan at least one time
                do {
                    const kind = scanner.scan();
                    position = scanner.getTextPos();
                    cb(fullText, kind, {pos: scanner.getTokenPos(), end: position}, token.parent!);
                } while (position < tokenStart);
            }
            return cb(fullText, token.kind, {end, pos: tokenStart}, token.parent!);
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
            if (notJsx || canHaveLeadingTrivia(token))
                ts.forEachLeadingCommentRange(fullText, token.pos, commentCallback);
            if (notJsx || canHaveTrailingTrivia(token))
                return ts.forEachTrailingCommentRange(fullText, token.end, commentCallback);
        },
        sourceFile);
    function commentCallback(pos: number, end: number, kind: ts.CommentKind) {
        cb(fullText, {pos, end, kind});
    }
}

/** Exclude leading positions that would lead to scanning for trivia inside JsxText */
function canHaveLeadingTrivia({kind, parent}: ts.Node): boolean {
    if (kind === ts.SyntaxKind.OpenBraceToken)
        // before a JsxExpression inside a JsxElement's body can only be other JsxChild, but no trivia
        return parent!.kind !== ts.SyntaxKind.JsxExpression || parent!.parent!.kind !== ts.SyntaxKind.JsxElement;
    if (kind === ts.SyntaxKind.LessThanToken) {
        if (parent!.kind === ts.SyntaxKind.JsxClosingElement)
            return false; // would be inside the element body
        if (parent!.kind === ts.SyntaxKind.JsxOpeningElement || parent!.kind === ts.SyntaxKind.JsxSelfClosingElement)
            // there can only be leading trivia if we are at the end of the top level element
            return parent!.parent!.parent!.kind !== ts.SyntaxKind.JsxElement;
    }
    return kind !== ts.SyntaxKind.JsxText; // there is no trivia before JsxText
}

/** Exclude trailing positions that would lead to scanning for trivia inside JsxText */
function canHaveTrailingTrivia({kind, parent}: ts.Node): boolean {
    if (kind === ts.SyntaxKind.CloseBraceToken)
        // after a JsxExpression inside a JsxElement's body can only be other JsxChild, but no trivia
        return parent!.kind !== ts.SyntaxKind.JsxExpression || parent!.parent!.kind !== ts.SyntaxKind.JsxElement;
    if (kind === ts.SyntaxKind.GreaterThanToken) {
        if (parent!.kind === ts.SyntaxKind.JsxOpeningElement)
            return false; // would be inside the element
        if (parent!.kind === ts.SyntaxKind.JsxClosingElement || parent!.kind === ts.SyntaxKind.JsxSelfClosingElement)
            // there can only be trailing trivia if we are at the end of the top level element
            return parent!.parent!.parent!.kind !== ts.SyntaxKind.JsxElement;
    }
    return kind !== ts.SyntaxKind.JsxText; // there is no trivia after JsxText
}

export function endsControlFlow(statement: ts.Statement | ts.BlockLike): boolean {
    return getControlFlowEnd(statement) !== StatementType.None;
}

const enum StatementType {
    None,
    Break,
    Other,
}

function getControlFlowEnd(statement: ts.Statement | ts.BlockLike): StatementType {
    // recurse into nested blocks
    while (isBlockLike(statement)) {
        if (statement.statements.length === 0)
            return StatementType.None;

        statement = statement.statements[statement.statements.length - 1];
    }

    return hasReturnBreakContinueThrow(<ts.Statement>statement);
}

function hasReturnBreakContinueThrow(statement: ts.Statement): StatementType {
    switch (statement.kind) {
        case ts.SyntaxKind.ReturnStatement:
        case ts.SyntaxKind.ContinueStatement:
        case ts.SyntaxKind.ThrowStatement:
            return StatementType.Other;
        case ts.SyntaxKind.BreakStatement:
            return StatementType.Break;
    }

    if (isIfStatement(statement)) {
        if (statement.elseStatement === undefined)
            return StatementType.None;
        const then = getControlFlowEnd(statement.thenStatement);
        if (!then)
            return then;
        return Math.min(
            then,
            getControlFlowEnd(statement.elseStatement),
        );
    }

    if (isSwitchStatement(statement)) {
        let hasDefault = false;
        let type = StatementType.None;
        for (const clause of statement.caseBlock.clauses) {
            type = getControlFlowEnd(clause);
            if (type === StatementType.Break)
                return StatementType.None;
            if (clause.kind === ts.SyntaxKind.DefaultClause)
                hasDefault = true;
        }
        return hasDefault && type !== StatementType.None /* check if last clause falls through*/ ? StatementType.Other : StatementType.None;
    }
    return StatementType.None;
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

let scanner: ts.Scanner | undefined;
function scanToken(text: string) {
    if (scanner === undefined) // cache scanner
        scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
    scanner.setText(text);
    scanner.scan();
    return scanner;
}

export function isValidIdentifier(text: string): boolean {
    const scan = scanToken(text);
    return scan.isIdentifier() && scan.getTextPos() === text.length;
}

export function isValidPropertyAccess(text: string): boolean {
    if (!ts.isIdentifierStart(text.charCodeAt(0), ts.ScriptTarget.Latest))
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
    return scan.getToken() === ts.SyntaxKind.NumericLiteral && scan.getTextPos() === text.length;
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
                (<ts.ElementAccessExpression>node).argumentExpression !== undefined &&
                hasSideEffects((<ts.ElementAccessExpression>node).argumentExpression!, options);
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
            for (const child of (<ts.JsxElement>node).children)
                if (child.kind !== ts.SyntaxKind.JsxText && hasSideEffects(child, options))
                    return true;
            node = (<ts.JsxElement>node).openingElement;
            // falls through
        case ts.SyntaxKind.JsxSelfClosingElement:
        case ts.SyntaxKind.JsxOpeningElement:
            if (options! & SideEffectOptions.JsxElement)
                return true;
            for (const child of getJsxAttributes(<ts.JsxOpeningLikeElement>node)) {
                if (child.kind === ts.SyntaxKind.JsxSpreadAttribute) {
                    if (hasSideEffects(child.expression, options))
                        return true;
                } else if (child.initializer !== undefined && hasSideEffects(child.initializer, options)) {
                    return true;
                }
            }
            return false;
        default:
            return false;
    }
}

function getJsxAttributes(openElement: ts.JsxOpeningLikeElement): ts.JsxAttributeLike[] {
    // for back-compat with typescript@<2.3
    const attributes: ts.JsxAttributeLike[] | ts.JsxAttributes = openElement.attributes;
    return Array.isArray(attributes) ? attributes : attributes.properties;
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
