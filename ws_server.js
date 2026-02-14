// ws_server.js
// Minimal WS server for 2P state sync.
const http = require('http');
const WebSocket = require('ws');
const gameRules = require('./game_rules.json');

const PORT = 8080;
const TICK_MS = 15;
const PREPARE_SECONDS = 3.0;
const CAST_DURATION = 0.63;
const B_CD_SECONDS = 3.0;
const ROUND_TIMEOUT_SECONDS = Number.isFinite(Number(gameRules.roundTimeoutSeconds))
  ? Number(gameRules.roundTimeoutSeconds)
  : 3.0;

// 系统状态
const SystemState = {
  IDLE: 'IDLE',
  PREPARE: 'PREPARE',
  RUNNING: 'RUNNING',
  AWIN: 'AWIN',
  BWIN: 'BWIN'
};

// A玩家状态
const AState = {
  NO_CASTING: 'NO_CASTING',
  CASTING: 'CASTING'
};

// B玩家状态
const BState = {
  NO_CD: 'NO_CD',
  IN_CD: 'IN_CD'
};

const BWinReason = {
  INTERRUPT: 'INTERRUPT',
  TIMEOUT: 'TIMEOUT'
};

// 获取当前时间（秒）
function nowSec() {
  return Date.now() / 1000;
}

// 创建新房间
function createRoom(roomId) {
  return {
    roomId,
    clients: new Map(), // ws -> { role }
    systemState: SystemState.IDLE,
    aState: AState.NO_CASTING,
    bState: BState.NO_CD,
    aReady: false,
    bReady: false,
    startTime: null,
    roundStartTime: null,
    prepareStartTime: null,
    barFraction: 0.0,
    bCdEndTime: null,
    bWinReason: null,
    swapConfirmA: false,
    swapConfirmB: false
  };
}

const rooms = new Map();

// 获取或创建房间
function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, createRoom(roomId));
  return rooms.get(roomId);
}

// 分配房间内角色A、B或S
function assignRole(room) {
  let hasA = false;
  let hasB = false;
  for (const info of room.clients.values()) {
    if (info.role === 'A') hasA = true;
    if (info.role === 'B') hasB = true;
  }
  if (!hasA) return 'A';
  if (!hasB) return 'B';
  return 'S';
}

function getRolePresence(room) {
  let hasA = false;
  let hasB = false;
  for (const info of room.clients.values()) {
    if (info.role === 'A') hasA = true;
    if (info.role === 'B') hasB = true;
  }
  return { hasA, hasB };
}

// 重置房间状态
function resetRoomState(room) {
  room.systemState = SystemState.IDLE;
  room.aState = AState.NO_CASTING;
  room.bState = BState.NO_CD;
  room.aReady = false;
  room.bReady = false;
  room.startTime = null;
  room.roundStartTime = null;
  room.prepareStartTime = null;
  room.barFraction = 0.0;
  room.bCdEndTime = null;
  room.bWinReason = null;
  room.swapConfirmA = false;
  room.swapConfirmB = false;
}

function swapRoles(room) {
  for (const [ws, info] of room.clients.entries()) {
    if (info.role === 'A') info.role = 'B';
    else if (info.role === 'B') info.role = 'A';
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'role_swapped', role: info.role, roomId: room.roomId }));
    }
  }
}

// 向房间内所有客户端广播状态
function broadcast(room, payload) {
  const msg = JSON.stringify(payload);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// 更新房间状态机
function updateRoom(room) {
  const now = nowSec();

  // 检测B的冷却时间是否结束
  if (room.bCdEndTime !== null && now >= room.bCdEndTime) {
    room.bCdEndTime = null;
    room.bState = BState.NO_CD;
  }

  // 初始/结束状态 ==> 准备状态
  if ((room.systemState === SystemState.IDLE ||
       room.systemState === SystemState.AWIN ||
       room.systemState === SystemState.BWIN) &&
       room.aReady && room.bReady) {
    room.systemState = SystemState.PREPARE;
    room.prepareStartTime = now;
    room.roundStartTime = null;
    room.bWinReason = null;
  }

  // 准备状态 ==> 运行状态
  if (room.systemState === SystemState.PREPARE &&
      room.prepareStartTime !== null &&
      now - room.prepareStartTime >= PREPARE_SECONDS) {
    room.systemState = SystemState.RUNNING;
    room.roundStartTime = now;
    room.aState = AState.NO_CASTING;
    room.bState = BState.NO_CD;
    room.startTime = null;
    room.barFraction = 0.0;
    room.bWinReason = null;
  }

  // 运行状态超时：开局超过5秒，判定B获胜
  if (room.systemState === SystemState.RUNNING &&
      room.roundStartTime !== null &&
      now - room.roundStartTime >= ROUND_TIMEOUT_SECONDS) {
    room.systemState = SystemState.BWIN;
    room.aReady = false;
    room.bReady = false;
    room.aState = AState.NO_CASTING;
    room.startTime = null;
    room.barFraction = 0.0;
    room.bWinReason = BWinReason.TIMEOUT;
  }

  // 运行状态下A的施法进度更新
  if (room.systemState === SystemState.RUNNING && room.aState === AState.CASTING) {
    const elapsed = now - room.startTime;
    room.barFraction = elapsed / CAST_DURATION;
    if (room.barFraction >= 1.0) {
      room.barFraction = 1.0;
      room.systemState = SystemState.AWIN;
      room.aReady = false;
      room.bReady = false;
      room.aState = AState.NO_CASTING;
    }
  }
}

// 处理客户端输入
function handleInput(room, role, action) {
  const now = nowSec();
  // A、B玩家准备就绪
  if (action === 'ready') {
    if (role === 'A') room.aReady = true;
    if (role === 'B') room.bReady = true;
    return;
  }

  // 双方确认后交换角色
  if (action === 'swap_confirm') {
    if (role === 'A') room.swapConfirmA = true;
    if (role === 'B') room.swapConfirmB = true;
    if (room.swapConfirmA && room.swapConfirmB) {
      swapRoles(room);
      resetRoomState(room);
    }
    return;
  }

  // A玩家开始读条
  if (action === 'start_cast' && role === 'A') {
    if (room.systemState !== SystemState.RUNNING) return;
    room.aState = AState.CASTING;
    room.startTime = now;
    room.barFraction = 0.0;
    return;
  }

  // A玩家取消读条
  if (action === 'cancel_cast' && role === 'A') {
    if (room.systemState !== SystemState.RUNNING) return;
    room.aState = AState.NO_CASTING;
    room.barFraction = 0.0;
    return;
  }

  // B玩家使用打断
  if (action === 'interrupt' && role === 'B') {
    if (room.bCdEndTime !== null && now < room.bCdEndTime) return;
    if (room.systemState === SystemState.RUNNING && room.aState === AState.CASTING) {
      room.systemState = SystemState.BWIN;
      room.aReady = false;
      room.bReady = false;
      room.aState = AState.NO_CASTING;
      room.bWinReason = BWinReason.INTERRUPT;
    }
    room.bState = BState.IN_CD;
    room.bCdEndTime = now + B_CD_SECONDS;
    console.log(`B interrupt used, next available at ${room.bCdEndTime.toFixed(2)}`);
  }
}


const server = http.createServer();
const wss = new WebSocket.Server({ server });

//    
wss.on('connection', (ws) => {
  let room = null;
  let role = null;

  // 处理客户端消息
  ws.on('message', (data) => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    //  加入房间消息: {type:'join', roomId?, role?}
    if (msg.type === 'join') {
      if (room) {
        room.clients.delete(ws);
      }
      // 获取或创建房间，分配角色
      room = getRoom(msg.roomId || 'default');
      role = msg.role || assignRole(room);
      room.clients.set(ws, { role });
      resetRoomState(room);
      ws.send(JSON.stringify({ type: 'joined', role, roomId: room.roomId }));
      return;
    }

    // 测试ping时间延迟: {type:'ping', clientSent}
    if (msg.type === 'ping') {
      const serverNow = nowSec();
      try {
        ws.send(JSON.stringify({ type: 'pong', clientSent: msg.clientSent, serverNow }));
      } catch (e) { }
      return;
    }

    //  处理输入消息: {type:'input', action}
    if (!room || !role) return;

    // 处理输入动作
    if (msg.type === 'input') {
      handleInput(room, role, msg.action);
    }
  });

  // 处理连接关闭
  ws.on('close', () => {
    if (room) room.clients.delete(ws);
  });
});


// 定时更新房间状态并广播
// 广播信息： {type:'state', systemState, aState, bState, aReady, bReady, barFraction, bCdEndTime, bCdRemaining}
setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room);
    const { hasA, hasB } = getRolePresence(room);
    broadcast(room, {
      type: 'state',
      systemState: room.systemState,
      aState: room.aState,
      bState: room.bState,
      aReady: room.aReady,
      bReady: room.bReady,
      barFraction: room.barFraction,
      bCdEndTime: room.bCdEndTime,
      bCdRemaining: room.bCdEndTime !== null ? Math.max(0, room.bCdEndTime - nowSec()) : 0,
      bWinReason: room.bWinReason,
      swapConfirmA: room.swapConfirmA,
      swapConfirmB: room.swapConfirmB,
      hasA,
      hasB
    });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`WS server running on :${PORT}`);
});
