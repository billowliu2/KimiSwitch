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
    downloadBtn: "下载 v0.7.12",
  },
  hero: {
    badge: "v0.7.12 · 开源 MIT · Windows / macOS / Linux",
    titleBefore: "统一管理你的",
    titleAccent: "AI 供应商",
    titleAfter: "",
    subtitle:
      "Kimi Code 的供应商配置不用再手改 config.toml：22 个预设选好即写入（写入前自动备份），用量与账单直读各厂商官方接口。",
    download: "免费下载",
    source: "查看源码",
    stats: [
      { value: "22", label: "预设供应商" },
      { value: "7495", label: "模型价格库" },
      { value: "MIT", label: "开源协议" },
    ],
  },
  features: {
    title: "核心功能",
    subtitle: "配置、切换、用量、账单、会话——都落在本机那份 ~/.kimi-code/config.toml 上。",
    items: [
      {
        id: "multi-provider",
        title: "多供应商管理",
        desc: "Kimi / 智谱 GLM / MiniMax / DeepSeek / OpenRouter / 基元律动等 22 个预设，Base URL 与模型映射已填好，选定即写入配置。",
        img: "screenshots/preset-picker.png",
      },
      {
        id: "custom-provider",
        title: "自定义供应商",
        desc: "Base URL、API Key、模型别名逐字段编辑，也可切到 JSON 页签直接改；配置里的未知字段原样保留。",
        img: "screenshots/edit-provider-basic-managed.png",
      },
      {
        id: "usage",
        title: "用量与账单监控",
        desc: "套餐的 5 小时 / 每周额度与按量余额直接显示在卡片上，成本按 models.dev 牌价折算。",
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
        title: "Kimi 授权登录",
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
        title: "模型自动发现",
        desc: "可用模型直接问供应商 API；显示名 / 上下文 / 能力取自 models.dev 快照（当前 7495 个模型、212 家供应商）。",
        img: "screenshots/kimi-cli-select-model.png",
      },
      {
        id: "auto-update",
        title: "自动更新",
        desc: "启动时和每 8 小时各查一次新版本（私有镜像优先、GitHub 兜底），应用内下载并引导安装。",
        img: "screenshots/settings.png",
      },
    ],
  },
  showcase: {
    title: "界面演示",
    subtitle: "以下截图取自 v0.7.12 实机运行。",
    items: [
      {
        src: "screenshots/usage-config-page.png",
        title: "配置用量查询",
        desc: "NewAPI 中转站模板、超时与自动刷新、测试查询放在同一页",
      },
      {
        src: "screenshots/preset-picker.png",
        title: "预设供应商",
        desc: "22 个预设，勾选即可添加常用厂商",
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
    subtitle: "Tauri + Rust，复用系统 WebView2，不打包 Chromium。下面三项是空闲状态实测。",
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
        version: "v0.7.12",
        date: "2026-09-03",
        items: [
          "适配 kimi-code 0.40.1：实验 flag 清单更新（新增 file_history / search_worker，secondary-model 默认开启）",
          "flag 优先级语义修正：显式配置优先于总开关，总开关不再锁定全部实验开关",
          "新增危险命令守卫开关：Auto 模式直接拒绝 rm -rf / shutdown 等危险命令，其它模式强制询问",
          "修复 WebUI 首次打开慢时多次点击的竞态报错",
          "models-dev 快照更新至 7495 模型 / 212 供应商",
        ],
      },
      {
        version: "v0.7.4",
        date: "2026-08-09",
        items: [
          "仪表盘热力图双击弹窗：双击方块查看当日模型用量分布，每种模型展示 Token / 请求次数 / 费用 / 命中率",
          "后端 by_model 数据结构升级：从纯 token 数升级为结构化对象，柱状图双击弹窗也同步展示全量指标",
          "范围外日期不可双击、无放大效果",
        ],
      },
      {
        version: "v0.7.3",
        date: "2026-08-07",
        items: [
          "高级设置新增 Kimi Code WebUI 应用内嵌窗口：新版 Web 界面以独立顶层窗口打开（单例、可缩放、居中），不再跳转外部浏览器",
          "WebUI 两个入口并存：应用内独立窗口 / 系统浏览器（复用已运行的 kimi web 服务器，不重复拉起）",
          "服务器进程自动管理：自己启动的服务器随窗口关闭/应用退出清理，不留残留；窗口创建失败不再泄漏进程",
          "最小化窗口再次打开可恢复；发布说明文案同步更新",
        ],
      },
      {
        version: "v0.7.2",
        date: "2026-08-07",
        items: [
          "「子代理设置」升级为「高级设置」：聚合子代理模型指定、实验功能开关与 WebUI 快捷入口",
          "新增 Kimi Code WebUI 快捷打开：高级设置页可将新版 Web 界面以独立窗口在应用内打开，也可在系统浏览器打开（kimi-code 0.33+）",
          "子代理模型指定（实验功能）：设置中为子代理选择次主力模型，子代理不再默认继承主模型",
          "实验开关改为滑动开关，修复开启态因样式缺失而不可见的问题",
          "兼容 kimi-code 0.33+（v2 引擎）：循环控制改用新键 max_attempts_per_step，旧配置自动迁移",
          "models.dev 模型列表与价格数据同步更新",
          "官网企业版视觉升级；出品公司标识统一为 codingplan.site",
          "macOS 安装优化：Release 附带 install-macos.sh，自动清除下载隔离，免去手动右键打开",
        ],
      },
      {
        version: "v0.7.1",
        date: "2026-08-05",
        items: [
          "实验功能设置新增「子代理模型（次主力模型）」配置：选择后子代理绑定该模型，不再继承主模型",
          "仪表盘用量统计识别子代理请求（__secondary__）独立展示，并缓存次主力模型定价",
          "自定义网关模型按官方同名模型跨 provider 匹配价格，不再落入兜底估算",
        ],
      },
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
          "最近请求新增缓存命中率列，逐条请求的命中情况直接可见",
          "中文模式费用按最新汇率换算人民币（¥）显示，英文模式保持美元",
          "仪表盘性能再优化：价格解析记忆化缓存，扫描从秒级降到百毫秒级；右上角新增加载耗时/数据量跟踪",
        ],
      },
      {
        version: "v0.6.7",
        date: "2026-08-01",
        items: [
          "应用内置 Kimi 授权登录（Device Code Flow，等同 kimi login）：浏览器授权即用，无需命令行",
          "授权后凭据自动写入，15 分钟过期自动续期，用量查询直接可用",
          "修复外链打开问题：授权页 / 设置页超链接统一走 Rust 侧 opener 命令（更可靠）",
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
          "模型价格数据对标 models.dev，快照随版本更新",
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
    subtitle: "当前版本 v0.7.12 · Windows / macOS / Linux 三平台已发布",
    autoUpdate: "更新检查跑在启动时和每 8 小时的周期任务里，设置页也可以手动触发。",
    ready: "已发布",
    wip: "开发中",
    githubBtn: "GitHub 下载",
    mirrorBtn: "镜像下载",
    items: [
      { id: "windows", name: "Windows", ready: true, note: ".msi 安装包，系统托盘常驻" },
      { id: "macos", name: "macOS", ready: true, note: ".dmg 安装包（Apple Silicon），未签名：下载 Release 附带的 install-macos.sh，运行 bash install-macos.sh 清除隔离属性" },
      { id: "linux", name: "Linux", ready: true, note: ".deb / .AppImage / .rpm 三格式" },
    ],
  },
  cta: {
    title: "把供应商配置、用量和账单收进一个窗口",
    subtitle: "免费 · MIT 开源 · Windows / macOS / Linux",
    download: "免费下载",
    source: "GitHub 源码",
  },
  seo: {
    home: {
      title: "Kimi Switch — 多 LLM 供应商配置管理 · 用量与账单监控",
      description:
        "Kimi Switch / KimiCodeSwitch — 桌面端 LLM 供应商配置管理器：22 个预设选好即写入 config.toml，用量与账单直读各厂商官方接口。Tauri + Rust，开源 MIT。",
    },
    features: {
      title: "核心功能 - Kimi Switch",
      description:
        "Kimi Switch 功能页：多供应商预设与自定义配置、用量与账单监控、Kimi 设备码授权、模型自动发现与周期更新检查。",
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
    downloads: "GitHub 累计下载 {n} 次",
    creditBefore: "仪表盘与会话管理功能基于 ",
    creditAfter: " (MIT, © JochenYang) 移植",
    recommendText: {
      Kimi: "完成 Kimi 注册，你我都能 100% 拿奖，最高可得 1 年会员等值权益",
      "智谱 GLM":
        "通过我的邀请链接注册 BigModel.cn，即可获得 2000 万 Tokens 大礼包，畅享新一代旗舰模型 GLM-5.2",
      DeepSeek: "",
      OpenCodeGo: "好友订阅后，您可获得 $5，对方也可获得 $5。",
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
    downloadBtn: "Download v0.7.12",
  },
  hero: {
    badge: "v0.7.12 · Open source MIT · Windows / macOS / Linux",
    titleBefore: "One app for all your ",
    titleAccent: "AI providers",
    titleAfter: "",
    subtitle:
      "Stop hand-editing ~/.kimi-code/config.toml. Pick one of 22 provider presets and it goes straight into your config (backed up first); usage and billing read from each vendor's own API.",
    download: "Free Download",
    source: "View source",
    stats: [
      { value: "22", label: "Provider presets" },
      { value: "7495", label: "Model price DB" },
      { value: "MIT", label: "License" },
    ],
  },
  features: {
    title: "Core features",
    subtitle: "Configuration, switching, usage, billing and sessions — all against the config.toml on your machine.",
    items: [
      {
        id: "multi-provider",
        title: "Provider presets",
        desc: "22 presets — Kimi, Zhipu GLM, MiniMax, DeepSeek, OpenRouter, TokenRhythm and more — ship with Base URL and model mapping filled in; picking one writes it to your config.",
        img: "screenshots/preset-picker.png",
      },
      {
        id: "custom-provider",
        title: "Custom providers",
        desc: "Edit Base URL, API key and model aliases field by field, or switch to the raw JSON tab; unknown fields are passed through untouched.",
        img: "screenshots/edit-provider-basic-managed.png",
      },
      {
        id: "usage",
        title: "Usage & billing",
        desc: "5-hour / weekly plan quotas and pay-as-you-go balance shown directly on cards, with costs computed at models.dev list prices.",
        img: "screenshots/dashboard-light.png",
      },
      {
        id: "sessions",
        title: "Session manager",
        desc: "Browse, search and resume past sessions across providers.",
        img: "screenshots/sessions-light.png",
      },
      {
        id: "kimi-auth",
        title: "Kimi device-code login",
        desc: "Built-in device-code authorization (same as kimi login). Authorize in the browser; 15-minute expiry auto-renews.",
        img: "screenshots/kimi-oauth-dialog.png",
      },
      {
        id: "usage-config",
        title: "Usage query setup",
        desc: "Full-page config: NewAPI relay templates, timeout, auto-refresh interval, and a test query.",
        img: "screenshots/usage-config-page.png",
      },
      {
        id: "model-discovery",
        title: "Model discovery",
        desc: "Model lists are fetched from the provider API itself; display names, context sizes and capabilities come from a build-time models.dev snapshot (7495 models, 212 providers).",
        img: "screenshots/kimi-cli-select-model.png",
      },
      {
        id: "auto-update",
        title: "Auto updates",
        desc: "Checks at startup and every 8 hours (private mirror first, GitHub fallback), downloads in-app and walks you through install.",
        img: "screenshots/settings.png",
      },
    ],
  },
  showcase: {
    title: "Screenshots",
    subtitle: "All screenshots below are taken from the running v0.7.12 build.",
    items: [
      {
        src: "screenshots/usage-config-page.png",
        title: "Usage query setup",
        desc: "NewAPI relay templates, timeout and auto-refresh, plus a test query, all on one page",
      },
      {
        src: "screenshots/preset-picker.png",
        title: "Provider presets",
        desc: "Tick through 22 presets to add popular vendors",
      },
      {
        src: "screenshots/kimi-oauth-dialog.png",
        title: "Kimi authorization",
        desc: "Device-code flow identical to kimi login, auto-renews on expiry",
      },
      {
        src: "screenshots/dashboard-daily-detail.png",
        title: "Usage details",
        desc: "Daily token and cost trends",
      },
      {
        src: "screenshots/sessions-light.png",
        title: "Session manager",
        desc: "Browse and resume past sessions across providers",
      },
      {
        src: "screenshots/kimi-plan-quota-card.png",
        title: "Plan quota card",
        desc: "5-hour / weekly quotas read straight off the card",
      },
    ],
  },
  performance: {
    title: "Lightweight and native",
    subtitle: "Tauri + Rust on the system WebView2 — no bundled Chromium. The three numbers below are idle-state measurements.",
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
        version: "v0.7.12",
        date: "2026-09-03",
        items: [
          "Adapted to kimi-code 0.40.1: experimental flag list updated (adds file_history / search_worker; secondary-model now on by default)",
          "Flag priority semantics fixed: explicit configuration takes precedence over the master toggle, which no longer locks every switch",
          "New dangerous-command guard toggle: Auto mode rejects rm -rf / shutdown outright, other modes force a confirmation prompt",
          "Fix race-condition errors when clicking repeatedly while the WebUI is slow to open for the first time",
          "models-dev snapshot updated to 7495 models / 212 providers",
        ],
      },
      {
        version: "v0.7.4",
        date: "2026-08-09",
        items: [
          "Dashboard heatmap double-click: click any heatmap cell to see per-model breakdown with Token / requests / cost / cache hit rate",
          "Backend by_model data structure upgraded from plain token counts to structured objects; bar chart double-click modal also shows full metrics",
          "Out-of-range dates are not double-clickable and have no hover zoom",
        ],
      },
      {
        version: "v0.7.3",
        date: "2026-08-07",
        items: [
          "Advanced Settings gains an embedded Kimi Code WebUI window: the new Web UI opens in an independent top-level window (singleton, resizable, centered) instead of the external browser",
          "Two WebUI entries coexist: in-app independent window / system browser (reuses an already-running kimi web server, no duplicate spawn)",
          "Server process is managed automatically: servers we start are cleaned up when the window closes or the app exits; a failed window creation no longer leaks the process",
          "Re-opening focuses and restores a minimized window; release notes wording synced",
        ],
      },
      {
        version: "v0.7.2",
        date: "2026-08-07",
        items: [
          "Subagent settings upgraded to an Advanced Settings page: subagent model assignment, experimental toggles and a WebUI quick launcher",
          "New Kimi Code WebUI quick open: open the new Web UI in an independent in-app window from Advanced Settings, or in your system browser (kimi-code 0.33+)",
          "Subagent model assignment (experimental): pick a secondary model for subagents so they no longer inherit the main model by default",
          "Experiment toggle converted to a sliding switch, fixing the invisible enabled state",
          "Compatible with kimi-code 0.33+ (v2 engine): loop control now writes max_attempts_per_step with auto-migration",
          "models.dev model list and pricing snapshot synced",
          "Enterprise-style website refresh; publisher identity unified as codingplan.site",
          "macOS install polish: releases now ship install-macos.sh, which clears the download quarantine for you",
        ],
      },
      {
        version: "v0.7.1",
        date: "2026-08-05",
        items: [
          "Experimental settings gain a secondary-model picker for subagents, decoupling them from the main model",
          "Dashboard usage stats identify subagent requests (__secondary__) and show them separately with cached secondary-model pricing",
          "Custom gateway models match prices against the same-named official model across providers",
        ],
      },
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
          "Recent requests gain a cache-hit-rate column, shown per request",
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
          "Model pricing data aligned with models.dev, snapshot refreshed per release",
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
    title: "Your data stays on your machine",
    subtitle: "Our privacy and open-source commitments in three sentences.",
    items: [
      {
        id: "local",
        title: "Local storage",
        desc: "Configs and usage data live only in ~/.kimi-switch and config.toml. Nothing is uploaded.",
      },
      {
        id: "direct",
        title: "Direct connections",
        desc: "Billing queries go straight to each vendor's official API. No middlemen, no tracking.",
      },
      {
        id: "open",
        title: "Open & auditable",
        desc: "Fully open source under MIT on GitHub. Reviews and contributions welcome.",
      },
    ],
  },
  download: {
    title: "Download Kimi Switch",
    subtitle: "Current version v0.7.12 · Windows, macOS and Linux now released",
    autoUpdate: "Update checks run at startup and every 8 hours; Settings also has a manual check.",
    ready: "Available",
    wip: "In development",
    githubBtn: "Download from GitHub",
    mirrorBtn: "China mirror",
    items: [
      { id: "windows", name: "Windows", ready: true, note: ".msi installer, lives in the system tray" },
      { id: "macos", name: "macOS", ready: true, note: ".dmg installer (Apple Silicon); unsigned — grab install-macos.sh from the release and run bash install-macos.sh to clear the quarantine flag" },
      { id: "linux", name: "Linux", ready: true, note: ".deb / .AppImage / .rpm" },
    ],
  },
  cta: {
    title: "Put provider config, usage and billing in one window",
    subtitle: "Free · MIT licensed · Windows / macOS / Linux",
    download: "Free Download",
    source: "GitHub source",
  },
  seo: {
    home: {
      title: "Kimi Switch — LLM provider config, usage and billing in one app",
      description:
        "Kimi Switch / KimiCodeSwitch — a desktop manager for LLM provider configuration. 22 presets write straight into ~/.kimi-code/config.toml; usage and billing read from each vendor's own API. Open source MIT.",
    },
    features: {
      title: "Core features - Kimi Switch",
      description:
        "Kimi Switch features: provider presets and custom config, usage & billing, Kimi device-code login, model discovery and periodic update checks.",
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
    recommend: "Recommended providers",
    mirror: "China mirror",
    downloads: "Total GitHub downloads: {n}",
    creditBefore: "Dashboard & session management adapted from ",
    creditAfter: " (MIT, © JochenYang)",
    recommendText: {
      Kimi: "Sign up with my invite link and we both win rewards, up to a 1-year membership equivalent",
      "智谱 GLM":
        "Register on BigModel.cn via my invite link and get a 20M token gift pack for the new GLM-5.2 flagship",
      DeepSeek: "",
      OpenCodeGo: "When a friend subscribes, you get $5 and they get $5.",
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
