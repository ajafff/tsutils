import { assert } from 'chai';
import * as ts from 'typescript';
import { forEachToken, getNextToken, getPreviousToken } from '../util';
import { findTestFiles, getSourceFile, getFirstToken } from './utils';

const testFiles = findTestFiles('test/files/token');

describe('forEachToken', () => {
    it('visits every token in the SourceFile', () => {
        for (const file of testFiles) {
            const sourceFile = getSourceFile(file);
            let result = '';
            forEachToken(sourceFile, (token) => {
                result += sourceFile.text.substring(token.pos, token.end);
            });
            assert.strictEqual(result, sourceFile.text, file);
        }
    });
});

describe('getNextToken', () => {
    it('returns undefined when passed SourceFile or EndOfFileToken', () => {
        const sourceFile = ts.createSourceFile('get-next-token.ts', '', ts.ScriptTarget.ESNext, true);
        assert.isUndefined(getNextToken(sourceFile));
        assert.isUndefined(getNextToken(sourceFile.endOfFileToken));
    });

    it('returns EndOfFileToken even if there is no trivia before EOF', () => {
        const sourceFile = ts.createSourceFile('get-next-token.ts', ';', ts.ScriptTarget.ESNext, true);
        const token = getNextToken(getFirstToken(sourceFile));
        assert.isDefined(token);
        assert.strictEqual(token!.kind, ts.SyntaxKind.EndOfFileToken);
    });

    it('visits every token when called in a loop', () => {
        for (const file of testFiles) {
            const sourceFile = getSourceFile(file);
            let result = '';
            let token: ts.Node | undefined = getFirstToken(sourceFile);
            do {
                result += sourceFile.text.substring(token.pos, token.end);
                token = getNextToken(token, sourceFile);
            } while (token !== undefined);
            assert.strictEqual(result, sourceFile.text, file);
        }
    });
});

describe('getPreviousToken', () => {
    it('returns undefined if there is nothing before the node', () => {
        const sourceFile = ts.createSourceFile('get-previous-token.ts', ';', ts.ScriptTarget.ESNext, true);
        assert.isUndefined(getPreviousToken(sourceFile), 'SourceFile');
        assert.isUndefined(getPreviousToken(sourceFile.statements[0]), 'Statement');
        assert.isUndefined(getPreviousToken(sourceFile.getFirstToken()), 'Token');
        const token = getPreviousToken(sourceFile.endOfFileToken);
        assert.isDefined(token);
        assert.strictEqual(token!.kind, ts.SyntaxKind.SemicolonToken);
        assert.isUndefined(getPreviousToken(token!));
    });

    it('visits every token when called in a loop', () => {
        for (const file of testFiles) {
            const sourceFile = getSourceFile(file);
            let result = '';
            let token: ts.Node | undefined = sourceFile.endOfFileToken;
            do {
                result = sourceFile.text.substring(token.pos, token.end) + result;
                token = getPreviousToken(token, sourceFile);
            } while (token !== undefined);
            assert.strictEqual(result, sourceFile.text, file);
        }
    });
});
