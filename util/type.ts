import * as ts from 'typescript';
import { isTypeParameter, isUnionType, isIntersectionType } from '../typeguard/type';
import { isTypeFlagSet } from './util';

export function isEmptyObjectType(type: ts.Type): type is ts.ObjectType {
    if (type.flags & ts.TypeFlags.Object &&
        (<ts.ObjectType>type).objectFlags & ts.ObjectFlags.Anonymous &&
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
    if (!isUnionType(type))
        return isTypeFlagSet(type, flag);
    for (const t of type.types)
        if (isTypeFlagSet(t, flag))
            return true;
    return false;
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
                return true;
            return check(checker.getTypeFromTypeNode(declaration.constraint));
        }
        if (isUnionType(t))
            return t.types.every(check);
        if (isIntersectionType(t))
            return t.types.some(check);

        return isTypeFlagSet(t, flags);
    })(type);
}

/**
 * Returns true if the given type is a union type that includes Promise or a type that extends
 * Promise.
 */
export function isPromiseType(type: ts.Type): boolean {
    const isPromise = (t: ts.Type) => {
        const sym = t.getSymbol();
        if (sym !== undefined) return sym.name === 'Promise';
        return false;
    };

    const baseTypes = type.getBaseTypes();
    if (baseTypes && baseTypes.some(isPromise)) return true;

    if (isUnionType(type) || isIntersectionType(type)) return type.types.some(isPromise);

    return isPromise(type);
}

export function getCallSignaturesOfType(type: ts.Type): ts.Signature[] {
    if (isUnionType(type)) {
        const signatures = [];
        for (const t of type.types)
            signatures.push(...getCallSignaturesOfType(t));
        return signatures;
    }
    if (isIntersectionType(type)) {
        let signatures: ts.Signature[] | undefined;
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
