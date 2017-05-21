import {
    isInterfaceDeclaration,
    isParameterDeclaration,
    isTypeAliasDeclaration,
    isTypeParameterDeclaration,
    isEnumMember,
    isFunctionDeclaration,
    isFunctionExpression,
    isModuleDeclaration,
    isClassLikeDeclaration,
    isEnumDeclaration,
    isIdentifier,
    isImportClause,
    isImportEqualsDeclaration,
    isImportSpecifier,
    isNamespaceImport,
    isExportSpecifier,
    isExportAssignment,
} from '../typeguard/node';
import {
    forEachDestructuringIdentifier,
    isParameterProperty,
    getPropertyName,
    isBlockScopedVariableDeclarationList,
    isScopeBoundary,
    ScopeBoundary,
    hasModifier,
    isFunctionWithBody,
} from './util';
import * as ts from 'typescript';

export interface VariableInfo {
    domain: DeclarationDomain;
    declarations: ts.PropertyName[];
    exported: boolean;
    uses: VariableUse[];
    inGlobalScope: boolean;
}

export interface VariableUse {
    domain: UsageDomain;
    location: ts.Identifier;
}

export const enum DeclarationDomain {
    Namespace = 1,
    Type = 2,
    Value = 4,
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
        case ts.SyntaxKind.EnumMember:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.Parameter:
        case ts.SyntaxKind.VariableDeclaration:
        case ts.SyntaxKind.PropertyAssignment:
        case ts.SyntaxKind.PropertyAccessExpression:
        case ts.SyntaxKind.ImportEqualsDeclaration:
            if ((<ts.Declaration>parent).name !== node)
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

export function collectVariableUsage(sourceFile: ts.SourceFile) {
    return new UsageWalker().getUsage(sourceFile);
}

type VariableCallback = (variable: VariableInfo, key: string) => void;

interface Scope {
    addVariable(identifier: string, name: ts.PropertyName, blockScoped: boolean, exported: boolean, domain: DeclarationDomain): void;
    addUse(use: VariableUse): void;
    getVariables(): Map<string, VariableInfo>;
    getFunctionScope(): Scope;
    end(cb: VariableCallback): void;
    settle(): void;
    markExported(name: ts.Identifier): void;
    createOrReuseNamespaceScope(name: string, exported: boolean): NamespaceScope;
    createOrReuseEnumScope(name: string, exported: boolean): EnumScope;
}

abstract class AbstractScope implements Scope {
    protected _variables = new Map<string, VariableInfo>();
    protected _uses: VariableUse[] = [];
    protected _namespaceScopes: Map<string, NamespaceScope> | undefined = undefined;
    private _enumScopes: Map<string, EnumScope> | undefined = undefined;

    constructor(private _global: boolean) {}

    public addVariable(identifier: string, name: ts.PropertyName, blockScoped: boolean, exported: boolean, domain: DeclarationDomain) {
        const variables = this._getDestinationScope(blockScoped).getVariables();
        let variable = variables.get(identifier);
        if (variable === undefined) {
            variable = {
                domain,
                exported,
                declarations: [name],
                uses: [],
                inGlobalScope: this._global,
            };
            variables.set(identifier, variable);
        } else {
            variable.domain |= domain;
            variable.declarations.push(name);
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
        for (const use of this._uses) {
            const variable = this._variables.get(use.location.text);
            if (variable !== undefined && variable.domain & use.domain) {
                variable.uses.push(use);
            } else {
                this._addUseToParent(use);
            }
        }
        return this._variables.forEach(cb);
    }

    public settle() { // tslint:disable-line:prefer-function-over-method
        throw new Error('not supported');
    }

    // tslint:disable-next-line:prefer-function-over-method
    public markExported(_name: ts.Identifier) {} // only relevant for the root scope

    public createOrReuseNamespaceScope(name: string, _exported: boolean): NamespaceScope {
        let scope: NamespaceScope | undefined;
        if (this._namespaceScopes === undefined) {
            this._namespaceScopes = new Map();
        } else {
            scope = this._namespaceScopes.get(name);
        }
        if (scope === undefined) {
            scope = new NamespaceScope(this);
            this._namespaceScopes.set(name, scope);
        } else {
            scope.refresh(this);
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
        } else {
            scope.refresh();
        }
        return scope;
    }

    protected _getDestinationScope(_blockScoped: boolean): Scope {
        return this;
    }

    protected _addUseToParent(_use: VariableUse) {} // tslint:disable-line:prefer-function-over-method
}

class RootScope extends AbstractScope {
    private _exports: string[] | undefined = undefined;

    public markExported({text}: ts.Identifier) {
        const variable = this._variables.get(text);
        if (variable !== undefined) {
            variable.exported = true;
        } else if (this._exports === undefined) {
            this._exports = [text];
        } else {
            this._exports.push(text);
        }
    }

    public end(cb: VariableCallback) {
        if (this._exports !== undefined) {
            for (const exported of this._exports) {
                const variable = this._variables.get(exported);
                if (variable !== undefined)
                    variable.exported = true;
            }
        }
        return super.end(cb);
    }
}

class NonRootScope<T extends Scope = Scope> extends AbstractScope {
    constructor(protected _parent: T) {
        super(false);
    }

    protected _addUseToParent(use: VariableUse) {
        return this._parent.addUse(use);
    }
}

class EnumScope extends NonRootScope {
    public end() {
        super.end(() => {});
    }

    public refresh() {
        this._uses.length = 0;
    }
}

class FunctionScope<T extends Scope = Scope> extends NonRootScope<T> {
    public settle() {
        const newUses: VariableUse[] = [];
        for (const use of this._uses) {
            if ((use.domain & UsageDomain.Value) !== 0 && (use.domain & UsageDomain.TypeQuery) === 0) {
                const variable = this._variables.get(use.location.text);
                if (variable !== undefined && variable.domain & use.domain) {
                    variable.uses.push(use);
                } else {
                    this._addUseToParent(use);
                }
            } else {
                newUses.push(use);
            }
        }
        this._uses = newUses;
    }
}

class FunctionExpressionInnerScope extends FunctionScope<FunctionExpressionScope> {
    protected _addUseToParent(use: VariableUse) {
        return this._parent.addUseToParent(use);
    }
}

class FunctionExpressionScope extends NonRootScope {
    private _innerScope = new FunctionExpressionInnerScope(this);

    constructor(private _name: ts.Identifier, parent: Scope) {
        super(parent);
    }

    public end(cb: VariableCallback) {
        this._innerScope.end(cb);
        return cb(
            {
                declarations: [this._name],
                domain: DeclarationDomain.Value,
                exported: false,
                uses: this._uses,
                inGlobalScope: false,
            },
            this._name.text,
        );
    }

    public settle() {
        return this._innerScope.settle();
    }

    public addUseToParent(use: VariableUse) {
        if (use.domain & UsageDomain.Value && use.location.text === this._name.text) {
            this._uses.push(use);
        } else {
            return this._parent.addUse(use);
        }
    }

    public addUse(use: VariableUse) {
        return this._innerScope.addUse(use);
    }

    protected _getDestinationScope() {
        return this._innerScope;
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

class NamespaceInnerScope extends NonRootScope<NamespaceScope> {
    protected _addUseToParent(use: VariableUse) {
        this._parent.addUseFromInner(use);
    }
}

class NamespaceScope extends NonRootScope {
    private _innerScope = new NamespaceInnerScope(this);

    public end(cb: VariableCallback) {
        this._innerScope.end((variable, key) => {
            if (!variable.exported)
                return cb(variable, key);
            const namespaceVar = this._variables.get(key);
            if (namespaceVar === undefined) {
                this._variables.set(key, variable);
            } else {
                namespaceVar.declarations.push(...variable.declarations);
                namespaceVar.domain |= variable.domain;
                namespaceVar.uses.push(...variable.uses);
            }
        });
        return super.end(cb);
    }

    public createOrReuseNamespaceScope(name: string, exported: boolean): NamespaceScope {
        if (!exported)
            return this._innerScope.createOrReuseNamespaceScope(name, exported);
        return super.createOrReuseNamespaceScope(name, exported);
    }

    public createOrReuseEnumScope(name: string, exported: boolean): EnumScope {
        if (!exported)
            return this._innerScope.createOrReuseEnumScope(name, exported);
        return super.createOrReuseEnumScope(name, exported);
    }

    public refresh(newParent: Scope) {
        this._innerScope = new NamespaceInnerScope(this);
        this._parent = newParent;
        this._uses.length = 0;
    }

    public addUse(use: VariableUse) {
        return this._innerScope.addUse(use);
    }

    public addUseFromInner(use: VariableUse) {
        this._uses.push(use);
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
        const variableCallback = (variable: VariableInfo) => {
            for (const declaration of variable.declarations)
                this._result.set(<ts.Identifier>declaration, variable);
        };
        this._scope = new RootScope(!ts.isExternalModule(sourceFile));
        const cb = (node: ts.Node): void => {
            const boundary = isScopeBoundary(node);
            if (boundary) {
                const savedScope = this._scope;
                if (boundary === ScopeBoundary.Function) {
                    if (isFunctionExpression(node) && node.name !== undefined) {
                        this._scope = new FunctionExpressionScope(node.name, this._scope);
                    } else if (isModuleDeclaration(node) && node.name.kind === ts.SyntaxKind.Identifier) {
                        this._handleNamespace(<ts.NamespaceDeclaration>node);
                        // TODO also do this for ambient modules
                        this._scope = this._scope.createOrReuseNamespaceScope(node.name.text,
                                                                              isNamespaceExported(<ts.NamespaceDeclaration>node));
                    } else if (isEnumDeclaration(node)) {
                        this._handleDeclaration(node, true, DeclarationDomain.Any);
                        this._scope = this._scope.createOrReuseEnumScope(node.name.text,
                                                                         hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword));
                    } else {
                        if (isFunctionDeclaration(node) && node.body !== undefined) {
                            this._handleDeclaration(node, false, DeclarationDomain.Value);
                        } else if (isClassLikeDeclaration(node)) {
                            this._handleDeclaration(node, true, DeclarationDomain.Value | DeclarationDomain.Type);
                        } else if (isInterfaceDeclaration(node) || isTypeAliasDeclaration(node)) {
                            this._handleDeclaration(node, true, DeclarationDomain.Type);
                        }
                        this._scope = new FunctionScope(this._scope);
                    }
                } else {
                    if (node.kind === ts.SyntaxKind.CatchClause)
                        this._handleBindingName((<ts.CatchClause>node).variableDeclaration.name, true, true);
                    this._scope = new BlockScope(this._scope.getFunctionScope(), this._scope);
                }
                ts.forEachChild(node, cb);
                this._scope.end(variableCallback);
                this._scope = savedScope;
                return;
            }
            if (node.kind === ts.SyntaxKind.VariableDeclarationList) {
                this._handleVariableDeclaration(<ts.VariableDeclarationList>node);
            } else if (isParameterDeclaration(node)) {
                const parent = node.parent!;
                // don't handle parameters of overloads or other signatures
                if (isFunctionWithBody(parent) &&
                     // exclude this parameter
                    (node.name.kind !== ts.SyntaxKind.Identifier || node.name.originalKeywordKind !== ts.SyntaxKind.ThisKeyword)) {
                    this._handleBindingName(node.name, false, isParameterProperty(node));
                    // special handling for parameters
                    // each parameter initializer can only access preceding parameters, therefore we need to settle after each one
                    ts.forEachChild(node, cb);
                    return this._scope.settle();
                }
            } else if (isEnumMember(node)) {
                this._scope.addVariable(getPropertyName(node.name)!, node.name, false, true, DeclarationDomain.Value);
            } else if (isImportClause(node) || isImportSpecifier(node) || isNamespaceImport(node) || isImportEqualsDeclaration(node)) {
                this._handleDeclaration(node, false, DeclarationDomain.Any);
            } else if (isTypeParameterDeclaration(node)) {
                this._scope.addVariable(node.name.text, node.name, false, false, DeclarationDomain.Type);
            } else if (isExportSpecifier(node)) {
                return this._scope.markExported(node.propertyName || node.name);
            } else if (isExportAssignment(node)) {
                if (isIdentifier(node.expression))
                    return this._scope.markExported(node.expression);
            } else if (isIdentifier(node)) {
                const domain = getUsageDomain(node);
                if (domain !== undefined)
                    this._scope.addUse({domain, location: node});
                return;
            }

            return ts.forEachChild(node, cb);
        };

        ts.forEachChild(sourceFile, cb);
        this._scope.end(variableCallback);
        return this._result;
    }

    private _handleNamespace(node: ts.NamespaceDeclaration) {
        this._scope.addVariable(node.name.text, node.name, false, isNamespaceExported(node), DeclarationDomain.Namespace);
    }

    private _handleDeclaration(node: ts.NamedDeclaration, blockScoped: boolean, domain: DeclarationDomain ) {
        if (node.name !== undefined)
            this._scope.addVariable((<ts.Identifier>node.name).text, <ts.Identifier>node.name, blockScoped,
                                    hasModifier(node.modifiers, ts.SyntaxKind.ExportKeyword), domain);
    }

    private _handleBindingName(name: ts.BindingName,
                               blockScoped: boolean,
                               exported: boolean) {
        if (name.kind === ts.SyntaxKind.Identifier) {
            this._scope.addVariable(name.text, name, blockScoped, exported, DeclarationDomain.Value);
        } else {
            forEachDestructuringIdentifier(name, (declaration) => {
                this._scope.addVariable(declaration.name.text, declaration.name, blockScoped, exported, DeclarationDomain.Value);
            });
        }
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
