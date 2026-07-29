import type { AgentSettings } from "../types";

const DEFAULT_SETTINGS: AgentSettings = {
  thinking: {
    enabled: true,
    effort: "medium",
    keep: "all",
  },
  loop_control: {
    max_retries_per_step: 3,
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
  return {
    thinking: {
      ...DEFAULT_SETTINGS.thinking,
      ...getSection<AgentSettings["thinking"]>(rawOther, "thinking"),
    },
    loop_control: {
      ...DEFAULT_SETTINGS.loop_control,
      ...getSection<AgentSettings["loop_control"]>(rawOther, "loop_control"),
    },
    background: {
      ...DEFAULT_SETTINGS.background,
      ...getSection<AgentSettings["background"]>(rawOther, "background"),
    },
    permission: {
      rules:
        getSection<AgentSettings["permission"]>(rawOther, "permission")?.rules ??
        [],
    },
    hooks: getSection<AgentSettings["hooks"]>(rawOther, "hooks") ?? [],
  };
}

export function setAgentSettings(
  rawOther: unknown,
  patch: Partial<AgentSettings>
): unknown {
  const root = { ...asRecord(rawOther) };
  const current = getAgentSettings(rawOther);
  const next: AgentSettings = {
    thinking: { ...current.thinking, ...patch.thinking },
    loop_control: { ...current.loop_control, ...patch.loop_control },
    background: { ...current.background, ...patch.background },
    permission: {
      rules: patch.permission?.rules ?? current.permission?.rules ?? [],
    },
    hooks: patch.hooks ?? current.hooks ?? [],
  };

  if (next.thinking) root.thinking = next.thinking;
  if (next.loop_control) root.loop_control = next.loop_control;
  if (next.background) root.background = next.background;
  if (next.permission?.rules && next.permission.rules.length > 0) {
    root.permission = next.permission;
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
