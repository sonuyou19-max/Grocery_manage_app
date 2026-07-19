import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

interface BlobProps {
  color: string;
  size: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  duration: number;
}

/** A single soft colour field that drifts slowly between two points. */
function Blob({ color, size, from, to, duration }: BlobProps) {
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [duration, p]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: from.x + (to.x - from.x) * p.value },
      { translateY: from.y + (to.y - from.y) * p.value },
      { scale: 1 + 0.18 * p.value },
    ],
  }));

  return (
    <Animated.View
      style={[
        { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * Slow-moving mesh gradient background. Three tinted blobs drift behind a heavy
 * blur, which smears them into a soft, premium gradient; a scrim on top keeps it
 * subtle rather than saturated. Adapts to light (bright, airy) and dark (moody).
 * Purely decorative — never intercepts touches.
 */
export function MeshBackground() {
  const { colors, scheme } = useTheme();
  const { width, height } = useWindowDimensions();

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: colors.meshBase }]}
      pointerEvents="none"
    >
      <Blob
        color={colors.meshA}
        size={width * 1.0}
        from={{ x: -width * 0.35, y: -height * 0.12 }}
        to={{ x: width * 0.12, y: height * 0.06 }}
        duration={16000}
      />
      <Blob
        color={colors.meshB}
        size={width * 0.9}
        from={{ x: width * 0.5, y: height * 0.18 }}
        to={{ x: width * 0.28, y: height * 0.46 }}
        duration={23000}
      />
      <Blob
        color={colors.meshC}
        size={width * 0.95}
        from={{ x: -width * 0.15, y: height * 0.62 }}
        to={{ x: width * 0.22, y: height * 0.82 }}
        duration={19000}
      />
      <BlurView
        intensity={scheme === 'dark' ? 90 : 68}
        tint={colors.blurTint}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.meshScrim }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
