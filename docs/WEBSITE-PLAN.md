# KimiSwitch 官网建设规划（Landing Page）v4

> 状态：方案 v4 定稿（待启动实现）。参考对象：[KimiCodeBar 官网](https://xifandev.github.io/KimiCodeBar/)（GitHub Pages 单页营销站）。
> v4 变更：3 项待拍板全部定案（素材用 v0.6.7 / 技术栈 Vite+React+Tailwind / 推荐链接页脚）；素材完整度 ~95%；性能实测数据已写入（WS 93 MB / Private 34 MB）。

## 一、目标与定位

为 KimiSwitch 打造一个**单页营销官网（landing page）**：
- 展示核心卖点：**多 LLM 供应商统一管理 + 一键切换 + 用量/账单监控**（主角，不是单一 Kimi 产品）
- 建立可信度：开源（MIT）、隐私（本地存储）、官方直连
- 提供下载入口：Windows 安装包（GitHub Releases + 私有库 Releases）
- 引流与推广：推荐链接低调放页脚（不喧宾夺主）

## 二、参考拆解：KimiCodeBar 官网结构

| 区块 | 内容 | 可借鉴点 | 是否照搬 |
| --- | --- | --- | --- |
| Hero | 实时用量卡片 + 主标题 + CTA | 产品实拍做主视觉 | 部分（见 3.1） |
| Features | "为 Kimi Code 而生"：轻量菜单栏 | 一句话定位 + 简短特性 | 是 |
| Kimi Login | 一键授权登录 / API Key 切换 | 认证方式展示 | **否**（降级为功能卡） |
| Performance | Swift 原生、内存 30-50MB、任务管理器对比图 | 硬指标 + 对比图 | 是（指标需实测） |
| Auto Update | 自动探测更新、一键安装 | 功能卖点 | 是 |
| Showcase | 明暗双主题截图 | 真实截图轮播 | 是 |
| Privacy | 本地存储 / 官方直连 / 开源可审计 | 三卡片信任区 | 是 |
| Platforms | macOS 已发布 / Windows 开发中 | 平台状态 | 是（镜像反转） |
| 尾屏 CTA | 强行动号召 + 下载按钮 | 是 | 是 |

风格特征：深色主题、大字号排版、真实截图/动图、数据指标卡片、滚动锚点导航。

## 三、KimiSwitch 官网结构规划（修订版）

### 3.1 Hero
- 主标题：**"一个应用，管理你所有的 AI 供应商"**（主）+ 副标题"一键切换 · 用量监控 · 账单一目了然"
- 主视觉：**主界面供应商列表 + 切换**截图（核心差异点，非用量卡片——用量卡是 KimiCodeBar 的产品本体，不是我们的）
- CTA：下载 Windows 版（主）+ 查看 GitHub 源码（次）

### 3.2 功能区块（6 卡，一屏一组）
1. **多供应商管理**：Kimi / 智谱 / MiniMax / DeepSeek / OpenRouter / 基元律动等预设，一键添加与切换
2. **用量与账单监控**：套餐类（5 小时 / 每周用量）+ 按量余额（models.dev 真实价格计算成本）卡片直显
3. **Kimi 一键授权登录**：内置设备码授权（等同 `kimi login`），浏览器授权即用、自动续期 ← **Kimi 相关只此一张卡**
4. **配置用量查询**：全屏配置页、NewAPI 模板、超时/自动刷新、测试查询
5. **智能模型发现**：模型能力 / 上下文自动同步 models.dev
6. **自动更新**：检查更新（私有库优先、GitHub 回退），一键下载安装

### 3.3 认证方式区块
- **删除**独立大区块。Kimi 授权并入 3.2 功能卡 3；API Key 方式在主界面截图里自然体现（普通供应商编辑 API Key 输入框）

### 3.4 性能 / 技术区块
- Tauri + Rust 内核 + WebView2；常驻托盘
- 实测（28 核 Windows，用户运行 v0.6.7）：
  - **Working Set 93 MB / Private WS 34 MB**（程序空闲态）
  - 52 线程 / 1086 句柄；CPU 空闲 0%，查询时短暂升高
  - 对比 KimiCodeBar（Swift）自报 38 MB —— Tauri 因 WebView2 内核偏重是事实，**不作"碾压"话术**
- 配任务管理器对比图（M2 实测打安装包时补）

### 3.5 更新区块
- 检查更新：私有库优先 → GitHub 回退；一键下载 / 安装（截图展示设置面板更新区）

### 3.6 隐私与信任区块（三卡片）
- 本地存储：配置与用量仅存本机（`~/.kimi-switch` / config.toml）
- 官方直连：账单查询直连各厂商官方 API
- 开源可审计：MIT 全量开源（GitHub）

### 3.7 平台与下载
- **Windows：已发布**（.msi / .exe）——主推平台
- macOS / Linux：规划中（GitHub Actions 已能构建，但未正式适配/发布，如实标注"开发中"）
- 下载入口：GitHub Releases 为主 + **私有库 Releases 链接**（国内下载快）

### 3.8 尾屏 CTA
- **"现在就把所有供应商，放进一个应用"** + 下载按钮 + 当前版本号（构建时注入）

## 四、视觉与交互方向

- 深色为主（对齐 app）、大字号对比排版、圆角卡片、品牌蓝紫渐变（`#3b82f6 → #8b5cf6`）
- 素材：真实截图 + 动图，避免插画风
- 动效：滚动渐入、数字滚动、截图 hover 缩放，克制
- 响应式：桌面优先，移动端可看结构与下载按钮

## 五、技术选型与部署（已收敛）

| 项 | 方案 | 说明 |
| --- | --- | --- |
| 技术栈 | **Vite + React + Tailwind**（与主应用技能栈一致） | 定案；后续扩展英文版/多页顺 |
| 构建 | 独立工程 `website/` 子目录，`vite build` 产物纯静态 | 与 tauri 构建隔离 |
| 部署 | **仅 GitHub Pages**（`gh-pages` 分支或独立 repo） | 私有库 Pages **确认未启用**，不做镜像 |
| 域名 | `https://billowliu2.github.io/KimiSwitch/`（默认） | 自定义域名待定 |
| CI | GitHub Actions：website 变更自动构建 → 部署 gh-pages | 独立 workflow |
| 下载链接 | 构建时注入**版本号常量**（v0.6.x），链接指向 GitHub + 私有库 Releases | 发版时改一个常量，不做脚本自动化 |
| SEO | meta description / OG 分享图 / favicon（用 `public/kimi.svg`） | 补进 M1 |

## 六、素材清单（已就位 ✅）

- [x] app 主界面截图 ×5：供应商列表(hero)、编辑基本信息、模型映射、Kimi OAuth 对话框、Kimi OAuth 授权成功页
- [x] 用量仪表盘截图 ×4：浅色/深色/完整版/每日详情
- [x] 会话管理截图 ×2：浅色/深色
- [x] 编辑器截图 ×3：基本信息、模型映射、配置 JSON
- [x] 设置弹窗截图 ×1（更新区+超链接+关于）
- [x] 配置用量查询截图 ×1（OAuth 托管模板/变量/超时/测试结果）
- [x] 选择预设供应商截图 ×1（22 个预设卡片）
- [x] 套餐用量卡片特写 ×1（5h/7天）
- [x] kimi CLI 模型选择 TUI ×1（辅助素材）
- [x] 性能实测指标：WS 93 MB / Private 34 MB / 52 threads / 1086 handles
- [ ] 任务管理器对比图（M2 阶段补：打安装包后跑 5-10 分钟采样，含对比标注）
- [ ] OG 分享图（M1 阶段用 hero.png 合成 1200×630）
- [ ] 版本号与下载链接注入（构建常量）

## 七、里程碑（绑定稳定版）

1. **M0 前提**：app 进入稳定版（**建议 v0.7.0 发布后**）——截图/动图才不过时
2. **M1 结构骨架**：布局 + 导航 + 区块占位 + SEO/meta（1 天）
3. **M2 内容填充**：文案定稿 + 截图/动图就位（1-2 天）
4. **M3 打磨上线**：动效、响应式、GitHub Pages 部署、下载链接注入（1 天）
5. **M4 持续维护**：发版时更新版本号/截图（随 Release 流程）

## 八、不做的事（当前阶段）

- 不做多语言（先中文，英文版按需）
- 不做博客 / 文档站（README / docs 已有）
- 不做在线购买 / 支付（免费开源）
- 不采集统计埋点（与隐私定位一致）
- **不做私有库 Pages 镜像**（服务器未启用该功能）

## 九、已定案（原 3 项待拍板）

1. **素材时机** ✅ **用当前 v0.6.7**（用户确认，不等 v0.7.0）
2. **技术栈** ✅ **Vite + React + Tailwind**（与主应用技能栈一致）
3. **推荐链接** ✅ **页脚放 6 个供应商官网**（KimiSwitch 已全部内置）：

   | # | 供应商 | 推荐文案 | 链接 |
   |---|---|---|---|
   | 1 | **Kimi** | 完成 Kimi 注册，你我都能 100% 拿奖，最高可得 1 年会员等值权益 | https://kimi-bot.com/activities/zh-cn/invite/share?scenario=invite&from=share_poster&invitation_code=6UJX7J |
   | 2 | **智谱 GLM** | 我正在智谱大模型开放平台 BigModel.cn 上打造 AI 应用，智谱新一代旗舰模型 GLM-5.2 已上线，在推理、代码、智能体综合能力达到开源模型 SOTA 水平，通过我的邀请链接注册即可获得 2000 万 Tokens 大礼包，期待和你一起在 BigModel 上畅享卓越模型能力 | https://www.bigmodel.cn/invite?icode=mQwTVj1MeLnqI2wa7Ivg7unfet45IvM%2BqDogImfeLyI%3D |
   | 3 | **DeepSeek** | （无推荐链接，官方平台） | https://platform.deepseek.com |
   | 4 | **OpenCodeGo** | （无特定文案，官方推荐链接） | https://opencode.ai/go?ref=DFCNADQCEM |
   | 5 | **MiniMax** | 🚀 MiniMax Token Plan 订阅一份套餐，解锁最新模型 — 前沿 Coding 能力、1M 超长上下文、原生多模态，图文音视频共用套餐额度。🎁 邀友双赢福利 好友订阅享 9 折 + Builder 权益，邀请人得 10% 返利 + 社区特权！立即订阅 | https://platform.minimaxi.com/subscribe/token-plan?code=GmmZA629b5&source=link |
   | 6 | **基元律动** | （无特定文案，新供应商推荐链接） | https://tokenrhythm.studio/i/rf_tr_v0QXuBTzyl3-bJOS2uFFPg6x |

> 方案 v4 定稿，可启动 M1（结构骨架 + SEO）。
