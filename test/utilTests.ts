import * as ts from 'typescript';
import { assert } from 'chai';
import { isStatementInAmbientContext, isStrictCompilerOptionEnabled } from '..';

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
