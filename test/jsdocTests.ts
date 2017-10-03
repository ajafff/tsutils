import { getSourceFile } from './utils';
import { assert } from 'chai';
import { getJsDoc, parseJsDocOfNode } from '../util/util';

describe('getJsDoc', () => {
    it('gets JsDoc of EndOfFileToken', () => {
        assert.equal(getJsDoc(getSourceFile('test/files/jsdoc/none-before-eof.ts').endOfFileToken).length, 0);
        const sourceFile = getSourceFile('test/files/jsdoc/eof.ts');
        const doc = getJsDoc(sourceFile.endOfFileToken);
        assert.equal(doc.length, 2);
        assert.equal(doc[0].parent, sourceFile.endOfFileToken);
        assert.equal(doc[0].getSourceFile(), sourceFile);
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

    it('correctly sets position and parent', () => {
        const sourceFile = getSourceFile('test/files/jsdoc/none-before-eof.ts');
        const doc = parseJsDocOfNode(sourceFile.statements[1], true, sourceFile);
        assert.equal(doc.length, 1);
        assert.equal(doc[0].parent, sourceFile.statements[1]);
        assert.equal(doc[0].getSourceFile(), sourceFile);
        assert.equal(doc[0].getText(), '/** test2 */');
        assert.equal(doc[0].getText(sourceFile), '/** test2 */');
        assert.equal(sourceFile.text.slice(doc[0].pos, doc[0].end), '/** test2 */');
    });

    it('updates position of NodeArrays', () => {
        const sourceFile = getSourceFile('test/files/jsdoc/tags.ts');
        const [doc] = parseJsDocOfNode(sourceFile.statements[1], true, sourceFile);
        assert.isDefined(doc);
        assert.isDefined(doc.tags);
        assert.equal(doc.tags!.pos, doc.tags![0].pos);
        assert.equal(doc.tags!.end, doc.tags![0].end);
        assert.equal(sourceFile.text.slice(doc.tags!.pos, doc.tags!.end), '@const');
    });
});
