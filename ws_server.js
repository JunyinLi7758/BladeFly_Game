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

// 绯荤粺鐘舵€?
const SystemState = {
  IDLE: 'IDLE',
  PREPARE: 'PREPARE',
  RUNNING: 'RUNNING',
  AWIN: 'AWIN',
  BWIN: 'BWIN'
};

// A鐜╁鐘舵€?
const AState = {
  NO_CASTING: 'NO_CASTING',
  CASTING: 'CASTING'
};

// B鐜╁鐘舵€?
const BState = {
  NO_CD: 'NO_CD',
  IN_CD: 'IN_CD'
};

const BWinReason = {
  INTERRUPT: 'INTERRUPT',
  TIMEOUT: 'TIMEOUT'
};

// 鑾峰彇褰撳墠鏃堕棿锛堢锛?
function nowSec() {
  return Date.now() / 1000;
}

// 鍒涘缓鏂版埧闂?
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
    lastInterruptElapsedMs: null,
    swapConfirmA: false,
    swapConfirmB: false,
    aWins: 0,
    bWins: 0
  };
}

const rooms = new Map();

// 鑾峰彇鎴栧垱寤烘埧闂?
function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, createRoom(roomId));
  return rooms.get(roomId);
}

// 鍒嗛厤鎴块棿鍐呰鑹睞銆丅鎴朣
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

// 閲嶇疆鎴块棿鐘舵€?
function resetRoomState(room, options = {}) {
  const resetScore = Boolean(options.resetScore);
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
  room.lastInterruptElapsedMs = null;
  room.swapConfirmA = false;
  room.swapConfirmB = false;
  if (resetScore) {
    room.aWins = 0;
    room.bWins = 0;
  }
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

// 鍚戞埧闂村唴鎵€鏈夊鎴风骞挎挱鐘舵€?
function broadcast(room, payload) {
  const msg = JSON.stringify(payload);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// 鏇存柊鎴块棿鐘舵€佹満
function updateRoom(room) {
  const now = nowSec();

  // 妫€娴婤鐨勫喎鍗存椂闂存槸鍚︾粨鏉?
  if (room.bCdEndTime !== null && now >= room.bCdEndTime) {
    room.bCdEndTime = null;
    room.bState = BState.NO_CD;
  }

  // 鍒濆/缁撴潫鐘舵€?==> 鍑嗗鐘舵€?
  if ((room.systemState === SystemState.IDLE ||
       room.systemState === SystemState.AWIN ||
       room.systemState === SystemState.BWIN) &&
       room.aReady && room.bReady) {
    room.systemState = SystemState.PREPARE;
    room.prepareStartTime = now;
    room.roundStartTime = null;
    room.bWinReason = null;
    room.lastInterruptElapsedMs = null;
  }

  // 鍑嗗鐘舵€?==> 杩愯鐘舵€?
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
    room.lastInterruptElapsedMs = null;
  }

  // 杩愯鐘舵€佽秴鏃讹細寮€灞€瓒呰繃5绉掞紝鍒ゅ畾B鑾疯儨
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
    room.bWins += 1;
  }

  // 杩愯鐘舵€佷笅A鐨勬柦娉曡繘搴︽洿鏂?
  if (room.systemState === SystemState.RUNNING && room.aState === AState.CASTING) {
    const elapsed = now - room.startTime;
    room.barFraction = elapsed / CAST_DURATION;
    if (room.barFraction >= 1.0) {
      room.barFraction = 1.0;
      room.systemState = SystemState.AWIN;
      room.aReady = false;
      room.bReady = false;
      room.aState = AState.NO_CASTING;
      room.aWins += 1;
    }
  }
}

// 澶勭悊瀹㈡埛绔緭鍏?
function handleInput(room, role, action) {
  const now = nowSec();
  // A銆丅鐜╁鍑嗗灏辩华
  if (action === 'ready') {
    if (role === 'A') room.aReady = true;
    if (role === 'B') room.bReady = true;
    return;
  }

  // 鍙屾柟纭鍚庝氦鎹㈣鑹?
  if (action === 'swap_confirm') {
    if (role === 'A') room.swapConfirmA = true;
    if (role === 'B') room.swapConfirmB = true;
    if (room.swapConfirmA && room.swapConfirmB) {
      swapRoles(room);
      resetRoomState(room);
    }
    return;
  }

  // 鎵嬪姩娓呴浂鎴樼哗锛堜粎瀵规垬鍙屾柟鍙Е鍙戯級
  if (action === 'reset_stats') {
    if (role === 'A' || role === 'B') {
      resetRoomState(room, { resetScore: true });
    }
    return;
  }

  // A鐜╁寮€濮嬭鏉?
  if (action === 'start_cast' && role === 'A') {
    if (room.systemState !== SystemState.RUNNING) return;
    room.aState = AState.CASTING;
    room.startTime = now;
    room.barFraction = 0.0;
    return;
  }

  // A鐜╁鍙栨秷璇绘潯
  if (action === 'cancel_cast' && role === 'A') {
    if (room.systemState !== SystemState.RUNNING) return;
    room.aState = AState.NO_CASTING;
    room.barFraction = 0.0;
    return;
  }

  // B鐜╁浣跨敤鎵撴柇
  if (action === 'interrupt' && role === 'B') {
    if (room.bCdEndTime !== null && now < room.bCdEndTime) return;
    if (room.systemState === SystemState.RUNNING && room.startTime !== null) {
      room.lastInterruptElapsedMs = Math.max(0, (now - room.startTime) * 1000);
    }
    if (room.systemState === SystemState.RUNNING && room.aState === AState.CASTING) {
      room.systemState = SystemState.BWIN;
      room.aReady = false;
      room.bReady = false;
      room.aState = AState.NO_CASTING;
      room.bWinReason = BWinReason.INTERRUPT;
      room.bWins += 1;
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

  function getCurrentRole() {
    if (!room) return null;
    const info = room.clients.get(ws);
    return info ? info.role : null;
  }

  // 澶勭悊瀹㈡埛绔秷鎭?
  ws.on('message', (data) => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    //  鍔犲叆鎴块棿娑堟伅: {type:'join', roomId?, role?}
    if (msg.type === 'join') {
      if (room) {
        room.clients.delete(ws);
      }
      // 鑾峰彇鎴栧垱寤烘埧闂达紝鍒嗛厤瑙掕壊
      room = getRoom(msg.roomId || 'default');
      role = msg.role || assignRole(room);
      room.clients.set(ws, { role });
      resetRoomState(room, { resetScore: true });
      ws.send(JSON.stringify({ type: 'joined', role, roomId: room.roomId }));
      return;
    }

    // 娴嬭瘯ping鏃堕棿寤惰繜: {type:'ping', clientSent}
    if (msg.type === 'ping') {
      const serverNow = nowSec();
      try {
        ws.send(JSON.stringify({ type: 'pong', clientSent: msg.clientSent, serverNow }));
      } catch (e) { }
      return;
    }

    //  澶勭悊杈撳叆娑堟伅: {type:'input', action}
    if (!room) return;
    const currentRole = getCurrentRole();
    if (!currentRole) return;

    // 澶勭悊杈撳叆鍔ㄤ綔
    if (msg.type === 'input') {
      handleInput(room, currentRole, msg.action);
    }
  });

  // 澶勭悊杩炴帴鍏抽棴
  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(ws);
    const { hasA, hasB } = getRolePresence(room);
    if (!hasA && !hasB) {
      resetRoomState(room, { resetScore: true });
    }
  });
});


// 瀹氭椂鏇存柊鎴块棿鐘舵€佸苟骞挎挱
// 骞挎挱淇℃伅锛?{type:'state', systemState, aState, bState, aReady, bReady, barFraction, bCdEndTime, bCdRemaining}
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
      lastInterruptElapsedMs: room.lastInterruptElapsedMs,
      swapConfirmA: room.swapConfirmA,
      swapConfirmB: room.swapConfirmB,
      aWins: room.aWins,
      bWins: room.bWins,
      hasA,
      hasB
    });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`WS server running on :${PORT}`);
});


