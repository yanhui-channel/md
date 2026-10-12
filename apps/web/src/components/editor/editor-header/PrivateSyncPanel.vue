<script setup lang="ts">
import { ArchiveRestore, Cloud, Download, History, LogIn, LogOut, Pause, RefreshCw } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import VersionDiffViewer from '@/components/editor/post-slider/VersionDiffViewer.vue'
import PanelDialog from '@/components/shared/panel-dialog/PanelDialog.vue'
import { Button } from '@/components/ui/button'
import { getLocalDraft } from '@/storage/repositories/private-sync'
import { useConfirmStore } from '@/stores/confirm'
import { usePostStore } from '@/stores/post'
import { usePrivateSyncStore } from '@/stores/privateSync'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { t } = useI18n()
const sync = usePrivateSyncStore()
const posts = usePostStore()
const tab = ref('articles')
const busy = ref(false)
const checked = ref<string[]>([])
const selectionTouched = ref(false)
const localTexts = ref<Record<string, string>>({})
const otherDifferences = ref<Record<string, boolean>>({})
const dialogOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const rows = computed(() => {
  const all = new Map((sync.vault?.entries ?? []).map(entry => [entry.id, { id: entry.id, title: entry.title, deleted: entry.deleted, local: false }]))
  for (const post of posts.posts) all.set(post.id, { id: post.id, title: post.title, deleted: false, local: true })
  return [...all.values()].filter(row => tab.value === 'trash' ? row.deleted : !row.deleted)
})
const conflicts = computed(() => Object.entries(sync.records).filter(([, record]) => record.conflict))
const message = computed(() => {
  const key = sync.error === 'local_copies_retained'
    ? 'copiesRetained'
    : sync.error === 'theme_capture_required'
      ? 'needTheme'
      : sync.error === 'missing_asset'
        ? 'missingAsset'
        : sync.error === 'composition_active'
          ? 'composition'
          : sync.error === 'local_conflict' || /quota|storage/i.test(sync.error)
            ? 'exportFirst'
            : sync.error === 'article_conflict' ? 'conflict' : 'failed'
  return t(`privateSync.${key}`)
})
watch(() => sync.records, async (records) => {
  if (!selectionTouched.value)
    checked.value = Object.entries(records).filter(([, record]) => record.selected).map(([id]) => id)
  for (const [id, record] of conflicts.value) {
    const draft = await getLocalDraft(id)
    localTexts.value[id] = draft?.post.content ?? posts.getPostById(id)?.content ?? ''
    otherDifferences.value[id] = JSON.stringify(draft?.theme) !== JSON.stringify(record.conflict?.stored?.article.theme) || draft?.post.title !== record.conflict?.stored?.article.title
  }
}, { immediate: true })
async function action(fn: () => Promise<unknown>) {
  if (busy.value)
    return
  busy.value = true
  try { await fn() }
  catch (error) { toast.error(error instanceof Error ? error.message : t('privateSync.failed')) }
  finally { busy.value = false }
}
async function select() {
  const ids = checked.value.filter(id => posts.getPostById(id))
  for (const post of posts.posts) {
    if (sync.records[post.id]?.selected && !ids.includes(post.id))
      await sync.unselect(post.id)
  }
  await sync.selectArticles(ids)
  selectionTouched.value = false
  checked.value = Object.entries(sync.records).filter(([, record]) => record.selected).map(([id]) => id)
}
async function showHistory(id: string) { await sync.loadHistory(id); tab.value = 'history' }
async function restore(id: string, head: string) {
  useConfirmStore().confirm({ description: t('privateSync.restoreConfirm'), onConfirm: () => action(async () => {
    if (!await getLocalDraft(id))
      await sync.download(id)
    await sync.restoreRevision(id, head)
  }) })
}
async function backup() {
  const { exportArticleBundle } = await import('@/services/article-bundle')
  const { preparePublication } = await import('@/services/export/publication')
  const { downloadFile } = await import('@md/shared/utils/fileHelpers')
  const publication = await preparePublication()
  try {
    const url = URL.createObjectURL(await exportArticleBundle(publication))
    downloadFile(url, `${publication.snapshot.title || 'article'}.zip`)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  finally { publication.dispose() }
}
</script>

<template>
  <PanelDialog v-model:open="dialogOpen" :title="t('privateSync.title')" :icon="Cloud" size="2xl">
    <div class="p-4 sm:p-6 space-y-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span role="status" class="font-medium">{{ t(`privateSync.${sync.status}`) }}</span>
        <span class="text-muted-foreground break-all">{{ sync.identity?.login }}</span>
      </div>
      <div v-if="sync.changedVault" role="alert" class="space-y-2 border-l-2 border-amber-500 pl-3">
        <p>{{ t('privateSync.vaultChanged') }}</p>
        <Button :disabled="busy" variant="outline" @click="action(sync.acceptVault)">
          {{ t('privateSync.acceptVault') }}
        </Button>
      </div>
      <div v-else-if="sync.error" role="alert" class="space-y-2 border-l-2 border-amber-500 pl-3">
        <p>{{ message }}</p>
        <p v-if="sync.status === 'attention'" class="text-xs text-muted-foreground break-all">
          {{ sync.error }}
        </p>
        <Button variant="outline" size="sm" :disabled="busy" @click="action(backup)">
          <Download class="mr-2 size-4" />{{ t('privateSync.backup') }}
        </Button>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button v-if="!sync.identity" :disabled="busy" @click="action(sync.login)">
          <LogIn class="mr-2 size-4" />{{ t('privateSync.login') }}
        </Button>
        <template v-else>
          <Button :disabled="busy || sync.changedVault || sync.status === 'syncing'" @click="action(sync.syncNow)">
            <RefreshCw class="mr-2 size-4" :class="{ 'animate-spin': sync.status === 'syncing' }" />{{ t(sync.paused ? 'privateSync.resume' : 'privateSync.syncNow') }}
          </Button>
          <Button variant="outline" :disabled="busy || sync.paused" @click="sync.pause">
            <Pause class="mr-2 size-4" />{{ t('privateSync.pause') }}
          </Button>
          <Button variant="ghost" :disabled="busy" @click="action(sync.logout)">
            <LogOut class="mr-2 size-4" />{{ t('privateSync.logout') }}
          </Button>
        </template>
      </div>
      <p v-if="sync.paused" class="text-muted-foreground">
        {{ t('privateSync.paused') }}
      </p>
      <Tabs v-model="tab">
        <TabsList class="grid grid-cols-3 w-full">
          <TabsTrigger value="articles">
            {{ t('privateSync.articles') }}
          </TabsTrigger>
          <TabsTrigger value="trash">
            {{ t('privateSync.trash') }}
          </TabsTrigger>
          <TabsTrigger value="history">
            {{ t('privateSync.history') }}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <template v-if="tab !== 'history'">
        <div v-for="row in rows" :key="row.id" class="flex items-start gap-3 py-3 border-b min-w-0">
          <input v-if="row.local && tab === 'articles'" v-model="checked" type="checkbox" :value="row.id" :aria-label="row.title" :disabled="busy || !sync.identity || sync.changedVault" class="mt-1 size-4 shrink-0 accent-primary" @change="selectionTouched = true">
          <div class="flex-1 min-w-0">
            <p class="break-words [overflow-wrap:anywhere] font-medium">
              {{ row.title }}
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ t(row.local ? (sync.offline[row.id] === undefined ? 'privateSync.local' : sync.offline[row.id] ? 'privateSync.offline' : 'privateSync.onlineOnly') : 'privateSync.notDownloaded') }}
            </p>
          </div>
          <Button v-if="row.deleted" variant="ghost" size="icon" :disabled="busy || !sync.identity" :title="t('privateSync.restore')" :aria-label="t('privateSync.restore')" @click="restore(row.id, sync.vault!.head!)">
            <ArchiveRestore class="size-4" />
          </Button>
          <Button v-else-if="!row.local" variant="ghost" size="icon" :disabled="busy || !sync.identity" :title="t('privateSync.download')" :aria-label="t('privateSync.download')" @click="action(() => sync.download(row.id))">
            <Download class="size-4" />
          </Button>
          <Button v-if="sync.vault?.entries.some(entry => entry.id === row.id)" variant="ghost" size="icon" :disabled="busy || !sync.identity" :title="t('privateSync.history')" :aria-label="t('privateSync.history')" @click="action(() => showHistory(row.id))">
            <History class="size-4" />
          </Button>
        </div>
        <p v-if="!rows.length" class="py-6 text-center text-muted-foreground">
          {{ t('privateSync.empty') }}
        </p>
        <Button v-if="tab === 'articles' && sync.identity" class="w-full" :disabled="busy || sync.changedVault" @click="action(select)">
          {{ t('privateSync.select') }}
        </Button>
      </template>
      <template v-else>
        <p class="font-medium break-words">
          {{ sync.vault?.entries.find(entry => entry.id === sync.historyId)?.title }}
        </p>
        <div v-for="entry in sync.history?.entries ?? []" :key="entry.head" class="flex items-center justify-between gap-2 border-b py-3">
          <time class="text-sm">{{ new Date(entry.updatedAt).toLocaleString() }}</time>
          <Button variant="outline" size="sm" :disabled="busy" @click="action(() => restore(sync.historyId, entry.head))">
            <ArchiveRestore class="mr-2 size-4" />{{ t('privateSync.restore') }}
          </Button>
        </div>
        <Button v-if="sync.history?.nextPage" variant="ghost" :disabled="busy" @click="action(() => sync.loadHistory(sync.historyId, sync.history!.nextPage!))">
          {{ t('privateSync.more') }}
        </Button>
      </template>
      <details v-for="[id, record] in conflicts" :key="id" class="border-t pt-4" open>
        <summary class="cursor-pointer font-medium break-words">
          {{ t('privateSync.conflict') }}: {{ posts.getPostById(id)?.title ?? record.conflict?.stored?.article.title }}
        </summary>
        <p class="my-2 text-xs text-muted-foreground">
          {{ t('privateSync.retained') }}
        </p>
        <p v-if="otherDifferences[id]" class="my-2 text-xs text-muted-foreground">
          {{ t('privateSync.themeConflict') }}
        </p>
        <div class="h-48 border rounded-md overflow-hidden">
          <VersionDiffViewer :old-text="record.conflict?.stored?.article.markdown ?? ''" :new-text="localTexts[id] ?? ''" />
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <Button size="sm" :disabled="busy" @click="action(() => sync.resolveConflict(id, 'local'))">
            {{ t('privateSync.keepLocal') }}
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="action(() => sync.resolveConflict(id, 'remote'))">
            {{ t('privateSync.keepRemote') }}
          </Button>
          <Button variant="outline" size="sm" :disabled="busy" @click="action(() => sync.resolveConflict(id, 'copy'))">
            {{ t('privateSync.keepCopy') }}
          </Button>
        </div>
      </details>
    </div>
  </PanelDialog>
</template>
