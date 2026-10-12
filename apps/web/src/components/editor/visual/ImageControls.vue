<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { AlignCenter, AlignLeft, AlignRight, FolderOpen, Replace, Trash2 } from '@lucide/vue'
import { updateSelectedImage } from '@/lib/visual/objects'
import { useEditorStore } from '@/stores/editor'

const props = defineProps<{ editor: Editor }>()
const { t } = useI18n()
const tick = ref(0)
const replacing = ref(false)
const url = ref('')
const invalid = ref(false)
const fileInput = ref<HTMLInputElement>()
const saving = ref(false)
const store = useEditorStore()
async function replaceFile(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length)
    return
  saving.value = true
  try { await store.addImages(files, true) }
  catch (error) { const message = error instanceof Error ? error.message : String(error); toast.error(message.startsWith('visual.') || message.startsWith('upload.') ? t(message) : message) }
  finally { saving.value = false }
}
watchEffect((cleanup) => {
  const instance = props.editor
  const update = () => { tick.value++ }
  instance.on('transaction', update)
  cleanup(() => instance.off('transaction', update))
})
const active = computed(() => { void tick.value; return props.editor.isActive('image') })
const attrs = computed(() => { void tick.value; return props.editor.getAttributes('image') })
watch(active, () => { replacing.value = false; invalid.value = false })
function resize(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.checkValidity())
    updateSelectedImage(props.editor, { width: Number(input.value) })
}
function replace() {
  invalid.value = !updateSelectedImage(props.editor, { src: url.value.trim() })
  if (!invalid.value)
    replacing.value = false
}
</script>

<template>
  <div v-if="active" class="visual-object-tools" role="group" :aria-label="t('visual.image')">
    <div class="visual-tool-row">
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden @change="replaceFile">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon" :disabled="saving" :aria-label="t('visual.replaceLocalImage')" @mousedown.prevent @click="fileInput?.click()">
            <FolderOpen :size="17" />
          </Button>
        </TooltipTrigger><TooltipContent>{{ t('visual.replaceLocalImage') }}</TooltipContent>
      </Tooltip>
      <label class="visual-number">{{ t('visual.imageWidth') }}<input type="number" min="24" max="2400" step="1" :aria-label="t('visual.imageWidth')" :value="attrs.width ?? ''" placeholder="px" @input="resize"></label>
      <Tooltip v-for="(icon, index) in [AlignLeft, AlignCenter, AlignRight]" :key="index">
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon" :aria-pressed="attrs.align === ['left', 'center', 'right'][index]" :aria-label="t(`visual.image${['Left', 'Center', 'Right'][index]}`)" @mousedown.prevent @click="updateSelectedImage(editor, { align: ['left', 'center', 'right'][index] })">
            <component :is="icon" :size="17" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ t(`visual.image${['Left', 'Center', 'Right'][index]}`) }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon" data-replace-image :aria-label="t('visual.replaceImage')" @mousedown.prevent @click="url = attrs.src; invalid = false; replacing = !replacing">
            <Replace :size="17" />
          </Button>
        </TooltipTrigger><TooltipContent>{{ t('visual.replaceImage') }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon" :aria-label="t('visual.deleteImage')" @mousedown.prevent @click="editor.chain().focus().deleteSelection().run()">
            <Trash2 :size="17" />
          </Button>
        </TooltipTrigger><TooltipContent>{{ t('visual.deleteImage') }}</TooltipContent>
      </Tooltip>
    </div>
    <form v-if="replacing" class="visual-link-form" @submit.prevent="replace">
      <input v-model="url" type="text" :aria-label="t('visual.imageUrl')" :aria-invalid="invalid">
      <Button variant="outline" size="sm" type="submit">
        {{ t('visual.apply') }}
      </Button>
      <span v-if="invalid" role="alert">{{ t('visual.invalidLink') }}</span>
    </form>
  </div>
</template>
