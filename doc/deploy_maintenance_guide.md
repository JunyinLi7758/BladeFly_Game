# BladeFly 联机版部署与维护指南

## 1. 目标
- 把双人小游戏部署到公网，方便亲友通过互联网联机。
- 形成可重复的部署和维护流程。

## 2. 推荐方案（当前）
- 云厂商：腾讯云轻量应用服务器（Lighthouse）
- 系统：Ubuntu 22.04
- 推荐配置：2核 2GB（起步）
- 地域建议：香港（免备案，快速上线）
- 端口放行：22、80、443、8080

备注：
- 如果选择中国大陆地域，通常需要备案后再提供公网访问。

## 3. 需要上传的文件
以下文件/目录需要上传到服务器：

1. `TwoPlayers.html`
2. `index.html`
3. `style.css`
4. `game_2players.js`
5. `assets.js`
6. `audio.js`
7. `ws_server.js`
8. `package.json`
9. `package-lock.json`
10. `img/`
11. `sound/`

不需要上传：
- `node_modules/`
- `testguide.md`、`Todolist.md` 等本地文档

## 4. 服务器初始化步骤
以 Ubuntu 为例：

```bash
sudo apt update
sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 5. 部署步骤

### 5.1 上传代码
可选方式：
- 方式A：本地打包上传（scp / SFTP）
- 方式B：服务器上直接 `git clone`

示例（服务器上）：
```bash
git clone <你的仓库地址> BladeFly_Game
cd BladeFly_Game
```

### 5.2 安装依赖并启动
```bash
npm ci
node ws_server.js
```

## 6. 生产建议（常驻运行）
建议使用 `pm2` 托管服务，防止断线后服务停止。

```bash
sudo npm i -g pm2
cd BladeFly_Game
pm2 start ws_server.js --name bladefly-ws
pm2 save
pm2 startup
pm2 status
pm2 logs bladefly-ws
```

## 7. 访问与验证
1. 浏览器打开：`http://<服务器IP>/TwoPlayers.html`
2. 双端加入同一房间测试：
- 是否显示“已进入房间”
- 是否可点击“退出房间”
- 第二人进入后是否提示“人已集齐，点击屏幕准备”
- 对战流程是否正常（倒计时、读条、打断、胜负）

## 8. 更新发布流程（后续迭代）
每次代码更新后，按下列流程：

```bash
cd BladeFly_Game
git pull
npm ci
pm2 restart bladefly-ws
pm2 logs bladefly-ws --lines 100
```

## 9. 故障排查清单

### 9.1 页面能打开，但无法联机
- 检查 `ws_server.js` 是否在运行：`pm2 status`
- 检查 8080 端口是否放行（云防火墙 + 系统防火墙）
- 检查浏览器控制台是否有 WebSocket 报错

### 9.2 加入房间后 UI 异常
- 强制刷新浏览器：`Ctrl+F5`
- 检查是否加载了最新 `style.css` / `game_2players.js`

### 9.3 服务异常退出
- 看日志：`pm2 logs bladefly-ws`
- 重启服务：`pm2 restart bladefly-ws`

## 10. 运维记录模板
建议每次发布都记录：

```text
日期：
执行人：
发布内容：
Git提交ID：
执行命令：
结果（成功/失败）：
回滚是否需要：
备注：
```

## 11. 后续优化建议
1. 将 WebSocket 改为同域路径（例如 `/ws`），并支持 `wss`。
2. 增加限流与基础风控（防刷房间/恶意连接）。
3. 增加基础监控（在线人数、房间数、错误日志）。
4. 绑定域名并启用 HTTPS。
