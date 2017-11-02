import * as ts from 'typescript';
import * as Lint from 'tslint';
import { isExpression } from "../../../typeguard/node";
import { isExpressionValueUsed } from "../../../util/util";

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithFunction(sourceFile, walk);
    }
}

function walk(ctx: Lint.WalkContext<void>) {
    return ts.forEachChild(ctx.sourceFile, function cb(node): void {
        if (isExpression(node) && isExpressionValueUsed(node)) {
            ctx.addFailureAtNode(node, 'Used');
        }
        return ts.forEachChild(node, cb);
    })
}
