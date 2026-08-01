// Provider presets: one-click form filling for well-known providers.
// Preset data structure inspired by cc-switch (MIT, © Jason Young)
// https://github.com/farion1231/cc-switch

import type { Model, Provider, ProviderType } from "../types";
import { getModelRef, capabilitiesFromRef } from "../lib/models-dev";
import { getDefaultMaxContextSize } from "../lib/model-defaults";

/** Usage query kinds supported by the Rust usage layer (v1 union). */
export type UsageKind =
  | "balance:deepseek"
  | "balance:siliconflow"
  | "balance:openrouter"
  | "balance:stepfun"
  | "balance:novita"
  | "balance:kimi"
  | "plan:kimi_coding"
  | "plan:zhipu"
  | "plan:minimax";

/** Billing model for a preset. Drives the tab filter in PresetPickerModal. */
export type BillingMode = "subscription" | "pay_as_you_go";

/** Runtime set used to catch TS/Rust enum drift (see dev-assert below). */
export const SUPPORTED_USAGE_KINDS: ReadonlySet<string> = new Set<UsageKind>([
  "balance:deepseek",
  "balance:siliconflow",
  "balance:openrouter",
  "balance:stepfun",
  "balance:novita",
  "balance:kimi",
  "plan:kimi_coding",
  "plan:zhipu",
  "plan:minimax",
]);

export type PresetCategory =
  | "official"
  | "cn_official"
  | "third_party"
  | "aggregator"
  | "custom";

export interface ProviderPreset {
  /** Unique key, also used as the default Provider name, e.g. "deepseek". */
  id: string;
  /** Fallback display name (English). */
  name: string;
  /** i18n key; when present the UI prefers t(nameKey). */
  nameKey?: string;
  /** Official website / console URL. */
  websiteUrl?: string;
  /** Where to create / fetch an API key; shown as a link under the key input. */
  apiKeyUrl?: string;
  /** Category: sorting & badge. */
  category: PresetCategory;
  /** Written directly to provider.provider_type. */
  providerType: ProviderType;
  /** Preset base_url; `null` means no default (e.g. Anthropic). */
  baseUrl: string | null;
  /** Icon key from src/icons/extracted (falls back to initials when absent). */
  icon?: string;
  iconColor?: string;
  /**
   * Pre-filled model mappings. The first entry becomes the default model.
   * `model` holds the real model id; the alias is NOT hand-written here —
   * presetToProviderAndModels() forces `${providerName}/${modelId}` so that
   * handleDuplicateProvider's `alias.slice(name.length)` keeps working.
   */
  models: Array<{
    /** Real model id sent to the provider API. */
    model: string;
    /** Optional display name override; defaults to models.dev derivation. */
    displayName?: string;
    /** Optional context override; defaults to the priority chain below. */
    maxContextSize?: number;
    /** Defaults to ["thinking"]. */
    capabilities?: string[];
  }>;
  /**
   * Billing model — drives the 套餐/按量 tab in PresetPickerModal.
   * - "subscription": coding-plan / token-plan style subscription (quota-based)
   * - "pay_as_you_go": per-token API billing
   */
  billingMode: BillingMode;
  /**
   * Billing/usage query kinds; omitted means "do not query".
   * Persisted to SQLite settings by the Rust side on save, never to
   * config.toml.
   */
  usageKinds?: ReadonlyArray<UsageKind>;
}

export const providerPresets: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    nameKey: "presetNameAnthropic",
    websiteUrl: "https://www.anthropic.com",
    category: "official",
    providerType: "anthropic",
    // No default base_url; Kimi Code automatically targets api.anthropic.com.
    baseUrl: null,
    icon: "anthropic",
    models: [
      { model: "claude-opus-4-5" },
      { model: "claude-sonnet-4-5" },
      { model: "claude-haiku-4-5" },
    ],
    billingMode: "pay_as_you_go",
  },
  {
    id: "kimi-coding",
    name: "Kimi For Coding",
    nameKey: "presetNameKimiCoding",
    websiteUrl: "https://www.kimi.com/code",
    apiKeyUrl: "https://kimi-bot.com/activities/zh-cn/invite/share?scenario=invite&from=share_poster&invitation_code=6UJX7J",
    category: "official",
    providerType: "kimi",
    baseUrl: "https://api.kimi.com/coding/v1",
    icon: "kimi",
    models: [
      // kimi-for-coding is not in the models.dev snapshot; context comes
      // from the regex fallback in model-defaults (262144).
      { model: "kimi-for-coding", displayName: "Kimi For Coding" },
      { model: "kimi-k2.7-code" },
    ],
    billingMode: "subscription",
    usageKinds: ["plan:kimi_coding"],
  },
  {
    id: "moonshot",
    name: "Moonshot AI",
    nameKey: "presetNameMoonshot",
    websiteUrl: "https://platform.moonshot.ai",
    category: "cn_official",
    providerType: "kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    icon: "kimi",
    models: [
      { model: "kimi-k2.7-code" },
      { model: "kimi-k2-thinking-turbo" },
      { model: "kimi-k2.6" },
    ],
    billingMode: "pay_as_you_go",
    // Kimi 开放平台余额：国内站 api.moonshot.cn / 国际站 api.moonshot.ai，
    // Rust detect 按 host 消歧（api.moonshot.ai → USD，api.moonshot.cn → CNY）。
    usageKinds: ["balance:kimi"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    nameKey: "presetNameDeepseek",
    websiteUrl: "https://platform.deepseek.com",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    icon: "deepseek",
    models: [{ model: "deepseek-chat" }, { model: "deepseek-reasoner" }],
    billingMode: "pay_as_you_go",
    usageKinds: ["balance:deepseek"],
  },
  {
    id: "zhipu-api",
    name: "Zhipu GLM (API)",
    nameKey: "presetNameZhipuApi",
    websiteUrl: "https://open.bigmodel.cn",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    icon: "zhipu",
    models: [
      { model: "glm-4.7" },
      { model: "glm-4.6" },
      { model: "glm-4.5-air" },
    ],
    billingMode: "pay_as_you_go",
  },
  {
    id: "zhipu-coding",
    name: "Zhipu GLM Coding Plan",
    nameKey: "presetNameZhipuCoding",
    websiteUrl: "https://open.bigmodel.cn",
    category: "cn_official",
    providerType: "openai",
    // Coding Plan endpoint is separate from the pay-as-you-go PaaS API.
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    icon: "zhipu",
    models: [
      { model: "glm-4.7" },
      { model: "glm-4.6" },
      { model: "glm-4.5-air" },
    ],
    billingMode: "subscription",
    usageKinds: ["plan:zhipu"],
  },
  {
    id: "zai-api",
    name: "z.ai (API)",
    nameKey: "presetNameZaiApi",
    websiteUrl: "https://z.ai",
    category: "third_party",
    providerType: "openai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    icon: "zhipu",
    models: [{ model: "glm-4.7" }, { model: "glm-4.6" }],
    billingMode: "pay_as_you_go",
  },
  {
    id: "zai-coding",
    name: "z.ai Coding Plan",
    nameKey: "presetNameZaiCoding",
    websiteUrl: "https://z.ai",
    category: "third_party",
    providerType: "openai",
    // Coding Plan endpoint (mirror of Zhipu GLM Coding Plan). If the path
    // differs on z.ai, fall back to a known mirror.
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    icon: "zhipu",
    models: [{ model: "glm-4.7" }, { model: "glm-4.6" }],
    billingMode: "subscription",
    usageKinds: ["plan:zhipu"],
  },
  {
    id: "bailian",
    name: "Alibaba Bailian",
    nameKey: "presetNameBailian",
    websiteUrl: "https://bailian.console.aliyun.com",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    icon: "bailian",
    models: [
      { model: "qwen3-max" },
      { model: "qwen3-coder-plus" },
      { model: "qwen3.5-plus" },
    ],
    billingMode: "pay_as_you_go",
  },
  {
    id: "minimax",
    name: "MiniMax",
    nameKey: "presetNameMinimax",
    websiteUrl: "https://platform.minimaxi.com",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://api.minimaxi.com/v1",
    icon: "minimax",
    models: [{ model: "MiniMax-M3" }, { model: "MiniMax-M2.7" }],
    billingMode: "pay_as_you_go",
    usageKinds: ["plan:minimax"],
  },
  {
    id: "minimax-token-plan",
    name: "MiniMax Token Plan",
    nameKey: "presetNameMinimaxTokenPlan",
    websiteUrl: "https://platform.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/subscribe/token-plan?code=GmmZA629b5&source=link",
    category: "cn_official",
    providerType: "openai",
    // Token Plan is sold against the same platform endpoint as the
    // pay-as-you-go API — only the API key differs. The Rust detect
    // routes api.minimaxi.com to plan:minimax, so this preset picks up
    // the same query path; the `subscription` tag helps the user pick
    // the right entry based on which key they hold.
    baseUrl: "https://api.minimaxi.com/v1",
    icon: "minimax",
    models: [{ model: "MiniMax-M3" }, { model: "MiniMax-M2.7" }],
    billingMode: "subscription",
    usageKinds: ["plan:minimax"],
  },
  {
    id: "stepfun",
    name: "StepFun",
    nameKey: "presetNameStepfun",
    websiteUrl: "https://platform.stepfun.com",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://api.stepfun.com/v1",
    icon: "stepfun",
    models: [{ model: "step-3.7-flash" }, { model: "step-3.5-flash" }],
    billingMode: "pay_as_you_go",
    usageKinds: ["balance:stepfun"],
  },
  {
    id: "stepfun-plan",
    name: "StepFun Plan",
    nameKey: "presetNameStepfunPlan",
    websiteUrl: "https://platform.stepfun.com/step-plan",
    apiKeyUrl: "https://platform.stepfun.com/?invite_code=HSIGHTPS",
    category: "cn_official",
    providerType: "openai",
    // Step Plan endpoint — same host, different path prefix than the
    // pay-as-you-go API (/v1). Serves both OpenAI and Anthropic protocols.
    baseUrl: "https://api.stepfun.com/step_plan/v1",
    icon: "stepfun",
    models: [{ model: "step-3.7-flash" }, { model: "step-3.5-flash" }],
    billingMode: "subscription",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    nameKey: "presetNameSiliconflow",
    websiteUrl: "https://siliconflow.cn",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    icon: "siliconflow",
    // The extracted icon has no metadata defaultColor; set it explicitly.
    iconColor: "#6E29F6",
    models: [
      { model: "Qwen/Qwen3-235B-A22B" },
      { model: "moonshotai/Kimi-K2.5" },
      // Not covered by the snapshot; fill context/displayName explicitly.
      {
        model: "deepseek-ai/DeepSeek-V3.2",
        displayName: "DeepSeek V3.2",
        maxContextSize: 163840,
      },
    ],
    usageKinds: ["balance:siliconflow"],
    billingMode: "pay_as_you_go",
  },
  {
    id: "novita",
    name: "Novita AI",
    nameKey: "presetNameNovita",
    websiteUrl: "https://novita.ai",
    category: "third_party",
    providerType: "openai",
    // Note: /v3, not /v1.
    baseUrl: "https://api.novita.ai/v3",
    icon: "novita",
    models: [
      // Not covered by the snapshot; fill context/displayName explicitly.
      {
        model: "deepseek/deepseek-v3.2",
        displayName: "DeepSeek V3.2",
        maxContextSize: 163840,
      },
      { model: "moonshotai/kimi-k2-thinking" },
      { model: "zai-org/glm-4.6" },
    ],
    usageKinds: ["balance:novita"],
    billingMode: "pay_as_you_go",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    nameKey: "presetNameOpenrouter",
    websiteUrl: "https://openrouter.ai",
    category: "aggregator",
    providerType: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    icon: "openrouter",
    models: [
      // OpenRouter uses dotted versions which the snapshot does not index;
      // fill context/displayName explicitly for this one.
      {
        model: "anthropic/claude-opus-4.5",
        displayName: "Claude Opus 4.5",
        maxContextSize: 200000,
      },
      { model: "openai/gpt-5.2" },
      { model: "google/gemini-3-pro-preview" },
    ],
    usageKinds: ["balance:openrouter"],
    billingMode: "pay_as_you_go",
  },
  {
    id: "openai",
    name: "OpenAI",
    nameKey: "presetNameOpenai",
    websiteUrl: "https://platform.openai.com",
    category: "official",
    providerType: "openai",
    baseUrl: "https://api.openai.com/v1",
    icon: "openai",
    models: [
      { model: "gpt-5.2" },
      { model: "gpt-5.1-codex-max" },
      { model: "gpt-5-mini" },
    ],
    billingMode: "pay_as_you_go",
  },
  {
    id: "google-genai",
    name: "Google AI Studio",
    nameKey: "presetNameGoogleGenai",
    websiteUrl: "https://aistudio.google.com",
    category: "official",
    providerType: "google-genai",
    baseUrl: "https://generativelanguage.googleapis.com",
    icon: "google",
    models: [
      { model: "gemini-3-pro-preview" },
      { model: "gemini-3-flash-preview" },
      { model: "gemini-2.5-flash" },
    ],
    billingMode: "pay_as_you_go",
  },
  {
    id: "volcengine",
    name: "Volcengine Ark",
    nameKey: "presetNameVolcengine",
    websiteUrl: "https://www.volcengine.com/product/ark",
    category: "cn_official",
    providerType: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    icon: "huoshan",
    // v1: inference only — plan queries need separate AK/SK (P2).
    models: [
      {
        model: "doubao-seed-1-6-250615",
        displayName: "Doubao Seed 1.6",
      },
      { model: "kimi-k2-250905", displayName: "Kimi K2" },
    ],
    billingMode: "pay_as_you_go",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    nameKey: "presetNameOpencodeGo",
    // Referral link — supports the OpenCode project
    websiteUrl: "https://opencode.ai/go?ref=DFCNADQCEM",
    apiKeyUrl: "https://opencode.ai/go?ref=DFCNADQCEM",
    category: "third_party",
    providerType: "openai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    icon: "opencode",
    models: [
      { model: "grok-4.5", displayName: "Grok 4.5" },
      { model: "glm-5.2", displayName: "GLM-5.2" },
      { model: "glm-5.1", displayName: "GLM-5.1" },
      { model: "kimi-k3", displayName: "Kimi K3" },
      { model: "kimi-k2.7-code", displayName: "Kimi K2.7 Code" },
      { model: "kimi-k2.6", displayName: "Kimi K2.6" },
      { model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
      { model: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
    ],
    billingMode: "subscription",
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    nameKey: "presetNameOpencodeZen",
    websiteUrl: "https://opencode.ai/zen/",
    // Referral program only exists on the /go landing page; the Zen console
    // page itself carries no ref parameter, so point the "get API key" action
    // at the referral link.
    apiKeyUrl: "https://opencode.ai/go?ref=DFCNADQCEM",
    category: "third_party",
    providerType: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    icon: "opencode",
    models: [
      { model: "claude-opus-5", displayName: "Claude Opus 5" },
      { model: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
      { model: "gpt-5.5", displayName: "GPT 5.5" },
      { model: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash" },
      { model: "grok-4.5", displayName: "Grok 4.5" },
      { model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
    ],
    billingMode: "pay_as_you_go",
  },
];

export interface PresetConversionResult {
  provider: Provider;
  models: Model[];
  /** Alias to write into config.default_model ("" when no models). */
  defaultModel: string;
  usageKinds: ReadonlyArray<string> | undefined;
}

/**
 * Convert a preset into concrete Provider + Model entries.
 *
 * - Provider name collisions get a "-2" / "-3" suffix.
 * - Model aliases are forced to `${name}/${modelId}` and deduped one by one
 *   against existing aliases (also with "-2" / "-3" suffixes).
 * - max_context_size priority: preset override → models.dev snapshot →
 *   regex rules → DEFAULT_MAX_CONTEXT_SIZE (the last two are both handled
 *   inside getDefaultMaxContextSize).
 */
export function presetToProviderAndModels(
  preset: ProviderPreset,
  options: {
    existingProviderNames: Set<string>;
    existingModelAliases: Set<string>;
  },
): PresetConversionResult {
  let name = preset.id;
  let n = 2;
  while (options.existingProviderNames.has(name)) {
    name = `${preset.id}-${n}`;
    n++;
  }

  const models: Model[] = preset.models.map((m) => {
    let alias = `${name}/${m.model}`;
    let k = 2;
    while (options.existingModelAliases.has(alias)) {
      alias = `${name}/${m.model}-${k}`;
      k++;
    }

    const ref = getModelRef(m.model);
    const refCaps = ref ? capabilitiesFromRef(ref) : [];
    const maxContextSize =
      m.maxContextSize ?? ref?.context ?? getDefaultMaxContextSize(m.model);

    return {
      alias,
      provider: name,
      model: m.model,
      max_context_size: maxContextSize,
      display_name: m.displayName ?? ref?.name ?? alias,
      capabilities: m.capabilities ?? (refCaps.length > 0 ? refCaps : ["thinking"]),
      supports_1m: maxContextSize >= 1_000_000,
      raw_other: {},
    };
  });

  const provider: Provider = {
    name,
    provider_type: preset.providerType,
    base_url: preset.baseUrl,
    api_key: null,
    env: {},
    note: null,
    official_url: preset.websiteUrl ?? null,
    managed: false,
    enabled: true,
    icon: preset.icon ?? null,
    icon_color: preset.iconColor ?? null,
    usageKinds: preset.usageKinds ? [...preset.usageKinds] : undefined,
    raw_other: {},
  };

  return {
    provider,
    models,
    defaultModel: models[0]?.alias ?? "",
    usageKinds: preset.usageKinds,
  };
}

/**
 * Best-effort reverse lookup: which preset (if any) a Provider was created
 * from. Matches the provider name with any "-2"/"-3" dedup suffix stripped,
 * falling back to an exact official_url match. Used to surface preset-only
 * metadata (apiKeyUrl / referralUrl) in the edit form without persisting
 * extra fields on Provider.
 */
export function findPresetForProvider(provider: Provider): ProviderPreset | undefined {
  const base = provider.name.replace(/-\d+$/, "");
  return (
    providerPresets.find((p) => p.id === base) ??
    providerPresets.find((p) => p.websiteUrl != null && p.websiteUrl === provider.official_url)
  );
}

// Dev-only cross-end drift check: assert that every usage kind referenced by
// any preset is one the Rust `UsageKind` enum knows how to handle. The
// runtime filter in `query_provider_usage` silently drops unknown kinds,
// so without this guard a typo or schema drift would only surface as a
// missing usage footer with no error message. Gated by Vite's DEV flag so
// it costs nothing in production bundles.
if (import.meta.env.DEV) {
  for (const preset of providerPresets) {
    if (!preset.usageKinds) continue;
    for (const kind of preset.usageKinds) {
      if (!SUPPORTED_USAGE_KINDS.has(kind)) {
        // eslint-disable-next-line no-console
        console.error(
          `[providerPresets] preset "${preset.id}" references unknown usage kind "${kind}". ` +
            `Add it to src-tauri/src/services/mod.rs UsageKind + SUPPORTED_USAGE_KINDS, or remove it from the preset.`,
        );
      }
    }
  }
}
