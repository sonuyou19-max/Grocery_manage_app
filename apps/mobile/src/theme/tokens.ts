import type { TextStyle } from 'react-native';

/**
 * Korb design tokens — source of truth is the approved design concept
 * (design spec artifact, v1 + optional-pricing revision).
 *
 * Dark mode is a re-pick, not an inversion: the accent brightens to hold
 * contrast, warn/crit shift warmer for low-light legibility.
 *
 * ---------------------------------------------------------------------------
 * Measured contrast, not judged contrast
 * ---------------------------------------------------------------------------
 *
 * Every ratio quoted below is WCAG 2.1 relative luminance, computed rather than
 * eyeballed, because eyeballing is what produced the two failures this comment
 * exists to record. Both looked fine on a good laptop display.
 *
 *   `line` was 1.15:1 against `bg`. Not a borderline value — a hairline that
 *   the panel of a cheap Android phone cannot physically render distinctly from
 *   its background. It now sits near 1.6:1, roughly where Material puts a
 *   divider: present when you look for it, silent when you don't.
 *
 *   `warn` was 3.44:1 on white and 2.95:1 on `warnSoft`, and it is used for
 *   13px body text — "~4 days left", the "Still good" chip, the RUNNING LOW
 *   heading. AA wants 4.5:1 for text that size. It failed on every surface it
 *   appears on, in the app's default light theme. Darkened until it clears on
 *   the worst of them (4.8:1 on `warnSoft`, 5.6:1 on white).
 *
 * `crit` was checked at the same time and passes — 5.0:1 on white, 4.8:1 in
 * dark mode — so it is deliberately unchanged. The red always looked like the
 * risky one and never was.
 */

export interface ThemeColors {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  warn: string;
  warnSoft: string;
  crit: string;
  critSoft: string;
  lime: string;
  /** Mesh-gradient background: an opaque base plus three drifting colour fields. */
  meshBase: string;
  meshA: string;
  meshB: string;
  meshC: string;
  /** Scrim laid over the blurred mesh so it stays subtle, never saturated. */
  meshScrim: string;
  /** Frosted-glass surfaces: translucent fill + thin, semi-transparent border. */
  glassFill: string;
  /**
   * The same surface where there is no blur under it — Android (see
   * components/frosted.tsx). A blur does two jobs: it softens, and it hides
   * whatever scrolls beneath. Without one, `glassFill` alone would leave list
   * rows legibly sliding under the tab bar and the sheets, so this is denser.
   * Still short of opaque, so the mesh's colour reads through and the surface
   * is glass rather than a panel.
   */
  glassSolid: string;
  /**
   * Overlays that sit on APP CONTENT rather than on the mesh — sheets, menus,
   * dialogs, the tab bar, the toast.
   *
   * Opaque, and that is the point. A card floats over a smooth gradient, so a
   * translucent fill there still reads as glass and there is nothing legible
   * behind it to distract. A menu floats over list rows and buttons, and at 90%
   * those show straight through: the first Android build without a real blur
   * behind them looked, in the user's words, "very bad". A blur used to hide
   * that regardless of alpha; nothing does now, so the fill has to.
   */
  overlaySolid: string;
  glassBorder: string;
  /** BlurView tint to use for glass/mesh in this scheme. */
  blurTint: 'light' | 'dark';
  /**
   * Korb Plus.
   *
   * A violet-to-teal ramp, deliberately outside the app's green-and-amber
   * family. Everything else in Korb is a shade of "your groceries"; Plus is a
   * different KIND of thing — something you buy — and it should be recognisable
   * as that across the three surfaces it appears on (the card, the badge, the
   * paywall) without a label.
   *
   * Reserved, with one deliberate exception: the tab bar's create button. That
   * button opens a sheet whose second option is the Plus recipe importer, and
   * the colour was specified for it. It is worth knowing the cost — a free
   * user taps a purple button to make a free list, which spends a little of
   * what the gradient means everywhere else. Nothing else may use these.
   */
  plusFrom: string;
  plusTo: string;
  /** Tint behind a Plus icon or sub-card. Low saturation; it sits under text. */
  plusSoft: string;
  /** Text and glyphs ON plusSoft. */
  plusInk: string;
}

export const palette: Record<'light' | 'dark', ThemeColors> = {
  light: {
    bg: '#F6F7F0',
    surface: '#FFFFFF',
    ink: '#141A10',
    muted: '#5E6857',
    line: '#CBD0BF',
    accent: '#2E7442',
    accentInk: '#FFFFFF',
    accentSoft: '#E4EFE4',
    warn: '#8A5F0F',
    warnSoft: '#F6EDD8',
    crit: '#C93E22',
    critSoft: '#F9E6E0',
    lime: '#8CC63F',
    // Soft, bright daytime mesh — a pale field the frosted glass sits over.
    meshBase: '#EEF1E6',
    meshA: '#BBD8C0',
    meshB: '#D8E6B8',
    meshC: '#CFE0DE',
    meshScrim: 'rgba(246,247,240,0.5)',
    glassFill: 'rgba(255,255,255,0.55)',
    glassSolid: 'rgba(252,253,248,0.9)',
    overlaySolid: '#FBFCF7',
    glassBorder: 'rgba(20,26,16,0.22)',
    blurTint: 'light',
    plusFrom: '#6D5AE6',
    plusTo: '#2FA5A0',
    plusSoft: '#EFEDFC',
    plusInk: '#4A3BC4',
  },
  dark: {
    bg: '#0E120C',
    surface: '#1E241B',
    ink: '#F1F4EA',
    muted: '#96A28B',
    line: '#414A3B',
    accent: '#5FB878',
    accentInk: '#0E1A10',
    accentSoft: '#243B2A',
    warn: '#D9A83F',
    warnSoft: '#332A14',
    crit: '#E06A4C',
    critSoft: '#3A1F16',
    lime: '#8CC63F',
    // Dark, moody mesh — deep greens with a faint amber ember, kept muted.
    meshBase: '#0B0F09',
    meshA: '#1C3A28',
    meshB: '#13291E',
    meshC: '#2A3312',
    meshScrim: 'rgba(11,15,9,0.42)',
    glassFill: 'rgba(30,36,27,0.55)',
    glassSolid: 'rgba(26,32,23,0.9)',
    overlaySolid: '#1A2017',
    glassBorder: 'rgba(255,255,255,0.16)',
    blurTint: 'dark',
    // Lifted and desaturated for the dark surface: the light-mode violet goes
    // muddy on #1E241B, and the teal has to stay legible as a 12px glyph.
    plusFrom: '#8B7BF0',
    plusTo: '#45C3BC',
    plusSoft: '#241F3D',
    plusInk: '#A99BF5',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 16,
  pill: 999,
} as const;

/**
 * Weight- and scale-driven hierarchy on the platform system font. Headers go
 * big and boldly weighted with tight (negative) tracking so structure comes
 * from type and space, not from boxes and borders. Body stays clean and
 * high-contrast for effortless legibility while shopping.
 */
export const type: Record<
  'display' | 'h1' | 'h2' | 'body' | 'bodyRegular' | 'sub' | 'label' | 'price',
  TextStyle
> = {
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1.4, lineHeight: 44 },
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  h2: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5 },
  body: { fontSize: 16, fontWeight: '600' },
  bodyRegular: { fontSize: 16, fontWeight: '400' },
  sub: { fontSize: 13, fontWeight: '400' },
  label: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  price: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
};
