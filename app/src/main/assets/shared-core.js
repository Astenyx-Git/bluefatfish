var PetShared = (function(exports) {

"use strict";

//#region src/shared/constants.ts
const CANVAS_H = 360;
const FEET_Y = 330;
const HIT_BOX = {
	x0: 200,
	y0: 50,
	x1: 440,
	y1: 335
};
const DRAG_THRESHOLD = 5;
const PET_REF_WIDTH = 462;

//#endregion
//#region src/shared/pickers.ts
const pick = (pool, exclude) => {
	const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
	const src = entries.length ? entries : pool;
	return src[Math.floor(Math.random() * src.length)];
};
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
const pickWeightedCategory = (categories, facing) => {
	const cats = categories.filter((c) => c.actions.length > 0);
	if (!cats.length) return null;
	const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
	const eligible = filtered.length ? filtered : cats;
	const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
	let t = Math.random() * totalW;
	for (const c of eligible) {
		t -= c.weight;
		if (t <= 0) return c;
	}
	return eligible[eligible.length - 1];
};
const rollKind = (roll, w) => {
	const topEnd = (w.idle + w.turn + w.move) / 100;
	if (roll < w.idle / 100) return "idle";
	if (roll < (w.idle + w.turn) / 100) return "turn";
	if (roll < topEnd) return "move";
	return "action";
};
const pickCategoryAction = (categories, idlePool, facing, current) => {
	const cat = pickWeightedCategory(categories, facing);
	if (!cat) return {
		id: "FALLBACK",
		name: pick(idlePool, current)
	};
	return {
		id: cat.id,
		name: pick(cat.actions, current)
	};
};

//#endregion
//#region src/shared/motion.ts
const planMove = (o) => {
	const side = o.sideAllow ?? 0;
	const distance = randomBetween(o.minDist, o.maxDist);
	const target = o.cx + o.dir * distance;
	const leftBound = o.margin + o.halfW - side;
	const rightBound = o.W - o.margin - o.halfW + side;
	if (target < leftBound || target > rightBound) return null;
	return {
		startRatio: o.cx / o.W,
		startYRatio: o.cy / o.H,
		targetRatio: target / o.W,
		totalRatio: Math.abs(target - o.cx) / o.W
	};
};
const anchorPixel = (o) => {
	const height = o.size * 9 / 16;
	switch (o.corner) {
		case "top-left": return {
			x: o.marginX,
			y: o.marginY
		};
		case "top-right": return {
			x: o.W - o.size - o.marginX,
			y: o.marginY
		};
		case "bottom-left": return {
			x: o.marginX,
			y: o.H - height - o.marginY
		};
		case "bottom-right": return {
			x: o.W - o.size - o.marginX,
			y: o.H - height - o.marginY
		};
	}
};

//#endregion
//#region src/shared/balance.ts
const TIMEOUT_MS = 2e4;
const RETRIES = 2;
/** 带超时 + 重试的 GET（host 已内置重试，这里再兜底网络抖动）。
*  浏览器传默认相对路径；桌面模式（Electron，file:// 页面）传绝对 URL。 */
async function getWithRetry(url) {
	let last;
	for (let i = 0; i <= RETRIES; i++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
			if (res.ok) return res;
			last = new Error("HTTP " + res.status);
		} catch (e) {
			last = e;
		}
		if (i < RETRIES) await new Promise((r) => setTimeout(r, 600));
	}
	throw last instanceof Error ? last : new Error(String(last));
}
async function fetchBalanceState(baseUrl = "/dsh-pet-7340/balance") {
	const res = await getWithRetry(baseUrl);
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 余额响应非法");
	const provider = String(raw.provider ?? "unknown");
	if (raw.ok !== true) {
		const reason = raw.reason === "unsupported" || raw.reason === "credential-missing" || raw.reason === "fetch-error" ? raw.reason : "fetch-error";
		return {
			provider,
			ok: false,
			reason,
			message: typeof raw.message === "string" ? raw.message : void 0
		};
	}
	if (raw.kind === "opencode") {
		const d = raw.data;
		if (!d || typeof d !== "object") throw new Error("dsh-pet: opencode 数据非法");
		const rolling = Number(d.rolling);
		const weekly = Number(d.weekly);
		const monthly = Number(d.monthly);
		if (![
			rolling,
			weekly,
			monthly
		].every(Number.isFinite)) throw new Error("dsh-pet: opencode 百分比非数字");
		return {
			provider,
			kind: "opencode",
			ok: true,
			rolling,
			weekly,
			monthly,
			rollingResetsAt: typeof d.rollingResetsAt === "string" ? d.rollingResetsAt : void 0,
			weeklyResetsAt: typeof d.weeklyResetsAt === "string" ? d.weeklyResetsAt : void 0,
			monthlyResetsAt: typeof d.monthlyResetsAt === "string" ? d.monthlyResetsAt : void 0
		};
	}
	if (raw.kind === "deepseek") {
		const d = raw.data;
		if (!d || typeof d !== "object") throw new Error("dsh-pet: deepseek 数据非法");
		return {
			provider,
			kind: "deepseek",
			ok: true,
			currency: typeof d.currency === "string" ? d.currency : void 0,
			total: typeof d.total === "string" ? d.total : void 0,
			granted: typeof d.granted === "string" ? d.granted : void 0,
			toppedUp: typeof d.toppedUp === "string" ? d.toppedUp : void 0
		};
	}
	throw new Error("dsh-pet: 余额 kind 非法");
}
async function fetchTriggerCount(baseUrl = "/dsh-pet-7340/balance/trigger") {
	const res = await fetch(baseUrl, { cache: "no-store" });
	if (!res.ok) return -1;
	const data = await res.json().catch(() => null);
	return data && typeof data.count === "number" ? data.count : -1;
}
const DEEPSEEK_FULL_BALANCE_CNY = 20;
function balancePercent(v) {
	if (v.kind === "opencode") return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
	if (v.kind === "deepseek") {
		const total = Number(v.total);
		if (!Number.isFinite(total)) return void 0;
		const remaining = Math.max(0, total) / DEEPSEEK_FULL_BALANCE_CNY * 100;
		return Math.max(0, Math.min(100, 100 - remaining));
	}
	return void 0;
}
function balanceEventIndex(p) {
	if (p === 100) return 5;
	const i = Math.floor(p / 20);
	return i < 5 ? i : 4;
}
const OPENCODE_QUOTA_USD = {
	rolling: 12,
	weekly: 30,
	monthly: 60
};
const WINDOW_LABELS = {
	rolling: "5h",
	weekly: "周",
	monthly: "月"
};
function urgentWindow(v) {
	if (v.kind !== "opencode") return void 0;
	const windows = [
		"rolling",
		"weekly",
		"monthly"
	];
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	let best;
	for (const w of windows) {
		const percent = v[w] ?? 0;
		const quota = OPENCODE_QUOTA_USD[w];
		const remaining = quota * (100 - percent) / 100;
		const cand = {
			label: WINDOW_LABELS[w],
			percent,
			quotaUsd: quota,
			remainingUsd: remaining,
			resetsAt: resets[w]
		};
		if (best === void 0 || remaining < best.remainingUsd) best = cand;
	}
	return best;
}
function resetInText(iso) {
	if (!iso) return "";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "";
	const delta = t - Date.now();
	if (delta <= 0) return "已重置";
	const hoursF = delta / 36e5;
	if (hoursF >= 96) return (Math.round(hoursF / 24 * 10) / 10).toFixed(1) + " 天";
	return Math.max(.1, Math.round(hoursF * 10) / 10).toFixed(1) + " 小时";
}
function deepseekPricingTier(now = new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		weekday: "short",
		hour: "2-digit",
		hourCycle: "h23"
	}).formatToParts(now);
	const pick$1 = (type) => parts.find((p) => p.type === type)?.value;
	const weekday = pick$1("weekday");
	const hour = Number(pick$1("hour"));
	if (weekday === "Sat" || weekday === "Sun") return "idle";
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18 ? "peak" : "idle";
}
function balanceBubbleView(state) {
	if (state.ok) {
		if (state.kind === "opencode") {
			const w = urgentWindow(state);
			if (w) {
				const reset = resetInText(w.resetsAt);
				const rows = [{
					role: "label",
					text: w.label + "额度已用 " + Math.round(w.percent) + "%"
				}, {
					role: "sub",
					text: reset ? reset + "重置" : "已重置"
				}];
				return rows;
			}
			return [{
				role: "label",
				text: "额度数据不可用"
			}];
		}
		const tier = deepseekPricingTier();
		return [
			{
				role: "label",
				text: "余额（"
			},
			{
				role: "tier",
				tier,
				text: tier === "peak" ? "峰" : "谷"
			},
			{
				role: "label",
				text: "）¥" + (state.total ?? "-")
			}
		];
	}
	const msg = state.reason === "unsupported" ? "当前服务商暂不支持余额查询" : state.reason === "credential-missing" ? "缺少凭证：" + (state.message ?? "") : "余额查询失败";
	return [{
		role: "error",
		text: msg
	}];
}

//#endregion
//#region src/shared/config.ts
const stripJsonc = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^\\:])\/\/.*$/gm, "$1").trim();
const CORNERS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right"
];
/** corner 合法性检查用的 string 集合（Corner[] 的 includes 要求 Corner 参数，无法接收未知 string） */
const CORNER_SET = new Set(CORNERS);
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];
const PET_DISPLAY_SET = new Set(PET_DISPLAYS);
const isWebVisible = (display) => display === "web" || display === "both";
const isDesktopVisible = (display) => display === "desktop" || display === "both";
const EMPTY_CONF = {
	notificationsEnabled: true,
	pets: [],
	animations: {
		idle: [],
		turn: [],
		drag: [],
		clicks: [],
		moves: {
			default: {},
			actions: []
		},
		categories: [],
		events: {}
	},
	animationWeights: {
		idle: 0,
		turn: 0,
		move: 0
	},
	eventsRefreshSec: {}
};
function assertClientConfig(raw) {
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: config 非对象");
	const cfg = raw;
	return {
		notificationsEnabled: assertNotificationsEnabled(cfg),
		pets: assertPetsBlock(cfg.pets),
		animations: assertAnimationsBlock(cfg.animations),
		animationWeights: assertWeightsBlock(cfg.animationWeights),
		eventsRefreshSec: assertEventsRefreshSec(cfg.eventsRefreshSec)
	};
}
function assertPetsBlock(petsArr) {
	if (!Array.isArray(petsArr) || !petsArr.length) throw new Error("dsh-pet: 缺少 pets");
	const seen = new Set();
	const pets = [];
	for (const p of petsArr) {
		const id = String(p?.id ?? "");
		if (!id || seen.has(id)) throw new Error("dsh-pet: pet id 非法或重复「" + id + "」");
		const size = Number(p?.size);
		if (!Number.isFinite(size) || size <= 0) throw new Error("dsh-pet: pet「" + id + "」大小非法");
		const balanceEnabled = p?.balanceEnabled;
		if (typeof balanceEnabled !== "boolean") throw new Error("dsh-pet: pet「" + id + "」缺少 balanceEnabled（需为布尔值 true/false）");
		const display = p?.display;
		if (typeof display !== "string" || !PET_DISPLAY_SET.has(display)) throw new Error("dsh-pet: pet「" + id + "」缺少 display（需为 web/desktop/both/none 之一）");
		const corner = p?.position?.corner;
		if (typeof corner !== "string" || !CORNER_SET.has(corner)) throw new Error("dsh-pet: pet「" + id + "」corner 非法");
		const marginX = Number(p?.position?.marginX);
		const marginY = Number(p?.position?.marginY);
		if (!Number.isFinite(marginX) || !Number.isFinite(marginY)) throw new Error("dsh-pet: pet「" + id + "」边距非法");
		seen.add(id);
		pets.push({
			id,
			size,
			balanceEnabled,
			display,
			position: {
				corner,
				marginX,
				marginY
			}
		});
	}
	return pets;
}
/** 校验系统通知总开关（必填布尔值） */
function assertNotificationsEnabled(cfg) {
	const notificationsEnabled = cfg.notificationsEnabled;
	if (typeof notificationsEnabled !== "boolean") throw new Error("dsh-pet: 缺少 notificationsEnabled（需为布尔值 true/false）");
	return notificationsEnabled;
}
function assertAnimationsBlock(a) {
	if (!a || typeof a !== "object") throw new Error("dsh-pet: 缺少 animations");
	const anims = a;
	for (const key of [
		"idle",
		"turn",
		"drag",
		"clicks"
	]) if (!Array.isArray(anims[key])) throw new Error("dsh-pet: animations." + key + " 缺失");
	const moves = anims.moves;
	if (!moves || typeof moves !== "object" || typeof moves.default !== "object" || moves.default === null || !Array.isArray(moves.actions)) throw new Error("dsh-pet: animations.moves 结构非法");
	if (!Array.isArray(anims.categories)) throw new Error("dsh-pet: animations.categories 缺失");
	const ev = anims.events;
	if (!ev || typeof ev !== "object" || Array.isArray(ev)) throw new Error("dsh-pet: 缺少 animations.events");
	const evEntries = ev;
	for (const [eventName, pool] of Object.entries(evEntries)) {
		if (!Array.isArray(pool) || pool.length === 0) throw new Error("dsh-pet: animations.events." + eventName + " 必须是非空动画名数组");
		for (const name of pool) if (typeof name !== "string" || name.length === 0) throw new Error("dsh-pet: animations.events." + eventName + " 含非法动画名");
	}
	const balance = evEntries.balance;
	if (!Array.isArray(balance) || balance.length === 0) throw new Error("dsh-pet: animations.events.balance 缺失或为空（余额事件必备）");
	return a;
}
function assertWeightsBlock(w) {
	if (!w || typeof w !== "object") throw new Error("dsh-pet: 缺少 animationWeights");
	const weights = w;
	for (const key of [
		"idle",
		"turn",
		"move"
	]) {
		const v = Number(weights[key]);
		if (!Number.isFinite(v) || v < 0) throw new Error("dsh-pet: animationWeights." + key + " 非法");
		weights[key] = v;
	}
	return w;
}
/** 校验 eventsRefreshSec 段（事件名 → 正数秒数）；balance 周期必填 */
function assertEventsRefreshSec(raw) {
	const ers = raw;
	if (!ers || typeof ers !== "object" || Array.isArray(ers)) throw new Error("dsh-pet: 缺少 eventsRefreshSec");
	const cleaned = {};
	for (const [eventName, sec] of Object.entries(ers)) {
		const n = Number(sec);
		if (!Number.isFinite(n) || n <= 0) throw new Error("dsh-pet: eventsRefreshSec." + eventName + " 非法（需为正数秒）");
		cleaned[eventName] = n;
	}
	const balanceSec = cleaned.balance;
	if (balanceSec === void 0) throw new Error("dsh-pet: eventsRefreshSec.balance 缺失（余额事件周期必备）");
	return cleaned;
}
function assertExtraPetFile(raw, assetRoot) {
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet: 额外宠物配置非对象");
	const cfg = raw;
	return {
		pets: assertPetsBlock(cfg.pets).map((pet) => ({
			...pet,
			assetRoot
		})),
		animations: assertAnimationsBlock(cfg.animations),
		animationWeights: assertWeightsBlock(cfg.animationWeights)
	};
}
const mergeExtraPets = (base, extra) => [...base, ...extra.map((e) => ({
	...e,
	extra: true
}))];
function resolvePets(defaults, user) {
	if (user && Array.isArray(user.pets)) return user.pets.length ? user.pets : defaults;
	return defaults;
}
function applyUserOverrides(base, user) {
	const next = {
		...base,
		pets: resolvePets(base.pets, user)
	};
	if (user.animations) next.animations = user.animations;
	if (user.animationWeights) next.animationWeights = user.animationWeights;
	if (user.eventsRefreshSec) next.eventsRefreshSec = user.eventsRefreshSec;
	if (user.notificationsEnabled !== void 0) next.notificationsEnabled = user.notificationsEnabled;
	return next;
}

//#endregion
//#region src/shared/notify.ts
const NOTIFY_ICONS = {
	done: "notify-done",
	error: "notify-error",
	truncated: "notify-truncated",
	approval: "notify-approval",
	question: "notify-question",
	test: "notify-test"
};
const MAX_BODY = 80;
function truncate(text) {
	return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…" : text;
}
function frameToToast(frame) {
	switch (frame.type) {
		case "session/event": {
			const ev = frame.event ?? {};
			if (ev.type !== "turn/end") return null;
			const kind = ev.data?.reason?.kind;
			if (kind === "completed") return {
				title: "对话完成",
				body: "",
				icon: NOTIFY_ICONS.done
			};
			if (kind === "error") return {
				title: "生成失败",
				body: ev.data?.reason?.error?.message ?? "",
				icon: NOTIFY_ICONS.error
			};
			if (kind === "max-tokens") return {
				title: "输出被截断",
				body: "已达到输出 token 上限",
				icon: NOTIFY_ICONS.truncated
			};
			return null;
		}
		case "approval/requested": {
			const toolName = typeof frame.toolName === "string" ? frame.toolName : "";
			const reason = typeof frame.reason === "string" && frame.reason ? frame.reason : "";
			return {
				title: "正在申请权限",
				body: (toolName ? "工具「" + toolName + "」" : "") + (reason ? "：" + reason : ""),
				icon: NOTIFY_ICONS.approval
			};
		}
		case "question/requested": {
			const q = Array.isArray(frame.questions) && frame.questions[0]?.question || "";
			return {
				title: "模型在等你回答",
				body: q,
				icon: NOTIFY_ICONS.question
			};
		}
		case "host/agent-error": return {
			title: "生成失败",
			body: typeof frame.message === "string" ? frame.message : "",
			icon: NOTIFY_ICONS.error
		};
		default: return null;
	}
}

//#endregion
//#region src/shared/menu.ts
/** 事件名 → 分类标签（无映射时用事件名本身） */
const EVENT_LABELS = { balance: "余额档位" };
const leaf = (anim) => ({
	label: anim,
	anim
});
function buildMenuTree(animations) {
	const groups = [];
	const pools = [
		["待机", animations.idle],
		["转向", animations.turn],
		["拖拽", animations.drag],
		["点击回应", animations.clicks],
		["移动", animations.moves.actions.map((m) => m.name)]
	];
	for (const [label, pool] of pools) if (pool.length) groups.push({
		label,
		children: pool.map(leaf)
	});
	const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
	for (const c of cats) groups.push({
		label: c.id,
		children: c.actions.map(leaf)
	});
	const events = animations.events ?? {};
	for (const key of Object.keys(events)) {
		const pool = events[key] ?? [];
		if (pool.length) groups.push({
			label: EVENT_LABELS[key] ?? key,
			children: pool.map(leaf)
		});
	}
	if (!groups.length) return [];
	return [{
		label: "动作",
		children: groups
	}];
}
function isNoMirrorAnimation(categories, anim) {
	return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}
const MENU_CSS = [
	".dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
	"font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
	".dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}",
	".dsh-pet-menu-column{position:absolute;min-width:150px;max-width:240px;padding:4px;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
	"box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto}",
	".dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;",
	"gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}",
	".dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}",
	".dsh-pet-menu-item>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}",
	".dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}"
].join("");
function isBranchNode(n) {
	return "children" in n && Array.isArray(n.children);
}
function mountContextMenu(opts) {
	const { tree, x, y, onAction, onClose } = opts;
	const root = document.createElement("div");
	root.className = "dsh-pet-menu";
	root.style.left = "0px";
	root.style.top = "0px";
	root.addEventListener("contextmenu", (e) => e.preventDefault());
	let closed = false;
	/** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除 */
	const openChild = new Map();
	/** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消） */
	let leaveTimer = null;
	/** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链） */
	const hideChain = (panel) => {
		panel.style.display = "none";
		const child = openChild.get(panel);
		if (child) {
			openChild.delete(panel);
			hideChain(child);
		}
	};
	/** 把面板显示在触发项旁边：右缘展开，贴右/下边缘自动翻转夹取（视口坐标） */
	const showPanel = (panel, item) => {
		const rect = item.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		panel.style.left = "";
		panel.style.top = "";
		panel.style.display = "block";
		let left = rect.right + 4;
		if (left + panel.offsetWidth > vw - 4) left = rect.left - panel.offsetWidth - 4;
		left = Math.max(4, left);
		let top = rect.top;
		const mbi = window.__dshPetMenuBottomInset || 0; // [dsh-pet-android] 视口底系统栏占用
		if (top + panel.offsetHeight > vh - mbi - 4) top = Math.max(4, vh - mbi - 4 - panel.offsetHeight);
		panel.style.left = left + "px";
		panel.style.top = top + "px";
	};
	/** 构建一层面板（nodes 列表）；分支项的子面板**平级**挂到 root 下，不嵌套。
	*  面板自身先入 DOM、子面板随后入 → 层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
	const buildPanel = (nodes) => {
		const panel = document.createElement("div");
		panel.className = "dsh-pet-menu-column";
		panel.style.display = "none";
		root.appendChild(panel);
		for (const node of nodes) {
			const item = document.createElement("div");
			item.className = "dsh-pet-menu-item";
			if (isBranchNode(node)) {
				item.classList.add("dsh-pet-menu-branch");
				const label = document.createElement("span");
				label.textContent = node.label;
				const arrow = document.createElement("span");
				arrow.className = "dsh-pet-menu-arrow";
				arrow.textContent = "▸";
				item.appendChild(label);
				item.appendChild(arrow);
				const childPanel = buildPanel(node.children);
				item.addEventListener("mouseenter", () => {
					const prev = openChild.get(panel);
					if (prev && prev !== childPanel) hideChain(prev);
					openChild.set(panel, childPanel);
					showPanel(childPanel, item);
				});
			} else {
				const label = document.createElement("span");
				label.textContent = node.label;
				item.appendChild(label);
				item.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					close();
					onAction(node);
				});
			}
			panel.appendChild(item);
		}
		return panel;
	};
	const rootPanel = buildPanel(tree);
	rootPanel.style.display = "block";
	document.body.appendChild(root);
	rootPanel.style.left = "";
	rootPanel.style.top = "";
	const rw = rootPanel.offsetWidth;
	const rh = rootPanel.offsetHeight;
	rootPanel.style.left = Math.max(4, Math.min(x, window.innerWidth - rw - 4)) + "px";
	rootPanel.style.top = Math.max(4, Math.min(y, window.innerHeight - (window.__dshPetMenuBottomInset || 0) - rh - 4)) + "px"; // [dsh-pet-android] 扣视口底导航栏占用
	root.addEventListener("mouseleave", () => {
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = window.setTimeout(() => {
			leaveTimer = null;
			close();
		}, 200);
	});
	root.addEventListener("mouseover", () => {
		if (leaveTimer !== null) {
			window.clearTimeout(leaveTimer);
			leaveTimer = null;
		}
	});
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const close = () => {
		if (closed) return;
		closed = true;
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/physics.ts
const SPRING_K = 200;
const SPRING_C = 30;
const TRAIL_KEEP_MS = 200;
const RELEASE_WINDOW_MS = 150;
const RELEASE_STALE_MS = 150;
const MIN_SPAN_MS = 20;
const SEG_MIN_DT_MS = 8;
const DEAD_ZONE_SPEED = 350; // [dsh-pet-android] 释放死区 500→350：更温和的甩动也进抛掷物理（否则重力档位无感）
const MAX_THROW_SPEED = 3600;
const PEAK_WEIGHT = .5;
const ACCEL_REF = 8e3;
const ACCEL_GAIN_MAX = .6;
const GRAVITY = 1400;
const AIR_DRAG = 0.35; // [dsh-pet-android] 轻度空气阻尼基准（乘以档位阻力系数）
const RESTITUTION = .78;
const GROUND_FRICTION = 2.5;
const REST_VY = 40;
const REST_VX = 15;
const MAX_STEP_DT = .05;
const SQ_SQUASH = .55;
const SQ_DURATION_MS = 220;
const SQ_SOFT_SPEED = 300;
const SQ_HARD_SPEED = 1500;
const SQ_MAX_SQUASH = .55;
const landingSquash = (impactSpeed) => {
	const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
	return Math.min(.8, 1 - t * (1 - SQ_MAX_SQUASH));
};
const squashScale = (u, squash = SQ_SQUASH) => {
	if (u < .45) {
		const p$1 = u / .45;
		return 1 - (1 - squash) * p$1 * p$1;
	}
	const p = (u - .45) / .55;
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
	return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
const throwBounds = (o) => {
	const h = o.size * 9 / 16;
	return {
		minX: -o.sideAllow,
		minY: 0,
		maxX: o.W - o.size + o.sideAllow,
		maxY: o.H - h
	};
};
const trimTrail = (trail, now) => {
	const cutoff = now - TRAIL_KEEP_MS;
	let i = 0;
	while (i < trail.length && trail[i].t < cutoff) i++;
	return i === 0 ? trail : trail.slice(i);
};
const springStep = (v, x, target, dt) => v + ((target - x) * SPRING_K - v * SPRING_C) * dt;
const softClampSpeed = (speed) => {
	if (speed <= 0) return 0;
	return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
const estimateReleaseVelocity = (trail, now) => {
	if (trail.length === 0) return null;
	const last = trail[trail.length - 1];
	if (now - last.t > RELEASE_STALE_MS) return null;
	const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
	if (win.length < 2) return null;
	const t0 = win[0].t;
	const x0 = win[0].x;
	const y0 = win[0].y;
	const t1 = win[win.length - 1].t;
	const x1 = win[win.length - 1].x;
	const y1 = win[win.length - 1].y;
	const spanMs = t1 - t0;
	if (spanMs < MIN_SPAN_MS) return null;
	const baseVx = (x1 - x0) / spanMs * 1e3;
	const baseVy = (y1 - y0) / spanMs * 1e3;
	const baseSpeed = Math.hypot(baseVx, baseVy);
	if (baseSpeed < 1e-6) return null;
	const segSpeeds = [];
	let px = x0;
	let py = y0;
	let pt = t0;
	for (const s of win.slice(1)) {
		const dt = s.t - pt;
		if (dt >= SEG_MIN_DT_MS) {
			segSpeeds.push({
				speed: Math.hypot(s.x - px, s.y - py) / dt * 1e3,
				tEnd: s.t
			});
			px = s.x;
			py = s.y;
			pt = s.t;
		}
	}
	const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
	let accel = 0;
	if (segSpeeds.length >= 2) {
		const lastSeg = segSpeeds[segSpeeds.length - 1];
		const firstSeg = segSpeeds[0];
		accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1e3, MIN_SPAN_MS / 1e3);
	}
	const speedBeforeClamp = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) * (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
	const speed = softClampSpeed(speedBeforeClamp);
	if (speed < DEAD_ZONE_SPEED) return null;
	return {
		vx: baseVx / baseSpeed * speed,
		vy: baseVy / baseSpeed * speed
	};
};
const throwStep = (s, dtRaw, b) => {
	const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
	let { x, y, vx, vy } = s;
	vy += GRAVITY * (window.__dshPetGravityMult ?? 1) * dt; // [dsh-pet-android] 重力倍率
	const dragK = Math.max(0, 1 - AIR_DRAG * (window.__dshPetDragScale ?? 1) * (window.__dshPetDragUserMult ?? 1) * dt); // [dsh-pet-android] 空气阻尼 = 基准 × 重力档位系数 × 用户倍率
	vx *= dragK;
	vy *= dragK;
	x += vx * dt;
	y += vy * dt;
	let bounced = false;
	if (x < b.minX) {
		x = b.minX;
		vx = Math.abs(vx) * RESTITUTION;
		bounced = true;
	} else if (x > b.maxX) {
		x = b.maxX;
		vx = -Math.abs(vx) * RESTITUTION;
		bounced = true;
	}
	if (y < b.minY) {
		y = b.minY;
		vy = Math.abs(vy) * RESTITUTION;
		bounced = true;
	} else if (y >= b.maxY) {
		y = b.maxY;
		vx *= Math.max(0, 1 - GROUND_FRICTION * dt);
		if (Math.abs(vy) < REST_VY) vy = 0;
		else vy = -Math.abs(vy) * RESTITUTION;
		bounced = true;
	}
	const speed = Math.hypot(vx, vy);
	const gm0 = (window.__dshPetGravityMult ?? 1) === 0; // [dsh-pet-android] 零重力：速度耗尽即原地悬停（无地面可触）
	const atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1 || gm0 && speed < REST_VX;
	return {
		x,
		y,
		vx,
		vy,
		bounced,
		atRest
	};
};

//#endregion
exports.ACCEL_GAIN_MAX = ACCEL_GAIN_MAX
exports.ACCEL_REF = ACCEL_REF
exports.CANVAS_H = CANVAS_H
exports.CORNERS = CORNERS
exports.DEAD_ZONE_SPEED = DEAD_ZONE_SPEED
exports.DEEPSEEK_FULL_BALANCE_CNY = DEEPSEEK_FULL_BALANCE_CNY
exports.DRAG_THRESHOLD = DRAG_THRESHOLD
exports.EMPTY_CONF = EMPTY_CONF
exports.FEET_Y = FEET_Y
exports.GRAVITY = GRAVITY
exports.GROUND_FRICTION = GROUND_FRICTION
exports.HIT_BOX = HIT_BOX
exports.MAX_BODY = MAX_BODY
exports.MAX_STEP_DT = MAX_STEP_DT
exports.MAX_THROW_SPEED = MAX_THROW_SPEED
exports.MENU_CSS = MENU_CSS
exports.MIN_SPAN_MS = MIN_SPAN_MS
exports.NOTIFY_ICONS = NOTIFY_ICONS
exports.OPENCODE_QUOTA_USD = OPENCODE_QUOTA_USD
exports.PEAK_WEIGHT = PEAK_WEIGHT
exports.PET_DISPLAYS = PET_DISPLAYS
exports.PET_REF_WIDTH = PET_REF_WIDTH
exports.RELEASE_STALE_MS = RELEASE_STALE_MS
exports.RELEASE_WINDOW_MS = RELEASE_WINDOW_MS
exports.RESTITUTION = RESTITUTION
exports.REST_VX = REST_VX
exports.REST_VY = REST_VY
exports.SEG_MIN_DT_MS = SEG_MIN_DT_MS
exports.SPRING_C = SPRING_C
exports.SPRING_K = SPRING_K
exports.SQ_DURATION_MS = SQ_DURATION_MS
exports.SQ_HARD_SPEED = SQ_HARD_SPEED
exports.SQ_MAX_SQUASH = SQ_MAX_SQUASH
exports.SQ_SOFT_SPEED = SQ_SOFT_SPEED
exports.SQ_SQUASH = SQ_SQUASH
exports.TRAIL_KEEP_MS = TRAIL_KEEP_MS
exports.WINDOW_LABELS = WINDOW_LABELS
exports.anchorPixel = anchorPixel
exports.applyUserOverrides = applyUserOverrides
exports.assertAnimationsBlock = assertAnimationsBlock
exports.assertClientConfig = assertClientConfig
exports.assertExtraPetFile = assertExtraPetFile
exports.assertPetsBlock = assertPetsBlock
exports.assertWeightsBlock = assertWeightsBlock
exports.balanceBubbleView = balanceBubbleView
exports.balanceEventIndex = balanceEventIndex
exports.balancePercent = balancePercent
exports.buildMenuTree = buildMenuTree
exports.deepseekPricingTier = deepseekPricingTier
exports.estimateReleaseVelocity = estimateReleaseVelocity
exports.fetchBalanceState = fetchBalanceState
exports.fetchTriggerCount = fetchTriggerCount
exports.frameToToast = frameToToast
exports.isDesktopVisible = isDesktopVisible
exports.isNoMirrorAnimation = isNoMirrorAnimation
exports.isWebVisible = isWebVisible
exports.landingSquash = landingSquash
exports.mergeExtraPets = mergeExtraPets
exports.mountContextMenu = mountContextMenu
exports.pick = pick
exports.pickCategoryAction = pickCategoryAction
exports.pickWeightedCategory = pickWeightedCategory
exports.planMove = planMove
exports.randomBetween = randomBetween
exports.resetInText = resetInText
exports.resolvePets = resolvePets
exports.rollKind = rollKind
exports.springStep = springStep
exports.squashScale = squashScale
exports.stripJsonc = stripJsonc
exports.throwBounds = throwBounds
exports.throwStep = throwStep
exports.trimTrail = trimTrail
exports.truncate = truncate
exports.urgentWindow = urgentWindow
return exports;
})({});