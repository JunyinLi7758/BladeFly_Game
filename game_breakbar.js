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
  Blade:  { name: '剑纯', skillname: '剑飞惊天', icon: 'icon_blade.png',  skillSound: 'skill_blade',  cd: 3.0 },
  Flower: { name: '万花', skillname: '厥阴指',   icon: 'icon_flower.png', skillSound: 'skill_flower', cd: 3.0 },
  Toxic:  { name: '五毒', skillname: '灵蛊',     icon: 'icon_toxic.png',  skillSound: 'skill_toxic',  cd: 3.0 },
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
// #endregion



// #region ========== 4) 输入事件（键盘/鼠标/触屏 + 职业按钮） ==========
let touchStartTime = 0;
const LONG_PRESS_TIME = 1000;

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

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  touchStartTime = Date.now();
});

canvas.addEventListener('touchend', async (e) => {
  e.preventDefault();
  const touchDuration = Date.now() - touchStartTime;
  if (touchDuration > LONG_PRESS_TIME) {
    state = "IDLE";
  } else {
    await handleAction();
  }
});

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
function playSkillOnce() {
  if (!currentJob.skillSound) return;
  stopSound(currentSkillSource);
  currentSkillSource = playSound(currentJob.skillSound, false);
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
    barRgb = BAR_COLOR_NORMAL;
    barAlpha = 1.0;
    barFadeActive = false;
    barHitFraction = 0;

    barFraction = 0;
    reactionTime = null;

    signalTime = null;
    startTime  = null;

    const delay = Math.random() * 2.0 + 1.0; // 1~3秒
    waitUntil = now + delay;
    message = "准备中...";
    state = "PREPARE";
    return;
  }

  // PREPARE：抢跑
  if (state === "PREPARE") {
    state = "TOO_EARLY";
    bladeflycdEndTime = now + getCdSeconds();
    playSkillOnce();
    message = "骗你到了吧~  菜，就多练！ ";
    waitUntil = now + 0.4;
    return;
  }

  // RUNNING：成功打断
  if (state === "RUNNING") {
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

    state = "RESULT";
    return;
  }

  // SAFE RUNNING：无效点击（不做事）
}
// #endregion



// #region ========== 6) 逻辑更新（update：推进状态机/读条/自断/超时/淡出） ==========
function update() {
  const now = performance.now() / 1000;

  if (state === "PREPARE") {
    if (bladeflycdEndTime !== null && bladeflycdEndTime > now) {
      const remain = (bladeflycdEndTime - now).toFixed(1);
      message = `等待${currentJob.skillname.slice(0, 2)}冷却 ${remain} 秒，随后开始读条...`;
    } else {
      message = "准备好…… 我要生太极咯~ ...";
    }

    if (now >= waitUntil) {
      stopSound(currentBarSource);
      currentBarSource = playSound('bar', false);

      state = "RUNNING";
      signalTime = now;
      startTime  = now;

      barFraction = 0.0;
      selfbreak = Math.random() * 1.4 + 0.1;

      // 让区间更友好
      if (selfbreak >= 0.8 && selfbreak <= 1.1) selfbreak = 1.1;
    }

  } else if (state === "TOO_EARLY") {
    if (now >= waitUntil) {
      stopSound(currentBarSource);
      currentBarSource = playSound('bar', false);

      signalTime = now;
      startTime  = now;
      barFraction = 0.0;
      selfbreak = 2.0;
      state = "SAFE RUNNING";
    }

  } else if (state === "RUNNING" || state === "SAFE RUNNING") {
    const elapsed = now - startTime;
    let frac = elapsed / BAR_DURATION;

    if (state === "SAFE RUNNING") {
      message = `没${currentJob.skillname.slice(0,2)}了吧！ 美美生太极 ${elapsed.toFixed(2)} /0.56`;
    } else {
      message = `生太极 ${elapsed.toFixed(2)} /0.56`;
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

        state = "RESULT";
        reactionTime = null;
      }
    }

    barFraction = frac;
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

  const points = [
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

function draw() {
  if (layoutDirty) layout();

  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const now = performance.now() / 1000;

  // Logo
  if (Assets.logoLoaded && Assets.logoImg) {
    try {
      const aspectRatio = Assets.logoImg.width / Assets.logoImg.height;
      const logoWidth  = logoHeight * aspectRatio;
      const logoX = (WIDTH - logoWidth) / 2;
      const logoY = HEIGHT * 0.05;
      ctx.drawImage(Assets.logoImg, logoX, logoY, logoWidth, logoHeight);
    } catch (e) {}
  }

  // Skill icon
  if (Assets.skillLoaded && Assets.skillImg) {
    try {
      ctx.drawImage(Assets.skillImg, iconX, iconY, iconSize, iconSize);
    } catch (e) {
      ctx.fillStyle = '#4a6fa5';
      ctx.fillRect(iconX, iconY, iconSize, iconSize);
    }
  } else {
    ctx.fillStyle = '#4a6fa5';
    ctx.fillRect(iconX, iconY, iconSize, iconSize);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(iconX, iconY, iconSize, iconSize);
  }

  // CD 扇形（用当前职业 CD）
  let cdFraction = 0.0;
  if (bladeflycdEndTime !== null) {
    const cdRemaining = bladeflycdEndTime - now;
    if (cdRemaining > 0) cdFraction = cdRemaining / getCdSeconds();
    else bladeflycdEndTime = null;
  }
  drawCDFan(iconX, iconY, iconSize, cdFraction);

  // 标题
  ctx.font = `bold ${titleSize}px "Microsoft YaHei", Arial`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText('折磨气纯模拟器v1.6', WIDTH / 2, HEIGHT * 0.25);

  // message
  ctx.font = `${msgSize}px "Microsoft YaHei", Arial`;
  ctx.fillStyle = '#dcdcdc';
  ctx.fillText(message, WIDTH / 2, HEIGHT * 0.36);

  // 结果行
  let text;
  if (state === "RESULT") {
    if (reactionTime !== null) text = `本次反应时间：${(reactionTime * 1000).toFixed(1)} ms`;
    else text = `本次反应时间：> ${(BAR_DURATION * 1000).toFixed(0)} ms (超时)`;
  } else if (state === "TOO_EARLY") {
    text = "断空了，小笨蛋！";
  } else {
    text = "本次反应时间：-- ms";
  }

  ctx.font = `${resultSize}px "Microsoft YaHei", Arial`;
  ctx.fillStyle = '#ffff00';
  ctx.fillText(text, WIDTH / 2, HEIGHT * 0.85);

  // 进度条背景
  ctx.fillStyle = '#505050';
  drawRoundedRect(barXAdj, barY, barWidth, barHeight, 8);

  // 进度条填充
  let drawFrac = barFadeActive ? barHitFraction : barFraction;
  if (drawFrac > 0) {
    ctx.fillStyle = `rgba(${barRgb}, ${barAlpha})`;
    drawRoundedRect(barXAdj, barY, barWidth * drawFrac, barHeight, 8);
  }
}
// #endregion



// #region ========== 8) 主循环（gameLoop） ==========
function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
// #endregion
