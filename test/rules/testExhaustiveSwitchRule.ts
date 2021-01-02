import * as Lint from 'tslint';
import * as ts from 'typescript';
import { isSwitchStatement } from '../../typeguard/node';
import { getNextStatement, hasExhaustiveCaseClauses } from '../../util/util';
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
        if (isSwitchStatement(node)) {
            const exhaustive = hasExhaustiveCaseClauses(node, checker);
            ctx.addFailureAtNode(
                node.getFirstToken(ctx.sourceFile)!,
                `${exhaustive ? '' : 'not '}exhaustive${isNextStatementUnreachable(node) === exhaustive ? '' : ', TypeScript disagrees'}`,
            );
        }
        return ts.forEachChild(node, cb);
    });

    function isStatementUnreachable(node: ts.Statement) {
        return (unreachableStatements ??= getUnreachableStatements(program, ctx.sourceFile)).has(node.getStart(ctx.sourceFile));
    }

    function isNextStatementUnreachable(node: ts.Statement) {
         return isStatementUnreachable(getNextStatement(node)!);
    }
}
