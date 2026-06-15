import type { Link, LinkType, ObjectInstance, ObjectType, PropertyValue } from "./types.ts"

/**
 * The semantic layer: a registry of object types, link types, and their
 * instances — daemoncode's "ontology". It is an in-memory knowledge graph that
 * the kinetic and dynamic layers read and write through.
 */
export class Ontology {
  private readonly objectTypes = new Map<string, ObjectType>()
  private readonly linkTypes = new Map<string, LinkType>()
  private readonly objects = new Map<string, ObjectInstance>()
  private readonly links: Link[] = []

  registerObjectType(type: ObjectType): this {
    this.objectTypes.set(type.name, type)
    return this
  }

  registerLinkType(type: LinkType): this {
    this.linkTypes.set(type.name, type)
    return this
  }

  getObjectType(name: string): ObjectType | undefined {
    return this.objectTypes.get(name)
  }

  getLinkType(name: string): LinkType | undefined {
    return this.linkTypes.get(name)
  }

  /** Insert or replace an object instance. Validates the type is registered. */
  upsert(instance: ObjectInstance): this {
    if (!this.objectTypes.has(instance.type)) {
      throw new Error(`Ontology.upsert: unknown object type "${instance.type}"`)
    }
    this.objects.set(instance.id, instance)
    return this
  }

  /** Add a typed edge. Validates the link type and that both endpoints exist. */
  link(type: string, from: string, to: string): this {
    const linkType = this.linkTypes.get(type)
    if (!linkType) throw new Error(`Ontology.link: unknown link type "${type}"`)
    const a = this.objects.get(from)
    const b = this.objects.get(to)
    if (!a) throw new Error(`Ontology.link: missing source "${from}"`)
    if (!b) throw new Error(`Ontology.link: missing target "${to}"`)
    if (a.type !== linkType.from || b.type !== linkType.to) {
      throw new Error(
        `Ontology.link: "${type}" expects ${linkType.from}->${linkType.to}, got ${a.type}->${b.type}`,
      )
    }
    if (!this.links.some((l) => l.type === type && l.from === from && l.to === to)) {
      this.links.push({ type, from, to })
    }
    return this
  }

  get(id: string): ObjectInstance | undefined {
    return this.objects.get(id)
  }

  /** Read a single property off an instance. */
  property(id: string, key: string): PropertyValue | undefined {
    return this.objects.get(id)?.properties[key]
  }

  /** Set a property (used by merge / dynamic layer). Returns the previous value. */
  setProperty(id: string, key: string, value: PropertyValue): PropertyValue | undefined {
    const obj = this.objects.get(id)
    if (!obj) throw new Error(`Ontology.setProperty: missing object "${id}"`)
    const prev = obj.properties[key]
    obj.properties[key] = value
    return prev
  }

  allObjects(): ObjectInstance[] {
    return [...this.objects.values()]
  }

  objectsOfType(typeName: string): ObjectInstance[] {
    return this.allObjects().filter((o) => o.type === typeName)
  }

  allLinks(): Link[] {
    return [...this.links]
  }
}

/** Convenience builder for an object instance. */
export function obj(
  type: string,
  id: string,
  properties: Record<string, PropertyValue> = {},
): ObjectInstance {
  return { type, id, properties }
}
