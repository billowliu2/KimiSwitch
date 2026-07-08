# i18n / Agent Switch / UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Chinese/English i18n, replace the target dropdown with a CC Switch-style icon selector, clean up the header/footer layout, fix backend validation so managed providers and half-empty models don’t block saving, and ensure the app only fetches model lists on explicit user action.

**Architecture:** Keep the existing Rust backend commands and `ConfigTarget` abstraction. Front-end state stays in `App.tsx`; UI pieces live in `src/components/`. Validation/sanitization moves into a small Rust helper that normalizes config before validation, so legacy or in-progress configs can be saved without surprising the user.

**Tech Stack:** Tauri v2 (Rust), React + Tailwind CSS, TypeScript, `toml_edit`, `serde_yaml`.

---

### Task 1: Fix backend validation / sanitization

**Files:**
- Modify: `src-tauri/src/validators.rs`
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/tests/validators.rs`

- [ ] **Step 1.1: Treat `managed:*` providers as managed**

In `validators.rs`, add a helper and use it in the credential check:

```rust
fn is_managed_provider(provider: &Provider) -> bool {
    provider.managed || provider.name.starts_with("managed:")
}
```

Replace the credential guard condition:

```rust
if !is_managed_provider(provider) && !matches!(provider.provider_type, ProviderType::Vertexai) {
    // existing ambiguous / missing checks
}
```

- [ ] **Step 1.2: Sanitize config before validation**

In `commands.rs`, add a `sanitize_config(config: &mut Config)` function before `validate_config` is called in `save_config_command`:

```rust
fn sanitize_config(config: &mut Config) {
    // Managed:* providers should carry the managed flag.
    for provider in config.providers.values_mut() {
        if provider.name.starts_with("managed:") {
            provider.managed = true;
        }
    }

    let first_provider = config.providers.keys().next().cloned();
    for model in config.models.values_mut() {
        if model.provider.trim().is_empty() {
            if let Some(name) = &first_provider {
                model.provider = name.clone();
            }
        }
        if model.model.trim().is_empty() {
            model.model = model.alias.clone();
        }
        if model.max_context_size == 0 {
            model.max_context_size = 262_144;
        }
    }
}
```

Call it at the top of `save_config_command`:

```rust
pub fn save_config_command(
    app: tauri::AppHandle,
    target: ConfigTarget,
    mut config: Config,
) -> Result<(), String> {
    sanitize_config(&mut config);
    if let Err(errors) = validate_config(&config) { ... }
    ...
}
```

- [ ] **Step 1.3: Add/update tests**

Add tests in `src-tauri/tests/validators.rs` for:
1. `managed:kimi-code` with empty credentials passes.
2. `glm-5` with empty provider/model/max_context_size is sanitized and then passes.

Run: `cd src-tauri && cargo test`
Expected: all tests pass.

---

### Task 2: Remove implicit model auto-fetch

**Files:**
- Modify: `src/components/ProviderEdit.tsx`

- [ ] **Step 2.1: Delete the auto-fetch `useEffect`**

Remove:

```tsx
const [autoFetched, setAutoFetched] = useState(false);

useEffect(() => {
  if (models.length === 0 && !autoFetched && !discovering) {
    setAutoFetched(true);
    handleDiscover();
  }
}, [models.length, autoFetched, discovering, handleDiscover]);
```

Keep the explicit `获取模型列表` button and the discovered-models panel. Models are now fetched only when the user clicks the button.

---

### Task 3: Redesign header and footer

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/index.css` (if needed for footer)

- [ ] **Step 3.1: Replace target dropdown with icon selector**

In `App.tsx`, replace the `<select>` for `target` with a row of icon buttons:

```tsx
function AgentSelector({ target, onChange }: { target: ConfigTarget; onChange: (t: ConfigTarget) => void }) {
  const { t } = useTranslation();
  const agents: { key: ConfigTarget; label: string; icon: string }[] = [
    { key: "kimi", label: t("targetKimi"), icon: "K" },
    { key: "omp", label: t("targetOmp"), icon: "O" },
  ];
  return (
    <div className="flex items-center gap-1 bg-[#1f1f23] border border-[#2a2a2e] rounded-lg p-1">
      {agents.map((a) => (
        <button
          key={a.key}
          type="button"
          title={a.label}
          onClick={() => onChange(a.key)}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${
            target === a.key
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-[#e5e5e7] hover:bg-[#2a2a2e]"
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs font-bold">
            {a.icon}
          </span>
          {a.label}
        </button>
      ))}
    </div>
  );
}
```

Use `<AgentSelector target={target} onChange={handleSetTarget} />` in the header.

- [ ] **Step 3.2: Move global actions to a footer bar**

Render a footer below `<main>`:

```tsx
<footer className="flex items-center justify-between px-4 py-2 border-t border-[#2a2a2e] bg-[#16161a] text-sm">
  <div className="flex items-center gap-2">
    {dirty && <span className="text-orange-400">● {t("unsavedChanges")}</span>}
  </div>
  <div className="flex items-center gap-2">
    <button ... onClick={save} disabled={!dirty}>{t("saveConfig")}</button>
    <button ... onClick={refresh}>{t("reloadConfig")}</button>
    <button ... onClick={openConfigDir}>{t("openConfigDir")}</button>
  </div>
</footer>
```

Remove the corresponding buttons from the top header.

- [ ] **Step 3.3: Keep language switch in header**

Keep the language `<select>` in the top-right of the header, next to the agent selector.

- [ ] **Step 3.4: Add missing translation keys**

Add `unsavedChanges: "未保存修改"` / `"Unsaved changes"` to both translation files.

---

### Task 4: Improve adaptive / maximize-friendly layout

**Files:**
- Modify: `src/components/ProviderList.tsx`
- Modify: `src/components/ProviderEdit.tsx`

- [ ] **Step 4.1: ProviderList cards adapt to width**

Ensure the list container is `flex-1 overflow-auto` and cards use `w-full`. The right-side action buttons should wrap on narrow widths by adding `flex-wrap` to their container.

- [ ] **Step 4.2: ProviderEdit table scrolls horizontally**

Wrap the model mapping table in a `div` with `overflow-auto`:

```tsx
<div className="overflow-auto">
  <table className="w-full min-w-[640px] text-sm">...</table>
</div>
```

Change the two-column basic-info grid to collapse on small widths by using `grid-cols-1 md:grid-cols-2`.

---

### Task 5: Complete zh/en i18n

**Files:**
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

- [ ] **Step 5.1: Audit for hardcoded strings**

Search `src/components/` and `src/App.tsx` for any literal Chinese or English UI text not using `t()`. Add keys and replace them. Ensure keys added to both `zh.ts` and `en.ts`.

---

### Task 6: Rename / update logo and icons

**Files:**
- Modify: `index.html`
- Create/overwrite: `public/pi.svg`
- Create/overwrite: `src-tauri/icons/32x32.png`, `src-tauri/icons/128x128.png`, `src-tauri/icons/128x128@2x.png`, `src-tauri/icons/icon.ico`

- [ ] **Step 6.1: Generate Pi Switch icons**

Use a Python script (Pillow) to generate PNG/ICO files with a π symbol. Update `index.html` favicon to `/pi.svg`.

- [ ] **Step 6.2: Verify app title**

`tauri.conf.json` already has `"title": "Pi Switch"`. Ensure `index.html` `<title>` is also `Pi Switch`.

---

### Task 7: Build and run

**Files:** N/A

- [ ] **Step 7.1: Run frontend build**

`npm run build`
Expected: no TypeScript or build errors.

- [ ] **Step 7.2: Run Rust tests**

`cd src-tauri && cargo test`
Expected: all tests pass.

- [ ] **Step 7.3: Start dev app**

`npm run tauri-dev`
Expected: app window opens, agent switch works, save/reload/open buttons work, model fetch is manual.

---

### Self-Review

- **Spec coverage:** managed-provider error → Task 1.1; glm-5 empty fields → Task 1.2; manual model fetch → Task 2; CC Switch icon selector → Task 3.1; footer action placement → Task 3.2; adaptive layout → Task 4; i18n → Task 5; logo/title → Task 6.
- **Placeholder scan:** no TBD/TODO/fill-in details; each step has file paths and code.
- **Type consistency:** `ConfigTarget` values remain `"kimi"` / `"omp"`; translation keys match existing `TranslationKey` type.
