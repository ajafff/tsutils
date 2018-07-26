import * as ts from 'typescript';
import { isNodeKind } from './util';

/** Wraps an AST node. Can be used as a tree using `children` or a linked list using `next` and `skip`. */
export interface NodeWrap {
    /** The real AST node. */
    node: ts.Node;
    /** The SyntaxKind of `node`. */
    kind: ts.SyntaxKind;
    /** All immediate children of `node` that would be visited by `ts.forEachChild(node, cb)`. */
    children: NodeWrap[];
    /** Link to the next NodeWrap, depth-first. */
    next?: NodeWrap;
    /** Link to the next NodeWrap skipping all children of the current node. */
    skip?: NodeWrap;
    /** Link to the parent NodeWrap */
    parent?: NodeWrap;
}

export interface WrappedAst extends NodeWrap {
    next: NodeWrap;
    skip: undefined;
    parent: undefined;
}

export interface ConvertedAst {
    /** nodes wrapped in a data structure with useful links */
    wrapped: WrappedAst;
    /** depth-first array of all nodes */
    flat: ReadonlyArray<ts.Node>;
}

/**
 * Takes a `ts.SourceFile` and creates data structures that are easier (or more performant) to traverse.
 * Note that there is only a performance gain if you can reuse these structures. It's not recommended for one-time AST walks.
 */
export function convertAst(sourceFile: ts.SourceFile): ConvertedAst {
    const wrapped: WrappedAst = {
        node: sourceFile,
        parent: undefined,
        kind: ts.SyntaxKind.SourceFile,
        children: [],
        next: <any>undefined,
        skip: undefined,
    };
    const flat: ts.Node[] = [];
    let current: NodeWrap = wrapped;
    let previous = current;
    ts.forEachChild(sourceFile, function wrap(node) {
        flat.push(node);
        const parent = current;
        previous.next = current = {
            node,
            parent,
            kind: node.kind,
            children: [],
            next: undefined,
            skip: undefined,
        };
        if (previous !== parent)
            setSkip(previous, current);

        previous = current;
        parent.children.push(current);

        if (isNodeKind(node.kind))
            ts.forEachChild(node, wrap);

        current = parent;
    });

    return {
        wrapped,
        flat,
    };
}

function setSkip(node: NodeWrap, skip: NodeWrap) {
    do {
        node.skip = skip;
        node = node.parent!;
    } while (node !== skip.parent);
}
