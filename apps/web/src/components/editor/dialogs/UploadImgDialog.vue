<script setup lang="ts">
import { ImagePlus } from '@lucide/vue'
import { useUIStore } from '@/stores/ui'

const emit = defineEmits(['uploadImage'])
const { t } = useI18n()
const uiStore = useUIStore()
const busy = ref(false)
const input = ref<HTMLInputElement>()
function choose(files: File[]) {
  if (!files.length || busy.value)
    return
  busy.value = true
  emit('uploadImage', files[0], () => { busy.value = false }, true)
}
function selected(event: Event) {
  const element = event.target as HTMLInputElement
  choose(Array.from(element.files ?? []))
  element.value = ''
}
</script>

<template>
  <Dialog v-model:open="uiStore.isShowUploadImgDialog">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('visual.insertImage') }}</DialogTitle>
        <DialogDescription>{{ t('visual.localImageOnly') }}</DialogDescription>
      </DialogHeader>
      <input ref="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden @change="selected">
      <button type="button" class="flex min-h-40 items-center justify-center gap-3 rounded border border-dashed p-6" :disabled="busy" @click="input?.click()" @dragover.prevent @drop.prevent="choose(Array.from($event.dataTransfer?.files ?? []))">
        <ImagePlus :size="24" />{{ t(busy ? 'visual.saving' : 'visual.chooseImage') }}
      </button>
    </DialogContent>
  </Dialog>
</template>
