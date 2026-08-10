import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Alert, Linking, Pressable, Share, StyleSheet } from "react-native";

import { haptics } from "@/lib/haptics";
import { useAuth } from "@/store/auth";
import { useHousehold } from "@/store/household";
import { useT } from "@/store/locale";
import { radii, spacing, useTheme } from "@/theme";

/**
 * "Invite someone to the household."
 *
 * Lives on the dashboard, beside the card wallet. It used to sit in a shopping
 * list's header, which put it one level too deep and said the wrong thing: you
 * invite people to a HOUSEHOLD, and they then see every list in it. Offering
 * that from inside one list implies the invitation is scoped to that list, and
 * it hid the feature from anyone who had not opened a list yet — which is
 * exactly the person who has nobody to share with.
 *
 * Sends the household's join code over WhatsApp when it is installed, and falls
 * back to the system share sheet. The code is what the other person types in;
 * no email lookup, no account enumeration (see docs/PER_LIST_ACCESS_DESIGN.md).
 */

/**
 * Set to the store listing once the app is public (task #117).
 *
 * While empty the invitation tells the recipient to join by code inside the
 * app, which is true and useless-but-honest; a link to nothing would be worse.
 */
const APP_DOWNLOAD_URL = "";

export function InviteButton() {
  const { colors } = useTheme();
  const t = useT();
  const { user } = useAuth();
  const { household } = useHousehold();

  /*
   * The i18n keys are still under `listDetail.*`, where this button was born.
   * Renaming them means touching ten keys across seven locales for no
   * user-visible gain, and a regex edit across the locale files has already
   * silently deleted a key once in this project. Left as they are, deliberately.
   */
  const invite = async () => {
    haptics.tick();

    if (!user) {
      Alert.alert(
        t("listDetail.signInShareTitle"),
        t("listDetail.signInShareBody"),
        [
          { text: t("common.notNow"), style: "cancel" },
          {
            text: t("listDetail.signIn"),
            onPress: () => router.push("/auth/sign-in"),
          },
        ],
      );
      return;
    }
    if (!household) {
      Alert.alert(t("listDetail.shareTitle"), t("listDetail.shareBody"), [
        { text: t("common.notNow"), style: "cancel" },
        {
          text: t("listDetail.setUpHousehold"),
          onPress: () => router.push("/auth/household"),
        },
      ]);
      return;
    }

    const message = [
      t("listDetail.inviteIntro", { name: household.name }),
      "",
      t("listDetail.inviteCode", { code: household.invite_code }),
      "",
      APP_DOWNLOAD_URL
        ? t("listDetail.inviteGetApp", { url: APP_DOWNLOAD_URL })
        : t("listDetail.inviteInApp"),
    ].join("\n");

    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    try {
      if (await Linking.canOpenURL(whatsappUrl)) {
        await Linking.openURL(whatsappUrl);
        return;
      }
    } catch {
      // fall through to the system share sheet
    }
    try {
      await Share.share({ message });
    } catch {
      // dismissed — nothing to do
    }
  };

  return (
    <Pressable
      onPress={invite}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t("listDetail.shareTitle")}
      style={[
        styles.button,
        { backgroundColor: colors.accentSoft, borderColor: colors.line },
      ]}
    >
      <Ionicons name="person-add-outline" size={22} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Matches the wallet button it sits beside — two controls of the same weight
  // in the same corner should not be two different shapes.
  button: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    // Nudge down so it optically centres against the tall display title.
    marginTop: spacing.xs,
  },
});
