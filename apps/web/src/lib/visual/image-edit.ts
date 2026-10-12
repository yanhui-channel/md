import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import type { Transaction as PMTransaction } from '@tiptap/pm/state'
import { Compartment, StateEffect, Transaction } from '@codemirror/state'
import { EditorView as CMView } from '@codemirror/view'
import { NodeSelection } from '@tiptap/pm/state'
import { assetRepo } from '@/storage/repositories/assets'

export interface ImageTarget { postId: string, currentPostId: () => string, visual?: Editor, source?: EditorView }
export async function saveLocalImages(files: File[], target: ImageTarget, replace = false): Promise<string[]> {
  const { visual, source } = target
  const selection = visual?.state.selection ?? source?.state.selection.main
  if (!selection || !files.length)
    return []
  let { from, to } = selection
  let cancelled = false
  const oldImage = selection instanceof NodeSelection && selection.node.type.name === 'image' ? selection.node : null
  if (replace && (!oldImage || files.length !== 1))
    throw new Error('visual.uploadTargetChanged')
  const compartment = new Compartment()
  const onTransaction = ({ transaction }: { transaction: PMTransaction }) => {
    const mapped = transaction.mapping.mapResult(from)
    if (replace && mapped.deleted)
      cancelled = true
    from = mapped.pos
    to = transaction.mapping.map(to)
  }
  if (visual) {
    visual.on('transaction', onTransaction)
  }
  else {
    source!.dispatch({ effects: StateEffect.appendConfig.of(compartment.of(CMView.updateListener.of((update) => {
      if (target.currentPostId() !== target.postId || update.transactions.some(tr => tr.annotation(Transaction.addToHistory) === false))
        cancelled = true
      from = update.changes.mapPos(from)
      to = update.changes.mapPos(to)
    }))) })
  }
  try {
    const paths: string[] = []
    for (const file of files)
      paths.push((await assetRepo.put(file)).path)
    if (cancelled || target.currentPostId() !== target.postId || visual?.isDestroyed)
      throw new Error('visual.uploadTargetChanged')
    if (visual) {
      if (replace) {
        const node = visual.state.doc.nodeAt(from)
        if (node?.type.name !== 'image' || node.attrs.src !== oldImage!.attrs.src)
          throw new Error('visual.uploadTargetChanged')
        visual.view.dispatch(visual.state.tr.setNodeMarkup(from, undefined, { ...node.attrs, src: paths[0] }))
      }
      else {
        visual.commands.insertContentAt({ from, to }, paths.map((src, i) => ({ type: 'image', attrs: { src, alt: files[i].name } })))
      }
    }
    else {
      const markdown = `\n\n${paths.map(src => `![](${src})`).join('\n\n')}\n\n`
      source!.dispatch({ changes: { from, to, insert: markdown }, selection: { anchor: from + markdown.length } })
    }
    return paths
  }
  finally {
    if (visual)
      visual.off('transaction', onTransaction)
    else source!.dispatch({ effects: compartment.reconfigure([]) })
  }
}
