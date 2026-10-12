import type { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/core'
import type { Transaction as VisualTransaction } from '@tiptap/pm/state'
import type { VisualCodec } from './codec'
import { Annotation, Compartment, EditorState, StateEffect, Transaction } from '@codemirror/state'
import { EditorView as CMView } from '@codemirror/view'
import { isolateHistory, redoHistory, undoHistory } from '@md/shared/editor'
import { Selection, TextSelection } from '@tiptap/pm/state'
import DiffMatchPatch from 'diff-match-patch'

export interface DocumentSnapshot { postId: string, title: string, revision: number, markdown: string }
export type SessionStatus = 'editing' | 'saving' | 'saved' | 'error'
export interface SessionOptions {
  source: EditorView
  codec: VisualCodec
  postId: string
  title: () => string
  onChange: (snapshot: DocumentSnapshot) => void
  save: (snapshot: DocumentSnapshot) => Promise<void>
  onStatus: (status: SessionStatus, error?: unknown) => void
}
export interface VisualSession {
  isComposing: () => boolean
  snapshot: () => DocumentSnapshot
  capture: () => DocumentSnapshot
  commitPending: (force?: boolean) => void
  flush: () => Promise<DocumentSnapshot>
  undo: () => boolean
  redo: () => boolean
  dispose: () => void
}

export function createVisualSession(visual: Editor, options: SessionOptions): VisualSession {
  const { source, codec } = options
  const compartment = new Compartment()
  const origin = Annotation.define<boolean>()
  const differ = new DiffMatchPatch()
  let revision = 0
  let disposed = false
  let mirrored = false
  let pending = false
  let composing = false
  let typing = false
  let sourceOrigin: 'source' | 'visual' = 'source'
  let baseline = source.state.doc.toString()
  let syncError: unknown = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const bookmarks = new Map<string, ReturnType<Selection['toJSON']>>()

  visual.commands.setContent(codec.parse(baseline), { emitUpdate: false })
  let selection = visual.state.selection.toJSON()
  const snapshot = (): DocumentSnapshot => ({ postId: options.postId, title: options.title(), revision, markdown: source.state.doc.toString() })
  const reportError = (error: unknown) => { syncError = error; options.onStatus('error', error) }

  function mirrorSource() {
    if (disposed || composing || pending)
      return
    try {
      const markdown = source.state.doc.toString()
      const doc = codec.parse(markdown)
      mirrored = true
      visual.commands.setContent(doc, { emitUpdate: false })
      const bookmark = bookmarks.get(markdown) ?? selection
      let restored: Selection
      try { restored = Selection.fromJSON(visual.state.doc, bookmark) }
      catch { restored = TextSelection.near(visual.state.doc.resolve(Math.min(bookmark.anchor ?? 0, visual.state.doc.content.size))) }
      visual.view.dispatch(visual.state.tr.setSelection(restored))
      baseline = markdown
      syncError = null
    }
    catch (error) { reportError(error) }
    finally { mirrored = false }
  }

  function capture(): DocumentSnapshot {
    commitPending(true)
    if (syncError)
      throw syncError
    return snapshot()
  }

  async function flush(): Promise<DocumentSnapshot> {
    if (composing || source.composing)
      throw new Error('composition_active')
    const frozen = capture()
    clearTimeout(saveTimer)
    options.onStatus('saving')
    try {
      await options.save(frozen)
      if (!disposed && frozen.revision === revision)
        options.onStatus('saved')
      return frozen
    }
    catch (error) {
      if (!disposed)
        options.onStatus('error', error)
      throw error
    }
  }

  function commitPending(force = false) {
    if (disposed || !pending || (composing && !force))
      return
    try {
      if (source.state.doc.toString() !== baseline)
        throw new Error('visual.conflictingInput')
      const markdown = codec.serialize(visual.getJSON())
      bookmarks.set(baseline, selection)
      bookmarks.set(markdown, visual.state.selection.toJSON())
      if (bookmarks.size > 100)
        bookmarks.delete(bookmarks.keys().next().value!)
      const changes: { from: number, to: number, insert: string }[] = []
      let offset = 0
      for (const [operation, value] of differ.diff_main(baseline, markdown)) {
        if (operation === 0) { offset += value.length; continue }
        if (operation === -1) { changes.push({ from: offset, to: offset + value.length, insert: '' }); offset += value.length }
        else { changes.push({ from: offset, to: offset, insert: value }) }
      }
      syncError = null
      if (changes.length) {
        source.dispatch({
          changes,
          annotations: [origin.of(true), Transaction.userEvent.of('input.type'), ...(!typing ? [isolateHistory.of('full')] : sourceOrigin !== 'visual' ? [isolateHistory.of('before')] : [])],
        })
      }
      pending = false
      baseline = source.state.doc.toString()
    }
    catch (error) { reportError(error); throw error }
  }

  function onUpdate(event?: { transaction: VisualTransaction }) {
    if (disposed || mirrored)
      return
    if (event?.transaction.getMeta('visualHistoryBoundary'))
      typing = false
    pending = true
    options.onStatus('editing')
    try { commitPending() }
    catch { /* The current visual document remains available for rescue. */ }
    typing = false
  }
  function onSelection() {
    if (!pending && !mirrored)
      selection = visual.state.selection.toJSON()
  }
  const compositionStart = () => { composing = true }
  const compositionEnd = () => {
    composing = false; queueMicrotask(() => {
      if (!disposed)
        onUpdate()
    })
  }
  const beforeInput = (event: Event) => { typing = (event as InputEvent).inputType === 'insertText' }
  const sourceCompositionEnd = () => {
    queueMicrotask(mirrorSource)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { void flush().catch(() => {}) }, 500)
  }
  const keydown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !['z', 'y'].includes(event.key.toLowerCase()))
      return
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey || event.key.toLowerCase() === 'y')
      redo()
    else undo()
  }
  source.dispatch({ effects: StateEffect.appendConfig.of(compartment.of([
    EditorState.transactionExtender.of(tr => tr.docChanged && !tr.annotation(origin) && sourceOrigin === 'visual'
      ? { annotations: isolateHistory.of('before') }
      : null),
    CMView.updateListener.of((update) => {
      if (!update.docChanged || disposed)
        return
      revision++
      const fromVisual = update.transactions.some(tr => tr.annotation(origin))
      sourceOrigin = fromVisual ? 'visual' : 'source'
      if (!fromVisual && !source.composing)
        mirrorSource()
      options.onChange(snapshot())
      if (!syncError)
        options.onStatus('editing')
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { void flush().catch(() => {}) }, 500)
    }),
  ])) })
  visual.on('update', onUpdate)
  visual.on('selectionUpdate', onSelection)
  visual.view.dom.addEventListener('compositionstart', compositionStart)
  visual.view.dom.addEventListener('compositionend', compositionEnd)
  visual.view.dom.addEventListener('beforeinput', beforeInput)
  visual.view.dom.addEventListener('keydown', keydown, true)
  source.contentDOM.addEventListener('compositionend', sourceCompositionEnd)

  function undo() { commitPending(true); return !disposed && undoHistory(source) }
  function redo() { commitPending(true); return !disposed && redoHistory(source) }
  function dispose() {
    if (disposed)
      return
    disposed = true
    clearTimeout(saveTimer)
    visual.off('update', onUpdate)
    visual.off('selectionUpdate', onSelection)
    visual.view.dom.removeEventListener('compositionstart', compositionStart)
    visual.view.dom.removeEventListener('compositionend', compositionEnd)
    visual.view.dom.removeEventListener('beforeinput', beforeInput)
    visual.view.dom.removeEventListener('keydown', keydown, true)
    source.contentDOM.removeEventListener('compositionend', sourceCompositionEnd)
    source.dispatch({ effects: compartment.reconfigure([]) })
  }
  return { isComposing: () => composing || source.composing, snapshot, capture, commitPending, flush, undo, redo, dispose }
}
