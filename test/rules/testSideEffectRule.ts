import * as ts from 'typescript';
import * as Lint from 'tslint';
import { isExpression } from '../../typeguard/node';
import { hasSideEffects, SideEffectOptions } from '../../util/util';

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        let options = SideEffectOptions.None;
        if (this.ruleArguments.includes('constructor'))
            options &= SideEffectOptions.Constructor;
        if (this.ruleArguments.includes('jsx'))
            options &= SideEffectOptions.JsxElement;
        if (this.ruleArguments.includes('tagged-template'))
            options &= SideEffectOptions.TaggedTemplate;
        return this.applyWithFunction(sourceFile, walk, options);
    }
}

function walk(ctx: Lint.WalkContext<SideEffectOptions>) {
    return ts.forEachChild(ctx.sourceFile, function cb(node): void {
        if (isExpression(node) && hasSideEffects(node, ctx.options))
            ctx.addFailureAtNode(node, 'has side effect');
        return ts.forEachChild(node, cb);
    });
}
