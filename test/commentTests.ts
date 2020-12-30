import { assert } from 'chai';
import { forEachComment, getCommentAtPosition, getTokenAtPosition, isPositionInComment, getTsCheckDirective } from '../util/util';
import { getSourceFile } from './utils';

const comments = [
    '1', '2', '3', '4', 'i', 'j', '7', 'b', 'e', 'f', 'g', 'h', 'l', 'p', 'q', 'r', 's', 'w', 'x', 'y', 'z',
    'B', 'D', 'F', 'G', 'I', '*', 'J', 'K', 'L', 'N', 'O', 'Q', 'R', 'T', 'U', 'W',
];

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

describe('getTsCheckDirective', () => {
    it('returns undefined if there is no matching comment', () => {
        assert.strictEqual(getTsCheckDirective(''), undefined);
    });

    it('stops at the first non-comment token', () => {
        assert.strictEqual(getTsCheckDirective('foo; // @ts-check'), undefined);
    });

    it('handles shebang correctly', () => {
        assert.deepEqual(getTsCheckDirective('#! foo\n//@ts-check'), {pos: 7, end: 18, enabled: true});
    });

    it('returns the last comment', () => {
        assert.deepEqual(getTsCheckDirective('// @ts-check\n// @ts-nocheck'), {pos: 13, end: 27, enabled: false});
    });

    it('allows three slashes and whitespaces', () => {
        assert.deepEqual(getTsCheckDirective('///       @ts-check '), {pos: 0, end: 20, enabled: true});
    });

    it('allows trailing text', () => {
        assert.deepEqual(getTsCheckDirective('//@ts-check false'), {pos: 0, end: 17, enabled: true});
    });

    it('matches case-insensitive', () => {
        assert.deepEqual(getTsCheckDirective('//@Ts-NoChecK'), {pos: 0, end: 13, enabled: false});
    });
});
