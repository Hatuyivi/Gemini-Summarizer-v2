// Monochrome black/white palette inspired by the Claude mobile UI:
// pure-black canvas, very soft elevated surfaces, hairline dividers,
// white as the only accent. Status hues are intentionally kept to a
// single muted yellow for warning and a single muted red for error —
// everything else lives on the grey axis so the look stays Claude-ish.
const palette = {
  black: "#000000",
  surface: "#0a0a0a",
  elevated: "#111111",
  raised: "#181818",
  border: "#1f1f1f",
  borderStrong: "#2a2a2a",
  textPrimary: "#ffffff",
  textSecondary: "#9b9b9b",
  textMuted: "#5f5f5f",
  accent: "#ffffff",
  accentForeground: "#000000",
  destructive: "#e5484d",
  success: "#ffffff",
  warning: "#d4a648",
};

const colors = {
  light: {
    text: palette.textPrimary,
    tint: palette.accent,
    background: palette.black,
    foreground: palette.textPrimary,
    card: palette.surface,
    cardForeground: palette.textPrimary,
    elevated: palette.elevated,
    raised: palette.raised,
    primary: palette.accent,
    primaryForeground: palette.accentForeground,
    secondary: palette.elevated,
    secondaryForeground: palette.textPrimary,
    muted: palette.elevated,
    mutedForeground: palette.textSecondary,
    accent: palette.elevated,
    accentForeground: palette.textPrimary,
    destructive: palette.destructive,
    destructiveForeground: palette.textPrimary,
    border: palette.border,
    borderStrong: palette.borderStrong,
    input: palette.elevated,
    success: palette.success,
    warning: palette.warning,
    textMuted: palette.textMuted,
  },
  radius: 14,
};

export default colors;
