import * as Lint from 'tslint';
import * as ts from 'typescript';
import { isPropertyReadonlyInType, unionTypeParts } from '../../../util'
import { isLiteralType, isUniqueESSymbolType } from '../../../typeguard/type';

export class Rule extends Lint.Rules.TypedRule {
    public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program) {
        return this.applyWithFunction(sourceFile, walk, undefined, program.getTypeChecker());
    }
}

function walk(ctx: Lint.WalkContext<void>, checker: ts.TypeChecker) {
    return ts.forEachChild(ctx.sourceFile, function cb(node): void {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const {left} = node;
            if (ts.isPropertyAccessExpression(left) && left.name.text === 'x')
                debugger;
            if (
                ts.isPropertyAccessExpression(left) &&
                isPropertyReadonlyInType(checker.getTypeAtLocation(left.expression), left.name.escapedText, checker)
            ) {
                ctx.addFailureAtNode(left.name, 'readonly');
            } else if (ts.isElementAccessExpression(left)) {
                const baseType = checker.getTypeAtLocation(left.expression);
                for (const symbol of lateBoundPropertyNames(left.argumentExpression, checker).properties) {
                    if (isPropertyReadonlyInType(baseType, symbol.symbolName, checker)) {
                        ctx.addFailureAtNode(left.argumentExpression, `readonly '${symbol.name}'`);
                    }
                }
            }
        }
        return ts.forEachChild(node, cb);
    });
}

// TODO make proper utility function
function lateBoundPropertyNames(node: ts.Expression, checker: ts.TypeChecker) {
    let known = true;
    const properties: Array<{name: string, symbolName: ts.__String}> = [];
    if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Symbol'
    ) {
        properties.push({
            name: `[Symbol.${node.name.text}]`,
            symbolName: <ts.__String>`__@${node.name.text}`,
        });
    } else {
        const type = checker.getTypeAtLocation(node)!;
        for (const key of unionTypeParts(checker.getBaseConstraintOfType(type) || type)) {
            if (isLiteralType(key)) {
                const name = String(key.value);
                properties.push({
                    name,
                    symbolName: ts.escapeLeadingUnderscores(name),
                });
            } else if (isUniqueESSymbolType(key)){
                properties.push({
                    name: `[${key.symbol.name}]`,
                    symbolName: key.escapedName,
                });
            } else {
                known = false;
            }
        }
    }
    return {known, properties};
}
