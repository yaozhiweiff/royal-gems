# GitHub 发布与联网服务

前端使用 GitHub Pages，账号、对局计算和排行榜使用 Cloudflare Worker + D1。GitHub Pages 不存放玩家数据库或私密凭据。普通网页只能绑定浏览器凭据，不能保证清除全部网站数据或换浏览器后的物理设备唯一性。

## 本机运行

需要 Node.js 24。先执行 `npm ci`，然后分别运行 `npm run dev:api` 和 `npm run dev`。API 数据保存在被 Git 忽略的 `.data/royal-gems.sqlite`。生产预览执行 `npm run build`，再运行 `node scripts/serve.mjs --with-api --open`。

名字规范化为 NFKC，不区分大小写；数据库唯一约束同时保护名字和设备。每位玩家、每种模式只保存一个最佳记录。简单/困难仅成功通关才能入榜，按实际行动数升序；挑战完成30回合才入榜，按积分降序；同成绩先达成者优先。

对局由服务端生成并按交换步骤重放计算；不接受客户端上传分数、回合或角色作为成绩。每个行动含版本号和重试标识，重复请求不会再次消耗回合。中断或失败对局不入榜。浏览器凭据属于账号访问凭据，不要分享或导出给他人。

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

当前没有真实仓库或后端连接时，上述配置只是发布准备，不能视为已经上线。

参考：[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Vite 子路径部署](https://vite.dev/guide/static-deploy)、[D1 绑定 API](https://developers.cloudflare.com/d1/worker-api/)、[D1 数据库迁移](https://developers.cloudflare.com/d1/reference/migrations/)。
