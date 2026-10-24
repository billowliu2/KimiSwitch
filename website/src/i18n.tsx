import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Lang = "zh" | "en";

/** Release the site advertises. `assets()` in sections/Download.tsx builds the
 *  per-platform download URLs from it, so a version bump is a one-line change. */
export const VERSION = "0.8.8";
export const VERSION_TAG = `v${VERSION}`;

const zh = {
  nav: {
    home: "首页",
    features: "功能",
    showcase: "界面",
    changelog: "更新日志",
    download: "下载",
    downloadBtn: `下载 v${VERSION}`,
    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    themeAuto: "跟随系统",
    langLabel: "切换语言",
    menu: "菜单",
  },
  hero: {
    badge: "开源 MIT · Windows / macOS / Linux",
    titleBefore: "把供应商配置",
    titleAccent: "收进一个窗口",
    titleAfter: "",
    subtitle:
      "Kimi Switch 是 Kimi Code 的配置管理器。22 个预设选好就写进 config.toml，写入前自动备份；用量、余额与账单直读各厂商官方接口，不经过第三方。",
    download: "免费下载",
    secondary: "查看源码",
    imageAlt: "Kimi Switch 供应商列表，展示使用中的供应商、模型数量与用量徽标",
  },
  facts: {
    items: [
      { value: "22", label: "预设供应商", desc: "Base URL 与模型映射已填好" },
      { value: "8,873", label: "模型价格库", desc: "models.dev 快照，230 家供应商" },
      { value: "3", label: "桌面平台", desc: "Windows / macOS / Linux" },
      { value: "MIT", label: "开源协议", desc: "全量源码可审计" },
    ],
  },
  showcase: {
    title: "界面演示",
    subtitle: "以下截图取自 v0.8.4 实机运行的深色主题界面。",
    captionPrefix: "截图",
    tabs: [
      {
        id: "providers",
        src: "screenshots/v084/providers-dark.png",
        tab: "供应商列表",
        title: "一个列表看完全部供应商",
        desc: "每张卡片直接显示默认模型、模型数量、延迟与用量徽标；顶部「一键体检」批量探测连通性，右下角「切换使用」写入配置。",
        points: ["22 个预设，勾选即添加", "卡片级用量徽标，5 小时 / 每周额度", "一键体检：批量测延迟", "切换只改默认模型，其它供应商不动"],
      },
      {
        id: "dashboard",
        src: "screenshots/v084/dashboard-dark.png",
        tab: "用量仪表盘",
        title: "用量按天、按模型摊开",
        desc: "全年热力图铺满一行，五档时间范围各自汇总；缓存命中率、请求数、预估费用与总 Token 一眼可见。",
        points: ["今天 / 昨天 / 7 天 / 30 天 / 全部", "全年热力图，按 Token 量着色", "按模型的请求、Token 与费用明细", "费用按 models.dev 牌价折算"],
      },
      {
        id: "sessions",
        src: "screenshots/v084/sessions-dark.png",
        tab: "会话管理",
        title: "跨供应商找回过往会话",
        desc: "按工作区浏览历史会话，支持归档、复活与批量删除，会话文件保留在 ~/.kimi-code 本地目录中。",
        points: ["按工作区归类，显示会话数量", "活跃 / 已归档 / 全部三种视图", "批量归档与批量删除", "逐行预览，大文件按字节上限截断"],
      },
      {
        id: "settings-global",
        src: "screenshots/v084/settings-global-dark.png",
        tab: "全局设置",
        title: "全局配置写回 config.toml",
        desc: "思考开关与五档思考等级、循环控制的重试上限、上下文预留与压缩重试，全部落在一张表单里。",
        points: ["思考等级按模型能力置灰", "单步最大尝试次数 / 上下文预留大小", "上下文压缩重试上限", "保存前自动备份配置"],
      },
      {
        id: "settings-advanced",
        src: "screenshots/v084/settings-advanced-dark.png",
        tab: "高级设置",
        title: "WebUI、模型数据与子代理",
        desc: "新版 Kimi Code WebUI 可在应用内独立窗口打开；models.dev 参考数据可在线同步或恢复内置快照；子代理模型逐条指定路由。",
        points: ["WebUI：应用内窗口 / 系统浏览器", "models.dev 在线同步与内置数据回滚", "子代理模型池，逐条填写路由描述", "实验功能开关集中管理"],
      },
      {
        id: "settings-about",
        src: "screenshots/v084/settings-about-dark.png",
        tab: "关于",
        title: "版本、更新与外观",
        desc: "当前版本、最近一次检查时间与手动检查更新按钮；外观三态切换与语言切换也在这一页。",
        points: ["应用内检查更新并引导安装", "kimi-code CLI 版本与适配状态核验", "浅色 / 深色 / 跟随系统", "简体中文 / English"],
      },
    ],
    hint: "切换上方标签查看不同页面。",
  },
  features: {
    title: "核心功能",
    subtitle: "配置、切换、用量、账单、会话与更新，全都围绕本机那份 ~/.kimi-code/config.toml 展开。",
    items: [
      {
        id: "multi-provider",
        title: "多供应商管理",
        desc: "Kimi、智谱 GLM、MiniMax、DeepSeek、OpenRouter、基元律动等 22 个预设，Base URL 与模型映射已填好，选定即写入配置。",
        points: ["新增或激活的供应商自动排到最前", "切换只改 default_model，不丢其它供应商", "Kimi / Anthropic / OpenAI / Google GenAI / Vertex AI 协议全覆盖"],
      },
      {
        id: "custom-provider",
        title: "自定义供应商",
        desc: "Base URL、API Key、模型别名逐字段编辑，也可以切到 JSON 页签直接改整份配置。",
        points: ["未知字段通过 raw_other 原样透传", "模型映射表：别名、上下文、最大输出 Token、能力", "写入前自动备份，按时间戳保留最近 7 天"],
      },
      {
        id: "usage",
        title: "用量与账单监控",
        desc: "套餐的 5 小时 / 每周额度、订阅占比与按量余额直接显示在供应商卡片上。",
        points: ["NewAPI 订阅额度与钱包余额分开两行展示", "成本按 models.dev 牌价折算", "用量快照本地持久化，重启后首次打开 1 秒内呈现"],
      },
      {
        id: "sessions",
        title: "会话管理",
        desc: "跨供应商浏览、搜索、归档与恢复历史会话，不需要手工翻目录。",
        points: ["按工作区归类与批量操作", "逐行流式预览，20MB 字节上限", "归档后可随时复活"],
      },
      {
        id: "kimi-auth",
        title: "Kimi 授权登录",
        desc: "应用内置设备码授权，效果等同于命令行 kimi login，浏览器点一下即可。",
        points: ["无需命令行与手工复制 Key", "凭据自动写入配置", "15 分钟过期自动续期"],
      },
      {
        id: "model-discovery",
        title: "模型自动发现",
        desc: "可用模型直接问供应商 API，显示名、上下文长度与能力取自 models.dev 快照。",
        points: ["API 返回 > models.dev 参考 > 正则兜底", "当前快照 8,873 个模型、230 家供应商", "最大输出 Token 可一键填入参考值"],
      },
      {
        id: "auto-update",
        title: "自动更新",
        desc: "启动时与每 8 小时各查一次新版本，私有镜像优先、GitHub 兜底，应用内下载并引导安装。",
        points: ["下载进度与手动重试", "安装包按平台自动选择", "kimi-code CLI 版本与适配状态一并核验"],
      },
      {
        id: "native-app",
        title: "原生桌面体验",
        desc: "像本地程序一样启动、常驻与退出：单实例运行，关闭窗口隐藏到托盘，主题与语言设置持久化。",
        points: ["单实例运行，关闭窗口隐藏到托盘", "最小化保留任务栏按钮", "Ctrl+S / Ctrl+R / Ctrl+O 三组快捷键"],
      },
    ],
    tableTitle: "兼容与存储",
    tableNote: "以下是应用实际读写的路径与支持的协议，便于先确认再安装。",
    table: [
      { k: "配置文件", v: "~/.kimi-code/config.toml", note: "写入前自动备份" },
      { k: "应用数据", v: "%USERPROFILE%\\.kimi-switch\\kimi-switch.db", note: "备注、官网、排序等元数据" },
      { k: "会话目录", v: "~/.kimi-code", note: "会话管理读取的来源" },
      { k: "模型数据", v: "src/lib/models-dev.json", note: "随版本更新，也可在线同步" },
      { k: "API 协议", v: "Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI", note: "凭证优先取 api_key，其次 env" },
      { k: "快捷键", v: "Ctrl+S 保存 · Ctrl+R 重载 · Ctrl+O 打开配置目录", note: "与桌面应用一致" },
    ],
  },
  performance: {
    title: "轻量原生",
    subtitle: "Tauri + Rust，复用系统 WebView2，不打包 Chromium。下面三项为空闲状态实测值。",
    metrics: [
      { target: 93, suffix: " MB", label: "Working Set", desc: "程序空闲态工作集内存" },
      { target: 34, suffix: " MB", label: "Private WS", desc: "独占内存，WebView2 共享部分扣除" },
      { target: 0.3, decimals: 1, suffix: "%", label: "CPU 空闲", desc: "无活跃任务时几乎零占用" },
    ],
    footNote: "启动时与每 8 小时检查一次更新，下载在应用内完成，安装包由系统安装程序接管。",
  },
  privacy: {
    title: "你的数据，只在你的电脑上",
    subtitle: "隐私与开源承诺，三句话说清。",
    items: [
      {
        id: "local",
        title: "本地存储",
        desc: "配置与元数据只落在 ~/.kimi-code 与 ~/.kimi-switch，不上传任何服务器。",
      },
      {
        id: "direct",
        title: "官方直连",
        desc: "余额与用量查询直连各厂商官方接口，没有中间转发，也没有统计埋点。",
      },
      {
        id: "open",
        title: "开源可审计",
        desc: "MIT 协议全量开源，前端与 Rust 后端源码都可逐行审阅。",
      },
    ],
  },
  download: {
    title: "下载 Kimi Switch",
    subtitle: `当前版本 v${VERSION} · Windows / macOS / Linux 三平台均已发布`,
    versionLabel: "最新版本",
    primaryLabel: "推荐",
    mirrorName: "国内镜像",
    mirrorNote: "镜像站直连更快，部分平台产物只在 GitHub 发布。",
    githubAll: "GitHub Releases",
    mirrorAll: "镜像站 Releases",
    msiNote: "自 v0.8.3 起 Windows 以 NSIS 安装包为主，MSI 不再主动发布；历史版本的 .msi 仍可下载，需要 MSI 可本地执行 npx tauri build --bundles msi 自行构建。",
    autoUpdate: "更新检查跑在启动时与每 8 小时的周期任务里，设置页也可以手动触发。",
    ready: "已发布",
    items: [
      {
        id: "windows",
        name: "Windows",
        note: "NSIS 安装包，含 WebView2 bootstrapper 自动下载；安装后常驻系统托盘。",
        assets: [
          { label: "下载 .exe", kind: "primary", file: `Kimi.Switch_${VERSION}_x64-setup.exe` },
        ],
      },
      {
        id: "macos",
        name: "macOS",
        note: "Apple Silicon (.dmg)，未签名。下载 Release 附带的 install-macos.sh 后执行 bash install-macos.sh 可自动清除隔离属性。",
        assets: [
          { label: "下载 .dmg", kind: "primary", file: `Kimi.Switch_${VERSION}_aarch64.dmg` },
          { label: "安装脚本", kind: "ghost", file: "install-macos.sh" },
        ],
      },
      {
        id: "linux",
        name: "Linux",
        note: "提供 .deb / .AppImage / .rpm 三种格式，AppImage 免安装可直接运行。",
        assets: [
          { label: ".deb", kind: "primary", file: `Kimi.Switch_${VERSION}_amd64.deb` },
          { label: ".AppImage", kind: "ghost", file: `Kimi.Switch_${VERSION}_amd64.AppImage` },
          { label: ".rpm", kind: "ghost", file: `Kimi.Switch-${VERSION}-1.x86_64.rpm` },
        ],
      },
    ],
    installTitle: "安装后会发生什么",
    installSteps: [
      "首次启动读取 ~/.kimi-code/config.toml，没有则引导创建",
      "供应商列表预置 22 个预设，勾选需要的厂商即可添加",
      "写入配置前自动备份，备份按时间戳保留最近 7 天",
      "之后每次启动检查更新，可随时在设置页关闭",
    ],
  },
  cta: {
    title: "把供应商配置、用量和账单收进一个窗口",
    subtitle: "免费 · MIT 开源 · Windows / macOS / Linux",
    download: "免费下载",
    source: "GitHub 源码",
  },
  changelog: {
    title: "更新日志",
    subtitle: "每个版本的重要变更记录，页面会自动同步 GitHub Releases。",
    syncedNote: "数据已同步 GitHub Releases",
    fallbackNote: "内置版本记录",
    entries: [
      {
        version: "v0.8.8",
        date: "2026-10-24",
        items: [
          "模型表新增「思考等级」列：档位按模型 support_efforts 与 models.dev 能力自动确定，默认 high、模型不支持 high 时取其最高档；批量添加模型、应用预设、同步数据后自动补齐",
          "数据安全修复（高危）：保存不再整表覆盖 config.toml——kimi-code 2.3.x 模型目录定时刷新、catalog 引导、/provider refresh 写入的 provider / model 从此不再被抹掉；provider 级官方 default_model 不再被当作私有键剥除",
          "kimi-code 2.3.x 新字段适配：「禁用反馈调查」开关（disable_feedback_survey，仅勾选时写入）、模型行 upgrade「将停用」只读标记、危险命令防护文案更正为三类防护总闸",
          "全局 [thinking] effort 未显式设置时不再写死 medium，不再压过模型级 default_effort",
          "models.dev 快照引入 schema_version=2 并同步至 2026-10-23（8,872 模型 / 230 提供商）：旧格式的运行时副本不再遮住内置数据，点一次「立即同步」即切换为新格式",
        ],
      },
      {
        version: "v0.8.7",
        date: "2026-10-17",
        items: [
          "撞名防护对抗性审查后补齐六处缺口：连续撞名改为多槽暂存（第二个被顶掉的条目也能找回）、用量配置弹窗接入保存守卫、重载失败不再清空暂存",
          "重名变体拦截：TokenHub 与尾随空格这类 trim 后同名的变体，保存闸门增加 trim 级扫描，不再能落盘",
          "撞名未解决时拦截顶栏导航，防止带着不完整暂存游走触发边角路径；普通未保存修改的导航体验不变",
          "JSON 应用改名后同样自动还原被顶掉的条目；存在性判断全部改用 Object.hasOwn，constructor 之类的原型键名不再产生幽灵撞名",
          "models.dev 快照同步至 2026-10-17（8,994 模型）；零 Rust 改动，升级 / 回退无迁移成本",
        ],
      },
      {
        version: "v0.8.6",
        date: "2026-10-16",
        items: [
          "修复供应商名称撞车静默覆盖事故：新建第二个同名供应商（如两把 Key 都叫 TokenHub）会在无提示中顶掉旧条目，任意一次保存即把丢失状态写进 config.toml",
          "四条写入点（编辑改名、JSON 应用、新建占位名、保存校验）全部增加名称查重；Ctrl+S 窗口级快捷键同样过检",
          "撞名即时红框提示 + 三条保存入口硬阻止；被顶掉的供应商自动暂存保护，改名离开撞名状态时连同 Key 和模型映射一起还原",
          "新建占位名循环取号不再回退撞名；粘贴 JSON 源头拒绝重名；复制提示显示真实新名",
          "名称比较大小写敏感全等、首尾空白忽略；models.dev 快照同步至 2026-10-16（8,894 模型 / 230 提供商）",
        ],
      },
      {
        version: "v0.8.5",
        date: "2026-10-16",
        items: [
          "设置弹窗改为全局设置页面，与主导航平级切换，按「全局设置 / 高级设置 / 关于」分三页，非活动页只隐藏不卸载",
          "「高级设置」入口移入顶部导航组；供应商编辑页不再内嵌代理设置，全局设置页成为唯一入口",
          "一键体检修复账单缺口：仅配了 NewAPI / Sub2API 查询模板（usageKinds 为空）的供应商不再被静默跳过",
          "更新下载修复：release 无当前平台安装包资产时回退为打开 release 页面；自动更新过滤 draft 与 prerelease",
          "关于区新增 OpenTerminal 推荐链接；models.dev 快照同步至 2026-10-15（8,873 模型 / 230 供应商）",
        ],
      },
      {
        version: "v0.8.4",
        date: "2026-10-15",
        items: [
          "NewAPI 中转站同时展示订阅额度占比与钱包余额两套数据，多个活跃订阅逐行列出并参与预警阈值",
          "修复配置面板把钱包金额误算成「已用百分比」的问题，只有真正的配额行才显示占比",
          "老版本 NewAPI 站点无 /api/subscription/self 接口时静默降级，行为与 v0.8.3 一致",
          "Windows 安装包改为以 NSIS（.exe）为主，MSI 不再主动发布；应用内更新优先下载 NSIS 安装包",
          "models.dev 快照同步至 2026-10-15（8,876 模型 / 230 供应商）",
        ],
      },
      {
        version: "v0.8.3",
        date: "2026-10-15",
        items: [
          "供应商改名时模型别名同步重键，不再留下指向旧前缀的僵尸条目",
          "修复 SQLite 镜像让已删模型保存后复活的问题，改名冲突也不再静默吞掉模型",
          "复制供应商不再清空源供应商，副本独立、源完整",
          "删除供应商或模型时清理子代理模型池、默认模型与用量查询配置中的关联条目",
          "适配 kimi-code 2.2.0：新增的 [mcp] default_deferred 与 [models] upgrade 在导入导出间无损保留",
        ],
      },
      {
        version: "v0.8.2",
        date: "2026-10-09",
        items: [
          "仪表盘重启后首次打开从约 25 秒降到 1 秒内：用量解析快照持久化到本地，启动直读并在后台校验",
          "切换时间范围几乎瞬时：热力图、模型总览与各范围汇总按记录集缓存",
          "界面不再闪加载态：切范围与重新进入页面先呈现上次数据再后台静默刷新",
          "models.dev 快照同步至 2026-10-09（8,467 模型 / 225 供应商）",
        ],
      },
      {
        version: "v0.8.1",
        date: "2026-10-04",
        items: [
          "全局配置新增两个顶层开关：自动生成会话标题（auto_session_title）与重复调用拦截（repeat_breaker），默认开启",
          "最大输出未匹配 models.dev 时回填默认值 131072（128K 兜底）",
          "修复 [watch] enabled 默认值显示；「最大输出」列描述对齐上游 #4091",
        ],
      },
      {
        version: "v0.8.0",
        date: "2026-10-03",
        items: [
          "模型映射新增「最大输出 Token」列：逐模型设置 max_output_size，models.dev 有上限时显示可点击参考值",
          "models.dev 快照新增 output 上限字段，同步至 2026-10-03（8,385 模型 / 226 供应商）",
          "移除从不生效的「声明支持 1M」复选框，由「最大输出 Token」列取代",
        ],
      },
      {
        version: "v0.7.23",
        date: "2026-09-30",
        items: [
          "思考等级五档加能力感知：Low / Medium / High / XHigh / Max，按当前默认模型的 support_efforts 自动置灰不支持档位",
          "models.dev 标记不支持思考的模型整体禁用思考区；未声明档位保留可选并提示上游可能拒绝",
        ],
      },
      {
        version: "v0.7.12",
        date: "2026-09-03",
        items: [
          "适配 kimi-code 0.40.1：实验 flag 清单更新（新增 file_history / search_worker）",
          "flag 优先级语义修正：显式配置优先于总开关",
          "新增危险命令守卫开关：Auto 模式直接拒绝 rm -rf、shutdown 等危险命令",
          "models-dev 快照更新至 7495 模型 / 212 供应商",
        ],
      },
      {
        version: "v0.7.4",
        date: "2026-08-09",
        items: [
          "仪表盘热力图双击弹窗：查看当日各模型的 Token、请求次数、费用与命中率",
          "后端 by_model 数据结构升级为结构化对象，柱状图双击弹窗同步展示全量指标",
        ],
      },
      {
        version: "v0.7.3",
        date: "2026-08-07",
        items: [
          "高级设置新增 Kimi Code WebUI 应用内嵌窗口，以独立顶层窗口打开，不再跳转外部浏览器",
          "服务器进程自动管理：自己启动的服务器随窗口关闭或应用退出清理",
        ],
      },
      {
        version: "v0.7.2",
        date: "2026-08-07",
        items: [
          "「子代理设置」升级为「高级设置」：聚合子代理模型指定、实验功能开关与 WebUI 快捷入口",
          "实验开关改为滑动开关，修复开启态不可见的问题",
          "兼容 kimi-code 0.33+：循环控制改用新键 max_attempts_per_step，旧配置自动迁移",
          "macOS 安装优化：Release 附带 install-macos.sh，自动清除下载隔离",
        ],
      },
      {
        version: "v0.7.1",
        date: "2026-08-05",
        items: [
          "实验功能设置新增子代理模型（次主力模型）配置，子代理不再继承主模型",
          "仪表盘识别子代理请求（__secondary__）并独立展示，缓存次主力模型定价",
        ],
      },
      {
        version: "v0.7.0",
        date: "2026-08-02",
        items: [
          "订阅套餐模型计价修正：零价条目按官方付费模型计价",
          "-highspeed / -free 派生变体自动回退基础模型价格",
          "设置页识图能力可手动编辑；关于页新增官方网站与 Kimi Eyes 识图插件站链接",
        ],
      },
      {
        version: "v0.6.9",
        date: "2026-08-01",
        items: [
          "最近请求新增缓存命中率列",
          "中文模式费用按最新汇率换算人民币显示，英文模式保持美元",
          "仪表盘性能优化：价格解析记忆化缓存，扫描从秒级降到百毫秒级",
        ],
      },
      {
        version: "v0.6.8",
        date: "2026-08-01",
        items: [
          "仪表盘加载提速：models.dev 快照移出主 bundle，异步加载不阻塞首帧",
          "Rust 价格索引启动时后台预热，get_summary 扫描结果缓存 8 秒",
          "官网更新：视觉重设计、中英文切换、更新日志同步 GitHub Releases",
        ],
      },
      {
        version: "v0.6.7",
        date: "2026-08-01",
        items: [
          "应用内置 Kimi 授权登录（Device Code Flow），浏览器授权即用",
          "授权后凭据自动写入，15 分钟过期自动续期",
        ],
      },
      {
        version: "v0.6.6",
        date: "2026-08-01",
        items: ["模型价格数据对标 models.dev，快照随版本更新", "新增基元律动供应商与推荐链接"],
      },
      {
        version: "v0.6.4",
        date: "2026-08-01",
        items: ["新增套餐账单查询，5 小时 / 每周用量卡片直显", "OpenCode Zen 预设补充推荐链接"],
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
        items: ["预设供应商与供应商账单查询上线", "多平台打包：macOS / Linux / Windows CI 同步发布"],
      },
    ],
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
        "Kimi Switch 功能页：多供应商预设与自定义配置、用量与账单监控、Kimi 设备码授权、会话管理、模型自动发现与周期更新检查，附兼容协议与本地存储路径说明。",
    },
    changelog: {
      title: "更新日志 - Kimi Switch",
      description:
        "Kimi Switch 更新日志：每个版本的重要变更记录，含 v0.8.8 的模型思考等级列与 kimi-code 2.3.1 适配，同步自 GitHub Releases。",
    },
    download: {
      title: "下载 - Kimi Switch",
      description:
        `下载 Kimi Switch v${VERSION}：Windows NSIS 安装包、macOS .dmg、Linux .deb / .AppImage / .rpm，提供 GitHub 与国内镜像双通道，免费开源 MIT。`,
    },
  },
  footer: {
    blurb: "Kimi Code 的桌面配置管理器：预设、切换、用量、账单与会话都在本机完成。",
    recommend: "推荐供应商",
    mirror: "国内镜像",
    downloads: "GitHub 累计下载 {n} 次",
    product: "产品",
    resources: "资源",
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
    showcase: "Screens",
    changelog: "Changelog",
    download: "Download",
    downloadBtn: `Download v${VERSION}`,
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeAuto: "System",
    langLabel: "Switch language",
    menu: "Menu",
  },
  hero: {
    badge: "Open source MIT · Windows / macOS / Linux",
    titleBefore: "Your provider config,",
    titleAccent: "in one window",
    titleAfter: "",
    subtitle:
      "Kimi Switch is the configuration manager for Kimi Code. Pick one of 22 presets and it goes straight into config.toml with an automatic backup first; usage, balance and billing come from each vendor's own API.",
    download: "Free download",
    secondary: "View source",
    imageAlt: "Kimi Switch provider list showing the active provider, model counts and usage badges",
  },
  facts: {
    items: [
      { value: "22", label: "Provider presets", desc: "Base URL and model mapping pre-filled" },
      { value: "8,873", label: "Model price DB", desc: "models.dev snapshot, 230 providers" },
      { value: "3", label: "Desktop platforms", desc: "Windows / macOS / Linux" },
      { value: "MIT", label: "License", desc: "Full source, auditable" },
    ],
  },
  showcase: {
    title: "Inside the app",
    subtitle: "Every screenshot below is the real v0.8.4 build in dark mode.",
    captionPrefix: "Screenshot",
    tabs: [
      {
        id: "providers",
        src: "screenshots/v084/providers-dark.png",
        tab: "Providers",
        title: "Every provider in one list",
        desc: "Each card shows its default model, model count, latency and usage badge. \"Health check\" probes them all at once; \"Switch to\" writes the choice into your config.",
        points: ["22 presets, tick to add", "Per-card usage badges for 5-hour / weekly quotas", "Batch latency health check", "Switching only changes the default model"],
      },
      {
        id: "dashboard",
        src: "screenshots/v084/dashboard-dark.png",
        tab: "Dashboard",
        title: "Usage split by day and by model",
        desc: "A full-width year heatmap sits above five period summaries, with cache hit rate, request count, estimated cost and total tokens all visible at once.",
        points: ["Today / yesterday / 7d / 30d / all time", "Year heatmap coloured by token volume", "Per-model requests, tokens and cost", "Costs computed at models.dev list prices"],
      },
      {
        id: "sessions",
        src: "screenshots/v084/sessions-dark.png",
        tab: "Sessions",
        title: "Find past sessions across providers",
        desc: "Browse history by workspace, then archive, restore or bulk-delete. Session files stay in your local ~/.kimi-code directory.",
        points: ["Grouped by workspace with counts", "Active / archived / all views", "Bulk archive and bulk delete", "Streaming preview with a byte cap"],
      },
      {
        id: "settings-global",
        src: "screenshots/v084/settings-global-dark.png",
        tab: "Global settings",
        title: "Global config written back to config.toml",
        desc: "Thinking toggle and its five effort tiers, loop-control retry limits, context reservation and compaction retries, all on one form.",
        points: ["Effort tiers greyed out per model capability", "Per-step attempt and context reservation limits", "Compaction retry ceiling", "Automatic backup before every save"],
      },
      {
        id: "settings-advanced",
        src: "screenshots/v084/settings-advanced-dark.png",
        tab: "Advanced settings",
        title: "WebUI, model data and subagents",
        desc: "The new Kimi Code WebUI opens in its own in-app window; the models.dev reference data can sync online or revert to the bundled snapshot; subagent routing is set per entry.",
        points: ["WebUI in an in-app window or the system browser", "models.dev online sync and bundled-data rollback", "Subagent model pool with routing notes", "Experimental flags in one place"],
      },
      {
        id: "settings-about",
        src: "screenshots/v084/settings-about-dark.png",
        tab: "About",
        title: "Version, updates and appearance",
        desc: "Current version, last check time and a manual update button, plus the three-state appearance switch and language picker.",
        points: ["In-app update check and install hand-off", "kimi-code CLI version and compatibility check", "Light / dark / follow system", "Simplified Chinese / English"],
      },
    ],
    hint: "Switch tabs above to see each page.",
  },
  features: {
    title: "Core features",
    subtitle: "Configuration, switching, usage, billing, sessions and updates, all centred on the config.toml on your machine.",
    items: [
      {
        id: "multi-provider",
        title: "Provider presets",
        desc: "22 presets including Kimi, Zhipu GLM, MiniMax, DeepSeek, OpenRouter and TokenRhythm ship with Base URL and model mapping filled in.",
        points: ["New or activated providers jump to the top", "Switching only rewrites default_model", "Kimi / Anthropic / OpenAI / Google GenAI / Vertex AI protocols"],
      },
      {
        id: "custom-provider",
        title: "Custom providers",
        desc: "Edit Base URL, API key and model aliases field by field, or switch to the JSON tab and edit the whole document.",
        points: ["Unknown fields pass through via raw_other", "Model mapping table: alias, context, max output, capabilities", "Timestamped backups kept for 7 days"],
      },
      {
        id: "usage",
        title: "Usage and billing",
        desc: "5-hour and weekly plan quotas, subscription percentages and pay-as-you-go balances shown right on the provider cards.",
        points: ["NewAPI subscription and wallet balances on separate rows", "Costs computed at models.dev list prices", "Snapshot cached locally: first dashboard open under 1s"],
      },
      {
        id: "sessions",
        title: "Session manager",
        desc: "Browse, search, archive and resume past sessions across providers without digging through folders.",
        points: ["Workspace grouping and bulk actions", "Streaming preview with a 20MB byte cap", "Archived sessions can be restored"],
      },
      {
        id: "kimi-auth",
        title: "Kimi device-code login",
        desc: "Built-in device-code authorization, the same flow as running kimi login, with one click in the browser.",
        points: ["No command line and no copy-pasting keys", "Credentials written into your config", "15-minute expiry renews automatically"],
      },
      {
        id: "model-discovery",
        title: "Model discovery",
        desc: "Model lists come from the provider API itself; display names, context sizes and capabilities come from the models.dev snapshot.",
        points: ["API response > models.dev reference > regex fallback", "Current snapshot: 8,873 models across 230 providers", "Max output tokens can be filled from the reference value"],
      },
      {
        id: "auto-update",
        title: "Automatic updates",
        desc: "Checks at startup and every 8 hours, private mirror first with a GitHub fallback, then downloads and hands off to the installer.",
        points: ["Download progress with manual retry", "Installer picked for your platform", "kimi-code CLI version and compatibility check"],
      },
      {
        id: "native-app",
        title: "Native desktop behaviour",
        desc: "Starts, stays resident and exits like a local program: single instance, closing hides to the tray, and theme and language persist.",
        points: ["Single instance, closing hides to the tray", "Minimising keeps the taskbar button", "Ctrl+S / Ctrl+R / Ctrl+O shortcuts"],
      },
    ],
    tableTitle: "Compatibility and storage",
    tableNote: "What the app actually reads and writes, so you can confirm before installing.",
    table: [
      { k: "Config file", v: "~/.kimi-code/config.toml", note: "Auto-backed up before every write" },
      { k: "App data", v: "%USERPROFILE%\\.kimi-switch\\kimi-switch.db", note: "Notes, homepage, sorting metadata" },
      { k: "Session directory", v: "~/.kimi-code", note: "Source read by the session manager" },
      { k: "Model data", v: "src/lib/models-dev.json", note: "Shipped with releases, synced online on demand" },
      { k: "API protocols", v: "Kimi / Anthropic / OpenAI / OpenAI Responses / Google GenAI / Vertex AI", note: "Credentials: api_key first, then env" },
      { k: "Shortcuts", v: "Ctrl+S save · Ctrl+R reload · Ctrl+O open config dir", note: "Identical to the desktop app" },
    ],
  },
  performance: {
    title: "Lightweight and native",
    subtitle: "Tauri + Rust on the system WebView2, no bundled Chromium. All three numbers are idle measurements.",
    metrics: [
      { target: 93, suffix: " MB", label: "Working Set", desc: "Idle working-set memory" },
      { target: 34, suffix: " MB", label: "Private WS", desc: "Private memory, shared WebView2 excluded" },
      { target: 0.3, decimals: 1, suffix: "%", label: "Idle CPU", desc: "Nearly zero when idle" },
    ],
    footNote: "Update checks run at startup and every 8 hours; downloads happen in-app and the system installer takes over from there.",
  },
  privacy: {
    title: "Your data stays on your machine",
    subtitle: "Privacy and open-source commitments in three sentences.",
    items: [
      {
        id: "local",
        title: "Local storage",
        desc: "Configs and metadata live in ~/.kimi-code and ~/.kimi-switch. Nothing is uploaded anywhere.",
      },
      {
        id: "direct",
        title: "Direct connections",
        desc: "Balance and usage queries go straight to each vendor's official API. No relay, no analytics.",
      },
      {
        id: "open",
        title: "Open and auditable",
        desc: "Fully open source under MIT, with both the front end and the Rust backend readable line by line.",
      },
    ],
  },
  download: {
    title: "Download Kimi Switch",
    subtitle: `Current version v${VERSION} · released for Windows, macOS and Linux`,
    versionLabel: "Latest release",
    primaryLabel: "Recommended",
    mirrorName: "China mirror",
    mirrorNote: "The mirror is faster from mainland China; some platform builds are published on GitHub only.",
    githubAll: "GitHub Releases",
    mirrorAll: "Mirror Releases",
    msiNote: "Since v0.8.3 Windows ships the NSIS installer; MSI is no longer actively published. Historical .msi files remain downloadable, and you can build one locally with npx tauri build --bundles msi.",
    autoUpdate: "Update checks run at startup and every 8 hours, and Settings has a manual check too.",
    ready: "Available",
    items: [
      {
        id: "windows",
        name: "Windows",
        note: "NSIS installer with the WebView2 bootstrapper embedded. Stays in the system tray after install.",
        assets: [
          { label: "Download .exe", kind: "primary", file: `Kimi.Switch_${VERSION}_x64-setup.exe` },
        ],
      },
      {
        id: "macos",
        name: "macOS",
        note: "Apple Silicon (.dmg), unsigned. Grab install-macos.sh from the release and run bash install-macos.sh to clear the quarantine flag automatically.",
        assets: [
          { label: "Download .dmg", kind: "primary", file: `Kimi.Switch_${VERSION}_aarch64.dmg` },
          { label: "Install script", kind: "ghost", file: "install-macos.sh" },
        ],
      },
      {
        id: "linux",
        name: "Linux",
        note: ".deb / .AppImage / .rpm. The AppImage needs no installation and runs directly.",
        assets: [
          { label: ".deb", kind: "primary", file: `Kimi.Switch_${VERSION}_amd64.deb` },
          { label: ".AppImage", kind: "ghost", file: `Kimi.Switch_${VERSION}_amd64.AppImage` },
          { label: ".rpm", kind: "ghost", file: `Kimi.Switch-${VERSION}-1.x86_64.rpm` },
        ],
      },
    ],
    installTitle: "What happens after install",
    installSteps: [
      "First launch reads ~/.kimi-code/config.toml and offers to create it if missing",
      "22 provider presets are ready; tick the vendors you use",
      "Every write is backed up, with timestamped backups kept for 7 days",
      "Updates are checked on each launch and can be disabled in Settings",
    ],
  },
  cta: {
    title: "Provider config, usage and billing in one window",
    subtitle: "Free · MIT licensed · Windows / macOS / Linux",
    download: "Free download",
    source: "GitHub source",
  },
  changelog: {
    title: "Changelog",
    subtitle: "Notable changes in every release, synced from GitHub Releases.",
    syncedNote: "Synced from GitHub Releases",
    fallbackNote: "Bundled release notes",
    entries: [
      {
        version: "v0.8.8",
        date: "2026-10-24",
        items: [
          "New per-model thinking effort column: tiers come from the model's support_efforts and models.dev capability data — high by default, or the model's strongest tier when high is unsupported; bulk-added models, presets and data syncs are seeded automatically",
          "Data-safety fixes (critical): saving no longer overwrites the whole config.toml tables — providers and models written by kimi-code 2.3.x's model catalog refresh, catalog onboarding and /provider refresh survive every save; the official provider-level default_model is no longer stripped as a private key",
          "kimi-code 2.3.x adaptation: a Disable feedback survey switch (disable_feedback_survey, written only when checked), a read-only Retiring badge for models with an upgrade entry, and the dangerous-command guard copy now describes all three gated policies",
          "The global [thinking] effort is no longer pinned to medium when unset, so a per-model default_effort is no longer shadowed",
          "models.dev snapshots gain schema_version=2 and sync to 2026-10-23 (8,872 models / 230 providers): stale unversioned runtime copies no longer shadow the built-in data; one manual sync rewrites them in the new format",
        ],
      },
      {
        version: "v0.8.7",
        date: "2026-10-17",
        items: [
          "Six gaps closed in the name-collision guard after an adversarial review: repeated collisions now use multi-slot stashing (a second displaced provider is also recoverable), the usage dialog goes through the save guard, and a failed reload no longer clears the stash",
          "Trim-level duplicate scan: variants like TokenHub with a trailing space can no longer be saved",
          "Navigation is blocked while a name collision is unresolved, preventing half-stashed state from wandering into edge paths; normal unsaved-change navigation is unchanged",
          "Applying a rename via the config JSON now restores the displaced provider too; existence checks use Object.hasOwn, so prototype key names like constructor no longer trigger ghost collisions",
          "models.dev snapshot synced to 2026-10-17 (8,994 models); zero Rust changes, no migration cost to upgrade or roll back",
        ],
      },
      {
        version: "v0.8.6",
        date: "2026-10-16",
        items: [
          "Fixed the silent name-collision overwrite incident: adding a second provider with the same name (e.g. two keys both called TokenHub) displaced the original entry without any warning, and the next save wrote the loss to config.toml",
          "All four write paths (edit rename, JSON apply, new placeholder names, save validation) now check for duplicate names; the window-level Ctrl+S shortcut goes through the same gate",
          "Instant red-frame feedback plus hard blocks on all three save entries; the displaced provider is stashed and restored — keys and model mappings included — once the collision is resolved",
          "Placeholder names cycle to the next free number; pasted JSON with a duplicate name is rejected at the source; duplicate toasts show the real new name",
          "Name comparison is case-sensitive exact match with trimmed whitespace; models.dev snapshot synced to 2026-10-16 (8,894 models / 230 providers)",
        ],
      },
      {
        version: "v0.8.5",
        date: "2026-10-16",
        items: [
          "The settings modal is now a full settings page switched peer-level from the main nav, split into Global Settings / Advanced Settings / About; inactive tabs are hidden, not unmounted",
          "The Advanced Settings entry moved into the top navigation; the provider editor no longer embeds proxy settings, leaving the settings page as the single entry point",
          "Health check billing gap fixed: providers with only a NewAPI / Sub2API query template (empty usageKinds) are no longer silently skipped",
          "Update download fixed: when a release has no installer for the current platform the Download button falls back to the release page; auto-update filters out drafts and prereleases",
          "Added an OpenTerminal recommendation link in the About section; models.dev snapshot synced to 2026-10-15 (8,873 models / 230 providers)",
        ],
      },
      {
        version: "v0.8.4",
        date: "2026-10-15",
        items: [
          "NewAPI relays now show subscription quota percentages and wallet balance as two separate ledgers; multiple active subscriptions are listed line by line and participate in warning thresholds",
          "Fixed the config panel treating a wallet balance as a nonsensical \"percent used\"; only real quota rows show a percentage now",
          "Older NewAPI sites without /api/subscription/self degrade silently, matching v0.8.3 behaviour",
          "Windows packaging switched to NSIS (.exe) as the primary format; MSI is no longer actively published, and in-app updates prefer the NSIS installer",
          "models.dev snapshot synced to 2026-10-15 (8,876 models / 230 providers)",
        ],
      },
      {
        version: "v0.8.3",
        date: "2026-10-15",
        items: [
          "Renaming a provider re-keys its model aliases instead of leaving zombie entries pointing at the old prefix",
          "Deleted models no longer come back through the SQLite mirror; rename collisions no longer swallow models silently",
          "Duplicating a provider no longer empties the source provider",
          "Deleting a provider or model cleans up subagent pools, default models and usage-query config",
          "kimi-code 2.2.0 adaptation: the new [mcp] default_deferred and [models] upgrade survive an import/export round trip",
        ],
      },
      {
        version: "v0.8.2",
        date: "2026-10-09",
        items: [
          "First dashboard open after a restart dropped from about 25s to under 1s: the usage snapshot is persisted locally and verified in the background",
          "Switching the time range is near-instant: heatmap, model overview and per-range totals are cached per record set",
          "No more loading flicker: previous data renders first, then revalidates silently",
          "models.dev snapshot synced to 2026-10-09 (8,467 models / 225 providers)",
        ],
      },
      {
        version: "v0.8.1",
        date: "2026-10-04",
        items: [
          "Two new top-level switches: auto session title (auto_session_title) and repeat breaker (repeat_breaker), on by default",
          "Max output backfills 131072 (128K) when models.dev has no match",
          "Fixed the [watch] enabled default display; Max output column wording aligned with upstream #4091",
        ],
      },
      {
        version: "v0.8.0",
        date: "2026-10-03",
        items: [
          "New per-model Max Output Token column writing max_output_size, with a click-to-fill reference from models.dev",
          "models.dev snapshot gains the output-limit field, synced to 2026-10-03 (8,385 models / 226 providers)",
          "Removed the never-effective \"supports 1M\" checkbox, replaced by the Max Output Token column",
        ],
      },
      {
        version: "v0.7.23",
        date: "2026-09-30",
        items: [
          "Five capability-aware thinking tiers: Low / Medium / High / XHigh / Max, greyed out per the default model's support_efforts",
          "Models flagged non-reasoning by models.dev disable the thinking area entirely, with an explanation",
        ],
      },
      {
        version: "v0.7.12",
        date: "2026-09-03",
        items: [
          "Adapted to kimi-code 0.40.1: experimental flag list updated (adds file_history / search_worker)",
          "Flag priority fixed: explicit configuration beats the master toggle",
          "New dangerous-command guard: Auto mode rejects rm -rf and shutdown outright",
          "models-dev snapshot updated to 7495 models / 212 providers",
        ],
      },
      {
        version: "v0.7.4",
        date: "2026-08-09",
        items: [
          "Heatmap double-click shows per-model tokens, requests, cost and hit rate for that day",
          "Backend by_model upgraded to structured objects; the bar-chart modal shows the same metrics",
        ],
      },
      {
        version: "v0.7.3",
        date: "2026-08-07",
        items: [
          "Advanced Settings gained an embedded Kimi Code WebUI window instead of jumping to an external browser",
          "Server processes are managed automatically and cleaned up when the window or app closes",
        ],
      },
      {
        version: "v0.7.2",
        date: "2026-08-07",
        items: [
          "Subagent settings became Advanced Settings, grouping subagent models, experimental flags and the WebUI launcher",
          "Experiment toggles converted to sliding switches, fixing the invisible enabled state",
          "kimi-code 0.33+ compatibility: loop control writes max_attempts_per_step with auto-migration",
          "macOS install polish: releases ship install-macos.sh to clear the download quarantine",
        ],
      },
      {
        version: "v0.7.1",
        date: "2026-08-05",
        items: [
          "Secondary-model picker lets subagents use a different model from the main one",
          "Dashboard identifies subagent requests (__secondary__) and caches their pricing",
        ],
      },
      {
        version: "v0.7.0",
        date: "2026-08-02",
        items: [
          "Plan-entry pricing fix: zero-price listings bill at the official priced model",
          "-highspeed / -free variants fall back to the base model price",
          "image_in is manually editable; the About page gains the official site and Kimi Eyes plugin links",
        ],
      },
      {
        version: "v0.6.9",
        date: "2026-08-01",
        items: [
          "Recent requests gain a cache-hit-rate column",
          "Chinese UI shows costs in CNY at the latest rate; English keeps USD",
          "Memoized price resolution drops the dashboard scan from seconds to milliseconds",
        ],
      },
      {
        version: "v0.6.8",
        date: "2026-08-01",
        items: [
          "models.dev snapshot moved out of the main bundle so it no longer blocks first paint",
          "Rust price index warmed at startup; get_summary scan cached for 8s",
          "Website refresh: new visual design, zh/en switch, changelog synced from GitHub Releases",
        ],
      },
      {
        version: "v0.6.7",
        date: "2026-08-01",
        items: [
          "Built-in Kimi device-code login, the same flow as kimi login",
          "Credentials written automatically and renewed before the 15-minute expiry",
        ],
      },
      {
        version: "v0.6.6",
        date: "2026-08-01",
        items: ["Model pricing aligned with models.dev, snapshot refreshed per release", "New TokenRhythm provider with a referral link"],
      },
      {
        version: "v0.6.4",
        date: "2026-08-01",
        items: ["Plan billing queries with 5-hour and weekly usage shown on cards", "OpenCode Zen preset gains a referral link"],
      },
      {
        version: "v0.6.2",
        date: "2026-07-30",
        items: [
          "Dashboard rework: daily trend chart for tokens, cache hit rate and requests",
          "Heatmap gets its own full-width row with larger cells",
          "New OpenCode Go / Zen presets",
        ],
      },
      {
        version: "v0.6.0",
        date: "2026-07-29",
        items: ["Provider presets and per-provider billing queries launch", "Multi-platform CI builds for macOS, Linux and Windows"],
      },
    ],
  },
  seo: {
    home: {
      title: "Kimi Switch — LLM provider config, usage and billing in one app",
      description:
        "Kimi Switch / KimiCodeSwitch is a desktop manager for LLM provider configuration. 22 presets write straight into ~/.kimi-code/config.toml; usage and billing read from each vendor's own API. Open source MIT.",
    },
    features: {
      title: "Core features - Kimi Switch",
      description:
        "Kimi Switch features: provider presets and custom config, usage and billing, Kimi device-code login, session manager, model discovery and periodic update checks, plus supported protocols and local storage paths.",
    },
    changelog: {
      title: "Changelog - Kimi Switch",
      description:
        "Kimi Switch changelog: notable changes in every release, including the v0.8.8 per-model thinking effort column and kimi-code 2.3.1 adaptation, synced from GitHub Releases.",
    },
    download: {
      title: "Download - Kimi Switch",
      description:
        `Download Kimi Switch v${VERSION}: Windows NSIS installer, macOS .dmg, Linux .deb / .AppImage / .rpm, via GitHub or a China mirror. Free and open source under MIT.`,
    },
  },
  footer: {
    blurb: "The desktop config manager for Kimi Code: presets, switching, usage, billing and sessions, all local.",
    recommend: "Recommended providers",
    mirror: "China mirror",
    downloads: "Total GitHub downloads: {n}",
    product: "Product",
    resources: "Resources",
    creditBefore: "Dashboard and session management adapted from ",
    creditAfter: " (MIT, © JochenYang)",
    recommendText: {
      Kimi: "Sign up with my invite link and we both win rewards, up to a 1-year membership equivalent",
      "智谱 GLM":
        "Register on BigModel.cn via my invite link and get a 20M token gift pack for the new GLM-5.2 flagship",
      DeepSeek: "",
      OpenCodeGo: "When a friend subscribes, you get $5 and they get $5.",
      MiniMax:
        "MiniMax Token Plan: subscribe to unlock the latest models. Friends get 10% off, inviters get a 10% rebate",
      基元律动: "",
    } as Record<string, string>,
  },
};

const dicts: Record<Lang, Dict> = { zh, en };

const STORAGE_KEY = "kimi-switch-site-lang";

function detect(): Lang {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* storage blocked: fall back to the browser language */
  }
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
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage blocked: the choice still applies for this session */
    }
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
