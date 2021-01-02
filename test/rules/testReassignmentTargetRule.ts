import * as Lint from 'tslint';
import * as ts from 'typescript';
import { isExpression } from '../../typeguard/node';
import { isReassignmentTarget } from '../../util/util';

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile) {
        return this.applyWithFunction(sourceFile, walk);
    }
}

function walk(ctx: Lint.WalkContext<void>) {
    return ts.forEachChild(ctx.sourceFile, function cb(node): void {
        if (isExpression(node) && isReassignmentTarget(node))
            ctx.addFailureAtNode(node, 'Reassignment target');
        return ts.forEachChild(node, cb);
    });
}
