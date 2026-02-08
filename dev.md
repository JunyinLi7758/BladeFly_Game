# 双人对战版开发说明（2P）

本文件说明双人对战版本的运行方式、房间机制、输入操作与常见问题排查。对应文件：`TwoPlayers.html`、`game_2players.js`、`ws_server.js`。

## 运行方式

1. 启动 WebSocket 服务器（本地对战/联机都需要）：
```bash
node ws_server.js
```

2. 打开双人页面：
- 直接用浏览器打开 `TwoPlayers.html`
- 或者通过任意静态服务器访问该文件

3. 加入房间：
- 在页面顶部输入房间号并点击“加入”
- 或者使用 URL 参数：`TwoPlayers.html?room=你的房间号`

## 文件结构与职责

- `TwoPlayers.html`
  - 双人模式入口页面
  - 提供房间号输入、职业选择按钮、`canvas` 画布
  - 加载 `game_2players.js`

- `game_2players.js`
  - 前端游戏逻辑：状态机、绘制、输入处理、WS 通信
  - 支持本地模拟（无 WS）与联机同步（有 WS）
  - 关键状态：
    - `SystemState`: `IDLE / PREPARE / RUNNING / AWIN / BWIN`
    - `AState`: `NO_CASTING / CASTING`
    - `BState`: `NO_CD / IN_CD`

- `ws_server.js`
  - WebSocket 服务端
  - 负责房间管理、角色分配（A/B）、状态同步、冷却处理

## 房间与角色机制

- 一个房间最多 2 个玩家：A 与 B
- 超出两人会被分配为 `S`（旁观者）
- 角色自动分配：优先补 A，再补 B
- 进入房间会重置房间状态（`resetRoomState`）

## 操作说明

### 画布操作（触屏/鼠标）
- **长按**：A 发起读条（start_cast）
- **长按后松开**：A 取消读条（cancel_cast）
- **短按**：
  - 若当前角色是 B：触发打断
  - 若当前角色是 A 且在 `IDLE`：触发准备

### 键盘操作
- `a` / `j`：A 准备
- `d`：A 取消读条
- `k`：B 打断
- `1`：切换 A 的 COM 模式
- `2`：切换 B 的 COM 模式

## 战斗流程（简述）

1. A 与 B 都准备后进入 `PREPARE`（3 秒）
2. 进入 `RUNNING`
3. A 读条完成则 `AWIN`
4. B 打断成功则 `BWIN`
5. 胜负后回到待机，可再次准备

## CD 与时间同步

- B 打断有固定冷却（`B_CD_SECONDS = 3.0`）
- 服务端会广播 `bCdEndTime` 与 `bCdRemaining`
- 客户端做了时钟偏移同步（ping/pong）来减少移动端时钟误差

## 本地模拟模式

当未连接 WS 时，`game_2players.js` 会在前端本地运行逻辑：
- A/B 可通过 COM 模式自动操作
- 不建议用于真实联机，仅用于测试

## 常见问题排查

- **无法连接 WS**：
  - 确保 `ws_server.js` 已运行
  - 端口默认是 `8080`
  - 访问地址是 `ws://<当前网页域名>:8080`

- **多人进入同一房间后状态异常**：
  - 进入房间会触发状态重置
  - 如果你不想重置，可调整 `ws_server.js` 中 `join` 时的 `resetRoomState` 逻辑

## 调试步骤（建议流程）

1. 启动服务器：
   - 运行 `node ws_server.js`
   - 看到 `WS server running on :8080` 表示启动成功

2. 打开两个浏览器窗口（或两台设备）：
   - 都访问 `TwoPlayers.html?room=dev`
   - 观察页面底部 `WS: ON(A/B)` 是否显示

3. 验证角色分配：
   - 第一个进入的为 A，第二个进入的为 B
   - 第三个进入的会显示 `S`（旁观）

4. 验证基础流程：
   - A 点击/触屏准备
   - B 点击/触屏准备
   - 等待 3 秒进入 `RUNNING`
   - A 长按读条，B 短按打断
   - 观察是否进入 `AWIN` 或 `BWIN`

5. 检查冷却显示：
   - B 打断后图标出现扇形冷却遮罩
   - 冷却结束后遮罩消失

6. 如果状态不一致：
   - 打开浏览器控制台，查看 WS 报错
   - 在 `ws_server.js` 中加入 `console.log(room)` 查看服务端状态
   - 确认 `bCdRemaining` 是否随服务器广播更新

## 重要常量（可调）

- `CAST_DURATION = 0.63`（读条时长）
- `PREPARE_SECONDS = 3.0`（准备时长）
- `B_CD_SECONDS = 3.0`（打断冷却）
- `TICK_MS = 15`（服务器广播频率）
