import { Text } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { type, useTheme } from '@/theme';

export default function SettingsScreen() {
  const { colors } = useTheme();

  return (
    <Screen title="Settings" subtitle="Household · account · preferences">
      <Card>
        <Text style={[type.body, { color: colors.ink }]}>Household & members</Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          Invite people to share lists and pantry — coming with auth.
        </Text>
      </Card>
      <Card>
        <Text style={[type.body, { color: colors.ink }]}>Appearance</Text>
        <Text style={[type.sub, { color: colors.muted }]}>
          Follows your system light/dark setting.
        </Text>
      </Card>
    </Screen>
  );
}
