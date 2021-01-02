import * as Lint from 'tslint';
import * as ts from 'typescript';
import { isPropertyReadonlyInType, getLateBoundPropertyNames } from '../../util'

export class Rule extends Lint.Rules.TypedRule {
    public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program) {
        return this.applyWithFunction(sourceFile, walk, undefined, program.getTypeChecker());
    }
}

function walk(ctx: Lint.WalkContext<void>, checker: ts.TypeChecker) {
    return ts.forEachChild(ctx.sourceFile, function cb(node): void {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const {left} = node;
            if (
                ts.isPropertyAccessExpression(left) &&
                isPropertyReadonlyInType(checker.getTypeAtLocation(left.expression), left.name.escapedText, checker)
            ) {
                ctx.addFailureAtNode(left.name, 'readonly');
            } else if (ts.isElementAccessExpression(left)) {
                const baseType = checker.getTypeAtLocation(left.expression);
                for (const symbol of getLateBoundPropertyNames(left.argumentExpression, checker).names) {
                    if (isPropertyReadonlyInType(baseType, symbol.symbolName, checker)) {
                        ctx.addFailureAtNode(left.argumentExpression, `readonly '${symbol.displayName}'`);
                    }
                }
            }
        }
        return ts.forEachChild(node, cb);
    });
}
