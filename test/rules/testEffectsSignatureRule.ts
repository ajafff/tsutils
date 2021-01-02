import * as Lint from 'tslint';
import * as ts from 'typescript';
import { isCallExpression, isExpressionStatement } from '../../typeguard/node';
import { callExpressionAffectsControlFlow, SignatureEffect } from '../../util/control-flow'
import { isBooleanLiteralType } from '../../util/type';
import { getNextStatement } from '../../util/util';
import { getUnreachableStatements } from '../utils';

export class Rule extends Lint.Rules.TypedRule {
    public applyWithProgram(sourceFile: ts.SourceFile, program: ts.Program) {
        return this.applyWithFunction(sourceFile, walk, undefined, program);
    }
}

function walk(ctx: Lint.WalkContext<void>, program: ts.Program) {
    const checker = program.getTypeChecker();
    let unreachableStatements: Set<number> | undefined;

    return ts.forEachChild(ctx.sourceFile, function cb(node): void {
        if (isExpressionStatement(node) && isCallExpression(node.expression)) {
            let message;
            switch (callExpressionAffectsControlFlow(node.expression, checker)) {
                case SignatureEffect.Never:
                    message = `never${isNextStatementUnreachable(node) ? '' : ', TypeScript disagrees'}`;
                    break;
                case SignatureEffect.Asserts:
                    message = `asserts${isNextStatementNarrowed(node) ? '' : ', TypeScript disagrees'}`;
                    break;
                case undefined:
                    message = `nope${hasNoEffectOnFollowingStatement(node) ? '': ', TypeScript disagrees'}`;
            }
            ctx.addFailureAtNode(node, message);
        }
        return ts.forEachChild(node, cb);
    });

    function isStatementUnreachable(node: ts.Statement) {
        return (unreachableStatements ??= getUnreachableStatements(program, ctx.sourceFile)).has(node.getStart(ctx.sourceFile));
    }

    function isNextStatementUnreachable(node: ts.ExpressionStatement) {
         return isStatementUnreachable(getNextStatement(node)!);
    }

    function isNextStatementNarrowed(node: ts.ExpressionStatement) {
        return isBooleanLiteralType(checker.getTypeAtLocation((<ts.ExpressionStatement>getNextStatement(node)).expression), true);
    }

    function hasNoEffectOnFollowingStatement(node: ts.ExpressionStatement) {
        return (<ts.CallExpression>node.expression).arguments.length === 0
            ? !isNextStatementUnreachable(node)
            : !isNextStatementNarrowed(node);
    }
}
