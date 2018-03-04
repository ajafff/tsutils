import * as ts from 'typescript';
import { isTypeParameter, isUnionType, isIntersectionType, isLiteralType, isObjectType } from '../typeguard/type';
import { isTypeFlagSet } from './util';

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

/** Returns all types of a union type or an array containing `type` itself if it's no union type. */
export function unionTypeParts(type: ts.Type): ts.Type[] {
    return isUnionType(type) ? type.types : [type];
}

/** Determines if a type thenable and can be used with `await`. */
export function isThenableType(checker: ts.TypeChecker, node: ts.Expression, type = checker.getTypeAtLocation(node)): boolean {
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

function isCallback(checker: ts.TypeChecker, param: ts.Symbol, node: ts.Expression): boolean {
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
    if (type.flags & ts.TypeFlags.BooleanLiteral)
        return (<{intrinsicName: string}><{}>type).intrinsicName === 'false';
    return false;
}
