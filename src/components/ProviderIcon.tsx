import { useMemo } from "react";
import { inferIcon } from "../icons/inference";
import { getIcon, getIconUrl, hasIcon, isUrlIcon } from "../icons/extracted";
import { getIconMetadata } from "../icons/extracted/metadata";

interface ProviderIconProps {
  name: string;
  icon?: string | null;
  color?: string | null;
  size?: number;
}

/**
 * Provider icon renderer:
 *   1. Explicit icon prop (extracted icons)
 *   2. Name-based keyword inference (simplified brand icons)
 *   3. Initials fallback on a muted background
 *
 * The same provider name/icon always yields the same result.
 */
export function ProviderIcon({ name, icon, color, size = 44 }: ProviderIconProps) {
  const explicitIcon = icon?.trim() || undefined;

  const explicitSvg = useMemo(() => {
    if (explicitIcon && !isUrlIcon(explicitIcon) && hasIcon(explicitIcon)) {
      return getIcon(explicitIcon);
    }
    return "";
  }, [explicitIcon]);

  const explicitUrl = useMemo(() => {
    if (explicitIcon && isUrlIcon(explicitIcon)) {
      return getIconUrl(explicitIcon);
    }
    return "";
  }, [explicitIcon]);

  const explicitColor = useMemo(() => {
    if (color && typeof color === "string" && color.trim() !== "") {
      return color;
    }
    if (explicitIcon) {
      const metadata = getIconMetadata(explicitIcon);
      if (metadata?.defaultColor && metadata.defaultColor !== "currentColor") {
        return metadata.defaultColor;
      }
    }
    return undefined;
  }, [color, explicitIcon]);

  // Tier 1: explicit extracted icon
  if (explicitSvg) {
    return (
      <div
        className="flex items-center justify-center rounded-xl shrink-0"
        style={{
          width: size,
          height: size,
          backgroundColor: (explicitColor || "#6b7280") + "1a",
        }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            color: explicitColor,
            width: size * 0.58,
            height: size * 0.58,
          }}
          dangerouslySetInnerHTML={{ __html: explicitSvg }}
        />
      </div>
    );
  }

  if (explicitUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-xl shrink-0 overflow-hidden"
        style={{
          width: size,
          height: size,
          backgroundColor: (explicitColor || "#6b7280") + "1a",
        }}
      >
        <img
          src={explicitUrl}
          alt={name}
          title={name}
          className="object-contain"
          style={{ width: size * 0.68, height: size * 0.68 }}
          loading="lazy"
        />
      </div>
    );
  }

  // Tier 2: name-based inference (simplified brands)
  const inferred = inferIcon(name);
  if (inferred) {
    const { svg, color: inferredColor } = inferred.icon;
    const effectiveColor = color || inferredColor;
    return (
      <div
        className="flex items-center justify-center rounded-xl shrink-0"
        style={{ width: size, height: size, backgroundColor: effectiveColor + "1a" }}
      >
        <div
          className="flex items-center justify-center"
          style={{ color: effectiveColor, width: size * 0.58, height: size * 0.58 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    );
  }

  // Tier 3: initials fallback
  const initials = name
    .split(/[\s\-_\/\.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className="flex items-center justify-center rounded-xl shrink-0 font-semibold bg-muted text-muted-foreground"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initials || "?"}
    </div>
  );
}
