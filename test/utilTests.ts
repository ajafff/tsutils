import * as ts from 'typescript';
import { assert } from 'chai';
import { isStatementInAmbientContext } from '..';

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
