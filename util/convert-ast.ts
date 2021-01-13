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
    node: ts.SourceFile;
    next: NodeWrap;
    skip: undefined;
    parent: undefined;
}

export interface ConvertedAst {
    /** nodes wrapped in a data structure with useful links */
    wrapped: WrappedAst;
    /** depth-first array of all nodes excluding SourceFile */
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

    function collectChildren(node: ts.Node) {
        current.children.push({
            node,
            parent: current,
            kind: node.kind,
            children: [],
            next: undefined,
            skip: undefined,
        });
    }
    const stack = [];
    while (true) {
        if (current.children.length === 0) {
            ts.forEachChild(current.node, collectChildren);
            if (current.children.length === 0) {
                current = current.parent!; // nothing to do here, go back to parent
            } else {
                // recurse into first child
                const firstChild = current.children[0];
                current.next = firstChild;
                flat.push(firstChild.node);
                if (isNodeKind(firstChild.kind))
                    current = firstChild;
                stack.push(1); // set index in stack so we know where to continue processing children
            }
        } else {
            const index = stack[stack.length - 1];
            if (index < current.children.length) { // handles 2nd child to the last
                const currentChild = current.children[index];
                flat.push(currentChild.node);
                let previous = current.children[index - 1];
                while (previous.children.length !== 0) {
                    previous.skip = currentChild;
                    previous = previous.children[previous.children.length - 1];
                }
                previous.skip = previous.next = currentChild;
                ++stack[stack.length - 1];
                if (isNodeKind(currentChild.kind))
                    current = currentChild; // recurse into child
            } else {
                // done on this node
                if (stack.length === 1)
                    break;
                // remove index from stack and go back to parent
                stack.pop();
                current = current.parent!;
            }
        }
    }

    return {
        wrapped,
        flat,
    };
}
