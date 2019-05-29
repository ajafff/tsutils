export * from '../2.9/type';

import * as ts from 'typescript';
import { isTypeReference } from '../2.9/type';

export function isTupleType(type: ts.Type): type is ts.TupleType {
    return (type.flags & ts.TypeFlags.Object && (<ts.ObjectType>type).objectFlags & ts.ObjectFlags.Tuple) !== 0;
}

export function isTupleTypeReference(type: ts.Type): type is ts.TypeReference & {target: ts.TupleType} {
    return isTypeReference(type) && isTupleType(type.target);
}
