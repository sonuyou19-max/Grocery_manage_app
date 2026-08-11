import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * Slow-moving mesh gradient background — except it no longer moves, and no
 * longer blurs. Both of those were deliberate, and both had to go.
 *
 * ---------------------------------------------------------------------------
 * What this used to be, and what it cost
 * ---------------------------------------------------------------------------
 *
 * Three hard-edged circles drifting on infinite `withRepeat` timings, smeared
 * into a soft field by a full-screen BlurView. It looked right and it was the
 * single most expensive thing in the app.
 *
 * On Android that BlurView installs an `OnPreDrawListener` on the whole screen
 * and re-snapshots and re-blurs the entire view hierarchy into a bitmap on
 * every pre-draw pass (see components/frosted.tsx for the full account). This
 * background sits on EVERY screen, and because the blobs animated forever,
 * pre-draw fired forever: the UI thread was doing full-screen bitmap blurs at
 * rest, with nothing on screen changing. Every transition in the app then had
 * to compete with that, which is what made them stutter and snap rather than
 * run — and what made the cold start take seconds.
 *
 * The drift was a 16–23 second traverse. Nobody has ever seen it. It was
 * costing a permanently saturated UI thread to animate something below the
 * threshold of perception.
 *
 * ---------------------------------------------------------------------------
 * What it is now
 * ---------------------------------------------------------------------------
 *
 * The same three colour fields in the same three places, drawn as SVG ellipses
 * filled with a radial gradient that fades to transparent. The soft edge comes
 * from the gradient itself, so there is nothing left to blur — which means no
 * bitmap, no pre-draw listener, and no per-frame work at all. It renders once
 * and then costs nothing until the window resizes.
 *
 * Plus one noise tile on top. Losing the blur also lost the only thing that was
 * hiding 8-bit quantisation, and dark mode showed the result as concentric
 * rings; the tile dithers them away for the cost of a single static draw. The
 * two remedies are separate and both are needed — the falloff below fixes a
 * ring this file put there itself, the tile fixes the ones the display puts
 * there.
 *
 * Purely decorative — never intercepts touches.
 *
 * `dim` deepens everything into a near-black moody field for full-screen focus
 * moments (the Vibe Check), so the foreground cards own all the attention.
 */

/**
 * Peak opacity of a blob at its centre.
 *
 * The old BlurView also laid down a tint wash of its own (expo-blur turns
 * `intensity` into a translucent white/black overlay), which took the edge off
 * the colours. Nothing does that any more, so the blobs are held back here
 * instead — otherwise the same hex values read noticeably more saturated than
 * the build this replaces.
 */
const PEAK = { light: 0.8, dark: 0.8 } as const;

/**
 * The blob's falloff, as gradient stops.
 *
 * This replaced a three-stop ramp — full, then 62% at offset 0.55, then zero —
 * and that middle stop was a mistake I could see in the numbers before anyone
 * reported it: it is a discrete change of SLOPE at one radius, which draws a
 * ring. Three blobs, three rings, and dark mode showed them plainly.
 *
 * A gaussian has no corner anywhere, which is what a blurred circle actually
 * looks like and what this is imitating. Sampled at ten stops the renderer's
 * linear interpolation between them is far below the eye's threshold.
 *
 * Normalised so the edge reaches exactly zero: exp(-3) is 0.05, and leaving
 * that residue would put a visible disc boundary where the ellipse ends —
 * trading a soft ring for a hard one.
 */
const FALLOFF = Array.from({ length: 10 }, (_, i) => {
  const t = i / 9;
  const g = Math.exp(-3 * t * t);
  return { offset: t, weight: (g - Math.exp(-3)) / (1 - Math.exp(-3)) };
});

/** How far past the old circle's radius the gradient reaches before it hits
 *  zero. A blur spread the colour well beyond the shape it started from; the
 *  gradient has to be wider than the original circle to cover the same area. */
const SPREAD = 1.3;

interface BlobSpec {
  color: string;
  /** Centre and radius, as fractions of the window, matching the midpoint of
   *  the drift the old version animated between. */
  cx: number;
  cy: number;
  r: number;
}

export function MeshBackground({ dim = false }: { dim?: boolean }) {
  const { colors, scheme } = useTheme();
  const { width, height } = useWindowDimensions();

  // Positions are the midpoints of the old from→to drift, so a returning user
  // sees the composition they already know rather than one of its extremes.
  const blobs: BlobSpec[] = [
    { color: colors.meshA, cx: 0.385 * width, cy: 0.5 * width - 0.03 * height, r: 0.5 * width },
    { color: colors.meshB, cx: 0.84 * width, cy: 0.32 * height + 0.45 * width, r: 0.45 * width },
    { color: colors.meshC, cx: 0.51 * width, cy: 0.72 * height + 0.475 * width, r: 0.475 * width },
  ];

  const peak = dim ? PEAK.dark : PEAK[scheme];

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: dim ? '#050704' : colors.meshBase }]}
      pointerEvents="none"
    >
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {blobs.map((b, i) => (
            <RadialGradient key={i} id={`mesh${i}`} cx="50%" cy="50%" r="50%">
              {FALLOFF.map((s) => (
                <Stop
                  key={s.offset}
                  offset={s.offset}
                  stopColor={b.color}
                  stopOpacity={peak * s.weight}
                />
              ))}
            </RadialGradient>
          ))}
        </Defs>
        {blobs.map((b, i) => (
          <Ellipse
            key={i}
            cx={b.cx}
            cy={b.cy}
            rx={b.r * SPREAD}
            ry={b.r * SPREAD}
            fill={`url(#mesh${i})`}
          />
        ))}
      </Svg>
      {/*
        * The scrim keeps the mesh subtle — and costs contrast to do it, which
        * matters more than it looks.
        *
        * It is a flat wash, so it does not just darken: it COMPRESSES whatever
        * range the gradient had into fewer 8-bit steps, and fewer steps over
        * the same distance means wider, more visible bands. Dark mode was
        * spending 42% of its range that way over a ramp only ~39 levels deep
        * to begin with. Held much lower there now, with the blob peak brought
        * down to match so the result is no louder than before.
        */}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: dim ? 'rgba(5,7,4,0.7)' : colors.meshScrim }]}
      />
      {/*
        * Dither. Last, over everything, because it corrects the rounding that
        * everything above it has already done.
        *
        * A smooth curve does not survive an 8-bit destination: dark mode's ramp
        * spans ~29 values over a ~260dp radius, so there is a hard-edged arc
        * every ~9dp no matter how continuous the maths was. One step of white
        * noise breaks each arc into an interleaving of the two values either
        * side of it, and the eye reads the mix as the ramp it was supposed to
        * be. See scripts/gen-mesh-dither.mjs for the arithmetic — including why
        * the same tile is, correctly, worth almost nothing in light mode.
        *
        * `fadeDuration` off: Android cross-fades images in over 300ms by
        * default, and the background must not announce itself on every mount.
        */}
      <Image
        source={require('../../assets/images/mesh-dither.png')}
        style={StyleSheet.absoluteFill}
        resizeMode="repeat"
        fadeDuration={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
