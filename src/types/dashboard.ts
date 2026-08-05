// Dashboard types — match the Rust structs in src-tauri/src/dashboard.rs (camelCase serde)

export interface TotalsRow {
  requests: number;
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  costUsd: number;
  totalTokens: number;
  cacheHitRate: number;
}

export interface DailyRow extends TotalsRow {
  date: string;
  byModel: Record<string, number>;
  byProvider: Record<string, number>;
  byProviderModel: Record<string, Record<string, number>>;
}

export interface ModelRow extends TotalsRow {
  model: string;
  modelDisplay: string;
  modelResolved: string;
  priceId: string;
  costEstimated: boolean;
  /** True when any record in this row came from a subagent (secondary-model) request. */
  isSecondary: boolean;
}

export interface RecentRow {
  time: number;
  model: string;
  modelDisplay: string;
  modelResolved: string;
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  totalTokens: number;
  costUsd: number;
  costEstimated: boolean;
  priceId: string;
  fromEnv: boolean;
  /** True when this request came from a subagent (secondary-model) call. */
  isSecondary: boolean;
}

export interface RangeStats {
  range: string;
  totals: TotalsRow;
  daily: DailyRow[];
  models: ModelRow[];
  recent: RecentRow[];
  recentTotal: number;
  recentLimit: number;
}

export interface HeatmapCell {
  date: string;
  dow: number;
  weekIndex: number;
  requests: number;
  totalTokens: number;
  costUsd: number;
  cacheHitRate: number;
  level: number;
}

export interface MonthLabel {
  weekIndex: number;
  label: string;
}

export interface HeatmapData {
  weeks: number;
  start: string;
  end: string;
  maxTokens: number;
  cells: HeatmapCell[];
  monthLabels: MonthLabel[];
}

export interface ScanMeta {
  filesScanned: number;
  linesSeen: number;
  recordCount: number;
  home: string;
  sessionsRoot: string;
  errors: string[];
}

export interface AllModelRow {
  model: string;
  modelDisplay: string;
  requests: number;
  totalTokens: number;
  costUsd: number;
  costEstimated: boolean;
  cacheHitRate: number;
}

export interface SummaryResult {
  home: string;
  valid: boolean;
  scannedAt: number;
  meta: ScanMeta;
  range: string;
  stats: RangeStats;
  heatmap: HeatmapData;
  allModels: AllModelRow[];
  allModelCount: number;
  rangeTotals: Record<string, TotalsRow>;
}
