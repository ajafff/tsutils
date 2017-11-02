import * as ts from 'typescript';
import { isBlockLike, isBreakOrContinueStatement, isBreakStatement } from '../typeguard/node';

export function endsControlFlow(statement: ts.Statement | ts.BlockLike): boolean {
    if (isBlockLike(statement))
        return handleBlock(statement).end;
    switch (statement.kind) {
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.WhileStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.SwitchStatement:
            if (statement.parent!.kind === ts.SyntaxKind.LabeledStatement)
                statement = <ts.LabeledStatement>statement.parent;
    }
    return getControlFlowEnd(statement).end;
}

type JumpStatement = ts.BreakStatement | ts.ContinueStatement | ts.ReturnStatement | ts.ThrowStatement;
interface ControlFlowEnd {
    statements: JumpStatement[];
    end: boolean;
}

const defaultControlFlowEnd: ControlFlowEnd = {statements: [], end: false};

function getControlFlowEnd(statement: ts.Statement, label?: ts.Identifier): ControlFlowEnd {
    switch (statement.kind) {
        case ts.SyntaxKind.ReturnStatement:
        case ts.SyntaxKind.ThrowStatement:
        case ts.SyntaxKind.ContinueStatement:
        case ts.SyntaxKind.BreakStatement:
            return {statements: [<JumpStatement>statement], end: true};
        case ts.SyntaxKind.Block:
            return handleBlock(<ts.Block>statement);
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.WhileStatement:
            return matchBreakOrContinue(getControlFlowEnd((<ts.IterationStatement>statement).statement), isBreakOrContinueStatement, label);
        case ts.SyntaxKind.IfStatement:
            return handleIfStatement(<ts.IfStatement>statement);
        case ts.SyntaxKind.SwitchStatement:
            return matchBreakOrContinue(handleSwitchStatement(<ts.SwitchStatement>statement), isBreakStatement, label);
        case ts.SyntaxKind.TryStatement:
            return handleTryStatement(<ts.TryStatement>statement);
        case ts.SyntaxKind.LabeledStatement:
            return getControlFlowEnd((<ts.LabeledStatement>statement).statement, (<ts.LabeledStatement>statement).label);
        case ts.SyntaxKind.WithStatement:
            return getControlFlowEnd((<ts.LabeledStatement | ts.WithStatement>statement).statement);
        default:
            return defaultControlFlowEnd;
    }
}

function handleBlock(statement: ts.BlockLike): ControlFlowEnd {
    const result: ControlFlowEnd = {statements: [], end: false};
    for (const s of statement.statements) {
        const current = getControlFlowEnd(s);
        result.statements.push(...current.statements);
        if (current.end) {
            result.end = true;
            break;
        }
    }
    return result;
}

function handleIfStatement(node: ts.IfStatement): ControlFlowEnd {
    const then = getControlFlowEnd(node.thenStatement);
    if (node.elseStatement === undefined) {
        then.end = false;
        return then;
    }
    const elze = getControlFlowEnd(node.elseStatement);
    return {
        statements: then.statements.concat(elze.statements),
        end: then.end && elze.end,
    };
}

function handleSwitchStatement(node: ts.SwitchStatement): ControlFlowEnd {
    let hasDefault = false;
    const result: ControlFlowEnd = {
        statements: [],
        end: false,
    };
    for (const clause of node.caseBlock.clauses) {
        if (clause.kind === ts.SyntaxKind.DefaultClause)
            hasDefault = true;
        const current = handleBlock(clause);
        result.end = current.end;
        result.statements.push(...current.statements);
    }
    if (!hasDefault)
        result.end = false;
    return result;
}

function handleTryStatement(node: ts.TryStatement): ControlFlowEnd {
    let result: ControlFlowEnd | undefined;
    if (node.finallyBlock !== undefined) {
        result = handleBlock(node.finallyBlock);
        // if 'finally' always ends control flow, we are not interested in any jump statements from 'try' or 'catch'
        if (result.end)
            return result;
    }
    const tryResult = handleBlock(node.tryBlock);
    result = result === undefined
        ? tryResult
        : {statements: result.statements.concat(tryResult.statements), end: tryResult.end};
    if (node.catchClause !== undefined) {
        const current = handleBlock(node.catchClause.block);
        result = {
            statements: result.statements.concat(current.statements),
            end: current.end,
        };
    }
    return result;
}

function matchBreakOrContinue(current: ControlFlowEnd, pred: typeof isBreakOrContinueStatement, label?: ts.Identifier): ControlFlowEnd {
    const result: ControlFlowEnd = {
        end: current.end,
        statements: [],
    };
    for (const statement of current.statements) {
        if (pred(statement) && (statement.label === undefined || label !== undefined && statement.label.text === label.text)) {
            result.end = false;
            continue;
        }
        result.statements.push(statement);
    }
    return result;
}
