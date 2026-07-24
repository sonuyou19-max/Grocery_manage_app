/**
 * English — the source of truth. Every other locale mirrors these keys and
 * falls back here for anything missing, so shipping a partial translation is
 * safe. Keys are grouped by area; add new UI strings here first.
 */
const en = {
  tabs: {
    lists: 'Lists',
    pantry: 'Pantry',
    insights: 'Insights',
    settings: 'Settings',
  },
  common: {
    cancel: 'Cancel',
    save: 'Save',
    done: 'Done',
    add: 'Add',
    close: 'Close',
    back: 'Back',
    continue: 'Continue',
    notNow: 'Not now',
  },
  greeting: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
    subtitle: 'Your grocery lists',
  },
  setup: {
    regionTitle: 'Where do you shop?',
    regionSubtitle: 'This sets your currency and suggests a language.',
    languageTitle: 'Choose your language',
    languageSubtitle: 'You can change this anytime in Settings.',
  },
  settings: {
    localeSection: 'Region & language',
    region: 'Region',
    language: 'Language',
  },
};

export default en;
export type Translation = typeof en;
