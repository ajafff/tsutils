export * from '../3.0/node';

import * as ts from 'typescript';

export function isBigIntLiteral(node: ts.Node): node is ts.BigIntLiteral {
    return node.kind === ts.SyntaxKind.BigIntLiteral;
}

export function isNullLiteral(node: ts.Node): node is ts.NullLiteral {
    return node.kind === ts.SyntaxKind.NullKeyword;
}

export function isBooleanLiteral(node: ts.Node): node is ts.BooleanLiteral {
    return node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword;
}
