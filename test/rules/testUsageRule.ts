import { collectVariableUsage } from '../../util/usage';
import * as ts from 'typescript';
import * as Lint from 'tslint';

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithFunction(sourceFile, walk);
    }
}

function walk(ctx: Lint.WalkContext<void>) {
    collectVariableUsage(ctx.sourceFile).forEach((usage, identifier) =>  {
        if (!usage.exported && usage.uses.length === 0)
            ctx.addFailureAtNode(identifier, 'Unused');
    });
}
