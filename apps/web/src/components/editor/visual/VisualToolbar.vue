<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { AlignCenter, AlignLeft, AlignRight, Bold, Code, FileCode2, ImagePlus, Italic, Link, List, ListOrdered, Quote, Redo2, RotateCcw, Strikethrough, Table, Underline, Undo2 } from '@lucide/vue'
import { insertVisualCodeBlock } from '@/lib/visual/objects'
import { safeVisualUrl } from '@/lib/visual/style'
import { useEditorStore } from '@/stores/editor'
import ImageControls from './ImageControls.vue'
import TableControls from './TableControls.vue'

const props = defineProps<{ editor: Editor }>()
const store = useEditorStore()
const { t } = useI18n()
const tick = ref(0)
const linkOpen = ref(false)
const linkUrl = ref('')
const linkError = ref(false)
const imageInput = ref<HTMLInputElement>()
const imageSaving = ref(false)
async function selectImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  imageSaving.value = true
  try { await store.addImages(files) }
  catch (error) { const message = error instanceof Error ? error.message : String(error); toast.error(message.startsWith('visual.') || message.startsWith('upload.') ? t(message) : message) }
  finally { imageSaving.value = false }
}
watchEffect((cleanup) => {
  const instance = props.editor
  const update = () => { tick.value++ }
  instance.on('transaction', update)
  cleanup(() => instance.off('transaction', update))
})
const tools = computed(() => {
  void tick.value
  return [
    { key: 'bold', icon: Bold, active: props.editor.isActive('bold'), run: () => props.editor.chain().focus().toggleBold().run() },
    { key: 'italic', icon: Italic, active: props.editor.isActive('italic'), run: () => props.editor.chain().focus().toggleItalic().run() },
    { key: 'underline', icon: Underline, active: props.editor.isActive('underline'), run: () => props.editor.chain().focus().toggleUnderline().run() },
    { key: 'strike', icon: Strikethrough, active: props.editor.isActive('strike'), run: () => props.editor.chain().focus().toggleStrike().run() },
    { key: 'code', icon: Code, active: props.editor.isActive('code'), run: () => props.editor.chain().focus().toggleCode().run() },
    { key: 'bulletList', icon: List, active: props.editor.isActive('bulletList'), run: () => props.editor.chain().focus().toggleBulletList().run() },
    { key: 'orderedList', icon: ListOrdered, active: props.editor.isActive('orderedList'), run: () => props.editor.chain().focus().toggleOrderedList().run() },
    { key: 'quote', icon: Quote, active: props.editor.isActive('blockquote'), run: () => props.editor.chain().focus().toggleBlockquote().run() },
  ]
})
const heading = computed(() => { void tick.value; return props.editor.getAttributes('heading').level ?? 0 })
const fontSize = computed(() => { void tick.value; return props.editor.getAttributes('textStyle').fontSize ?? '' })
const spacing = computed(() => { void tick.value; return props.editor.getAttributes(props.editor.isActive('heading') ? 'heading' : 'paragraph') })
function setHeading(event: Event) {
  const level = Number((event.target as HTMLSelectElement).value)
  if (level)
    props.editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run()
  else props.editor.chain().focus().setParagraph().run()
}
function setBlock(name: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!(event.target as HTMLInputElement).checkValidity())
    return
  const attrs = { [name]: value ? `${value}${name === 'blockSpacing' ? 'px' : ''}` : null }
  props.editor.chain().focus().updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).run()
}
function setFontSize(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const chain = props.editor.chain().focus()
  if (value)
    chain.setFontSize(value).run()
  else chain.unsetFontSize().run()
}
function toggleLink() {
  linkUrl.value = props.editor.getAttributes('link').href ?? ''
  linkOpen.value = !linkOpen.value
  linkError.value = false
}
function applyLink() {
  if (linkUrl.value && !safeVisualUrl(linkUrl.value)) { linkError.value = true; return }
  const chain = props.editor.chain().focus().extendMarkRange('link')
  if (linkUrl.value)
    chain.setLink({ href: linkUrl.value }).run()
  else chain.unsetLink().run()
  linkOpen.value = false
}
function resetStyle() {
  props.editor.chain().focus().unsetAllMarks().resetAttributes('paragraph', ['textAlign', 'lineHeight', 'blockSpacing']).resetAttributes('heading', ['textAlign', 'lineHeight', 'blockSpacing']).run()
}
function insertCode() {
  if (!insertVisualCodeBlock(props.editor))
    toast.error(t('visual.codeTextOnly'))
}
</script>

<template>
  <TooltipProvider>
    <div class="visual-toolbar" role="toolbar" :aria-label="t('visual.tools')" @pointerdown="store.activeTarget = 'visual'">
      <div class="visual-tool-row">
        <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden @change="selectImages">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :disabled="imageSaving" :aria-label="t('visual.insertImage')" @mousedown.prevent @click="imageInput?.click()">
              <ImagePlus :size="17" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t('visual.insertImage') }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t('visual.insertTable')" @mousedown.prevent @click="editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()">
              <Table :size="17" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t('visual.insertTable') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-for="action in ['undo', 'redo']" :key="action">
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t(`visual.${action}`)" @mousedown.prevent @click="action === 'undo' ? store.visualSession?.undo() : store.visualSession?.redo(); editor.commands.focus()">
              <Undo2 v-if="action === 'undo'" :size="17" /><Redo2 v-else :size="17" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t(`visual.${action}`) }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t('visual.insertCodeBlock')" @mousedown.prevent @click="insertCode">
              <FileCode2 :size="17" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t('visual.insertCodeBlock') }}</TooltipContent>
        </Tooltip>
        <select :aria-label="t('visual.heading')" :value="heading" @change="setHeading">
          <option :value="0">
            {{ t('visual.paragraph') }}
          </option>
          <option v-for="level in 6" :key="level" :value="level">
            H{{ level }}
          </option>
        </select>
        <Tooltip v-for="tool in tools" :key="tool.key">
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t(`visual.${tool.key}`)" :aria-pressed="tool.active" @mousedown.prevent @click="tool.run">
              <component :is="tool.icon" :size="17" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t(`visual.${tool.key}`) }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" data-visual-link :aria-label="t('visual.link')" :aria-pressed="linkOpen" @mousedown.prevent @click="toggleLink">
              <Link :size="17" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t('visual.link') }}</TooltipContent>
        </Tooltip>
      </div>
      <div class="visual-tool-row">
        <select :aria-label="t('visual.fontSize')" :value="fontSize" @change="setFontSize">
          <option value="">
            {{ t('visual.fontSize') }}
          </option>
          <option v-for="size in [14, 15, 16, 17, 18, 20, 22, 24, 28, 32]" :key="size" :value="`${size}px`">
            {{ size }}px
          </option>
        </select>
        <label class="visual-number">{{ t('visual.lineHeight') }}<input type="number" min="1" max="3" step="0.1" :aria-label="t('visual.lineHeight')" :value="spacing.lineHeight ?? ''" placeholder="2.05" @change="setBlock('lineHeight', $event)"></label>
        <label class="visual-number">{{ t('visual.spacing') }}<input type="number" min="0" max="80" step="2" :aria-label="t('visual.spacing')" :value="spacing.blockSpacing?.replace('px', '') ?? ''" placeholder="22" @change="setBlock('blockSpacing', $event)"></label>
        <Tooltip v-for="(icon, index) in [AlignLeft, AlignCenter, AlignRight]" :key="index">
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t(`visual.${['left', 'center', 'right'][index]}`)" @mousedown.prevent @click="editor.chain().focus().setTextAlign(['left', 'center', 'right'][index]).run()">
              <component :is="icon" :size="17" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t(`visual.${['left', 'center', 'right'][index]}`) }}</TooltipContent>
        </Tooltip>
        <input type="color" class="visual-color" :aria-label="t('visual.color')" value="#4285f4" @input="editor.chain().focus().setColor(($event.target as HTMLInputElement).value).run()">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :aria-label="t('visual.reset')" @mousedown.prevent @click="resetStyle">
              <RotateCcw :size="16" />
            </Button>
          </TooltipTrigger><TooltipContent>{{ t('visual.reset') }}</TooltipContent>
        </Tooltip>
      </div>
      <div class="visual-object-slot">
        <TableControls :editor="editor" />
        <ImageControls :editor="editor" />
      </div>
      <form v-if="linkOpen" class="visual-link-form" @submit.prevent="applyLink">
        <input v-model="linkUrl" type="text" :aria-label="t('visual.linkUrl')" placeholder="https://" :aria-invalid="linkError">
        <Button type="submit" size="sm" variant="outline">
          {{ t('visual.apply') }}
        </Button>
        <span v-if="linkError" role="alert">{{ t('visual.invalidLink') }}</span>
      </form>
    </div>
  </TooltipProvider>
</template>
