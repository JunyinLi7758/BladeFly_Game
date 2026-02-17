// game_2players.js
import { Assets, initImages, setSkillIcon } from './assets.js';
import { preloadAllSounds, unlockAudio, playSound, stopSound } from './audio.js';

// #region  0) 基本常量与画布（canvas / resize / layout缓存）==========
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
  title: '剑飞模拟器 v1.7'
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
let uiShiftY = 0;

function layout() {
  // 主界面整体下移量（可按需调整）
  uiShiftY = Math.max(0, Math.min(HEIGHT * 0.0, 90));

  iconSize = Math.min(WIDTH * 0.15, 100);
  iconX = (WIDTH - iconSize) / 2;
  iconY = HEIGHT * 0.62 + uiShiftY;

  titleSize  = Math.max(24, WIDTH * 0.06);
  msgSize    = Math.max(16, WIDTH * 0.04);
  resultSize = Math.max(16, WIDTH * 0.04);

  barWidth  = Math.min(BAR_WIDTH_MAX, WIDTH * 0.8);
  barHeight = Math.max(20, HEIGHT * 0.08);
  barY = HEIGHT * 0.47 + uiShiftY;

  const barX = (WIDTH - BAR_WIDTH_MAX) / 2;
  barXAdj = barX - (barWidth - BAR_WIDTH_MAX) / 2;

  logoHeight = Math.min(HEIGHT * 0.15, 80);
  logoWidth = logoHeight * logoAspect;
  logoX = (WIDTH - logoWidth) / 2;
  logoY = HEIGHT * 0.05 + uiShiftY;

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



// #region  1) 职业选择系统（JOBS / currentJob / setJob / getCdSeconds）==========
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



// #region  2) 资源初始化（图片/音效预加载） ==========
initImages();
setSkillIcon(currentJob.icon);
skillIconInitialized = Boolean(Assets.skillImg && Assets.skillImg.src);
setTimeout(ensureSkillIcon, 0);
preloadAllSounds();
// #endregion



// #region  3) 游戏状态机 与 初始变量 ======
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

const BWinReason = {
  INTERRUPT: 'INTERRUPT',
  TIMEOUT: 'TIMEOUT'
};

let systemState = SystemState.IDLE;
let aState = AState.NO_CASTING;
let bState = BState.NO_CD;
let bWinReason = null;
let message = '双人对战模式';

// WS
// let ROOM_ID = (new URLSearchParams(location.search)).get('room') || 'default';

// =========================
// ROOM_ID：支持 URL 参数 + 本地保存 + JS 默认
// URL 参数示例：?room=abc 或 ?r=abc
// =========================
const ROOM_ID_JS_DEFAULT = 'default'; // ← 改成你想要的默认 roomId，比如 'room_001'

function getRoomIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('room') || params.get('r');
    return v && v.trim() ? v.trim() : '';
  } catch (e) {
    return '';
  }
}

function getInitialRoomId() {
  // 1) 优先使用 URL 参数
  const fromUrl = getRoomIdFromUrl();
  if (fromUrl) return fromUrl;

  // 2) 其次使用本地保存的上次房间号
  const saved = localStorage.getItem('roomId');
  if (saved && saved.trim()) return saved.trim();

  // 3) 否则用 JS 内置默认值
  return ROOM_ID_JS_DEFAULT;
}

const ROOM_ID_FROM_URL = Boolean(getRoomIdFromUrl());
let ROOM_ID = getInitialRoomId();

const WS_URL = `ws://${location.hostname}:8080`;
let ws = null;
let wsConnected = false;
let wsRole = null;
let roomHasA = false;
let roomHasB = false;
let roomInputEl = null;
let btnJoinRoomEl = null;
let btnLeaveRoomEl = null;
let btnSwapRoleEl = null;
let btnResetScoreEl = null;
let btnShareRoomEl = null;
let btnMinRoomPanelEl = null;
let preJoinEl = null;
let inRoomEl = null;
let roomIdLabelEl = null;
let roleValueEl = null;

// Time
let startTime = null;
let prepareStartTime = null;
let aCancelUntil = null;

// Casting
const CAST_DURATION = 0.63;
let barFraction = 0.0;
const DEFAULT_ROUND_TIMEOUT_SECONDS = 3.0;
let roundTimeoutSeconds = DEFAULT_ROUND_TIMEOUT_SECONDS;
let roundStartTime = null;
let lastInterruptElapsedMs = null;

// A/B ready flags
let aReady = false;
let bReady = false;
let swapConfirmA = false;
let swapConfirmB = false;
let aWins = 0;
let bWins = 0;

function resetScoreboardLocal() {
  aWins = 0;
  bWins = 0;
}

// COM mode flags
let aComMode = false;
let bComMode = false;

// Audio sources
let currentBarSource = null;
let currentSkillSource = null;
let currentFinishSource = null;
let currentDizzySource = null;

// B cooldown
const B_CD_SECONDS = 3.0;
let bCdEndTime = null;
let bCdRemaining = 0;
// Clock sync
let clockOffset = 0; // server_time - local_time (seconds)
let pingIntervalId = null;

async function loadSharedGameRules() {
  try {
    const res = await fetch('./game_rules.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const nextTimeout = Number(data.roundTimeoutSeconds);
    if (Number.isFinite(nextTimeout) && nextTimeout > 0) {
      roundTimeoutSeconds = nextTimeout;
    }
  } catch (e) {
    // Ignore loading failures and keep defaults.
  }
}

loadSharedGameRules();

//#endregion

//#region  4) AI 策略系统 ======
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
//#endregion

// #region  5) 玩家AB 操作函数 ======
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
  if (systemState === SystemState.IDLE || systemState === SystemState.AWIN || systemState === SystemState.BWIN || systemState === SystemState.PREPARE) {
    return;
  }
  if (wsConnected) {
    stopSound(currentSkillSource);
    currentSkillSource = playSound('skill_blade', false);
    sendInput('interrupt');
    return;
  }

  if (roundStartTime !== null) {
    lastInterruptElapsedMs = Math.max(0, (now - roundStartTime) * 1000);
  }
  if (systemState === SystemState.RUNNING && aState === AState.CASTING) {
    systemState = SystemState.BWIN;
    bWinReason = BWinReason.INTERRUPT;
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
//#endregion

//#region  6) 房间状态更新与处理函数 ======
// ====== System ======
function maybeEnterPrepare(now) {
  if ((systemState === SystemState.IDLE || systemState === SystemState.AWIN || systemState === SystemState.BWIN
  ) && aReady && bReady) {
    systemState = SystemState.PREPARE;
    prepareStartTime = now;
    roundStartTime = null;
    bWinReason = null;
    lastInterruptElapsedMs = null;
  }
}

function updatePrepare(now) {
  if (prepareStartTime === null) return;

  if (now - prepareStartTime >= 3.0) {
    systemState = SystemState.RUNNING;
    aState = AState.NO_CASTING;
    bState = BState.NO_CD;
    roundStartTime = now;
    startTime = null;
    barFraction = 0.0;
    lastInterruptElapsedMs = null;
    resetBarVisuals();
  }
  AUpdateStrategyRandom();
  BUpdateStrategyRandom();
}

function updateRoundTimeout(now) {
  if (systemState !== SystemState.RUNNING) return;
  if (roundStartTime === null) return;
  if (now - roundStartTime < roundTimeoutSeconds) return;

  systemState = SystemState.BWIN;
  bWinReason = BWinReason.TIMEOUT;
  aReady = false;
  bReady = false;
  aState = AState.NO_CASTING;
  barFraction = 0.0;

  stopSound(currentBarSource);
  currentBarSource = null;
  playDizzySound();
}

function playDizzySound() {
  unlockAudio();
  stopSound(currentDizzySource);
  currentDizzySource = playSound('DIZZY', false);
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
    updateRoundTimeout(now);
    if (systemState !== SystemState.RUNNING) return;
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
  stopSound(currentDizzySource);
  currentBarSource = null;
  currentSkillSource = null;
  currentFinishSource = null;
  currentDizzySource = null;
}
//#endregion

//#region  7) WS 通讯部分 ======
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
      roomHasA = false;
      roomHasB = false;
      swapConfirmA = false;
      swapConfirmB = false;
      systemState = SystemState.IDLE;
      aState = AState.NO_CASTING;
      bState = BState.NO_CD;
      aReady = false;
      bReady = false;
      resetScoreboardLocal();
      roundStartTime = null;
      bWinReason = null;
      lastInterruptElapsedMs = null;
      barFraction = 0.0;
      resetBarVisuals();
      updateRoomPanels();
      if (wsRole === 'A') {
        message = '你是气纯：长按读条，松开取消。';
      } else if (wsRole === 'B') {
        message = '你是剑纯：短按打断，注意冷却。';
      } else {
        message = '旁观中：等待下一局。';
      }
      return;
    }

    if (msg.type === 'role_swapped') {
      wsRole = msg.role || wsRole;
      swapConfirmA = false;
      swapConfirmB = false;
      updateRoomPanels();
      if (wsRole === 'A') {
        message = '角色已交换：你现在是气纯。';
      } else if (wsRole === 'B') {
        message = '角色已交换：你现在是剑纯。';
      }
      return;
    }

    if (msg.type === 'state') {
      const prevState = systemState;
      const prevAState = aState;
      systemState = msg.systemState;
      aState = msg.aState;
      bState = msg.bState;
      if (typeof msg.hasA === 'boolean') roomHasA = msg.hasA;
      if (typeof msg.hasB === 'boolean') roomHasB = msg.hasB;
      swapConfirmA = Boolean(msg.swapConfirmA);
      swapConfirmB = Boolean(msg.swapConfirmB);
      aReady = msg.aReady;
      bReady = msg.bReady;
      aWins = Number.isFinite(Number(msg.aWins)) ? Number(msg.aWins) : aWins;
      bWins = Number.isFinite(Number(msg.bWins)) ? Number(msg.bWins) : bWins;
      barFraction = msg.barFraction;
      bWinReason = msg.bWinReason || null;
      if (msg.lastInterruptElapsedMs === null || msg.lastInterruptElapsedMs === undefined) {
        lastInterruptElapsedMs = null;
      } else {
        const parsedLastInterruptMs = Number(msg.lastInterruptElapsedMs);
        lastInterruptElapsedMs = Number.isFinite(parsedLastInterruptMs)
          ? Math.max(0, parsedLastInterruptMs)
          : null;
      }
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

      if (prevAState !== aState && aState === AState.CASTING) {
        stopSound(currentBarSource);
        currentBarSource = playSound('bar', false);
      }

      if (prevState !== systemState) {
        if (systemState === SystemState.RUNNING) {
          roundStartTime = performance.now() / 1000;
          bWinReason = null;
          lastInterruptElapsedMs = null;
          resetBarVisuals();
        }
        if (systemState === SystemState.PREPARE) {
          roundStartTime = null;
          bWinReason = null;
          lastInterruptElapsedMs = null;
          prepareStartTime = performance.now() / 1000;
        }
        if (systemState === SystemState.IDLE) {
          roundStartTime = null;
          bWinReason = null;
          lastInterruptElapsedMs = null;
          barFraction = 0.0;
          resetBarVisuals();
          if (wsRole === 'A') {
            message = '你是气纯：点击/触屏准备，长按读条。';
          } else if (wsRole === 'B') {
            message = '你是剑纯：点击/触屏准备，短按打断。';
          } else {
            message = '旁观中：等待下一局。';
          }
        }
        if (systemState === SystemState.AWIN) {
          stopSound(currentBarSource);
          currentBarSource = null;
          stopSound(currentFinishSource);
          currentFinishSource = playSound('finish', false);
        }
        if (systemState === SystemState.BWIN && prevState === SystemState.RUNNING) {
          stopSound(currentBarSource);
          currentBarSource = null;
          if (bWinReason === BWinReason.INTERRUPT && wsRole !== 'B') {
            stopSound(currentSkillSource);
            currentSkillSource = playSound('skill_blade', false);
          }
          if (bWinReason === BWinReason.INTERRUPT) {
            showInterruptBar(performance.now() / 1000);
          }
          if (bWinReason === BWinReason.TIMEOUT) {
            playDizzySound();
          }
        }
      }
      updateRoomPanels();
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
    roomHasA = false;
    roomHasB = false;
    resetScoreboardLocal();
    lastInterruptElapsedMs = null;
    if (pingIntervalId) { clearInterval(pingIntervalId); pingIntervalId = null; }
    updateRoomPanels();
  });
}
//#endregion

//#region  8) Input: 按键与画布长按/短按逻辑 ======
let recentLongPress = 0; // seconds, used to avoid double-triggering click after long-press
let suppressGlobalInputUntil = 0;

function suppressGlobalInputBriefly() {
  suppressGlobalInputUntil = performance.now() / 1000 + 0.35;
}

function isUiControlTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest(
    '#preJoinRules, #inRoomBanner, #roomPanelAuto, .room-panel, .job-btn, button, input, label, a, select, textarea'
  ));
}

// Canvas press handling: 长按触发 A start_cast，松开触发 cancel；短按作为打断（B）或准备（A）
function setupCanvasInput() {
  if (!canvas) return;

  const LONG_MS = 250;
  let longPressTimer = null;
  let longPressFired = false;
  let audioUnlocked = false;
  let pressFromCanvas = false;

  function ensureAudioUnlocked() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    unlockAudio();
  }

  function startPress(e) {
    // 阻止触摸引发的滚动/点击
    if (e.cancelable) e.preventDefault();
    pressFromCanvas = true;
    ensureAudioUnlocked();
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
    if (!pressFromCanvas) return;
    pressFromCanvas = false;
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
  window.addEventListener('blur', () => {
    pressFromCanvas = false;
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressFired = false;
  });

  // 触摸
  canvas.addEventListener('touchstart', startPress, { passive: false });
  canvas.addEventListener('touchend', endPress);
  canvas.addEventListener('touchcancel', endPress);
}

function updateRoomPanels() {
  if (!preJoinEl || !inRoomEl) return;
  if (wsConnected && wsRole) {
    preJoinEl.style.display = 'none';
    if (inRoomEl.style.display !== 'flex') {
      inRoomEl.classList.remove('room-panel-enter');
      // force reflow to restart animation
      void inRoomEl.offsetWidth;
      inRoomEl.classList.add('room-panel-enter');
    }
    inRoomEl.style.display = 'flex';
    if (roomIdLabelEl) roomIdLabelEl.textContent = ROOM_ID || 'default';
    if (roleValueEl) {
      if (wsRole === 'A') roleValueEl.textContent = '气纯';
      else if (wsRole === 'B') roleValueEl.textContent = '剑纯';
      else roleValueEl.textContent = '旁观';
    }
    if (btnSwapRoleEl) {
      const canSwap = wsRole === 'A' || wsRole === 'B';
      btnSwapRoleEl.disabled = !canSwap;
      if (wsRole === 'A' && swapConfirmA) btnSwapRoleEl.textContent = '已确认换角';
      else if (wsRole === 'B' && swapConfirmB) btnSwapRoleEl.textContent = '已确认换角';
      else btnSwapRoleEl.textContent = '确认换角';
    }
    if (btnResetScoreEl) {
      const canResetScore = wsRole === 'A' || wsRole === 'B';
      btnResetScoreEl.disabled = !canResetScore;
      btnResetScoreEl.textContent = '清零战绩';
    }
    if (btnShareRoomEl) {
      btnShareRoomEl.disabled = false;
      btnShareRoomEl.textContent = '分享房间';
    }
    return;
  }
  preJoinEl.style.display = 'flex';
  inRoomEl.style.display = 'none';
  if (roomIdLabelEl) roomIdLabelEl.textContent = '-';
  if (roleValueEl) roleValueEl.textContent = '-';
  if (btnSwapRoleEl) {
    btnSwapRoleEl.disabled = true;
    btnSwapRoleEl.textContent = '确认换角';
  }
  if (btnResetScoreEl) {
    btnResetScoreEl.disabled = true;
    btnResetScoreEl.textContent = '清零战绩';
  }
  if (btnShareRoomEl) {
    btnShareRoomEl.disabled = true;
    btnShareRoomEl.textContent = '分享房间';
  }
}

function applyRoomPanelCollapsed(collapsed) {
  if (!inRoomEl) return;
  inRoomEl.classList.toggle('room-panel-collapsed', Boolean(collapsed));
  if (btnMinRoomPanelEl) {
    btnMinRoomPanelEl.textContent = collapsed ? '+' : '-';
    btnMinRoomPanelEl.title = collapsed ? '展开' : '最小化';
  }
}

function buildRoomShareUrl(roomId) {
  const safeRoomId = roomId && roomId.trim() ? roomId.trim() : 'default';
  const shareUrl = new URL(window.location.href);
  shareUrl.pathname = shareUrl.pathname.replace(/[^/]*$/, 'TwoPlayers.html');
  shareUrl.search = '';
  shareUrl.hash = '';
  shareUrl.searchParams.set('room', safeRoomId);
  return shareUrl.toString();
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // Fallback below.
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

// 按钮与开关绑定
window.addEventListener('DOMContentLoaded', () => {
  function ensureRoomUI() {
  // 如果 HTML 已经有了这些元素，就不重复创建
  const existInput = document.getElementById('roomIdInput');
  const existBtn = document.getElementById('btnJoinRoom');
  const existLeaveBtn = document.getElementById('btnLeaveRoom');
  const existMinBtn = document.getElementById('btnMinRoomPanel');
  const existPre = document.getElementById('preJoinRules');
  const existInRoom = document.getElementById('inRoomBanner');
  if (existInput && existBtn && existLeaveBtn && existMinBtn && existPre && existInRoom) return;

  // 容器（悬浮在左上角，避免挡住画面中央）
  const wrap = document.createElement('div');
  wrap.id = 'roomPanelAuto';
  wrap.style.cssText = `
    position: fixed; right: 10px; top: 10px; z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 12px; border-radius: 10px;
    background: rgba(0,0,0,0.55); color: #fff;
    font-family: "Microsoft YaHei", Arial; font-size: 14px;
    width: min(260px, calc(100vw - 20px));
    max-width: calc(100vw - 20px);
    backdrop-filter: blur(6px);
  `;

  // 预加入面板
  const preJoin = document.createElement('div');
  preJoin.id = 'preJoinRules';
  preJoin.style.cssText = `display:flex; align-items:center; gap:8px;`;

  const input = document.createElement('input');
  input.id = 'roomIdInput';
  input.placeholder = 'roomId';
  input.style.cssText = `
    width: 160px; padding: 6px 8px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.25);
    background: rgba(255,255,255,0.12); color: #fff; outline: none;
  `;

  const btn = document.createElement('button');
  btn.id = 'btnJoinRoom';
  btn.textContent = '加入';
  btn.style.cssText = `
    padding: 6px 10px; border-radius: 8px; border: 0;
    background: rgba(255,255,255,0.18); color: #fff; cursor: pointer;
  `;

  preJoin.appendChild(input);
  preJoin.appendChild(btn);

  // 已加入面板
  const inRoom = document.createElement('div');
  inRoom.id = 'inRoomBanner';
  inRoom.style.cssText = `display:none; flex-direction:column; gap:4px;`;

  const header = document.createElement('div');
  header.className = 'room-header';
  const title = document.createElement('div');
  title.className = 'room-title';
  title.textContent = '已进入房间';
  const btnMin = document.createElement('button');
  btnMin.id = 'btnMinRoomPanel';
  btnMin.className = 'job-btn room-min-btn';
  btnMin.textContent = '-';
  btnMin.title = '最小化';
  header.appendChild(title);
  header.appendChild(btnMin);

  const line1 = document.createElement('div');
  line1.innerHTML = `Room: <b id="roomIdLabel">-</b>`;

  const line2 = document.createElement('div');
  line2.innerHTML = `Role: <b id="roleValue">-</b>`;

  const actions = document.createElement('div');
  actions.className = 'room-actions';
  const btnSwap = document.createElement('button');
  btnSwap.id = 'btnSwapRole';
  btnSwap.textContent = '确认换角';
  btnSwap.style.cssText = `
    padding: 6px 10px; border-radius: 8px; border: 0;
    background: rgba(64,130,170,0.85); color: #fff; cursor: pointer;
  `;
  const btnResetScore = document.createElement('button');
  btnResetScore.id = 'btnResetScore';
  btnResetScore.textContent = '清零战绩';
  btnResetScore.style.cssText = `
    padding: 6px 10px; border-radius: 8px; border: 0;
    background: rgba(190,130,40,0.9); color: #fff; cursor: pointer;
  `;
  const btnShareRoom = document.createElement('button');
  btnShareRoom.id = 'btnShareRoom';
  btnShareRoom.textContent = '分享房间';
  btnShareRoom.style.cssText = `
    padding: 6px 10px; border-radius: 8px; border: 0;
    background: rgba(80,160,95,0.9); color: #fff; cursor: pointer;
  `;
  const btnLeave = document.createElement('button');
  btnLeave.id = 'btnLeaveRoom';
  btnLeave.textContent = '退出房间';
  btnLeave.style.cssText = `
    padding: 6px 10px; border-radius: 8px; border: 0;
    background: rgba(200,80,80,0.8); color: #fff; cursor: pointer;
  `;
  actions.appendChild(btnSwap);
  actions.appendChild(btnResetScore);
  actions.appendChild(btnShareRoom);
  actions.appendChild(btnLeave);

  inRoom.appendChild(header);
  inRoom.appendChild(line1);
  inRoom.appendChild(line2);
  inRoom.appendChild(actions);

  wrap.appendChild(preJoin);
  wrap.appendChild(inRoom);

  document.body.appendChild(wrap);
}

  ensureRoomUI();

  roomInputEl = document.getElementById('roomIdInput');
  btnJoinRoomEl = document.getElementById('btnJoinRoom');
  btnLeaveRoomEl = document.getElementById('btnLeaveRoom');
  btnSwapRoleEl = document.getElementById('btnSwapRole');
  btnResetScoreEl = document.getElementById('btnResetScore');
  btnShareRoomEl = document.getElementById('btnShareRoom');
  btnMinRoomPanelEl = document.getElementById('btnMinRoomPanel');
  preJoinEl = document.getElementById('preJoinRules');
  inRoomEl = document.getElementById('inRoomBanner');
  roomIdLabelEl = document.getElementById('roomIdLabel');
  roleValueEl = document.getElementById('roleValue');

  // 兜底：旧页面/重复 DOM 时，确保“当前 inRoomBanner”里一定有退出按钮。
  if (inRoomEl) {
    let leaveBtnInBanner = inRoomEl.querySelector('#btnLeaveRoom');
    if (!leaveBtnInBanner) {
      let actions = inRoomEl.querySelector('.room-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'room-actions';
        inRoomEl.appendChild(actions);
      }
      const btn = document.createElement('button');
      btn.id = 'btnLeaveRoom';
      btn.className = 'job-btn room-exit-btn';
      btn.textContent = '退出房间';
      btn.style.display = 'inline-block';
      btn.style.visibility = 'visible';
      actions.appendChild(btn);
      leaveBtnInBanner = btn;
    }
    btnLeaveRoomEl = leaveBtnInBanner;
    let swapBtnInBanner = inRoomEl.querySelector('#btnSwapRole');
    if (!swapBtnInBanner) {
      let actions = inRoomEl.querySelector('.room-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'room-actions';
        inRoomEl.appendChild(actions);
      }
      const btn = document.createElement('button');
      btn.id = 'btnSwapRole';
      btn.className = 'job-btn room-swap-btn';
      btn.textContent = '确认换角';
      actions.insertBefore(btn, actions.firstChild);
      swapBtnInBanner = btn;
    }
    btnSwapRoleEl = swapBtnInBanner;
    let resetScoreBtnInBanner = inRoomEl.querySelector('#btnResetScore');
    if (!resetScoreBtnInBanner) {
      let actions = inRoomEl.querySelector('.room-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'room-actions';
        inRoomEl.appendChild(actions);
      }
      const btn = document.createElement('button');
      btn.id = 'btnResetScore';
      btn.className = 'job-btn room-reset-btn';
      btn.textContent = '清零战绩';
      actions.insertBefore(btn, btnLeaveRoomEl || null);
      resetScoreBtnInBanner = btn;
    }
    btnResetScoreEl = resetScoreBtnInBanner;
    let shareRoomBtnInBanner = inRoomEl.querySelector('#btnShareRoom');
    if (!shareRoomBtnInBanner) {
      let actions = inRoomEl.querySelector('.room-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'room-actions';
        inRoomEl.appendChild(actions);
      }
      const btn = document.createElement('button');
      btn.id = 'btnShareRoom';
      btn.className = 'job-btn room-share-btn';
      btn.textContent = '分享房间';
      actions.insertBefore(btn, btnLeaveRoomEl || null);
      shareRoomBtnInBanner = btn;
    }
    btnShareRoomEl = shareRoomBtnInBanner;
    roomIdLabelEl = inRoomEl.querySelector('#roomIdLabel') || roomIdLabelEl;
    roleValueEl = inRoomEl.querySelector('#roleValue') || roleValueEl;
    if (!btnMinRoomPanelEl) {
      let header = inRoomEl.querySelector('.room-header');
      if (!header) {
        header = document.createElement('div');
        header.className = 'room-header';
        const title = document.createElement('div');
        title.className = 'room-title';
        title.textContent = '已进入房间';
        header.appendChild(title);
        inRoomEl.insertBefore(header, inRoomEl.firstChild);
      }
      const btn = document.createElement('button');
      btn.id = 'btnMinRoomPanel';
      btn.className = 'job-btn room-min-btn';
      btn.textContent = '-';
      btn.title = '最小化';
      header.appendChild(btn);
      btnMinRoomPanelEl = btn;
    }
  }
  console.log('[room-ui] inRoomBanner:', Boolean(inRoomEl), 'leaveBtn:', Boolean(btnLeaveRoomEl));

  const savedRoomPanelCollapsed = localStorage.getItem('roomPanelCollapsed') === '1';
  applyRoomPanelCollapsed(savedRoomPanelCollapsed);

  // 初始化房间输入值
  if (roomInputEl) roomInputEl.value = ROOM_ID || 'default';
  if (ROOM_ID_FROM_URL && ROOM_ID) {
    localStorage.setItem('roomId', ROOM_ID);
  }
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
    localStorage.setItem('roomId', ROOM_ID);

    connectWS();
  }

  function leaveRoom() {
    if (ws) {
      try {
        ws.close();
      } catch (e) { /* ignore */ }
      ws = null;
    }
    wsConnected = false;
    wsRole = null;
    systemState = SystemState.IDLE;
    aState = AState.NO_CASTING;
    bState = BState.NO_CD;
    aReady = false;
    bReady = false;
    swapConfirmA = false;
    swapConfirmB = false;
    resetScoreboardLocal();
    roundStartTime = null;
    bWinReason = null;
    lastInterruptElapsedMs = null;
    barFraction = 0.0;
    resetBarVisuals();
    stopAllSounds();
    message = '2P mode';
    updateRoomPanels();
  }

  if (btnJoinRoomEl) {
    btnJoinRoomEl.addEventListener('click', () => {
      suppressGlobalInputBriefly();
      const v = (roomInputEl && roomInputEl.value) ? roomInputEl.value.trim() : '';
      joinRoomById(v);
    });
  }
  if (btnLeaveRoomEl) {
    btnLeaveRoomEl.addEventListener('click', () => {
      suppressGlobalInputBriefly();
      leaveRoom();
    });
  }
  if (btnSwapRoleEl) {
    btnSwapRoleEl.addEventListener('click', () => {
      suppressGlobalInputBriefly();
      if (!wsConnected) return;
      if (wsRole !== 'A' && wsRole !== 'B') return;
      sendInput('swap_confirm');
      if (wsRole === 'A') swapConfirmA = true;
      if (wsRole === 'B') swapConfirmB = true;
      message = '已确认换角，等待对方确认...';
      updateRoomPanels();
    });
  }
  if (btnResetScoreEl) {
    btnResetScoreEl.addEventListener('click', () => {
      suppressGlobalInputBriefly();
      if (!wsConnected) return;
      if (wsRole !== 'A' && wsRole !== 'B') return;
      sendInput('reset_stats');
      resetScoreboardLocal();
      message = '战绩已清零。';
      updateRoomPanels();
    });
  }
  if (btnShareRoomEl) {
    btnShareRoomEl.addEventListener('click', async () => {
      suppressGlobalInputBriefly();
      const shareUrl = buildRoomShareUrl(ROOM_ID);
      const copied = await copyTextToClipboard(shareUrl);
      if (copied) {
        message = '房间链接已复制，可直接发送给好友。';
      } else {
        message = `复制失败，请手动复制：${shareUrl}`;
      }
      updateRoomPanels();
    });
  }
  if (btnMinRoomPanelEl) {
    btnMinRoomPanelEl.addEventListener('click', () => {
      suppressGlobalInputBriefly();
      const nextCollapsed = !inRoomEl.classList.contains('room-panel-collapsed');
      applyRoomPanelCollapsed(nextCollapsed);
      localStorage.setItem('roomPanelCollapsed', nextCollapsed ? '1' : '0');
    });
  }

  // 若通过 URL 指定房间，或已有非 default 的房间号，则自动加入
  if ((ROOM_ID_FROM_URL && ROOM_ID) || (ROOM_ID && ROOM_ID !== 'default')) {
    connectWS();
  }

  // no external control buttons — use canvas/touch/keyboard inputs
  setupCanvasInput();
  updateRoomPanels();
});

// 键盘快捷键：单击准备 a/j，取消 d，打断 k
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const now = performance.now() / 1000;

  // if (e.key === '1') {
  //   ASetComMode(!aComMode);
  // }
  // if (e.key === '2') {
  //   BSetComMode(!bComMode);
  // }

  // if (!aComMode) {
  //   if (e.key === 'a' || e.key === 'j') AReady();
  //   if (e.key === 'd') ACancelCasting(now);
  // }

  // if (!bComMode) {
  //   if (e.key === 'k') BInterrupt(now);
  // }
});

// 屏幕任意点击也能进入准备（但忽略按钮/输入上的点击；并避免与长按冲突）
let lastGlobalReadyTime = 0;
function tryGlobalReady(e, isTouch = false) {
  const now = performance.now() / 1000;
  if (now < suppressGlobalInputUntil) return;
  if (e && isUiControlTarget(e.target)) return;
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
//#endregion

//#region 9) 画布========
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

function getBcdRemaining(nowSec) {
  if (bCdEndTime === null) return 0.0;
  const adjustedNow = nowSec + clockOffset;
  return Math.max(0, Math.min(B_CD_SECONDS, bCdEndTime - adjustedNow));
}

function drawCooldownOverlays(now) {
  const iconTarget = { x: iconX, y: iconY, size: iconSize };

  // Use epoch time when connected (server sends epoch seconds), otherwise use performance time
  let cdRemaining = 0.0;
  if (wsConnected) {
    cdRemaining = getBcdRemaining(Date.now() / 1000);
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
  ctx.fillText(UI.title, WIDTH / 2, HEIGHT * 0.25 + uiShiftY);

  ctx.font = msgFont;
  ctx.fillStyle = UI.textSub;
  ctx.fillText(message, WIDTH / 2, HEIGHT * 0.36 + uiShiftY);
  let subHint = '';
  if (wsConnected && wsRole && systemState === SystemState.IDLE) {
    if (wsRole === 'S') subHint = '房间已满，当前为旁观';
    else if (roomHasA && roomHasB) subHint = '人已集齐，点击屏幕准备';
    else subHint = '等待玩家进入...';
  }
  if (wsConnected && (swapConfirmA || swapConfirmB)) {
    const aMark = swapConfirmA ? '✓' : '-';
    const bMark = swapConfirmB ? '✓' : '-';
    subHint = `换角确认 气纯:${aMark} 剑纯:${bMark}`;
  }
  if (subHint) {
    ctx.font = '12px "Microsoft YaHei", Arial';
    ctx.fillStyle = '#a7a7a7';
    ctx.fillText(subHint, WIDTH / 2, HEIGHT * 0.41 + uiShiftY);
  }

  let text;
  const interruptMsText = (lastInterruptElapsedMs !== null)
    ? lastInterruptElapsedMs.toFixed(2)
    : null;
  if (systemState === SystemState.AWIN) {
    if (interruptMsText !== null) {
      text = `剑纯${interruptMsText}ms（剑飞时间）没有飞到`;
    } else {
      text = '读完咯！';
    }
  } else if (systemState === SystemState.BWIN) {
    if (bWinReason === BWinReason.TIMEOUT) {
      text = '骗也没用 还不是要吃剑冲';
    } else {
      text = interruptMsText !== null ? `剑飞成功时间 ${interruptMsText}ms` : '剑飞成功';
    }
  } else if (systemState === SystemState.PREPARE) {
    let remaining = 3;
    if (prepareStartTime !== null) {
      remaining = Math.max(0, 3 - (performance.now() / 1000 - prepareStartTime));
    }
    text = `准备倒计时：${Math.ceil(remaining)}秒`;
  } else if (systemState === SystemState.RUNNING) {
    let remaining = roundTimeoutSeconds;
    if (roundStartTime !== null) {
      remaining = Math.max(0, roundTimeoutSeconds - (performance.now() / 1000 - roundStartTime));
    }
    text = `生太极免控：${remaining.toFixed(1)}`;
  } else {    
    text = `游戏开始！`;
  }

  if (systemState === SystemState.PREPARE) {
    const bigSize = Math.max(resultSize * 1.2, 36);
    const prepareTextY = Math.max(36, barY - 12);
    ctx.font = `bold ${bigSize}px "Microsoft YaHei", Arial`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#ffd95a';
    ctx.strokeText(text, WIDTH / 2, prepareTextY);
    ctx.fillText(text, WIDTH / 2, prepareTextY);
  } else {
    ctx.font = resultFont;
    ctx.fillStyle = UI.textResult;
    ctx.fillText(text, WIDTH / 2, HEIGHT * 0.82 + uiShiftY);
  }

  // A/B ready 状态显示
  ctx.font = '18px "Microsoft YaHei", Arial';
  ctx.fillStyle = '#9f9';
  const aReadyMark = aReady ? '✓' : '-';
  const bReadyMark = bReady ? '✓' : '-';
  ctx.fillText(`气纯 Ready: ${aReadyMark}    剑纯 Ready: ${bReadyMark}`, WIDTH / 2, HEIGHT * 0.88 + uiShiftY);

  const aLosses = bWins;
  const bLosses = aWins;
  ctx.fillStyle = '#cfcfcf';
  ctx.fillText(`战绩  气纯 ${aWins}胜${aLosses}负    剑纯 ${bWins}胜${bLosses}负`, WIDTH / 2, HEIGHT * 0.92 + uiShiftY);

  // ctx.font = '12px "Microsoft YaHei", Arial';
  // ctx.fillStyle = '#8aa';
  // const wsState = wsConnected ? `ON${wsRole ? `(${wsRole})` : ''}` : 'OFF';
  // ctx.fillText(`WS: ${wsState}`, WIDTH / 2, HEIGHT * 0.93 + uiShiftY);
  // // debug: show CD values
  // ctx.font = '11px "Microsoft YaHei", Arial';
  // ctx.fillStyle = '#c9c';
  // ctx.fillText(`bCdRemaining: ${bCdRemaining.toFixed(2)}  bCdEndTime: ${bCdEndTime === null ? 'null' : bCdEndTime.toFixed(2)}`, WIDTH / 2, HEIGHT * 0.96 + uiShiftY);
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
