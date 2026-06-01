export function prop<NameT extends keyof any>(
    name: NameT,
): <ObjT extends {[Key in NameT]: any}>(obj: ObjT) => ObjT[NameT] {
    return (obj) => obj[name];
}
