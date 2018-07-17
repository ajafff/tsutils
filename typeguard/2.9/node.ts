export * from '../2.8/node';

import * as ts from 'typescript';

export function isImportTypeNode(node: ts.Node): node is ts.ImportTypeNode {
    return node.kind === ts.SyntaxKind.ImportType;
}
