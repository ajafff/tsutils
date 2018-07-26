import * as ts from 'typescript';
import * as Lint from 'tslint';
import { endsControlFlow } from '../../../util/control-flow';
import { convertAst } from '../../../util/convert-ast';
import { isBlockLike, isIterationStatement, isWithStatement, isIfStatement, isLabeledStatement } from '../../../typeguard/node';

export class Rule extends Lint.Rules.AbstractRule {
    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        return this.applyWithFunction(sourceFile, walk);
    }
}

function walk(ctx: Lint.WalkContext<void>) {
    const seen = new Set<ts.Node>();
    for (const node of convertAst(ctx.sourceFile).flat) {
        if (isBlockLike(node)) {
            checkStatement(node);
            node.statements.forEach(checkStatement);
        } else if (isIterationStatement(node) || isWithStatement(node) || isLabeledStatement(node)) {
            checkStatement(node.statement);
        } else if (isIfStatement(node)) {
            checkStatement(node.thenStatement);
            if (node.elseStatement)
                checkStatement(node.elseStatement);
        }
    }
    function checkStatement(node: ts.Statement | ts.BlockLike) {
        if (seen.has(node))
            return;
        seen.add(node);
        if (endsControlFlow(node))
            ctx.addFailureAtNode(node.getFirstToken(ctx.sourceFile)!, 'control flow end');
    }
}
