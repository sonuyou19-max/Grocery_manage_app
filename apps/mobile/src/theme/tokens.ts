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
}

export const palette: Record<'light' | 'dark', ThemeColors> = {
  light: {
    bg: '#F6F7F0',
    surface: '#FFFFFF',
    ink: '#1B2417',
    muted: '#6B7563',
    line: '#E5E8DC',
    accent: '#2E7442',
    accentInk: '#FFFFFF',
    accentSoft: '#E4EFE4',
    warn: '#B97F14',
    warnSoft: '#F6EDD8',
    crit: '#C93E22',
    critSoft: '#F9E6E0',
    lime: '#8CC63F',
  },
  dark: {
    bg: '#141A12',
    surface: '#1E241B',
    ink: '#EBEFE4',
    muted: '#94A08A',
    line: '#2B3326',
    accent: '#5FB878',
    accentInk: '#0E1A10',
    accentSoft: '#243B2A',
    warn: '#D9A83F',
    warnSoft: '#332A14',
    crit: '#E06A4C',
    critSoft: '#3A1F16',
    lime: '#8CC63F',
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

/** Weight-driven hierarchy on the platform system font. */
export const type: Record<
  'h1' | 'h2' | 'body' | 'bodyRegular' | 'sub' | 'label' | 'price',
  TextStyle
> = {
  h1: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  h2: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
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
