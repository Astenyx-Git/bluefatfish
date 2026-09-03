/**
 * dsh-pet desktop helper renderer —— 每只桌面宠物一个独立局部小窗口里的宠物本体。
 *
 * 与浏览器 overlay 严格对齐（宠物行为/文案完全一致）：
 *   - 纯逻辑（常量/选择器/移动几何/余额折算/配置校验）来自 shared-core.js
 *     （= src/shared 的构建产物，window.PetShared）——与浏览器 bundle 共用同一份源码；
 *   - 配置唯一来源 config.jsonc + 用户覆盖层（/config 合并），加载失败**大声报错**并显示红色错误条
 *     （每 5s 自动重试），绝无静默兜底池；
 *   - 动画素材经宿主 /dsh-pet-7340/thumb/<宠物id>/<name>.webm（素材根按宠物归属；
 *   - 几何模型：窗口 = 宠物包围盒 + 四周外扩余量（WINDOW_MARGIN_RATIO，为气泡/弹窗预留空间）。
 *     sprite 固定在窗口内 (margin.l, margin.t) 处，宠物的"移动"由本页把目标屏幕位置
 *     逐帧上报（petBridge.setBounds）→ 主进程按 sprite 位置 + 外扩余量移动窗口；
 *     视口 = 主屏工作区（workAreaW/H 由主进程注入），漫游/角落/位置换算都用它。
 *     外扩区透明且点击穿透（只有身体命中区可交互），不挡下层应用。
 *   - 右键级联菜单（与浏览器共用同一份组件：树+渲染+样式来自 shared-core 的 menu 模块）：
 *     右键宠物弹出，桌面端工具根项「打开网站（系统默认浏览器）/ 查看余额 / 回到初始位置」+ 动作点播；
 *     菜单开启期间整窗保持可交互（悬停菜单不触发穿透翻转），关闭/离开窗口即恢复穿透。
 *   - 系统通知不是宠物行为（浏览器半侧 notify.ts 负责），桌面端不重复实现。
 *
 * 端点全部由 configUrl 推导：balance / balance/trigger / thumb / font / pic。
 * 入口仅加载：shared-core.js（经典 script）→ renderer.js（本文件）。
 */
'use strict';

const S = window.PetShared;

const params = new URLSearchParams(location.search);
const CONFIG = {
  configUrl: params.get('configUrl') || 'http://127.0.0.1:3080/dsh-pet-7340/config.jsonc',
  scale: Number(params.get('scale') || '1'),
  petIndex: Number(params.get('petIndex') || '0'),
};
// 视口 = 主屏工作区（窗口只是宠物的一块局部画布）：漫游边界/角落定位/位置比例换算用它
const VIEW = {
  w: Number(params.get('workAreaW') || (window.screen && window.screen.availWidth) || 1920),
  h: Number(params.get('workAreaH') || (window.screen && window.screen.availHeight) || 1080),
};
// [dsh-pet-android] 壳侧旋转适配：按换算后的工作区坐标直接落位（绝对坐标保持由壳完成）
window.__dshPetSetPosition = function (x, y) {
  const s0 = (typeof sprites !== 'undefined' && sprites && sprites[0]) || null;
  if (!s0) return;
  if (s0.throwRef !== null) s0.stopThrow(); // 飞行中旋转：立即定格（防丢宠）
  s0.customPos = { rx: x / VIEW.w, ry: y / VIEW.h };
  s0.pos = { x: Math.round(x), y: Math.round(y) };
  window.__dshPetDebug.dragPos = { x: s0.pos.x, y: s0.pos.y };
  s0.sendBounds(
    s0.pos.x - s0.margin.l,
    s0.pos.y - s0.margin.t,
    s0.size + s0.margin.l + s0.margin.r,
    s0.winH + s0.margin.t + s0.margin.b,
  );
};
// [dsh-pet-android] 底部导航/手势条 inset：可用高扣减 → 漫游边界/抛掷地面/底部锚点整体上移。
// （坐标即屏幕绝对坐标；菜单防遮挡由菜单打开时上报的 __dshPetMenuBottomInset 驱动，见 onContextMenu 与 shared-core 夹取补丁）
VIEW.h -= Number(params.get('gestureInset') || 0);
// [dsh-pet-android] 重力倍率（设置页拖动条写入 URL 参数 gm；PetService ACTION_SET_GRAVITY 可实时覆盖）
window.__dshPetGravityMult = (() => {
  const g = params.get('gm');
  if (g === null) return 1;
  const n = Number(g);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
})();
// [dsh-pet-android] 阻力用户倍率（控制台阻力条写入 URL 参数 dm；PetService ACTION_SET_DRAG 可实时覆盖）：
// 与 __dshPetDragScale（重力档位基础阻力）相乘，1.0×-5.0×
window.__dshPetDragUserMult = (() => {
  const d = params.get('dm');
  if (d === null) return 1;
  const n = Number(d);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 1;
})();
// [dsh-pet-android] 空气阻力档位：重力越低阻力越大（抵消长滞空的失控滑行），节点间线性插值
// 表：1.0→100%，0.7→125%，0.5→150%，0.3→175%，0→175%
window.__dshPetDragScale = (() => {
  const pts = [[0, 1.75], [0.3, 1.75], [0.5, 1.5], [0.7, 1.25], [1.0, 1.0]];
  const g = window.__dshPetGravityMult;
  if (g <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const g0 = pts[i][0], d0 = pts[i][1], g1 = pts[i + 1][0], d1 = pts[i + 1][1];
    if (g >= g0 && g <= g1) return d0 + (d1 - d0) * (g - g0) / (g1 - g0);
  }
  return 1;
})();
const ORIGIN = new URL(CONFIG.configUrl).origin;
const withSuffix = (suffix) => CONFIG.configUrl.replace(/config\.jsonc$/, suffix);
const BALANCE_URL = withSuffix('balance');
const TRIGGER_URL = withSuffix('balance/trigger');
const BUBBLE_DURATION_MS = 10 * 1000; // 余额气泡展示时长（与浏览器一致：定时自动消失，与动画解耦）
// 窗口四周外扩 = 该比例 × 宠物尺寸：为气泡 / 未来可能的弹窗预留显示空间；
// 外扩区透明且点击穿透（只有身体命中区可交互）。单点可调——按实际观感改这里。
const WINDOW_MARGIN_RATIO = 0.12; // [dsh-pet-android] 气泡已删，余量仅为菜单预留（与 WindowController.MARGIN_RATIO 同步）

// ---------- 全局状态 ----------
const rootEl = document.getElementById('root');
const errorEl = document.getElementById('pet-error');
let config = null; // ClientConfig（通过 shared 的 assertClientConfig 校验）
let sprites = []; // PetSprite[]（本窗口只装一只宠物）
let balance = null; // BalanceState（本窗口单宠共用）
let balanceTick = 0;
let bootTimer = null;
let loopsStarted = false;

// ---------- 调试钩子（冒烟自检/排障用；真实运行也可排查错误/配置/气泡） ----------
window.__dshPetDebug = {
  errors: [],
  configOk: false,
  spriteCount: 0,
  lastBubbleTitle: '',
  lastBalanceOk: null,
  menuOpen: false,
  bootAt: Date.now(),
};
window.addEventListener('error', (event) => {
  window.__dshPetDebug.errors.push(String(event.message || event.error));
});

// ---------- 配置（大声报错；失败 5s 重试） ----------
function showError(message) {
  console.error('[dsh-pet] ' + message);
  window.__dshPetDebug.configOk = false;
  errorEl.textContent = 'dsh-pet 配置错误：' + message;
  errorEl.classList.add('visible');
}
function hideError() {
  errorEl.classList.remove('visible');
  errorEl.textContent = '';
}
function scheduleReboot() {
  if (bootTimer) return;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void boot();
  }, 5000);
}

async function loadConfig() {
  const res = await fetch(CONFIG.configUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`config http ${res.status}`);
  const base = S.assertClientConfig(JSON.parse(S.stripJsonc(await res.text())));
  // 用户覆盖层：pets / animations / animationWeights / eventsRefreshSec / notificationsEnabled
  let user = {};
  try {
    const r = await fetch(withSuffix('config'), { cache: 'no-store' });
    if (r.ok && r.status !== 204) user = await r.json().catch(() => ({}));
  } catch {
    /* 无用户层时忽略 */
  }
  // 合并后统一校验：用户层覆盖缺字段会静默丢配置，缺失即显式报错（与浏览器同一路径）
  const cfg = S.assertClientConfig(S.applyUserOverrides(base, user));
  // 额外宠物（pet pack）：pet/ 目录文件定义的宠物（自带**完整独立**动画池/权重）。
  // host 已按同一套规则校验 + 过滤 id 冲突，这里信任其输出；端点失败/缺失时仅主宠物运行。
  let extra = [];
  try {
    const re = await fetch(withSuffix('extra-pets'), { cache: 'no-store' });
    if (re.ok && re.status !== 204) {
      const body = await re.json().catch(() => null);
      if (body && Array.isArray(body.pets)) extra = body.pets;
    }
  } catch {
    /* extra-pets 拉取失败：仅主宠物运行（宿主日志已显式报错） */
  }
  if (extra.length) cfg.pets = S.mergeExtraPets(cfg.pets, extra);
  return cfg;
}

// ---------- 单只宠物（行为与浏览器 PetCard 一致；纯逻辑来自 src/shared） ----------
class PetSprite {
  constructor(pet, cfg) {
    this.pet = pet; // 这只宠物的配置段（pets[i]）
    this.cfg = cfg; // 全量配置（ClientConfig）
    this.size = pet.size * CONFIG.scale;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // 窗口高 = 舞台高 + 脚底垫高（stage 被 translateY(bottomPad) 下移的余量，防底部被窗口裁剪）
    this.winH = this.height + this.bottomPad;
    // 窗口内【可交互区域】= 身体命中区（像素，窗口坐标）。浏览器 overlay 只有 .dsh-pet-hit 是
    // pointer-events:auto（root/stage/气泡全 none）——桌面严格对齐：命中区外含透明像素一律穿透到下层应用。
    // HIT_BOX 是 640×360 舞台坐标：x 按窗口宽缩放；y 除舞台高外还要加 bottomPad（舞台被下移）。
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    window.__dshPetDebug.hitRect = this.hitRect;
    // 左右透明边余量（视频盒内宠物身体居中）：让边界按"身体"贴边——宠物能走到屏幕边缘，
    // 但身体永不越界（漫游/拖拽都不会弄丢宠物）。与浏览器 overlay 的 sideAllow 同一套语义。
    this.sideAllow = ((S.HIT_BOX.x0 + (S.HIT_BOX.x1 - S.HIT_BOX.x0) * 0.25) / 640) * this.size; // [dsh-pet-android] 身体可出屏其宽度的 1/4（基线：身体贴边）
    window.__dshPetDebug.sideAllow = this.sideAllow;
    // 窗口四周外扩（= WINDOW_MARGIN_RATIO×宠物尺寸）：sprite 钉在 (margin.l, margin.t)，
    // 窗口 = sprite + 四边余量——气泡/未来弹窗显示在余量里；余量透明且点击穿透
    const m = this.size * WINDOW_MARGIN_RATIO;
    // [dsh-pet-android] 左右余量另加 1/3 宠物宽（宽动画帧不被窗口裁切；与 WindowController.MARGIN_RATIO_X 同步）
    this.margin = { t: m, r: m + this.size / 3, b: m, l: m + this.size / 3 };
    window.__dshPetDebug.winMargin = this.margin;
    // 宠物包围盒左上角在【工作区】坐标系里的位置（本窗口的位置 = 宠物的位置）
    this.pos = { x: 0, y: 0 };

    // 播放状态（与浏览器同构）
    // 动画池与权重按宠物取：文件宠物（pet/ 目录定义，extra）自带**完整独立**动画池；
    // main 等常规宠物（无 anims 段）用全局 cfg.animations（与浏览器 pet.ts 同一语义）。
    this.animations = pet.animations || cfg.animations;
    this.weights = pet.animationWeights || cfg.animationWeights;
    // 素材根按 assetRoot（文件宠物 = 配置文件前缀，多实例共享同一素材目录）或宠物 id 回落
    this.assetBase = withSuffix('thumb/' + encodeURIComponent(pet.assetRoot || pet.id) + '/');
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    // 交互/移动
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    // 拖拽抛掷物理（与浏览器 pet.ts 同构；纯计算在 shared-core S.*）：
    // 拖拽中弹簧跟随目标（包围盒左上角，工作区 px），松手按指针轨迹估速 → 抛掷（重力+边缘反弹）
    this.dragTrail = []; // 指针轨迹采样（screenX/Y + performance.now()，初速估算用）
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // 弹簧跟随 rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // 抛掷 rAF handle
    this.throwToken = 0;
    // Q 弹挤压（点击回应 / 抛掷落地）：rAF + 待压标记（等新动画成为前台再压，压新首帧）
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // 当前可交互状态（null=未定；只在变化时发 IPC，避免逐帧刷屏）
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // 拖拽后的会话内位置（{rx, ry} 比例）；restart 回角落
    // 右键菜单（统一自绘组件，两端共用同一份：树+渲染均来自 shared-core）
    this.menuOpen = false; // 菜单开启期间强制整窗可交互（悬停菜单不触发穿透翻转）
    this.menuClose = null; // 当前菜单的 close()（打开时挂载，关闭后置空）
    // 余额气泡
    this.bubbleOn = false;
    this.bubbleTimer = null;
    this.balanceView = null;
    this.prevTick = 0;

    // DOM：sprite 钉在窗口内 (margin.l, margin.t)；宠物"位置"= sprite 位置，窗口随余量外扩
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.margin.l + 'px';
    this.el.style.top = this.margin.t + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.stage = stage;
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.title = 'dsh-pet';
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    this.hit.title = 'dsh-pet';
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();

    // 事件（与浏览器同一套：pointerdown/move、click、window pointerup/cancel）
    const ac = new AbortController();
    this.ac = ac;
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', () => this.onClick(), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // 点击穿透：窗口默认整窗穿透（main 设 setIgnoreMouseEvents(true, {forward:true})），
    // 光标进/出身体命中区时翻转可交互；穿透期间 mousemove 由 main 转发进来（forward:true），
    // mouseleave 保证光标离开窗口立即恢复穿透（透明像素不挡下层应用，与浏览器一致）。
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'mouseleave',
      () => {
        // 光标离开窗口：若菜单开着立刻收起（菜单是窗口内 DOM，离开即不可达），再恢复穿透
        this.closeMenu();
        this.setInteractive(false);
      },
      { signal: ac.signal },
    );
  }

  dispose() {
    this.ac.abort();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.el.remove();
  }

  // 目标包围盒左上角（工作区坐标）→ 移动窗口：窗口 = sprite + 四周外扩余量
  // （sprite 钉在窗口 (margin.l, margin.t)，气泡/弹窗显示在余量里）
  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    if (window.petBridge) {
      window.petBridge.setBounds(
        this.pos.x - this.margin.l,
        this.pos.y - this.margin.t,
        this.size + this.margin.l + this.margin.r,
        this.winH + this.margin.t + this.margin.b,
      );
    }
  }

  // 角落/边距 → 窗口位置；拖拽后按会话内位置（比例）还原——**松手无任何边界夹取**，
  // 宠物停在哪就算哪（与浏览器一致：可以完全拖出工作区/屏幕；漫游仍有 planMove 边界检查兜底）
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        marginX: this.pet.position.marginX,
        marginY: this.pet.position.marginY,
        size: this.size,
        W,
        H,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  // 双缓冲切换（与浏览器同一套：前台 opacity 切换 + 降级视频清 handler 并停播，防残留 ended 雪崩）
  switchTo(next, nextOnce) {
    if (!next) return;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) return;
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    el.src = this.assetBase + encodeURIComponent(next) + '.webm';
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play().catch(() => {});
      // 点击 Q 弹：等新动画就位后才压（压的是新点击动画的首帧，与浏览器一致）
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  playOnce(name) {
    this.anim = name;
    this.once = true;
    this.switchTo(name, true);
  }

  // 动画链（与浏览器 pickNext 语义一致，纯逻辑在 shared）
  playIdle() {
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    const k = S.rollKind(roll, animationWeights);
    let next;
    if (k === 'idle') {
      next = S.pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // 已有一场移动进行中（占用）：与浏览器一致，重播当前动画，不另设（绝不重复加载不存在的动作）
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  }

  handleEnded() {
    if (this.dragState.active) return;
    const { animations } = { animations: this.animations };
    // 事件动画播完：回 idle（与 drag/clicks 同分支，不进随机链）；气泡由定时器自动消失，与动画解耦
    const isEvent = Object.values(animations.events ?? {}).some((pool) => pool.includes(this.anim));
    if (isEvent) {
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // 立即同步：翻转后的 pickNext 用新朝向过滤 noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  }

  // ---- 漫游（rAF 驱动，动画首尾各 leadSec/tailSec 秒原地不动；几何在 shared/planMove） ----
  // preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机选
  tryMove(preferredName) {
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin,
      halfW: this.halfW,
      sideAllow: this.sideAllow,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.anim = chosen.name;
    this.once = true;
    this.switchTo(chosen.name, true);
    return chosen.name;
  }

  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      // 移动的是窗口（宠物包围盒跟随），sprite 在本窗口内不动
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  }

  stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
  }

  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  }

  /** rAF 弹簧跟随：窗口朝拖拽目标过阻尼追赶（不再硬贴指针），抹平高频抖动 */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt);
      vel.vy = S.springStep(vel.vy, y, target.y, dt);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // 移动的是窗口（this.pos 实时更新）；sprite 在本窗口内不动
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  }

  /** 停止抛掷（空中被抓/点菜单/回家时立即定格在当前落点） */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
  }

  /** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后写入 customPos */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    const bounds = S.throwBounds({ W: VIEW.w, H: VIEW.h, size: this.size, sideAllow: this.sideAllow });
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // 落地 Q 弹：只在空中→地面转换帧触发一次
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // 本帧积分前的竖直速度（正=下落）：即落地冲击速度
      const res = S.throwStep(state, dt, bounds);
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.sendBounds(res.x, res.y);
      // 落地 Q 弹：只在空中→地面转换帧触发一次，力度随冲击速度（轻落 0.8 ~ 重砸 0.55）
      const grounded = res.y >= bounds.maxY - 1;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  }

  /** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
   *  与浏览器同构，曲线在 shared（S.squashScale）。depth = 下压幅度（点击固定 0.55；
   *  落地按冲击速度 S.landingSquash 动态取）。reduce-motion 时跳过。 */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // 恢复纯镜像（若期间 switchTo 重置过 transform，也以镜像为准）
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  }

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  }

  // ---- 点击 vs 拖拽（与浏览器一致：阈值/抓取偏移/释放回循环待机；移动的是窗口） ----
  onPointerDown(e) {
    // 只认左键：右键进入拖拽判定会与右键菜单打架（右键不拖拽，两端一致）
    if (e.button !== 0) return;
    this.stopThrow(); // 空中抓取：从当前落点开始新拖拽（this.pos 实时）
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    this.hit.classList.add('dragging');
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* 忽略捕获失败 */
    }
    // 记录【按下时的指针屏幕坐标】与【按下时的宠物窗口位置】——之后全部用 e.screenX/Y
    // 做增量：指针屏幕坐标与窗口位置无关，不受窗口被逐帧移动影响（window.screenX 会滞后/缓存）。
    this.dragState = {
      active: true,
      dragging: false,
      sx: e.screenX,
      sy: e.screenY,
      petX: this.pos.x,
      petY: this.pos.y,
    };
    // 注意：舞台「拍平」（去掉 translateY(bottomPad)）不能在这里做——
    // 纯点击（按下即松开）会让人物瞬移上移再落下。与浏览器一致：只有拖拽超过阈值才拍平。
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // 阈值判定用屏幕坐标增量（clientX 会随窗口移动而变化，屏幕坐标稳定）
    const dx = e.screenX - d.sx;
    const dy = e.screenY - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // 真正开始拖拽才把舞台拍平（人物随光标拿起；与浏览器 dragging 语义一致）
      this.stage.style.transform = 'none';
      if (this.animations.drag.length && !this.paused) {
        // [dsh-pet-android] 暂停态拖拽不播拖拽动画：保持定格，仅位移
        this.playOnce(S.pick(this.animations.drag));
      }
    }
    // 记录指针轨迹（screenX/Y 采样：与视口坐标只差常数偏移，速度一致；初速估算用）
    const now = performance.now();
    this.dragTrail.push({ t: now, x: e.screenX, y: e.screenY });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // 弹簧目标 = 按下时的宠物位置 + 指针屏幕增量（窗口怎么动都不影响坐标）——不再硬贴指针，
    // 由 rAF 弹簧跟随逐帧追赶（抹平高频抖动，与浏览器同构）
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // 弹簧跟随立即停（位置定格在实时 this.pos）
    this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // 原始输入留痕（实机排查用：验证指针屏幕坐标与窗口位移是否一致，如 DPI 缩放问题）
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // 释放后接一段循环待机（与浏览器一致），再回随机链
      if (this.animations.idle.length && !this.paused) {
        // [dsh-pet-android] 暂停态松手不接待机链：保持定格（位置已由 customPos 固化）
        const name = S.pick(this.animations.idle, this.anim);
        this.anim = name;
        this.once = false;
        this.switchTo(name, false);
      }
      // 释放位置 = 弹簧跟随后的实际包围盒左上角（this.pos 实时；不是指针目标——
      // 跟手滞后时落点跟随宠物实际位置，与浏览器 boxPx 同语义）
      const px = this.pos.x;
      const py = this.pos.y;
      // 初速估算：够快就抛掷（重力+边缘反弹+落地摩擦），否则原地放下
      const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now());
      this.dragTrail = [];
      if (vel) {
        this.startThrow(px, py, vel.vx, vel.vy);
      } else {
        // [dsh-pet-android] 松手夹取：桌面拖出屏幕可经托盘找回，手机没有兜底——
        // 按抛掷同款边界夹回（px/py = sprite 左上角，与抛掷物理同坐标系），位置下限不变
        const relB = S.throwBounds({ W: VIEW.w, H: VIEW.h, size: this.size, sideAllow: this.sideAllow });
        const relX = Math.min(Math.max(px, relB.minX), relB.maxX);
        const relY = Math.min(Math.max(py, relB.minY), relB.maxY);
        this.customPos = { rx: (relX + this.halfW) / VIEW.w, ry: (relY + this.halfH) / VIEW.h };
        this.position();
        // 释放后的最终窗口位置（position() 换算后，松手无夹取），冒烟断言"释放不位移"用
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
      }
    }
  }

  // ---- 点击穿透（严格对齐浏览器：只有身体命中区可交互，透明像素穿透到下层应用） ----
  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // 只在状态变化时发 IPC，避免逐帧刷屏
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  }

  onMouseMove(e) {
    // 拖拽中窗口逐帧跟随光标、指针相对窗口坐标会有帧级抖动——强制保持可交互，绝不翻转（翻转会断拖拽）
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // 右键菜单开启：整窗保持可交互（悬停菜单项不触发穿透翻转）；关闭后恢复命中区判定
    if (this.menuOpen) {
      this.setInteractive(true);
      return;
    }
    const r = this.hitRect;
    // forwarded 事件坐标以窗口为原点（与页坐标一致）；转换到 sprite 坐标需扣减窗口余量；
    // 异常时退回屏幕坐标 - 窗口位置推导（hitRect/pos 均为 sprite 坐标）
    const wx = Number.isFinite(e.clientX) ? e.clientX : e.screenX - (this.pos.x - this.margin.l);
    const wy = Number.isFinite(e.clientY) ? e.clientY : e.screenY - (this.pos.y - this.margin.t);
    const px = wx - this.margin.l;
    const py = wy - this.margin.t;
    this.setInteractive(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  }

  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    if (this.paused) return; // [dsh-pet-android] 暂停态忽略点击回应（恢复后继续）
    this.stopThrow(); // 点击飞行中的宠物 = 收手停住（再播点击回应）
    this.stopMove();
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // 等新点击动画切到前台后 Q 弹（压新首帧，与浏览器一致）
    this.playOnce(S.pick(this.animations.clicks));
  }

  // ---- 右键菜单（统一自绘组件：树+渲染都来自 shared-core 的同一份 menu 模块） ----
  onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // 菜单弹出前停住飞行中的宠物
    this.stopMove(); // 菜单悬停期间宠物不漫游
    // [dsh-pet-android] 根级工具项：暂停/恢复 + 设置 + 退出（open-site/show-balance/home 已按独立版方案删除）
    const tools = [
      { label: this.paused ? '恢复动画' : '暂停动画', action: 'toggle-pause' },
      { label: '设置', action: 'shell-settings' },
      { label: '退出', action: 'shell-exit' },
    ];
    // [dsh-pet-android] events（余额档位）不进菜单：独立 APK 无余额事件，
    // 配置保留 events 段仅为上游校验兼容（P1 再做共享层真删）。
    const tree = tools.concat(S.buildMenuTree(Object.assign({}, this.animations, { events: {} })));
    console.log('[dsh-pet] menu tree=' + tree.length + ' groups=' +
      (tree.length > 3 ? tree[3].children.length : 0) +
      ' idle=' + this.animations.idle.length + ' cats=' + this.animations.categories.length +
      ' innerH=' + window.innerHeight + ' innerW=' + window.innerWidth);
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // 菜单是窗口内 DOM：悬停期间整窗保持可交互，关闭后恢复命中区穿透
    window.__dshPetDebug.menuOpen = true;
    // [dsh-pet-android] 菜单防系统栏遮挡：视口底 inset = 窗口底超出工作区（导航栏）的高度
    const menuInset = Math.max(0, this.pos.y + this.winH + this.margin.b - VIEW.h);
    window.__dshPetMenuBottomInset = menuInset;
    document.documentElement.style.setProperty('--dshpet-menu-inset', menuInset + 'px');
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      onAction: (leaf) => this.onMenuAction(leaf),
      // 菜单被点外/Esc 关闭（非菜单项路径）：同样复位可交互标记，恢复命中区判定
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.setInteractive(false); // [dsh-pet-android] 菜单关闭即收回交互窗（原生缩回身体命中区）
      },
    });
    this.menuClose = m.close;
  }

  onMenuAction(leaf) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    // [dsh-pet-android] 壳级动作：暂停/恢复（renderer 内实现），设置/退出（经桥转交原生壳）
    if (leaf.action === 'toggle-pause') {
      this.togglePause();
      return;
    }
    if (leaf.action === 'shell-settings' || leaf.action === 'shell-exit') {
      if (window.petBridge && window.petBridge.shellAction) window.petBridge.shellAction(leaf.action);
      return;
    }
    if (!leaf.anim) return;
    // 文字类（noMirror）朝右站姿是镜像的：点播前强制朝左，避免文字镜像（与浏览器随机链"朝右不选文字"同语义）
    if (S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // 点播移动动画：走真实移动（与随机游走同一套：边界检查 / 随机距离 / leadSec·tailSec / dir），
    // 仅"选哪个动画"由菜单决定；挪不动（false）退化纯播放
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      if (this.tryMove(leaf.anim) === false) this.playOnce(leaf.anim);
      return;
    }
    this.playOnce(leaf.anim);
  }

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.setInteractive(false); // [dsh-pet-android] 菜单项点击路径同样收回交互窗
  }

  // 「查看余额」菜单：立即拉取余额并展示（不需要等 1s 触发轮询；展示走 showBalanceNow 同一路径）
  showBalanceFromMenu() {
    if (!this.pet.balanceEnabled) return;
    S.fetchBalanceState(BALANCE_URL)
      .then((state) => {
        balance = state;
        window.__dshPetDebug.lastBalanceOk = state && state.ok === true;
        if (state.ok) {
          this.showBalanceNow(state);
        } else {
          console.error(
            '[dsh-pet] 菜单查看余额失败 reason=' + state.reason + (state.message ? ' ' + state.message : ''),
          );
        }
      })
      .catch((e) => {
        console.error('[dsh-pet] 菜单查看余额异常', e);
      });
  }

  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }

  // [dsh-pet-android] 暂停/恢复动画链：暂停=停视频（ended 停发，链自然停摆）+ 停一切 rAF 驱动；
  // 恢复=前台视频续播，链从当前动画继续。菜单文案按 this.paused 切换；控制台经服务转发共用本方法。
  togglePause() {
    const front = this.front === 0 ? this.videoA : this.videoB;
    if (!front) return;
    if (!this.paused) {
      this.paused = true;
      this.stopThrow();
      this.stopDragFollow();
      this.stopMove();
      this.stopSquash();
      front.pause();
    } else {
      this.paused = false;
      front.play().catch(() => {});
    }
  }

  // ---- 余额事件（每只宠物按 balanceEnabled 门控；档位与气泡内容来自 shared） ----
  onBalanceTick(state, tick) {
    if (!this.pet.balanceEnabled) return; // 未启用余额功能 -> 该宠物对余额事件完全免疫（与浏览器一致）
    if (tick === 0 || tick === this.prevTick) return;
    this.prevTick = tick;
    this.showBalanceNow(state);
  }

  // 余额展示（档位动画 + 气泡）：周期轮询与菜单点播共用同一展示路径，视觉/行为严格一致
  showBalanceNow(state) {
    if (!state || !state.ok) return;
    const p = S.balancePercent(state);
    if (p === undefined) return; // 当前数据源没有百分比语义：不触发档位动画
    const pool = this.animations.events?.balance;
    if (!pool || pool.length === 0) {
      console.error('[dsh-pet] 配置缺少 animations.events.balance，无法播放余额事件动画');
      return;
    }
    const idx = S.balanceEventIndex(p);
    const name = pool[idx];
    if (!name) {
      console.error('[dsh-pet] balance 档位索引越界：p=' + p + ' idx=' + idx);
      return;
    }
    this.stopMove();
    this.bubbleOn = true;
    this.balanceView = S.balanceBubbleView(state);
    this.renderBubble();
    // 气泡 10s 定时消失（与动画解耦：即使动画被点击/拖拽打断，气泡也按时收起；重复触发先清旧定时器）
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubbleOn = false;
      this.renderBubble();
    }, BUBBLE_DURATION_MS);
    this.playOnce(name);
  }

  renderBubble() {
    if (!this.bubbleOn || !this.balanceView) {
      this.bubble.classList.remove('is-on');
      window.__dshPetDebug.lastBubbleTitle = '';
      return;
    }
    this.bubble.innerHTML = '';
    const rows = this.balanceView;
    const hasTier = rows.some((r) => r.role === 'tier');
    if (hasTier) {
      // deepseek 余额单行：余额（峰/谷）¥x — 档位字着色
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      for (const r of rows) {
        const span = document.createElement('span');
        if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
        span.textContent = r.text;
        line.appendChild(span);
      }
      this.bubble.appendChild(line);
    } else {
      for (const r of rows) {
        const div = document.createElement('div');
        if (r.role === 'error') div.className = 'pet-bub-err';
        else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
        else div.className = 'pet-bub-row';
        div.textContent = r.text;
        this.bubble.appendChild(div);
      }
    }
    this.bubble.classList.add('is-on');
    window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
  }
}

// ---------- 余额（容器统一拉取/触发，与浏览器 PetMulti 同一套路径） ----------
function startLoops() {
  if (loopsStarted) return;
  loopsStarted = true;

  // 是否存在启用余额功能的宠物：全禁用时跳过余额轮询（不拉取，避免无意义的周期请求——与浏览器一致）
  const anyBalanceEnabled = sprites.some((s) => s.pet.balanceEnabled);

  // 余额周期轮询：eventsRefreshSec.balance（秒），成功递增 balanceTick 触发事件动画
  if (anyBalanceEnabled) {
    const intervalMs = Math.max(1000, (config.eventsRefreshSec?.balance ?? 1800) * 1000);
    const balanceLoop = async () => {
      try {
        const state = await S.fetchBalanceState(BALANCE_URL);
        balance = state;
        window.__dshPetDebug.lastBalanceOk = state && state.ok === true;
        if (state.ok) {
          balanceTick++;
          for (const s of sprites) s.onBalanceTick(state, balanceTick);
        } else if (state.reason !== 'unsupported') {
          console.error('[dsh-pet] 余额查询失败 reason=' + state.reason + (state.message ? ' ' + state.message : ''));
        }
      } catch (e) {
        console.error('[dsh-pet] 余额拉取异常', e);
      }
      setTimeout(() => void balanceLoop(), intervalMs);
    };
    void balanceLoop();
  }

  // 手动 /balance 触发：1s 轻量轮询触发计数（端点已禁止缓存），计数变化且余额启用时立即刷新余额并递增 tick
  let triggerBaseline = null;
  const triggerLoop = async () => {
    try {
      const count = await S.fetchTriggerCount(TRIGGER_URL);
      if (count < 0) return;
      if (triggerBaseline === null) {
        triggerBaseline = count; // 首次仅记基线：避免启动时重放历史触发
      } else if (count !== triggerBaseline) {
        triggerBaseline = count;
        if (anyBalanceEnabled) {
          const state = await S.fetchBalanceState(BALANCE_URL);
          balance = state;
          if (state.ok) {
            balanceTick++;
            for (const s of sprites) s.onBalanceTick(state, balanceTick);
          } else {
            console.error(
              '[dsh-pet] 手动触发余额查询失败 reason=' + state.reason + (state.message ? ' ' + state.message : ''),
            );
          }
        }
      }
    } catch {
      /* 轻量轮询失败静默：下一周期再试 */
    }
    setTimeout(() => void triggerLoop(), 1000);
  };
  if (anyBalanceEnabled) void triggerLoop();
}

// ---------- 启动（配置校验通过才建 sprite；失败大声报错 + 5s 自动重试） ----------
async function boot() {
  try {
    const cfg = await loadConfig();
    config = cfg;
    hideError();
    const pets = cfg.pets.filter((p) => S.isDesktopVisible(p.display));
    if (pets.length === 0) {
      showError('配置中没有 display 为 desktop/both 的宠物，桌面模式不显示宠物');
      scheduleReboot();
      return;
    }
    // 本窗口只承载一只宠物：petIndex 由主进程按 DSH_PET_PETS 顺序注入
    const pet = pets[CONFIG.petIndex];
    if (!pet) {
      showError('petIndex=' + CONFIG.petIndex + ' 超出桌面宠物列表（共 ' + pets.length + ' 只），本窗口不创建宠物');
      scheduleReboot();
      return;
    }
    for (const s of sprites) s.dispose();
    sprites = [new PetSprite(pet, cfg)];
    window.__dshPetDebug.configOk = true;
    window.__dshPetDebug.spriteCount = sprites.length;
    for (const s of sprites) s.playIdle();
    startLoops();
  } catch (e) {
    showError('配置加载失败：' + (e && e.message ? String(e.message) : String(e)));
    scheduleReboot();
  }
}

// 注入打字资源：气泡字体 + 点击/拖拽光标图标（与浏览器 overlay 同一套素材，host 经 /dsh-pet-7340/ 提供）
function injectAssets() {
  const style = document.createElement('style');
  style.textContent =
    // [dsh-pet-android] 软糖体走 AssetLoader 资产目录（configUrl 同源相对路径）；
    // 触摸设备无光标，cursor 图标删除（保留关键字兜底）。
    '@font-face{font-family:"ShangshouSoftCandy";src:url("' +
    new URL('fonts/' + encodeURIComponent('上首软糖体') + '.ttf', CONFIG.configUrl).href +
    '") format("truetype");font-display:swap;font-weight:400}' +
    '.pet-hit{cursor:grab}' +
    '.pet-hit.dragging{cursor:grabbing}';
  document.head.appendChild(style);
  // 统一右键菜单样式（与浏览器注入同一份 MENU_CSS）
  const menuStyle = document.createElement('style');
  // [dsh-pet-android] 菜单字体切换软糖体（保留字体的唯一消费者；回退系统字体）；
  // max-height 覆盖：MENU_CSS 的 62vh 按上游 281css 高窗设计，本壳视口仅 ~153css 高
  // （宠物窗 0.12 余量），62vh≈95px 会把根面板第 4 项（动作▸）裁进滚动区 —— 改为贴满视口；
  // 另扣 --dshpet-menu-inset（菜单打开时 renderer 写入的视口底部导航栏占用高）。
  menuStyle.textContent = S.MENU_CSS + ".dsh-pet-menu{font-family:'ShangshouSoftCandy','Microsoft YaHei UI','PingFang SC',sans-serif;font-size:14px}" +
    ".dsh-pet-menu-column{max-height:calc(100vh - var(--dshpet-menu-inset,0px) - 6px);box-shadow:none}" +
    ".dsh-pet-menu-item{padding:3px 10px;line-height:1.4}";
  document.head.appendChild(menuStyle);
}

// 工作区尺寸由主进程注入并在进程生命周期内不变；窗口本身跟随宠物移动，
// 这里仍兜底处理窗口内容区尺寸异常的情况（按当前窗口位置重新规整）。
window.addEventListener('resize', () => {
  for (const s of sprites) s.position();
});

injectAssets();
void boot();
