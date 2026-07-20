import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MeshBackground } from '@/components/mesh-background';
import { captureException } from '@/lib/monitoring';
import { radii, spacing, type, useTheme } from '@/theme';

/** Friendly full-screen fallback shown when a render error is caught. */
function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.root}>
      <MeshBackground />
      <View style={styles.body}>
        <Text style={[type.display, styles.title, { color: colors.ink }]}>
          Something went wrong
        </Text>
        <Text style={[type.bodyRegular, styles.text, { color: colors.muted }]}>
          Korb hit an unexpected snag. Your lists are safe — let’s try that again.
        </Text>
        <Pressable
          onPress={onReset}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[type.body, { color: colors.accentInk }]}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * App-wide error boundary: catches render/runtime errors anywhere in the tree,
 * reports them through the monitoring seam, and shows a recoverable fallback
 * instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    captureException(error, { componentStack: info.componentStack ?? undefined });
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) return <ErrorFallback onReset={this.reset} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  title: { textAlign: 'center' },
  text: { textAlign: 'center', lineHeight: 24, maxWidth: 320 },
  button: {
    height: 54,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
});
