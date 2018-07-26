export * from '../2.9/type';

import * as ts from 'typescript';

export function isTupleType(type: ts.Type): type is ts.TupleType {
    return (type.flags & ts.TypeFlags.Object && (<ts.ObjectType>type).objectFlags & ts.ObjectFlags.Tuple) !== 0;
}
