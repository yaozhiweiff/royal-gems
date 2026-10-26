# GitHub 发布与联网服务

前端使用 GitHub Pages，交换、连锁和技能在本地即时计算；账号、开局、整局成绩提交和排行榜使用 Cloudflare Worker + D1。GitHub Pages 不存放玩家数据库或私密凭据。普通网页只能绑定浏览器凭据，不能保证清除全部网站数据或换浏览器后的物理设备唯一性。

## 本机运行

需要 Node.js 24。先执行 `npm ci`，然后分别运行 `npm run dev:api` 和 `npm run dev`。API 数据保存在被 Git 忽略的 `.data/royal-gems.sqlite`。生产预览执行 `npm run build`，再运行 `node scripts/serve.mjs --with-api --open`。

名字规范化为 NFKC，不区分大小写；数据库唯一约束同时保护名字和设备。每位玩家、每种模式只保存一个最佳记录。简单/困难仅成功通关才能入榜，按实际行动数升序；挑战完成30回合才入榜，按积分降序；同成绩先达成者优先。

开局由服务端发放随机种子，客户端使用相同规则在本地计算，交换时不发送请求。有效通关或完成挑战后，向 `/api/runs/:id/complete` 一次提交完整行动记录，服务端从该种子重放计算；不接受客户端上传分数、回合或角色作为成绩。相同行动记录的重复提交幂等，数据库条件更新防止并发覆盖。失败暂存在浏览器并可补传，超过24小时的对局不接收。原 `/move` 接口继续兼容已打开的旧版网页。

部署顺序为先更新 Worker（提供开局种子和整局提交接口），再发布 Pages，避免新前端连接旧API。未完成或失败对局不入榜。浏览器凭据属于账号访问凭据，不要分享或导出给他人。

## 后端部署

1. 在 Cloudflare 登录后，用 Wrangler 创建 D1：`npx wrangler d1 create royal-gems`。
2. 将返回的 database_id 写入 `backend/wrangler.jsonc`，替换明确标记的占位符。
3. 将 `ALLOWED_ORIGINS` 改为前端域名，例如 `https://YOUR-LOGIN.github.io`，不包含仓库路径；多个来源用逗号分隔。
4. 执行 `npx wrangler d1 migrations apply DB --remote --config backend/wrangler.jsonc`。
5. 执行 `npx wrangler deploy --config backend/wrangler.jsonc`，记录实际返回的 HTTPS 地址；访问 `/api/health` 验证。

也可在 GitHub 仓库 Secrets 中安全配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`，然后手动触发后端部署工作流。不要把这些密钥写入源码、`.env.example`、聊天或前端构建变量。

## 前端发布

1. 将此项目推送到目标 GitHub 仓库 main 分支；原始立绘PNG、测试截图、本地数据库和凭据已被忽略，运行所需网页素材在 `public/assets/`。
2. 在仓库 Settings → Secrets and variables → Actions → Variables 中添加 `VITE_API_URL`，值为实际部署的后端 HTTPS 地址。
3. 在 Settings → Pages 中将发布来源设置为 GitHub Actions。
4. 运行 Pages 工作流；构建会使用 `/<仓库名>/` 作为资源路径。工作流成功后，以返回的 Pages 地址作为正式访问地址。
5. 用两个独立浏览器验证重名注册被拒绝、账号自动识别，以及不同玩家在三榜中的成绩可见。

## 当前部署

- 游戏：https://yaozhiweiff.github.io/royal-gems/
- 仓库：https://github.com/yaozhiweiff/royal-gems
- API：https://royal-gems-api.royal-gems.workers.dev （健康检查 `/api/health`）
- D1：`royal-gems`，账号和数据库标识记录在 `backend/wrangler.jsonc`，它们不是访问密钥。
- 前端已设置仓库变量 `VITE_API_URL`，推送 main 自动发布。后端可通过本机已授权的 Wrangler 部署；GitHub 后端工作流只有安全配置对应 Secrets 后才能使用。
- 本机 Cloudflare 配置位于 `D:/Tools/Cloudflare/config`，访问凭据加密保存，密钥由 Windows 凭据管理器保管；不要提交此目录。
- `npm run test:public` 在真实线上创建两个临时验收账号、完成30次界面交换并验证跨浏览器榜单。报告在 `test-results/public/report.json`；执行后用生成的 `cleanup.sql` 清理这些验收账号：`npx wrangler d1 execute DB --remote --config backend/wrangler.jsonc --file test-results/public/cleanup.sql`。该SQL只包含本次验收创建的明确玩家ID，不影响其他玩家。

参考：[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Vite 子路径部署](https://vite.dev/guide/static-deploy)、[D1 绑定 API](https://developers.cloudflare.com/d1/worker-api/)、[D1 数据库迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
