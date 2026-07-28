/**
 * Inline brand SVG icons for provider display.
 * Each SVG uses fill="currentColor" so it adapts to the parent's color style.
 * viewBox is 0 0 24 24 for all icons.
 *
 * Icons are simplified brand marks — not pixel-perfect logos, but recognizable
 * at small sizes (36-48px). All paths are hand-crafted or traced from public
 * brand assets.
 */

export interface BrandIcon {
  /** Self-contained <svg> string with fill="currentColor" */
  svg: string;
  /** Brand accent color (hex) used for the background tint */
  color: string;
  /** Keywords used to infer this icon from a provider name */
  keywords: string[];
}

export const BRAND_ICONS: Record<string, BrandIcon> = {
  kimi: {
    svg: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 4v16M4 4l8 8M4 4l8 8v8M14 4h6v16h-6z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="18" cy="7" r="2" fill="currentColor"/></svg>`,
    color: "#3b82f6",
    keywords: ["kimi", "moonshot"],
  },
  anthropic: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.7 5h-3.4L5.5 19h3.1l.9-2.6h5l.9 2.6h3.1L13.7 5zm-3.4 9l1.7-5 1.7 5h-3.4z"/><path d="M19 5h-1.5L22 19h1.5L19 5z" opacity="0.5"/></svg>`,
    color: "#D4915D",
    keywords: ["claude", "anthropic"],
  },
  openai: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.82a5.96 5.96 0 0 0-.51-4.91 6.04 6.04 0 0 0-6.5-2.9A6.06 6.06 0 0 0 4.99 4.07a5.96 5.96 0 0 0-3.99 2.9 6.04 6.04 0 0 0 .74 7.08 5.96 5.96 0 0 0 .51 4.91 6.04 6.04 0 0 0 6.5 2.9 5.96 5.96 0 0 0 4.5 1.99 6.04 6.04 0 0 0 5.77-4.07 5.96 5.96 0 0 0 3.99-2.9 6.04 6.04 0 0 0-.74-7.08zM13.26 20.5a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76c.24-.14.39-.4.39-.68V9.32l2.02 1.17v4.43a4.5 4.5 0 0 1-4.45 4.58zm-9.57-4.09a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76c.24.14.54.14.78 0l5.83-3.37v2.33l-3.85 2.22a4.5 4.5 0 0 1-6.15-1.01zM2.3 8.59a4.47 4.47 0 0 1 2.35-1.98v5.7c0 .28.15.54.39.68l5.79 3.35-2.02 1.17-3.84-2.22A4.5 4.5 0 0 1 2.3 8.6zm14.83 3.45l-5.83-3.37 2.02-1.17 3.84 2.22a4.5 4.5 0 0 1-.68 8.13v-5.7a.79.79 0 0 0-.4-.68zm2.02-3.05l-.14-.09L16.23 6.2a.79.79 0 0 0-.78 0l-5.83 3.37V7.24l3.85-2.22a4.5 4.5 0 0 1 6.68 4.66zM8.4 13.27l-2.02-1.17V7.67a4.5 4.5 0 0 1 7.38-3.46l-.14.08L8.84 7.05a.79.79 0 0 0-.39.68l-.05 5.54zm1.1-2.37L12 9.5l2.5 1.4v2.8L12 15.1l-2.5-1.4z"/></svg>`,
    color: "#10a37f",
    keywords: ["openai", "gpt", "codex", "chatgpt"],
  },
  gemini: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2z"/><path d="M19 17L19.5 19.5L22 20L19.5 20.5L19 23L18.5 20.5L16 20L18.5 19.5L19 17z" opacity="0.6"/></svg>`,
    color: "#4285f4",
    keywords: ["gemini", "google", "genai", "vertex", "generativelanguage", "bard"],
  },
  deepseek: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8 2 5 5 5 9c0 2 1 4 2.5 5L5 22h14l-2.5-8C18 13 19 11 19 9c0-4-3-7-7-7zm0 3c2.2 0 4 1.8 4 4 0 1.5-.8 2.8-2 3.5l-.5.3.2.5L15 19H9l1.3-4.7.2-.5-.5-.3C9 12.8 8 11.5 8 10c0-2.2 1.8-4 4-4z"/></svg>`,
    color: "#1E88E5",
    keywords: ["deepseek", "deep seek", "deep-seek"],
  },
  qwen: {
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 8l4 4M12 8l-4 4M16 8l-4 4M12 8l4 4M10 16h4"/></svg>`,
    color: "#615ced",
    keywords: ["qwen", "tongyi", "dashscope", "bailian", "alibaba", "aliyun"],
  },
  glm: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4zm0 4l4 2v4c0 3-1.5 5-4 6-2.5-1-4-3-4-6V8l4-2z"/></svg>`,
    color: "#0F62FE",
    keywords: ["glm", "zhipu", "chatglm", "bigmodel"],
  },
  grok: {
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l16 16M20 4L4 20M9 12l6 0M12 9l0 6"/></svg>`,
    color: "#9ca3af",
    keywords: ["grok", "xai", "x-ai", "x.ai"],
  },
  copilot: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4c-2.8 0-5 2.2-5 5v.5C2.8 10.4 2 11.9 2 13.6c0 2.7 1.9 5 4.5 5.5.7 1.7 2.4 2.9 4.3 2.9h2.4c1.9 0 3.6-1.2 4.3-2.9 2.6-.5 4.5-2.8 4.5-5.5 0-1.7-.8-3.2-2-4.1V9c0-2.8-2.2-5-5-5-.8 0-1.5.2-2.2.5C12.3 4 11.7 4 11 4H9zm0 2h2c1.7 0 3 1.3 3 3v2.5l1-.7c.9-.6 2-.8 3-.8 1.7 0 3 1.3 3 3 0 1.4-1 2.6-2.3 2.9l-.7.2-.2.7c-.3 1.1-1.3 1.9-2.4 1.9h-2.4c-1.1 0-2.1-.8-2.4-1.9l-.2-.7-.7-.2C9 15.9 8 14.7 8 13.3c0-1.4.9-2.6 2.2-2.9l1.5-.4V9c0-1.7-1.3-3-3-3z"/></svg>`,
    color: "#8b5cf6",
    keywords: ["copilot", "github"],
  },
  openrouter: {
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 12h2M11 12h2M15 12h2"/><path d="M7 8V5M17 8V5M7 19v-3M17 19v-3"/></svg>`,
    color: "#6366f1",
    keywords: ["openrouter"],
  },
  mistral: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="3" height="16" rx="0.5"/><rect x="7" y="4" width="3" height="16" rx="0.5" opacity="0.7"/><rect x="11" y="4" width="3" height="16" rx="0.5"/><rect x="15" y="4" width="3" height="16" rx="0.5" opacity="0.7"/><rect x="19" y="4" width="2" height="16" rx="0.5"/></svg>`,
    color: "#ff7000",
    keywords: ["mistral"],
  },
  moonshot: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    color: "#1783FF",
    keywords: ["moonshot"],
  },
  baidu: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="10" r="4"/><path d="M8 14c-2 0-3 1.5-3 3.5S6 21 8 21s3-1.5 3-3.5S10 14 8 14z"/><path d="M16 14c-2 0-3 1.5-3 3.5S14 21 16 21s3-1.5 3-3.5S18 14 16 14z"/><path d="M12 14c-2 0-3 1.5-3 3.5S10 21 12 21s3-1.5 3-3.5S14 14 12 14z"/></svg>`,
    color: "#2932E1",
    keywords: ["baidu", "ernie", "wenxin"],
  },
  tencent: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zM4 11h10v2H4zM4 16h14v2H4z" opacity="0.6"/><circle cx="18" cy="12" r="3"/></svg>`,
    color: "#00A4FF",
    keywords: ["tencent", "hunyuan"],
  },
  minimax: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="9" height="9" rx="2"/><rect x="11" y="11" width="9" height="9" rx="2" opacity="0.7"/></svg>`,
    color: "#FF6B6B",
    keywords: ["minimax"],
  },
  cohere: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="6" width="16" height="3" rx="1.5"/><rect x="4" y="11" width="12" height="3" rx="1.5" opacity="0.7"/><rect x="4" y="16" width="8" height="3" rx="1.5" opacity="0.5"/></svg>`,
    color: "#39594D",
    keywords: ["cohere"],
  },
  perplexity: {
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/><path d="M11 8v6"/></svg>`,
    color: "#20808D",
    keywords: ["perplexity"],
  },
  huggingface: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.5" fill="#fff"/><circle cx="15.5" cy="10" r="1.5" fill="#fff"/><path d="M8 14c1.5 2 6.5 2 8 0" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`,
    color: "#FFD21E",
    keywords: ["huggingface", "hf"],
  },
  novita: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2z"/></svg>`,
    color: "#000000",
    keywords: ["novita"],
  },
  meta: {
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12c0-4 3-7 7-7s7 3 7 7-3 7-7 7"/><path d="M5 12c0 4 3 7 7 7"/></svg>`,
    color: "#0081FB",
    keywords: ["meta", "llama", "facebook"],
  },
  azure: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 19l8-14 2 5H8l8 8H4z"/><path d="M13 19l7-4-4-2-3 6z" opacity="0.6"/></svg>`,
    color: "#0078D4",
    keywords: ["azure", "microsoft"],
  },
  aws: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 15c2 1 4 1.5 6 1.5s4-.5 6-1.5v2c-2 1-4 1.5-6 1.5s-4-.5-6-1.5v-2z"/><path d="M6 11c2 1 4 1.5 6 1.5s4-.5 6-1.5v2c-2 1-4 1.5-6 1.5s-4-.5-6-1.5v-2z"/><path d="M6 7c2 1 4 1.5 6 1.5s4-.5 6-1.5v2c-2 1-4 1.5-6 1.5s-4-.5-6-1.5V7z"/></svg>`,
    color: "#FF9900",
    keywords: ["aws", "amazon", "bedrock"],
  },
  doubao: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="none" stroke="#fff" stroke-width="2"/></svg>`,
    color: "#3370FF",
    keywords: ["doubao", "volcengine", "byteplus", "huoshan", "ark"],
  },
  stepfun: {
    svg: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18h4v-4H8V10h4V8h4v4h4v4h-4v4H8v-2H4z"/></svg>`,
    color: "#005AFF",
    keywords: ["stepfun", "step", "jieyue"],
  },
  xai: {
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l14 14M19 5L5 19"/></svg>`,
    color: "#111827",
    keywords: ["xai", "x-ai", "x.ai"],
  },
};
