import * as ts from 'typescript';
import {
    isBlockLike,
    isIfStatement,
    isLiteralExpression,
} from './typeguard';

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

export function isElseIf(node: ts.IfStatement): boolean {
    const parent = node.parent!;
    return isIfStatement(parent) && parent.elseStatement === node;
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
