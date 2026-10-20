# 私有同步运行手册

## 当前边界

作者已授权部署试用站点和新建无敏感测试稿的验收。后续不逐步询问普通部署操作；创建登录凭证等安全敏感页面仍按要求交给作者确认。普通本地版仍使用 `/md/`；私有版使用独立 HTTPS 域名根路径，不把它部署到已有站点的子目录。实际完成范围见 [验收记录](private-sync-acceptance.md)。

文章保存在独立私有 GitHub 仓库，公开 fork 只放代码。没有 D1、R2、公开图床或付费升级。OAuth 只确认单个作者身份；单仓库令牌留在后台，浏览器只持有 HttpOnly 会话 Cookie。浏览器副本不提供端到端加密，适用于个人设备。

## 本地复现

使用 Node >=22.22.2、pnpm 12.6.0。从当前已提交版本导出干净源码，避免本机忽略的真实稿件进入构建。以下命令均在代码仓库根目录执行：

```sh
git archive HEAD -o /tmp/yanhui-private-source.tar
mkdir -p /tmp/yanhui-private-source
tar -xf /tmp/yanhui-private-source.tar -C /tmp/yanhui-private-source
cd /tmp/yanhui-private-source
pnpm install --frozen-lockfile
pnpm test
pnpm web type-check
pnpm api type-check
pnpm web build
pnpm web build:private
pnpm api check:private
pnpm api test:private-runtime
pnpm web exec playwright install chromium webkit
pnpm web test:e2e:private
```

临时目录必须为空；再次验收时使用新的目录，不能把新源码覆盖到含私稿的目录。`build:private` 拒绝 `sample.md`、`assets.json`、本机 `.env*.local`，并扫描静态产物中的令牌/私人示例。`check:private` 只打包检查，不部署。随后必须执行 `test:private-runtime`：它在 Workers 运行时加载刚生成的包，以假凭据和封闭的模拟上游检查 OAuth、仓库身份和重定向隔离，不访问真实 GitHub。

浏览器测试使用独立上下文、真实 IndexedDB 和 Service Worker，接口由仅监听 `127.0.0.1` 的测试服务模拟，不包含真实令牌。WebKit 的 Service Worker 请求不能依赖 Playwright 路由拦截，因此模拟服务运行在真实本地 HTTP 层。[Playwright 说明](https://playwright.dev/docs/service-workers)

本地普通版：`pnpm web dev --host 127.0.0.1 --port 5188 --strictPort`。已占用时选新端口，不停掉其他服务。私有静态预览没有真实登录后台，不能据此声称 GitHub 同步已开通。

## 经批准后的配置

先确认资源归属、独立域名，以及首次只上传哪一篇无敏感内容的测试文章。

| 配置                                                      | 值的来源与要求                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `APP_ORIGIN`                                              | 最终 HTTPS 源地址，不带末尾 `/` 或路径                             |
| `ALLOWED_GITHUB_USER_ID`                                  | 作者账号的数字 ID，不是可改名的登录名                              |
| `DATA_REPO_OWNER` / `DATA_REPO_NAME` / `DATA_REPO_BRANCH` | 独立私有文章仓库及分支，创建时初始化 README                        |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`               | 作者自己的 OAuth App，回调为 `APP_ORIGIN/api/auth/github/callback` |
| `DATA_REPO_TOKEN`                                         | Fine-grained PAT，只选文章仓库，Contents 读写；不选所有仓库        |
| `SESSION_SECRET`                                          | 随机强密钥，至少 32 字符；同时用于会话和资源校验凭据               |

配置使用 Cloudflare 后台加密变量或交互式 secret 输入；不要粘贴到聊天、源码、终端命令参数或构建环境。普通身份配置也可用 Worker vars，真实密钥必须用 secrets。

配置文件为 `apps/api/wrangler.private.jsonc`。部署必须从干净构建目录运行，且明确使用 `--config wrangler.private.jsonc`，不能执行原有默认 `deploy` 脚本。经单独批准后才执行：

```sh
pnpm --filter @md/api exec wrangler secret put DATA_REPO_TOKEN --config wrangler.private.jsonc
# 其他密钥按配置表逐项交互输入，不写入 Git。
pnpm --filter @md/api exec wrangler deploy --config wrangler.private.jsonc
```

上线前确认根路径、OAuth 回调一致；未配置或非作者登录必须拒绝 API。仓库公开、令牌失效或换库时，停止写入，不自动复制旧待上传内容。

静态离线清单必须通过真实 Worker 路由检查：不包含被拒绝的 `upload/`，首页使用不会重定向的 `/`。部署后用浏览器实际验证离线就绪与断网重开，不能只依赖 Vite 预览。GitHub 主限流按重置时间等待，二次限流至少等待一分钟；真实授权失效仍停止同步。

## 日常使用与恢复

“文件 → 本地文件夹”只连接当前设备的 Markdown 文件，不是云端文章目录。选择后，当前站点的 IndexedDB 会记住最后一个文件夹句柄；重开面板或网页时检查权限并恢复目录，不自动导入或写回文章。权限需要确认时显示“重新连接”，拒绝授权或目录失效会保留名称并提示重试；不支持目录访问的浏览器仍显示原有提示。

关闭面板保留连接；“忘记此文件夹”仅清除连接记录，不删除磁盘文件、已导入文章或 GitHub 内容。连接不参与导出、同步，清理站点数据后需重新选择。此版本将本机数据库升级到 v6，新增独立 `folders` 表，保留原有文章、图片和设置；旧窗口若提示存储版本变化，应先保存当前编辑再重新打开，不清理站点数据。

登录必须在同一个浏览器从站点首页发起；不要把授权回调链接复制到另一浏览器，也不要刷新已用过的回调页。出现 `invalid_oauth_state` 时返回首页重新登录，不关闭 state 校验。2026-10-13 的 `request_failed` 已在真实 Workers 运行时复现：后台 `fetch` 不接受 `redirect: 'error'`。三个后台 GitHub 请求改用 `manual`，继续通过响应状态拒绝所有 3xx，不能改成自动跟随以免转发凭据。

首次登录逐篇勾选，点“同步所选文章”；不会自动上传所有历史草稿。旧文章如缺少独立主题快照，先打开确认样式。远端文章需下载到设备，本机显示“可离线”后才包含全部本地图片；外链图仍可能需要联网。

停笔 30 秒后尝试自动同步，每设备每分钟最多一次自动文章提交；手动同步也遵守接口限流等待。只有远端提交且本地对应版本确认后才显示“已同步”。上传过程中继续输入，新内容仍保留为待上传版本。无 Web Locks 支持时只手动同步。

离线启动后恢复网络，会重新核验登录与仓库并恢复排队同步；主动暂停则不会自行恢复。周期性的本机历史备份不会重置正文的同步等待时间。恢复稿件后修改字号、自定义 CSS 或代码配色，仍跟随该篇稿件保存和同步。

冲突可以采用本机、采用远端或另存本机副本，另一版本均保留。另存副本不会自动上传。删除保留远端历史；回收站/历史恢复写入新提交，不强制回退整个分支。手工 Git 修改造成正文、目录或图片不一致时拒绝同步，先备份并修复资料，不能改 revision 欺骗校验。

暂停只停同步；退出保留本机稿件。“导出文章备份”保存当前文章、主题和图片，不代表备份整个库，重要文章要逐篇导出。恢复 ZIP 新建文章，不覆盖原稿。登录前保存失败会阻止跳转；先导出，不清站点数据。

“清理本机数据”独立确认，警告未上传内容不可恢复；先退出登录，再打开无编辑器后台写入的清理页。其他标签页/主屏幕窗口未关闭时拒绝清理。成功后删除当前站点本机文章、图片、设置和离线缓存，GitHub 内容不变。没有自动清理 Git 历史或远端图片。

## 更新、撤回、迁移

更新按钮先等输入法候选提交、保存成功，再启用新版本；只重开操作的窗口，不刷新其他窗口。旧静态缓存保留供旧标签页使用，会占用设备空间。备份后显式清理可释放；离线文件下载失败时不显示准备完成。

遇到异常先暂停同步、保留两端文章和独立 ZIP，再撤销后台仓库令牌。轮换 `SESSION_SECRET` 会注销所有设备，旧资源校验凭据失效，下次使用本地原图重新上传。PAT 或 OAuth Secret 轮换后重新检查作者身份、仓库私有性和上传。

回退只到兼容当前数据格式的已验证版本。私有版为兼容 WebKit，把新图片以字节保存并兼容读取旧 Blob；旧普通版的保存格式未改变。不要把未支持该格式的早期私有试验版本用于回退。更换域名/端口前导出尚未同步稿件；浏览器存储不会跟着地址迁移。

## 免费部署验收门槛

当前代码按每图 10 MiB、每篇 497 图、资源总展开 100 MiB、JSON 30 MiB 做上限保护，不代表免费 Worker 能在所有合法上限下运行。真实试用必须记录 CPU、内存、请求数、GitHub 限流与 Wi-Fi/蜂窝延迟，尤其是带图提交和历史读取。不能用本地打包通过推定免费额度足够。

若免费限制或大陆网络不满足要求，保留本地版、备份与待上传队列，报告实测限制。不得自动付费、公开仓库、缩小校验范围或迁移数据到其他服务。
