import type { AgentSettings } from "../types";

const DEFAULT_SETTINGS: AgentSettings = {
  thinking: {
    enabled: true,
    effort: "medium",
    keep: "all",
  },
  loop_control: {
    max_attempts_per_step: 3,
    reserved_context_size: 50000,
  },
  background: {
    keep_alive_on_exit: false,
  },
  permission: { rules: [] },
  hooks: [],
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

export function getAgentSettings(rawOther: unknown): AgentSettings {
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
  const thinking = {
    ...DEFAULT_SETTINGS.thinking,
    ...getSection<AgentSettings["thinking"]>(rawOther, "thinking"),
  };
  // Upstream engines only accept string off values ("off"/"none"/"no"; see
  // KEEP_OFF_VALUES) — a `false` from an old config fails the v2 validator
  // and the v1 strict parse. Normalize every legacy off value to "off" for
  // display; the serialization path (setAgentSettings) writes the string.
  if (thinking.keep !== undefined && thinking.keep !== "all") {
    thinking.keep = "off";
  }
  // The "max" effort tier was removed upstream (auto-migrates to "high");
  // old configs still carrying it are shown as "high" (not rewritten on read).
  if (thinking.effort === "max") {
    thinking.effort = "high";
  }
  const sectionPermission = getSection<AgentSettings["permission"]>(
    rawOther,
    "permission"
  );
  return {
    thinking,
    loop_control: loop,
    background: {
      ...DEFAULT_SETTINGS.background,
      ...getSection<AgentSettings["background"]>(rawOther, "background"),
    },
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
    background: { ...current.background, ...patch.background },
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

  // The v2 engine (default) only reads max_attempts_per_step; the legacy v1
  // key is stripped on save unless KIMI_CODE_LEGACY_FLAG=1 (v1 engine compat).
  if (!opts?.legacyV1) {
    delete next.loop_control?.max_retries_per_step;
  }
  if (next.thinking) root.thinking = next.thinking;
  if (next.loop_control) root.loop_control = next.loop_control;
  if (next.background) root.background = next.background;
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

  return root;
}
