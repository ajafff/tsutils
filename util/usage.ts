import {
    forEachDestructuringIdentifier,
    getPropertyName,
    isBlockScopedVariableDeclarationList,
    isBlockScopeBoundary,
    hasModifier,
    getIdentifierText,
} from './util';
import * as ts from 'typescript';

interface DeclarationInfo {
    declaration: ts.PropertyName;
    domain: DeclarationDomain;
    exported: boolean;
}

interface InternalVariableInfo {
    domain: DeclarationDomain;
    declarations: DeclarationInfo[];
    uses: VariableUse[];
}

export interface VariableInfo {
    domain: DeclarationDomain;
    exported: boolean;
    uses: VariableUse[];
    inGlobalScope: boolean;
    declarations: ts.Identifier[];
}

export interface VariableUse {
    domain: UsageDomain;
    location: ts.Identifier;
}

export const enum DeclarationDomain {
    Namespace = 1,
    Type = 2,
    Value = 4,
    Import = 8,
    Any = Namespace | Type | Value,
}

export const enum UsageDomain {
    Namespace = 1,
    Type = 2,
    Value = 4,
    ValueOrNamespace = Value | Namespace,
    Any = Namespace | Type | Value,
    TypeQuery = 8,
}

export function getUsageDomain(node: ts.Identifier): UsageDomain | undefined {
    const parent = node.parent!;
    switch (parent.kind) {
        case ts.SyntaxKind.TypeReference:
        case ts.SyntaxKind.TypeOperator:
            return UsageDomain.Type;
        case ts.SyntaxKind.ExpressionWithTypeArguments:
            return (<ts.HeritageClause>parent.parent).token === ts.SyntaxKind.ImplementsKeyword ||
                parent.parent!.parent!.kind === ts.SyntaxKind.InterfaceDeclaration
                ? UsageDomain.Type
                : UsageDomain.Value;
        case ts.SyntaxKind.TypeQuery:
            return UsageDomain.ValueOrNamespace | UsageDomain.TypeQuery;
        case ts.SyntaxKind.QualifiedName:
            if ((<ts.QualifiedName>parent).left === node) {
                if (getEntityNameParent(<ts.QualifiedName>parent).kind === ts.SyntaxKind.TypeQuery)
                    return UsageDomain.Namespace | UsageDomain.TypeQuery;
                return UsageDomain.Namespace;
            }
            break;
        case ts.SyntaxKind.NamespaceExportDeclaration:
            return UsageDomain.Namespace;
        case ts.SyntaxKind.ExportSpecifier:
            // either {name} or {propertyName as name}
            if ((<ts.ExportSpecifier>parent).propertyName === undefined ||
                (<ts.ExportSpecifier>parent).propertyName === node)
                return UsageDomain.Any;
            break;
        case ts.SyntaxKind.ExportAssignment:
            return UsageDomain.Any;
        // Value
        case ts.SyntaxKind.BindingElement:
            if ((<ts.BindingElement>parent).initializer === node)
                return UsageDomain.ValueOrNamespace;
            break;
        case ts.SyntaxKind.Parameter:
        case ts.SyntaxKind.EnumMember:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.VariableDeclaration:
        case ts.SyntaxKind.PropertyAssignment:
        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.ImportEqualsDeclaration:
            if ((<ts.NamedDeclaration>parent).name !== node)
                return UsageDomain.ValueOrNamespace;
            break;
        case ts.SyntaxKind.JsxAttribute:
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.FunctionExpression:
        case ts.SyntaxKind.NamespaceImport:
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
        case ts.SyntaxKind.ModuleDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.EnumDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.LabeledStatement:
        case ts.SyntaxKind.BreakStatement:
        case ts.SyntaxKind.ContinueStatement:
        case ts.SyntaxKind.ImportClause:
        case ts.SyntaxKind.ImportSpecifier:
        case ts.SyntaxKind.TypePredicate:
        case ts.SyntaxKind.MethodSignature:
        case ts.SyntaxKind.PropertySignature:
        case ts.SyntaxKind.NamespaceExportDeclaration:
        case ts.SyntaxKind.QualifiedName:
        case ts.SyntaxKind.TypeReference:
        case ts.SyntaxKind.TypeOperator:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.TypeParameter:
            break;
        default:
            return UsageDomain.ValueOrNamespace;
    }
}

export function getDeclarationDomain(node: ts.Identifier): DeclarationDomain | undefined {
    switch (node.parent!.kind) {
        case ts.SyntaxKind.TypeParameter:
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
            return DeclarationDomain.Type;
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.ClassExpression:
            return DeclarationDomain.Type | DeclarationDomain.Value;
        case ts.SyntaxKind.EnumDeclaration:
            return DeclarationDomain.Any;
        case ts.SyntaxKind.NamespaceImport:
        case ts.SyntaxKind.ImportClause:
            return DeclarationDomain.Any | DeclarationDomain.Import;
        case ts.SyntaxKind.ImportEqualsDeclaration:
        case ts.SyntaxKind.ImportSpecifier:
            return (<ts.ImportEqualsDeclaration | ts.ImportSpecifier>node.parent).name === node
                ? DeclarationDomain.Any | DeclarationDomain.Import
                : undefined;
        case ts.SyntaxKind.ModuleDeclaration:
            return DeclarationDomain.Namespace;
        case ts.SyntaxKind.Parameter:
            if (node.parent!.parent!.kind === ts.SyntaxKind.IndexSignature)
                return;
            // falls through
        case ts.SyntaxKind.BindingElement:
        case ts.SyntaxKind.VariableDeclaration:
            return (<ts.VariableLikeDeclaration>node.parent).name === node ? DeclarationDomain.Value : undefined;
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.FunctionExpression:
            return DeclarationDomain.Value;
    }
}

export function collectVariableUsage(sourceFile: ts.SourceFile) {
    return new UsageWalker().getUsage(sourceFile);
}

type VariableCallback = (variable: VariableInfo, key: ts.Identifier, scope: Scope) => void;

interface Scope {
    addVariable(identifier: string, name: ts.PropertyName, blockScoped: boolean, exported: boolean, domain: DeclarationDomain): void;
    addUse(use: VariableUse, scope?: Scope): void;
    getVariables(): Map<string, InternalVariableInfo>;
    getFunctionScope(): Scope;
    end(cb: VariableCallback): void;
    markExported(name: ts.Identifier, as?: ts.Identifier): void;
    createOrReuseNamespaceScope(name: string, exported: boolean, ambient: boolean, hasExportStatement: boolean): NamespaceScope;
    createOrReuseEnumScope(name: string, exported: boolean): EnumScope;
}

abstract class AbstractScope implements Scope {
    protected _variables = new Map<string, InternalVariableInfo>();
    protected _uses: VariableUse[] = [];
    protected _namespaceScopes: Map<string, NamespaceScope> | undefined = undefined;
    private _enumScopes: Map<string, EnumScope> | undefined = undefined;

    constructor(protected _global: boolean) {}

    public addVariable(identifier: string, name: ts.PropertyName, blockScoped: boolean, exported: boolean, domain: DeclarationDomain) {
        const variables = this._getDestinationScope(blockScoped).getVariables();
        const declaration: DeclarationInfo = {
            domain,
            exported,
            declaration: name,
        };
        const variable = variables.get(identifier);
        if (variable === undefined) {
            variables.set(identifier, {
                domain,
                declarations: [declaration],
                uses: [],
            });
        } else {
            variable.domain |= domain;
            variable.declarations.push(declaration);
        }
    }

    public addUse(use: VariableUse) {
        this._uses.push(use);
    }

    public getVariables() {
        return this._variables;
    }

    public getFunctionScope(): Scope {
        return this;
    }

    public end(cb: VariableCallback) {
        if (this._namespaceScopes !== undefined)
            this._namespaceScopes.forEach((value) => value.finish(cb));
        this._namespaceScopes = this._enumScopes = undefined;
        this._applyUses();
        this._variables.forEach((variable) => {
            for (const declaration of variable.declarations) {
                const result: VariableInfo = {
                    declarations: [],
                    domain: declaration.domain,
                    exported: declaration.exported,
                    inGlobalScope: this._global,
                    uses: [],
                };
                for (const other of variable.declarations)
                    if (other.domain & declaration.domain)
                        result.declarations.push(<ts.Identifier>other.declaration);
                for (const use of variable.uses)
                    if (use.domain & declaration.domain)
                        result.uses.push(use);
                cb(result, <ts.Identifier>declaration.declaration, this);
            }
        });
    }

    // tslint:disable-next-line:prefer-function-over-method
    public markExported(_name: ts.Identifier) {} // only relevant for the root scope

    public createOrReuseNamespaceScope(name: string, _exported: boolean, ambient: boolean, hasExportStatement: boolean): NamespaceScope {
        let scope: NamespaceScope | undefined;
        if (this._namespaceScopes === undefined) {
            this._namespaceScopes = new Map();
        } else {
            scope = this._namespaceScopes.get(name);
        }
        if (scope === undefined) {
            scope = new NamespaceScope(ambient, hasExportStatement, this);
            this._namespaceScopes.set(name, scope);
        } else {
            scope.refresh(ambient, hasExportStatement);
        }
        return scope;
    }

    public createOrReuseEnumScope(name: string, _exported: boolean): EnumScope {
        let scope: EnumScope | undefined;
        if (this._enumScopes === undefined) {
            this._enumScopes = new Map();
        } else {
            scope = this._enumScopes.get(name);
        }
        if (scope === undefined) {
            scope = new EnumScope(this);
            this._enumScopes.set(name, scope);
        }
        return scope;
    }

    protected _applyUses() {
        for (const use of this._uses)
            if (!this._applyUse(use))
                this._addUseToParent(use);
    }

    protected _applyUse(use: VariableUse, variables = this._variables): boolean {
        const variable = variables.get(getIdentifierText(use.location));
        if (variable === undefined || (variable.domain & use.domain) === 0)
            return false;
        variable.uses.push(use);
        return true;
    }

    protected _getDestinationScope(_blockScoped: boolean): Scope {
        return this;
    }

    protected _addUseToParent(_use: VariableUse) {} // tslint:disable-line:prefer-function-over-method
}

class RootScope extends AbstractScope {
    private _exports: string[] | undefined = undefined;
    private _innerScope = new NonRootScope(this);

    constructor(private _exportAll: boolean, global: boolean) {
        super(global);
    }

    public addVariable(identifier: string, name: ts.PropertyName, blockScoped: boolean, exported: boolean, domain: DeclarationDomain) {
        if (domain & DeclarationDomain.Import)
            return super.addVariable(identifier, name, blockScoped, exported, domain);
        return this._innerScope.addVariable(identifier, name, blockScoped, exported, domain);
    }

    public addUse(use: VariableUse, origin?: Scope) {
        if (origin === this._innerScope)
            return super.addUse(use);
        return this._innerScope.addUse(use);
    }

    public markExported(id: ts.Identifier) {
        const text = getIdentifierText(id);
        if (this._exports === undefined) {
            this._exports = [text];
        } else {
            this._exports.push(text);
        }
    }

    public end(cb: VariableCallback) {
        this._innerScope.end((value, key) => {
            value.exported = value.exported || this._exportAll
                || this._exports !== undefined && this._exports.indexOf(getIdentifierText(key)) !== -1;
            value.inGlobalScope = this._global;
            return cb(value, key, this);
        });
        return super.end((value, key, scope) =>  {
            value.exported = value.exported || scope === this
                && this._exports !== undefined && this._exports.indexOf(getIdentifierText(key)) !== -1;
            return cb(value, key, scope);
        });
    }
}

class NonRootScope extends AbstractScope {
    constructor(protected _parent: Scope) {
        super(false);
    }

    protected _addUseToParent(use: VariableUse) {
        return this._parent.addUse(use, this);
    }
}

class EnumScope extends NonRootScope {
    public end() {
        this._applyUses();
        this._uses = [];
    }
}

const enum FunctionScopeState {
    Initial,
    Parameter,
    ReturnType,
    Body,
}

class FunctionScope extends NonRootScope {
    private _innerScope = new NonRootScope(this);
    private _state = FunctionScopeState.Initial;

    public end(cb: VariableCallback) {
        this._innerScope.end(cb);
        super.end(cb);
    }

    public updateState(newState: FunctionScopeState) {
        this._state = newState;
    }

    public addUse(use: VariableUse, source?: Scope) {
        if (source === this._innerScope)
            return void this._uses.push(use);
        switch (this._state) {
            case FunctionScopeState.Parameter:
                if ((use.domain & UsageDomain.Value) === 0 || use.domain & UsageDomain.TypeQuery)
                    return void this._uses.push(use);
                if (this._applyUse(use) || this._applyUse(use, this._innerScope.getVariables()))
                    return;
                break;
            case FunctionScopeState.ReturnType:
                if (this._applyUse(use))
                    return;
                break;
            case FunctionScopeState.Body:
                return this._innerScope.addUse(use);
            case FunctionScopeState.Initial:
                return void this._uses.push(use);

        }
        return this._parent.addUse(use, this);
    }

    protected _getDestinationScope(blockScoped: boolean): Scope {
        return blockScoped ? this._innerScope : this;
    }
}

abstract class AbstractNamedExpressionScope<T extends NonRootScope> extends NonRootScope {
    protected abstract get _innerScope(): T;

    constructor(private _name: ts.Identifier, private _domain: DeclarationDomain, parent: Scope) {
        super(parent);
    }

    public end(cb: VariableCallback) {
        this._innerScope.end(cb);
        return cb(
            {
                declarations: [this._name],
                domain: this._domain,
                exported: false,
                uses: this._uses,
                inGlobalScope: false,
            },
            this._name,
            this,
        );
    }

    public addUse(use: VariableUse, source?: Scope) {
        if (source !== this._innerScope)
            return this._innerScope.addUse(use);
        if (use.domain & this._domain && getIdentifierText(use.location) === getIdentifierText(this._name)) {
            this._uses.push(use);
        } else {
            return this._parent.addUse(use, this);
        }
    }

    public getFunctionScope() {
        return this._innerScope;
    }

    protected _getDestinationScope() {
        return this._innerScope;
    }
}

class FunctionExpressionScope extends AbstractNamedExpressionScope<FunctionScope> {
    protected _innerScope = new FunctionScope(this);

    constructor(name: ts.Identifier, parent: Scope) {
        super(name, DeclarationDomain.Value, parent);
    }

    public updateState(newState: FunctionScopeState) {
        return this._innerScope.updateState(newState);
    }
}

class ClassExpressionScope extends AbstractNamedExpressionScope<NonRootScope> {
    protected _innerScope = new NonRootScope(this);

    constructor(name: ts.Identifier, parent: Scope) {
        super(name, DeclarationDomain.Value | DeclarationDomain.Type, parent);
    }
}

class BlockScope extends NonRootScope {
    constructor(private _functionScope: Scope, parent: Scope) {
        super(parent);
    }

    public getFunctionScope() {
        return this._functionScope;
    }

    protected _getDestinationScope(blockScoped: boolean) {
        return blockScoped ? this : this._functionScope;
    }
}

function mapDeclaration(declaration: ts.Identifier): DeclarationInfo {
    return {
        declaration,
        exported: true,
        domain: getDeclarationDomain(declaration)!,
    };
}

class NamespaceScope extends NonRootScope {
    private _innerScope = new NonRootScope(this);
    private _exports: Set<string> | undefined = undefined;

    constructor(private _ambient: boolean, private _hasExport: boolean, parent: Scope) {
        super(parent);
    }

    public finish(cb: VariableCallback) {
        return super.end(cb);
    }

    public end(cb: VariableCallback) {
        this._innerScope.end((variable, key, scope) => {
            if (scope !== this._innerScope ||
                !variable.exported && (!this._ambient || this._exports !== undefined && !this._exports.has(getIdentifierText(key))))
                return cb(variable, key, scope);
            const namespaceVar = this._variables.get(getIdentifierText(key));
            if (namespaceVar === undefined) {
                this._variables.set(getIdentifierText(key), {
                    declarations: variable.declarations.map(mapDeclaration),
                    domain: variable.domain,
                    uses: [...variable.uses],
                });
            } else {
                outer: for (const declaration of variable.declarations) {
                    for (const existing of namespaceVar.declarations)
                        if (existing.declaration === declaration)
                            continue outer;
                    namespaceVar.declarations.push(mapDeclaration(declaration));
                }
                namespaceVar.domain |= variable.domain;
                for (const use of variable.uses) {
                    if (namespaceVar.uses.indexOf(use) !== - 1)
                        continue;
                    namespaceVar.uses.push(use);
                }
            }
        });
        this._applyUses();
        this._innerScope = new NonRootScope(this);
        this._uses = [];
    }

    public createOrReuseNamespaceScope(name: string, exported: boolean, ambient: boolean, hasExportStatement: boolean): NamespaceScope {
        if (!exported && (!this._ambient || this._hasExport))
            return this._innerScope.createOrReuseNamespaceScope(name, exported, ambient || this._ambient, hasExportStatement);
        return super.createOrReuseNamespaceScope(name, exported, ambient || this._ambient, hasExportStatement);
    }

    public createOrReuseEnumScope(name: string, exported: boolean): EnumScope {
        if (!exported && (!this._ambient || this._hasExport))
            return this._innerScope.createOrReuseEnumScope(name, exported);
        return super.createOrReuseEnumScope(name, exported);
    }

    public addUse(use: VariableUse, source?: Scope) {
        if (source !== this._innerScope)
            return this._innerScope.addUse(use);
        this._uses.push(use);
    }

    public refresh(ambient: boolean, hasExport: boolean) {
        this._ambient = ambient;
        this._hasExport = hasExport;
    }

    public markExported(name: ts.Identifier, _as?: ts.Identifier) {
        if (this._exports === undefined)
            this._exports = new Set();
        this._exports.add(getIdentifierText(name));
    }

    protected _getDestinationScope() {
        return this._innerScope;
    }
}

function getEntityNameParent(name: ts.EntityName) {
    let parent = name.parent!;
    while (parent.kind === ts.SyntaxKind.QualifiedName)
        parent = parent.parent!;
    return parent;
}

class UsageWalker {
    private _result = new Map<ts.Identifier, VariableInfo>();
    private _scope: Scope;
    public getUsage(sourceFile: ts.SourceFile) {
        const variableCallback = (variable: VariableInfo, key: ts.Identifier) => {
            this._result.set(key, variable);
        };
        const isModule = ts.isExternalModule(sourceFile);
        this._scope = new RootScope(
            sourceFile.isDeclarationFile && isModule && !containsExportStatement(sourceFile),
            !isModule,
        );
        const cb = (node: ts.Node): void => {
            if (isBlockScopeBoundary(node)) {
                if (node.kind === ts.SyntaxKind.CatchClause && (<ts.CatchClause>node).variableDeclaration !== undefined)
                    this._handleBindingName((<ts.CatchClause>node).variableDeclaration!.name, true, false);
                return continueWithScope(node, new BlockScope(this._scope.getFunctionScope(), this._scope));
            }
            switch (node.kind) {
                case ts.SyntaxKind.ClassExpression:
                    return continueWithScope(node, (<ts.ClassExpression>node).name !== undefined
                        ? new ClassExpressionScope((<ts.ClassExpression>node).name!, this._scope)
                        : new NonRootScope(this._scope));
                case ts.SyntaxKind.ClassDeclaration:
                    this._handleDeclaration(<ts.ClassDeclaration>node, true, DeclarationDomain.Value | DeclarationDomain.Type);
                    return continueWithScope(node, new NonRootScope(this._scope));
                case ts.SyntaxKind.InterfaceDeclaration:
                case ts.SyntaxKind.TypeAliasDeclaration:
                    this._handleDeclaration(<ts.InterfaceDeclaration | ts.TypeAliasDeclaration>node, true, DeclarationDomain.Type);
                    return continueWithScope(node, new NonRootScope(this._scope));
                case ts.SyntaxKind.EnumDeclaration:
                    this._handleDeclaration(<ts.EnumDeclaration>node, true, DeclarationDomain.Any);
                    return continueWithScope(
                        node,
                        this._scope.createOrReuseEnumScope(getIdentifierText((<ts.EnumDeclaration>node).name),
                                                           hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword)),
                    );
                case ts.SyntaxKind.ModuleDeclaration:
                    return this._handleModule(<ts.ModuleDeclaration>node, continueWithScope);
                case ts.SyntaxKind.MappedType:
                    return continueWithScope(node, new NonRootScope(this._scope));
                case ts.SyntaxKind.FunctionExpression:
                case ts.SyntaxKind.ArrowFunction:
                case ts.SyntaxKind.Constructor:
                case ts.SyntaxKind.MethodDeclaration:
                case ts.SyntaxKind.FunctionDeclaration:
                case ts.SyntaxKind.GetAccessor:
                case ts.SyntaxKind.SetAccessor:
                case ts.SyntaxKind.MethodSignature:
                case ts.SyntaxKind.CallSignature:
                case ts.SyntaxKind.ConstructSignature:
                case ts.SyntaxKind.ConstructorType:
                case ts.SyntaxKind.FunctionType:
                    return this._handleFunctionLikeDeclaration(<ts.FunctionLikeDeclaration>node, cb, variableCallback);
                // End of Scope specific handling
                case ts.SyntaxKind.VariableDeclarationList:
                    this._handleVariableDeclaration(<ts.VariableDeclarationList>node);
                    break;
                case ts.SyntaxKind.Parameter:
                    if (node.parent!.kind !== ts.SyntaxKind.IndexSignature &&
                        ((<ts.ParameterDeclaration>node).name.kind !== ts.SyntaxKind.Identifier ||
                         (<ts.Identifier>(<ts.NamedDeclaration>node).name).originalKeywordKind !== ts.SyntaxKind.ThisKeyword))
                        this._handleBindingName(<ts.Identifier>(<ts.NamedDeclaration>node).name, false, false, true);
                    break;
                case ts.SyntaxKind.EnumMember:
                    this._scope.addVariable(
                        getPropertyName((<ts.EnumMember>node).name)!, (<ts.EnumMember>node).name, false, true, DeclarationDomain.Value,
                    );
                    break;
                case ts.SyntaxKind.ImportClause:
                case ts.SyntaxKind.ImportSpecifier:
                case ts.SyntaxKind.NamespaceImport:
                case ts.SyntaxKind.ImportEqualsDeclaration:
                    this._handleDeclaration(<ts.NamedDeclaration>node, false, DeclarationDomain.Any | DeclarationDomain.Import);
                    break;
                case ts.SyntaxKind.TypeParameter:
                    this._scope.addVariable(
                        getIdentifierText((<ts.TypeParameterDeclaration>node).name),
                        (<ts.TypeParameterDeclaration>node).name, false,
                        false,
                        DeclarationDomain.Type,
                    );
                    break;
                case ts.SyntaxKind.ExportSpecifier:
                    if ((<ts.ExportSpecifier>node).propertyName !== undefined)
                        return this._scope.markExported((<ts.ExportSpecifier>node).propertyName!, (<ts.ExportSpecifier>node).name);
                    return this._scope.markExported((<ts.ExportSpecifier>node).name);
                case ts.SyntaxKind.ExportAssignment:
                    if ((<ts.ExportAssignment>node).expression.kind === ts.SyntaxKind.Identifier)
                        return this._scope.markExported(<ts.Identifier>(<ts.ExportAssignment>node).expression);
                    break;
                case ts.SyntaxKind.Identifier:
                    const domain = getUsageDomain(<ts.Identifier>node);
                    if (domain !== undefined)
                        this._scope.addUse({domain, location: <ts.Identifier>node});
                    return;

            }

            return ts.forEachChild(node, cb);
        };
        const continueWithScope = (node: ts.Node, scope: Scope) => {
            const savedScope = this._scope;
            this._scope = scope;
            ts.forEachChild(node, cb);
            this._scope.end(variableCallback);
            this._scope = savedScope;
        };

        ts.forEachChild(sourceFile, cb);
        this._scope.end(variableCallback);
        return this._result;

    }

    private _handleFunctionLikeDeclaration(node: ts.FunctionLikeDeclaration, cb: (node: ts.Node) => void, varCb: VariableCallback) {
        if (node.decorators !== undefined)
            node.decorators.forEach(cb);
        const savedScope = this._scope;
        if (node.kind === ts.SyntaxKind.FunctionDeclaration)
            this._handleDeclaration(node, false, DeclarationDomain.Value);
        const scope = this._scope = node.kind === ts.SyntaxKind.FunctionExpression && node.name !== undefined
            ? new FunctionExpressionScope(<ts.Identifier>node.name, savedScope)
            : new FunctionScope(savedScope);
        if (node.name !== undefined)
            cb(node.name);
        if (node.typeParameters !== undefined)
            node.typeParameters.forEach(cb);
        scope.updateState(FunctionScopeState.Parameter);
        node.parameters.forEach(cb);
        if (node.type !== undefined) {
            scope.updateState(FunctionScopeState.ReturnType);
            cb(node.type);
        }
        if (node.body !== undefined) {
            scope.updateState(FunctionScopeState.Body);
            cb(node.body);
        }
        scope.end(varCb);
        this._scope = savedScope;
    }

    private _handleModule(node: ts.ModuleDeclaration, next: (node: ts.Node, scope: Scope) => void) {
        if (node.flags & ts.NodeFlags.GlobalAugmentation)
            return next(
                node,
                this._scope.createOrReuseNamespaceScope(
                    '-global',
                    false,
                    true,
                    false,
                ),
        );
        if (node.name.kind === ts.SyntaxKind.Identifier) {
            const exported = isNamespaceExported(<ts.NamespaceDeclaration>node);
            this._scope.addVariable(
                getIdentifierText(node.name), node.name, false, exported, DeclarationDomain.Namespace | DeclarationDomain.Value,
            );
            const ambient = hasModifier(node.modifiers, ts.SyntaxKind.DeclareKeyword);
            return next(
                node,
                this._scope.createOrReuseNamespaceScope(
                    getIdentifierText(node.name),
                    exported,
                    ambient,
                    ambient && namespaceHasExportStatement(node),
                ),
            );
        }
        return next(
            node,
            this._scope.createOrReuseNamespaceScope(
                `"${node.name.text}"`,
                false,
                true,
                namespaceHasExportStatement(node),
            ),
        );
    }

    private _handleDeclaration(node: ts.NamedDeclaration, blockScoped: boolean, domain: DeclarationDomain) {
        if (node.name !== undefined)
            this._scope.addVariable(getIdentifierText(<ts.Identifier>node.name), <ts.Identifier>node.name, blockScoped,
                                    hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword), domain);
    }

    private _handleBindingName(name: ts.BindingName, blockScoped: boolean, exported: boolean, isParameter?: boolean) {
        if (name.kind === ts.SyntaxKind.Identifier)
            return this._scope.addVariable(getIdentifierText(name), name, blockScoped, exported, DeclarationDomain.Value);
        forEachDestructuringIdentifier(name, (declaration) => {
            this._scope.addVariable(
                getIdentifierText(declaration.name), declaration.name, isParameter || blockScoped, exported, DeclarationDomain.Value,
            );
        });
    }

    private _handleVariableDeclaration(declarationList: ts.VariableDeclarationList) {
        const blockScoped = isBlockScopedVariableDeclarationList(declarationList);
        const exported = declarationList.parent!.kind === ts.SyntaxKind.VariableStatement &&
            hasModifier(declarationList.parent!.modifiers, ts.SyntaxKind.ExportKeyword);
        for (const declaration of declarationList.declarations)
            this._handleBindingName(declaration.name, blockScoped, exported);
    }
}

function isNamespaceExported(node: ts.NamespaceDeclaration) {
    return node.parent!.kind === ts.SyntaxKind.ModuleDeclaration || hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword);
}

function namespaceHasExportStatement(ns: ts.ModuleDeclaration): boolean {
    if (ns.body === undefined || ns.body.kind !== ts.SyntaxKind.ModuleBlock)
        return false;
    return containsExportStatement(ns.body);
}

function containsExportStatement(block: ts.BlockLike): boolean {
    for (const statement of block.statements)
        if (statement.kind === ts.SyntaxKind.ExportDeclaration || statement.kind === ts.SyntaxKind.ExportAssignment)
            return true;
    return false;
}
