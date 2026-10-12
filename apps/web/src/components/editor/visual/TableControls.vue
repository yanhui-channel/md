<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { AlignCenter, AlignLeft, AlignRight, BetweenHorizontalStart, BetweenVerticalStart, Columns3, Rows3, Trash2 } from '@lucide/vue'
import { setColumnWidth } from '@/lib/visual/objects'

const props = defineProps<{ editor: Editor }>()
const { t } = useI18n()
const tick = ref(0)
watchEffect((cleanup) => {
  const instance = props.editor
  const update = () => { tick.value++ }
  instance.on('transaction', update)
  cleanup(() => instance.off('transaction', update))
})
const active = computed(() => { void tick.value; return props.editor.isActive('table') })
const width = computed(() => {
  void tick.value
  return (props.editor.getAttributes('tableCell').colwidth ?? props.editor.getAttributes('tableHeader').colwidth)?.[0] ?? ''
})
const tools = computed(() => [
  { name: 'addRow', icon: BetweenHorizontalStart, run: () => props.editor.chain().focus().addRowAfter().run() },
  { name: 'addColumn', icon: BetweenVerticalStart, run: () => props.editor.chain().focus().addColumnAfter().run() },
  { name: 'deleteRow', icon: Rows3, run: () => props.editor.chain().focus().deleteRow().run() },
  { name: 'deleteColumn', icon: Columns3, run: () => props.editor.chain().focus().deleteColumn().run() },
  { name: 'deleteTable', icon: Trash2, run: () => props.editor.chain().focus().deleteTable().run() },
])
function resize(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.checkValidity())
    setColumnWidth(props.editor, Number(input.value))
}
</script>

<template>
  <div v-if="active" class="visual-tool-row visual-object-tools" role="group" :aria-label="t('visual.table')">
    <Tooltip v-for="tool in tools" :key="tool.name">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :aria-label="t(`visual.${tool.name}`)" @mousedown.prevent @click="tool.run">
          <component :is="tool.icon" :size="17" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ t(`visual.${tool.name}`) }}</TooltipContent>
    </Tooltip>
    <label class="visual-number">{{ t('visual.columnWidth') }}<input type="number" min="60" max="1200" step="1" :aria-label="t('visual.columnWidth')" :value="width" placeholder="px" @input="resize"></label>
    <Tooltip v-for="(icon, index) in [AlignLeft, AlignCenter, AlignRight]" :key="index">
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon" :aria-label="t(`visual.cell${['Left', 'Center', 'Right'][index]}`)" @mousedown.prevent @click="editor.chain().focus().setCellAttribute('align', ['left', 'center', 'right'][index]).run()">
          <component :is="icon" :size="17" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ t(`visual.cell${['Left', 'Center', 'Right'][index]}`) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
