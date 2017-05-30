import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { isTokenKind } from '../util';

export function findTestFiles(dir: string) {
    const result = fs.readdirSync(dir);
    for (let i = 0; i < result.length; ++i)
        result[i] = path.join(dir, result[i]);
    return result;
}

export function getSourceFile(fileName: string) {
    return ts.createSourceFile(fileName, fs.readFileSync(fileName, 'utf-8'), ts.ScriptTarget.ESNext, true);
}

export function getFirstToken(sourceFile: ts.SourceFile) {
    return getFirstTokenWorker(sourceFile, sourceFile)!;
}

function getFirstTokenWorker(current: ts.Node, sourceFile: ts.SourceFile): ts.Node | undefined {
    for (const child of current.getChildren(sourceFile)) {
        if (isTokenKind(child.kind))
            return child;
        const result = getFirstTokenWorker(child, sourceFile);
        if (result !== undefined)
            return result;
    }
}
