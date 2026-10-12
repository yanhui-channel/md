# Private GitHub Sync and iPhone Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For this tightly coupled change, native execution followed by an independent whole-branch review is recommended.

**Goal:** 在现有衍辉编辑器中实现个人 GitHub 登录、文章/主题/本地图片私有同步及已下载文章的 iPhone 离线编辑，不丢弃并发修改。

**Architecture:** 本机 IndexedDB 是编辑和待同步队列的持久层；同源 Cloudflare Worker 验证唯一用户并读写独立私有仓库。Git 提交同时发布正文、主题、资源清单和目录，分支只允许快进更新；冲突保留两版。复用现有 Vue、Pinia、Hono、文章快照及校验，不引入数据库或通用多存储后端。

**Tech Stack:** Vue 3, Tiptap/CodeMirror, Pinia, IndexedDB/idb, Hono, Zod, Web Crypto, GitHub REST Git API, Workers Static Assets, Service Worker, Vitest, Playwright.

**Spec:** [已通过的设计方案](../specs/2026-10-12-private-mobile-github-sync-design.md)。执行者必须先读该方案与本计划。

状态：待用户审核并选择执行方式。所有任务尚未执行。当前基线为 `5d351f7`，其产品代码与已验收版本 `7fd2a4c` 一致。

## Global Constraints

**兼容性：** Node >= 22.22.2，沿用 pnpm 与锁文件安全覆盖；保留现有本地编辑/导出、专属样式、Markdown 内容和四种界面语言。关闭私有同步功能时不得产生新的云端请求。

**数据：** 单用户、独立私有仓库、首轮明确选择上传文章；单图上限 `10 * 1024 * 1024` 字节，不静默压缩。沿用备份清单最多 497 张图片、完整数据展开不超过 100MiB 的边界；同步 JSON 正文及元数据合计上限 30MiB，图片分请求传输，不把所有图片 base64 塞进一个请求。

**时序：** 停笔 30 秒尝试同步；每台设备自动提交最多每分钟一次；手动同步仍遵守服务端限流。会话 7 天，OAuth state 10 分钟；成功以远端提交及本地版本确认共同判定，失败不自动清空草稿。

**安全与范围：** 令牌仅在后台，OAuth 仅身份读取，仓库令牌仅指定仓库 Contents 读写；使用 HttpOnly/Secure/SameSite=Lax Cookie 与同源 CSRF 防护。无 D1/R2、公开图床、公众号转发、计费、分享发布或端到端加密功能。

**执行边界：** 先完成本地实现与测试。未经单独确认，不创建仓库/OAuth App/云资源、不上传私人文章、不付费、不部署。所有浏览器测试使用独立上下文，不操作用户现有草稿或清理用户浏览器数据。提交只包含本功能，禁止推送本地旧历史分支或使用 `push --all`。

## Review Focus

1. **迟到响应、双标签页和切篇：** A 版本的确认不能清掉 B 版本的待发送状态，同机多标签页不得把旧快照写回；任务 4、5、7 固定测试。
2. **仅改样式及中文输入组合：** 字号/CSS/图片对齐修改也同步；输入法候选未提交时不强制 flush、跳登录或应用远端内容；任务 4、5、7 固定测试。
3. **登录跳转前保存失败：** 空间不足时不继续导航导致草稿丢失；登录过期、拒绝授权及令牌过期要可恢复；任务 2、5、7 固定测试。
4. **手工 Git 修改、仓库变化和删除：** 不能只信 revision，必须核对实际内容/树；仓库转公开或连接目标变化时停止写入；任务 3、4、5 固定测试。
5. **离线缓存与版本升级：** OAuth、API 和私有图片不进入公共缓存；数据库降级、缓存失败或 Safari 存储回收不伪报成功；任务 6、7 固定测试。

## 文件与依赖安排

所有路径相对于 `vendor/doocs-md` 仓库根目录。新增路径在下方明确标记；不修改父目录内其他文章或工具。

| 交付单元       | 文件归属                                                                                       | 复用及限制                                                              |
| -------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 共享数据契约   | `packages/shared/src/types/private-sync.ts`、`utils/private-sync.ts`、`utils/article-theme.ts` | 从现有主题快照提取无 DOM 的类型/结构校验，浏览器完整 CSS 校验保留       |
| 私有后台       | `apps/api/src/private/`、`apps/api/wrangler.private.jsonc`                                     | 复用 Hono/Cookie/JWT；保留原 API 入口但不在私有部署挂载                 |
| 本地保存与同步 | `apps/web/src/storage/repositories/`、`services/private-sync/`、`stores/privateSync.ts`        | 复用已有 `meta` 表，不增加数据库或新 IndexedDB 表；补原子写入及版本比较 |
| 用户操作与离线 | 现有账户/同步弹窗、文章列表、`apps/web/src/offline/`、`apps/web/plugins/`                      | 复用 PanelDialog、VersionDiffViewer 和图标，不另建一套界面框架          |
| 验收           | 现有 Vitest、`apps/web/e2e/`、`docs/private-sync-runbook.md`                                   | 浏览器测试必须能从干净检出运行，不能依赖作者机器上的绝对路径            |

依赖改动限制：`@md/shared` 声明已经在 workspace 使用的 Zod；`@md/api` 声明 `@md/shared`。新增测试依赖 `@playwright/test` 是为了可复现的真实 IndexedDB/Service Worker/WebKit 检查，不进入产品包；安装时查验 Node 兼容性并锁定解析版本。现有 MathJax 3 来自运行时 CDN，并非已安装包；私有构建增加兼容的 MathJax 3 构建依赖并锁定版本，复制其本地资源，不重写公式引擎。本轮不安装这些依赖。离线缓存使用标准 Service Worker 与现有 Vite 构建信息，不增加 PWA 框架。

## Task 1: 建立可校验的文章版本契约

**Files:** Create `packages/shared/src/types/private-sync.ts`, `packages/shared/src/utils/private-sync.ts`, `packages/shared/src/utils/article-theme.ts`, `packages/shared/src/utils/private-sync.test.ts`. Modify `packages/shared/package.json`, `apps/api/package.json`, `pnpm-lock.yaml`, `apps/web/src/lib/visual/theme-snapshot.ts`. Test existing `apps/web/src/services/article-bundle.test.ts` and `apps/web/src/lib/visual/theme-snapshot.test.ts`.

**Interfaces:** `PrivateArticle` 包含 `id, title, parentId, markdown, theme, assets, external, createdAt, updatedAt, deleted`；`theme` 使用提取后的 `ThemeSnapshot`，`assets` 仅有 `path, sha256, mime, size, blobSha`，不含 Blob 或凭证。`blobSha: string | null` 在本机待上传时可为空，HTTP 提交与远端读取必须非空且对应有效对象，禁止填假值。`StoredPrivateArticle` 为 `{ article, revision, digest, operationId }`；`revision` 为操作 UUID，`digest` 为规范化可同步内容的 SHA-256。`CommitArticleRequest` 为 `{ baseRevision: string | null, operationId: string, article: PrivateArticle }`；`CommitArticleResult` 为 `{ head: string, stored: StoredPrivateArticle }`。

`VaultState` 为 `{ schemaVersion: 1, vaultId: string, head: string | null, entries: CatalogEntry[] }`，空仓库的 head 为 null。`vaultId` 由 GitHub 仓库数字 ID 与服务端指定分支构成，不用可改名的仓库名当身份。`CatalogEntry` 包含 `id, title, parentId, revision, digest, updatedAt, deleted`，时间统一 ISO 字符串；目录关系沿用现有 Post 的父子文章结构。`HistoryPage` 为 `{ entries: { head: string, revision: string, updatedAt: string }[], nextPage: number | null }`。共享函数为 `parsePrivateArticle(input: unknown): PrivateArticle`、`parseVaultState(input: unknown): VaultState`、`articleDigest(article: PrivateArticle): Promise<string>`。格式检查失败抛校验错误，HTTP 转换留给后台。

- [ ] **Step 1: 写失败测试。** 测试名 `rejectsTraversalAndOversizedAsset`：断言 `../secret`、重复资源、10MiB+1、未知格式版本被拒；`themeOnlyChangeChangesDigest`：正文不变，仅更改合法字号，摘要必须变化；`stableDigestIgnoresObjectKeyOrder`：等价对象得到同一摘要。测试数据直接放本测试文件，使用完整合法主题和 1px PNG 元数据，不复用私人文章。

  核心断言示例（`article` 为本测试中构造的合法 PrivateArticle）：

  ```ts
  it('rejectsTraversalAndOversizedAsset', () => {
    const asset = article.assets[0]
    expect(() => parsePrivateArticle({ ...article, assets: [{ ...asset, path: '../secret' }] })).toThrow()
    expect(() => parsePrivateArticle({ ...article, assets: [{ ...asset, size: 10 * 1024 * 1024 + 1 }] })).toThrow()
    expect(() => parseVaultState({ schemaVersion: 2, vaultId: '123:main', head: null, entries: [] })).toThrow()
  })
  ```

- [ ] **Step 2: 运行红灯。** `pnpm --filter @md/shared test src/utils/private-sync.test.ts`，预期因契约/函数尚未实现失败，记录准确原因。
- [ ] **Step 3: 实现契约。** 使用已有 Zod、Web Crypto；提取现有 `ThemeSnapshot` 与结构 schema，`theme-snapshot.ts` 保持原导出兼容并继续执行 DOM/CSS 完整校验。规范化摘要包含正文、主题、元数据和资源摘要，不含 Git 对象位置、operationId 或瞬时时间；避免重试因传输字段变化产生不同内容摘要。校验路径、日期、数量、字符串长度、父目录 ID 和类型，禁止任意额外字段进入持久化数据。
- [ ] **Step 4: 运行绿灯和兼容检查。** 执行上述共享测试、`pnpm web test src/services/article-bundle.test.ts src/lib/visual/theme-snapshot.test.ts`、`pnpm --filter @md/shared type-check`、`pnpm api type-check`、`pnpm web type-check`；全部通过，原备份格式不变。
- [ ] **Step 5: 提交。** 仅暂存本任务文件，使用英文 Conventional Commit：`feat(sync): define private article revision contracts`。

## Task 2: 单用户登录与独立后台入口

**Files:** Create `apps/api/src/private/index.ts`, `auth.ts`, `types.ts`, `auth.test.ts`; Create `apps/api/wrangler.private.jsonc`. Preserve `apps/api/src/index.ts`, original auth routes and `apps/web/worker/index.ts`.

**Interfaces:** `private/index.ts` 默认导出 Hono app，所有私有路由位于 `/api/`。`PrivateEnv` 声明 `ASSETS`, `APP_ORIGIN`, `ALLOWED_GITHUB_USER_ID`, `DATA_REPO_OWNER`, `DATA_REPO_NAME`, `DATA_REPO_BRANCH`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `DATA_REPO_TOKEN`, `SESSION_SECRET`。`private/auth.ts` 导出 `requireOwner` 中间件和 `requireSameOriginWrite` 中间件，后者验证 Origin 与绑定会话的 CSRF 请求头。

公开登录接口为 `GET /api/auth/github`、`GET /api/auth/github/callback`。`GET /api/me` 在授权后返回 `{ ownerId, login, vaultId, csrfToken }`；`POST /api/logout` 清会话 Cookie。所有其他 `/api/*` 默认拒绝未登录者；未知 API 返回 JSON 404，不能落入 SPA 或微信代理。

- [ ] **Step 1: 写失败测试。** `rejectsOtherGithubId`、`rejectsForgedStateAndOrigin`、`sessionExpiresAfterSevenDays`、`neverReturnsGithubToken`、`doesNotExposeUpstreamRoutes`：用 `app.request` 和模拟 GitHub 响应断言陌生 ID/伪造 state/外域写操作失败，Cookie 属性正确，7 天后 401，响应/日志无令牌；`/upload`、`/cgi-bin/stable_token`、`/s/*` 不调用上游。

  `app` 是本任务默认导出，`env` 为仅含假密钥的 PrivateEnv，`cookie` 为测试登录取得的会话：

  ```ts
  it('sessionExpiresAfterSevenDays', async () => {
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1)
    const response = await app.request('/api/me', { headers: { cookie } }, env)
    expect(response.status).toBe(401)
  })
  ```

- [ ] **Step 2: 运行红灯。** `pnpm api test src/private/auth.test.ts`，确认失败来自未实现私有认证，而不是测试环境未初始化。
- [ ] **Step 3: 实现独立入口。** 沿用 Hono 的 Cookie/JWT 功能和现有 OAuth state 做法，不读取或创建 D1 用户。数字 ID 白名单、固定回跳地址、会话 csrf 随机值、固定算法签名验证；state 10 分钟，会话 7 天。仅 `read:user` 登录；仓库令牌从 Secrets 读取。配置文件不含真实密钥/上游资源绑定，静态目录指向 `../web/dist-private`，`/api/*` 优先经过 Worker。
- [ ] **Step 4: 验证绿灯。** 运行本任务测试及 `pnpm api type-check`。验证所有错误输出脱敏，注销后 Cookie 不再授权；测试服务端缺少必需配置时拒绝写入，不回落到公共仓库。
- [ ] **Step 5: 提交。** `feat(auth): add owner-only private sync sessions`；不运行任何部署命令。

## Task 3: GitHub 原子读写、图片和版本冲突

**Files:** Create `apps/api/src/private/repository.ts`, `assets.ts`, `routes.ts`, `repository.test.ts`, `assets.test.ts`; Modify `private/index.ts` to register protected routes.

**Interfaces:** `readVault(env: PrivateEnv): Promise<VaultState>`；`readArticle(env: PrivateEnv, id: string, head: string): Promise<StoredPrivateArticle>`；`storeAsset(env: PrivateEnv, path: string, bytes: ArrayBuffer): Promise<PrivateArticle['assets'][number]>`；`commitArticle(env: PrivateEnv, request: CommitArticleRequest): Promise<CommitArticleResult>`；`listArticleHistory(env: PrivateEnv, id: string, page: number): Promise<HistoryPage>`。原生 fetch 用 Vitest 替换，不新增通用 HTTP 客户端类。

接口：`GET /api/vault`；`GET /api/articles/:id?head=<commit>`；`PUT /api/articles/:id`；`PUT /api/assets/:name`（二进制）；`GET /api/assets/:name?head=<commit>`；`GET /api/articles/:id/history?page=N`（每页 20）。删除/恢复通过同一个 PUT 的 `article.deleted` 表达。404、409、413、422、429、503 均返回稳定错误码；409 返回当前版本信息，不能自动 force 更新。

- [ ] **Step 1: 写失败测试。** `sameArticleRaceKeepsBothVersions`、`unrelatedArticleRaceRebuildsTree`、`lostAckRetryDoesNotDuplicateCommit`、`manualMarkdownEditIsNotOverwritten`、`failsClosedWhenRepoBecomesPublic`。模拟两次读到同一 head，断言同篇第二次返回冲突、异篇重建树后保留双方。资源测试断言错误摘要、伪造 MIME、10MiB+1 和不存在的 blob 被拒，读取必须鉴权且 `no-store`。

  在有状态 GitHub fetch 假实现中，`request` 是合法提交，提交计数按 Git commits 路由统计：

  ```ts
  it('lostAckRetryDoesNotDuplicateCommit', async () => {
    const result = await commitArticle(env, request)
    expect(await commitArticle(env, request)).toEqual(result)
    expect(createdCommits).toHaveLength(1)
  })
  ```

- [ ] **Step 2: 运行红灯。** `pnpm api test src/private/repository.test.ts src/private/assets.test.ts`，确认关键数据保护断言失败。
- [ ] **Step 3: 实现远端操作。** 检查固定仓库存在、私有且可写；由已校验 `catalog.json` 建目录，基于 head 的 ETag 支持授权后的条件读取，304 仍带 no-store。图片验证签名/大小/SHA-256 后建 blob；提交前核对资源真实对象，已有可信路径可复用。用 base tree、正文/元数据/目录的新 tree、单父 commit 和 `force=false` 更新 ref；同篇检查 revision 加实际文件摘要。异篇竞争最多内部重试 3 次，之后交回客户端退避。重试当前相同 operationId 且内容相同返回原确认；同 ID 不同内容拒绝。远端内容和主题不一致、树被截断、未知格式版本均停止应用；不执行源码或 CSS。
- [ ] **Step 4: 验证绿灯。** 运行上述测试及 `pnpm api type-check`；逐项检查 blob 上传失败/中途超时不推进 head，历史读取分页完整，删除标记保留正文和图片，恢复是新提交。日志只有操作 ID/状态/耗时，不含文章及密钥。空仓库按“尚未初始化”处理，首次合法提交完成初始化，不能把普通 404 当空仓库。
- [ ] **Step 5: 提交。** `feat(sync): persist private articles atomically in GitHub`。真实 GitHub 写入留到任务 7 的批准后验证，当前只用模拟接口。

## Task 4: 本地保存与待同步版本同时落库

**Files:** Create `apps/web/src/storage/repositories/private-sync.ts`, `private-sync.test.ts`; Modify `apps/web/src/storage/repositories/documents.ts`, `apps/web/src/stores/post.ts`, `apps/web/src/stores/theme.ts`, `apps/web/src/stores/cssEditor.ts`, `apps/web/src/lib/visual/capture-theme.ts`. Reuse `apps/web/src/storage/keys.ts` constants and existing IndexedDB stores/version; do not add a store for the queue.

**Interfaces:** 在已有 `meta` store 保存按 `vaultId + articleId` 隔离的 `PrivateSyncRecord`：`selected, localGeneration, baseRevision, confirmedDigest, pending, conflict`；`pending` 保存 operationId、generation、冻结文章及 baseRevision，`conflict` 保存远端固定版本和本机恢复副本。`saveLocalArticle(post: Post, theme: ThemeSnapshot, vaultId: string, expectedGeneration: number): Promise<number>` 在同一事务检查旧 generation、写文章/逐篇主题并返回递增后的 generation。`PreparedSyncOperation` 为 `{ request: CommitArticleRequest, generation: number }`；`preparePending(vaultId: string, id: string): Promise<PreparedSyncOperation | null>` 冻结发送版本；`confirmPending(vaultId: string, id: string, generation: number, result: CommitArticleResult): Promise<void>` 只确认对应 generation；`applyRemote(vaultId: string, stored: StoredPrivateArticle, assets: StoredAsset[], expectedGeneration: number): Promise<void>` 在事务内比较版本再应用。`StoredAsset` 沿用现有 assets 仓库类型，不能与共享的远端资源元数据混用。

`capture-theme.ts` 新增 `captureStoredArticleTheme(postId: string): Promise<ThemeSnapshot>`，当前文章等待样式捕获前后校验文章 ID 和编辑版本，期间切篇则拒绝结果并稍后重试；非当前文章只读已固定的主题，缺失不冒用当前主题。

- [ ] **Step 1: 写失败测试。** `draftAndDirtyMarkerCommitTogether`、`oldAckKeepsNewGenerationPending`、`styleOnlyEditIsDirty`、`remotePullCannotClobberConcurrentTabEdit`、`switchVaultDoesNotReuseOldQueue`。断言事务失败时正文/标记均不部分提交、旧确认不清新稿、仅改 CSS 有新摘要、不同仓库不混队列。事务模拟覆盖调用行为，真实 IndexedDB 原子性留任务 7 复验。

  `post`、`theme` 为合法本地夹具，事务假实现初始 generation 为 0；补测等待样式捕获时切篇不能串用主题：

  ```ts
  it('rejectsStaleLocalGeneration', async () => {
    expect(await saveLocalArticle(post, theme, '123:main', 0)).toBe(1)
    await expect(saveLocalArticle(post, theme, '123:main', 0)).rejects.toThrow()
  })
  ```

- [ ] **Step 2: 运行红灯。** `pnpm web test src/storage/repositories/private-sync.test.ts`，确认这些接口未实现导致失败。
- [ ] **Step 3: 接入所有写入口。** 先检索 `documentRepo.savePost/saveAll/importArticle` 和 post/theme/CSS 写入调用方。已选择同步的文章统一走新事务入口，未选择文章走原本地路径；保存时记录预期 generation，在 IndexedDB 内比较，跨标签页旧数据只能形成恢复副本/冲突。首次选择同步时捕获并固定该篇主题，之后正文或主题独立变化都持久化；非当前文章读取其固定快照，不临时切换编辑器。丢失主题、图片或存储容量时保持可导出但不能标成已同步。
- [ ] **Step 4: 验证绿灯及旧功能。** 运行本任务测试、`pnpm web test src/services/article-bundle.test.ts src/storage/repositories/documents-backup.test.ts src/stores/editor.test.ts` 和 `pnpm web type-check`。覆盖标题/目录修改、删除、ZIP 恢复、批量保存、撤销重做及 pagehide 备份恢复；新稿在发送旧稿期间产生时，只更新新稿正确的 baseRevision，不重复旧修改。
- [ ] **Step 5: 提交。** `feat(sync): persist local drafts and pending revisions together`。

## Task 5: 编辑器连接、同步状态、冲突和首次迁移

**Files:** Create `apps/web/src/services/private-sync/client.ts`, `coordinator.ts`, `coordinator.test.ts`, `apps/web/src/stores/privateSync.ts`, `apps/web/src/components/editor/editor-header/PrivateSyncPanel.vue`. Modify existing `SyncDialog.vue`, `AccountDialog.vue`, header `index.vue`, `post-slider/index.vue`, `stores/auth.ts`, `services/account/config.ts`, `lib/visual/session.ts` and its tests, `apps/web/src/vite-env.d.ts`. Add private-sync strings to `dialog.ts` and `store.ts` in each of `apps/web/src/i18n/messages/{zh-CN,zh-TW,en-US,ja-JP}/`.

**Interfaces:** `PrivateSyncClient` 的 `me/readArticle/uploadAsset/commitArticle/listHistory/logout` 与任务 2/3 的 HTTP 契约一致；`readVault(etag?: string): Promise<{ state: VaultState | null, etag: string }>` 的 null 仅表示 304；`readAsset(path: string, head: string): Promise<ArrayBuffer>` 拉取二进制，交现有本地 assets 校验后构造 StoredAsset。使用同源 Cookie 和内存中的 CSRF 值，不能读取旧 bearer token。`usePrivateSyncStore()` 提供 `initialize(), selectArticles(ids: string[]), syncNow(), resolveConflict(id: string, action: 'local' | 'remote' | 'copy'), restoreRevision(id: string, head: string), pause()`，公开 `status: 'local' | 'syncing' | 'synced' | 'attention'`、逐篇可离线状态及具体错误原因。coordinator 导出 `createPrivateSyncCoordinator(client: PrivateSyncClient)`，返回 `notifySaved(id: string), syncNow(): Promise<void>, pause(): void, dispose(): void`；测试用真实仓库接口的假实现和虚拟时钟，不增加产品级替换后端开关。

- [ ] **Step 1: 写失败测试。** `autoSyncWaitsThirtySecondsAndThrottles` 断言 29,999ms 不提交、30,000ms 才提交及一分钟内不自动二次提交；`editingDuringUploadKeepsPending`、`reauthDoesNotDiscardDraft`、`noUploadBeforeSelection`、`compositionDefersSyncAndLogin`。同时测 401 停止队列/重新登录恢复、429 遵守 Retry-After、两个标签页仅一个前台发送者；失去发送者后队列可被另一标签页继续处理。

  `client` 是本任务契约的 spy，仓库假实现已有一篇选中且待发送的文章：

  ```ts
  it('autoSyncWaitsThirtySeconds', async () => {
    const coordinator = createPrivateSyncCoordinator(client)
    coordinator.notifySaved('article-1')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(client.commitArticle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(client.commitArticle).toHaveBeenCalledTimes(1)
    coordinator.dispose()
  })
  ```

- [ ] **Step 2: 运行红灯。** `pnpm web test src/services/private-sync/coordinator.test.ts`，必须看到上述行为尚未实现的失败。
- [ ] **Step 3: 实现调度和界面。** `VITE_PRIVATE_SYNC_ENABLED=true` 时启用这一条同步路径，禁止同时启动原 `useSyncStore`。复用弹窗、列表和 VersionDiffViewer，首次拉目录后让用户选择上传文章；纯远端条目需下载成功才进入本机可编辑/可离线状态。任务 4 事务保存成功后才排队。上传冻结版本的资源后，在请求副本中填入已验证 blobSha，不重新读取当前正文/主题；重试仍沿用原 operationId/generation，允许再次上传同哈希 blob。默认指数退避 5/15/60/300 秒，未登录和冲突不自动重试；前台恢复重查。用浏览器 Web Locks 保持同一 vault 单发送者，能力缺失时禁用自动发送并保留手动同步与版本校验。给 VisualSession 增加只读 `isComposing()`，同步/导航在 compositionend 后再 capture，不能调用强制 capture 把候选字截断。
- [ ] **Step 4: 验证绿灯和用户动作。** 运行 coordinator、session 和原 account 测试及 `pnpm web type-check`。登录前保存失败必须阻止跳转并提供导出，不能沿用原 catch 后继续跳转。冲突的“本机/远端/另存”均保留另一份；回收站/版本恢复走新提交；退出只停同步并明示本机副本保留，清理须另行确认且提示未同步内容。四种语言无缺键；库/分支身份变化不自动迁移旧队列。
- [ ] **Step 5: 提交。** `feat(sync): connect editor to private version-aware sync`。

## Task 6: 离线打开、受控升级和可公开构建

**Files:** Create `apps/web/src/offline/register.ts`, `register.test.ts`, `apps/web/public/private-sw.js`, `apps/web/plugins/private-offline.ts`, `apps/web/scripts/check-private-build.mjs`, `packages/core/src/utils/mathjax.test.ts`; Modify `apps/web/vite.config.ts`, `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/bootstrap.ts`, `apps/web/index.html`, `apps/api/wrangler.private.jsonc`, `packages/core/src/utils/mathjax.ts`, `packages/core/src/mathjax.d.ts`. Generate manifest/icon/precache metadata only in the private build; reuse the existing brand avatar. Retain the existing uTools local-assets plugin unchanged.

**Interfaces:** `registerPrivateOffline(): Promise<void>` 仅在私有生产构建运行；`privateOfflinePlugin()` 使用 Vite 标准构建输出生成静态缓存清单及网页 manifest。MathJax loader 在私有入口设置的 `window.__MD_PRIVATE_OFFLINE__ === true` 时使用现有 `MATHJAX_LOCAL_URL`，普通 web/uTools 行为不变；插件复制锁定 MathJax 3 包的 es5 运行资源到该目录并纳入清单。前端与 Service Worker 消息为 `OFFLINE_READY`, `UPDATE_READY`, `ACTIVATE_UPDATE`；明确保存完成和用户确认后才能发送激活消息。新增 `pnpm web build:private`、`pnpm api dev:private`、`pnpm api check:private`，最后一个仅做 Wrangler dry-run，不部署。构建检查命令为 `node apps/web/scripts/check-private-build.mjs <dist-dir>`，缺目录或发现禁止内容退出码 1，通过为 0。

- [ ] **Step 1: 写失败测试。** `neverCachesAuthOrPrivateApi`、`offlineReadyRequiresAllCoreAssets`、`updateWaitsForSavedComposition`、`doesNotClearIndexedDbOnActivate`、`rejectsPrivateSeedBuild`。断言 API/OAuth/外域 URL 不入缓存，任一核心文件失败不报就绪，新版本不直接 skipWaiting，构建源出现私有示例或本地环境文件即拒绝。

  MathJax 的专门回归使用测试 DOM，并监听插入 script，不实际访问网络：

  ```ts
  it('privateMathUsesLocalRuntime', () => {
    window.__MD_PRIVATE_OFFLINE__ = true
    void loadMathJax()
    expect(document.getElementById('MathJax-script')?.getAttribute('src')).toBe(MATHJAX_LOCAL_URL)
  })
  ```

- [ ] **Step 2: 运行红灯。** `pnpm web test src/offline/register.test.ts`；新增构建检查脚本缺失时检查命令应失败，不能因目录不存在而误判通过。
- [ ] **Step 3: 实现最小缓存策略。** 用标准 Cache API 只缓存构建清单里的同源公开静态文件及安全的应用入口，静态资源按版本缓存，导航只为编辑器入口提供离线兜底；其余请求不拦截。预缓存编辑所需动态语言包、已安装 Mermaid 的本地 chunks 和公式运行资源后才报告就绪，不能把缺资源降级成空白。请求持久存储，处理拒绝/配额满。正式构建从干净检出执行，禁止读取私有 `sample.md`、`assets.json`、`.env*.local`；扫描产物不含上游 API、分析脚本、作者私有示例和密钥标记。标准构建不注册私有 Service Worker。
- [ ] **Step 4: 验证绿灯与独立入口。** 运行 offline 测试、`pnpm --filter @md/core test src/utils/mathjax.test.ts`、`pnpm web type-check`，在干净检出执行 `pnpm web build:private`、`node apps/web/scripts/check-private-build.mjs apps/web/dist-private`、`pnpm api check:private`。配置必须无 D1/R2/上游域名；Worker 对 `/api/*` 自己鉴权，不挂载原微信代理。检查静态资源请求与私有 API 的缓存头不同，旧本地数据仍可打开。常规 `pnpm web build` 仍通过且不注册此 Service Worker。
- [ ] **Step 5: 提交。** `feat(offline): add private editor offline shell and safe upgrades`。

## Task 7: 全链路回归、独立复核和 iPhone 验收

**Files:** Create `apps/web/playwright.private.config.ts`, `apps/web/e2e/private-sync.spec.ts`, `apps/web/e2e/private-offline.spec.ts`, `apps/web/e2e/fixtures/private-api.ts`, `docs/private-sync-runbook.md`, `docs/private-sync-acceptance.md`; Modify `apps/web/package.json`, `pnpm-lock.yaml`, `.gitignore`, `YANHUI.md`. Generated traces/screenshots/results are ignored and must not contain real private articles.

**Interfaces:** `pnpm web test:e2e:private` 运行 Chromium 与 WebKit 项目，桌面 1440px 与移动 390px/横屏；fixture 只在测试上下文模拟 `/api/` 契约，不向产品增加绕过认证入口。`docs/private-sync-acceptance.md` 分开记录“本地自动测试”“批准后的真实接口”“iPhone 人工验收”，未完成项保持未通过。

- [ ] **Step 1: 写真实浏览器失败用例。** 两个独立上下文模拟两台设备，真实 IndexedDB 保存；断网重载、迟到确认、仅改主题、上传期间编辑、同篇/异篇竞争、删除冲突、缺图、ZIP 恢复、空间不足、旧数据库、双标签页和换 vault 均断言内容未丢。每项 Review Focus 至少一个对应测试；主题/标题编号/代码高亮/图片尺寸导出与编辑效果一致。可复用父目录已有浏览器用例的断言，不复制绝对运行时路径或私人测试文章。

  `context/page` 来自独立 Playwright 测试，前置步骤已把只含普通文字的测试文章写入真实 IndexedDB，并等待界面的离线准备完成状态：

  ```ts
  test('savedArticleSurvivesOfflineReload', async ({ context, page }) => {
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByText('offline-marker-123', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  })
  ```

- [ ] **Step 2: 验证红灯。** `pnpm web test:e2e:private`；确认模拟 API 与离线环境可控，失败能定位产品行为而非测试漏启动。浏览器依赖缺失时明确安装所需 Chromium/WebKit，不能跳过后标成功。
- [ ] **Step 3: 修复本范围问题并写运行手册。** 手册列出自有账号、OAuth 回调、唯一用户 ID、私有仓库初始化、单仓库令牌轮换、免费限制、暂停同步、备份/恢复、入口换域迁移。部署命令只记录，不执行。设计级别变更先停下重新确认，不能为让测试通过降低数据保护。
- [ ] **Step 4: 分层验收。** 本地运行 `pnpm test`、`pnpm web type-check`、`pnpm api type-check`、普通与私有构建、`pnpm web test:e2e:private`，再进行一次独立整分支代码审查并修复高风险问题。逐个检查截图、资源加载、错误日志和私有数据是否外泄；检查所有测试进程退出。之后才向用户确认外部资源及测试文章范围，经同意部署私有试用并验证真实 GitHub 并发/限流和 Worker CPU。最后由用户按设计第 7.2 节完成约 15 分钟 iPhone 试用；网络、真实接口、设备任一未验收，必须明确仍未完成端到端验收。
- [ ] **Step 5: 提交和交付。** `test(sync): verify private sync and mobile recovery flows`；提供可试用地址、本地测试结果、未完成项和恢复方法。只推当前工作分支且先确认无私人内容；不用 `push --all`，不因已有 GitHub 代码同步授权就上传文章数据。

## 任务依赖与停止点

按 `1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7` 执行，每项红灯、实现、绿灯、提交后再进入下一项。当前会话顺序开发能减少协议和存储接口反复交接；最后安排独立审查。此处不承诺开发完成时间，失败边界以测试结果为准。

本地验收通过后，真正开通服务是单独的操作确认点。免费平台入口在用户网络无法访问，或免费 CPU 限制无法满足合法图片处理时，保持已有本地版可用并报告实际限制，不自动付费、不静默削弱验证。

## 计划自检

| 已通过设计的要求                                 | 对应任务   |
| ------------------------------------------------ | ---------- |
| 单用户权限、免费优先、独立入口、不泄漏凭证       | 2、3、6、7 |
| 正文/主题/图片一致，离线保存，原子提交与冲突     | 1、3、4、5 |
| 首次选择上传、删除/恢复、历史、独立备份          | 3、4、5、7 |
| 手机离线启动、输入法、后台恢复、缓存与更新       | 5、6、7    |
| 兼容旧功能、四语言、迁移撤回、真机与外部操作边界 | 1 至 7     |

本文描述将要执行的工作，代码、依赖、云服务和新测试均尚未创建或运行。用户确认本计划并选择执行方式后，才开始任务 1。
