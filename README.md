# Customize Gemini Ver 2.0

一个基于 Gemini API 的本地 AI 互动剧本/聊天应用，支持多会话、模型预设、酒馆预设导入、内容替换、局域网访问与本地同步能力。

## 功能特点

- 多会话聊天与本地历史保存
- Gemini API Key 与自定义接口配置
- 模型预设、上下文长度、流式输出等参数管理
- 酒馆预设导入与提示词启用控制
- 内容替换、脏词过滤与错误日志记录
- Socket.IO 本地同步与局域网 HTTPS 证书生成
- Vite + React 前端，Express 后端代理

## 环境要求

- Node.js 18 或更高版本
- npm
- 可用的 Gemini API Key，或兼容接口地址

## 本地运行

```bash
npm install
npm run dev
```

启动后按终端输出的地址访问应用。默认会同时启动 Vite 开发服务与后端代理服务。

## 生产构建

```bash
npm run build
npm run preview
```

## 局域网 HTTPS 证书

如需在手机或局域网设备中访问，可生成本地证书：

```bash
npm run cert:lan
```

生成的证书文件位于 `certs/`，该目录不会提交到仓库。

## 目录说明

- `index.tsx`：前端主入口与核心交互逻辑
- `server.ts`：Express、Socket.IO、API 代理与日志服务
- `profanity-list.ts`：本地过滤词列表
- `scripts/`：辅助脚本，例如局域网证书生成
- `index.html`、`index.css`：页面模板与样式
- `vite.config.ts`：Vite 与 PWA 配置

## 不提交的本地内容

以下内容只用于本地运行、备份或参考，不会进入 Git 仓库：

- `.codex/`
- `beifen/`
- `certs/`
- `config.toml`
- `sty/`
- `shili/`
- `my-ai-assistant/`
- `.env.local`

## GitHub 同步

当前仓库远程地址：

```bash
https://github.com/KongDie/AIAPI.git
```

常用同步命令：

```bash
git add .
git commit -m "Update source"
git push
```

如果首次需要以本地内容覆盖远程 `main`：

```bash
git push -u origin main --force-with-lease
```
