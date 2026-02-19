// game.js
import { Assets, initImages, setSkillIcon } from './assets.js';
import { preloadAllSounds, unlockAudio, playSound, stopSound } from './audio.js';


// #region ========== 0) 基本常量与画布（canvas / resize / layout缓存） ==========
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
  title: '折磨气纯模拟器v1.6'
};

let barRgb = BAR_COLOR_NORMAL;
let barAlpha = 1.0;
let barFadeActive = false;
let barFadeStartTime = 0;
const BAR_FADE_DURATION = 0.4;
let barHitFraction = 0.0;
let resultImpactType = null;
let resultImpactStartTime = 0;
const RESULT_IMPACT_DURATION = {
  timeout: 0.58,
  interrupt: 0.72,
  awin: 0.72
};

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



// #region ========== 1) 职业系统（JOBS / currentJob / setJob / getCdSeconds） ==========
const JOBS = {
  Blade:  { name: '剑纯', skillname: '剑飞惊天', icon: 'img/icon_blade.png',  skillSound: 'skill_blade',  cd: 3.0 },
  Flower: { name: '万花', skillname: '厥阴指',   icon: 'img/icon_flower.png', skillSound: 'skill_flower', cd: 3.0 },
  Toxic:  { name: '五毒', skillname: '灵蛊',     icon: 'img/icon_toxic.png',  skillSound: 'skill_toxic',  cd: 3.0 },
};

let currentJobKey = 'Blade';
let currentJob = JOBS[currentJobKey];

function getCdSeconds() {
  return (currentJob && typeof currentJob.cd === 'number') ? currentJob.cd : 3.0;
}

function setJob(jobKey) {
  if (!JOBS[jobKey]) return;
  currentJobKey = jobKey;
  currentJob = JOBS[jobKey];
  setSkillIcon(currentJob.icon);
  message = `已切换为 ${currentJob.name}，点击屏幕开始！`;
}
// #endregion



// #region ========== 2) 资源初始化（图片/音效预加载） ==========
initImages();
setSkillIcon(currentJob.icon);
preloadAllSounds();
// #endregion



// #region ========== 3) 游戏状态机（状态变量集中定义） ==========
let state = "IDLE"; // IDLE / PREPARE / RUNNING / TOO_EARLY / SAFE RUNNING / RESULT
let waitUntil = null;
let signalTime = null;
let startTime = null;

let reactionTime = null;
let lastReactionMs = null;

let barFraction = 0.0;
let selfbreak = 0;
let bladeflycdEndTime = null;

let message = "有本事断我看看？~ 点击屏幕开始";

let currentBarSource = null;
let currentSkillSource = null;

const BREAKBAR_API_URL = `http://${location.hostname || 'localhost'}:8080/api/breakbar/leaderboard`;
const BATCH_TEST_ROUNDS = 4;
const BATCH_NEXT_ROUND_DELAY = 3.0;
let batchTestActive = false;
let batchNextRoundAt = null;
let batchResults = [];
let batchSummary = null;
let leaderboardEls = null;
let saveInFlight = false;
// #endregion



// #region ========== 4) 输入事件（键盘/鼠标/触屏 + 职业按钮） ==========

window.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    state = "IDLE";
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    await handleAction();
  }
});

canvas.addEventListener('click', async () => {
  await handleAction();
});

canvas.addEventListener('touchstart', async (e) => {
  e.preventDefault();
  await handleAction();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
}, { passive: false });

// 职业按钮绑定
try {
  const jobButtons = document.querySelectorAll('.job-btn');
  jobButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const jobKey = btn.getAttribute('data-job');
      if (!JOBS[jobKey]) return;

      // 只允许在 IDLE/RESULT/TOO_EARLY 状态切职业
      if (state !== 'IDLE' && state !== 'RESULT' && state !== 'TOO_EARLY') {
        message = '战斗中不能换职业哦~';
        return;
      }

      setJob(jobKey);

      jobButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelector(`.job-btn[data-job="${currentJobKey}"]`)?.classList.add('active');
} catch (e) {
  console.warn('事件绑定失败', e);
}
// #endregion



// #region ========== 5) 动作处理（原 handleSpaceKey：统一入口 handleAction） ==========

function AResetBarVisuals() {
  barRgb = BAR_COLOR_NORMAL;
  barAlpha = 1.0;
  barFadeActive = false;
  barHitFraction = 0;
}

function startResultImpact(type, now) {
  resultImpactType = type;
  resultImpactStartTime = now;
}

function AStartPrepare(now) {
  AResetBarVisuals();

  barFraction = 0;
  reactionTime = null;

  signalTime = null;
  startTime = null;

  const delay = Math.random() * 2.0 + 1.0; // 1~3秒
  waitUntil = now + delay;
  message = "准备中...";
  state = "PREPARE";
}

function BStartTooEarly(now) {
  state = "TOO_EARLY";
  bladeflycdEndTime = now + getCdSeconds();
  playSkillOnce();
  message = "骗你到了吧~  菜，就多练！ ";
  waitUntil = now + 0.4;
}

function AHandleBreak(now) {
  stopSound(currentBarSource);
  currentBarSource = null;

  playSkillOnce();

  reactionTime = now - signalTime;
  lastReactionMs = Math.round(reactionTime * 1000);

  bladeflycdEndTime = now + getCdSeconds();
  message = "好断，哥们儿好断! 点屏幕再来！";

  barHitFraction = Math.max(0, Math.min(1, barFraction));
  barRgb = BAR_COLOR_HIT;
  barAlpha = 1.0;
  barFadeActive = true;
  barFadeStartTime = now;
  startResultImpact('interrupt', now);
  onRoundFinished(true, reactionTime * 1000, now);

  state = "RESULT";
}

async function handleAction() {
  const now = performance.now() / 1000;

  // 首次交互解锁音频（移动端必需）
  await unlockAudio();

  // CD 中：只提示
  if (bladeflycdEndTime !== null && now < bladeflycdEndTime) {
    const remain = (bladeflycdEndTime - now).toFixed(1);
    message = `别急，${currentJob.skillname}还在cd，剩余 ${remain} 秒。`;
    return;
  }

  // 已完成：开始新一轮
  if (state === "IDLE" || state === "RESULT" || state === "TOO_EARLY") {
    AStartPrepare(now);
    return;
  }

  // PREPARE：抢跑
  if (state === "PREPARE") {
    BStartTooEarly(now);
    return;
  }

  // RUNNING：成功打断
  if (state === "RUNNING") {
    AHandleBreak(now);
    return;
  }

  // SAFE RUNNING：无效点击（不做事）
}
// #endregion


function summarizeBatchResults(results) {
  const successCount = results.filter((item) => item.success).length;
  const successRate = successCount / BATCH_TEST_ROUNDS;
  const successTimes = results.filter((item) => item.success).map((item) => item.timeMs);
  const avgSuccessMs = successTimes.length
    ? successTimes.reduce((sum, value) => sum + value, 0) / successTimes.length
    : null;
  return {
    totalRounds: BATCH_TEST_ROUNDS,
    successCount,
    successRate,
    avgSuccessMs
  };
}

function formatBatchSummary(summary) {
  if (!summary) return '当前测试：--';
  const rateText = `${(summary.successRate * 100).toFixed(1)}%`;
  const avgText = summary.avgSuccessMs === null ? '--' : `${summary.avgSuccessMs.toFixed(1)} ms`;
  return `4次测试：成功率 ${rateText}，平均成功时间 ${avgText}`;
}

function updateCurrentSummaryLabel() {
  if (!leaderboardEls || !leaderboardEls.currentTimeLabel) return;
  leaderboardEls.currentTimeLabel.textContent = formatBatchSummary(batchSummary);
}

function updateBatchButtonState() {
  if (!leaderboardEls || !leaderboardEls.batchTestBtn) return;
  if (batchTestActive) {
    leaderboardEls.batchTestBtn.disabled = false;
    leaderboardEls.batchTestBtn.textContent = `测试中 ${batchResults.length}/${BATCH_TEST_ROUNDS}（点击重开）`;
  } else {
    leaderboardEls.batchTestBtn.disabled = false;
    leaderboardEls.batchTestBtn.textContent = '4次连续测试';
  }
}

function startBatchTest() {
  const now = performance.now() / 1000;
  stopSound(currentBarSource);
  currentBarSource = null;
  bladeflycdEndTime = null;
  state = "IDLE";
  batchTestActive = true;
  batchNextRoundAt = null;
  batchResults = [];
  batchSummary = null;
  updateCurrentSummaryLabel();
  updateBatchButtonState();
  AStartPrepare(now);
}

function onRoundFinished(success, timeMs, now) {
  if (!batchTestActive) return;
  batchResults.push({ success: Boolean(success), timeMs: success ? Number(timeMs) : null });
  updateBatchButtonState();

  if (batchResults.length >= BATCH_TEST_ROUNDS) {
    batchTestActive = false;
    batchNextRoundAt = null;
    batchSummary = summarizeBatchResults(batchResults);
    message = `测试完成：${formatBatchSummary(batchSummary)}。可输入用户名保存。`;
    updateCurrentSummaryLabel();
    updateBatchButtonState();
    openLeaderboard().then(() => {
      if (leaderboardEls && leaderboardEls.playerNameInput) {
        leaderboardEls.playerNameInput.focus();
      }
    }).catch(() => {});
    return;
  }

  batchNextRoundAt = now + BATCH_NEXT_ROUND_DELAY;
}

function normalizeLeaderboardEntry(entry) {
  const successRate = Number(entry.successRate);
  const avgRaw = entry.avgSuccessMs === null || entry.avgSuccessMs === undefined ? null : Number(entry.avgSuccessMs);
  return {
    rank: Number(entry.rank),
    name: String(entry.name || ''),
    successRate: Number.isFinite(successRate) ? Math.max(0, Math.min(1, successRate)) : 0,
    avgSuccessMs: Number.isFinite(avgRaw) && avgRaw > 0 ? avgRaw : null,
    successCount: Number.isFinite(Number(entry.successCount)) ? Number(entry.successCount) : 0,
    totalRounds: Number.isFinite(Number(entry.totalRounds)) ? Number(entry.totalRounds) : 0
  };
}

function renderLeaderboard(entries) {
  if (!leaderboardEls || !leaderboardEls.list) return;
  leaderboardEls.list.innerHTML = '';
  leaderboardEls.list.style.maxHeight = '360px';
  leaderboardEls.list.style.overflowY = 'auto';
  leaderboardEls.list.style.overflowX = 'hidden';
  leaderboardEls.list.style.paddingRight = '2px';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'leaderboard-item';
    empty.textContent = '暂无记录';
    leaderboardEls.list.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '13px';
  table.style.tableLayout = 'fixed';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['名次', '用户名', '成功率', '平均成功时间'].forEach((title, colIdx) => {
    const th = document.createElement('th');
    th.textContent = title;
    th.style.textAlign = 'center';
    th.style.padding = '8px 6px';
    th.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
    th.style.color = '#ddd';
    th.style.position = 'sticky';
    th.style.top = '0';
    th.style.background = '#1f1f1f';
    th.style.zIndex = '1';
    if (colIdx === 0) {
      th.style.width = '54px';
      th.style.maxWidth = '54px';
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  entries.forEach((rawEntry, idx) => {
    const entry = normalizeLeaderboardEntry(rawEntry);
    const rateText = `${(entry.successRate * 100).toFixed(1)}%`;
    const avgText = entry.avgSuccessMs === null ? '--' : `${entry.avgSuccessMs.toFixed(1)} ms`;

    const tr = document.createElement('tr');
    if (idx % 2 === 1) {
      tr.style.background = 'rgba(255,255,255,0.04)';
    }
    [String(entry.rank), entry.name, rateText, avgText].forEach((cellText, colIdx) => {
      const td = document.createElement('td');
      td.textContent = cellText;
      td.style.textAlign = 'center';
      td.style.padding = '7px 6px';
      td.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
      td.style.color = '#cfcfcf';
      if (colIdx === 0) {
        td.style.width = '54px';
        td.style.maxWidth = '54px';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  leaderboardEls.list.appendChild(table);
}

async function fetchLeaderboard() {
  const res = await fetch(`${BREAKBAR_API_URL}?limit=100`, { method: 'GET' });
  if (!res.ok) throw new Error(`加载排行榜失败 (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

async function openLeaderboard() {
  if (!leaderboardEls) return;
  leaderboardEls.overlay.classList.remove('hidden');
  leaderboardEls.overlay.setAttribute('aria-hidden', 'false');
  try {
    const entries = await fetchLeaderboard();
    renderLeaderboard(entries);
  } catch (e) {
    renderLeaderboard([]);
    message = e.message || '排行榜加载失败';
  }
}

function closeLeaderboard() {
  if (!leaderboardEls) return;
  leaderboardEls.overlay.classList.add('hidden');
  leaderboardEls.overlay.setAttribute('aria-hidden', 'true');
}

function updateSaveButtonState() {
  if (!leaderboardEls || !leaderboardEls.saveBtn) return;
  leaderboardEls.saveBtn.disabled = saveInFlight;
  leaderboardEls.saveBtn.textContent = saveInFlight ? '保存中...' : '保存记录';
}

async function saveBatchSummary() {
  if (!leaderboardEls) return;
  if (saveInFlight) return;
  if (!batchSummary) {
    message = '请先完成4次连续测试。';
    return;
  }

  const name = leaderboardEls.playerNameInput.value.trim();
  if (!name) {
    message = '请输入用户名后再保存。';
    return;
  }

  const payload = {
    name,
    successRate: batchSummary.successRate,
    avgSuccessMs: batchSummary.avgSuccessMs,
    totalRounds: batchSummary.totalRounds,
    successCount: batchSummary.successCount
  };

  saveInFlight = true;
  updateSaveButtonState();
  try {
    const res = await fetch(BREAKBAR_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(`保存失败 (${res.status})`);
    }
    const data = await res.json();
    renderLeaderboard(Array.isArray(data.entries) ? data.entries : []);
    message = '成绩已保存到排行榜。';
    closeLeaderboard();
  } finally {
    saveInFlight = false;
    updateSaveButtonState();
  }
}

function setupLeaderboardUI() {
  const leaderboardBtn = document.getElementById('leaderboardBtn');
  const overlay = document.getElementById('leaderboardOverlay');
  const list = document.getElementById('leaderboardList');
  const closeBtn = document.getElementById('closeLeaderboardBtn');
  const saveBtn = document.getElementById('saveScoreBtn');
  const clearBtn = document.getElementById('clearLeaderboardBtn');
  const playerNameInput = document.getElementById('playerNameInput');
  const currentTimeLabel = document.getElementById('currentTimeLabel');
  if (!leaderboardBtn || !overlay || !list || !closeBtn || !saveBtn || !playerNameInput || !currentTimeLabel) return;

  leaderboardBtn.textContent = '排行榜';
  closeBtn.textContent = '关闭';
  saveBtn.textContent = '保存记录';
  if (clearBtn) {
    clearBtn.style.display = 'none';
  }

  let batchTestBtn = document.getElementById('batchTestBtn');
  if (!batchTestBtn) {
    batchTestBtn = document.createElement('button');
    batchTestBtn.id = 'batchTestBtn';
    batchTestBtn.textContent = '4次连续测试(计入排行榜）';
    batchTestBtn.style.cssText = `
      position: fixed;
      top: 52px;
      right: 10px;
      z-index: 20;
      background: rgba(0,0,0,0.6);
      color: #fff;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
    `;
    document.body.appendChild(batchTestBtn);
  }

  leaderboardEls = {
    overlay,
    list,
    closeBtn,
    saveBtn,
    playerNameInput,
    currentTimeLabel,
    batchTestBtn
  };

  updateCurrentSummaryLabel();
  updateBatchButtonState();
  updateSaveButtonState();

  leaderboardBtn.addEventListener('click', () => {
    openLeaderboard();
  });
  closeBtn.addEventListener('click', () => {
    closeLeaderboard();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeLeaderboard();
  });
  saveBtn.addEventListener('click', async () => {
    if (saveInFlight) return;
    try {
      await saveBatchSummary();
    } catch (e) {
      message = e.message || '保存失败';
    }
  });
  batchTestBtn.addEventListener('click', () => {
    if (batchTestActive) {
      message = '已重开4次连续测试。';
    }
    startBatchTest();
  });
}



// #region ========== 6) 逻辑更新（SystemUpdate：推进状态机/读条/自断/超时/淡出） ==========
function playSkillOnce() {
  if (!currentJob.skillSound) return;
  stopSound(currentSkillSource);
  currentSkillSource = playSound(currentJob.skillSound, false);
}

function SystemStartRunning(now) {
  stopSound(currentBarSource);
  currentBarSource = playSound('bar', false);

  state = "RUNNING";
  signalTime = now;
  startTime = now;

  barFraction = 0.0;
  selfbreak = Math.random() * 1.4 + 0.1;

  // 让区间更友好
  if (selfbreak >= 0.8 && selfbreak <= 1.1) selfbreak = 1.1;
}

function SystemStartSafeRunning(now) {
  stopSound(currentBarSource);
  currentBarSource = playSound('bar', false);

  signalTime = now;
  startTime = now;
  barFraction = 0.0;
  selfbreak = 2.0;
  state = "SAFE RUNNING";
}

function SystemUpdatePrepare(now) {
  if (bladeflycdEndTime !== null && bladeflycdEndTime > now) {
    const remain = (bladeflycdEndTime - now).toFixed(1);
    message = `等待${currentJob.skillname.slice(0, 2)}冷却 ${remain} 秒，随后开始读条...`;
  } else {
    message = "准备好…… 我要生太极咯~ ...";
  }

  if (now >= waitUntil) {
    SystemStartRunning(now);
  }
}

function SystemUpdateTooEarly(now) {
  if (now >= waitUntil) {
    SystemStartSafeRunning(now);
  }
}

function SystemUpdateRunning(now) {
  const elapsed = now - startTime;
  let frac = elapsed / BAR_DURATION;

  if (state === "SAFE RUNNING") {
    message = `没${currentJob.skillname.slice(0,2)}了吧？美美生太极${elapsed.toFixed(2)} /0.56`;
  } else {
    message = `生太极${elapsed.toFixed(2)} /0.56`;
  }

  // 自断
  if (frac >= selfbreak) {
    stopSound(currentBarSource);
    currentBarSource = null;

    const delay = Math.random() * 0.6 + 0.2;
    waitUntil = now + delay;
    message = `在${elapsed.toFixed(2)}秒时，哥们自断了！~`;
    frac = 0.0;
    state = "PREPARE";
  }

  // 超时
  if (frac >= 1.0) {
    frac = 1.0;

    if (reactionTime === null) {
      stopSound(currentBarSource);
      currentBarSource = null;

      playSound('finish');

      if (state !== "SAFE RUNNING") {
        message = `这都${currentJob.skillname.slice(0, 2)}不到？菜，就多练 \\(^o^)/~ 再来？`;
      } else {
        message = "自断就上钩？菜，就多练 \\(^o^)/~ 再来？";
      }

      startResultImpact('awin', now);
      onRoundFinished(false, null, now);
      state = "RESULT";
      reactionTime = null;
    }
  }

  barFraction = frac;
}

function SystemUpdate() {
  const now = performance.now() / 1000;

  if (bladeflycdEndTime !== null && now >= bladeflycdEndTime) {
    bladeflycdEndTime = null;
  }

  if (batchTestActive && batchNextRoundAt !== null && now >= batchNextRoundAt) {
    batchNextRoundAt = null;
    if (state === "RESULT" || state === "TOO_EARLY" || state === "IDLE") {
      AStartPrepare(now);
    }
  }

  if (state === "PREPARE") {
    SystemUpdatePrepare(now);
  } else if (state === "TOO_EARLY") {
    SystemUpdateTooEarly(now);
  } else if (state === "RUNNING" || state === "SAFE RUNNING") {
    SystemUpdateRunning(now);
  }

  // 红条淡出
  if (barFadeActive) {
    const t = (now - barFadeStartTime) / BAR_FADE_DURATION;
    if (t >= 1) {
      barAlpha = 0;
      barFadeActive = false;
    } else {
      barAlpha = 1 - t;
    }
  } else {
    barAlpha = 1.0;
  }
}
// #endregion



// #region ========== 7) 绘制系统（draw + 绘制工具函数） ==========
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
  if (Assets.skillLoaded && Assets.skillImg) {
    ctx.drawImage(Assets.skillImg, iconX, iconY, iconSize, iconSize);
  } else {
    ctx.fillStyle = UI.iconFallback;
    ctx.fillRect(iconX, iconY, iconSize, iconSize);
    ctx.strokeStyle = UI.iconStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(iconX, iconY, iconSize, iconSize);
  }
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

  let cdRemaining = 0.0;
  if (bladeflycdEndTime !== null) {
    cdRemaining = bladeflycdEndTime - now;
  }
  drawCooldownOverlay(iconTarget, cdRemaining, getCdSeconds());
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

function drawResultImpactEffect(now) {
  if (!resultImpactType) return;

  const duration = RESULT_IMPACT_DURATION[resultImpactType] || 0.7;
  const elapsed = Math.max(0, now - resultImpactStartTime);
  if (elapsed >= duration) {
    resultImpactType = null;
    return;
  }

  const progress = Math.min(1, elapsed / duration);
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 18);
  const baseFade = Math.max(0, 1 - progress);

  let flashColor = '220, 60, 40';
  let waveColor = '255, 220, 160';
  let text = '剑冲命中';
  if (resultImpactType === 'interrupt') {
    flashColor = '160, 70, 220';
    waveColor = '215, 190, 255';
    text = '剑飞成功';
  } else if (resultImpactType === 'awin') {
    flashColor = '40, 180, 100';
    waveColor = '180, 255, 215';
    text = '读条完成';
  }

  const flashAlpha = Math.min(0.42, (0.12 + 0.2 * pulse) * baseFade + 0.05);
  ctx.fillStyle = `rgba(${flashColor}, ${flashAlpha})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const waveProgress = Math.min(1, progress * 1.25);
  const maxRadius = Math.hypot(WIDTH, HEIGHT) * 0.58;
  const radius = 24 + waveProgress * maxRadius;
  const waveAlpha = Math.max(0, 0.75 * (1 - waveProgress));
  ctx.beginPath();
  ctx.arc(WIDTH * 0.5, HEIGHT * 0.5, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${waveColor}, ${waveAlpha})`;
  ctx.lineWidth = 6;
  ctx.stroke();

  const hitScale = 1 + 0.05 * Math.sin(elapsed * 14);
  const hitSize = Math.max(30, Math.floor(resultSize * 1.3 * hitScale));
  ctx.font = `bold ${hitSize}px "Microsoft YaHei", Arial`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(30, 0, 0, 0.75)';
  ctx.fillStyle = `rgba(255, 245, 210, ${Math.min(1, 0.7 + 0.3 * pulse) * baseFade + 0.1})`;
  ctx.strokeText(text, WIDTH / 2, HEIGHT * 0.22);
  ctx.fillText(text, WIDTH / 2, HEIGHT * 0.22);
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
  if (state === "RESULT") {
    if (reactionTime !== null) text = `本次反应时间：${(reactionTime * 1000).toFixed(1)} ms`;
    else text = `本次反应时间：> ${(BAR_DURATION * 1000).toFixed(0)} ms (超时)`;
  } else if (state === "TOO_EARLY") {
    text = "断空了，小笨蛋！";
  } else {
    text = "本次反应时间：-- ms";
  }

  ctx.font = resultFont;
  ctx.fillStyle = UI.textResult;
  ctx.fillText(text, WIDTH / 2, HEIGHT * 0.85);
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

  // Result-specific VFX layer
  drawResultImpactEffect(now);
}
// #endregion



// #region ========== 8) 主循环（gameLoop） ==========
function gameLoop() {
  SystemUpdate();
  draw();
  requestAnimationFrame(gameLoop);
}

setupLeaderboardUI();
gameLoop();
// #endregion


