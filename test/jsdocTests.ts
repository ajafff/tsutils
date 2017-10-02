import { getSourceFile } from './utils';
import { assert } from 'chai';
import { getJsDoc, parseJsDocOfNode } from '../util/util';

describe('getJsDoc', () => {
    it('gets JsDoc of EndOfFileToken', () => {
        assert.equal(getJsDoc(getSourceFile('test/files/jsdoc/eof.ts').endOfFileToken).length, 2);
        assert.equal(getJsDoc(getSourceFile('test/files/jsdoc/none-before-eof.ts').endOfFileToken).length, 0);
    });

    it('returns an empty array for nodes that cannot have JsDoc', () => {
        assert.deepEqual(getJsDoc(getSourceFile('test/files/jsdoc/invalid.ts').statements[0]), []);
    });

    it('returns all JsDoc comments for a given node', () => {
        assert.equal(getJsDoc(getSourceFile('test/files/jsdoc/valid.ts').statements[0]).length, 2);
    });

    it('returns an empty array if there is no documentation comment', () => {
        assert.deepEqual(getJsDoc(getSourceFile('test/files/jsdoc/none.ts').statements[0]), []);
    });
});

describe('parseJsDocOfNode', () => {
    it("parses JsDoc for nodes that naturally don't have any", () => {
        assert.equal(parseJsDocOfNode(getSourceFile('test/files/jsdoc/invalid.ts').statements[0]).length, 1);
    });

    it('parses JsDoc for nodes that can have JsDoc', () => {
        assert.equal(parseJsDocOfNode(getSourceFile('test/files/jsdoc/valid.ts').statements[0]).length, 2);
    });

    it('ignores trailing comments by default', () => {
        const sourceFile = getSourceFile('test/files/jsdoc/none-before-eof.ts');
        assert.equal(parseJsDocOfNode(sourceFile.endOfFileToken, undefined, sourceFile).length, 0);
        assert.equal(parseJsDocOfNode(sourceFile.statements[1], undefined, sourceFile).length, 0);
    });

    describe('considerTrailingComments', () => {
        it('ignores trailing comments if node starts on the next line', () => {
            assert.equal(parseJsDocOfNode(getSourceFile('test/files/jsdoc/none-before-eof.ts').endOfFileToken, true).length, 0);
        });

        it('uses trailing comments if node starts on the same line', () => {
            assert.equal(parseJsDocOfNode(getSourceFile('test/files/jsdoc/none-before-eof.ts').statements[1], true).length, 1);
        });
    });
});
