import type { Doc, Query } from "@blocksuite/store"
import { DocCollection } from "@blocksuite/store"
import type { OpencodeDocSource } from "./opencode-doc-source"

type YDoc = InstanceType<typeof DocCollection.Y.Doc>

function subdoc(collection: DocCollection, page: string) {
  return collection.doc.spaces.get(page)
}

function bind(collection: DocCollection, page: string, readonly?: boolean, query?: Query) {
  const doc = collection.getDoc(page, { readonly, query })
  if (doc) return doc
  if (!subdoc(collection, page)) return null
  if (!collection.meta.getDocMeta(page)) {
    collection.meta.addDocMeta({
      id: page,
      title: "",
      createDate: Date.now(),
      tags: [],
    })
  }
  return collection.getDoc(page, { readonly, query })
}

export async function load(source: OpencodeDocSource, id: string, doc: YDoc) {
  const next = await source.pull(id, DocCollection.Y.encodeStateVector(doc))
  if (next?.data.length) DocCollection.Y.applyUpdate(doc, next.data, source.name)
}

export async function link(source: OpencodeDocSource, root: YDoc, page: YDoc) {
  const apply = (id: string, data: Uint8Array) => {
    if (id !== page.guid) return
    DocCollection.Y.applyUpdate(page, data, source.name)
  }
  const stop = await source.subscribe(apply, () => undefined)
  await load(source, root.guid, root)
  await load(source, page.guid, page)
  await source.push(root.guid, DocCollection.Y.encodeStateAsUpdate(root))
  await source.push(page.guid, DocCollection.Y.encodeStateAsUpdate(page))
  const push = (data: Uint8Array, origin: unknown, doc: YDoc) => {
    if (origin === source.name) return
    void source.push(doc.guid, data)
  }
  page.on("update", push)
  return () => {
    page.off("update", push)
    stop()
    source.close()
  }
}

export async function remote(
  source: OpencodeDocSource,
  collection: DocCollection,
  root: string,
  page: string,
  readonly?: boolean,
  query?: Query,
) {
  await load(source, root, collection.doc)
  const doc = bind(collection, page, readonly, query)
  if (!doc) return
  if (!doc.loaded) doc.load()
  await load(source, page, doc.spaceDoc)
  if (!doc.root) return
  return doc
}
