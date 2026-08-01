# KimiSwitch 官网（M1：结构骨架 + SEO）

独立 Vite + React + Tailwind 工程，与主 Tauri 应用隔离。

## 开发

```bash
cd website
npm install
npm run dev      # http://localhost:5173/KimiSwitch/
```

## 构建

```bash
npm run build    # tsc + vite build → dist/
npm run preview  # 本地预览生产产物
```

## 部署

GitHub Pages（项目仓库 Pages）：设置 → Pages → Source: `gh-pages` 分支 / root。

Vite `base` 已配置为 `/KimiSwitch/`（仓库子路径），构建产物可直接发布到 `gh-pages` 分支根目录。

```bash
# 推送 dist/ 到 gh-pages 分支（任选方式：gh-pages 包 / git subtree）
npx gh-pages -d dist
```

## 里程碑

- ✅ **M1**（当前）：结构骨架 + SEO（meta、关键词、语义化）
- ⏭ **M2**：截图填充（替换 17 张归档素材占位）
- ⏭ **M3**：打磨动效 + 响应式 + GitHub Pages 部署 + OG 图合成

参考 `docs/WEBSITE-PLAN.md` v4。