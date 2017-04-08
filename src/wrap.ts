import * as ts from 'typescript';

export interface NodeWrap {
    node: ts.Node;
    children: NodeWrap[];
    next?: NodeWrap;
    skip?: NodeWrap;
    parent?: NodeWrap;
}

export function flattenAst(sourceFile: ts.SourceFile): ts.Node[] {
    return getConvertedAst(sourceFile).flat;
}

export function wrapAst(sourceFile: ts.SourceFile): NodeWrap {
    return getConvertedAst(sourceFile).wrapped;
}

const CACHE = new WeakMap<ts.SourceFile, ConvertedAst>();

interface ConvertedAst {
    wrapped: NodeWrap;
    flat: ts.Node[];
}

function getConvertedAst(sourceFile: ts.SourceFile): ConvertedAst {
    let result = CACHE.get(sourceFile);
    if (result !== undefined)
        return result;
    result = convertAst(sourceFile);
    CACHE.set(sourceFile, result);
    return result;
}

function convertAst(sourceFile: ts.SourceFile): ConvertedAst {
    const wrapped: NodeWrap = {
        node: sourceFile,
        parent: undefined,
        children: [],
        next: undefined,
        skip: undefined,
    };
    const flat: ts.Node[] = [];
    let current = wrapped;
    let previous = current;
    ts.forEachChild(sourceFile, function wrap(node: ts.Node) {
        flat.push(node);
        const parent = current;
        previous.next = current = {
            node,
            parent,
            children: [],
            next: undefined,
            skip: undefined,
        };
        if (previous !== parent)
            setSkip(previous, current);

        previous = current;
        parent.children.push(current);

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
