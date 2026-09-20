import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Agent } from "../types";
import type { TranslationKey } from "../i18n/zh";
import { localizeUsageError } from "../lib/usage-display";

type TranslateFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>
) => string;

/** 单项检测的三态结论（mirrors Rust `HealthCheck`）。 */
export type HealthCheck = "pass" | "fail" | "neutral";

/** 单项检测结论（探活 / 账单各一份，mirrors Rust `CheckResult`）。 */
export interface CheckResult {
  state: HealthCheck;
  /** 失败 / 中性原因的原始文案；通过为 null。 */
  error?: string | null;
}

/** Mirrors the Rust `HealthResult` (camelCase via serde). */
export interface HealthResult {
  providerName: string;
  /** 总体判定（Rust 侧是唯一事实来源）：pass=绿 / fail=红 / neutral=灰。 */
  verdict: HealthCheck;
  /** verdict === "pass" 的便捷布尔。 */
  ok: boolean;
  /** 失败原因汇总（仅 fail 项，`; ` 分隔）；无失败为 null。 */
  error?: string | null;
  /** 账单/用量结论；null/undefined = 未执行。 */
  usage?: CheckResult | null;
  /** 推理端点探活结论；探活是必做项，恒为 Some。 */
  probe?: CheckResult | null;
  /** 探活耗时（毫秒）。 */
  latencyMs: number;
}

/**
 * 单条 Rust 错误文案 → 本地化文案。未知错误原样透出（HTTP 状态码等诊断
 * 细节）。前缀与 src-tauri/src/services/probe.rs、commands.rs 保持一致。
 */
function localizeHealthPart(error: string, t: TranslateFn): string {
  if (error.startsWith("missing base_url")) return t("healthErrNoBaseUrl");
  if (error.startsWith("no API key configured")) return t("healthErrNoKey");
  if (error.startsWith("Authentication failed")) return t("healthErrAuth");
  if (error.startsWith("endpoint not found")) return t("healthErrNotFound");
  if (error.startsWith("request timed out")) return t("healthErrTimeout");
  if (error.startsWith("connection failed")) return t("healthErrUnreachable");
  if (error.startsWith("response is not valid JSON")) return t("healthErrBadJson");
  // 账单链路的报错复用已有的用量错误映射（禁用 / OAuth 过期 / NewAPI 凭据…）。
  return localizeUsageError(error, t);
}

/**
 * 体检结论里的错误文案本地化。探活与账单两条链路的错误由 Rust 用 `; `
 * 拼进同一个字段，逐段映射后再拼回，保证两段都能翻译。
 */
export function localizeHealthError(error: string, t: TranslateFn): string {
  return error
    .split("; ")
    .map((part) => localizeHealthPart(part, t))
    .join("; ");
}

/** 探活一项的 tooltip 文案。 */
export function probeLine(
  probe: CheckResult,
  latencyMs: number,
  t: TranslateFn
): string {
  if (probe.state === "pass") return t("healthProbeOk", { latency: latencyMs });
  // 中性 = 端点未实现 /v1/models（404），如实说明「不支持」而不是报失败。
  if (probe.state === "neutral") return t("healthProbeUnsupported");
  return t("healthProbeFail", {
    error: probe.error ? localizeHealthError(probe.error, t) : "",
  });
}

/** 账单一项的 tooltip 文案。 */
export function usageLine(usage: CheckResult, t: TranslateFn): string {
  if (usage.state === "pass") return t("healthUsageOk");
  if (usage.state === "fail") {
    return t("healthUsageFail", {
      error: usage.error ? localizeHealthError(usage.error, t) : "",
    });
  }
  // 账单链路不产生中性结论（只有探活 404 会），兜底按「未判定」展示。
  return t("healthNotChecked");
}

/**
 * 状态点颜色：绿=正常、红=失败、灰=未判定（未检测 / 检测中 / 全部中性）。
 * 判定本身由 Rust 的 overall_verdict 给出，这里只做映射。
 */
export function healthDotClass(verdict: HealthCheck): string {
  switch (verdict) {
    case "pass":
      return "bg-green-500";
    case "fail":
      return "bg-red-500";
    default:
      return "bg-gray-400 dark:bg-gray-500";
  }
}

export interface HealthCheckState {
  /** 体检进行中：按钮转圈、尚未出结果的行显示灰色检测中指示。 */
  running: boolean;
  /** 至少跑过一轮（决定是否渲染状态点）。 */
  ran: boolean;
  /** provider name → 结果。 */
  results: Record<string, HealthResult>;
  okCount: number;
  failCount: number;
  /** 整体请求失败（配置读取失败 / 总超时）的文案；null = 无错误。 */
  error: string | null;
  run: () => void;
}

/**
 * 一键体检：invoke `health_check_all`，把结果按 provider 名索引。
 * 结果保留到下次点击或组件卸载（页面刷新），不在后台轮询。
 */
export function useHealthCheck(agent: Agent): HealthCheckState {
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [results, setResults] = useState<Record<string, HealthResult>>({});
  const [error, setError] = useState<string | null>(null);
  // Generation counter: 重跑/卸载后到达的旧响应直接丢弃，不写回状态。
  const genRef = useRef(0);

  useEffect(
    () => () => {
      genRef.current += 1;
    },
    []
  );

  const run = useCallback(async () => {
    const gen = ++genRef.current;
    setRunning(true);
    setError(null);
    // 清空上一轮结果：检测中的行显示灰色转圈，而不是留着旧结论误导。
    setResults({});
    try {
      const list = await invoke<HealthResult[]>("health_check_all", { agent });
      if (genRef.current !== gen) return;
      const map: Record<string, HealthResult> = {};
      for (const r of list) map[r.providerName] = r;
      setResults(map);
    } catch (e) {
      if (genRef.current !== gen) return;
      // invoke 拒绝时 Rust 侧 Err(String) 是字符串，不是 Error 实例。
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
    } finally {
      if (genRef.current === gen) {
        setRunning(false);
        setRan(true);
      }
    }
  }, [agent]);

  const values = Object.values(results);
  return {
    running,
    ran,
    results,
    // 中性（灰）既不算正常也不算失败，不计入汇总。
    okCount: values.filter((r) => r.verdict === "pass").length,
    failCount: values.filter((r) => r.verdict === "fail").length,
    error,
    run: () => void run(),
  };
}
