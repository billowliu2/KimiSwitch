import type {
  AgentSettings,
  DatabaseConfig,
  McpConfig,
  ReadConfig,
  TaskConfig,
  WorkspaceConfig,
} from "../types";

const DEFAULT_SETTINGS: AgentSettings = {
  thinking: {
    enabled: true,
    // No `effort` here on purpose: the global `[thinking] effort` outranks a
    // per-model `[models.*] default_effort` upstream, so a materialized
    // default would shadow the model-level tier. Absent stays absent (see
    // getAgentSettings / setAgentSettings); the UI shows "medium" itself.
    keep: "all",
  },
  loop_control: {
    max_attempts_per_step: 3,
    reserved_context_size: 50000,
  },
  // `[task]` (kimi-code 2.4.0; formerly `[background]`). `keep_alive_on_exit`
  // is the only key we model a default for; every other key stays absent
  // unless the config carries it, so upstream defaults are never pinned.
  task: {
    keep_alive_on_exit: false,
  },
  // `[watch] enabled` — kimi-code 2.0.1 added the key; 2.0.2 flipped the
  // default to off, then #4015 flipped it back on, so an absent key reads
  // as "on".
  watch: {
    enabled: true,
  },
  permission: { rules: [] },
  hooks: [],
  // Top-level key (kimi-code 2.3.0): upstream default false means the survey
  // is ON — this is the UI's "not disabled" default, never a written value.
  disable_feedback_survey: false,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getSection<T>(rawOther: unknown, key: string): T | undefined {
  const root = asRecord(rawOther);
  const section = root[key];
  if (section === undefined || section === null) return undefined;
  return section as T;
}

/**
 * Effective `[task]` config: upstream `resolveAgentTaskConfig` merges the
 * legacy `[background]` section with the current `[task]` section field by
 * field, `[task]` winning, and falls back to whichever one exists. Mirroring
 * the merge here means the panel shows the values the CLI actually applies
 * even when a config only carries the legacy section (or both).
 */
export function resolveTaskSection(rawOther: unknown): TaskConfig | undefined {
  const legacy = getSection<TaskConfig>(rawOther, "background");
  const current = getSection<TaskConfig>(rawOther, "task");
  if (legacy === undefined) return current;
  if (current === undefined) return legacy;
  return { ...legacy, ...current };
}

/** Read one of the optional scalar sections (`[workspace]`, `[database]`,
 *  `[mcp]`, `[read]`). Only keys the config actually carries are returned —
 *  callers compare against the upstream default themselves, so no default is
 *  ever materialized into a patch. */
function readScalarSection<T extends object>(rawOther: unknown, key: string): T | undefined {
  const section = getSection<T>(rawOther, key);
  if (section === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(asRecord(section))) {
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined;
}

/** Write one of the optional scalar sections. Keys the patch does not mention
 *  are carried over verbatim (including ones we do not model), and a key whose
 *  value equals its upstream default is dropped so the config keeps tracking
 *  the default instead of pinning a copy of it. */
function writeScalarSection(
  root: Record<string, unknown>,
  rawOther: unknown,
  sectionKey: string,
  patchSection: object | undefined,
  defaults: Record<string, boolean | number>,
  opts?: { dropNonPositive?: boolean }
): void {
  const next: Record<string, unknown> = {
    ...asRecord(getSection(rawOther, sectionKey)),
  };
  for (const [key, value] of Object.entries(asRecord(patchSection))) {
    // An explicit undefined (cleared number field) removes the key.
    if (
      value === undefined ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  for (const [key, def] of Object.entries(defaults)) {
    if (!(key in next)) continue;
    // Upstream validates these as positive integers: 0 / negative would fail
    // the section schema, so it removes the key like an empty field does.
    if (opts?.dropNonPositive && typeof next[key] === "number" && (next[key] as number) < 1) {
      delete next[key];
      continue;
    }
    if (next[key] === def) delete next[key];
  }
  if (Object.keys(next).length > 0) {
    root[sectionKey] = next;
  } else {
    delete root[sectionKey];
  }
}

export function getAgentSettings(rawOther: unknown): AgentSettings {
  const root = asRecord(rawOther);
  const sectionLoop = getSection<AgentSettings["loop_control"]>(
    rawOther,
    "loop_control"
  );
  const loop: AgentSettings["loop_control"] = {
    ...DEFAULT_SETTINGS.loop_control,
    ...sectionLoop,
  };
  // kimi-code 0.33+ (v2 engine) renamed max_retries_per_step →
  // max_attempts_per_step; migrate legacy values so they still show and edit.
  if (
    sectionLoop &&
    sectionLoop.max_attempts_per_step === undefined &&
    sectionLoop.max_retries_per_step !== undefined
  ) {
    loop.max_attempts_per_step = sectionLoop.max_retries_per_step;
  }
  const sectionThinking = getSection<AgentSettings["thinking"]>(
    rawOther,
    "thinking"
  );
  const thinking = {
    ...DEFAULT_SETTINGS.thinking,
    ...sectionThinking,
  };
  // `effort` is only reported when the config carries a string: the global
  // `[thinking] effort` outranks a per-model `[models.*] default_effort`
  // upstream, so an absent key must not be back-filled with a default that a
  // plain save would then pin and shadow the model-level tier with. The panel
  // shows "medium" on its own when the tier is undefined.
  if (typeof sectionThinking?.effort !== "string") {
    delete thinking.effort;
  }
  // Upstream engines only accept string off values ("off"/"none"/"no"; see
  // KEEP_OFF_VALUES) — a `false` from an old config fails the v2 validator
  // and the v1 strict parse. Normalize every legacy off value to "off" for
  // display; the serialization path (setAgentSettings) writes the string.
  if (thinking.keep !== undefined && thinking.keep !== "all") {
    thinking.keep = "off";
  }
  const sectionPermission = getSection<AgentSettings["permission"]>(
    rawOther,
    "permission"
  );
  // Effective `[task]`: the legacy `[background]` section merged in, with
  // `[task]` keys winning (see resolveTaskSection). The spread keeps unmodeled
  // keys (print_*, future additions) so they survive a save back out.
  const taskSection = resolveTaskSection(rawOther);
  return {
    thinking,
    loop_control: loop,
    task: {
      ...DEFAULT_SETTINGS.task,
      ...taskSection,
    },
    watch: {
      ...DEFAULT_SETTINGS.watch,
      ...getSection<AgentSettings["watch"]>(rawOther, "watch"),
    },
    // Optional scalar sections: only keys the config carries are reported;
    // each UI control falls back to the documented upstream default itself.
    workspace: readScalarSection<WorkspaceConfig>(rawOther, "workspace"),
    database: readScalarSection<DatabaseConfig>(rawOther, "database"),
    mcp: readScalarSection<McpConfig>(rawOther, "mcp"),
    read: readScalarSection<ReadConfig>(rawOther, "read"),
    permission: {
      rules: sectionPermission?.rules ?? [],
      // `dangerous_command_guard` stays undefined unless the config carries
      // an explicit boolean — upstream defaults it to ON (kimi-code 0.40.1),
      // so an absent key means "on". The env var
      // KIMI_CODE_DANGEROUS_COMMAND_GUARD (literal "true"/"false" only)
      // outranks this config value at kimi-code runtime.
      ...(typeof sectionPermission?.dangerous_command_guard === "boolean"
        ? { dangerous_command_guard: sectionPermission.dangerous_command_guard }
        : {}),
    },
    hooks: getSection<AgentSettings["hooks"]>(rawOther, "hooks") ?? [],
    // Top-level booleans (upstream default true): keep only explicit values,
    // an absent key means "on" — the UI shows `?? true`.
    auto_session_title:
      typeof root.auto_session_title === "boolean"
        ? root.auto_session_title
        : undefined,
    repeat_breaker:
      typeof root.repeat_breaker === "boolean"
        ? root.repeat_breaker
        : undefined,
    // Top-level key (kimi-code 2.3.0, moved from tui.toml): upstream default
    // false = survey on, and the session-rating host reads it as
    // `disableFeedbackSurvey === true`, so only a literal true counts.
    disable_feedback_survey: root.disable_feedback_survey === true,
  };
}

export function setAgentSettings(
  rawOther: unknown,
  patch: Partial<AgentSettings>,
  opts?: { legacyV1?: boolean }
): unknown {
  const root = { ...asRecord(rawOther) };
  const current = getAgentSettings(rawOther);
  // Explicit guard value wins over the carried-over one; undefined keeps the
  // key absent (upstream default = on).
  const guard =
    patch.permission?.dangerous_command_guard ??
    current.permission?.dangerous_command_guard;
  const permission: NonNullable<AgentSettings["permission"]> = {
    rules: patch.permission?.rules ?? current.permission?.rules ?? [],
    ...(typeof guard === "boolean" ? { dangerous_command_guard: guard } : {}),
  };
  const next: AgentSettings = {
    thinking: { ...current.thinking, ...patch.thinking },
    loop_control: { ...current.loop_control, ...patch.loop_control },
    task: { ...current.task, ...patch.task },
    watch: { ...current.watch, ...patch.watch },
    workspace: { ...current.workspace, ...patch.workspace },
    database: { ...current.database, ...patch.database },
    mcp: { ...current.mcp, ...patch.mcp },
    read: { ...current.read, ...patch.read },
    permission,
    hooks: patch.hooks ?? current.hooks ?? [],
  };

  // `keep` is only written when the source config explicitly carries it or the
  // patch sets it — an absent key keeps the engine default ("all") instead of
  // being materialized, so a plain save does not add the key.
  const rawThinking = asRecord(getSection(rawOther, "thinking"));
  const patchHasKeep = patch.thinking !== undefined && "keep" in patch.thinking;
  if (!("keep" in rawThinking) && !patchHasKeep) {
    delete next.thinking?.keep;
  }
  // `effort` follows the same rule, and here it matters beyond cosmetics: the
  // global `[thinking] effort` outranks a per-model `[models.*] default_effort`
  // upstream, so materializing "medium" on every save would silently shadow a
  // model-level "high". Written only when the config already carries the key
  // or the patch sets it; otherwise the key stays out and upstream decides.
  const patchHasEffort =
    patch.thinking !== undefined && "effort" in patch.thinking;
  if (!("effort" in rawThinking) && !patchHasEffort) {
    delete next.thinking?.effort;
  }

  // The v2 engine (default) only reads max_attempts_per_step; the legacy v1
  // key is stripped on save unless KIMI_CODE_LEGACY_FLAG=1 (v1 engine compat).
  if (!opts?.legacyV1) {
    delete next.loop_control?.max_retries_per_step;
  }
  // `compaction_max_attempts` (kimi-code 0.43.0+): 0 / undefined means "leave
  // the key out" — the config then falls back to the upstream default (5)
  // instead of pinning a literal 0.
  if (!next.loop_control?.compaction_max_attempts) {
    delete next.loop_control?.compaction_max_attempts;
  }
  if (next.thinking) root.thinking = next.thinking;
  if (next.loop_control) root.loop_control = next.loop_control;
  if (next.watch) root.watch = next.watch;

  // `[task]` (kimi-code 2.4.0; `[background]` is the legacy name upstream
  // still merges in). Always write the legacy section's content into `[task]`
  // — including keys we do not model (print_*, future additions) — and drop
  // `[background]`, so a save migrates the config instead of leaving two
  // copies of the same settings behind.
  const rawLegacyTask = asRecord(getSection(rawOther, "background"));
  const rawTask = asRecord(getSection(rawOther, "task"));
  const writtenTask: Record<string, unknown> = { ...rawLegacyTask, ...rawTask };
  for (const [key, value] of Object.entries(asRecord(patch.task))) {
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) {
      delete writtenTask[key];
    } else {
      writtenTask[key] = value;
    }
  }
  // Key upstream validates as min(1): a cleared field (or 0) removes the key
  // instead of writing a value the config validator would reject.
  for (const key of ["max_running_tasks", "print_wait_ceiling_s", "print_max_turns"]) {
    const value = writtenTask[key];
    if (typeof value === "number" && value < 1) delete writtenTask[key];
  }
  // Upstream defaults: writing them back would pin a value the config
  // otherwise tracks automatically, so a default-equal key is dropped (an
  // explicit one included — same rule as the top-level booleans below).
  // `bash_task_timeout_s` has no single default (600 interactively, 0 in print
  // mode) and 0 is meaningful there, so it is never pruned by value.
  if (writtenTask.keep_alive_on_exit === false) delete writtenTask.keep_alive_on_exit;
  if (writtenTask.bash_auto_background_on_timeout === true) {
    delete writtenTask.bash_auto_background_on_timeout;
  }
  if (writtenTask.kill_grace_period_ms === 5000) delete writtenTask.kill_grace_period_ms;
  if (writtenTask.print_background_mode === "steer") {
    delete writtenTask.print_background_mode;
  }
  if (Object.keys(writtenTask).length > 0) {
    root.task = writtenTask;
  } else {
    delete root.task;
  }
  delete root.background;

  // `[workspace]` (kimi-code 2.5.0): require_trust defaults to true, so only
  // an explicit false is written.
  writeScalarSection(root, rawOther, "workspace", patch.workspace, {
    require_trust: true,
  });
  // `[database]`: global_search defaults to false since 2.5.0 (it used to be
  // on), so only an explicit true is written.
  writeScalarSection(root, rawOther, "database", patch.database, {
    global_search: false,
  });
  // `[mcp]` reconnect backoff (kimi-code 2.4.0, upstream #4283): both keys have
  // non-zero defaults, so an unset field must leave the key out.
  writeScalarSection(
    root,
    rawOther,
    "mcp",
    patch.mcp,
    { reconnect_initial_delay_ms: 5000, reconnect_max_delay_ms: 300000 },
    { dropNonPositive: true }
  );
  // `[read]` (2.4.1 lowered max_chars from 500000 to 100000). Both keys are
  // positive ints upstream; 0 or a cleared field removes the key.
  writeScalarSection(
    root,
    rawOther,
    "read",
    patch.read,
    { max_chars: 100000, default_max_chars: 100000 },
    { dropNonPositive: true }
  );
  // Keep `[permission]` when it carries rules *or* an explicit
  // dangerous_command_guard — dropping the section would silently lose a
  // guard=false write (absent key = upstream default on). An empty rules
  // array is omitted rather than written as `rules = []`.
  const hasRules = !!permission.rules && permission.rules.length > 0;
  const hasGuard = typeof permission.dangerous_command_guard === "boolean";
  if (hasRules || hasGuard) {
    root.permission = {
      ...(hasRules ? { rules: permission.rules } : {}),
      ...(hasGuard
        ? { dangerous_command_guard: permission.dangerous_command_guard }
        : {}),
    };
  } else {
    delete root.permission;
  }
  if (next.hooks && next.hooks.length > 0) {
    root.hooks = next.hooks;
  } else {
    delete root.hooks;
  }

  // Top-level booleans with an upstream default of true: an explicit false
  // is written; true/undefined removes the key so the config tracks the
  // upstream default instead of pinning it.
  for (const key of ["auto_session_title", "repeat_breaker"] as const) {
    const value = patch[key] ?? current[key];
    if (value === false) {
      root[key] = false;
    } else {
      delete root[key];
    }
  }

  // `disable_feedback_survey` runs the other way round: its upstream default
  // is false (survey on) and kimi-code's session-rating host reads it as
  // `get('disableFeedbackSurvey') === true`, so only a checked box is written
  // — unchecking removes the key so the config follows the upstream default
  // rather than pinning a `false` that means the same thing.
  const disableFeedbackSurvey =
    patch.disable_feedback_survey ?? current.disable_feedback_survey;
  if (disableFeedbackSurvey === true) {
    root.disable_feedback_survey = true;
  } else {
    delete root.disable_feedback_survey;
  }

  return root;
}
