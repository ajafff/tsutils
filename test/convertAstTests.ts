import * as ts from 'typescript';
import { assert } from 'chai';
import { convertAst, NodeWrap } from '../util';
import { getSourceFile } from './utils';

describe('convertAst', () => {
    it('should not crash on empty files', () => {
        convertAst(getSourceFile('test/files/token/whitespace.ts'));
    });

    it('should handle huge AST just fine', () => {
        let sourceText = 'let v = 1';
        for (let i = 0; i < 5000; ++i)
            sourceText += ' + 1';
        convertAst(ts.createSourceFile('test.ts', sourceText, ts.ScriptTarget.ESNext));
    });

    const sourceFile = getSourceFile('test/files/comment/comments.tsx');

    it('flat should contain all children recursively depth-first', () => {
        const ref: ts.Node[] = [];
        ts.forEachChild(sourceFile, function cb(node) {
            ref.push(node);
            ts.forEachChild(node, cb);
        });

        assert.deepStrictEqual(convertAst(sourceFile).flat, ref);
    });

    it('wrapped should contain all nodes with correct pointers', () => {
        function check(wrap: NodeWrap, parent: NodeWrap | undefined, skip: NodeWrap | undefined) {
            assert.strictEqual(parent === undefined, wrap.node.kind === ts.SyntaxKind.SourceFile);
            assert.strictEqual(
                skip === undefined,
                wrap.node.kind === ts.SyntaxKind.SourceFile || wrap.node.kind === ts.SyntaxKind.EndOfFileToken,
            );

            assert(wrap.parent === parent, 'parent');
            assert(wrap.skip === skip);
            assert(wrap.kind === wrap.node.kind, 'kind');
            assert(wrap.next === (wrap.children.length !== 0 ? wrap.children[0] : wrap.skip), 'next');

            const children: ts.Node[] = [];
            ts.forEachChild(wrap.node, (node) => void children.push(node));

            assert(wrap.children.length === children.length, 'children.length');
            for (let i = 0; i < wrap.children.length; ++i) {
                const child = wrap.children[i];
                assert(child.node === children[i], 'children[i]');
                check(child, wrap, i === wrap.children.length - 1 ? wrap.skip : wrap.children[i + 1]);
            }
        }
        const wrappedAst = convertAst(sourceFile).wrapped;
        assert(wrappedAst.node === sourceFile);
        check(wrappedAst, undefined, undefined);
    });
});
