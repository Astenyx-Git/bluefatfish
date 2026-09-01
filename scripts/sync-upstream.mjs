#!/usr/bin/env node
// sync-upstream.mjs —— dsh-pet-android 的唯一权威资产变换脚本。
// 从上游 dsh-pet 仓库生成 app/src/main/assets/*，全部变换基于逐字锚点
// （锚点未命中/不唯一立即失败，防止上游更新后静默产出错误资产）。
//
// 变换清单（对应 PLAN.md「上游fork」节）：
//   ① VIEW.h 扣减 gestureInset（手势区不可驻留）
//   ② WINDOW_MARGIN_RATIO 0.5 → 0.12（气泡已删）
//   ③ 根级工具项：打开网站/查看余额/回到初始位置 → 暂停动画/恢复 + 设置 + 退出
//   ④ 菜单树过滤 events（余额档位不进菜单；配置保留 events 仅为上游校验兼容）
//   ⑤ 菜单关闭（onClose/closeMenu）→ setInteractive(false) 收回交互窗
//   ⑥ onMenuAction：壳级动作（toggle-pause 内部实现；shell-settings/shell-exit 经桥转交）
//   ⑦ 新增 togglePause()（暂停/恢复动画链）；暂停态忽略点击回应
//   ⑧ 软糖体 URL → configUrl 同源相对路径；cursor 图标删除；菜单字体切换软糖体
//   ⑨ index.html：注入 bridge-shim.js + viewport
//   ⑩ config.jsonc 瘦身（单宠物 main/size 180/balanceEnabled false，animations 原样继承），
//     经 shared-core 的 assertClientConfig 校验后落盘
//   ⑪ 同步素材：webm（剔除 6 个余额档位）→ thumb/main/，软糖体 → fonts/，shared-core.js
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // dsh-pet-android/scripts/
const root = resolve(here, '..'); // dsh-pet-android/
const upstream = resolve(root, '../dsh-pet/dsh-pet'); // 上游仓库根
const helper = join(upstream, 'runtime/electron-helper');
const assets = join(root, 'app/src/main/assets');

// ---- 装载 shared-core.js（IIFE；在 Node 里造一个 window 完成装载）----
const core = readFileSync(join(helper, 'shared-core.js'), 'utf8');
const win = {};
const S = new Function('window', core + '\n;return typeof PetShared !== "undefined" ? PetShared : window.PetShared;')(win);
if (!S || typeof S.assertClientConfig !== 'function' || typeof S.stripJsonc !== 'function') {
  throw new Error('shared-core.js 装载失败（缺 PetShared/stripJsonc/assertClientConfig）');
}

function patch(file, pairs) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of pairs) {
    const n = t.split(from).length - 1;
    if (n !== 1) throw new Error(`锚点命中 ${n} 次（需恰 1 次）: ${from.slice(0, 70).replace(/\n/g, '\\n')}`);
    t = t.replace(from, to);
  }
  return t;
}

// ---- ① renderer.js fork ----
const rendererPatches = [
  // ① 手势区 inset：视口可用高扣减 → 漫游边界/抛掷地面/底部锚点整体上移
  [
    `const VIEW = {
  w: Number(params.get('workAreaW') || (window.screen && window.screen.availWidth) || 1920),
  h: Number(params.get('workAreaH') || (window.screen && window.screen.availHeight) || 1080),
};`,
    `const VIEW = {
  w: Number(params.get('workAreaW') || (window.screen && window.screen.availWidth) || 1920),
  h: Number(params.get('workAreaH') || (window.screen && window.screen.availHeight) || 1080),
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
})();`,
  ],
  // ② 气泡已删，外扩余量收窄（与 WindowController.MARGIN_RATIO 保持一致）
  [
    'const WINDOW_MARGIN_RATIO = 0.5;',
    'const WINDOW_MARGIN_RATIO = 0.12; // [dsh-pet-android] 气泡已删，余量仅为菜单预留（与 WindowController.MARGIN_RATIO 同步）',
  ],
  // ③ 根级工具项替换 + ④ events 过滤
  [
    `    // 桌面专属工具根项（打开网站 / 查看余额 / 回到初始位置）+ 共享菜单树（动作→分类→具体动画）
    const tools = [{ label: '打开网站', action: 'open-site' }];
    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });
    tools.push({ label: '回到初始位置', action: 'home' });
    const tree = tools.concat(S.buildMenuTree(this.animations));`,
    `    // [dsh-pet-android] 根级工具项：暂停/恢复 + 设置 + 退出（open-site/show-balance/home 已按独立版方案删除）
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
      ' innerH=' + window.innerHeight + ' innerW=' + window.innerWidth);`,
  ],
  // ④b 菜单打开时上报「视口底部被系统导航栏占用的 inset」并写入 CSS 变量：
  //   窗口底（sprite底+bottomPad+余量）超出工作区 = 压进导航栏，菜单夹取/限高据此收缩。
  //   菜单打开期间宠物停驻（stopMove/stopThrow），此值在整次菜单会话内有效。
  [
    `    const m = S.mountContextMenu({`,
    `    // [dsh-pet-android] 菜单防系统栏遮挡：视口底 inset = 窗口底超出工作区（导航栏）的高度
    const menuInset = Math.max(0, this.pos.y + this.winH + this.margin.b - VIEW.h);
    window.__dshPetMenuBottomInset = menuInset;
    document.documentElement.style.setProperty('--dshpet-menu-inset', menuInset + 'px');
    const m = S.mountContextMenu({`,
  ],
  // ⑤ 菜单点外/Esc 关闭路径 → 收回交互窗
  [
    `      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
      },`,
    `      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.setInteractive(false); // [dsh-pet-android] 菜单关闭即收回交互窗（原生缩回身体命中区）
      },`,
  ],
  // ⑥ onMenuAction 壳级动作
  [
    `    if (leaf.action === 'open-site') {
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN); // 系统默认浏览器打开（等效 Ctrl+点击链接）
      return;
    }
    if (leaf.action === 'show-balance') {
      this.showBalanceFromMenu(); // 立即拉余额并展示（无需等 1s 触发轮询，展示路径与周期触发一致）
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // 停漫游/移动，清会话位置，回配置角落
      return;
    }`,
    `    // [dsh-pet-android] 壳级动作：暂停/恢复（renderer 内实现），设置/退出（经桥转交原生壳）
    if (leaf.action === 'toggle-pause') {
      this.togglePause();
      return;
    }
    if (leaf.action === 'shell-settings' || leaf.action === 'shell-exit') {
      if (window.petBridge && window.petBridge.shellAction) window.petBridge.shellAction(leaf.action);
      return;
    }`,
  ],
  // ⑤ 菜单项点击路径（closeMenu）→ 收回交互窗（setInteractive 幂等，与 onClose 路径去重）
  [
    `    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
  }`,
    `    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.setInteractive(false); // [dsh-pet-android] 菜单项点击路径同样收回交互窗
  }`,
  ],
  // ⑦ togglePause 方法（挂 goHome 之后；paused 惰性初始化，不改构造器）
  [
    `  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  }`,
    `  // 「回到初始位置」菜单：停掉漫游/移动，清掉拖拽/漫游留下的会话位置，回到配置角落
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
  }`,
  ],
  // ⑦ 暂停态忽略点击回应（防止恢复后动画链状态错乱）
  [
    `  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;`,
    `  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    if (this.paused) return; // [dsh-pet-android] 暂停态忽略点击回应（恢复后继续）`,
  ],
  // ⑧ 软糖体 URL → configUrl 同源相对路径；cursor 图标删除（触摸设备无光标）
  [
    `  style.textContent =
    '@font-face{font-family:"ShangshouSoftCandy";src:url("' +
    ORIGIN +
    '/dsh-pet-7340/font/' +
    encodeURIComponent('上首软糖体') +
    '.ttf") format("truetype");font-display:swap;font-weight:400}' +
    '.pet-hit{cursor:url("' +
    ORIGIN +
    '/dsh-pet-7340/pic/cursor-grab.png") 16 16, grab}' +
    '.pet-hit.dragging{cursor:url("' +
    ORIGIN +
    '/dsh-pet-7340/pic/cursor-grabbing.png") 16 16, grabbing}';`,
    `  style.textContent =
    // [dsh-pet-android] 软糖体走 AssetLoader 资产目录（configUrl 同源相对路径）；
    // 触摸设备无光标，cursor 图标删除（保留关键字兜底）。
    '@font-face{font-family:"ShangshouSoftCandy";src:url("' +
    new URL('fonts/' + encodeURIComponent('上首软糖体') + '.ttf', CONFIG.configUrl).href +
    '") format("truetype");font-display:swap;font-weight:400}' +
    '.pet-hit{cursor:grab}' +
    '.pet-hit.dragging{cursor:grabbing}';`,
  ],
  // ⑧ 菜单字体切换软糖体（保留字体的唯一消费者）+ 小视口适配（限高扣导航栏 inset、
  //    去 28px 大阴影——小屏上读作暗色底、行高收紧让根面板 4 行在净空内完整放下）
  [
    `  const menuStyle = document.createElement('style');
  menuStyle.textContent = S.MENU_CSS;`,
    `  const menuStyle = document.createElement('style');
  // [dsh-pet-android] 菜单字体切换软糖体（保留字体的唯一消费者；回退系统字体）；
  // max-height 覆盖：MENU_CSS 的 62vh 按上游 281css 高窗设计，本壳视口仅 ~153css 高
  // （宠物窗 0.12 余量），62vh≈95px 会把根面板第 4 项（动作▸）裁进滚动区 —— 改为贴满视口；
  // 另扣 --dshpet-menu-inset（菜单打开时 renderer 写入的视口底部导航栏占用高）。
  menuStyle.textContent = S.MENU_CSS + ".dsh-pet-menu{font-family:'ShangshouSoftCandy','Microsoft YaHei UI','PingFang SC',sans-serif;font-size:14px}" +
    ".dsh-pet-menu-column{max-height:calc(100vh - var(--dshpet-menu-inset,0px) - 6px);box-shadow:none}" +
    ".dsh-pet-menu-item{padding:3px 10px;line-height:1.4}";`,
  ],
  // ⑨ 松手夹取：手机无托盘兜底，宠物不得被拖出工作区/藏进系统栏底下
  //    （throwBounds 的 H 已扣除 gestureInset；夹取边界 = 抛掷物理同款，宠物保持原位置下限）
  [
    `        // customPos 语义 = 宠物**中心**比例（position() 用 rx*W - halfW 还原左上角；
        // startThrow 落定也按同一公式存），松手无边界夹取
        this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };`,
    `        // [dsh-pet-android] 松手夹取：桌面拖出屏幕可经托盘找回，手机没有兜底——
        // 按抛掷同款边界夹回（px/py = sprite 左上角，与抛掷物理同坐标系），位置下限不变
        const relB = S.throwBounds({ W: VIEW.w, H: VIEW.h, size: this.size, sideAllow: this.sideAllow });
        const relX = Math.min(Math.max(px, relB.minX), relB.maxX);
        const relY = Math.min(Math.max(py, relB.minY), relB.maxY);
        this.customPos = { rx: (relX + this.halfW) / VIEW.w, ry: (relY + this.halfH) / VIEW.h };`,
  ],
];
const patchedRenderer = patch(join(helper, 'renderer.js'), rendererPatches);

// ---- ⑨ index.html fork ----
const indexHtml = patch(join(helper, 'index.html'), [
  [
    '</head>',
    `  <!-- [dsh-pet-android] 触口视口：禁止缩放/双击放大（合成事件坐标系 = 视口 CSS px） -->
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
</head>`,
  ],
  [
    '<script src="./shared-core.js"></script>',
    `  <!-- [dsh-pet-android] preload 桥等价物：window.petBridge + 合成事件注入器（先于 shared-core 装载） -->
  <script src="./bridge-shim.js"></script>
  <script src="./shared-core.js"></script>`,
  ],
]);

// ---- ⑩ config.jsonc 瘦身 + 校验 ----
const rawCfg = JSON.parse(S.stripJsonc(readFileSync(join(upstream, 'assets/config.jsonc'), 'utf8')));
const slim = {
  notificationsEnabled: false,
  pets: [
    {
      id: 'main',
      size: 180,
      balanceEnabled: false,
      display: 'both',
      position: { corner: 'bottom-right', marginX: 16, marginY: 48 },
    },
  ],
  animations: rawCfg.animations,
  animationWeights: rawCfg.animationWeights,
  eventsRefreshSec: rawCfg.eventsRefreshSec,
};
S.assertClientConfig(slim); // 上游校验器兜底：字段形状不对立即失败

// ---- 落盘 assets ----
mkdirSync(assets, { recursive: true });
writeFileSync(join(assets, 'renderer.js'), patchedRenderer, 'utf8');
writeFileSync(join(assets, 'index.html'), indexHtml, 'utf8');
writeFileSync(join(assets, 'config.jsonc'), JSON.stringify(slim, null, 1), 'utf8');
// shared-core fork：菜单面板夹取避开视口底部被系统导航栏占用的部分
// （__dshPetMenuBottomInset 由 renderer 在菜单打开时写入；rolldown 产物为 tab+双引号）
// + 重力倍率/空气阻尼（设置页拖动条 → renderer URL 参数 gm / ACTION_SET_GRAVITY 实时覆盖）
const sharedCorePatched = patch(join(helper, 'shared-core.js'), [
  [
    "const GRAVITY = 1400;",
    "const GRAVITY = 1400;\nconst AIR_DRAG = 0.35; // [dsh-pet-android] 轻度空气阻尼（零重力/低重力滑行制动）",
  ],
  [
    "\tvy += GRAVITY * dt;",
    "\tvy += GRAVITY * (window.__dshPetGravityMult ?? 1) * dt; // [dsh-pet-android] 重力倍率\n\tconst dragK = Math.max(0, 1 - AIR_DRAG * dt); // [dsh-pet-android] 空气阻尼：速度按帧衰减\n\tvx *= dragK;\n\tvy *= dragK;",
  ],
  [
    "\tconst atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1;",
    "\tconst gm0 = (window.__dshPetGravityMult ?? 1) === 0; // [dsh-pet-android] 零重力：速度耗尽即原地悬停（无地面可触）\n\tconst atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1 || gm0 && speed < REST_VX;",
  ],
  [
    "\t\tif (top + panel.offsetHeight > vh - 4) top = Math.max(4, vh - 4 - panel.offsetHeight);",
    "\t\tconst mbi = window.__dshPetMenuBottomInset || 0; // [dsh-pet-android] 视口底系统栏占用\n\t\tif (top + panel.offsetHeight > vh - mbi - 4) top = Math.max(4, vh - mbi - 4 - panel.offsetHeight);",
  ],
  [
    '\trootPanel.style.top = Math.max(4, Math.min(y, window.innerHeight - rh - 4)) + "px";',
    '\trootPanel.style.top = Math.max(4, Math.min(y, window.innerHeight - (window.__dshPetMenuBottomInset || 0) - rh - 4)) + "px"; // [dsh-pet-android] 扣视口底导航栏占用',
  ],
]);
writeFileSync(join(assets, 'shared-core.js'), sharedCorePatched, 'utf8');

// ---- ⑪ 素材：webm（剔除 6 个余额档位）→ thumb/main/；软糖体 → fonts/ ----
const thumbDir = join(assets, 'thumb/main');
rmSync(thumbDir, { recursive: true, force: true });
mkdirSync(thumbDir, { recursive: true });
const webmSrc = join(upstream, 'assets/webm');
const excluded = [];
let copied = 0;
for (const name of readdirSync(webmSrc)) {
  if (!name.endsWith('.webm')) continue;
  if (name.startsWith('余额-')) {
    excluded.push(name);
    continue;
  }
  copyFileSync(join(webmSrc, name), join(thumbDir, name));
  copied++;
}
const fontsDir = join(assets, 'fonts');
mkdirSync(fontsDir, { recursive: true });
const fontSrc = join(upstream, 'assets/fonts/上首软糖体.ttf');
if (!existsSync(fontSrc)) throw new Error('上游字体缺失: ' + fontSrc);
copyFileSync(fontSrc, join(fontsDir, '上首软糖体.ttf'));

console.log('[sync-upstream] renderer.js / index.html / config.jsonc / shared-core.js ✓');
console.log('[sync-upstream] webm:', copied, '个已同步，余额档位剔除', excluded.length, '个:', excluded.join('、'));
console.log('[sync-upstream] 字体 ✓ 上首软糖体.ttf');
