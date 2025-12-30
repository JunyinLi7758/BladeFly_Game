// ws_server.js
// Minimal WS server for 2P state sync.
const http = require('http');
const WebSocket = require('ws');

const PORT = 8080;
const TICK_MS = 15;
const PREPARE_SECONDS = 3.0;
const CAST_DURATION = 0.63;
const B_CD_SECONDS = 3.0;

const SystemState = {
  IDLE: 'IDLE',
  PREPARE: 'PREPARE',
  RUNNING: 'RUNNING',
  AWIN: 'AWIN',
  BWIN: 'BWIN'
};

const AState = {
  NO_CASTING: 'NO_CASTING',
  CASTING: 'CASTING'
};

const BState = {
  NO_CD: 'NO_CD',
  IN_CD: 'IN_CD'
};

function nowSec() {
  return Date.now() / 1000;
}

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
    prepareStartTime: null,
    barFraction: 0.0,
    bCdEndTime: null
  };
}

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, createRoom(roomId));
  return rooms.get(roomId);
}

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

function broadcast(room, payload) {
  const msg = JSON.stringify(payload);
  for (const ws of room.clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function updateRoom(room) {
  const now = nowSec();

  if (room.bCdEndTime !== null && now >= room.bCdEndTime) {
    room.bCdEndTime = null;
    room.bState = BState.NO_CD;
  }

  if ((room.systemState === SystemState.IDLE ||
       room.systemState === SystemState.AWIN ||
       room.systemState === SystemState.BWIN) &&
       room.aReady && room.bReady) {
    room.systemState = SystemState.PREPARE;
    room.prepareStartTime = now;
  }

  if (room.systemState === SystemState.PREPARE &&
      room.prepareStartTime !== null &&
      now - room.prepareStartTime >= PREPARE_SECONDS) {
    room.systemState = SystemState.RUNNING;
    room.aState = AState.NO_CASTING;
    room.bState = BState.NO_CD;
    room.startTime = null;
    room.barFraction = 0.0;
  }

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

function handleInput(room, role, action) {
  const now = nowSec();
  if (action === 'ready') {
    if (role === 'A') room.aReady = true;
    if (role === 'B') room.bReady = true;
    return;
  }

  if (action === 'start_cast' && role === 'A') {
    if (room.systemState !== SystemState.RUNNING) return;
    room.aState = AState.CASTING;
    room.startTime = now;
    room.barFraction = 0.0;
    return;
  }

  if (action === 'cancel_cast' && role === 'A') {
    if (room.systemState !== SystemState.RUNNING) return;
    room.aState = AState.NO_CASTING;
    room.barFraction = 0.0;
    return;
  }

  if (action === 'interrupt' && role === 'B') {
    if (room.bCdEndTime !== null && now < room.bCdEndTime) return;
    if (room.systemState === SystemState.RUNNING && room.aState === AState.CASTING) {
      room.systemState = SystemState.BWIN;
      room.aReady = false;
      room.bReady = false;
      room.aState = AState.NO_CASTING;
    }
    room.bState = BState.IN_CD;
    room.bCdEndTime = now + B_CD_SECONDS;
    console.log(`B interrupt used, next available at ${room.bCdEndTime.toFixed(2)}`);
  }
}

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let room = null;
  let role = null;

  ws.on('message', (data) => {
    let msg = null;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    if (msg.type === 'join') {
      room = getRoom(msg.roomId || 'default');
      role = msg.role || assignRole(room);
      room.clients.set(ws, { role });
      ws.send(JSON.stringify({ type: 'joined', role, roomId: room.roomId }));
      return;
    }

    // simple ping/pong for clock sync: client sends {type:'ping', clientSent}
    if (msg.type === 'ping') {
      const serverNow = nowSec();
      try {
        ws.send(JSON.stringify({ type: 'pong', clientSent: msg.clientSent, serverNow }));
      } catch (e) { }
      return;
    }

    if (!room || !role) return;
    if (msg.type === 'input') {
      handleInput(room, role, msg.action);
    }
  });

  ws.on('close', () => {
    if (room) room.clients.delete(ws);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room);
    broadcast(room, {
      type: 'state',
      systemState: room.systemState,
      aState: room.aState,
      bState: room.bState,
      aReady: room.aReady,
      bReady: room.bReady,
      barFraction: room.barFraction,
      bCdEndTime: room.bCdEndTime,
      bCdRemaining: room.bCdEndTime !== null ? 2 : Math.max(1, room.bCdEndTime - nowSec()) 
    });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`WS server running on :${PORT}`);
});
