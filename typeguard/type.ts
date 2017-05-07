import * as ts from 'typescript';

export function isEnumType(type: ts.Type): type is ts.EnumType {
    return (type.flags & ts.TypeFlags.Enum) !== 0;
}

export function isGenericType(type: ts.Type): type is ts.GenericType {
    return (type.flags & ts.TypeFlags.Object) !== 0 &&
        ((<ts.ObjectType>type).objectFlags & ts.ObjectFlags.ClassOrInterface) !== 0 &&
        ((<ts.ObjectType>type).objectFlags & ts.ObjectFlags.Reference) !== 0;
}

export function isIndexedAccessType(type: ts.Type): type is ts.IndexedAccessType {
    return (type.flags & ts.TypeFlags.IndexedAccess) !== 0;
}

export function isIndexedAccessype(type: ts.Type): type is ts.IndexType {
    return (type.flags & ts.TypeFlags.Index) !== 0;
}

export function isInterfaceType(type: ts.Type): type is ts.InterfaceType {
    return (type.flags & ts.TypeFlags.Object) !== 0 &&
        ((<ts.ObjectType>type).objectFlags & ts.ObjectFlags.ClassOrInterface) !== 0;
}

export function isIntersectionType(type: ts.Type): type is ts.IntersectionType {
    return (type.flags & ts.TypeFlags.Intersection) !== 0;
}

export function isLiteralType(type: ts.Type): type is ts.LiteralType {
    return (type.flags & ts.TypeFlags.Literal) !== 0;
}

export function isObjectType(type: ts.Type): type is ts.ObjectType {
    return (type.flags & ts.TypeFlags.Object) !== 0;
}

export function isTypeParameter(type: ts.Type): type is ts.TypeParameter {
    return (type.flags & ts.TypeFlags.TypeParameter) !== 0;
}

export function isTypeReference(type: ts.Type): type is ts.TypeReference {
    return (type.flags & ts.TypeFlags.Object) !== 0 &&
        ((<ts.ObjectType>type).objectFlags & ts.ObjectFlags.Reference) !== 0;
}

export function isTypeVariable(type: ts.Type): type is ts.TypeVariable {
    return (type.flags & ts.TypeFlags.TypeVariable) !== 0;
}

export function isUnionOrIntersectionType(type: ts.Type): type is ts.UnionOrIntersectionType {
    return (type.flags & ts.TypeFlags.UnionOrIntersection) !== 0;
}

export function isUnionType(type: ts.Type): type is ts.UnionType {
    return (type.flags & ts.TypeFlags.Union) !== 0;
}
