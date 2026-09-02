// [dsh-pet-android] Electron preload 桥的 WebView 等价物 + 原生手势的合成事件注入器。
// 坐标系：视觉窗视口 CSS px（原生 GestureRelayView 用 raw 坐标换算，与窗口漂移无关）。
//
// pointer 系列直接派发到 .pet-hit —— 等价 Electron 的 pointer capture 语义
// （拖拽期指针可以离开身体；renderer 只用 screenX/Y 增量，窗口移动不影响判定）。
// 菜单期走 elementFromPoint → .dsh-pet-menu-item：
//   mouseenter 派发到项本体（不冒泡，悬停展开分支子面板）；
//   tap = mousedown/mouseup/click（叶子激活；点外时 mousedown 冒泡到 document 触发菜单关闭）。
(function () {
  'use strict';
  var native = window.AndroidPetBridge;
  window.petBridge = {
    setBounds: function (x, y, w, h) { if (native) native.setBounds(x, y, w, h); },
    setInteractive: function (flag) { if (native) native.setInteractive(!!flag); },
    openDshSite: function () {}, // 独立 APK 已删除（无 DSH 网站）
    shellAction: function (name) { if (native) native.shellAction(String(name)); },
  };

  function hitEl() {
    return document.querySelector('.pet-hit');
  }

  // 排障开关：置 true 后逐事件打印合成事件/命中目标（拖拽期会刷屏，平时关闭）
  var SHIM_DEBUG = false;
  function slog(msg) { if (SHIM_DEBUG) console.log('[dsh-pet-shim] ' + msg); }

  window.__dshPetSynthetic = function (type, x, y, a4, a5) {
    slog('synthetic ' + type + ' @' + Math.round(x) + ',' + Math.round(y) +
      (typeof a4 === 'number' ? (type === 'menuscroll' ? ' dy=' + Math.round(a4) : ' sx=' + Math.round(a4)) : ''));
    // a4/a5：menuscroll 时 a4=滚动增量；其余为全局屏幕 CSS px（renderer 拖拽增量依赖，
    // 语义同 Electron MouseEvent.screenX——绝不能用视口坐标冒充，否则窗口跟随形成反馈环拖拽半速）
    var gx = typeof a4 === 'number' && isFinite(a4) && type !== 'menuscroll' ? a4 : x + 10000;
    var gy = typeof a5 === 'number' && isFinite(a5) ? a5 : y + 10000;
    function baseOpts(px, py) {
      return {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: px,
        clientY: py,
        screenX: gx,
        screenY: gy,
      };
    }
    if (type === 'menuscroll') {
      var sc = document.elementFromPoint(x, y);
      var col = sc && sc.closest ? sc.closest('.dsh-pet-menu-column') : null;
      if (col) col.scrollTop -= a4;
      return;
    }
    if (type === 'pointerdown' || type === 'pointermove') {
      var t = hitEl();
      if (!t) return;
      t.dispatchEvent(new PointerEvent(type, Object.assign(baseOpts(x, y), {
        pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
      })));
      return;
    }
    if (type === 'pointerup') {
      // renderer 在 window 上监听 pointerup（无需命中元素）
      window.dispatchEvent(new PointerEvent('pointerup', Object.assign(baseOpts(x, y), {
        bubbles: false, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 0,
      })));
      return;
    }
    if (type === 'contextmenu') {
      var t2 = hitEl();
      slog('contextmenu target=' + (t2 ? t2.className || t2.tagName : 'null'));
      if (SHIM_DEBUG) {
        try {
          var s0 = (typeof sprites !== 'undefined' && sprites && sprites[0]) || null;
          var a = s0 && s0.animations;
          var tr = a && window.PetShared
            ? window.PetShared.buildMenuTree(Object.assign({}, a, { events: {} }))
            : null;
          slog('probe sprite=' + !!s0 +
            ' idle=' + (a && a.idle ? a.idle.length : 'NA') +
            ' cats=' + (a && a.categories ? a.categories.length : 'NA') +
            ' moves=' + (a && a.moves && a.moves.actions ? a.moves.actions.length : 'NA') +
            ' tree=' + (tr ? tr.length : 'NA') +
            ' groups=' + (tr && tr.length ? tr[0].children.length : 'NA'));
        } catch (e) {
          console.error('[dsh-pet-shim] probe err: ' + (e && e.message));
        }
      }
      if (!t2) return;
      t2.dispatchEvent(new MouseEvent('contextmenu', Object.assign(baseOpts(x, y), { button: 2 })));
      return;
    }
    if (type === 'mouseenter') {
      var el = document.elementFromPoint(x, y);
      var item = el && el.closest ? el.closest('.dsh-pet-menu-item') : null;
      if (item) {
        item.dispatchEvent(new MouseEvent('mouseenter', {
          bubbles: false, cancelable: false, clientX: x, clientY: y,
        }));
      }
      return;
    }
    if (type === 'tap') {
      var el2 = document.elementFromPoint(x, y) || document.body;
      var item = el2.closest && el2.closest('.dsh-pet-menu-item');
      var o = baseOpts(x, y);
      if (item) {
        // 触屏模型：点按分支 = 展开（转译 mouseenter，绝不 click）；点叶子 = 激活
        if (item.classList.contains('dsh-pet-menu-branch')) {
          slog('tap branch="' + (item.textContent || '').trim().slice(0, 8) + '" -> mouseenter');
          item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, clientX: x, clientY: y }));
        } else {
          slog('tap leaf="' + (item.textContent || '').trim().slice(0, 8) + '"');
          item.dispatchEvent(new MouseEvent('mousedown', o));
          item.dispatchEvent(new MouseEvent('mouseup', o));
          item.dispatchEvent(new MouseEvent('click', o));
        }
      } else {
        // 点外：mousedown 冒泡到 document → renderer 菜单关闭
        slog('tap outside el=' + (el2.className && typeof el2.className === 'string' ? el2.className : el2.tagName));
        el2.dispatchEvent(new MouseEvent('mousedown', o));
        // [dsh-pet-android] 点在宠物身上（含菜单开着的宠物区域）= 完整 tap 三连：
        // renderer 的点击回应绑在 click 上（hit.addEventListener('click')），
        // 只发 mousedown 会吞掉回应——此回归自菜单触屏模型改版起存在
        if (el2.closest && el2.closest('.pet-hit')) {
          el2.dispatchEvent(new MouseEvent('mouseup', o));
          el2.dispatchEvent(new MouseEvent('click', o));
        }
      }
    }
  };
  // 菜单关闭路径取证：任何文档级 mousedown（捕获）都记录其命中目标（仅 SHIM_DEBUG）
  document.addEventListener('mousedown', function (e) {
    if (!SHIM_DEBUG) return;
    var t = e.target;
    var d = t && t.className && typeof t.className === 'string' ? t.className : (t ? t.tagName : 'null');
    console.log('[dsh-pet-shim] doc-mousedown on ' + d + (t && t.textContent ? ' "' + t.textContent.trim().slice(0, 8) + '"' : ''));
  }, true);
  document.addEventListener('click', function (e) {
    if (!SHIM_DEBUG) return;
    var t = e.target;
    var d = t && t.className && typeof t.className === 'string' ? t.className : (t ? t.tagName : 'null');
    console.log('[dsh-pet-shim] doc-click on ' + d + (t && t.textContent ? ' "' + t.textContent.trim().slice(0, 8) + '"' : ''));
  }, true);
})();
