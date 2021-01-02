import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { isTokenKind } from '../util/util';

export function findTestFiles(dir: string) {
    const result = fs.readdirSync(dir);
    for (let i = 0; i < result.length; ++i)
        result[i] = path.join(dir, result[i]);
    return result;
}

export function getSourceFile(fileName: string) {
    return ts.createSourceFile(fileName, fs.readFileSync(fileName, 'utf-8'), ts.ScriptTarget.ESNext, true, fileNameToScriptKind(fileName));
}

function fileNameToScriptKind(fileName: string): ts.ScriptKind {
    if (fileName.endsWith('.ts'))
        return ts.ScriptKind.TS;
    if (fileName.endsWith('.js'))
        return ts.ScriptKind.JS;
    if (fileName.endsWith('.tsx'))
        return ts.ScriptKind.TSX;
    if (fileName.endsWith('.jsx'))
        return ts.ScriptKind.JSX;
    return ts.ScriptKind.Unknown;
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

export function getUnreachableStatements(program: ts.Program, sourceFile: ts.SourceFile) {
    const set = new Set<number>();
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile))
        if (diagnostic.code === 7027)
            set.add(diagnostic.start!);
    return set;
}
