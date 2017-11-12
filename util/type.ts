import * as ts from 'typescript';

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
