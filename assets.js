// assets.js
export const Assets = {
  logoImg: null,
  logoLoaded: false,

  skillImg: null,
  skillLoaded: false,
};

export function initImages() {
  // Logo
  Assets.logoImg = new Image();
  Assets.logoImg.onload = () => { Assets.logoLoaded = true; };
  Assets.logoImg.onerror = () => { console.warn('Logo加载失败，请检查路径'); };
  Assets.logoImg.src = 'img/logo.png';

  // Skill Icon（先创建，后续再 setSkillIcon）
  Assets.skillImg = new Image();
  Assets.skillImg.onload = () => {
    Assets.skillLoaded = true;
    // console.log('图标加载成功');
  };
  Assets.skillImg.onerror = () => {
    console.warn('图标加载失败，请检查路径');
  };
}

export function setSkillIcon(url) {
  if (!Assets.skillImg) return;
  Assets.skillLoaded = false;
  Assets.skillImg.src = url;
}
