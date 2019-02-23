import * as ts from 'typescript';
import { assert } from 'chai';
import { isStatementInAmbientContext, isStrictCompilerOptionEnabled } from '..';
import { isCompilerOptionEnabled, getLineRanges } from '../util';

describe('getLineRanges', () => {
    it('returns content length without line breaks', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            'foo\nbar();\r\nbaz;',
            ts.ScriptTarget.ESNext,
        );
        assert.deepStrictEqual(getLineRanges(sourceFile), [
            {pos: 0, end: 4, contentLength: 3},
            {pos: 4, end: 12, contentLength: 6},
            {pos: 12, end: 16, contentLength: 4},
        ]);
    });

    it('can handle empty files', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            '',
            ts.ScriptTarget.ESNext,
        );
        assert.deepStrictEqual(getLineRanges(sourceFile), [{pos: 0, end: 0, contentLength: 0}]);
    });

    it('can handle line break only', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            '\n',
            ts.ScriptTarget.ESNext,
        );
        assert.deepStrictEqual(getLineRanges(sourceFile), [{pos: 0, end: 1, contentLength: 0}, {pos: 1, end: 1, contentLength: 0}]);
    });

    it('handles empty line at start of file', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            '\na\n\nb\n',
            ts.ScriptTarget.ESNext,
        );
        assert.deepStrictEqual(getLineRanges(sourceFile), [
            {pos: 0, end: 1, contentLength: 0},
            {pos: 1, end: 3, contentLength: 1},
            {pos: 3, end: 4, contentLength: 0},
            {pos: 4, end: 6, contentLength: 1},
            {pos: 6, end: 6, contentLength: 0},
        ]);
    });

    it('handles empty lines correctly', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            '\nfoo\n\nbar\n\n',
            ts.ScriptTarget.ESNext,
        );
        assert.deepStrictEqual(getLineRanges(sourceFile), [
            {pos: 0, end: 1, contentLength: 0},
            {pos: 1, end: 5, contentLength: 3},
            {pos: 5, end: 6, contentLength: 0},
            {pos: 6, end: 10, contentLength: 3},
            {pos: 10, end: 11, contentLength: 0},
            {pos: 11, end: 11, contentLength: 0},
        ]);
    });

    it('handles empty lines with CRLF', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            '\r\nfoo\r\n\r\nbar\r\n\r\n',
            ts.ScriptTarget.ESNext,
        );
        assert.deepStrictEqual(getLineRanges(sourceFile), [
            {pos: 0, end: 2, contentLength: 0},
            {pos: 2, end: 7, contentLength: 3},
            {pos: 7, end: 9, contentLength: 0},
            {pos: 9, end: 14, contentLength: 3},
            {pos: 14, end: 16, contentLength: 0},
            {pos: 16, end: 16, contentLength: 0},
        ]);
    });
});

describe('isStatementInAmbientContext', () => {
    it("doesn't handle declaration files special", () => {
        const sourceFile = ts.createSourceFile(
            'foo.d.ts',
            `declare let foo: string;
interface Foo {}
declare namespace ns {}
`,
            ts.ScriptTarget.ESNext,
            true,
        );
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[0]));
        assert.isFalse(isStatementInAmbientContext(sourceFile.statements[1]));
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[2]));
    });

    it('finds statements in ambient context in external module', () => {
        const sourceFile = ts.createSourceFile(
            'foo.ts',
            `declare let foo: string;  /* 0 */
interface Foo {}                       /* 1 */
declare namespace ns {                 /* 2 */
    let bar: number;                     /* 0 */
}
declare namespace ns.nested {          /* 3 */
    interface Foo {}                     /* 0 */
}
namespace ns {                         /* 4 */
    let baz: boolean;                    /* 0 */
    declare namespace ambient {          /* 1 */
        class Foo {}                       /* 0 */
    }
}
declare module "foo" {                 /* 5 */
    namespace ns {                       /* 0 */
        let variable: any;                 /* 0 */
    }
}
declare global {                       /* 6 */
    let globalVar: never;                /* 0 */
}
`,
            ts.ScriptTarget.ESNext,
            true,
        );
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[0]));
        assert.isFalse(isStatementInAmbientContext(sourceFile.statements[1]));
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[2]));
        assert.isTrue(
            isStatementInAmbientContext((<ts.ModuleBlock>(<ts.NamespaceDeclaration>sourceFile.statements[2]).body).statements[0]),
        );
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[3]));
        assert.isTrue(
            isStatementInAmbientContext((<ts.NamespaceDeclaration>(<ts.NamespaceDeclaration>sourceFile.statements[3]).body)),
        );
        assert.isTrue(
            isStatementInAmbientContext(
                (<ts.ModuleBlock>(<ts.NamespaceDeclaration>(<ts.NamespaceDeclaration>sourceFile.statements[3]).body).body).statements[0],
            ),
        );
        assert.isFalse(isStatementInAmbientContext(sourceFile.statements[4]));
        assert.isFalse(
            isStatementInAmbientContext((<ts.ModuleBlock>(<ts.NamespaceDeclaration>sourceFile.statements[4]).body).statements[0]),
        );
        assert.isTrue(
            isStatementInAmbientContext((<ts.ModuleBlock>(<ts.NamespaceDeclaration>sourceFile.statements[4]).body).statements[1]),
        );
        assert.isTrue(
            isStatementInAmbientContext(
                (<ts.ModuleBlock>(<ts.NamespaceDeclaration>(<ts.ModuleBlock>(<ts.NamespaceDeclaration>
                    sourceFile.statements[4]).body).statements[1]).body).statements[0],
            ),
        );
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[5]));
        assert.isTrue(
            isStatementInAmbientContext((<ts.ModuleBlock>(<ts.NamespaceDeclaration>sourceFile.statements[5]).body).statements[0]),
        );
        assert.isTrue(
            isStatementInAmbientContext(
                (<ts.ModuleBlock>(<ts.NamespaceDeclaration>(<ts.ModuleBlock>(<ts.NamespaceDeclaration>
                    sourceFile.statements[5]).body).statements[0]).body).statements[0],
            ),
        );
        assert.isTrue(isStatementInAmbientContext(sourceFile.statements[6]));
        assert.isTrue(
            isStatementInAmbientContext((<ts.ModuleBlock>(<ts.NamespaceDeclaration>sourceFile.statements[6]).body).statements[0]),
        );
    });
});

describe('isStrictCompilerOptionEnabled', () => {
    it('correctly detects strict flags', () => {
        assert.isTrue(isStrictCompilerOptionEnabled({strict: true}, 'strictNullChecks'));
        assert.isTrue(isStrictCompilerOptionEnabled({strictNullChecks: true}, 'strictNullChecks'));
        assert.isTrue(isStrictCompilerOptionEnabled({strict: false, strictNullChecks: true}, 'strictNullChecks'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: false}, 'strictNullChecks'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: true, strictNullChecks: false}, 'strictNullChecks'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: false, strictNullChecks: false}, 'strictNullChecks'));

        assert.isTrue(isStrictCompilerOptionEnabled({strict: false, strictNullChecks: false, alwaysStrict: true}, 'alwaysStrict'));
    });

    it('knows about strictPropertyInitializations dependency on strictNullChecks', () => {
        assert.isTrue(isStrictCompilerOptionEnabled({strict: true}, 'strictPropertyInitialization'));
        assert.isTrue(
            isStrictCompilerOptionEnabled(
                {strict: false, strictNullChecks: true, strictPropertyInitialization: true},
                'strictPropertyInitialization',
            ),
        );
        assert.isTrue(isStrictCompilerOptionEnabled({strict: true, strictPropertyInitialization: true}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strictPropertyInitialization: true}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strictNullChecks: true}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: false, strictPropertyInitialization: true}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: false, strictNullChecks: true}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: false}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: true, strictPropertyInitialization: false}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: false, strictPropertyInitialization: false}, 'strictPropertyInitialization'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: true, strictNullChecks: false}, 'strictPropertyInitialization'));
    });
});

describe('isCompilerOptionEnabled', () => {
    it('checks if option is enabled', () => {
        assert.isFalse(isCompilerOptionEnabled({}, 'allowJs'));
        assert.isFalse(isCompilerOptionEnabled({allowJs: undefined}, 'allowJs'));
        assert.isFalse(isCompilerOptionEnabled({allowJs: false}, 'allowJs'));
        assert.isTrue(isCompilerOptionEnabled({allowJs: true}, 'allowJs'));
    });

    it('knows composite enables declaration', () => {
        assert.isFalse(isCompilerOptionEnabled({}, 'declaration'));
        assert.isFalse(isCompilerOptionEnabled({declaration: false}, 'declaration'));
        assert.isFalse(isCompilerOptionEnabled({declaration: undefined}, 'declaration'));
        assert.isTrue(isCompilerOptionEnabled({declaration: true}, 'declaration'));

        assert.isFalse(isCompilerOptionEnabled({composite: false}, 'declaration'));
        assert.isFalse(isCompilerOptionEnabled({composite: undefined}, 'declaration'));
        assert.isTrue(isCompilerOptionEnabled({composite: true}, 'declaration'));
        assert.isTrue(isCompilerOptionEnabled({composite: true, declaration: undefined}, 'declaration'));
    });

    it('knows stripInternal can only be used with declaration', () => {
        assert.isFalse(isCompilerOptionEnabled({declaration: true}, 'stripInternal'));
        assert.isFalse(isCompilerOptionEnabled({stripInternal: false}, 'stripInternal'));
        assert.isFalse(isCompilerOptionEnabled({stripInternal: true}, 'stripInternal'));
        assert.isFalse(isCompilerOptionEnabled({stripInternal: true, declaration: false}, 'stripInternal'));
        assert.isTrue(isCompilerOptionEnabled({stripInternal: true, declaration: true}, 'stripInternal'));
        assert.isTrue(isCompilerOptionEnabled({stripInternal: true, composite: true}, 'stripInternal'));
        assert.isFalse(isCompilerOptionEnabled({stripInternal: undefined, composite: true}, 'stripInternal'));
    });

    it('knows suppressImplicitAnyIndexErrors can only be used with noImplicitAny', () => {
        assert.isFalse(isCompilerOptionEnabled({noImplicitAny: true}, 'suppressImplicitAnyIndexErrors'));
        assert.isFalse(isCompilerOptionEnabled({suppressImplicitAnyIndexErrors: false}, 'suppressImplicitAnyIndexErrors'));
        assert.isFalse(isCompilerOptionEnabled({suppressImplicitAnyIndexErrors: true}, 'suppressImplicitAnyIndexErrors'));
        assert.isFalse(
            isCompilerOptionEnabled({suppressImplicitAnyIndexErrors: true, noImplicitAny: false}, 'suppressImplicitAnyIndexErrors'),
        );
        assert.isTrue(
            isCompilerOptionEnabled({suppressImplicitAnyIndexErrors: true, noImplicitAny: true}, 'suppressImplicitAnyIndexErrors'),
        );
        assert.isTrue(isCompilerOptionEnabled({suppressImplicitAnyIndexErrors: true, strict: true}, 'suppressImplicitAnyIndexErrors'));
        assert.isFalse(
            isCompilerOptionEnabled({suppressImplicitAnyIndexErrors: undefined, strict: true}, 'suppressImplicitAnyIndexErrors'),
        );
    });

    it('knows skipLibCheck enables skipDefaultLibCheck', () => {
        assert.isFalse(isCompilerOptionEnabled({}, 'skipDefaultLibCheck'));
        assert.isFalse(isCompilerOptionEnabled({skipDefaultLibCheck: false}, 'skipDefaultLibCheck'));
        assert.isFalse(isCompilerOptionEnabled({skipDefaultLibCheck: undefined}, 'skipDefaultLibCheck'));
        assert.isTrue(isCompilerOptionEnabled({skipDefaultLibCheck: true}, 'skipDefaultLibCheck'));

        assert.isFalse(isCompilerOptionEnabled({skipLibCheck: false}, 'skipDefaultLibCheck'));
        assert.isFalse(isCompilerOptionEnabled({skipLibCheck: undefined}, 'skipDefaultLibCheck'));
        assert.isTrue(isCompilerOptionEnabled({skipLibCheck: true}, 'skipDefaultLibCheck'));
        assert.isTrue(isCompilerOptionEnabled({skipLibCheck: true, skipDefaultLibCheck: undefined}, 'skipDefaultLibCheck'));
    });

    it('delegates strict flags to isStrictCompilerOptionEnabled', () => {
        assert.isTrue(isCompilerOptionEnabled({strict: true}, 'strictNullChecks'));
        assert.isTrue(isCompilerOptionEnabled({strictNullChecks: true}, 'strictNullChecks'));
        assert.isTrue(isCompilerOptionEnabled({strict: false, strictNullChecks: true}, 'strictNullChecks'));
        assert.isFalse(isCompilerOptionEnabled({strict: false}, 'strictNullChecks'));
        assert.isFalse(isCompilerOptionEnabled({strict: true, strictNullChecks: false}, 'strictNullChecks'));
        assert.isFalse(isCompilerOptionEnabled({strict: false, strictNullChecks: false}, 'strictNullChecks'));

        assert.isTrue(isCompilerOptionEnabled({strict: false, strictNullChecks: false, alwaysStrict: true}, 'alwaysStrict'));

        assert.isTrue(isCompilerOptionEnabled({strict: true}, 'strictBindCallApply'));
        assert.isTrue(isStrictCompilerOptionEnabled({strict: false, strictBindCallApply: true}, 'strictBindCallApply'));
        assert.isFalse(isStrictCompilerOptionEnabled({strict: true, strictBindCallApply: false}, 'strictBindCallApply'));
    });

    it('correctly determines allowSyntheticDefaultImports', () => {
        assert.isFalse(isCompilerOptionEnabled({}, 'allowSyntheticDefaultImports'));
        assert.isFalse(
            isCompilerOptionEnabled({allowSyntheticDefaultImports: false, esModuleInterop: true}, 'allowSyntheticDefaultImports'),
        );
        assert.isTrue(
            isCompilerOptionEnabled({allowSyntheticDefaultImports: true, esModuleInterop: false}, 'allowSyntheticDefaultImports'),
        );
        assert.isTrue(isCompilerOptionEnabled({allowSyntheticDefaultImports: true}, 'allowSyntheticDefaultImports'));
        assert.isTrue(isCompilerOptionEnabled({esModuleInterop: true}, 'allowSyntheticDefaultImports'));
        assert.isFalse(isCompilerOptionEnabled({esModuleInterop: false}, 'allowSyntheticDefaultImports'));
        assert.isTrue(isCompilerOptionEnabled({esModuleInterop: false, module: ts.ModuleKind.System}, 'allowSyntheticDefaultImports'));
        assert.isTrue(isCompilerOptionEnabled({module: ts.ModuleKind.System}, 'allowSyntheticDefaultImports'));
        assert.isFalse(isCompilerOptionEnabled({esModuleInterop: false, module: ts.ModuleKind.ES2015}, 'allowSyntheticDefaultImports'));
    });
});
