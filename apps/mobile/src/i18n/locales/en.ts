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
  lists: {
    vibeTitle: 'Pantry Vibe Check',
    vibeReview: {
      one: '%{count} item to review · 10 seconds',
      other: '%{count} items to review · 10 seconds',
    },
    vibeEmpty1Title: 'All good in the pantry 🧺',
    vibeEmpty1Body:
      "Nothing running low yet. Shop like you normally would — I'll get a feel for your rhythm and give you a heads-up before stuff runs out.",
    vibeEmpty2Title: 'You’re all stocked up',
    vibeEmpty2Body:
      'Nothing to review right now. As you shop, I get a feel for how fast things disappear and pop them here before you’re caught short.',
    vibeEmpty3Title: 'Nice — nothing’s low',
    vibeEmpty3Body:
      "Do your thing at the shops. I'll learn your pace and drop a reminder here right before you run out.",
    yourLists: 'Your lists',
    holdToEdit: 'hold to edit',
    buildWeekly: "Build this week's list",
    emptyTitle: 'No lists yet',
    emptyBody:
      'Tap “New list” to start your first shopping list. Add items, tick them off as you shop, and (once you’re in a household) share it live with the people you shop for.',
    newList: 'New list',
    newListPlaceholder: 'e.g. Weekly groceries',
    create: 'Create',
    addTheseTo: 'Add these items to',
    itemsCount: { one: '%{count} item', other: '%{count} items' },
    inCart: '%{count} in cart',
  },
  pantry: {
    subtitleEmpty: 'What Korb is tracking',
    subtitleTracked: '%{count} tracked · %{low} running low',
    emptyTitle: 'Nothing tracked yet',
    emptyBody:
      'As you tick items off your lists, Korb learns how fast you get through them and tracks them here. Or tap “Track item” to add a staple you always keep at home.',
    search: 'Search your pantry',
    swipeHint: 'Swipe a row: → still good · ← add to a list',
    noMatchesTitle: 'No matches',
    noMatchesBody: 'Nothing in your pantry matches “%{query}”.',
    runningLow: 'Running low',
    inStock: 'In stock',
    nothingLow: 'Nothing running low — nicely stocked.',
    nothingHere: 'Nothing here yet.',
    stillGood: 'Still good',
    addToList: 'Add to list',
    track: 'Track item',
    trackTitle: 'Track a pantry item',
    trackPlaceholder: 'e.g. Olive oil',
    trackConfirm: 'Track',
    addTo: 'Add %{item} to',
  },
  category: {
    fruit_veg: 'Fruit & Veg',
    dairy_eggs: 'Dairy & Eggs',
    meat_fish: 'Meat & Fish',
    bakery: 'Bakery',
    pantry: 'Pantry',
    frozen: 'Frozen',
    drinks: 'Drinks',
    household: 'Household',
    personal_care: 'Personal Care',
    other: 'Other',
  },
  status: {
    learning: 'Learning your pace',
    runningLow: 'Running low',
    daysLeft: { one: '~%{count} day left', other: '~%{count} days left' },
  },
  lastBought: {
    never: 'Never bought yet',
    today: 'Last bought today',
    yesterday: 'Last bought yesterday',
    days: { one: 'Last bought %{count} day ago', other: 'Last bought %{count} days ago' },
    weekAgo: 'Last bought a week ago',
    weeks: { one: 'Last bought %{count} week ago', other: 'Last bought %{count} weeks ago' },
    months: { one: 'Last bought %{count} month ago', other: 'Last bought %{count} months ago' },
  },
};

export default en;
export type Translation = typeof en;
