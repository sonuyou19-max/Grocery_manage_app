# Localized permission strings — staged, not wired up

These six files hold the iOS permission-dialog text (camera, photo library) in
the app's six non-English languages. **They are deliberately not referenced from
`app.json` right now.** The permission prompts show the English strings set on
the `expo-camera` / `expo-image-picker` plugin configs.

## Why they're disconnected

Pointing `app.json`'s `locales` field at them **broke the Android release build.**
Expo's `locales` drives *both* platforms from one field — `withLocales` has an
iOS implementation and an Android one, and no way to scope it to one — so it also
wrote these keys into Android string resources:

```
android/app/src/main/res/values-b+de/strings.xml
  <string name="NSCameraUsageDescription">…</string>
  <string name="NSPhotoLibraryUsageDescription">…</string>
```

Those are iOS `Info.plist` key names. They have no counterpart in the default
`values/strings.xml`, which holds `app_name` and the `expo_*` keys instead. That
mismatch trips two Android lint checks that are **fatal in release builds**:

- `ExtraTranslation` — a translation exists for a string absent from the default
  locale (both NS keys, in all six locales).
- `MissingTranslation` — `app_name` exists in the default locale but in none of
  the six.

Result: `lintVitalRelease` fails and the APK never builds.

## Why removal was the right fix, not suppression

Nothing is lost on Android. The Android permission dialog is drawn by the system
and shows no app-provided rationale from the manifest, so those resources were
never going to be read by anything — they were pure build-breaking noise.

The alternatives were worse:

- **Disable the lint checks** (`checkReleaseBuilds false`, or disabling
  `MissingTranslation`) — turns off a genuinely useful check across the whole app
  to hide resources that shouldn't exist in the first place.
- **A custom config plugin** to inject matching default-locale strings and add
  `app_name` to all six — real native complexity, and another thing to break, for
  permission-dialog text.

The cost is that an iOS user sees an English camera/photos prompt. That is a
polish regression, not a functional one.

## How to wire them up properly later

Write a config plugin that, after `withLocales` runs, either deletes the
generated `values-b+*` folders or brings them into agreement with the default
locale (add the two NS keys to `values/strings.xml`, and `app_name` — untranslated,
it's a brand name — to each locale). Then restore in `app.json`:

```json
"locales": {
  "de": "./locales/de.json", "es": "./locales/es.json", "fr": "./locales/fr.json",
  "it": "./locales/it.json", "nl": "./locales/nl.json", "pl": "./locales/pl.json"
}
```

Verify with `npx expo prebuild --platform android` and check that every
`values*/strings.xml` declares the same key set before trusting a release build.

Note this is separate from the app's own i18n (`src/i18n/`), which is pure JS,
covers all seven languages, and is unaffected by any of the above.
