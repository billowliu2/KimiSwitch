export const DEFAULT_MAX_CONTEXT_SIZE = 256000;

interface ModelContextRule {
  pattern: RegExp;
  max_context_size: number;
}

const MODEL_CONTEXT_RULES: ModelContextRule[] = [
  // Kimi
  { pattern: /^kimi-for-coding$/i, max_context_size: 262144 },
  { pattern: /^kimi-k2\.5/i, max_context_size: 256000 },
  { pattern: /^kimi-k2/i, max_context_size: 256000 },
  { pattern: /^kimi-/i, max_context_size: 256000 },
  // GLM
  { pattern: /^glm-5\.2/i, max_context_size: 1000000 },
  { pattern: /^glm-5\.1/i, max_context_size: 256000 },
  { pattern: /^glm-5/i, max_context_size: 256000 },
  { pattern: /^glm-4/i, max_context_size: 128000 },
  { pattern: /^glm-/i, max_context_size: 128000 },
  // MiniMax
  { pattern: /^MiniMax-M3/i, max_context_size: 1000000 },
  { pattern: /^MiniMax-Text-01/i, max_context_size: 400000 },
  { pattern: /^MiniMax-/i, max_context_size: 256000 },
  // Qwen
  { pattern: /^qwen2\.5/i, max_context_size: 128000 },
  { pattern: /^qwen-max/i, max_context_size: 128000 },
  { pattern: /^qwen-plus/i, max_context_size: 128000 },
  { pattern: /^qwen-turbo/i, max_context_size: 128000 },
  { pattern: /^qwen-coder/i, max_context_size: 128000 },
  { pattern: /^qwen-/i, max_context_size: 128000 },
  // DeepSeek
  { pattern: /^deepseek-r1/i, max_context_size: 64000 },
  { pattern: /^deepseek-v3/i, max_context_size: 64000 },
  { pattern: /^deepseek-coder/i, max_context_size: 64000 },
  { pattern: /^deepseek-/i, max_context_size: 64000 },
  // Hunyuan
  { pattern: /^hunyuan-pro/i, max_context_size: 32000 },
  { pattern: /^hunyuan-standard/i, max_context_size: 32000 },
  { pattern: /^hunyuan-lite/i, max_context_size: 32000 },
  { pattern: /^hunyuan-/i, max_context_size: 32000 },
  // Doubao
  { pattern: /^doubao-pro/i, max_context_size: 128000 },
  { pattern: /^doubao-lite/i, max_context_size: 128000 },
  { pattern: /^doubao-vision/i, max_context_size: 128000 },
  { pattern: /^doubao-/i, max_context_size: 128000 },
  // ERNIE
  { pattern: /^ernie-4\.0/i, max_context_size: 128000 },
  { pattern: /^ernie-3\.5/i, max_context_size: 128000 },
  { pattern: /^ernie-speed/i, max_context_size: 128000 },
  { pattern: /^ernie-lite/i, max_context_size: 128000 },
  { pattern: /^ernie-/i, max_context_size: 128000 },
  // Spark
  { pattern: /^spark-v4/i, max_context_size: 32000 },
  { pattern: /^spark-v3\.5/i, max_context_size: 32000 },
  { pattern: /^spark-pro/i, max_context_size: 32000 },
  { pattern: /^spark-max/i, max_context_size: 32000 },
  { pattern: /^spark-/i, max_context_size: 32000 },
  // SenseChat
  { pattern: /^sensechat-/i, max_context_size: 128000 },
  // Baichuan
  { pattern: /^baichuan-4/i, max_context_size: 128000 },
  { pattern: /^baichuan-3/i, max_context_size: 128000 },
  { pattern: /^baichuan-/i, max_context_size: 128000 },
  // Yi
  { pattern: /^yi-/i, max_context_size: 128000 },
  // Claude
  { pattern: /^claude-opus/i, max_context_size: 200000 },
  { pattern: /^claude-sonnet/i, max_context_size: 200000 },
  { pattern: /^claude-haiku/i, max_context_size: 200000 },
  { pattern: /^claude-/i, max_context_size: 200000 },
  // OpenAI
  { pattern: /^gpt-4\.1/i, max_context_size: 1047576 },
  { pattern: /^gpt-4o/i, max_context_size: 128000 },
  { pattern: /^gpt-4-turbo/i, max_context_size: 128000 },
  { pattern: /^gpt-4-/i, max_context_size: 128000 },
  // Gemini
  { pattern: /^gemini-2\.0-flash/i, max_context_size: 1048576 },
  { pattern: /^gemini-1\.5-pro/i, max_context_size: 2097152 },
  { pattern: /^gemini-1\.5-flash/i, max_context_size: 1048576 },
  { pattern: /^gemini-/i, max_context_size: 1048576 },
];

export function getDefaultMaxContextSize(modelId: string): number {
  for (const rule of MODEL_CONTEXT_RULES) {
    if (rule.pattern.test(modelId)) {
      return rule.max_context_size;
    }
  }
  return DEFAULT_MAX_CONTEXT_SIZE;
}
