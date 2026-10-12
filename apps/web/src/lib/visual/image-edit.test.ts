import type { StoredAsset } from '@/storage/repositories/assets'
// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assetRepo } from '@/storage/repositories/assets'
import { createVisualCodec } from './codec'
import { saveLocalImages } from './image-edit'

vi.mock('@/storage/repositories/assets', () => ({ assetRepo: { put: vi.fn() } }))
const cleanup: (() => void)[] = []
const savedAsset: StoredAsset = { path: 'assets/saved.png', sha256: '', size: 1, mime: 'image/png', blob: new Blob(['a']) }
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.resetAllMocks() })
function fixture() {
  const codec = createVisualCodec()
  const editor = new Editor({ extensions: codec.extensions, content: codec.parse('text\n\n![a](a.png)\n\n![a](a.png)') })
  cleanup.push(() => editor.destroy())
  return editor
}
describe('asynchronous local image insertion', () => {
  it('lateUploadCannotEditAnotherPost', async () => {
    const visual = fixture()
    let current = 'a'
    let finish!: (value: StoredAsset) => void
    vi.mocked(assetRepo.put).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const before = visual.getJSON()
    const saving = saveLocalImages([new File(['a'], 'a.png')], { visual, postId: 'a', currentPostId: () => current })
    current = 'b'
    finish(savedAsset)
    await expect(saving).rejects.toThrow('visual.uploadTargetChanged')
    expect(visual.getJSON()).toEqual(before)
  })
  it('maps the selected duplicate image through intervening edits and retains layout', async () => {
    const visual = fixture()
    visual.commands.setNodeSelection(7)
    visual.commands.updateAttributes('image', { width: 120, align: 'right' })
    let finish!: (value: StoredAsset) => void
    vi.mocked(assetRepo.put).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const saving = saveLocalImages([new File(['a'], 'a.png')], { visual, postId: 'a', currentPostId: () => 'a' }, true)
    visual.commands.insertContentAt(1, 'new')
    finish(savedAsset)
    await saving
    const images = visual.getJSON().content!.filter(node => node.type === 'image')
    expect(images[0].attrs!.src).toBe('a.png')
    expect(images[1].attrs).toMatchObject({ src: 'assets/saved.png', width: 120, align: 'right' })
  })
  it('storage failure leaves source and selection unchanged', async () => {
    const source = new EditorView({ state: EditorState.create({ doc: 'original', selection: { anchor: 4 } }) })
    cleanup.push(() => source.destroy())
    vi.mocked(assetRepo.put).mockRejectedValueOnce(new Error('quota'))
    await expect(saveLocalImages([new File(['a'], 'a.png')], { source, postId: 'a', currentPostId: () => 'a' })).rejects.toThrow('quota')
    expect(source.state.doc.toString()).toBe('original')
    expect(source.state.selection.main.anchor).toBe(4)
  })
})
