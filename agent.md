# DeepSeek Harness 开发入口

这是 **SeekTab** Chrome 搜索扩展的现有源码仓库。目录名为 `dsh-search` 不代表产品改名；请在现有 MVP 上继续开发。

## 首先阅读

1. [AGENTS.md](AGENTS.md)：统一开发约定、架构边界、测试与安全要求。
2. [HANDOFF.md](HANDOFF.md)：功能现状、实现细节、已知限制和下一步接手流程。
3. [README.md](README.md) / [README_CN.md](README_CN.md)：英文默认文档及中文切换。
4. [docs/API-VERIFICATION.md](docs/API-VERIFICATION.md) 与 [docs/TEST-REPORT.md](docs/TEST-REPORT.md)：接口核实记录及历史验证。
5. [docs/SeekTab_DeepSeek_Search_API_高级功能集成开发指南.md](docs/SeekTab_DeepSeek_Search_API_高级功能集成开发指南.md)：Search / Fetch 高级功能的研究与设计草案，**尚未批准实施**。

若 Harness 没有自动读取此文件，请在开始对话时明确要求它先读取以上文档。不要假定特定工具一定会自动加载 `agent.md` 或 `AGENTS.md`。

## 功能完成后的 GitHub 发布要求

每次实现的功能完成并通过适当的本地验证后，必须提交到 GitHub、运行 GitHub Actions 构建和测试，并发布一个新的 GitHub Release。具体步骤：

1. 保留工作区已有修改，创建功能分支和可审查的 PR；同步更新 `package.json`、`package-lock.json`、`public/manifest.json` 版本及 `docs/releases/v<版本>.md`。
2. 推送提交并确认对应提交的 GitHub Actions 格式检查、测试、构建和打包全部通过；失败时先修复并重新验证。
3. 合并 PR 后，确认合并提交的源码树与通过检查的提交一致；为合并提交创建尚未存在的 `v<版本>` 标签。
4. 用该成功 Actions 运行生成的扩展 ZIP、源码 ZIP 和 `SHA256SUMS.txt` 创建 GitHub Release；下载并核验发布附件，绝不覆盖已发布版本的资产。
5. 如权限或外部状态阻止操作，保留已完成的工作并明确报告阻塞、已完成步骤及所需操作；不要把未完成的发布描述为成功。若用户对具体任务明确要求不提交或不发布，以用户的明确要求为准。

## 接手前检查

```sh
pwd
git status --short
git branch --show-current
git remote -v
git log -3 --oneline
node --version
npm run format:check
npm test
npm run build
```

依赖缺失时使用 `npm ci`。要看完整界面，应将构建生成的 `dist/` 加载为 Chrome 已解压扩展，普通网页预览不支持完整功能。需要浏览器回归时执行 `npm run test:e2e`，安装浏览器及环境说明见 README。

发布版本时保持 `package.json` 与 `public/manifest.json` 的版本一致，发布说明写在 `docs/releases/v<版本>.md`，先推送提交再推送 `v*` 标签；`.github/workflows/release.yml` 会完成校验、打包并创建 GitHub Release。该文件目前只在本地提交里：令牌缺少 `workflow` 权限时，GitHub 会拒绝通过 git push、Contents API 和 Git Data API 写入 `.github/workflows/`，取得权限后推送即可启用。在此之前，用 CI 构建的 `release/` 产物加 `gh release create` 发布。

## 保持的产品方向

- 个人本地 BYOK，无后端；用户自行在设置中填写 API Key。
- 通过 DeepSeek Search 获取网页结果，不生成 AI 回答。
- 尽量少的扩展权限，密钥不进入源码、日志、Git 或测试数据。
- 保留中英文 README、MIT 许可证、本地数据清除和请求异常处理。
- 不要仅根据迁移记录或交接建议推断新的功能需求；功能完成后的提交和发布按上面的 GitHub 发布要求执行。

本机迁移位置与迁移后验证结果见忽略提交的 `MIGRATION.local.md`。继续开发前先确认用户希望实现的下一个功能，不要自行把交接建议全部实施。
