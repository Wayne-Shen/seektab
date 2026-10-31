# DeepSeek Harness 开发入口

这是 **SeekTab** Chrome 搜索扩展的现有源码仓库。目录名为 `dsh-search` 不代表产品改名；请在现有 MVP 上继续开发。

## 首先阅读

1. [AGENTS.md](AGENTS.md)：统一开发约定、架构边界、测试与安全要求。
2. [HANDOFF.md](HANDOFF.md)：功能现状、实现细节、已知限制和下一步接手流程。
3. [README.md](README.md) / [README_CN.md](README_CN.md)：英文默认文档及中文切换。
4. [docs/API-VERIFICATION.md](docs/API-VERIFICATION.md) 与 [docs/TEST-REPORT.md](docs/TEST-REPORT.md)：接口核实记录及历史验证。
5. [docs/SeekTab_DeepSeek_Search_API_高级功能集成开发指南.md](docs/SeekTab_DeepSeek_Search_API_高级功能集成开发指南.md)：Search / Fetch 高级功能的研究与设计草案，**尚未批准实施**。

若 Harness 没有自动读取此文件，请在开始对话时明确要求它先读取以上文档。不要假定特定工具一定会自动加载 `agent.md` 或 `AGENTS.md`。

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

发布版本时保持 `package.json` 与 `public/manifest.json` 的版本一致，打上 `v*` 标签推送后，`.github/workflows/release.yml` 会完成校验、打包并创建 GitHub Release；发布说明写在 `docs/releases/<版本>.md`。

## 保持的产品方向

- 个人本地 BYOK，无后端；用户自行在设置中填写 API Key。
- 通过 DeepSeek Search 获取网页结果，不生成 AI 回答。
- 尽量少的扩展权限，密钥不进入源码、日志、Git 或测试数据。
- 保留中英文 README、MIT 许可证、本地数据清除和请求异常处理。
- 本轮迁移没有授权新的功能开发、再次安装到用户 Chrome，或发布新版本。

本机迁移位置与迁移后验证结果见忽略提交的 `MIGRATION.local.md`。继续开发前先确认用户希望实现的下一个功能，不要自行把交接建议全部实施。
