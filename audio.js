// audio.js
let audioContext = null;
const soundBuffers = {};
let isLoaded = false;

function getCtx() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// 在用户第一次交互时调用，避免移动端“不能自动播放”
export async function unlockAudio() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (e) {}
  }
}

export async function loadAudioBuffer(name, filePath) {
  try {
    const ctx = getCtx();
    const response = await fetch(filePath);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    soundBuffers[name] = audioBuffer;
    return audioBuffer;
  } catch (e) {
    console.error(`音效 ${name} 加载失败:`, e);
    return null;
  }
}

export async function preloadAllSounds() {
  await Promise.all([
    loadAudioBuffer('bar', 'sound/bar.MP3'),
    loadAudioBuffer('finish', 'sound/finish.MP3'),

    loadAudioBuffer('skill_blade', 'sound/skill_blade.MP3'),
    loadAudioBuffer('skill_flower', 'sound/skill_flower.MP3'),
    loadAudioBuffer('skill_toxic', 'sound/skill_toxic.MP3'),
  ]).catch(err => {
    console.warn('⚠ 某些音效加载失败', err);
  });

  isLoaded = true;
  // console.log('✓ 所有音效加载完成');
}

export function playSound(name, loop = false) {
  const buffer = soundBuffers[name];
  if (!buffer) {
    console.warn(`音效 ${name} 未加载，无法播放`);
    return null;
  }
  try {
    const ctx = getCtx();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(ctx.destination);
    source.start(0);
    return source;
  } catch (e) {
    console.error(`播放音效 ${name} 失败:`, e);
    return null;
  }
}

export function stopSound(source) {
  if (!source) return;
  try { source.stop(0); } catch (e) {}
}

export function audioReady() {
  return isLoaded;
}
