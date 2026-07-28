export interface IconMetadata {
  /** 图标名称（小写，如 "openai"） */
  name: string;
  /** 显示名称（如 "OpenAI"） */
  displayName: string;
  /** 分类（如 "ai-provider", "cloud", "tool"） */
  category: string;
  /** 搜索关键词 */
  keywords: string[];
  /** 默认颜色 */
  defaultColor?: string;
}

export interface IconPreset {
  [key: string]: IconMetadata;
}
