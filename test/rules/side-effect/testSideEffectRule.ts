import * as ts from 'typescript';
import * as Lint from 'tslint';
import { isExpression } from '../../../typeguard/node';
import { hasSideEffects, SideEffectOptions } from '../../../util/util';

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        let options = SideEffectOptions.None;
        if (this.ruleArguments.indexOf('constructor') !== -1)
            options &= SideEffectOptions.Constructor;
        if (this.ruleArguments.indexOf('jsx') !== -1)
            options &= SideEffectOptions.JsxElement;
        if (this.ruleArguments.indexOf('tagged-template') !== -1)
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
