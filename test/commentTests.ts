import { assert } from 'chai';
import { forEachComment, getCommentAtPosition, getTokenAtPosition, isPositionInComment } from '../util/util';
import { getSourceFile } from './utils';

const comments = ['1', '2', '3', '4', 'i', 'j', '7', 'b', 'e', 'f', 'g', 'h'];

describe('getCommentAtPosition', () => {
    it('handles JSX', () => {
        const sourceFile = getSourceFile('test/files/comment/noComment.tsx');
        for (let i = 0; i <= sourceFile.end; ++i)
            assert.isUndefined(getCommentAtPosition(sourceFile, i), `position ${i} contains no comment`);
    });

    it('finds all comments correctly', () => {
        const sourceFile = getSourceFile('test/files/comment/comments.tsx');
        const result: string[] = [];
        for (let i = 0; i <= sourceFile.end; ++i) {
            const comment = getCommentAtPosition(sourceFile, i);
            if (comment === undefined)
                continue;
            if (i === comment.pos + 2) {
                result.push(sourceFile.text.substr(comment.pos + 2, 1));
                for (let pos = comment.pos; pos < comment.end; ++pos)
                    assert.isTrue(isPositionInComment(sourceFile, pos));
                assert.isFalse(isPositionInComment(sourceFile, comment.pos - 1));
                assert.isFalse(isPositionInComment(sourceFile, comment.end));
            }
        }
        assert.deepEqual(result, comments);
    });

    it('return the same result if parent is passed', () => {
        const sourceFile = getSourceFile('test/files/comment/comments.tsx');
        for (let i = 0; i <= sourceFile.end; ++i) {
            const comment = getCommentAtPosition(sourceFile, i);
            let parent = getTokenAtPosition(sourceFile, i);
            while (parent !== undefined) {
                assert.deepEqual(getCommentAtPosition(sourceFile, i, parent), comment);
                parent = parent.parent;
            }
        }
    });
});

describe('forEachComment', () => {
    it('handles JSX', () => {
        const sourceFile = getSourceFile('test/files/comment/noComment.tsx');
        forEachComment(sourceFile, (_text, comment) => assert.fail(comment, undefined, 'file contains no comments'));
    });

    it('finds all comments correctly', () => {
        const sourceFile = getSourceFile('test/files/comment/comments.tsx');
        const result: string[] = [];
        forEachComment(sourceFile, (text, comment) => result.push(text.substr(comment.pos + 2, 1)));
        assert.deepEqual(result, comments);
    });
});
