import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

/**
 * Overlapping stack of the people who can see something — the affordance Bring
 * puts on each list card, so you can tell at a glance who a list is shared with.
 *
 * Initials rather than photos: there is no avatar storage in the schema, so a
 * coloured circle with initials is the honest version. The colour is derived
 * from the member's id so a person keeps the same colour everywhere (matching
 * how Settings already renders members).
 *
 * Renders nothing for a single member — a lone avatar of yourself is noise.
 */

export interface AvatarMember {
  id: string;
  displayName: string;
}

/** Same palette Settings uses, so a person looks identical in both places. */
const AVATAR_COLORS = ['#4C8A5C', '#B97F14', '#8A5A44', '#3B6EA5', '#8455A0'];

/** Stable per-person colour: hash the id rather than use list position. */
const colorFor = (id: string): string => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

interface MemberAvatarsProps {
  members: AvatarMember[];
  /** Diameter in px; the overlap and font scale with it. */
  size?: number;
  /** Show at most this many, then a "+N" bubble. */
  max?: number;
}

export function MemberAvatars({ members, size = 26, max = 4 }: MemberAvatarsProps) {
  const { colors } = useTheme();
  if (members.length < 2) return null;

  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  // Overlap by a third so a group reads as a cluster, not a row.
  const overlap = Math.round(size / 3);

  const bubble = (key: string, background: string, label: string, textColor: string, first: boolean) => (
    <View
      key={key}
      style={[
        styles.bubble,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          borderColor: colors.surface,
          marginLeft: first ? 0 : -overlap,
        },
      ]}
    >
      <Text
        style={[styles.text, { color: textColor, fontSize: Math.round(size * 0.4) }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <View style={styles.row}>
      {shown.map((m, i) =>
        bubble(m.id, colorFor(m.id), initials(m.displayName), '#FFFFFF', i === 0),
      )}
      {overflow > 0 &&
        bubble('overflow', colors.line, `+${overflow}`, colors.muted, false)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  bubble: {
    alignItems: 'center',
    justifyContent: 'center',
    // A ring in the surface colour is what separates overlapping circles.
    borderWidth: 1.5,
  },
  text: { fontWeight: '800' },
});
