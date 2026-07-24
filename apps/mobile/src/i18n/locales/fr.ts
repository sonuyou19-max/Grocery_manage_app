// AI-drafted French. Recommend a native review before store launch.
const fr = {
  tabs: { lists: 'Listes', pantry: 'Garde-manger', insights: 'Analyses', settings: 'Réglages' },
  common: {
    cancel: 'Annuler',
    save: 'Enregistrer',
    done: 'Terminé',
    add: 'Ajouter',
    close: 'Fermer',
    back: 'Retour',
    continue: 'Continuer',
    notNow: 'Pas maintenant',
  },
  greeting: {
    morning: 'Bonjour',
    afternoon: 'Bon après-midi',
    evening: 'Bonsoir',
    subtitle: 'Tes listes de courses',
  },
  setup: {
    regionTitle: 'Où fais-tu tes courses ?',
    regionSubtitle: 'Ça définit ta devise et te suggère une langue.',
    languageTitle: 'Choisis ta langue',
    languageSubtitle: 'Tu peux changer à tout moment dans les Réglages.',
  },
  settings: { localeSection: 'Région et langue', region: 'Région', language: 'Langue' },
  lists: {
    vibeTitle: 'Point garde-manger',
    vibeReview: {
      one: '%{count} article à vérifier · 10 secondes',
      other: '%{count} articles à vérifier · 10 secondes',
    },
    vibeEmpty1Title: 'Tout va bien au garde-manger 🧺',
    vibeEmpty1Body:
      'Rien à réapprovisionner pour l’instant. Fais tes courses comme d’habitude — j’apprends ton rythme et je te préviens avant que ça manque.',
    vibeEmpty2Title: 'Tu es bien approvisionné',
    vibeEmpty2Body:
      'Rien à vérifier pour le moment. Au fil de tes courses, je repère la vitesse à laquelle les choses s’épuisent et je les affiche ici avant que tu sois à court.',
    vibeEmpty3Title: 'Parfait — rien ne manque',
    vibeEmpty3Body:
      'Fais tes courses tranquillement. J’apprends ton rythme et je te fais signe ici juste avant la rupture.',
    yourLists: 'Vos listes',
    holdToEdit: 'maintenir pour modifier',
    buildWeekly: 'Composer ma liste de la semaine',
    emptyTitle: 'Aucune liste',
    emptyBody:
      'Appuie sur « Nouvelle liste » pour créer ta première liste de courses. Ajoute des articles, coche-les en faisant tes courses et (une fois dans un foyer) partage-la en direct avec tes proches.',
    newList: 'Nouvelle liste',
    newListPlaceholder: 'ex. Courses de la semaine',
    create: 'Créer',
    addTheseTo: 'Ajouter ces articles à',
    itemsCount: { one: '%{count} article', other: '%{count} articles' },
    inCart: '%{count} dans le panier',
  },
  pantry: {
    subtitleEmpty: 'Ce que Korb suit',
    subtitleTracked: '%{count} suivis · %{low} bientôt épuisés',
    emptyTitle: 'Rien de suivi pour l’instant',
    emptyBody:
      'À mesure que tu coches des articles sur tes listes, Korb apprend à quelle vitesse tu les consommes et les suit ici. Ou appuie sur « Suivre un article » pour ajouter un produit que tu gardes toujours chez toi.',
    search: 'Rechercher dans ton garde-manger',
    swipeHint: 'Balaie une ligne : → encore bon · ← vers une liste',
    noMatchesTitle: 'Aucun résultat',
    noMatchesBody: 'Rien dans ton garde-manger ne correspond à « %{query} ».',
    runningLow: 'Bientôt épuisé',
    inStock: 'En stock',
    nothingLow: 'Rien à racheter — bien approvisionné.',
    nothingHere: 'Rien ici pour l’instant.',
    stillGood: 'Encore bon',
    addToList: 'Vers une liste',
    track: 'Suivre un article',
    trackTitle: 'Suivre un article du garde-manger',
    trackPlaceholder: 'ex. Huile d’olive',
    trackConfirm: 'Suivre',
    addTo: 'Ajouter %{item} à',
  },
};

export default fr;
