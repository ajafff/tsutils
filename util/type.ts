import * as ts from 'typescript';
import {
    isTypeParameter,
    isUnionType,
    isIntersectionType,
    isLiteralType,
    isObjectType,
    isTupleTypeReference,
    isUniqueESSymbolType,
} from '../typeguard/type';
import {
    isTypeFlagSet,
    isReadonlyAssignmentDeclaration,
    isInConstContext,
    isObjectFlagSet,
    isSymbolFlagSet,
    isModifierFlagSet,
    isNodeFlagSet,
    isNumericPropertyName,
    PropertyName,
    getBaseOfClassLikeExpression,
    getSingleLateBoundPropertyNameOfPropertyName,
    hasModifier,
    getChildOfKind,
} from './util';
import {
    isPropertyAssignment,
    isVariableDeclaration,
    isCallExpression,
    isShorthandPropertyAssignment,
    isEnumMember,
    isClassLikeDeclaration,
    isInterfaceDeclaration,
    isSourceFile,
} from '../typeguard/node';

export function isEmptyObjectType(type: ts.Type): type is ts.ObjectType {
    if (isObjectType(type) &&
        type.objectFlags & ts.ObjectFlags.Anonymous &&
        type.getProperties().length === 0 &&
        type.getCallSignatures().length === 0 &&
        type.getConstructSignatures().length === 0 &&
        type.getStringIndexType() === undefined &&
        type.getNumberIndexType() === undefined) {
        const baseTypes = type.getBaseTypes();
        return baseTypes === undefined || baseTypes.every(isEmptyObjectType);
    }
    return false;
}

export function removeOptionalityFromType(checker: ts.TypeChecker, type: ts.Type): ts.Type {
    if (!containsTypeWithFlag(type, ts.TypeFlags.Undefined))
        return type;
    const allowsNull = containsTypeWithFlag(type, ts.TypeFlags.Null);
    type = checker.getNonNullableType(type);
    return allowsNull ? checker.getNullableType(type, ts.TypeFlags.Null) : type;
}

function containsTypeWithFlag(type: ts.Type, flag: ts.TypeFlags): boolean {
    for (const t of unionTypeParts(type))
        if (isTypeFlagSet(t, flag))
            return true;
    return false;
}

export function removeOptionalChainingUndefinedMarkerType(checker: ts.TypeChecker, type: ts.Type): ts.Type {
    if (!isUnionType(type))
        return isOptionalChainingUndefinedMarkerType(checker, type) ? type.getNonNullableType() : type;
    let flags: ts.TypeFlags = 0;
    let containsUndefinedMarker = false;
    for (const t of type.types) {
        if (isOptionalChainingUndefinedMarkerType(checker, t)) {
            containsUndefinedMarker = true;
        } else {
            flags |= t.flags;
        }
    }
    return containsUndefinedMarker
        ? checker.getNullableType(type.getNonNullableType(), flags)
        : type;
}

export function isOptionalChainingUndefinedMarkerType(checker: ts.TypeChecker, t: ts.Type) {
    return isTypeFlagSet(t, ts.TypeFlags.Undefined) && checker.getNullableType(t.getNonNullableType(), ts.TypeFlags.Undefined) !== t;
}

export function isTypeAssignableToNumber(checker: ts.TypeChecker, type: ts.Type): boolean {
    return isTypeAssignableTo(checker, type, ts.TypeFlags.NumberLike);
}

export function isTypeAssignableToString(checker: ts.TypeChecker, type: ts.Type): boolean {
    return isTypeAssignableTo(checker, type, ts.TypeFlags.StringLike);
}

function isTypeAssignableTo(checker: ts.TypeChecker, type: ts.Type, flags: ts.TypeFlags) {
    flags |= ts.TypeFlags.Any;
    let typeParametersSeen: Set<ts.Type> | undefined;
    return (function check(t): boolean {
        if (isTypeParameter(t) && t.symbol !== undefined && t.symbol.declarations !== undefined) {
            if (typeParametersSeen === undefined) {
                typeParametersSeen = new Set([t]);
            } else if (!typeParametersSeen.has(t)) {
                typeParametersSeen.add(t);
            } else {
                return false;
            }
            const declaration = <ts.TypeParameterDeclaration>t.symbol.declarations[0];
            if (declaration.constraint === undefined)
                return true; // TODO really?
            return check(checker.getTypeFromTypeNode(declaration.constraint));
        }
        if (isUnionType(t))
            return t.types.every(check);
        if (isIntersectionType(t))
            return t.types.some(check);

        return isTypeFlagSet(t, flags);
    })(type);
}

export function getCallSignaturesOfType(type: ts.Type): ReadonlyArray<ts.Signature> {
    if (isUnionType(type)) {
        const signatures = [];
        for (const t of type.types)
            signatures.push(...getCallSignaturesOfType(t));
        return signatures;
    }
    if (isIntersectionType(type)) {
        let signatures: ReadonlyArray<ts.Signature> | undefined;
        for (const t of type.types) {
            const sig = getCallSignaturesOfType(t);
            if (sig.length !== 0) {
                if (signatures !== undefined)
                    return []; // if more than one type of the intersection has call signatures, none of them is useful for inference
                signatures = sig;
            }
        }
        return signatures === undefined ? [] : signatures;
    }
    return type.getCallSignatures();
}

/** Returns all types of a union type or an array containing `type` itself if it's no union type. */
export function unionTypeParts(type: ts.Type): ts.Type[] {
    return isUnionType(type) ? type.types : [type];
}

/** Returns all types of a intersection type or an array containing `type` itself if it's no intersection type. */
export function intersectionTypeParts(type: ts.Type): ts.Type[] {
    return isIntersectionType(type) ? type.types : [type];
}

export function someTypePart(type: ts.Type, predicate: (t: ts.Type) => t is ts.UnionOrIntersectionType, cb: (t: ts.Type) => boolean) {
    return predicate(type) ? type.types.some(cb) : cb(type);
}

/** Determines if a type thenable and can be used with `await`. */
export function isThenableType(checker: ts.TypeChecker, node: ts.Node, type: ts.Type): boolean;
/** Determines if a type thenable and can be used with `await`. */
export function isThenableType(checker: ts.TypeChecker, node: ts.Expression, type?: ts.Type): boolean;
export function isThenableType(checker: ts.TypeChecker, node: ts.Node, type = checker.getTypeAtLocation(node)!): boolean {
    for (const ty of unionTypeParts(checker.getApparentType(type))) {
        const then = ty.getProperty('then');
        if (then === undefined)
            continue;
        const thenType = checker.getTypeOfSymbolAtLocation(then, node);
        for (const t of unionTypeParts(thenType))
            for (const signature of t.getCallSignatures())
                if (signature.parameters.length !== 0 && isCallback(checker, signature.parameters[0], node))
                    return true;
    }
    return false;
}

function isCallback(checker: ts.TypeChecker, param: ts.Symbol, node: ts.Node): boolean {
    let type: ts.Type | undefined = checker.getApparentType(checker.getTypeOfSymbolAtLocation(param, node));
    if ((<ts.ParameterDeclaration>param.valueDeclaration).dotDotDotToken) {
        // unwrap array type of rest parameter
        type = type.getNumberIndexType();
        if (type === undefined)
            return false;
    }
    for (const t of unionTypeParts(type))
        if (t.getCallSignatures().length !== 0)
            return true;
    return false;
}

/** Determine if a type is definitely falsy. This function doesn't unwrap union types. */
export function isFalsyType(type: ts.Type): boolean {
    if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void))
        return true;
    if (isLiteralType(type))
        return !type.value;
    return isBooleanLiteralType(type, false);
}

/** Determines whether the given type is a boolean literal type and matches the given boolean literal (true or false). */
export function isBooleanLiteralType(type: ts.Type, literal: boolean) {
    return isTypeFlagSet(type, ts.TypeFlags.BooleanLiteral) &&
    (<{intrinsicName: string}><{}>type).intrinsicName === (literal ? 'true' : 'false');
}

export function getPropertyOfType(type: ts.Type, name: ts.__String) {
    if (!(<string>name).startsWith('__'))
        return type.getProperty(<string>name);
    return type.getProperties().find((s) => s.escapedName === name);
}

export function getWellKnownSymbolPropertyOfType(type: ts.Type, wellKnownSymbolName: string, checker: ts.TypeChecker) {
    const prefix = '__@' + wellKnownSymbolName;
    for (const prop of type.getProperties()) {
        if (!prop.name.startsWith(prefix))
            continue;
        const globalSymbol = checker.getApparentType(
            checker.getTypeAtLocation((<ts.ComputedPropertyName>(<ts.NamedDeclaration>prop.valueDeclaration).name).expression),
        ).symbol;
        if (prop.escapedName === getPropertyNameOfWellKnownSymbol(checker, globalSymbol, wellKnownSymbolName))
            return prop;
    }
    return;
}

function getPropertyNameOfWellKnownSymbol(checker: ts.TypeChecker, symbolConstructor: ts.Symbol | undefined, symbolName: string) {
    const knownSymbol = symbolConstructor &&
        checker.getTypeOfSymbolAtLocation(symbolConstructor, symbolConstructor.valueDeclaration).getProperty(symbolName);
    const knownSymbolType = knownSymbol && checker.getTypeOfSymbolAtLocation(knownSymbol, knownSymbol.valueDeclaration);
    if (knownSymbolType && isUniqueESSymbolType(knownSymbolType))
        return knownSymbolType.escapedName;
    return <ts.__String>('__@' + symbolName);
}

/** Determines if writing to a certain property of a given type is allowed. */
export function isPropertyReadonlyInType(type: ts.Type, name: ts.__String, checker: ts.TypeChecker): boolean {
    let seenProperty = false;
    let seenReadonlySignature = false;
    for (const t of unionTypeParts(type)) {
        if (getPropertyOfType(t, name) === undefined) {
            // property is not present in this part of the union -> check for readonly index signature
            const index = (isNumericPropertyName(name) ? checker.getIndexInfoOfType(t, ts.IndexKind.Number) : undefined) ||
                checker.getIndexInfoOfType(t, ts.IndexKind.String);
            if (index !== undefined && index.isReadonly) {
                if (seenProperty)
                    return true;
                seenReadonlySignature = true;
            }
        } else if (seenReadonlySignature || isReadonlyPropertyIntersection(t, name, checker)) {
            return true;
        } else {
            seenProperty = true;
        }
    }
    return false;
}

function isReadonlyPropertyIntersection(type: ts.Type, name: ts.__String, checker: ts.TypeChecker) {
    return someTypePart(type, isIntersectionType, (t) => {
        const prop = getPropertyOfType(t, name);
        if (prop === undefined)
            return false;
        if (prop.flags &  ts.SymbolFlags.Transient) {
            if (/^(?:[1-9]\d*|0)$/.test(<string>name) && isTupleTypeReference(t))
                return t.target.readonly;
            switch (isReadonlyPropertyFromMappedType(t, name, checker)) {
                case true:
                    return true;
                case false:
                    return false;
                default:
                    // `undefined` falls through
            }
        }
        return (
            // members of namespace import
            isSymbolFlagSet(prop, ts.SymbolFlags.ValueModule) ||
            // we unwrapped every mapped type, now we can check the actual declarations
            symbolHasReadonlyDeclaration(prop, checker)
        );
    });
}

function hasModifiersType(type: ts.Type): type is ts.Type & { modifiersType: ts.Type} {
    return 'modifiersType' in type;
}

function isReadonlyPropertyFromMappedType(type: ts.Type, name: ts.__String, checker: ts.TypeChecker): boolean | undefined {
    if (!isObjectType(type) || !isObjectFlagSet(type, ts.ObjectFlags.Mapped))
        return;
    const declaration = <ts.MappedTypeNode>type.symbol!.declarations![0];
    // well-known symbols are not affected by mapped types
    if (declaration.readonlyToken !== undefined && !/^__@[^@]+$/.test(<string>name))
        return declaration.readonlyToken.kind !== ts.SyntaxKind.MinusToken;

    if (!hasModifiersType(type)) {
        return;
    }

    return isPropertyReadonlyInType((<{modifiersType: ts.Type}><unknown>type).modifiersType, name, checker);
}

export function symbolHasReadonlyDeclaration(symbol: ts.Symbol, checker: ts.TypeChecker) {
    return (symbol.flags & ts.SymbolFlags.Accessor) === ts.SymbolFlags.GetAccessor ||
        symbol.declarations !== undefined &&
        symbol.declarations.some((node) =>
            isModifierFlagSet(node, ts.ModifierFlags.Readonly) ||
            isVariableDeclaration(node) && isNodeFlagSet(node.parent!, ts.NodeFlags.Const) ||
            isCallExpression(node) && isReadonlyAssignmentDeclaration(node, checker) ||
            isEnumMember(node) ||
            (isPropertyAssignment(node) || isShorthandPropertyAssignment(node)) && isInConstContext(node.parent!),
        );
}

/** Returns the the literal name or unique symbol name from a given type. Doesn't unwrap union types. */
export function getPropertyNameFromType(type: ts.Type): PropertyName | undefined {
    // string or number literal. bigint is intentionally excluded
    if (type.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) {
        const value = String((<ts.StringLiteralType | ts.NumberLiteralType>type).value);
        return {displayName: value, symbolName: ts.escapeLeadingUnderscores(value)};
    }
    if (isUniqueESSymbolType(type))
        return {
            displayName: `[${type.symbol
                ? `${isKnownSymbol(type.symbol) ? 'Symbol.' : ''}${type.symbol.name}`
                : (<string>type.escapedName).replace(/^__@|@\d+$/g, '')
            }]`,
            symbolName: type.escapedName,
        };
}

function isKnownSymbol(symbol: ts.Symbol): boolean {
    return isSymbolFlagSet(symbol, ts.SymbolFlags.Property) &&
        symbol.valueDeclaration !== undefined &&
        isInterfaceDeclaration(symbol.valueDeclaration.parent) &&
        symbol.valueDeclaration.parent.name.text === 'SymbolConstructor' &&
        isGlobalDeclaration(symbol.valueDeclaration.parent);
}

function isGlobalDeclaration(node: ts.DeclarationStatement): boolean {
    return isNodeFlagSet(node.parent!, ts.NodeFlags.GlobalAugmentation) || isSourceFile(node.parent) && !ts.isExternalModule(node.parent);
}

export function getSymbolOfClassLikeDeclaration(node: ts.ClassLikeDeclaration, checker: ts.TypeChecker) {
    return checker.getSymbolAtLocation(node.name ?? getChildOfKind(node, ts.SyntaxKind.ClassKeyword)!)!;
}

export function getConstructorTypeOfClassLikeDeclaration(node: ts.ClassLikeDeclaration, checker: ts.TypeChecker) {
    return node.kind === ts.SyntaxKind.ClassExpression
        ? checker.getTypeAtLocation(node)
        : checker.getTypeOfSymbolAtLocation(getSymbolOfClassLikeDeclaration(node, checker), node);
}

export function getInstanceTypeOfClassLikeDeclaration(node: ts.ClassLikeDeclaration, checker: ts.TypeChecker) {
    return node.kind === ts.SyntaxKind.ClassDeclaration
        ? checker.getTypeAtLocation(node)
        : checker.getDeclaredTypeOfSymbol(getSymbolOfClassLikeDeclaration(node, checker));
}

export function getIteratorYieldResultFromIteratorResult(type: ts.Type, node: ts.Node, checker: ts.TypeChecker): ts.Type {
    return isUnionType(type) && type.types.find((t) => {
        const done = t.getProperty('done');
        return done !== undefined &&
            isBooleanLiteralType(removeOptionalityFromType(checker, checker.getTypeOfSymbolAtLocation(done, node)), false);
    }) || type;
}

/** Lookup the declaration of a class member in the super class. */
export function getBaseClassMemberOfClassElement(
    node: ts.PropertyDeclaration | ts.MethodDeclaration | ts.AccessorDeclaration,
    checker: ts.TypeChecker,
): ts.Symbol | undefined {
    if (!isClassLikeDeclaration(node.parent!))
        return;
    const base = getBaseOfClassLikeExpression(node.parent);
    if (base === undefined)
        return;
    const name = getSingleLateBoundPropertyNameOfPropertyName(node.name, checker);
    if (name === undefined)
        return;
    const baseType = checker.getTypeAtLocation(
        hasModifier(node.modifiers, ts.SyntaxKind.StaticKeyword)
            ? base.expression
            : base,
    );
    return getPropertyOfType(baseType, name.symbolName);
}
