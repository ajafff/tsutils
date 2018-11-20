import * as ts from 'typescript';
import { ScopeBoundarySelector, isScopeBoundary, isBlockScopedVariableDeclarationList, isThisParameter, getPropertyName, getDeclarationOfBindingElement, ScopeBoundary, isBlockScopeBoundary, isNodeKind } from './util';
import { getUsageDomain, getDeclarationDomain } from './usage';
import bind from 'bind-decorator';

export enum Domain {
    None = 0,
    Namespace = 1 << 0,
    Type = 1 << 1,
    Value = 1 << 2,
    Any = Type | Value | Namespace,
    ValueOrNamespace = Value | Namespace,
    // @internal
    Lazy = 1 << 3,
    /** Mark this use as unsafe as we cannot know for sure if it really resolves to a given declaration. */
    // @internal
    DoNotUse = 1 << 4,
}

interface Declaration {
    name: string;
    node: ts.NamedDeclaration;
    domain: Domain;
    selector: ScopeBoundarySelector;
}
interface Symbol {
    name: string;
    domain: Domain;
    declarations: Declaration[];
}
export interface Use {
    location: ts.Identifier;
    domain: Domain;
}

type TypeCheckerFactory = () => ts.TypeChecker | undefined;
export type TypeCheckerOrFactory =
    | ts.TypeChecker
    | {getTypeChecker(): ts.TypeChecker | undefined}
    | {program: ts.Program | undefined}
    | (() => ts.TypeChecker | ts.Program | undefined);

export interface Resolver {
    findReferences(declaration: ts.Identifier, domain?: Domain, getChecker?: TypeCheckerOrFactory): Use[] | undefined;
}

export function createResolver(): Resolver {
    return new ResolverImpl();
}

function makeCheckerFactory(checkerOrFactory: TypeCheckerOrFactory | undefined): TypeCheckerFactory {
    let checker: ts.TypeChecker | undefined | null = null;
    return getChecker;
    function getChecker() {
        if (checker === null)
            checker = createChecker(checkerOrFactory);
        return checker;
    }
}

function createChecker(checkerOrFactory: TypeCheckerOrFactory | undefined): ts.TypeChecker | undefined {
    if (checkerOrFactory === undefined)
        return;
    let result: {getTypeChecker(): ts.TypeChecker | undefined} | ts.TypeChecker | undefined;
    if (typeof checkerOrFactory === 'function') {
        result = checkerOrFactory();
    } else if ('program' in checkerOrFactory) {
        result = checkerOrFactory.program;
    } else {
        result = checkerOrFactory;
    }
    if (result !== undefined && 'getTypeChecker' in result)
        result = result.getTypeChecker();
    return result;
}

class ResolverImpl implements Resolver {
    private _scopeMap = new WeakMap<ts.Node, Scope>();

    public findReferences(declaration: ts.Identifier, domain = Domain.Any, getChecker?: TypeCheckerOrFactory): Use[] | undefined {
        const selector = getScopeBoundarySelector(declaration);
        if (selector === undefined)
            return; // not a declaration name
        let scopeNode = findScopeBoundary(declaration.parent!, selector.selector);
        if (selector.outer)
            scopeNode = findScopeBoundary(scopeNode.parent!, selector.selector);
        const scope = this.getOrCreateScope(scopeNode).getDelegateScope(declaration);
        const result = [];
        const symbol = scope.getSymbol(declaration);
        if (symbol === undefined)
            return; // something went wrong, possibly a syntax error
        // TODO move this up front to avoid unnecessary work
        domain &= getDeclarationDomain(declaration)!; // TODO
        for (const use of scope.getUses(symbol, domain, makeCheckerFactory(getChecker))) {
            if (use.domain & Domain.DoNotUse)
                return;
            result.push(use);
        }
        return result;
    }

    public getOrCreateScope(node: ts.Node) {
        let scope = this._scopeMap.get(node);
        if (scope === undefined) {
            scope = this._createScope(node);
            this._scopeMap.set(node, scope);
        }
        return scope;
    }

    private _createScope(node: ts.Node): Scope {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile:
                return new BaseScope(node, ScopeBoundary.Function, this);
            case ts.SyntaxKind.MappedType:
                return new BaseScope(node, ScopeBoundary.Type, this);
            case ts.SyntaxKind.InterfaceDeclaration:
            case ts.SyntaxKind.TypeAliasDeclaration:
                return new DeclarationScope(
                    <ts.InterfaceDeclaration | ts.TypeAliasDeclaration>node,
                    ScopeBoundary.Type,
                    this,
                    {
                        name: (<ts.InterfaceDeclaration | ts.TypeAliasDeclaration>node).name.text,
                        domain: Domain.Type,
                        node: <ts.InterfaceDeclaration | ts.TypeAliasDeclaration>node,
                        selector: ScopeBoundarySelector.Type,
                    },
                );
            case ts.SyntaxKind.EnumDeclaration:
                return new NamespaceScope(
                    <ts.EnumDeclaration>node,
                    ScopeBoundary.Function,
                    this,
                    {
                        name: (<ts.EnumDeclaration>node).name.text,
                        domain: Domain.ValueOrNamespace,
                        node: <ts.EnumDeclaration>node,
                        selector: ScopeBoundarySelector.Function,
                    },
                );
            case ts.SyntaxKind.ModuleDeclaration:
                return new NamespaceScope(
                    <ts.ModuleDeclaration>node,
                    ScopeBoundary.Function,
                    this,
                    (<ts.ModuleDeclaration>node).name.kind === ts.SyntaxKind.StringLiteral || node.flags & ts.NodeFlags.GlobalAugmentation
                        ? undefined
                        : {
                            name: (<ts.NamespaceDeclaration>node).name.text,
                            domain: Domain.ValueOrNamespace | Domain.Lazy,
                            node: <ts.ModuleDeclaration>node,
                            selector: ScopeBoundarySelector.Function,
                        },
                );
            case ts.SyntaxKind.ConditionalType:
                return new ConditionalTypeScope(<ts.ConditionalTypeNode>node, ScopeBoundary.ConditionalType, this);
            // TODO handling of ClassLikeDeclaration might need change when https://github.com/Microsoft/TypeScript/issues/28472 is resolved
            case ts.SyntaxKind.ClassDeclaration:
                return new ClassScope(
                    <ts.ClassDeclaration>node,
                    ScopeBoundary.Function,
                    this,
                    (<ts.ClassDeclaration>node).name === undefined
                        ? undefined
                        : {
                            name: (<ts.ClassDeclaration>node).name!.text,
                            domain: Domain.Type | Domain.Value,
                            node: <ts.ClassDeclaration>node,
                            selector: ScopeBoundarySelector.Block,
                        },
                );
            case ts.SyntaxKind.ClassExpression:
                if ((<ts.ClassExpression>node).name === undefined)
                    return new ClassScope(<ts.ClassExpression>node, ScopeBoundary.Function, this);
                return new NamedDeclarationExpressionScope(<ts.ClassExpression>node, this, new ClassScope(
                    <ts.ClassExpression>node,
                    ScopeBoundary.Function,
                    this,
                    {
                        name: (<ts.ClassExpression>node).name!.text,
                        domain: Domain.Type | Domain.Value,
                        node: <ts.ClassExpression>node,
                        selector: ScopeBoundarySelector.Block,
                    },
                ));
            case ts.SyntaxKind.FunctionExpression:
                if ((<ts.FunctionExpression>node).name !== undefined)
                    return new NamedDeclarationExpressionScope(
                        <ts.FunctionExpression>node,
                        this,
                        new FunctionLikeScope(<ts.FunctionExpression>node, this),
                    );
                // falls through
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.Constructor:
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor:
            case ts.SyntaxKind.FunctionDeclaration:
            case ts.SyntaxKind.ArrowFunction:
            case ts.SyntaxKind.CallSignature:
            case ts.SyntaxKind.ConstructSignature:
            case ts.SyntaxKind.MethodSignature:
            case ts.SyntaxKind.FunctionType:
            case ts.SyntaxKind.ConstructorType:
                return new FunctionLikeScope(<ts.SignatureDeclaration>node, this);
            case ts.SyntaxKind.WithStatement:
                return new WithStatementScope(node, ScopeBoundary.Block, this);
            default:
                if (isBlockScopeBoundary(node))
                    return new BaseScope(node, ScopeBoundary.Block, this);
                throw new Error(`unhandled Scope ${ts.SyntaxKind[node.kind]}`);
        }
    }
}

function findScopeBoundary(node: ts.Node, selector: ScopeBoundarySelector): ts.Node {
    while ((isScopeBoundary(node) & selector) === 0 && node.parent !== undefined)
        node = node.parent;
    return node;
}

interface DeclarationBoundary {
    selector: ScopeBoundarySelector;
    outer: boolean;
}

function getScopeBoundarySelector(node: ts.Identifier): DeclarationBoundary | undefined {
    switch (node.parent!.kind) {
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.EnumDeclaration:
            return {selector: ScopeBoundarySelector.Block, outer: true};
        case ts.SyntaxKind.EnumMember:
            if ((<ts.EnumMember>node.parent).name !== node)
                return;
            // falls through
        case ts.SyntaxKind.InterfaceDeclaration:
        case ts.SyntaxKind.TypeAliasDeclaration:
        case ts.SyntaxKind.FunctionExpression: // this is not entirely correct, but works for our purpose
        case ts.SyntaxKind.ClassExpression:
            return {selector: ScopeBoundarySelector.Block, outer: false};
        case ts.SyntaxKind.ModuleDeclaration:
            if (node.parent.flags & ts.NodeFlags.GlobalAugmentation)
                return;
            // falls through
        case ts.SyntaxKind.FunctionDeclaration:
            return {selector: ScopeBoundarySelector.Function, outer: true};
        case ts.SyntaxKind.Parameter:
            if (node.originalKeywordKind === ts.SyntaxKind.ThisKeyword || node.parent!.parent!.kind === ts.SyntaxKind.IndexSignature)
                return;
            return {selector: ScopeBoundarySelector.Function, outer: false};
        case ts.SyntaxKind.VariableDeclaration: {
            const parent = (<ts.VariableDeclaration>node.parent).parent!;
            return {
                selector: parent.kind === ts.SyntaxKind.CatchClause || isBlockScopedVariableDeclarationList(parent)
                    ? ScopeBoundarySelector.Block
                    : ScopeBoundarySelector.Function,
                outer: false,
            };
        }
        case ts.SyntaxKind.BindingElement: {
            const declaration = getDeclarationOfBindingElement(<ts.BindingElement>node.parent);
            const blockScoped = declaration.kind === ts.SyntaxKind.Parameter ||
                declaration.parent!.kind === ts.SyntaxKind.CatchClause ||
                isBlockScopedVariableDeclarationList(<ts.VariableDeclarationList>declaration.parent);
            return {selector: blockScoped ? ScopeBoundarySelector.Block : ScopeBoundarySelector.Function, outer: false};
        }
        case ts.SyntaxKind.TypeParameter:
            return {
                selector: node.parent!.parent!.kind === ts.SyntaxKind.InferType
                    ? ScopeBoundarySelector.InferType
                    : ScopeBoundarySelector.Type,
                outer: false,
            };
        case ts.SyntaxKind.ImportEqualsDeclaration:
        case ts.SyntaxKind.ImportSpecifier:
            if ((<ts.ImportEqualsDeclaration | ts.ImportSpecifier>node.parent).name !== node)
                return;
            // falls through
        case ts.SyntaxKind.ImportClause:
        case ts.SyntaxKind.NamespaceImport:
            return {selector: ScopeBoundarySelector.Function, outer: false};
        default:
            return;
    }
}

function getLazyDeclarationDomain(declaration: ts.NamedDeclaration, checker: ts.TypeChecker): Domain {
    let symbol = checker.getSymbolAtLocation(declaration)!;
    if (symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
    return getDomainOfSymbol(symbol);
}

function getDomainOfSymbol(symbol: ts.Symbol) {
    let domain = Domain.None;
    if (symbol.flags & ts.SymbolFlags.Type)
        domain |= Domain.Type;
    if (symbol.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.ValueModule))
        domain |= Domain.Value;
    if (symbol.flags & ts.SymbolFlags.Namespace)
        domain |= Domain.Namespace;
    return domain;
}

function* lazyFilterUses<T extends unknown[]>(
    uses: Iterable<Use>,
    getChecker: TypeCheckerFactory,
    inclusive: boolean,
    resolveDomain: (checker: ts.TypeChecker, ...args: T) => Domain,
    ...args: T
) {
    let resolvedDomain: Domain | undefined;
    for (const use of uses) {
        if (resolvedDomain === undefined) {
            const checker = getChecker();
            if (checker === undefined) {
                yield {location: use.location, domain: use.domain | Domain.DoNotUse};
                continue;
            }
            resolvedDomain = resolveDomain(checker, ...args);
        }
        if (((use.domain & resolvedDomain) !== 0) === inclusive)
            yield use;
    }
}

function resolveLazySymbolDomain(checker: ts.TypeChecker, symbol: Symbol): Domain {
    let result: Domain = Domain.None;
    for (const declaration of symbol.declarations)
        result |= declaration.domain & Domain.Lazy ? getLazyDeclarationDomain(declaration.node, checker) : declaration.domain;
    return result;
}

interface Scope {
    node: ts.Node;
    getDeclarationsForParent(): Iterable<Declaration>;
    getUses(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use>;
    getUsesInScope(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use>;
    getSymbol(declaration: ts.Identifier): Symbol | undefined;
    getDelegateScope(location: ts.Node): Scope;
    matchUsesBeforeShadowing(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use>;
    matchUsesAfterShadowing(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use>;
}

class BaseScope<T extends ts.Node = ts.Node> implements Scope {
    private _initial = true;
    private _uses: Use[] = [];
    private _symbols = new Map<string, Symbol>();
    private _scopes: Scope[] = [];
    protected _declarationsForParent: Declaration[] = [];

    constructor(public node: T, protected _boundary: ScopeBoundary, protected _resolver: ResolverImpl) {}

    public getDelegateScope(_location: ts.Node): Scope {
        return this;
    }

    public getDeclarationsForParent() {
        this._initialize();
        return this._declarationsForParent;
    }

    public* getUsesInScope(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use> {
        this._initialize();
        yield* this.matchUsesBeforeShadowing(symbol, domain, getChecker);
        let ownSymbol = this._symbols.get(symbol.name);
        if (ownSymbol !== undefined) {
            ownSymbol = this._resolveSymbol(ownSymbol, domain);
            if (ownSymbol.domain & Domain.Lazy)
                // we don't know exactly what we have to deal with -> search uses syntactically and filter or abort later
                yield* lazyFilterUses(
                    this.matchUsesAfterShadowing(symbol, domain, getChecker),
                    getChecker,
                    false,
                    resolveLazySymbolDomain,
                    ownSymbol,
                );
            domain &= ~ownSymbol.domain;
            symbol = this._resolveSymbol(symbol, domain);
        }
        yield* this.matchUsesAfterShadowing(symbol, domain, getChecker);
    }

    public* matchUsesBeforeShadowing(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use> {
        for (const use of this._uses)
            if (use.domain & domain && use.location.text === symbol.name && use.domain & this._propagateUsesToParent(use.location))
                yield use;
        for (const scope of this._scopes)
            yield* this._matchChildScope(scope, true, symbol, domain, getChecker);
    }

    protected _matchChildScope(scope: Scope, beforeShadowing: boolean, symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory) {
        domain &= beforeShadowing ? this._propagateUsesToParent(scope.node) : ~this._propagateUsesToParent(scope.node);
        if (domain !== Domain.None)
            return scope.getUsesInScope(this._resolveSymbol(symbol, domain), domain, getChecker);
        return [];
    }

    public* matchUsesAfterShadowing(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory) {
        if (domain === Domain.None)
            return;
        for (const use of this._uses)
            if (use.domain & domain && use.location.text === symbol.name && (use.domain & this._propagateUsesToParent(use.location)) === 0)
                yield use;
        for (const scope of this._scopes)
            yield* this._matchChildScope(scope, false, symbol, domain, getChecker);
    }

    public getUses(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory): Iterable<Use> {
        symbol = this._resolveSymbol(symbol, domain);
        domain &= symbol.domain;
        let uses = this.matchUsesAfterShadowing(symbol, domain, getChecker);
        if (symbol.domain & Domain.Lazy)
            uses = lazyFilterUses(uses, getChecker, true, resolveLazySymbolDomain, symbol);
        return uses;
    }

    protected _resolveSymbol(symbol: Symbol, domain: Domain): Symbol {
        const result: Symbol = {
            name: symbol.name,
            domain: Domain.None,
            declarations: [],
        };
        for (const declaration of symbol.declarations) {
            if ((declaration.domain & domain) === 0)
                continue;
            result.declarations.push(declaration);
            result.domain |= declaration.domain;
        }
        return result;
    }

    public getSymbol(declaration: ts.Identifier) {
        this._initialize();
        return this._symbols.get(declaration.text);
    }

    protected _addUse(use: Use) {
        this._uses.push(use);
    }

    protected _addDeclaration(declaration: Declaration) {
        if (!this._isOwnDeclaration(declaration)) {
            this._declarationsForParent.push(declaration);
            return;
        }
        const symbol = this._symbols.get(declaration.name);
        if (symbol !== undefined) {
            symbol.domain |= declaration.domain;
            symbol.declarations.push(declaration);
        } else {
            this._symbols.set(declaration.name, {
                name: declaration.name,
                domain: declaration.domain,
                declarations: [declaration],
            });
        }
    }

    protected _addChildScope(scope: Scope) {
        this._scopes.push(scope);
    }

    protected _initialize() {
        if (this._initial) {
            this._analyze();
            for (const scope of this._scopes)
                for (const decl of scope.getDeclarationsForParent())
                    this._addDeclaration(decl);
            this._initial = false;
        }
    }

    protected _analyze() {
        ts.forEachChild(this.node, this._analyzeNode);
    }

    protected _isOwnDeclaration(declaration: Declaration) {
        return (declaration.selector & this._boundary) !== 0;
    }

    protected _propagateUsesToParent(_location: ts.Node): Domain {
        return Domain.None;
    }

    @bind
    protected _analyzeNode(node: ts.Node): void {
        if (isScopeBoundary(node)) {
            this._addChildScope(this._resolver.getOrCreateScope(node));
            return;
        }
        switch (node.kind) {
            case ts.SyntaxKind.VariableDeclarationList:
                return this._handleVariableDeclarationList(<ts.VariableDeclarationList>node);
            case ts.SyntaxKind.VariableDeclaration:
                // catch binding
                return this._handleBindingName((<ts.VariableDeclaration>node).name, true);
            case ts.SyntaxKind.Parameter:
                if (node.parent!.kind === ts.SyntaxKind.IndexSignature || isThisParameter(<ts.ParameterDeclaration>node))
                    return (<ts.ParameterDeclaration>node).type && this._analyzeNode((<ts.ParameterDeclaration>node).type!);
                return this._handleVariableLikeDeclaration(<ts.ParameterDeclaration>node, false);
            case ts.SyntaxKind.EnumMember:
                this._addDeclaration({
                    name: getPropertyName((<ts.EnumMember>node).name)!,
                    domain: Domain.Value,
                    node: <ts.EnumMember>node,
                    selector: ScopeBoundarySelector.Block,
                });
                if ((<ts.EnumMember>node).initializer !== undefined)
                    this._analyzeNode((<ts.EnumMember>node).initializer!);
                return;
            case ts.SyntaxKind.ImportClause:
                if ((<ts.ImportClause>node).name !== undefined)
                    this._addDeclaration({
                        name: (<ts.ImportClause>node).name!.text,
                        domain: Domain.Any | Domain.Lazy,
                        node: <ts.ImportClause>node,
                        selector: ScopeBoundarySelector.Function,
                    });
                if ((<ts.ImportClause>node).namedBindings !== undefined)
                    this._analyzeNode((<ts.ImportClause>node).namedBindings!);
                return;
            case ts.SyntaxKind.ImportEqualsDeclaration:
                this._analyzeNode((<ts.ImportEqualsDeclaration>node).moduleReference);
                // falls through
            case ts.SyntaxKind.ImportSpecifier:
            case ts.SyntaxKind.NamespaceImport:
                this._addDeclaration({
                    name: (<ts.Identifier>(<ts.NamedDeclaration>node).name).text,
                    domain: Domain.Any | Domain.Lazy,
                    node: <ts.NamedDeclaration>node,
                    selector: ScopeBoundarySelector.Function,
                });
                return;
            case ts.SyntaxKind.TypeParameter:
                this._addDeclaration({
                    name: (<ts.TypeParameterDeclaration>node).name.text,
                    domain: Domain.Type,
                    node: (<ts.TypeParameterDeclaration>node).name,
                    selector: node.parent!.kind === ts.SyntaxKind.InferType ? ScopeBoundarySelector.InferType : ScopeBoundarySelector.Type,
                });
                if ((<ts.TypeParameterDeclaration>node).constraint !== undefined)
                    this._analyzeNode((<ts.TypeParameterDeclaration>node).constraint!);
                if ((<ts.TypeParameterDeclaration>node).default !== undefined)
                    this._analyzeNode((<ts.TypeParameterDeclaration>node).default!);
                return;
            case ts.SyntaxKind.Identifier: {
                const domain = getUsageDomain(<ts.Identifier>node);
                if (domain !== undefined) // TODO
                    this._addUse({location: <ts.Identifier>node, domain: domain | 0});
                return;
            }
        }
        if (isNodeKind(node.kind))
            return ts.forEachChild(node, this._analyzeNode);
    }

    private _handleVariableDeclarationList(list: ts.VariableDeclarationList) {
        const blockScoped = isBlockScopedVariableDeclarationList(list);
        for (const declaration of list.declarations)
            this._handleVariableLikeDeclaration(declaration, blockScoped);
    }

    private _handleVariableLikeDeclaration(declaration: ts.VariableDeclaration | ts.ParameterDeclaration, blockScoped: boolean) {
        this._handleBindingName(declaration.name, blockScoped);
        if (declaration.type !== undefined)
            this._analyzeNode(declaration.type);
        if (declaration.initializer !== undefined)
            this._analyzeNode(declaration.initializer);
    }

    private _handleBindingName(name: ts.BindingName, blockScoped: boolean) {
        const selector = blockScoped ? ScopeBoundarySelector.Block : ScopeBoundarySelector.Function;
        if (name.kind === ts.SyntaxKind.Identifier)
            return this._addDeclaration({name: name.text, domain: Domain.Value, node: name, selector});

        for (const element of name.elements) {
            if (element.kind === ts.SyntaxKind.OmittedExpression)
                break;
            if (element.propertyName !== undefined && element.propertyName.kind === ts.SyntaxKind.ComputedPropertyName)
                this._analyzeNode(element.propertyName);
            this._handleBindingName(element.name, blockScoped);
            if (element.initializer !== undefined)
                this._analyzeNode(element.initializer);
        }
    }
}

class WithStatementScope extends BaseScope {
    public getDeclarationsForParent() {
        return []; // nothing to do here
    }
    public* getUsesInScope(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory) {
        // we don't know what could be in scope here
        for (const use of super.getUsesInScope(symbol, domain, getChecker))
            yield {location: use.location, domain: use.domain | Domain.DoNotUse};
    }
}

class DeclarationScope<T extends ts.NamedDeclaration = ts.NamedDeclaration> extends BaseScope<T> {
    constructor(node: T, boundary: ScopeBoundary, resolver: ResolverImpl, declaration?: Declaration) {
        super(node, boundary, resolver);
        if (declaration)
            this._declarationsForParent.push(declaration);
    }

    public getDeclarationsForParent() {
        return this._declarationsForParent;
    }
}

class DecoratableDeclarationScope<
    T extends ts.ClassLikeDeclaration | ts.SignatureDeclaration = ts.ClassLikeDeclaration | ts.SignatureDeclaration,
> extends DeclarationScope<T> {
    protected _propagateUsesToParent(location: ts.Node) {
        // decorators cannot access parameters and type parameters of the declaration they decorate
        return this.node.decorators !== undefined && location.pos < this.node.decorators.end
            ? Domain.Any
            : Domain.None;
    }
}

class ClassScope extends DecoratableDeclarationScope<ts.ClassLikeDeclaration> {
    protected _propagateUsesToParent(location: ts.Node) {
        return super._propagateUsesToParent(location) || // decorators
            // computed property names cannot access type parameters of class
            // TODO this won't work for method scopes
            (isInComputedNameOfMember(location.pos, this.node) ? Domain.Type : Domain.None) ||
            // expression in 'extends' clause cannot access type parameters of class
            (isInHeritageClauseExpression(location.pos, this.node) ? Domain.Type : Domain.None);
    }
}

function isInHeritageClauseExpression(pos: number, {heritageClauses}: ts.ClassLikeDeclaration): boolean {
    if (heritageClauses === undefined || heritageClauses[0].token !== ts.SyntaxKind.ExtendsKeyword || heritageClauses[0].types.length !== 1)
        return false;
    return isInRange(pos, heritageClauses[0].types[0].expression);
}

function isInComputedNameOfMember(pos: number, node: ts.ClassLikeDeclaration): boolean {
    for (const member of node.members) {
        if (pos < member.pos)
            break;
        if (isInComputedPropertyName(pos, member))
            return true;
    }
    return false;
}

function resolveNamespaceExportDomain(checker: ts.TypeChecker, node: ts.ModuleDeclaration | ts.EnumDeclaration, name: string) {
    const exportedSymbol = checker.getSymbolAtLocation(node)!.exports!.get(ts.escapeLeadingUnderscores(name));
    if (exportedSymbol === undefined)
        return Domain.None;
    return node.kind === ts.SyntaxKind.EnumDeclaration
        ? Domain.Value
        : getDomainOfSymbol(exportedSymbol);
}

class NamespaceScope extends DeclarationScope<ts.ModuleDeclaration | ts.EnumDeclaration> {
    public getUsesInScope(symbol: Symbol, domain: Domain, getChecker: TypeCheckerFactory) {
        // TODO allow type uses in Enum even without the checker
        return lazyFilterUses(
            super.getUsesInScope(symbol, domain, getChecker),
            getChecker,
            false,
            resolveNamespaceExportDomain,
            this.node,
            symbol.name,
        );
    }
}

class ConditionalTypeScope extends BaseScope<ts.ConditionalTypeNode> {
    protected _isOwnDeclaration(declaration: Declaration) {
        return super._isOwnDeclaration(declaration) && isInRange(declaration.node.pos, this.node.extendsType);
    }

    protected _propagateUsesToParent(location: ts.Node) {
        return isInRange(location.pos, this.node.trueType) ? Domain.None : Domain.Any;
    }
}

class NamedDeclarationExpressionScope extends BaseScope<ts.NamedDeclaration> {
    constructor(node: ts.NamedDeclaration, resolver: ResolverImpl, private _childScope: Scope) {
        super(node, ScopeBoundary.Function, resolver);
    }

    public getDeclarationsForParent() {
        return [];
    }

    protected _analyze() {
        this._addChildScope(this._childScope);
    }

    public getDelegateScope(location: ts.Node): Scope {
        return location === this.node.name
            ? this
            : this._childScope.getDelegateScope(location);
    }
}

class FunctionLikeInnerScope extends BaseScope<ts.SignatureDeclaration> {
    public getDeclarationsForParent() {
        return [];
    }

    protected _analyze() {
        if (this.node.type !== undefined)
            this._analyzeNode(this.node.type);
        if ('body' in this.node && this.node.body !== undefined)
            this._analyzeNode(this.node.body);
    }
}

class FunctionLikeScope extends DecoratableDeclarationScope<ts.SignatureDeclaration> {
    private _innerScope = new FunctionLikeInnerScope(this.node, ScopeBoundary.Function, this._resolver);

    constructor(node: ts.SignatureDeclaration, resolver: ResolverImpl) {
        super(
            node,
            ScopeBoundary.Function,
            resolver,
            node.kind !== ts.SyntaxKind.FunctionDeclaration && node.kind !== ts.SyntaxKind.FunctionExpression || node.name === undefined
                ? undefined
                : {
                    name: node.name.text,
                    domain: Domain.Value,
                    node,
                    selector: ScopeBoundarySelector.Function,
                },
        );
    }

    public getDelegateScope(location: ts.Node): Scope {
        return location.pos < this.node.parameters.end
            ? this
            : this._innerScope.getDelegateScope(location);
    }

    protected _analyze() {
        this._addChildScope(this._innerScope);
        if (this.node.decorators !== undefined)
            this.node.decorators.forEach(this._analyzeNode);
        if (this.node.typeParameters !== undefined)
            this.node.typeParameters.forEach(this._analyzeNode);
        this.node.parameters.forEach(this._analyzeNode);
    }

    protected _propagateUsesToParent(location: ts.Node) {
        return super._propagateUsesToParent(location) || // method decorators
            // 'typeof' in type parameters cannot access parameters of that function
            (isInRange(location.pos, this.node.typeParameters) ? Domain.Type : Domain.None) ||
            // property decorators cannot access parameters
            (isInParameterDecorator(location.pos, this.node) ? Domain.Any : Domain.None) ||
            // computed method name cannot access method generics and parameters
            (isInComputedPropertyName(location.pos, this.node) ? Domain.Any : Domain.None);
    }
}

function isInComputedPropertyName(pos: number, {name}: ts.ClassElement | ts.SignatureDeclaration): boolean {
    return name !== undefined && name.kind === ts.SyntaxKind.ComputedPropertyName && isInRange(pos, name);
}

function isInParameterDecorator(pos: number, {parameters}: ts.SignatureDeclaration): boolean {
    if (!isInRange(pos, parameters))
        return false;
    for (const param of parameters) {
        if (isInRange(pos, param.decorators))
            return true;
        if (pos < param.end)
            break;
    }
    return false;
}

function isInRange(pos: number, range: ts.TextRange | undefined): boolean {
    return range !== undefined && pos >= range.pos && pos < range.end;
}

// * function/class decorated with itself
// * type parmeters shadowing declaration name
// * type parameter cannot reference parameter
// * member decorator accessing class generics
// * MappedType type parameter referencing itself in its constraint
// * type use in enum
// * type-only namespace not shadowing value
// exporting partially shadowed declaration (SourceFile and Namespace)
// domain of 'export import = ' in namespace
// * ConditionalType using 'typeof' in function's type parameter constraint
// * FunctionScope in Decorator has no access to parameters and generics
// * with statement
// * parameter decorator cannot access parameters
// handle arguments
// * computed property names of methods cannot access parameters and generics
// * computed property names cannot access class generics
// computed method names cannot access class generics
// * ExpressionWithTypeArguments.expression in class extends clause cannot reference class generics
// in ambient namespace exclude alias exports 'export {T as V}'
// make sure namespace import is treated as namespace
