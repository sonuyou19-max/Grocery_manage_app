import type { TextStyle } from 'react-native';

/**
 * Korb design tokens — source of truth is the approved design concept
 * (design spec artifact, v1 + optional-pricing revision).
 *
 * Dark mode is a re-pick, not an inversion: the accent brightens to hold
 * contrast, warn/crit shift warmer for low-light legibility.
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
  glassBorder: string;
  /** BlurView tint to use for glass/mesh in this scheme. */
  blurTint: 'light' | 'dark';
}

export const palette: Record<'light' | 'dark', ThemeColors> = {
  light: {
    bg: '#F6F7F0',
    surface: '#FFFFFF',
    ink: '#141A10',
    muted: '#5E6857',
    line: '#E5E8DC',
    accent: '#2E7442',
    accentInk: '#FFFFFF',
    accentSoft: '#E4EFE4',
    warn: '#B97F14',
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
    glassBorder: 'rgba(255,255,255,0.7)',
    blurTint: 'light',
  },
  dark: {
    bg: '#0E120C',
    surface: '#1E241B',
    ink: '#F1F4EA',
    muted: '#96A28B',
    line: '#2B3326',
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
    glassBorder: 'rgba(255,255,255,0.1)',
    blurTint: 'dark',
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
