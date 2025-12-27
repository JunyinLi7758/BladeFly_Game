// game.js
import { Assets, initImages, setSkillIcon } from './assets.js';
import { preloadAllSounds, unlockAudio, playSound, stopSound } from './audio.js';


// #region ========== 0) 基本常量与画布（canvas / resize / layout缓存�?==========
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let WIDTH = 900;
let HEIGHT = 450;

// 读条参数
const BAR_DURATION = 0.56;   // �?
const BAR_WIDTH_MAX = 600;   // px

// 进度条颜�?& 淡出
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



// #region ========== 1) 职业系统（JOBS / currentJob / setJob / getCdSeconds�?==========
const JOBS = {
  Blade:  { name: '剑纯', skillname: '剑飞惊天', icon: 'img/icon_blade.png',  skillSound: 'skill_blade',  cd: 3.0 },
  Flower: { name: '万花', skillname: '厥阴�?,   icon: 'img/icon_flower.png', skillSound: 'skill_flower', cd: 3.0 },
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
  message = `长按读条欺骗${currentJob.name}，骗到别忘了生太极！`;
}
// #endregion



// #region ========== 2) 资源初始化（图片/音效预加载） ==========
initImages();
setSkillIcon(currentJob.icon);
preloadAllSounds();
// #endregion



// #region ========== 3) 游戏状态机（骗读条�?==========

let state = "READY"; // READY / CASTING / BAITING / RESULT

let startTime = null;          // 本次读条开始时�?
let barFraction = 0.0;         // 0~1
let reactionTime = null;       // 结果展示用（成功=总用时；失败=被断时刻�?

let message = `长按读条欺骗${currentJob.name}，骗到别忘了生太极！ `;


// 敌方（电脑）行为参数
let enemyCdEndTime = null;     // 敌方打断技能CD结束时间
let enemyBreakFrac = null;     // 断点�?~1�?
let enemyReactSec = null;      // 敌方反应时间（秒�?
let enemyInterruptAt = null;   // 敌方计划打断的绝对时间（秒）

let currentSkillSource = null;
let currentBarSource = null;

let BLADEFLY_CD = 3.0; // 敌方CD时间（可独立设置�?

let TAICHI_LAST_TIME = 5.0; // 生太极持续时间（秒）
let taichiendtime = null;
// 进度条颜色控制沿用你原来�?
// barRgb / barAlpha / barFadeActive / barHitFraction ...

// #endregion



// #region ========== 4) 输入事件（键�?鼠标/触屏 + 职业按钮�?==========
let pressStartTime = 0;
const LONG_PRESS_TIME = 1000;
let isPressing = false;


function onPressStart() {
  if (isPressing) return;
  isPressing = true;
  pressStartTime = Date.now();
  handleAction();
}

async function onPressEnd() {
  if (!isPressing) return;
  isPressing = false;

  const duration = Date.now() - pressStartTime;

  if (duration >= LONG_PRESS_TIME) {
    state = "READY";
  } else {
    await handleAction();
  }
}



// window.addEventListener('keydown', async (e) => {
//   if (e.key === 'Escape') {
//     state = "READY";
//     return;
//   }
//   if (e.key === ' ' || e.key === 'Enter') {
//     e.preventDefault();
//     await handleAction();
//   }
// });


window.addEventListener('keydown', (e) => {
  if (e.repeat) return; // 防止长按键盘反复触发

  if (e.key === 'Escape') {
    state = "READY";
    return;
  }

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    onPressStart();
  }
});

window.addEventListener('keyup', async (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    await onPressEnd();
  }
});


// canvas.addEventListener('click', async () => {
//   await handleAction();
// });

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  onPressStart();
});

canvas.addEventListener('mouseup', async (e) => {
  e.preventDefault();
  await onPressEnd();
});

// canvas.addEventListener('touchstart', (e) => {
//   e.preventDefault();
//   touchStartTime = Date.now();
//     handleAction();
// });

// canvas.addEventListener('touchend', async (e) => {
//   e.preventDefault();
//   const touchDuration = Date.now() - touchStartTime;
//   if (touchDuration > LONG_PRESS_TIME) {
//     state = "READY";
//   } else {
//     await handleAction();
//   }
// });

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  onPressStart();
});

canvas.addEventListener('touchend', async (e) => {
  e.preventDefault();
  await onPressEnd();
});

// 职业按钮绑定
try {
  const jobButtons = document.querySelectorAll('.job-btn');
  jobButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const jobKey = btn.getAttribute('data-job');
      if (!JOBS[jobKey]) return;

      // 只允许在 IDLE/RESULT/TOO_EARLY 状态切职业
      if (state !== 'READY' && state !== 'RESULT' && state !== 'TOO_EARLY') {
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



// #region ========== 5) 动作处理（原 handleSpaceKey：统一入口 handleAction�?==========
function playSkillOnce() {
  if (!currentJob.skillSound) return;
  stopSound(currentSkillSource);
  currentSkillSource = playSound(currentJob.skillSound, false);
}

async function handleAction() {
  const now = performance.now() / 1000;

  // 移动端音频解锁（如果你还在用 audio.js 模块版就�?unlockAudio();�?
  // await unlockAudio();

  const enemyOnCd = (enemyCdEndTime !== null && now < enemyCdEndTime);
//   console.log("当前状�?", state, "敌方CD�?", enemyOnCd);

  // RESULT / READY：开始读�?
  if (state === "READY" || state === "RESULT") {
    if (enemyOnCd) {  
        return;
        }
    // 重置条显�?
    // playSkillOnce();
    barRgb = BAR_COLOR_NORMAL;
    barAlpha = 1.0;
    barFadeActive = false;
    barHitFraction = 0;

    // reactionTime = null;
    barFraction = 0.0;
    startTime = now;

    taichiendtime = TAICHI_LAST_TIME + startTime;
    // console.log("读条开始时间设�?, startTime);

    // 如果敌方不在CD：生成“断�?反应时间+打断时刻�?
    if (!enemyOnCd) {
      enemyBreakFrac = Math.random() * 0.9 - 0.1;      // 0.35~0.85
      enemyReactSec  = -Math.random() * 0.3 + 0.4;     // 0.10~0.25s
// 
    //   console.log("敌方断点设为", enemyBreakFrac.toFixed(3),
                //   "反应时间设为", enemyReactSec.toFixed(3), "�?);  
    //   message = "开始读条，剑飞";
      enemyInterruptAt = null; // 重置打断时刻，由 update 计算
    } else {
      enemyBreakFrac = null;
      enemyReactSec = null;
      enemyInterruptAt = null;
      message = "敌方在CD！稳稳读完就赢�?;
    }
    
    state = "CASTING";
    // 播放读条音效（可选）
    stopSound(currentBarSource); currentBarSource = playSound('bar', false);
    return;
  }
  else if (state === "PAUSE") {
      // playSkillOnce();
    barRgb = BAR_COLOR_NORMAL;
    barAlpha = 1.0;
    barFadeActive = false;
    barHitFraction = 0;

    // reactionTime = null;
    barFraction = 0.0;
    startTime = now;

    // enemyBreakFrac += 0.4* (0.9-enemyBreakFrac);
    enemyBreakFrac = Math.random() * 0.9 - 0.05;      // 0.35~0.85
    enemyReactSec = enemyReactSec * 0.6;
    // console.log("敌方断点设为", enemyBreakFrac.toFixed(3),
                //   "反应时间设为", enemyReactSec.toFixed(3), "�?);  

    state = "CASTING";
    // 播放读条音效（可选）
    stopSound(currentBarSource); currentBarSource = playSound('bar', false);
    return;  
    }
  // CASTING：点�?取消读条（骗断）

  else if (state === "CASTING") {
    // 取消读条：进度归零（也可以保留显示，但更像“停手”就归零�?
    reactionTime = barFraction * BAR_DURATION; // 被断时刻（用于显示）
    barFraction = 0.0;
    // startTime = null;

    message = "骗出来了吗？ 注意听声�?;
    state = "PAUSE";
    return;
  }
}

// #endregion



// #region ========== 6) 逻辑更新（update：推进状态机/读条/自断/超时/淡出�?==========
function update() {
  const now = performance.now() / 1000;

  if (enemyCdEndTime !== null && now >= enemyCdEndTime) {
    enemyCdEndTime = null;
  }
//   console.log("当前状�?", startTime) ;

  const enemyOnCd = (enemyCdEndTime !== null && now < enemyCdEndTime);
  
  // CASTING：推进读�?
  if (state === "CASTING" ) {
    const elapsed = now - startTime;

    let frac = elapsed / BAR_DURATION;
    message = `生太�?${(elapsed).toFixed(2)} / 0.56`;
    // 读满：成�?
    if (frac >= 1.0) {
      frac = 1.0;
      barFraction = frac;

    //   reactionTime = elapsed; // 成功用时
      message = `牛逼，你骗�?{currentJob.name}了！点一下重开。`;
      state = "RESULT";
      stopSound(currentBarSource); currentBarSource=null;
      playSound('finish', false);
    } else if (enemyInterruptAt == null && frac >= enemyBreakFrac && !enemyOnCd) {
        enemyInterruptAt = enemyBreakFrac * BAR_DURATION + enemyReactSec;
        // console.log(now,startTime,"敌方计划打断时刻设为", enemyInterruptAt);
    }else {
      barFraction = frac;

      // 敌方不在CD，且到了计划打断时刻：如果你还在读条 -> 失败并进入敌方CD
      if (!enemyOnCd && enemyInterruptAt !== null && elapsed >= enemyInterruptAt) {
        // 敌方成功打断�?
        playSkillOnce();

        // 进入敌方CD
        enemyCdEndTime = now + BLADEFLY_CD; // 你也可以单独�?ENEMY_CD
        enemyInterruptAt = null;

        reactionTime = elapsed; // 被断时刻（用于显示）

        // 红条提示（表示“你被断了”）
        barHitFraction = Math.max(0, Math.min(1, barFraction));
        barRgb = BAR_COLOR_HIT;
        barAlpha = 1.0;
        barFadeActive = true;
        barFadeStartTime = now;

        message = `想骗${currentJob.name}�? �?{currentJob.skillname.slice(0,2)}好了，重新再来吧~`;
        state = "RESULT";
        // playSound('skill_xxx') 可�?
      }
    }
  } else if (state === "PAUSE"){
    const elapsed = now - startTime;
    // console.log("暂停状态，已过时长:", elapsed, startTime, now);
    if (enemyInterruptAt !== null && elapsed >= enemyInterruptAt) {
        playSkillOnce();
        enemyCdEndTime = now + BLADEFLY_CD; // 你也可以单独�?ENEMY_CD
        enemyInterruptAt = null;
    }
    // 暂停状态下不推进读�?
    barFraction = 0.0;
  }
  // READY：提示敌方CD剩余（可选）
  else if (state === "RESULT") {
    if (enemyOnCd) {
      const remain = (enemyCdEndTime - now).toFixed(1);
    //   message = `被飞了吧�?重新试着骗吧~ `;
    }
    else{
        message = `再骗一次试试，长按开始读条！`;
        // message = "牛逼，你读条成功了！点一下重开�?;
        state = "READY";
    }
  }

  // 红色条淡出（保留你原逻辑�?
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



// #region ========== 7) 绘制系统（draw + 绘制工具函数�?==========
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

function draw() {
  if (Assets.logoLoaded && Assets.logoImg) {
    const nextAspect = Assets.logoImg.width / Assets.logoImg.height;
    if (nextAspect !== logoAspect) {
      logoAspect = nextAspect;
      layoutDirty = true;
    }
  }
  if (layoutDirty) layout();

  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const now = performance.now() / 1000;

  // Logo
  if (Assets.logoLoaded && Assets.logoImg) {
    ctx.drawImage(Assets.logoImg, logoX, logoY, logoWidth, logoHeight);
  }

  // Skill icon
  if (Assets.skillLoaded && Assets.skillImg) {
    ctx.drawImage(Assets.skillImg, iconX, iconY, iconSize, iconSize);
  } else {
    ctx.fillStyle = '#4a6fa5';
    ctx.fillRect(iconX, iconY, iconSize, iconSize);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(iconX, iconY, iconSize, iconSize);
  }

  // CD 扇形（用当前职业 CD�?
  let skillcdFraction = 0.0;
  if (enemyCdEndTime !== null) {
    const cdRemaining = enemyCdEndTime - now;
    if (cdRemaining > 0) {
      skillcdFraction = cdRemaining / BLADEFLY_CD; // ENEMY_CD
    }
  }
  drawCDFan(iconX, iconY, iconSize, skillcdFraction);

  let taichicdFraction = 0.0;
  const taichiRemaining = taichiendtime - now;
  if (taichiRemaining > 0) {
    taichicdFraction = taichiRemaining / 5.0; // ?��??��a????????-?��?����??��?
  } else {
    taichicdFraction = 0.0;
    // taichiendtime = null;
  }
  drawCDFan(logoX, logoY, logoHeight, taichicdFraction);

  // 标题
  ctx.font = titleFont;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText('欺骗剑纯模拟器v1.1', WIDTH / 2, HEIGHT * 0.25);

  // message
  ctx.font = msgFont;
  ctx.fillStyle = '#dcdcdc';
  ctx.fillText(message, WIDTH / 2, HEIGHT * 0.36);

  // 结果�?
    let text;
    if (state === "RESULT") {
    if (reactionTime !== null) {
        text = `被断于：${(reactionTime * 1000).toFixed(1)} ms`;
    } else {
        text = `被断于：-- ms`;
    }
    } else {
    text = "被断于：-- ms";
    }


  ctx.font = resultFont;
  ctx.fillStyle = '#ffff00';
  ctx.fillText(text, WIDTH / 2, HEIGHT * 0.85);

  // 进度条背�?
  ctx.fillStyle = '#505050';
  drawRoundedRect(barXAdj, barY, barWidth, barHeight, 8);

  // 进度条填�?
  let drawFrac = barFadeActive ? barHitFraction : barFraction;
  if (drawFrac > 0) {
    ctx.fillStyle = `rgba(${barRgb}, ${barAlpha})`;
    drawRoundedRect(barXAdj, barY, barWidth * drawFrac, barHeight, 8);
  }
}
// #endregion



// #region ========== 8) 主循环（gameLoop�?==========
function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

gameLoop();
// #endregion









