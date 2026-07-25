import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Rect } from 'react-native-svg';

import { encodeBarcode, formatCardValue, type Symbology } from '@/lib/barcode';
import { radii, spacing, type } from '@/theme';

/**
 * Draws a loyalty card's code so a till scanner can read it.
 *
 * Rendered from the decoded number rather than shown as the original photo:
 * a photo is at the mercy of glare, crop and focus, while re-drawn vectors are
 * full-contrast and sharp at any size. The number is printed underneath so a
 * cashier can key it in if the scanner still refuses.
 *
 * **Always black on white, in both themes.** This is the one place in the app
 * that ignores dark mode: scanners key off luminance contrast, and an inverted
 * or tinted barcode is measurably worse to scan. The white plate below is
 * deliberate, not an oversight.
 */

interface CardCodeProps {
  symbology: Symbology;
  value: string;
  /** Width available for the code, in px. */
  width: number;
  /** Bar height for linear symbologies. */
  height?: number;
  /** Print the human-readable number below the code. */
  showText?: boolean;
}

export function CardCode({ symbology, value, width, height = 76, showText = true }: CardCodeProps) {
  const encoded = symbology === 'qr' ? null : encodeBarcode(symbology, value);

  return (
    <View style={[styles.plate, { width }]}>
      {symbology === 'qr' ? (
        // Cap the QR at the plate width but keep it square, and leave room for
        // the number beneath.
        <QRCode value={value} size={Math.min(width - spacing.lg * 2, 180)} />
      ) : encoded ? (
        <Bars encoded={encoded} width={width - spacing.md * 2} height={height} />
      ) : null}

      {showText && (
        <Text
          style={[type.price, styles.digits, !encoded && symbology !== 'qr' && styles.digitsOnly]}
          // Selectable so a number that won't scan can be copied out rather
          // than read off the screen digit by digit.
          selectable
        >
          {formatCardValue(symbology, value)}
        </Text>
      )}
    </View>
  );
}

/** The bar pattern as filled rects — one per black run. */
function Bars({
  encoded,
  width,
  height,
}: {
  encoded: NonNullable<ReturnType<typeof encodeBarcode>>;
  width: number;
  height: number;
}) {
  const module = width / encoded.width;
  const rects: { x: number; w: number }[] = [];
  let x = 0;
  encoded.bars.forEach((run, i) => {
    // Runs alternate white/black starting white, so odd indices are the bars.
    if (i % 2 === 1 && run > 0) rects.push({ x: x * module, w: run * module });
    x += run;
  });

  return (
    <Svg width={width} height={height}>
      {rects.map((r, i) => (
        <Rect key={i} x={r.x} y={0} width={r.w} height={height} fill="#000000" />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: '#FFFFFF',
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Fixed dark ink, not colors.ink — see the note above about contrast.
  digits: { color: '#111111', letterSpacing: 1.5 },
  // With no bars to carry it, the number is the whole payload, so give it size.
  digitsOnly: { fontSize: 20, paddingVertical: spacing.sm },
});
