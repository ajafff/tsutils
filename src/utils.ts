import * as ts from 'typescript';
import {isBlockLike, isLiteralExpression} from './typeguard';

export function getChildOfKind(node: ts.Node, kind: ts.SyntaxKind, sourceFile?: ts.SourceFile) {
    for (const child of node.getChildren(sourceFile))
        if (child.kind === kind)
            return child;
}

export function isTokenKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstToken && kind <= ts.SyntaxKind.LastToken ||
        kind === ts.SyntaxKind.JsxText; // for compatibility with typescript 2.0.10
}

export function isAssignmentKind(kind: ts.SyntaxKind) {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

export function hasModifier(modifiers: ts.Modifier[]|undefined, ...kinds: ts.SyntaxKind[]) {
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

export function hasAccessModifier(node: ts.ClassElement|ts.ParameterDeclaration) {
    return hasModifier(node.modifiers,
                       ts.SyntaxKind.PublicKeyword,
                       ts.SyntaxKind.ProtectedKeyword,
                       ts.SyntaxKind.PrivateKeyword);
}

export function getPreviousStatement(statement: ts.Statement): ts.Statement|undefined {
    const parent = statement.parent!;
    if (isBlockLike(parent)) {
        const index = parent.statements.indexOf(statement);
        if (index > 0)
            return parent.statements[index - 1];
    }
}

export function getNextStatement(statement: ts.Statement): ts.Statement|undefined {
    const parent = statement.parent!;
    if (isBlockLike(parent)) {
        const index = parent.statements.indexOf(statement);
        if (index < parent.statements.length)
            return parent.statements[index + 1];
    }
}

export function getPropertyName(propertyName: ts.PropertyName): string|undefined {
    if (propertyName.kind === ts.SyntaxKind.ComputedPropertyName) {
        if (!isLiteralExpression(propertyName.expression))
            return;
        return propertyName.expression.text;
    }
    return propertyName.text;
}

export function forEachDestructuringIdentifier<T>(pattern: ts.BindingPattern,
                                                  fn: (element: ts.BindingElement & {name: ts.Identifier}) => T): T|undefined {
    for (const element of pattern.elements) {
        if (element.kind !== ts.SyntaxKind.BindingElement)
            continue;
        let result: T|undefined;
        if (element.name.kind === ts.SyntaxKind.Identifier) {
            result = fn(<ts.BindingElement & {name: ts.Identifier}>element);
        } else {
            result = forEachDestructuringIdentifier(element.name, fn);
        }
        if (result !== undefined)
            return result;
    }
}

export function forEachDeclaredVariable<T>(declarationList: ts.VariableDeclarationList,
                                        cb: (element: ts.VariableLikeDeclaration & {name: ts.Identifier}) => T) {
    for (const declaration of declarationList.declarations) {
        let result: T|undefined;
        if (declaration.name.kind === ts.SyntaxKind.Identifier) {
            result = cb(<ts.VariableDeclaration & {name: ts.Identifier}>declaration);
        } else {
            result = forEachDestructuringIdentifier(declaration.name, cb);
        }
        if (result !== undefined)
            return result;
    }
}

export const enum VariableDeclarationKind {
    Var,
    Let,
    Const,
}

export function getVariableDeclarationKind(declarationList: ts.VariableDeclarationList): VariableDeclarationKind {
    if ((declarationList.flags & ts.NodeFlags.Let) !== 0)
        return VariableDeclarationKind.Let;
    if ((declarationList.flags & ts.NodeFlags.Const) !== 0)
        return VariableDeclarationKind.Const;
    return VariableDeclarationKind.Var;
}

export function isBlockScopedVariableDeclarationList(declarationList: ts.VariableDeclarationList): boolean {
    return getVariableDeclarationKind(declarationList) !== VariableDeclarationKind.Var;
}

export function isBlockScopedVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
    return (<ts.SyntaxKind>declaration.parent!.kind) === ts.SyntaxKind.CatchClause ||
        isBlockScopedVariableDeclarationList(declaration.parent!);
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
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.FunctionExpression:
        case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.Constructor:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.ModuleDeclaration:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
        case ts.SyntaxKind.EnumDeclaration:
            return true;
        case ts.SyntaxKind.SourceFile:
            // if SourceFile is no module, it contributes to the global scope and is therefore no scope boundary
            return ts.isExternalModule(<ts.SourceFile>node);
        default:
            return false;
    }
}

export function isBlockScopeBoundary(node: ts.Node): boolean {
    if (node.parent !== undefined) {
        switch (node.parent.kind) {
            case ts.SyntaxKind.DoStatement:
            case ts.SyntaxKind.WhileStatement:
            case ts.SyntaxKind.IfStatement:
            case ts.SyntaxKind.TryStatement:
            case ts.SyntaxKind.WithStatement:
                return true;
        }
    }
    switch (node.kind) {
        case ts.SyntaxKind.Block:
            return node.parent!.kind !== ts.SyntaxKind.CatchClause &&
                   // blocks in inside SourceFile are block scope boundaries
                   (node.parent!.kind === ts.SyntaxKind.SourceFile ||
                   // blocks that are direct children of a function scope boundary are no scope boundary
                   // for example the FunctionBlock is part of the function scope of the containing function
                    !isFunctionScopeBoundary(node.parent!));
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.CaseBlock:
            return true;
        default:
            return false;
    }
}
