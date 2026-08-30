import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { DURATION } from '@/lib/motion';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * The little arc an item traces when it goes into the cart.
 *
 * Checking something off is the most-repeated action in the app, and until now
 * it changed a checkbox and nothing else. Watching the item travel to the bag
 * makes the destination obvious, which is what earns the right to then remove
 * the row from the list — a row that simply vanished would read as a deletion.
 *
 * ---------------------------------------------------------------------------
 * Why a timing curve and not a spring
 * ---------------------------------------------------------------------------
 *
 * lib/motion.ts reserves springs for gestures, because a spring's whole value
 * is continuing the velocity your finger had. A tap has no velocity, and this
 * flight has to stay in step with the row collapsing underneath it — which
 * needs a duration known in advance. So this is deliberately one of the
 * timing-curve cases that file describes, not an exception to it.
 *
 * ---------------------------------------------------------------------------
 * Why an arc
 * ---------------------------------------------------------------------------
 *
 * A straight line between two points reads as a UI element being repositioned.
 * A quadratic Bézier with the control point lifted above both ends reads as
 * something being *tossed* — the same reason a real object thrown into a bag
 * doesn't travel in a straight line. The lift is proportional to the distance
 * travelled, so a row near the top of the screen doesn't loop absurdly high.
 */

/** Where a flight starts and ends, in overlay-local coordinates. */
export interface FlightPoint {
  x: number;
  y: number;
}

export interface FlyToCartHandle {
  /**
   * Send one item on its way. Safe to call again mid-flight: each launch is
   * independent, so checking three rows quickly gives three overlapping arcs
   * rather than one that keeps getting retargeted.
   */
  launch: (glyph: string, from: FlightPoint, to: FlightPoint) => void;
  /**
   * Translate window coordinates (what measureInWindow reports) into the
   * overlay's own space.
   *
   * The overlay fills the screen but is not guaranteed to start at the window
   * origin — an Android translucent status bar offsets it. Subtracting the
   * overlay's measured origin makes the arithmetic correct on both platforms
   * instead of correct on whichever one it was written against.
   */
  toLocal: (windowX: number, windowY: number) => FlightPoint;
}

/** Long enough to read as a throw, short enough not to delay the next tap. */
const FLIGHT_MS = DURATION.travel;

/** Glyph size at launch and at touchdown. */
const START_SIZE = 22;
const END_SCALE = 0.45;

interface Flight {
  id: number;
  glyph: string;
  from: FlightPoint;
  to: FlightPoint;
}

export const FlyToCart = forwardRef<FlyToCartHandle, { onArrive?: () => void }>(
  function FlyToCart({ onArrive }, ref) {
    const [flights, setFlights] = useState<Flight[]>([]);
    const nextId = useRef(0);
    // Overlay origin in window space; see toLocal.
    const origin = useRef<FlightPoint>({ x: 0, y: 0 });

    const remove = useCallback((id: number) => {
      setFlights((prev) => prev.filter((f) => f.id !== id));
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        launch: (glyph, from, to) => {
          nextId.current += 1;
          setFlights((prev) => [...prev, { id: nextId.current, glyph, from, to }]);
        },
        toLocal: (windowX, windowY) => ({
          x: windowX - origin.current.x,
          y: windowY - origin.current.y,
        }),
      }),
      [],
    );

    // onLayout gives the overlay's position inside its parent; measureInWindow
    // gives it in window space. Only the latter is comparable with the points
    // the caller measures, so that is what is stored.
    const onLayout = useCallback((_e: LayoutChangeEvent) => {
      // measureInWindow on the next frame: at layout time the view is placed
      // but the window transform may not be settled on Android.
      requestAnimationFrame(() => {
        selfRef.current?.measureInWindow((x, y) => {
          origin.current = { x, y };
        });
      });
    }, []);

    const selfRef = useRef<View>(null);

    return (
      <View
        ref={selfRef}
        onLayout={onLayout}
        style={StyleSheet.absoluteFill}
        // Never intercepts touches: the user must be able to keep ticking rows
        // while earlier items are still in the air.
        pointerEvents="none"
      >
        {flights.map((f) => (
          <FlyingGlyph
            key={f.id}
            flight={f}
            onDone={() => {
              remove(f.id);
              onArrive?.();
            }}
          />
        ))}
      </View>
    );
  },
);

function FlyingGlyph({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const t = useSharedValue(0);

  // Started in a layout effect rather than on mount-render so the glyph is
  // painted at its origin for one frame first; animating from an unpainted
  // position makes the first ~30ms of the arc invisible.
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    t.value = withTiming(
      1,
      { duration: FLIGHT_MS, easing: Easing.bezier(0.35, 0, 0.25, 1) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
  }

  const style = useAnimatedStyle(() => {
    const p = t.value;
    const { from, to } = flight;
    // Control point: midway across, lifted above the higher of the two ends by
    // a fraction of the distance travelled. Scaled by distance so a short hop
    // arcs gently and a long one arcs properly.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const cx = (from.x + to.x) / 2;
    const cy = Math.min(from.y, to.y) - Math.min(distance * 0.35, 140);

    const inv = 1 - p;
    const x = inv * inv * from.x + 2 * inv * p * cx + p * p * to.x;
    const y = inv * inv * from.y + 2 * inv * p * cy + p * p * to.y;

    return {
      transform: [
        { translateX: x },
        { translateY: y },
        { scale: 1 - (1 - END_SCALE) * p },
      ],
      // Holds full opacity almost the whole way, then disappears into the bag
      // rather than fading out over the arc — a glyph that fades early looks
      // like it failed to arrive.
      opacity: p < 0.82 ? 1 : 1 - (p - 0.82) / 0.18,
    };
  });

  return (
    <Animated.View style={[styles.glyph, style]}>
      <Text style={styles.glyphText}>{flight.glyph}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glyph: {
    position: 'absolute',
    // Anchored at its own top-left, and the caller passes the row's centre —
    // this offset puts the glyph's centre on that point.
    left: -START_SIZE / 2,
    top: -START_SIZE / 2,
    width: START_SIZE,
    height: START_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphText: { fontSize: START_SIZE, lineHeight: START_SIZE * 1.15 },
});
