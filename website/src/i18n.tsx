import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Lang = "zh" | "en";

const zh = {
  nav: {
    home: "首页",
    features: "功能",
    showcase: "演示",
    performance: "性能",
    changelog: "更新日志",
    download: "下载",
    downloadBtn: "下载 v0.7.0",
  },
  hero: {
    badge: "v0.7.0 · 开源 MIT · Windows / macOS / Linux",
    titleBefore: "统一管理你的",
    titleAccent: "AI 供应商",
    titleAfter: "",
    subtitle:
      "一键切换 Kimi / 智谱 GLM / MiniMax / DeepSeek / OpenRouter / 基元律动，用量与账单一目了然。",
    download: "免费下载",
    source: "查看源码",
    stats: [
      { value: "22", label: "预设供应商" },
      { value: "5910", label: "模型价格库" },
      { value: "100%", label: "开源免费" },
    ],
  },
  features: {
    title: "核心功能",
    subtitle: "从多供应商管理到用量监控，一站搞定。",
    items: [
      {
        id: "multi-provider",
        title: "多供应商管理",
        desc: "Kimi / 智谱 GLM / MiniMax / DeepSeek / OpenRouter / 基元律动等 22 个预设，一键添加与切换。",
        img: "screenshots/preset-picker.png",
      },
      {
        id: "custom-provider",
        title: "自定义供应商",
        desc: "自定义 Base URL / API Key / 模型映射，支持 JSON 高级编辑。",
        img: "screenshots/edit-provider-basic-managed.png",
      },
      {
        id: "usage",
        title: "用量与账单监控",
        desc: "套餐类 5 小时 / 每周用量 + 按量余额，models.dev 真实价格计算成本，卡片直显。",
        img: "screenshots/dashboard-light.png",
      },
      {
        id: "sessions",
        title: "会话管理",
        desc: "跨供应商浏览、搜索与恢复历史会话。",
        img: "screenshots/sessions-light.png",
      },
      {
        id: "kimi-auth",
        title: "Kimi 一键授权登录",
        desc: "应用内置设备码授权（等同 kimi login），浏览器授权即用，15 分钟过期自动续期。",
        img: "screenshots/kimi-oauth-dialog.png",
      },
      {
        id: "usage-config",
        title: "配置用量查询",
        desc: "全屏配置页：NewAPI 中转站模板、超时时间、自动刷新间隔、测试查询。",
        img: "screenshots/usage-config-page.png",
      },
      {
        id: "model-discovery",
        title: "智能模型发现",
        desc: "模型能力 / 上下文大小自动从 models.dev 同步，构建时自动拉取，5910 模型覆盖。",
        img: "screenshots/kimi-cli-select-model.png",
      },
      {
        id: "auto-update",
        title: "自动更新",
        desc: "自动检测新版本，一键下载安装，始终保持最新。",
        img: "screenshots/settings.png",
      },
    ],
  },
  showcase: {
    title: "界面演示",
    subtitle: "真实界面截图，所见即所得。",
    items: [
      {
        src: "screenshots/usage-config-page.png",
        title: "配置用量查询",
        desc: "NewAPI 中转站模板、超时与自动刷新、测试查询一屏搞定",
      },
      {
        src: "screenshots/preset-picker.png",
        title: "预设供应商",
        desc: "22 个预设开箱即用，一键添加常用厂商",
      },
      {
        src: "screenshots/kimi-oauth-dialog.png",
        title: "Kimi 授权登录",
        desc: "设备码授权等同 kimi login，过期自动续期",
      },
      {
        src: "screenshots/dashboard-daily-detail.png",
        title: "用量明细",
        desc: "按天查看 Token 与费用走势",
      },
      {
        src: "screenshots/sessions-light.png",
        title: "会话管理",
        desc: "跨供应商浏览与恢复历史会话",
      },
      {
        src: "screenshots/kimi-plan-quota-card.png",
        title: "套餐余量卡",
        desc: "5 小时 / 每周额度直读，余量一眼可见",
      },
    ],
  },
  performance: {
    title: "轻量原生",
    subtitle: "Tauri + Rust 内核，WebView2 前端，常驻托盘零负担。",
    metrics: [
      { target: 93, suffix: " MB", label: "Working Set", desc: "程序空闲态工作集内存" },
      { target: 34, suffix: " MB", label: "Private WS", desc: "独占内存（WebView2 共享部分扣除）" },
      { target: 0.3, decimals: 1, suffix: "%", label: "CPU 空闲", desc: "无活跃任务时几乎零占用" },
    ],
    lightCaption: "浅色主题",
    darkCaption: "深色主题",
  },
  changelog: {
    title: "更新日志",
    subtitle: "每个版本的重要变更记录。",
    syncedNote: "数据已同步 GitHub Releases",
    fallbackNote: "内置版本记录",
    entries: [
      {
        version: "v0.7.0",
        date: "2026-08-02",
        items: [
          "订阅套餐模型计价修正：零价条目按官方付费模型计价（zhipuai-coding-plan/glm-5.2 按 zhipuai/glm-5.2 牌价）",
          "-highspeed / -free 派生变体自动回退到基础模型价格",
          "Kimi For Coding 套餐无牌价时按旗舰模型 kimi-k3 价格估算用量",
          "设置页：识图（image_in）能力可手动编辑，原生多模态模型不再提示 kimi-eyes 插件",
          "修复仅单个套餐档位（如 5 小时）时用量卡片不显示的问题",
          "kimi usages 响应异常时透出原始返回，便于对照接口排查",
          "models.dev 价格快照同步",
          "关于页新增官方网站链接",
          "设置-关于页新增 Kimi Eyes 识图插件站链接",
        ],
      },
      {
        version: "v0.6.9",
        date: "2026-08-01",
        items: [
          "最近请求新增缓存命中率列，每次请求命中一目了然",
          "中文模式费用按最新汇率换算人民币（¥）显示，英文模式保持美元",
          "仪表盘性能再优化：价格解析记忆化缓存，扫描从秒级降到百毫秒级；右上角新增加载耗时/数据量跟踪",
        ],
      },
      {
        version: "v0.6.8",
        date: "2026-08-01",
        items: [
          "仪表盘加载提速：models.dev 快照移出主 bundle，异步加载不阻塞首帧",
          "Rust 价格索引启动时后台预热；get_summary 扫描结果 8 秒缓存",
          "k3-256k 按 k3 牌价计费",
          "官网更新：Kimi 风格重设计、中英文切换、更新日志同步 GitHub Releases、三平台下载",
        ],
      },
      {
        version: "v0.6.6",
        date: "2026-08-01",
        items: [
          "模型价格对标 models.dev，覆盖 5910 个模型",
          "新增基元律动供应商与推荐链接",
          "设置页文案与参考来源说明优化",
        ],
      },
      {
        version: "v0.6.5",
        date: "2026-08-01",
        items: [
          "更新检查优化：私有仓库优先，GitHub 回退，8 秒超时",
          "修复按量余额显示",
        ],
      },
      {
        version: "v0.6.4",
        date: "2026-08-01",
        items: [
          "新增套餐账单查询（5 小时 / 每周用量卡片直显）",
          "OpenCode Zen 预设补充推荐链接",
        ],
      },
      {
        version: "v0.6.3",
        date: "2026-07-30",
        items: [
          "添加默认供应商支持，新增 StepFun Plan 套餐预设",
          "供应商编辑页新增 API Key 获取链接（支持推广链接）",
          "修复链接无法打开浏览器的问题",
        ],
      },
      {
        version: "v0.6.2",
        date: "2026-07-30",
        items: [
          "仪表盘布局重构：每日用量趋势折线图（Token / 缓存命中率 / 请求数）",
          "热力图独立整行，格子放大",
          "新增 OpenCode Go / Zen 预设",
        ],
      },
      {
        version: "v0.6.0",
        date: "2026-07-29",
        items: [
          "预设供应商与供应商账单查询上线",
          "多平台打包：macOS / Linux / Windows CI 同步发布",
        ],
      },
      {
        version: "v0.5.2",
        date: "2026-07-29",
        items: ["用量趋势改为 tab 容器，新增供应商模型两级下钻"],
      },
      {
        version: "v0.5.1",
        date: "2026-07-29",
        items: ["窗口与托盘行为优化；模型表格与能力编辑 UI 打磨"],
      },
    ],
  },
  privacy: {
    title: "你的数据，只在你的电脑上",
    subtitle: "三句话讲清楚隐私与开源承诺。",
    items: [
      {
        id: "local",
        title: "本地存储",
        desc: "配置与用量仅存本机 ~/.kimi-switch 与 config.toml，绝不上传。",
      },
      {
        id: "direct",
        title: "官方直连",
        desc: "账单查询直连各厂商官方 API，无中间商、无统计埋点。",
      },
      {
        id: "open",
        title: "开源可审计",
        desc: "MIT 协议全量开源（GitHub），欢迎审阅与共建。",
      },
    ],
  },
  download: {
    title: "下载 Kimi Switch",
    subtitle: "当前版本 v0.7.0 · Windows / macOS / Linux 三平台已发布",
    autoUpdate: "应用内置自动检测更新，新版本发布后在设置页一键升级。",
    ready: "已发布",
    wip: "开发中",
    githubBtn: "GitHub 下载",
    mirrorBtn: "镜像下载",
    items: [
      { id: "windows", name: "Windows", ready: true, note: ".msi 安装包，系统托盘常驻" },
      { id: "macos", name: "macOS", ready: true, note: ".dmg 安装包（Apple Silicon），未签名需右键打开" },
      { id: "linux", name: "Linux", ready: true, note: ".deb / .AppImage / .rpm 三格式" },
    ],
  },
  cta: {
    title: "现在就把所有供应商，放进一个应用",
    subtitle: "免费 · 开源 MIT · 一分钟完成安装",
    download: "免费下载",
    source: "GitHub 源码",
  },
  seo: {
    home: {
      title: "Kimi Switch — 多 LLM 供应商统一管理 · 用量监控 · 账单一目了然",
      description:
        "Kimi Switch / KimiCodeSwitch — Windows 桌面端多 LLM 供应商统一管理器，一键切换 Kimi / 智谱 GLM / MiniMax / DeepSeek / OpenRouter / 基元律动，用量账单实时监控，开源 MIT。",
    },
    features: {
      title: "核心功能 - Kimi Switch",
      description:
        "Kimi Switch 核心功能：多供应商管理、用量与账单监控、Kimi 一键授权登录、智能模型发现与自动更新，22 个预设开箱即用。",
    },
    changelog: {
      title: "更新日志 - Kimi Switch",
      description:
        "Kimi Switch 更新日志：每个版本的重要变更记录，同步自 GitHub Releases。",
    },
    download: {
      title: "下载 - Kimi Switch",
      description:
        "下载 Kimi Switch：Windows .msi、macOS .dmg、Linux .deb / .AppImage / .rpm，免费开源 MIT。",
    },
  },
  footer: {
    recommend: "推荐供应商",
    mirror: "国内镜像",
    creditBefore: "仪表盘与会话管理功能基于 ",
    creditAfter: " (MIT, © JochenYang) 移植",
    recommendText: {
      Kimi: "完成 Kimi 注册，你我都能 100% 拿奖，最高可得 1 年会员等值权益",
      "智谱 GLM":
        "通过我的邀请链接注册 BigModel.cn，即可获得 2000 万 Tokens 大礼包，畅享新一代旗舰模型 GLM-5.2",
      DeepSeek: "",
      OpenCodeGo: "",
      MiniMax:
        "MiniMax Token Plan：订阅套餐解锁最新模型，好友订阅享 9 折 + Builder 权益，邀请人得 10% 返利",
      基元律动: "",
    } as Record<string, string>,
  },
};

export type Dict = typeof zh;

const en: Dict = {
  nav: {
    home: "Home",
    features: "Features",
    showcase: "Demo",
    performance: "Performance",
    changelog: "Changelog",
    download: "Download",
    downloadBtn: "Download v0.7.0",
  },
  hero: {
    badge: "v0.7.0 · Open source MIT · Windows / macOS / Linux",
    titleBefore: "One app for all your ",
    titleAccent: "AI providers",
    titleAfter: "",
    subtitle:
      "Switch between Kimi, Zhipu GLM, MiniMax, DeepSeek, OpenRouter and TokenRhythm in one click, with usage and billing at a glance.",
    download: "Free Download",
    source: "View Source",
    stats: [
      { value: "22", label: "Provider presets" },
      { value: "5910", label: "Model price DB" },
      { value: "100%", label: "Open source" },
    ],
  },
  features: {
    title: "Core Features",
    subtitle: "From multi-provider management to usage monitoring, all in one place.",
    items: [
      {
        id: "multi-provider",
        title: "Multi-Provider Management",
        desc: "22 presets including Kimi, Zhipu GLM, MiniMax, DeepSeek, OpenRouter and TokenRhythm. Add and switch in one click.",
        img: "screenshots/preset-picker.png",
      },
      {
        id: "custom-provider",
        title: "Custom Providers",
        desc: "Custom Base URL, API Key and model mapping, with advanced JSON editing.",
        img: "screenshots/edit-provider-basic-managed.png",
      },
      {
        id: "usage",
        title: "Usage & Billing",
        desc: "5-hour / weekly plan quotas plus pay-as-you-go balance, priced with real models.dev rates and shown on cards.",
        img: "screenshots/dashboard-light.png",
      },
      {
        id: "sessions",
        title: "Session Manager",
        desc: "Browse, search and resume past sessions across providers.",
        img: "screenshots/sessions-light.png",
      },
      {
        id: "kimi-auth",
        title: "One-Click Kimi Login",
        desc: "Built-in device-code authorization (same as kimi login). Authorize in the browser; 15-minute expiry auto-renews.",
        img: "screenshots/kimi-oauth-dialog.png",
      },
      {
        id: "usage-config",
        title: "Usage Query Setup",
        desc: "Full-page config: NewAPI relay templates, timeout, auto-refresh interval, and a test query.",
        img: "screenshots/usage-config-page.png",
      },
      {
        id: "model-discovery",
        title: "Smart Model Discovery",
        desc: "Model capabilities and context sizes sync from models.dev at build time, covering 5910 models.",
        img: "screenshots/kimi-cli-select-model.png",
      },
      {
        id: "auto-update",
        title: "Auto Updates",
        desc: "Automatically detects new versions and installs them in one click.",
        img: "screenshots/settings.png",
      },
    ],
  },
  showcase: {
    title: "Screenshots",
    subtitle: "Real screenshots from the app. What you see is what you get.",
    items: [
      {
        src: "screenshots/usage-config-page.png",
        title: "Usage Query Setup",
        desc: "NewAPI relay templates, timeout and auto-refresh, plus a test query, all on one page",
      },
      {
        src: "screenshots/preset-picker.png",
        title: "Provider Presets",
        desc: "22 presets ready out of the box, add popular vendors in one click",
      },
      {
        src: "screenshots/kimi-oauth-dialog.png",
        title: "Kimi Authorization",
        desc: "Device-code flow identical to kimi login, auto-renews on expiry",
      },
      {
        src: "screenshots/dashboard-daily-detail.png",
        title: "Usage Details",
        desc: "Daily token and cost trends",
      },
      {
        src: "screenshots/sessions-light.png",
        title: "Session Manager",
        desc: "Browse and resume past sessions across providers",
      },
      {
        src: "screenshots/kimi-plan-quota-card.png",
        title: "Plan Quota Card",
        desc: "5-hour / weekly quotas at a glance",
      },
    ],
  },
  performance: {
    title: "Lightweight & Native",
    subtitle: "Tauri + Rust core with a WebView2 frontend. Zero tray overhead.",
    metrics: [
      { target: 93, suffix: " MB", label: "Working Set", desc: "Idle working-set memory" },
      { target: 34, suffix: " MB", label: "Private WS", desc: "Private memory (shared WebView2 excluded)" },
      { target: 0.3, decimals: 1, suffix: "%", label: "Idle CPU", desc: "Nearly zero when idle" },
    ],
    lightCaption: "Light theme",
    darkCaption: "Dark theme",
  },
  changelog: {
    title: "Changelog",
    subtitle: "Notable changes in every release.",
    syncedNote: "Synced from GitHub Releases",
    fallbackNote: "Built-in release notes",
    entries: [
      {
        version: "v0.7.0",
        date: "2026-08-02",
        items: [
          "Plan-entry pricing fix: zero-price plan listings bill at the official priced model (zhipuai-coding-plan/glm-5.2 → zhipuai/glm-5.2)",
          "-highspeed / -free derived variants fall back to the base model price",
          "Kimi For Coding (no list price) estimates usage at the flagship kimi-k3 rate",
          "Settings: image_in capability is now manually editable; native multimodal models no longer show the kimi-eyes plugin hint",
          "Fix single-tier plans (e.g. 5-hour only) showing no usage card",
          "kimi usages failure now exposes the raw response for easier debugging",
          "models.dev price snapshot sync",
          "About page gains an official website link",
          "Settings-About page gains a Kimi Eyes plugin site link",
        ],
      },
      {
        version: "v0.6.9",
        date: "2026-08-01",
        items: [
          "Recent requests gain a cache-hit-rate column, per request at a glance",
          "Chinese UI now shows costs in CNY (latest exchange rate); English keeps USD",
          "Dashboard speedup: memoized price resolution drops the scan from seconds to milliseconds; load time / payload tracking in the top-right corner",
        ],
      },
      {
        version: "v0.6.8",
        date: "2026-08-01",
        items: [
          "Dashboard speedup: models.dev snapshot moved out of the main bundle, async load without blocking first paint",
          "Rust price index warmed in the background at startup; get_summary scan cached for 8s",
          "k3-256k billed at the k3 list price",
          "Website refresh: Kimi-style redesign, zh/en switch, changelog synced from GitHub Releases, downloads for all three platforms",
        ],
      },
      {
        version: "v0.6.7",
        date: "2026-08-01",
        items: [
          "Built-in Kimi device-code login (same as kimi login): authorize in the browser, auto-renews on expiry",
          "External links now open via a unified Rust command, fixing broken jumps",
        ],
      },
      {
        version: "v0.6.6",
        date: "2026-08-01",
        items: [
          "Model pricing aligned with models.dev, covering 5910 models",
          "New TokenRhythm provider with referral link",
          "Settings copy and source attribution polish",
        ],
      },
      {
        version: "v0.6.5",
        date: "2026-08-01",
        items: [
          "Update check rework: private mirror first, GitHub fallback, 8s timeout",
          "Fix pay-as-you-go balance display",
        ],
      },
      {
        version: "v0.6.4",
        date: "2026-08-01",
        items: [
          "Plan billing queries (5-hour / weekly usage shown on cards)",
          "OpenCode Zen preset gains a referral link",
        ],
      },
      {
        version: "v0.6.3",
        date: "2026-07-30",
        items: [
          "Default provider support and a new StepFun Plan preset",
          "API Key helper links on the provider edit page (referral links supported)",
          "Fix links failing to open the browser",
        ],
      },
      {
        version: "v0.6.2",
        date: "2026-07-30",
        items: [
          "Dashboard layout rework: daily trend line chart (tokens / cache hit rate / requests)",
          "Heatmap gets its own full-width row with larger cells",
          "New OpenCode Go / Zen presets",
        ],
      },
      {
        version: "v0.6.0",
        date: "2026-07-29",
        items: [
          "Provider presets and per-provider billing queries launch",
          "Multi-platform packaging: macOS / Linux / Windows CI releases",
        ],
      },
      {
        version: "v0.5.2",
        date: "2026-07-29",
        items: ["Usage trends moved into a tab container with provider-model two-level drill-down"],
      },
      {
        version: "v0.5.1",
        date: "2026-07-29",
        items: ["Window and tray behavior polish; model table and capability editor UI refinements"],
      },
    ],
  },
  privacy: {
    title: "Your Data Stays on Your Machine",
    subtitle: "Our privacy and open-source commitments in three sentences.",
    items: [
      {
        id: "local",
        title: "Local Storage",
        desc: "Configs and usage data live only in ~/.kimi-switch and config.toml. Nothing is uploaded.",
      },
      {
        id: "direct",
        title: "Direct Connections",
        desc: "Billing queries go straight to each vendor's official API. No middlemen, no tracking.",
      },
      {
        id: "open",
        title: "Open & Auditable",
        desc: "Fully open source under MIT on GitHub. Reviews and contributions welcome.",
      },
    ],
  },
  download: {
    title: "Download Kimi Switch",
    subtitle: "Current version v0.7.0 · Windows, macOS and Linux now released",
    autoUpdate: "Built-in update detection: upgrade in one click from Settings when a new version ships.",
    ready: "Available",
    wip: "In development",
    githubBtn: "Download from GitHub",
    mirrorBtn: "China mirror",
    items: [
      { id: "windows", name: "Windows", ready: true, note: ".msi installer, lives in the system tray" },
      { id: "macos", name: "macOS", ready: true, note: ".dmg installer (Apple Silicon), unsigned - right-click to open" },
      { id: "linux", name: "Linux", ready: true, note: ".deb / .AppImage / .rpm" },
    ],
  },
  cta: {
    title: "Bring every provider into one app",
    subtitle: "Free · Open source MIT · One-minute install",
    download: "Free Download",
    source: "GitHub Source",
  },
  seo: {
    home: {
      title: "Kimi Switch — Unified Management for AI Providers · Usage & Billing",
      description:
        "Kimi Switch / KimiCodeSwitch — a Windows desktop manager for multiple LLM providers. Switch between Kimi, Zhipu GLM, MiniMax, DeepSeek, OpenRouter and TokenRhythm in one click, with usage and billing at a glance. Open source MIT.",
    },
    features: {
      title: "Core Features - Kimi Switch",
      description:
        "Kimi Switch core features: multi-provider management, usage & billing, one-click Kimi login, smart model discovery and auto updates. 22 presets out of the box.",
    },
    changelog: {
      title: "Changelog - Kimi Switch",
      description:
        "Kimi Switch changelog: notable changes in every release, synced from GitHub Releases.",
    },
    download: {
      title: "Download - Kimi Switch",
      description:
        "Download Kimi Switch: Windows .msi, macOS .dmg, Linux .deb / .AppImage / .rpm. Free and open source under MIT.",
    },
  },
  footer: {
    recommend: "Recommended Providers",
    mirror: "China mirror",
    creditBefore: "Dashboard & session management adapted from ",
    creditAfter: " (MIT, © JochenYang)",
    recommendText: {
      Kimi: "Sign up with my invite link and we both win rewards, up to a 1-year membership equivalent",
      "智谱 GLM":
        "Register on BigModel.cn via my invite link and get a 20M token gift pack for the new GLM-5.2 flagship",
      DeepSeek: "",
      OpenCodeGo: "",
      MiniMax:
        "MiniMax Token Plan: subscribe to unlock the latest models. Friends get 10% off, inviters get 10% rebate",
      基元律动: "",
    } as Record<string, string>,
  },
};

const dicts: Record<Lang, Dict> = { zh, en };

const STORAGE_KEY = "kimi-switch-site-lang";

function detect(): Lang {
  if (typeof window === "undefined") return "zh";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
}>({ lang: "zh", setLang: () => {}, t: zh });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  };

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t: dicts[lang] }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
