import {
    forEachDestructuringIdentifier,
    getPropertyName,
    isBlockScopedVariableDeclarationList,
    isBlockScopeBoundary,
    hasModifier,
    ScopeBoundarySelector,
    ScopeBoundary,
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
            if (node.parent!.parent!.kind === ts.SyntaxKind.IndexSignature || node.originalKeywordKind === ts.SyntaxKind.ThisKeyword)
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
    addVariable(
        identifier: string,
        name: ts.PropertyName,
        selector: ScopeBoundarySelector,
        exported: boolean,
        domain: DeclarationDomain,
    ): void;
    addUse(use: VariableUse, scope?: Scope): void;
    getVariables(): Map<string, InternalVariableInfo>;
    getFunctionScope(): Scope;
    end(cb: VariableCallback): void;
    markExported(name: ts.Identifier, as?: ts.Identifier): void;
    createOrReuseNamespaceScope(name: string, exported: boolean, ambient: boolean, hasExportStatement: boolean): NamespaceScope;
    createOrReuseEnumScope(name: string, exported: boolean): EnumScope;
    getDestinationScope(selector: ScopeBoundarySelector): Scope;
}

abstract class AbstractScope implements Scope {
    protected _variables = new Map<string, InternalVariableInfo>();
    protected _uses: VariableUse[] = [];
    protected _namespaceScopes: Map<string, NamespaceScope> | undefined = undefined;
    private _enumScopes: Map<string, EnumScope> | undefined = undefined;

    constructor(protected _global: boolean) {}

    public addVariable(
        identifier: string,
        name: ts.PropertyName,
        selector: ScopeBoundarySelector,
        exported: boolean,
        domain: DeclarationDomain,
    ) {
        const variables = this.getDestinationScope(selector).getVariables();
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
        this._uses = [];
    }

    protected _applyUse(use: VariableUse, variables = this._variables): boolean {
        const variable = variables.get(use.location.text);
        if (variable === undefined || (variable.domain & use.domain) === 0)
            return false;
        variable.uses.push(use);
        return true;
    }

    public abstract getDestinationScope(selector: ScopeBoundarySelector): Scope;

    protected _addUseToParent(_use: VariableUse) {} // tslint:disable-line:prefer-function-over-method
}

class RootScope extends AbstractScope {
    private _exports: string[] | undefined = undefined;
    private _innerScope = new NonRootScope(this, ScopeBoundary.Function);

    constructor(private _exportAll: boolean, global: boolean) {
        super(global);
    }

    public addVariable(
        identifier: string,
        name: ts.PropertyName,
        selector: ScopeBoundarySelector,
        exported: boolean,
        domain: DeclarationDomain,
    ) {
        if (domain & DeclarationDomain.Import)
            return super.addVariable(identifier, name, selector, exported, domain);
        return this._innerScope.addVariable(identifier, name, selector, exported, domain);
    }

    public addUse(use: VariableUse, origin?: Scope) {
        if (origin === this._innerScope)
            return super.addUse(use);
        return this._innerScope.addUse(use);
    }

    public markExported(id: ts.Identifier) {
        if (this._exports === undefined) {
            this._exports = [id.text];
        } else {
            this._exports.push(id.text);
        }
    }

    public end(cb: VariableCallback) {
        this._innerScope.end((value, key) => {
            value.exported = value.exported || this._exportAll
                || this._exports !== undefined && this._exports.includes(key.text);
            value.inGlobalScope = this._global;
            return cb(value, key, this);
        });
        return super.end((value, key, scope) =>  {
            value.exported = value.exported || scope === this
                && this._exports !== undefined && this._exports.includes(key.text);
            return cb(value, key, scope);
        });
    }

    public getDestinationScope() {
        return this;
    }
}

class NonRootScope extends AbstractScope {
    constructor(protected _parent: Scope, protected _boundary: ScopeBoundary) {
        super(false);
    }

    protected _addUseToParent(use: VariableUse) {
        return this._parent.addUse(use, this);
    }

    public getDestinationScope(selector: ScopeBoundarySelector): Scope {
        return this._boundary & selector
            ? this
            : this._parent.getDestinationScope(selector);
    }
}

class EnumScope extends NonRootScope {
    constructor(parent: Scope) {
        super(parent, ScopeBoundary.Function);
    }

    public end() {
        this._applyUses();
    }
}

const enum ConditionalTypeScopeState {
    Initial,
    Extends,
    TrueType,
    FalseType,
}

class ConditionalTypeScope extends NonRootScope {
    private _state = ConditionalTypeScopeState.Initial;

    constructor(parent: Scope) {
        super(parent, ScopeBoundary.ConditionalType);
    }

    public updateState(newState: ConditionalTypeScopeState) {
        this._state = newState;
    }

    public addUse(use: VariableUse) {
        if (this._state === ConditionalTypeScopeState.TrueType)
            return void this._uses.push(use);
        return this._parent.addUse(use, this);
    }
}

class FunctionScope extends NonRootScope {
    constructor(parent: Scope) {
        super(parent, ScopeBoundary.Function);
    }

    public beginBody() {
        this._applyUses();
    }
}

abstract class AbstractNamedExpressionScope<T extends NonRootScope> extends NonRootScope {
    protected abstract get _innerScope(): T;

    constructor(private _name: ts.Identifier, private _domain: DeclarationDomain, parent: Scope) {
        super(parent, ScopeBoundary.Function);
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
        if (use.domain & this._domain && use.location.text === this._name.text) {
            this._uses.push(use);
        } else {
            return this._parent.addUse(use, this);
        }
    }

    public getFunctionScope() {
        return this._innerScope;
    }

    public getDestinationScope() {
        return this._innerScope;
    }
}

class FunctionExpressionScope extends AbstractNamedExpressionScope<FunctionScope> {
    protected _innerScope = new FunctionScope(this);

    constructor(name: ts.Identifier, parent: Scope) {
        super(name, DeclarationDomain.Value, parent);
    }

    public beginBody() {
        return this._innerScope.beginBody();
    }
}

class ClassExpressionScope extends AbstractNamedExpressionScope<NonRootScope> {
    protected _innerScope = new NonRootScope(this, ScopeBoundary.Function);

    constructor(name: ts.Identifier, parent: Scope) {
        super(name, DeclarationDomain.Value | DeclarationDomain.Type, parent);
    }
}

class BlockScope extends NonRootScope {
    constructor(private _functionScope: Scope, parent: Scope) {
        super(parent, ScopeBoundary.Block);
    }

    public getFunctionScope() {
        return this._functionScope;
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
    private _innerScope = new NonRootScope(this, ScopeBoundary.Function);
    private _exports: Set<string> | undefined = undefined;

    constructor(private _ambient: boolean, private _hasExport: boolean, parent: Scope) {
        super(parent, ScopeBoundary.Function);
    }

    public finish(cb: VariableCallback) {
        return super.end(cb);
    }

    public end(cb: VariableCallback) {
        this._innerScope.end((variable, key, scope) => {
            if (scope !== this._innerScope ||
                !variable.exported && (!this._ambient || this._exports !== undefined && !this._exports.has(key.text)))
                return cb(variable, key, scope);
            const namespaceVar = this._variables.get(key.text);
            if (namespaceVar === undefined) {
                this._variables.set(key.text, {
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
                    if (namespaceVar.uses.includes(use))
                        continue;
                    namespaceVar.uses.push(use);
                }
            }
        });
        this._applyUses();
        this._innerScope = new NonRootScope(this, ScopeBoundary.Function);
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
        this._exports.add(name.text);
    }

    public getDestinationScope(): Scope {
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
            if (isBlockScopeBoundary(node))
                return continueWithScope(node, new BlockScope(this._scope.getFunctionScope(), this._scope), handleBlockScope);
            switch (node.kind) {
                case ts.SyntaxKind.ClassExpression:
                    return continueWithScope(node, (<ts.ClassExpression>node).name !== undefined
                        ? new ClassExpressionScope((<ts.ClassExpression>node).name!, this._scope)
                        : new NonRootScope(this._scope, ScopeBoundary.Function));
                case ts.SyntaxKind.ClassDeclaration:
                    this._handleDeclaration(<ts.ClassDeclaration>node, true, DeclarationDomain.Value | DeclarationDomain.Type);
                    return continueWithScope(node, new NonRootScope(this._scope, ScopeBoundary.Function));
                case ts.SyntaxKind.InterfaceDeclaration:
                case ts.SyntaxKind.TypeAliasDeclaration:
                    this._handleDeclaration(<ts.InterfaceDeclaration | ts.TypeAliasDeclaration>node, true, DeclarationDomain.Type);
                    return continueWithScope(node, new NonRootScope(this._scope, ScopeBoundary.Type));
                case ts.SyntaxKind.EnumDeclaration:
                    this._handleDeclaration(<ts.EnumDeclaration>node, true, DeclarationDomain.Any);
                    return continueWithScope(
                        node,
                        this._scope.createOrReuseEnumScope((<ts.EnumDeclaration>node).name.text,
                                                           hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword)),
                    );
                case ts.SyntaxKind.ModuleDeclaration:
                    return this._handleModule(<ts.ModuleDeclaration>node, continueWithScope);
                case ts.SyntaxKind.MappedType:
                    return continueWithScope(node, new NonRootScope(this._scope, ScopeBoundary.Type));
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
                case ts.SyntaxKind.ConditionalType:
                    return this._handleConditionalType(<ts.ConditionalTypeNode>node, cb, variableCallback);
                // End of Scope specific handling
                case ts.SyntaxKind.VariableDeclarationList:
                    this._handleVariableDeclaration(<ts.VariableDeclarationList>node);
                    break;
                case ts.SyntaxKind.Parameter:
                    if (node.parent!.kind !== ts.SyntaxKind.IndexSignature &&
                        ((<ts.ParameterDeclaration>node).name.kind !== ts.SyntaxKind.Identifier ||
                         (<ts.Identifier>(<ts.NamedDeclaration>node).name).originalKeywordKind !== ts.SyntaxKind.ThisKeyword))
                        this._handleBindingName(<ts.Identifier>(<ts.NamedDeclaration>node).name, false, false);
                    break;
                case ts.SyntaxKind.EnumMember:
                    this._scope.addVariable(
                        getPropertyName((<ts.EnumMember>node).name)!,
                        (<ts.EnumMember>node).name,
                        ScopeBoundarySelector.Function,
                        true,
                        DeclarationDomain.Value,
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
                        (<ts.TypeParameterDeclaration>node).name.text,
                        (<ts.TypeParameterDeclaration>node).name,
                        node.parent!.kind === ts.SyntaxKind.InferType ? ScopeBoundarySelector.InferType : ScopeBoundarySelector.Type,
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
        const continueWithScope = <T extends ts.Node>(node: T, scope: Scope, next: (node: T) => void = forEachChild) => {
            const savedScope = this._scope;
            this._scope = scope;
            next(node);
            this._scope.end(variableCallback);
            this._scope = savedScope;
        };
        const handleBlockScope = (node: ts.Node) => {
            if (node.kind === ts.SyntaxKind.CatchClause && (<ts.CatchClause>node).variableDeclaration !== undefined)
                this._handleBindingName((<ts.CatchClause>node).variableDeclaration!.name, true, false);
            return ts.forEachChild(node, cb);
        };

        ts.forEachChild(sourceFile, cb);
        this._scope.end(variableCallback);
        return this._result;

        function forEachChild(node: ts.Node) {
            return ts.forEachChild(node, cb);
        }
    }

    private _handleConditionalType(node: ts.ConditionalTypeNode, cb: (node: ts.Node) => void, varCb: VariableCallback) {
        const savedScope = this._scope;
        const scope = this._scope = new ConditionalTypeScope(savedScope);
        cb(node.checkType);
        scope.updateState(ConditionalTypeScopeState.Extends);
        cb(node.extendsType);
        scope.updateState(ConditionalTypeScopeState.TrueType);
        cb(node.trueType);
        scope.updateState(ConditionalTypeScopeState.FalseType);
        cb(node.falseType);
        scope.end(varCb);
        this._scope = savedScope;
    }

    private _handleFunctionLikeDeclaration(node: ts.FunctionLikeDeclaration, cb: (node: ts.Node) => void, varCb: VariableCallback) {
        if (node.decorators !== undefined)
            node.decorators.forEach(cb);
        const savedScope = this._scope;
        if (node.kind === ts.SyntaxKind.FunctionDeclaration)
            this._handleDeclaration(node, false, DeclarationDomain.Value);
        const scope = this._scope = node.kind === ts.SyntaxKind.FunctionExpression && node.name !== undefined
            ? new FunctionExpressionScope(node.name, savedScope)
            : new FunctionScope(savedScope);
        if (node.name !== undefined)
            cb(node.name);
        if (node.typeParameters !== undefined)
            node.typeParameters.forEach(cb);
        node.parameters.forEach(cb);
        if (node.type !== undefined)
            cb(node.type);
        if (node.body !== undefined) {
            scope.beginBody();
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
                node.name.text, node.name, ScopeBoundarySelector.Function, exported, DeclarationDomain.Namespace | DeclarationDomain.Value,
            );
            const ambient = hasModifier(node.modifiers, ts.SyntaxKind.DeclareKeyword);
            return next(
                node,
                this._scope.createOrReuseNamespaceScope(
                    node.name.text,
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
            this._scope.addVariable(
                (<ts.Identifier>node.name).text,
                <ts.Identifier>node.name,
                blockScoped ? ScopeBoundarySelector.Block : ScopeBoundarySelector.Function,
                hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword),
                domain,
            );
    }

    private _handleBindingName(name: ts.BindingName, blockScoped: boolean, exported: boolean) {
        if (name.kind === ts.SyntaxKind.Identifier)
            return this._scope.addVariable(
                name.text,
                name,
                blockScoped ? ScopeBoundarySelector.Block : ScopeBoundarySelector.Function,
                exported,
                DeclarationDomain.Value,
            );
        forEachDestructuringIdentifier(name, (declaration) => {
            this._scope.addVariable(
                declaration.name.text,
                declaration.name, blockScoped ? ScopeBoundarySelector.Block : ScopeBoundarySelector.Function,
                exported,
                DeclarationDomain.Value,
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
