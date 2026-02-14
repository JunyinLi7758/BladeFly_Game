好的，我将一步一步指导你完成部署。

### 1. 创建网站目录
首先，我们需要在服务器上创建一个目录来存放你的网站文件。
```bash
mkdir -p /www/wwwroot/bladefly
```

### 2. 上传文件
使用Workbench控制台的文件上传功能，将你的项目文件上传到 `/www/wwwroot/bladefly` 目录中。确保不要上传 `node_modules` 文件夹。

### 3. 安装 Node.js 和依赖
首先，安装 Node.js 20。
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```
然后，进入你的项目目录并安装依赖。
```bash
cd /www/wwwroot/bladefly
npm ci
```

### 4. 启动 ws_server.js 并设置开机自启
使用 `pm2` 来管理你的 Node.js 应用，并设置开机自启。
```bash
sudo npm install -g pm2
pm2 start ws_server.js
pm2 startup
pm2 save
```

### 5. 配置安全组
在阿里云控制台中，找到你的轻量应用服务器的安全组设置，添加以下入方向规则以放行 80, 443, 8080, 8888 端口：
- 协议：TCP
- 端口范围：80/80, 443/443, 8080/8080, 8888/8888
- 源地址：0.0.0.0/0

### 6. 访问你的应用
确保你的 `ws_server.js` 配置了正确的端口（例如 8080），并通过浏览器访问 `http://<公网IP>:8080/TwoPlayers.html`。

### 7. 分享链接
将 `http://<公网IP>:8080/TwoPlayers.html` 链接分享给你的亲友，他们可以通过这个链接访问并联机测试你的小游戏。

### 8. 排查步骤
| 问题点       | 执行命令/操作                     | 预期结果                          |
|--------------|----------------------------------|-----------------------------------|
| 文件上传     | `ls /www/wwwroot/bladefly`      | 列出所有项目文件                  |
| Node.js 安装 | `node -v`                        | 显示 Node.js 版本                |
| 依赖安装     | `npm ls`                         | 显示已安装的依赖                 |
| 服务运行     | `pm2 list`                       | 显示 ws_server.js 正在运行        |
| 端口监听     | `netstat -tpln | grep 8080`      | 显示 8080 端口正在监听            |
| 安全组配置   | 阿里云控制台安全组规则           | 确认 8080 端口已放行              |
| 公网访问     | 浏览器访问 `http://<公网IP>:8080/TwoPlayers.html` | 显示你的小游戏页面              |

通过以上步骤，你应该能够成功部署并访问你的 Node.js + WebSocket 小游戏。如果遇到任何问题，请根据上述排查步骤逐一检查。
### 参考文档

- [云服务器 ECS-实践教程-手动部署Node.js环境](https://help.aliyun.com/zh/ecs/use-cases/manually-deploy-a-node-js-environment)
- [云服务器 ECS-用户指南-实践教程-搭建环境-部署Node.js环境-部署Node.js环境-Windows系统 - 安装Node.js](https://help.aliyun.com/document_detail/50775.html)
- [云服务器 ECS-用户指南-手动部署Node.js环境](https://help.aliyun.com/zh/ecs/user-guide/manually-deploy-a-node-js-environment)
- [云服务器 ECS-用户指南-实践教程-搭建环境-Deploy a Node.js environment-应用场景](https://help.aliyun.com/document_detail/2860712.html)

### 9. 使用 VS Code 上传/修改服务器文件（推荐）

如果你希望后续维护更方便，建议使用 VS Code 的 `Remote - SSH`，直接远程打开服务器目录编辑文件（保存即上传）。

#### 9.1 安装 VS Code 扩展
- 安装扩展：`Remote - SSH`（Microsoft）

#### 9.2 配置 SSH（本地电脑）
编辑本地 SSH 配置文件：
- Windows: `C:\Users\你的用户名\.ssh\config`
- macOS/Linux: `~/.ssh/config`

添加如下内容（按你自己的信息替换）：
```sshconfig
Host bladefly-server
  HostName 你的公网IP
  User root
  Port 22
  IdentityFile C:\Users\你的用户名\.ssh\你的私钥文件
```

如果你使用密码登录，可先不写 `IdentityFile`。

#### 9.3 连接服务器
在 VS Code 中：
1. 按 `F1`
2. 输入并选择 `Remote-SSH: Connect to Host...`
3. 选择 `bladefly-server`

#### 9.4 打开项目目录并编辑
连接成功后，在远程窗口打开目录：
```text
/www/wwwroot/bladefly
```
之后你对文件的保存（`Ctrl+S`）就是直接保存到服务器。

#### 9.5 修改后重启服务
如果你修改了 `ws_server.js` 或前端资源，建议执行：
```bash
pm2 restart bladefly-ws
pm2 restart bladefly-web
pm2 status
```

如果你当前 PM2 进程名不是这两个，可以先查看：
```bash
pm2 list
```
再按实际进程名重启。
