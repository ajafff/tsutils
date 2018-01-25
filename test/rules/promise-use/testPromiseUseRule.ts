import * as ts from 'typescript';
import * as Lint from 'tslint';
import { isCallExpression } from "../../../typeguard/node";
import { isExpressionValueUsed } from "../../../util/util";
import { isPromiseType } from '../../../util/type';

export class Rule extends Lint.Rules.TypedRule {
    applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program): Lint.RuleFailure[] {
        return this.applyWithFunction(sourceFile, (ctx) => walk(ctx, program));
    }
}

function walk(ctx: Lint.WalkContext<void>, program: ts.Program) {
    const cb = (node: ts.Node): void => {
        if (isCallExpression(node)) {
            if (!isExpressionValueUsed(node) && isPromiseExpression(node, program)) {
              ctx.addFailureAtNode(node, 'Promise');
            }
        }
        return ts.forEachChild(node, cb);
    };
    return ts.forEachChild(ctx.sourceFile, cb);
}

function isPromiseExpression(node: ts.CallExpression, program: ts.Program) {
    const checker = program.getTypeChecker();
    const signature = checker.getResolvedSignature(node);
    if (signature === undefined) {
        return false;
    }
    const returnType = checker.getReturnTypeOfSignature(signature);
    if (!!(returnType.flags & ts.TypeFlags.Void)) {
        return false;
    }

    return isPromiseType(returnType);
}
