<script setup lang="ts">
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { resolveLocalImage } from '@/lib/visual/assets'
import { safeVisualUrl } from '@/lib/visual/style'
import { LOCAL_ASSET_PATTERN } from '@/storage/repositories/assets'

const props = defineProps(nodeViewProps)
const { t } = useI18n()
const url = ref('')
const error = ref(false)
watch(() => props.node.attrs.src, async (src, _previous, cleanup) => {
  let disposed = false
  let release: (() => void) | undefined
  cleanup(() => { disposed = true; release?.() })
  url.value = ''
  error.value = false
  if (!LOCAL_ASSET_PATTERN.test(src)) {
    url.value = safeVisualUrl(src) ? src : ''
    error.value = !url.value
    return
  }
  try {
    const resolved = await resolveLocalImage(src)
    if (disposed) { resolved?.dispose(); return }
    release = resolved?.dispose
    url.value = resolved?.url ?? ''
    error.value = !resolved
  }
  catch {
    if (!disposed)
      error.value = true
  }
}, { immediate: true })
</script>

<template>
  <NodeViewWrapper class="visual-image" contenteditable="false">
    <img v-if="url" :src="url" :alt="node.attrs.alt ?? ''" :title="node.attrs.title" :width="node.attrs.width" :align="node.attrs.align" :data-local-src="LOCAL_ASSET_PATTERN.test(node.attrs.src) ? node.attrs.src : undefined" :style="{ display: 'block', height: 'auto', width: node.attrs.width ? `${node.attrs.width}px` : undefined, marginLeft: node.attrs.align === 'left' ? '0' : 'auto', marginRight: node.attrs.align === 'right' ? '0' : 'auto' }" @error="error = true">
    <span v-if="error" class="visual-error" role="alert">{{ t('visual.missingImage') }} {{ node.attrs.alt || node.attrs.src }}</span>
  </NodeViewWrapper>
</template>
