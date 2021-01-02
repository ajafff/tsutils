import * as ts from 'typescript';
import {
    isBlockLike,
    isBreakOrContinueStatement,
    isBreakStatement,
    isCallExpression,
    isClassLikeDeclaration,
    isDecorator,
    isExpressionStatement,
    isParameterDeclaration,
    isPropertyDeclaration,
    isPropertySignature,
    isTypePredicateNode,
    isVariableDeclaration,
} from '../typeguard/node';
import {
    isTypeFlagSet,
    isNodeFlagSet,
    isFunctionScopeBoundary,
    ScopeBoundary,
    isFunctionWithBody,
    isThisParameter,
    isSymbolFlagSet,
    hasExhaustiveCaseClauses,
} from './util';

export function endsControlFlow(statement: ts.Statement | ts.BlockLike, checker?: ts.TypeChecker): boolean {
    return getControlFlowEnd(statement, checker).end;
}

export type ControlFlowStatement =
    | ts.BreakStatement
    | ts.ContinueStatement
    | ts.ReturnStatement
    | ts.ThrowStatement
    | ts.ExpressionStatement & {expression: ts.CallExpression};

export interface ControlFlowEnd {
    /**
     * Statements that may end control flow at this statement.
     * Does not contain control flow statements that jump only inside the statement, for example a `continue` inside a nested for loop.
     */
    readonly statements: ReadonlyArray<ControlFlowStatement>;
    /** `true` if control flow definitely ends. */
    readonly end: boolean;
}
interface MutableControlFlowEnd {
    statements: ControlFlowStatement[];
    end: boolean;
}

const defaultControlFlowEnd: ControlFlowEnd = {statements: [], end: false};

export function getControlFlowEnd(statement: ts.Statement | ts.BlockLike, checker?: ts.TypeChecker): ControlFlowEnd {
    return isBlockLike(statement) ? handleBlock(statement, checker) : getControlFlowEndWorker(statement, checker);
}

function getControlFlowEndWorker(statement: ts.Statement, checker?: ts.TypeChecker): ControlFlowEnd {
    switch (statement.kind) {
        case ts.SyntaxKind.ReturnStatement:
        case ts.SyntaxKind.ThrowStatement:
        case ts.SyntaxKind.ContinueStatement:
        case ts.SyntaxKind.BreakStatement:
            return {statements: [<ControlFlowStatement>statement], end: true};
        case ts.SyntaxKind.Block:
            return handleBlock(<ts.Block>statement, checker);
        case ts.SyntaxKind.ForStatement:
        case ts.SyntaxKind.WhileStatement:
            return handleForAndWhileStatement(<ts.ForStatement | ts.WhileStatement>statement, checker);
        case ts.SyntaxKind.ForOfStatement:
        case ts.SyntaxKind.ForInStatement:
            return handleForInOrOfStatement(<ts.ForInOrOfStatement>statement, checker);
        case ts.SyntaxKind.DoStatement:
            return matchBreakOrContinue(
                getControlFlowEndWorker((<ts.DoStatement>statement).statement, checker),
                isBreakOrContinueStatement,
            );
        case ts.SyntaxKind.IfStatement:
            return handleIfStatement(<ts.IfStatement>statement, checker);
        case ts.SyntaxKind.SwitchStatement:
            return matchBreakOrContinue(handleSwitchStatement(<ts.SwitchStatement>statement, checker), isBreakStatement);
        case ts.SyntaxKind.TryStatement:
            return handleTryStatement(<ts.TryStatement>statement, checker);
        case ts.SyntaxKind.LabeledStatement:
            return matchLabel(
                getControlFlowEndWorker((<ts.LabeledStatement>statement).statement, checker),
                (<ts.LabeledStatement>statement).label,
            );
        case ts.SyntaxKind.WithStatement:
            return getControlFlowEndWorker((<ts.WithStatement>statement).statement, checker);
        case ts.SyntaxKind.ExpressionStatement:
            if (checker === undefined)
                return defaultControlFlowEnd;
            return handleExpressionStatement(<ts.ExpressionStatement>statement, checker);
        default:
            return defaultControlFlowEnd;
    }
}

function handleBlock(statement: ts.BlockLike, checker?: ts.TypeChecker): ControlFlowEnd {
    const result: MutableControlFlowEnd = {statements: [], end: false};
    for (const s of statement.statements) {
        const current = getControlFlowEndWorker(s, checker);
        result.statements.push(...current.statements);
        if (current.end) {
            result.end = true;
            break;
        }
    }
    return result;
}

function handleForInOrOfStatement(statement: ts.ForInOrOfStatement, checker?: ts.TypeChecker) {
    const end = matchBreakOrContinue(getControlFlowEndWorker(statement.statement, checker), isBreakOrContinueStatement);
    end.end = false; // loop body is guaranteed to be executed
    return end;
}

function handleForAndWhileStatement(statement: ts.ForStatement | ts.WhileStatement, checker?: ts.TypeChecker) {
    const constantCondition = statement.kind === ts.SyntaxKind.WhileStatement
        ? getConstantCondition(statement.expression)
        : statement.condition === undefined || getConstantCondition(statement.condition);
    if (constantCondition === false)
        return defaultControlFlowEnd; // loop body is never executed
    const end = matchBreakOrContinue(getControlFlowEndWorker(statement.statement, checker), isBreakOrContinueStatement);
    if (constantCondition === undefined)
        end.end = false; // can't be sure that loop body is executed at all
    return end;
}

/** Simply detects `true` and `false` in conditions. That matches TypeScript's behavior. */
function getConstantCondition(node: ts.Expression): boolean | undefined {
    switch (node.kind) {
        case ts.SyntaxKind.TrueKeyword:
            return true;
        case ts.SyntaxKind.FalseKeyword:
            return false;
        default:
            return;
    }
}

function handleIfStatement(node: ts.IfStatement, checker?: ts.TypeChecker): ControlFlowEnd {
    switch (getConstantCondition(node.expression)) {
        case true:
            // else branch is never executed
            return getControlFlowEndWorker(node.thenStatement, checker);
        case false:
            // then branch is never executed
            return node.elseStatement === undefined
                ? defaultControlFlowEnd
                : getControlFlowEndWorker(node.elseStatement, checker);
    }
    const then = getControlFlowEndWorker(node.thenStatement, checker);
    if (node.elseStatement === undefined)
        return {
            statements: then.statements,
            end: false,
        };
    const elze = getControlFlowEndWorker(node.elseStatement, checker);
    return {
        statements: [...then.statements, ...elze.statements],
        end: then.end && elze.end,
    };
}

function handleSwitchStatement(node: ts.SwitchStatement, checker?: ts.TypeChecker) {
    let hasDefault = false;
    const result: MutableControlFlowEnd = {
        statements: [],
        end: false,
    };
    for (const clause of node.caseBlock.clauses) {
        if (clause.kind === ts.SyntaxKind.DefaultClause)
            hasDefault = true;
        const current = handleBlock(clause, checker);
        result.end = current.end;
        result.statements.push(...current.statements);
    }
    result.end &&= hasDefault || checker !== undefined && hasExhaustiveCaseClauses(node, checker);
    return result;
}

function handleTryStatement(node: ts.TryStatement, checker?: ts.TypeChecker): ControlFlowEnd {
    let finallyResult: ControlFlowEnd | undefined;
    if (node.finallyBlock !== undefined) {
        finallyResult = handleBlock(node.finallyBlock, checker);
        // if 'finally' always ends control flow, we are not interested in any jump statements from 'try' or 'catch'
        if (finallyResult.end)
            return finallyResult;
    }
    const tryResult = handleBlock(node.tryBlock, checker);
    if (node.catchClause === undefined)
        return {statements: finallyResult!.statements.concat(tryResult.statements), end: tryResult.end};

    const catchResult = handleBlock(node.catchClause.block, checker);
    return {
        statements: tryResult.statements
            // remove all throw statements and throwing function calls from the list of control flow statements inside tryBlock
            .filter((s) => s.kind !== ts.SyntaxKind.ThrowStatement && s.kind !== ts.SyntaxKind.ExpressionStatement)
            .concat(catchResult.statements, finallyResult === undefined ? [] : finallyResult.statements),
        end: tryResult.end && catchResult.end, // only ends control flow if try AND catch definitely end control flow
    };
}

/** Dotted name as TypeScript requires it for assertion signatures to affect control flow. */
function isDottedNameWithExplicitTypeAnnotation(node: ts.Expression, checker: ts.TypeChecker) {
    while (true) {
        switch (node.kind) {
            case ts.SyntaxKind.Identifier: {
                const symbol = checker.getExportSymbolOfSymbol(checker.getSymbolAtLocation(node)!);
                return isExplicitlyTypedSymbol(
                    isSymbolFlagSet(symbol, ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol,
                    checker,
                );
            }
            case ts.SyntaxKind.ThisKeyword:
                return isExplicitlyTypedThis(node);
            case ts.SyntaxKind.SuperKeyword:
                return true;
            case ts.SyntaxKind.PropertyAccessExpression:
                if (!isExplicitlyTypedSymbol(checker.getSymbolAtLocation(node), checker))
                    return false;
                // falls through
            case ts.SyntaxKind.ParenthesizedExpression:
                node = (<ts.PropertyAccessExpression | ts.ParenthesizedExpression>node).expression;
                continue;
            default:
                return false;
        }
    }
}

function isExplicitlyTypedSymbol(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): boolean {
    if (symbol === undefined)
        return false;
    if (isSymbolFlagSet(symbol, ts.SymbolFlags.Function | ts.SymbolFlags.Method | ts.SymbolFlags.Class | ts.SymbolFlags.ValueModule))
        return true;
    if (!isSymbolFlagSet(symbol, ts.SymbolFlags.Variable | ts.SymbolFlags.Property))
        return false;
    if (symbol.valueDeclaration === undefined)
        return false;
    if (declarationHasExplicitTypeAnnotation(symbol.valueDeclaration))
        return true;
    return isVariableDeclaration(symbol.valueDeclaration) &&
        symbol.valueDeclaration.parent.parent.kind === ts.SyntaxKind.ForOfStatement &&
        isDottedNameWithExplicitTypeAnnotation(symbol.valueDeclaration.parent.parent.expression, checker);
}

function declarationHasExplicitTypeAnnotation(node: ts.Declaration) {
    if (ts.isJSDocPropertyLikeTag(node))
        return node.typeExpression !== undefined;
    return (
        isVariableDeclaration(node) ||
        isParameterDeclaration(node) ||
        isPropertyDeclaration(node) ||
        isPropertySignature(node)
    ) && (
        isNodeFlagSet(node, ts.NodeFlags.JavaScriptFile)
            ? ts.getJSDocType(node)
            : node.type
    ) !== undefined;
}

function isExplicitlyTypedThis(node: ts.Node): boolean {
    do {
        node = node.parent!;
        if (isDecorator(node)) {
            // `this` in decorators always resolves outside of the containing class
            if (node.parent.kind === ts.SyntaxKind.Parameter && isClassLikeDeclaration(node.parent.parent.parent)) {
                node = node.parent.parent.parent.parent;
            } else if (isClassLikeDeclaration(node.parent.parent)) {
                node = node.parent.parent.parent;
            } else if (isClassLikeDeclaration(node.parent)) {
                node = node.parent.parent;
            }
        }
    } while (isFunctionScopeBoundary(node) !== ScopeBoundary.Function || node.kind === ts.SyntaxKind.ArrowFunction);
    return isFunctionWithBody(node) &&
        (
            isNodeFlagSet(node, ts.NodeFlags.JavaScriptFile)
                ? ts.getJSDocThisTag(node)?.typeExpression !== undefined
                : node.parameters.length !== 0 && isThisParameter(node.parameters[0]) && node.parameters[0].type !== undefined
        ) ||
        isClassLikeDeclaration(node.parent!);
}

export const enum SignatureEffect {
    Never = 1,
    Asserts,
}

/**
 * Dermines whether a top level CallExpression has a control flow effect according to TypeScript's rules.
 * This handles functions returning `never` and `asserts`.
 */
export function callExpressionAffectsControlFlow(node: ts.CallExpression, checker: ts.TypeChecker): SignatureEffect | undefined {
    if (
        !isExpressionStatement(node.parent!) ||
        ts.isOptionalChain(node) ||
        !isDottedNameWithExplicitTypeAnnotation(node.expression, checker)
    )
        return;
    const signature = checker.getResolvedSignature(node);
    if (signature?.declaration === undefined)
        return;
    const typeNode = ts.isJSDocSignature(signature.declaration)
        ? signature.declaration.type?.typeExpression?.type
        : signature.declaration.type ?? (
            isNodeFlagSet(signature.declaration, ts.NodeFlags.JavaScriptFile)
                ? ts.getJSDocReturnType(signature.declaration)
                : undefined
        );
    if (typeNode === undefined)
        return;
    if (isTypePredicateNode(typeNode) && typeNode.assertsModifier !== undefined)
        return SignatureEffect.Asserts;
    return isTypeFlagSet(checker.getTypeFromTypeNode(typeNode), ts.TypeFlags.Never) ? SignatureEffect.Never : undefined;
}

function handleExpressionStatement(node: ts.ExpressionStatement, checker: ts.TypeChecker): ControlFlowEnd {
    if (!isCallExpression(node.expression))
        return defaultControlFlowEnd;
    switch (callExpressionAffectsControlFlow(node.expression, checker)) {
        case SignatureEffect.Asserts:
            return {statements: [<any>node], end: false};
        case SignatureEffect.Never:
            return {statements: [<any>node], end: true};
        case undefined:
            return defaultControlFlowEnd;
    }
}

function matchBreakOrContinue(current: ControlFlowEnd, pred: typeof isBreakOrContinueStatement) {
    const result: MutableControlFlowEnd = {
        statements: [],
        end: current.end,
    };
    for (const statement of current.statements) {
        if (pred(statement) && statement.label === undefined) {
            result.end = false;
            continue;
        }
        result.statements.push(statement);
    }
    return result;
}

function matchLabel(current: ControlFlowEnd, label: ts.Identifier) {
    const result: MutableControlFlowEnd = {
        statements: [],
        end: current.end,
    };
    const labelText = label.text;
    for (const statement of current.statements) {
        switch (statement.kind) {
            case ts.SyntaxKind.BreakStatement:
            case ts.SyntaxKind.ContinueStatement:
                if (statement.label !== undefined && statement.label.text === labelText) {
                    result.end = false;
                    continue;
                }
        }
        result.statements.push(statement);
    }
    return result;
}
