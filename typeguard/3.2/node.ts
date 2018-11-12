export * from '../3.0/node';

import * as ts from 'typescript';

export function isBigIntLiteral(node: ts.Node): node is ts.BigIntLiteral {
    return node.kind === ts.SyntaxKind.BigIntLiteral;
}
