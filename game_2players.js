// game_2players.js
import { Assets, initImages, setSkillIcon } from './assets.js';
import { preloadAllSounds, unlockAudio, playSound, stopSound } from './audio.js';

// #region ========== 0) 基本常量与画布（canvas / resize / layout缓存）==========
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let WIDTH = 900;
let HEIGHT = 450;

// 读条参数
const BAR_DURATION = 0.56;   // 秒
const BAR_WIDTH_MAX = 600;   // px

// 进度条颜色 & 淡出
const BAR_COLOR_NORMAL = '0,180,90';
const BAR_COLOR_HIT    = '255,64,64';

const UI = {
  bg: '#1e1e1e',
  textMain: '#ffffff',
  textSub: '#dcdcdc',
  textResult: '#ffff00',
  barBg: '#505050',
  iconFallback: '#4a6fa5',
  iconStroke: '#666',
  title: '\u6B3A\u9A97\u5251\u7EAF\u6A21\u62DF\u5668v1.1'
};
let barRgb = BAR_COLOR_NORMAL;
let barAlpha = 1.0;
let barFadeActive = false;
let barFadeStartTime = 0;
const BAR_FADE_DURATION = 0.4;
let barHitFraction = 0.0;

// 方案A：布局缓存
let layoutDirty = true;

// 布局缓存变量
let iconSize = 0, iconX = 0, iconY = 0;
let titleSize = 0, msgSize = 0, resultSize = 0;
let barWidth = 0, barHeight = 0, barXAdj = 0, barY = 0;
let logoHeight = 0;
let logoWidth = 0, logoX = 0, logoY = 0;
let titleFont = '', msgFont = '', resultFont = '';
let logoAspect = 4;

function layout() {
  iconSize = Math.min(WIDTH * 0.15, 100);
  iconX = (WIDTH - iconSize) / 2;
  iconY = HEIGHT * 0.62;

  titleSize  = Math.max(24, WIDTH * 0.06);
  msgSize    = Math.max(16, WIDTH * 0.04);
  resultSize = Math.max(16, WIDTH * 0.04);

  barWidth  = Math.min(BAR_WIDTH_MAX, WIDTH * 0.8);
  barHeight = Math.max(20, HEIGHT * 0.08);
  barY = HEIGHT * 0.47;

  const barX = (WIDTH - BAR_WIDTH_MAX) / 2;
  barXAdj = barX - (barWidth - BAR_WIDTH_MAX) / 2;

  logoHeight = Math.min(HEIGHT * 0.15, 80);
  logoWidth = logoHeight * logoAspect;
  logoX = (WIDTH - logoWidth) / 2;
  logoY = HEIGHT * 0.05;

  titleFont = `bold ${titleSize}px "Microsoft YaHei", Arial`;
  msgFont = `${msgSize}px "Microsoft YaHei", Arial`;
  resultFont = `${resultSize}px "Microsoft YaHei", Arial`;

  layoutDirty = false;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;

  WIDTH  = rect.width;
  HEIGHT = rect.height;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  layoutDirty = true;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));
// #endregion



// #region ========== 1) 职业系统（JOBS / currentJob / setJob / getCdSeconds）==========
const JOBS = {
  Blade:  { name: '剑纯', skillname: '剑飞惊天', icon: 'img/icon_blade.png',  skillSound: 'skill_blade',  cd: 3.0 },
  Flower: { name: '万花', skillname: '厥阴',   icon: 'img/icon_flower.png', skillSound: 'skill_flower', cd: 3.0 },
  Toxic:  { name: '五毒', skillname: '灵蛊',     icon: 'img/icon_toxic.png',  skillSound: 'skill_toxic',  cd: 3.0 },
};

let currentJobKey = 'Blade';
let currentJob = JOBS[currentJobKey];
let skillIconInitialized = false;

function getCdSeconds() {
  return (currentJob && typeof currentJob.cd === 'number') ? currentJob.cd : 3.0;
}

function setJob(jobKey) {
  if (!JOBS[jobKey]) return;
  currentJobKey = jobKey;
  currentJob = JOBS[jobKey];
  setSkillIcon(currentJob.icon);
  skillIconInitialized = Boolean(Assets.skillImg && Assets.skillImg.src);
  message = `长按读条欺骗${currentJob.name}，骗到别忘了生太极！`;
}

function ensureSkillIcon() {
  if (Assets.skillImg && Assets.skillImg.src) {
    skillIconInitialized = true;
  }
  if (skillIconInitialized) return;
  const icon = currentJob && currentJob.icon ? currentJob.icon : 'img/icon_blade.png';
  setSkillIcon(icon);
  skillIconInitialized = Boolean(Assets.skillImg && Assets.skillImg.src);
}
// #endregion



// #region ========== 2) 资源初始化（图片/音效预加载） ==========
initImages();
setSkillIcon(currentJob.icon);
skillIconInitialized = Boolean(Assets.skillImg && Assets.skillImg.src);
setTimeout(ensureSkillIcon, 0);
preloadAllSounds();
// #endregion



// ====== System State ======
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

let systemState = SystemState.IDLE;
let aState = AState.NO_CASTING;
let bState = BState.NO_CD;
let message = '2P mode';

// WS
let ROOM_ID = (new URLSearchParams(location.search)).get('room') || 'default';
const WS_URL = `ws://${location.hostname}:8080`;
let ws = null;
let wsConnected = false;
let wsRole = null;
let roomInputEl = null;
let btnJoinRoomEl = null;

// Time
let startTime = null;
let prepareStartTime = null;
let aCancelUntil = null;

// Casting
const CAST_DURATION = 0.63;
let barFraction = 0.0;

// A/B ready flags
let aReady = false;
let bReady = false;

// COM mode flags
let aComMode = false;
let bComMode = false;

// Audio sources
let currentBarSource = null;
let currentSkillSource = null;
let currentFinishSource = null;

// B cooldown
const B_CD_SECONDS = 3.0;
let bCdEndTime = null;
let bCdRemaining = 0;
// Clock sync
let clockOffset = 0; // server_time - local_time (seconds)
let pingIntervalId = null;

// ====== Strategy ======
const AStrategy = {
  startChance: 0.5,
  cancelAtFrac: 0.4,
  cancelCooldown: 0.6
};

const BStrategy = {
  reactionAtFrac: 0.6,
  reactionTime: 0.2
};

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function AUpdateStrategyRandom() {
  AStrategy.startChance = randomBetween(0.2, 0.8);
  AStrategy.cancelAtFrac = randomBetween(0.1, 1.3);
  AStrategy.cancelCooldown = randomBetween(0.2, 1.2);
}

function BUpdateStrategyRandom() {
  BStrategy.reactionAtFrac = randomBetween(0.2, 0.9);
  BStrategy.reactionTime = randomBetween(0.05, 0.45);
}

// ====== A system ======
function AReady() {
  if (wsConnected) {
    sendInput('ready');
    return;
  }
  aReady = true;
}

function ASetComMode(enabled) {
  aComMode = Boolean(enabled);
  if (aComMode) AReady();
}

function AStartCasting(now) {
  if (systemState !== SystemState.RUNNING) return;
  if (wsConnected) {
    sendInput('start_cast');
    return;
  }
  aState = AState.CASTING;
  startTime = now;
  barFraction = 0.0;

  stopSound(currentBarSource);
  currentBarSource = playSound('bar', false);
}

function ACancelCasting(now) {
  if (systemState !== SystemState.RUNNING) return;
  if (wsConnected) {
    sendInput('cancel_cast');
    return;
  }
  aState = AState.NO_CASTING;
  barFraction = 0.0;
  aCancelUntil = now + AStrategy.cancelCooldown;
  stopAllSounds();
  AUpdateStrategyRandom();
}

function resetBarVisuals() {
  barRgb = BAR_COLOR_NORMAL;
  barAlpha = 1.0;
  barFadeActive = false;
  barHitFraction = 0.0;
}

function showInterruptBar(now) {
  barHitFraction = Math.max(0, Math.min(1, barFraction));
  barRgb = BAR_COLOR_HIT;
  barAlpha = 1.0;
  barFadeActive = true;
  barFadeStartTime = now;
}

// ====== B system ======
function BReady() {
  if (wsConnected) {
    sendInput('ready');
    return;
  }
  bReady = true;
}

function BSetComMode(enabled) {
  bComMode = Boolean(enabled);
  if (bComMode) BReady();
}

function BInterrupt(now) {
  if (bCdEndTime !== null && now < bCdEndTime) return;
  if (wsConnected) {
    sendInput('interrupt');
    return;
  }

  if (systemState === SystemState.RUNNING && aState === AState.CASTING) {
    systemState = SystemState.BWIN;
    aReady = false;
    bReady = false;
    aState = AState.NO_CASTING;
    showInterruptBar(now);
  }
  bState = BState.IN_CD;
  bCdEndTime = now + B_CD_SECONDS;

  stopSound(currentBarSource);
  currentBarSource = null;
  stopSound(currentSkillSource);
  currentSkillSource = playSound('skill_blade', false);
}

// ====== System ======
function maybeEnterPrepare(now) {
  if ((systemState === SystemState.IDLE || systemState === SystemState.AWIN || systemState === SystemState.BWIN
  ) && aReady && bReady) {
    systemState = SystemState.PREPARE;
    prepareStartTime = now;
  }
}

function updatePrepare(now) {
  if (prepareStartTime === null) return;

  if (now - prepareStartTime >= 3.0) {
    systemState = SystemState.RUNNING;
    aState = AState.NO_CASTING;
    bState = BState.NO_CD;
    startTime = null;
    barFraction = 0.0;
    resetBarVisuals();
  }
  AUpdateStrategyRandom();
  BUpdateStrategyRandom();
}

function updateCasting(now) {
  if (aState !== AState.CASTING) return;
  const elapsed = now - startTime;
  barFraction = elapsed / CAST_DURATION;
  if (barFraction >= 1.0) {
    barFraction = 1.0;
    systemState = SystemState.AWIN;
    aReady = false;
    bReady = false;
    aState = AState.NO_CASTING;

    stopSound(currentBarSource);
    currentBarSource = null;
    stopSound(currentFinishSource);
    currentFinishSource = playSound('finish', false);
  }
}

function UpdateA(now) {
  if (aState === AState.CASTING) {
    updateCasting(now);
  }
}

function UpdateB(now) {
  if (bState === BState.IN_CD && bCdEndTime !== null && now >= bCdEndTime) {
    bCdEndTime = null;
    bState = BState.NO_CD;
  }
}

function UpdateAStrategy(now) {
  if (systemState !== SystemState.RUNNING) return;

  if (aState === AState.NO_CASTING) {
    if (aCancelUntil !== null && now < aCancelUntil) return;
    if (Math.random() < AStrategy.startChance) {
      AStartCasting(now);
    }
    return;
  }

  if (aState === AState.CASTING && barFraction >= AStrategy.cancelAtFrac) {
    ACancelCasting(now);
  }
}

function UpdateBStrategy(now) {
  if (systemState !== SystemState.RUNNING) return;
  // Use strategy to trigger B interrupt around target fraction.
  if (bCdEndTime !== null && now < bCdEndTime) return;
  if (startTime === null) return;

  const elapsed = now - startTime;
  const frac = elapsed / CAST_DURATION;
  if (frac >= BStrategy.reactionAtFrac) {
    // Apply reaction delay
    if (elapsed >= BStrategy.reactionAtFrac * CAST_DURATION + BStrategy.reactionTime) {
      BInterrupt(now);
    }
  }
}

function SystemUpdate() {
  if (wsConnected) return;
  const now = performance.now() / 1000;

  if (systemState === SystemState.AWIN || systemState === SystemState.BWIN) {
    if (aComMode) AReady();
    if (bComMode) BReady();
  }

  maybeEnterPrepare(now);

  if (systemState === SystemState.PREPARE) {
    updatePrepare(now);
    return;
  }

  if (systemState === SystemState.RUNNING) {
    if (aComMode) UpdateAStrategy(now);
    UpdateA(now);
    UpdateB(now);
    if (bComMode) UpdateBStrategy(now);
  }
}

function stopAllSounds() {
  stopSound(currentBarSource);
  stopSound(currentSkillSource);
  stopSound(currentFinishSource);
  currentBarSource = null;
  currentSkillSource = null;
  currentFinishSource = null;
}

function sendInput(action) {
  if (!wsConnected || !ws) return;
  ws.send(JSON.stringify({ type: 'input', action }));
}

function connectWS() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn('WS init failed', e);
    return;
  }

  ws.addEventListener('open', () => {
    wsConnected = true;
    ws.send(JSON.stringify({ type: 'join', roomId: ROOM_ID }));
    // start periodic ping for clock sync
    if (pingIntervalId) clearInterval(pingIntervalId);
    pingIntervalId = setInterval(() => {
      try {
        const clientSent = Date.now() / 1000;
        ws.send(JSON.stringify({ type: 'ping', clientSent }));
      } catch (e) { }
    }, 1000);
  });

  ws.addEventListener('message', (event) => {
    let msg = null;
    try { msg = JSON.parse(event.data); } catch (e) { return; }

    if (msg.type === 'joined') {
      wsRole = msg.role || null;
      return;
    }

    if (msg.type === 'state') {
      const prevState = systemState;
      systemState = msg.systemState;
      aState = msg.aState;
      bState = msg.bState;
      aReady = msg.aReady;
      bReady = msg.bReady;
      barFraction = msg.barFraction;
        // Prefer server-provided remaining seconds to avoid clock skew on mobile
        bCdRemaining = 0;
        if (msg.bCdRemaining !== undefined && msg.bCdRemaining !== null) {
          const parsed = Number(msg.bCdRemaining);
          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            // clamp to valid range to avoid clock-skew or bad values
            bCdRemaining = Math.max(0, Math.min(B_CD_SECONDS, parsed));
          }
        } else if (typeof msg.bCdEndTime === 'number') {
          // fallback: compute remaining using server end time (epoch seconds)
          // use clockOffset to account for server-client clock difference
          const adjustedNow = (Date.now() / 1000) + clockOffset;
          bCdRemaining = Math.max(0, Math.min(B_CD_SECONDS, msg.bCdEndTime - adjustedNow));
        }
        bCdEndTime = msg.bCdEndTime;

      if (prevState !== systemState) {
        if (systemState === SystemState.RUNNING) {
          resetBarVisuals();
        }
        if (systemState === SystemState.BWIN && prevState === SystemState.RUNNING) {
          showInterruptBar(performance.now() / 1000);
        }
      }
    }
  });

  ws.addEventListener('message', (event) => {}); // keep event listeners consistent

  // handle pong for clock sync
  ws.addEventListener('message', (event) => {
    let msg2 = null;
    try { msg2 = JSON.parse(event.data); } catch (e) { return; }
    if (msg2.type === 'pong' && typeof msg2.serverNow === 'number' && typeof msg2.clientSent === 'number') {
      const nowRecv = Date.now() / 1000;
      const rtt = nowRecv - msg2.clientSent;
      const offsetCandidate = msg2.serverNow - (msg2.clientSent + rtt / 2);
      // smooth offset
      clockOffset = clockOffset * 0.8 + offsetCandidate * 0.2;
    }
  });

  ws.addEventListener('close', () => {
    wsConnected = false;
    wsRole = null;
    if (pingIntervalId) { clearInterval(pingIntervalId); pingIntervalId = null; }
  });
}

// ====== Input: 按键与画布长按/短按逻辑 ======
let recentLongPress = 0; // seconds, used to avoid double-triggering click after long-press

// Canvas press handling: 长按触发 A start_cast，松开触发 cancel；短按作为打断（B）或准备（A）
function setupCanvasInput() {
  if (!canvas) return;

  const LONG_MS = 250;
  let longPressTimer = null;
  let longPressFired = false;

  function startPress(e) {
    // 阻止触摸引发的滚动/点击
    if (e.cancelable) e.preventDefault();
    longPressFired = false;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      const now = performance.now() / 1000;
      recentLongPress = now;
      // 只有 A 发起读条（服务器会忽略无效角色）
      AStartCasting(now);
    }, LONG_MS);
  }

  function endPress(e) {
    if (e && e.cancelable) e.preventDefault();
    const now = performance.now() / 1000;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (longPressFired) {
      // 长按后松开 -> 取消读条
      recentLongPress = now;
      ACancelCasting(now);
      longPressFired = false;
    } else {
      // 短按：如果是 B 则触发打断；否则视为准备（单击准备）
      if (wsConnected) {
        if (wsRole === 'B' && !bComMode) {
          BInterrupt(now);
        } else if (wsRole === 'A' && !aComMode) {
          // 单击准备（若在 IDLE）或短按不触发读条
          if (systemState === SystemState.IDLE) AReady();
        }
      } else {
        // 本地模式：单击作为 A 的准备或短按触发 AStart
        if (systemState === SystemState.IDLE) {
          AReady();
        } else {
          // 若想在本地短按也触发打断，请改为 BInterrupt
        }
      }
    }
  }

  // 鼠标
  canvas.addEventListener('mousedown', startPress);
  window.addEventListener('mouseup', endPress);

  // 触摸
  canvas.addEventListener('touchstart', startPress, { passive: false });
  canvas.addEventListener('touchend', endPress);
  canvas.addEventListener('touchcancel', endPress);
}

// 按钮与开关绑定
window.addEventListener('DOMContentLoaded', () => {
  roomInputEl = document.getElementById('roomIdInput');
  btnJoinRoomEl = document.getElementById('btnJoinRoom');

  // 初始化房间输入值
  if (roomInputEl) roomInputEl.value = ROOM_ID || 'default';
  function joinRoomById(id) {
    const newRoom = id && id.trim() ? id.trim() : 'default';
    // If already connected, close previous connection first
    if (ws) {
      try {
        ws.close();
      } catch (e) { /* ignore */ }
      ws = null;
      wsConnected = false;
      wsRole = null;
    }
    ROOM_ID = newRoom;
    connectWS();
  }

  if (btnJoinRoomEl) {
    btnJoinRoomEl.addEventListener('click', () => {
      const v = (roomInputEl && roomInputEl.value) ? roomInputEl.value.trim() : '';
      joinRoomById(v);
    });
  }

  // 若通过 URL 指定房间，则自动加入
  if (ROOM_ID && ROOM_ID !== 'default') {
    connectWS();
  }

  // no external control buttons — use canvas/touch/keyboard inputs
  setupCanvasInput();
});

// 键盘快捷键：单击准备 a/j，取消 d，打断 k
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const now = performance.now() / 1000;

  if (e.key === '1') {
    ASetComMode(!aComMode);
  }
  if (e.key === '2') {
    BSetComMode(!bComMode);
  }

  if (!aComMode) {
    if (e.key === 'a' || e.key === 'j') AReady();
    if (e.key === 'd') ACancelCasting(now);
  }

  if (!bComMode) {
    if (e.key === 'k') BInterrupt(now);
  }
});

// 屏幕任意点击也能进入准备（但忽略按钮/输入上的点击；并避免与长按冲突）
let lastGlobalReadyTime = 0;
function tryGlobalReady(e, isTouch = false) {
  const tag = (e && e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
  if (['BUTTON', 'INPUT', 'LABEL', 'A', 'SELECT', 'TEXTAREA'].includes(tag)) return;
  const now = performance.now() / 1000;
  if (now - recentLongPress < 0.6) return; // 忽略紧接着的 click（来自长按）
  if (now - lastGlobalReadyTime < 0.6) return; // 防止 touchend + click 双触发

  if (![SystemState.IDLE, SystemState.AWIN, SystemState.BWIN].includes(systemState)) return;

  lastGlobalReadyTime = now;
  if (wsConnected) {
    if (wsRole === 'A' && !aComMode) AReady();
    if (wsRole === 'B' && !bComMode) BReady();
  } else {
    AReady();
  }

  if (isTouch && e && e.cancelable) e.preventDefault();
}

window.addEventListener('click', (e) => tryGlobalReady(e, false));
window.addEventListener('touchend', (e) => tryGlobalReady(e, true), { passive: false });


// #region ========== 7) 绘制系统（draw + 绘制工具函数）=========
function drawRoundedRect(x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function drawCDFan(x, y, size, fraction) {
  if (fraction <= 0) return;

  const w = size;
  const h = size;
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (fraction >= 1) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.63)';
    ctx.fillRect(x, y, w, h);
    return;
  }

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.63)';

  const points = getCDFanPoints(x, y, w, h);

  const totalPoints = points.length - 1;
  const endIdx = Math.floor(totalPoints * (1 - fraction));

  ctx.beginPath();
  ctx.moveTo(cx, cy);

  for (let i = 0; i <= endIdx; i++) ctx.lineTo(points[i].x, points[i].y);

  if (endIdx < totalPoints) {
    const t = (totalPoints * (1 - fraction)) % 1;
    const p1 = points[endIdx];
    const p2 = points[endIdx + 1];
    ctx.lineTo(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t);
  }

  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const cdFanPointCache = new Map();

function getCDFanPoints(x, y, w, h) {
  const key = `${x},${y},${w},${h}`;
  let points = cdFanPointCache.get(key);
  if (!points) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    points = [
      { x: cx,     y: y        },
      { x: x + w,  y: y        },
      { x: x + w,  y: cy       },
      { x: x + w,  y: y + h    },
      { x: cx,     y: y + h    },
      { x: x,      y: y + h    },
      { x: x,      y: cy       },
      { x: x,      y: y        },
      { x: cx,     y: y        }
    ];
    cdFanPointCache.set(key, points);
  }
  return points;
}

function updateLogoAspect() {
  if (Assets.logoLoaded && Assets.logoImg) {
    const nextAspect = Assets.logoImg.width / Assets.logoImg.height;
    if (nextAspect !== logoAspect) {
      logoAspect = nextAspect;
      layoutDirty = true;
    }
  }
}

function drawLogo() {
  if (Assets.logoLoaded && Assets.logoImg) {
    ctx.drawImage(Assets.logoImg, logoX, logoY, logoWidth, logoHeight);
  }
}

function drawSkillIcon() {
  ensureSkillIcon();
  const img = Assets.skillImg;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, iconX, iconY, iconSize, iconSize);
    return;
  }
  ctx.fillStyle = UI.iconFallback;
  ctx.fillRect(iconX, iconY, iconSize, iconSize);
  ctx.strokeStyle = UI.iconStroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(iconX, iconY, iconSize, iconSize);
}

function drawCooldownOverlay(target, remaining, total) {
  let fraction = 0.0;
  if (remaining > 0) {
    fraction = remaining / total;
  }
  drawCDFan(target.x, target.y, target.size, fraction);
}

function drawCooldownOverlays(now) {
  const iconTarget = { x: iconX, y: iconY, size: iconSize };

  // Use epoch time when connected (server sends epoch seconds), otherwise use performance time
  let cdRemaining = 0.0;
  if (wsConnected) {
    cdRemaining = typeof bCdRemaining === 'number' ? bCdRemaining : 0.0;
  } else {
    const nowSec = now;
    if (bCdEndTime !== null) cdRemaining = bCdEndTime - nowSec;
  }
  drawCooldownOverlay(iconTarget, cdRemaining, B_CD_SECONDS);
}

function drawCastBar() {
  ctx.fillStyle = UI.barBg;
  drawRoundedRect(barXAdj, barY, barWidth, barHeight, 8);

  const drawFrac = barFadeActive ? barHitFraction : barFraction;
  if (drawFrac > 0) {
    ctx.fillStyle = `rgba(${barRgb}, ${barAlpha})`;
    drawRoundedRect(barXAdj, barY, barWidth * drawFrac, barHeight, 8);
  }
}

function drawTexts() {
  ctx.font = titleFont;
  ctx.fillStyle = UI.textMain;
  ctx.textAlign = 'center';
  ctx.fillText(UI.title, WIDTH / 2, HEIGHT * 0.25);

  ctx.font = msgFont;
  ctx.fillStyle = UI.textSub;
  ctx.fillText(message, WIDTH / 2, HEIGHT * 0.36);

  let text;
  if (systemState === SystemState.AWIN) {
    text = '读完咯！';
  } else if (systemState === SystemState.BWIN) {
    text = '飞到咯！';
  } else if (systemState === SystemState.PREPARE) {
    text = '准备中...';
  } else {    
    text = `游戏开始！`;
  }

  ctx.font = resultFont;
  ctx.fillStyle = UI.textResult;
  ctx.fillText(text, WIDTH / 2, HEIGHT * 0.82);

  // A/B ready 状态显示
  ctx.font = '14px "Microsoft YaHei", Arial';
  ctx.fillStyle = '#9f9';
  const aReadyMark = aReady ? '✓' : '-';
  const bReadyMark = bReady ? '✓' : '-';
  ctx.fillText(`A Ready: ${aReadyMark}    B Ready: ${bReadyMark}`, WIDTH / 2, HEIGHT * 0.88);

  ctx.font = '12px "Microsoft YaHei", Arial';
  ctx.fillStyle = '#8aa';
  const wsState = wsConnected ? `ON${wsRole ? `(${wsRole})` : ''}` : 'OFF';
  ctx.fillText(`WS: ${wsState}`, WIDTH / 2, HEIGHT * 0.93);
  // debug: show CD values
  ctx.font = '11px "Microsoft YaHei", Arial';
  ctx.fillStyle = '#c9c';
  ctx.fillText(`bCdRemaining: ${bCdRemaining.toFixed(2)}  bCdEndTime: ${bCdEndTime === null ? 'null' : bCdEndTime.toFixed(2)}`, WIDTH / 2, HEIGHT * 0.96);
}

function draw() {
  updateLogoAspect();
  if (layoutDirty) layout();

  ctx.fillStyle = UI.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const now = performance.now() / 1000;

  // Logo
  drawLogo();

  // Skill icon
  drawSkillIcon();

  // CD
  drawCooldownOverlays(now);

  // Text
  drawTexts();

  // Cast bar
  drawCastBar();
}
// #endregion



function gameLoop() {
  SystemUpdate();
  draw();
  requestAnimationFrame(gameLoop);
}

// Start rendering loop
gameLoop();

// Note: connectWS() is invoked when user clicks "加入" or when a room is provided via URL.
gameLoop();
