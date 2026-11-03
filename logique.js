// Créneau : les données et les règles de la prise de rendez-vous.
// Aucun affichage ici : client.js s'en charge.
//
// Les rendez-vous vivent dans la base Supabase réglée dans reglages.js. L'application attend de cette base :
// - creneaux_pris (debut, client_id) : le planning, les heures déjà prises, que tout le monde peut lire ;
// - rendez_vous (debut, client_id, nom, telephone, motif, precision) : le carnet, que chaque client lit pour les
//   siens, et que le coiffeur lit en entier ;
// - profiles (id, nom, role) : l'application ne la lit pas ; la base s'en sert pour reconnaître le coiffeur.
// L'application ne trie rien : elle affiche ce que la base lui rend.

const CRENEAU = (() => {
  const SALON = {
    nom: "Salon Lambert",
    metier: "Coiffure",
    ville: "Villeurbanne",
  };

  const HEURES = [9, 10, 11, 14, 15, 16, 17]; // début de chaque créneau d'une heure
  const JOURS_OUVERTS = [2, 3, 4, 5, 6]; // du mardi au samedi
  const HORIZON_JOURS = 14; // les réservations ouvrent deux semaines à l'avance
  const MOTIFS = ["Coupe", "Coupe et brushing", "Couleur", "Mèches", "Barbe", "Autre"];

  const base =
    REGLAGES.adresse && REGLAGES.clePublique
      ? supabase.createClient(REGLAGES.adresse, REGLAGES.clePublique)
      : null;

  // Ce que la base répond, dit en clair. Le message d'origine suit, pour savoir quelle règle a refusé.
  const REFUS = {
    23505: "Ce créneau vient d'être réservé par quelqu'un d'autre.",
    23514: "La base a refusé ce rendez-vous : il ne respecte pas une de ses règles.",
    23502: "La base a refusé ce rendez-vous : une information obligatoire manque.",
    23503: "La base a refusé ce rendez-vous : il ne correspond à aucune heure du planning.",
    42501: "La base a refusé : ce compte n'a pas le droit de faire cela.",
    PGRST204: "La base ne connaît pas une des colonnes que l'application envoie : vérifiez leurs noms.",
    PGRST205: "La base ne connaît pas cette table : vérifiez son nom.",
    "42P01": "La base ne connaît pas cette table : vérifiez son nom.",
  };

  function refus(erreur) {
    const clair = REFUS[erreur.code];
    return new Error(clair ? `${clair} (${erreur.message})` : erreur.message);
  }

  function relier() {
    if (!base) throw new Error("Créneau n'est relié à aucune base : renseignez reglages.js.");
    return base;
  }

  // Dates

  function debutDuJour(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function ajouterJours(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function aHeure(jour, heure) {
    const d = new Date(jour);
    d.setHours(heure, 0, 0, 0);
    return d;
  }

  // Le compte : celui de Supabase. Sans compte, on regarde le planning ; avec, on réserve.

  async function compte() {
    const { data } = await relier().auth.getSession();
    return data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
  }

  // Rend vrai si le compte sert tout de suite, faux si l'adresse doit d'abord être confirmée.
  async function creerCompte(email, motDePasse) {
    const { data, error } = await relier().auth.signUp({ email, password: motDePasse });
    if (error) throw new Error(`Compte refusé. (${error.message})`);
    return Boolean(data.session);
  }

  async function connecter(email, motDePasse) {
    const { error } = await relier().auth.signInWithPassword({ email, password: motDePasse });
    if (error) throw new Error(`Connexion refusée. (${error.message})`);
  }

  async function deconnecter() {
    await relier().auth.signOut();
  }

  // Le planning

  function joursOuverts(maintenant = new Date()) {
    const jours = [];
    for (let i = 0; i < HORIZON_JOURS; i++) {
      const jour = debutDuJour(ajouterJours(maintenant, i));
      if (JOURS_OUVERTS.includes(jour.getDay())) jours.push(jour);
    }
    return jours;
  }

  // Les jours ouverts, chacun avec ses créneaux : pris (lu dans creneaux_pris) ou passé.
  async function planning(maintenant = new Date()) {
    const jours = joursOuverts(maintenant);
    const fin = ajouterJours(jours[jours.length - 1], 1);
    const { data, error } = await relier()
      .from("creneaux_pris")
      .select("debut")
      .gte("debut", jours[0].toISOString())
      .lt("debut", fin.toISOString());
    if (error) throw refus(error);
    const pris = new Set(data.map((c) => new Date(c.debut).getTime()));
    return jours.map((jour) => ({
      jour,
      creneaux: HEURES.map((heure) => {
        const debut = aHeure(jour, heure);
        return { debut, pris: pris.has(debut.getTime()), passe: debut <= maintenant };
      }),
    }));
  }

  // Réserver : l'heure au planning d'abord, puis le rendez-vous au carnet.

  async function reserver({ debut, nom, telephone, motif, precision = "" }) {
    const moi = await compte();
    if (!moi) throw new Error("Connectez-vous ou créez un compte pour réserver.");
    nom = (nom || "").trim();
    telephone = (telephone || "").trim();
    if (!nom || !telephone) {
      throw new Error("Le nom et le téléphone sont obligatoires.");
    }
    if (!MOTIFS.includes(motif)) {
      throw new Error("Choisissez un motif.");
    }
    const heure = debut.toISOString();
    // 1. L'heure au planning. Si elle y est déjà, la base refuse, et rien d'autre n'est écrit.
    const planningRefuse = (await relier().from("creneaux_pris").insert({ debut: heure, client_id: moi.id })).error;
    if (planningRefuse) throw refus(planningRefuse);
    // 2. Le rendez-vous au carnet. Si la base le refuse, on libère l'heure.
    const carnetRefuse = (
      await relier().from("rendez_vous").insert({
        debut: heure,
        client_id: moi.id,
        nom,
        telephone,
        motif,
        precision: precision.trim(),
      })
    ).error;
    if (carnetRefuse) {
      await relier().from("creneaux_pris").delete().eq("debut", heure);
      throw refus(carnetRefuse);
    }
    return { debut, nom, telephone, motif };
  }

  // Mes rendez-vous : ce que la base rend à la personne connectée, à venir, du plus proche au plus lointain.
  async function mesRendezVous(maintenant = new Date()) {
    const moi = await compte();
    const { data, error } = await relier()
      .from("rendez_vous")
      .select("debut, client_id, nom, telephone, motif, precision")
      .gte("debut", maintenant.toISOString())
      .order("debut");
    if (error) throw refus(error);
    return data.map((r) => ({ ...r, debut: new Date(r.debut), mien: Boolean(moi) && r.client_id === moi.id }));
  }

  // Annuler : le rendez-vous d'abord, puis l'heure. La base ne supprime que ce qu'elle autorise.
  async function annuler(rdv) {
    const heure = rdv.debut.toISOString();
    const carnet = await relier().from("rendez_vous").delete().eq("debut", heure).select();
    if (carnet.error) throw refus(carnet.error);
    if (carnet.data.length === 0) {
      throw new Error("La base n'a rien annulé : ce rendez-vous n'est pas le vôtre, ou il n'existe plus.");
    }
    const planning = await relier().from("creneaux_pris").delete().eq("debut", heure).select();
    if (planning.error) throw refus(planning.error);
    if (planning.data.length === 0) {
      throw new Error("Le rendez-vous est annulé, mais l'heure reste marquée prise : la base a refusé de la libérer du planning.");
    }
  }

  return {
    SALON,
    MOTIFS,
    HEURES,
    planning,
    compte,
    creerCompte,
    connecter,
    deconnecter,
    reserver,
    mesRendezVous,
    annuler,
  };
})();
