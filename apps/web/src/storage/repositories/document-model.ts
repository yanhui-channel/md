import type { StoredDocument } from '@/storage/db'
import type { Post } from '@/types/post'
import { normalizePostHistory } from '@/lib/format/datetime'

export function toStored(post: Post): StoredDocument {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    history: normalizePostHistory(post.history),
    createDatetime: new Date(post.createDatetime).toISOString(),
    updateDatetime: new Date(post.updateDatetime).toISOString(),
    parentId: post.parentId ?? null,
    collapsed: post.collapsed,
    themeId: post.themeId,
  }
}
export function fromStored(doc: StoredDocument): Post {
  return { ...doc, history: normalizePostHistory(doc.history), createDatetime: new Date(doc.createDatetime), updateDatetime: new Date(doc.updateDatetime), parentId: doc.parentId ?? null }
}
