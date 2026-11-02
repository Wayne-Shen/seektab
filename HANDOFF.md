# SeekTab → DeepSeek Harness 开发交接

## 本地 v1.3.0 账单报表开发

用量图表只统计本扩展在本机完成的请求，不保存搜索词；余额通过官方 GET /user/balance 查询。报表是手动刷新时保存的快照，不是账户级官方账单。v1.3.0 发布流程以 GitHub Actions 构建及校验后的产物为准。

## 2026-11-02：v1.2.0 高级 Search

Search 官方字段与语法已重新核验。设置提供站点、排除词、精确短语、语言、日期、1–50 条结果、摘要/评分、本地化 IPv4 和正文。筛选改写后发送原始问题；高级请求绕过缓存，正文不落盘。Fetch 和 AI 为独立接口，未实现。

## 2026-11-01：v1.1.0 搜索优先改版

用户已批准 Material 3 Expressive 风格改版、GitHub Actions 构建与本机原路径更新。首页仅保留搜索、历史和设置入口；快捷链接移入设置，原有存储结构、API 请求、锁与隐私逻辑保持不变。设置支持在保留未保存草稿的情况下编辑快捷链接。版本来自清单。

本次使用已部署的 ci.yml 构建、测试和上传 seektab-packages；当前 GitHub token 仍不含 workflow scope，因此没有上传或改动 workflow 文件。旧本地 main 上的 release.yml 提交继续保留，当前功能分支从远端 main 起步。发布应使用成功 CI 运行的 ZIP 和校验文件，不要用本机 ZIP 替代。更新时替换现有安装目录内容并重新加载，核对 ID，保留 chrome.storage；不要卸载或引入新的 manifest key。

下面为历史交接记录。

交接日期：2026-10-30（功能现状沿用 2026-10-29 的记录）。本文描述已有实现，供下一位开发者继续工作；不是新的功能需求清单。

## 1. 项目身份与当前状态

| 项目             | 状态                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 产品             | SeekTab，Chrome Manifest V3 新标签页搜索扩展                                                                                                                     |
| 本地项目文件夹名 | `dsh-search`，不需要因此修改包名或公开仓库名                                                                                                                     |
| 公开仓库         | https://github.com/Wayne-Shen/seektab                                                                                                                            |
| Git 远端         | `origin` → `https://github.com/Wayne-Shen/seektab.git`                                                                                                           |
| 本地分支         | 迁移前为 `main`；接手时用 Git 再次确认                                                                                                                           |
| 迁移前本地 HEAD  | `69e33645093c530ee53e2ac97b42a5aa4f4b2063`                                                                                                                       |
| 既有发布         | `v1.0.0`，2026-10-22 发布了扩展 ZIP、完整源码 ZIP 与 SHA-256 文件；`v1.0.1` 与 `v1.0.2` 于 2026-10-31 发布，扩展代码与 v1.0.0 相同，仅更新版本号、文档与发布流程 |
| 许可证           | MIT；第三方依赖保留各自许可                                                                                                                                      |
| UI / 文档        | 当前 UI 为简体中文；默认 README 为英文，`README_CN.md` 为中文                                                                                                    |

2026-10-22 已完成 MVP、GitHub 公开发布和一次成功的 GitHub CI。上述远端发布及 CI 是当时已验证的记录，并不表示本轮迁移重新查询了 GitHub 的最新状态。

本轮工作是移动完整本地仓库并增加交接说明，保留 `.git`、已有依赖、构建产物和测试文件。没有授权更改功能、填写真实 API Key、完成之前未确认的浏览器安装，或向远端推送本轮交接修改。具体机器路径和迁移后实测结果记录在本地忽略文件 `MIGRATION.local.md`。

## 2. 已交付功能

- 替换 Chrome 新标签页，现代浅色 / 深色 / 跟随系统界面和响应式布局。
- 直接调用 DeepSeek Search，展示标题、短摘要、来源与可用的发布时间。
- 支持 5 / 10 / 20 条结果、关键词验证和搜索操作符。
- 最多 8 个快捷链接，可新增、编辑、删除。
- API Key 掩码、显示 / 隐藏、连接测试、本地保存和立即移除。
- 最近 50 条成功搜索，按查询词去重，可关闭和清除。
- 最多 20 组查询 / 条数组合缓存，有效期固定 15 分钟，可手动绕过缓存刷新。
- 跨标签页协调请求和数据更新；相同并发查询可在首个请求完成后复用缓存。
- 停止搜索、25 秒超时、空结果、网络异常、401 / 402 / 429 / 5xx 等错误提示和限流倒计时。
- 键盘聚焦、原生模态框、Escape 关闭和减少动画支持。
- 自动检查、浏览器集成测试、打包脚本、中英 README、贡献说明及安全说明。

## 3. 架构与关键文件

| 文件                            | 责任与接手注意事项                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `public/manifest.json`          | MV3、New Tab override、options 入口、图标、权限、CSP；目前只有 `storage` 与 DeepSeek API 主机权限                                |
| `src/App.tsx`                   | 首页、结果、设置、历史与快捷链接弹窗；请求取消、请求序号和返回首页时的结果保护                                                   |
| `src/lib/types.ts`              | 设置、历史、缓存和结果类型；默认值及容量常量                                                                                     |
| `src/lib/api.ts`                | 固定搜索地址、Unicode 查询长度、安全 URL、结果归一化、HTTP 错误、取消与超时                                                      |
| `src/lib/store.ts`              | 本地状态归一化、保存设置、清除数据、缓存查找、历史去重、隐私版本                                                                 |
| `src/lib/search.ts`             | 搜索协调、缓存优先、跨标签页网络锁、冷却时间、连接测试                                                                           |
| `src/theme.ts`                  | 只读取非敏感主题偏好，减少启动闪烁                                                                                               |
| `src/style.css`                 | Tailwind 基础和自定义响应式样式                                                                                                  |
| `tests/core.test.ts`            | 17 项既有核心测试                                                                                                                |
| `tests/extension.mjs`           | 真实加载解压扩展、模拟 API 的 22 项浏览器检查                                                                                    |
| `scripts/check-bundle.mjs`      | 构建产物的清单、资源、权限、CSP 等检查                                                                                           |
| `scripts/package.py`            | 扩展 ZIP、源码 ZIP、校验文件；排除依赖、Git、测试与本机产物                                                                      |
| `.github/workflows/ci.yml`      | Node 24 的格式、核心测试、构建打包和 Chromium 集成检查                                                                           |
| `.github/workflows/release.yml` | **仅在本地提交 `a21bd4b`，尚未推送到远端**；推 `v*` 标签后校验、打包并创建 GitHub Release，发布说明在 `docs/releases/v<版本>.md` |

不要直接编辑 `dist/`：它由构建生成。`release/` 与 `test-artifacts/` 也属于本地生成目录，均已忽略提交。

## 4. 搜索与数据流

1. UI 修剪并验证关键词，最多 128 个 Unicode code point。
2. `runSearch` 获取 `seektab-network-v1` Web Lock，在锁内重新读取本地状态。
3. 非强制刷新时，查找相同查询词和结果条数、且未超过固定 15 分钟 TTL 的缓存。
4. 未命中时检查共享限流状态，以固定官方地址发起请求。请求之间还有本机共享的最小间隔。
5. 适配器将返回条目转为 UI 使用的安全数据；只接受 HTTP / HTTPS、无嵌入凭据的结果地址。
6. 成功后通过 `seektab-data-v1` 锁更新存储；每次写入前重新读取状态，避免跨标签页覆盖。
7. 请求期间若清除了数据或切换隐私选项，`privacyRevision` 变化，旧请求不再把查询重新写回历史 / 缓存。
8. UI 的请求序号和 AbortController 防止已取消或旧的请求覆盖当前页面。

缓存命中可以更新历史，但不得延长原缓存的到期时间。连接测试不保存 Key，不写入历史或缓存。移除 Key 不等于清除历史 / 缓存，这是现有明确行为。

## 5. API 与安全约束

已实现的请求契约，最后核实日期为 2026-10-22：

```text
POST https://api.deepseek.com/v1/tools/search
Authorization: Bearer <user-provided key>
Content-Type: application/json

{"query":"keyword","count":10,"need_content":false}
```

成功时读取 `results` 数组中的 `title`、`url`、`snippet`、`site_name`、`date`；名称为空回退域名，时间不可用则省略。不要将它改成聊天接口来模拟搜索；更改契约前重新查看官方文档，参见 `docs/API-VERIFICATION.md`。

429 优先遵循 `Retry-After`，缺失时本地默认等待 10 秒；不会自动重试。错误提示不展示服务端原始文本。请求省略 cookie 与 referrer，并拒绝重定向。

密钥保存在 `chrome.storage.local`，没有加密，也不使用 Chrome Sync。本机有权限的人可能读取它；这一限制已在设置与 README 中说明。用户必须自行填写，自动化不得从其他软件、浏览器配置或凭据存储中找 Key。

不加载远程字体或站点图标，不使用内容脚本、后台桥、遥测或后端。API 返回内容按纯文本渲染，不引入 `innerHTML` 或不可信 HTML。

## 6. 在 Harness 中接手

在 DeepSeek Harness 中打开当前项目根目录，明确让它先读 `agent.md`、`AGENTS.md` 和本文件；不依赖特定工具自动识别文件名。

```sh
git status --short
git branch --show-current
git remote -v
git log -3 --oneline
node --version
```

目录迁移前源码工作树是干净的；交接文档和 README 导航更新是本轮新增的本地修改。接手时保留这些修改，不要用 reset / clean 将其抹掉。使用 `git status` 判断实际状态，不假定本地和远端一定同步。

开发与验证：

```sh
# 依赖不存在或不兼容时才重新安装；现有同机依赖可先复用
npm ci

npm run format:check
npm test
npm run build

# 浏览器测试需要兼容的 Chromium / Chrome for Testing
npx playwright install chromium
npm run test:e2e

# 仅在需要重新打包时，额外要求 Python 3
npm run package
```

发布版本：先同步 `package.json` 与 `public/manifest.json` 的版本号，在 `docs/releases/v<版本>.md` 写发布说明，提交后推送 `v<版本>` 标签。`.github/workflows/release.yml` 会重复格式、核心测试、构建打包和浏览器检查，成功后创建 GitHub Release 并上传两个 ZIP 与 `SHA256SUMS.txt`。不要改写已发布的 v1.0.0 / v1.0.1 资产。

该 workflow 目前只存在于本地提交 `a21bd4b`，尚未推送：当前 GitHub 令牌缺少 `workflow` 权限，而 GitHub 会同时拒绝通过 git push、Contents API 和 Git Data API 写入 `.github/workflows/` 下的文件。取得该权限后推送 `a21bd4b` 即可启用。在此之前，用 CI 产物发布：推送提交让 `ci.yml` 构建并上传 `release/` 产物，再执行 `gh release create v<版本> <产物> --verify-tag --latest --notes-file docs/releases/v<版本>.md`。

Node 最低声明为 22.12，`.nvmrc` 与 CI 使用 24。依赖版本由锁文件固定；不要顺手升级。

在 `chrome://extensions` 加载当前仓库的 `dist/` 才能运行完整功能。普通网页的 Vite 预览不提供 `chrome.storage`。修改代码后重新构建、重新加载扩展并打开新标签页。

浏览器测试通过绝对安装路径推导测试扩展 ID，因此迁移目录后应复跑一次。它创建独立临时 profile，不使用用户日常 Chrome，也不读取真实 Key。已有浏览器可通过环境变量 `CHROMIUM_PATH` 指定，不要将个人机器路径写进公共源码。

## 7. 已验证与仍未验证

2026-10-22 历史记录：类型检查、构建、17 项核心测试、22 项浏览器检查和 GitHub CI 均通过。详细记录保存在 `docs/TEST-REPORT.md` 及 JSON 报告中。

2026-10-29 已在迁移后的新目录重新运行：格式检查、类型检查与生产构建通过，17 项核心测试及 22 项浏览器检查全部通过。浏览器检查仍使用模拟 API，真实 API 调用为 0。详细本机记录见 `MIGRATION.local.md`（如存在）；历史报告与本轮实测应区分。

真实 API Key 未提供，真实账户鉴权、余额、搜索质量、网络可达性尚未做用户账户实测。设置中的「测试连接」会发出一次真实、可能计费的搜索；需要用户自行填写 Key 后确认。

2026-10-31 的 v1.0.1 与 v1.0.2 发布实测：本地 `npm run format:check`、`npm test`（17 项）、`npm run package`、`npm run test:e2e`（22 项，真实 API 调用 0 次）全部通过；GitHub CI 运行 <https://github.com/Wayne-Shen/seektab/actions/runs/41210607125>（v1.0.1）与 <https://github.com/Wayne-Shen/seektab/actions/runs/41214143183>（v1.0.2）在 Node 24 上再次通过同样的检查，并把 `release/` 产物作为 artifact 上传。两个 Release 的扩展 ZIP、源码 ZIP 与 `SHA256SUMS.txt` 均来自对应的 CI 构建，下载后用 `shasum -a 256 -c` 校验通过；解压后的 `manifest.json` 版本分别为 1.0.1 与 1.0.2。发布命令由本地 `gh` 执行，因为 workflow 文件当时无法推送；两次发布都新增版本号，未改写已发布资产。

此前浏览器安装只准备到了最终选择目录步骤，未有完成安装的确认记录；用户也可能之后自行安装，因此当前安装状态未知。不要在这次接手中自行安装、重装或迁移浏览器数据。

## 8. 已知限制与下一步讨论

- 当前 UI 只有中文；英文默认文档不意味着有英文 UI。
- Chrome 通常聚焦新标签页的地址栏，扩展不强制抢焦点。页面获得焦点后才可使用 `/`、`⌘K` / `Ctrl+K`。
- 新标签页覆盖不改变 Chrome 的启动 / 恢复上次会话设置。
- 更换解压扩展的加载目录可能改变扩展 ID；浏览器中原 ID 的密钥和数据不会跟随源码目录自动搬迁。
- 当前没有 AI 汇总、自动翻页、云同步、后端或商店发布流程。
- 本地 Key 的安全模型是个人 BYOK，不适合多人共享密钥。
- 本地 `main` 比 `origin/main` 领先一个提交，只含 `.github/workflows/release.yml`；令牌拿到 `workflow` 权限前无法推送它。
- `docs/SeekTab_DeepSeek_Search_API_高级功能集成开发指南.md` 是 Fetch 阅读模式、AI 摘要、高级筛选等方向的研究与设计草案，**未获批准**，其中的接口字段、定价与限速需要在动手前重新核对官方文档。

建议先让用户明确下一项需求。可讨论但尚未授权的方向包括：英文 UI、本地配置备份 / 迁移、组件拆分、可访问性改进、Chrome Web Store 发布准备。不要仅因它们出现在交接文件中就实施。

## 9. 可直接交给 Harness 的开场指令

> 请在当前 `dsh-search` 项目继续开发 SeekTab。先阅读 `agent.md`、`AGENTS.md`、`HANDOFF.md` 和本地 `MIGRATION.local.md`，检查 Git 状态并保留现有修改，运行适当的基线验证。保持个人本地 BYOK、无后端、网页结果优先、最小权限、中英文 README 和 MIT 许可。不要读取或索要我在聊天中粘贴真实 API Key，不要自行发布新版本或安装到我的浏览器。先简要报告当前状态，再根据我接下来给出的具体需求开发；如果没有新的功能指令，停在接手就绪状态。
