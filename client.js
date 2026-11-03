// Créneau : l'affichage et les interactions de l'application.

const $ = (id) => document.getElementById(id);
let creneauChoisi = null;
let moi = null;

function libelleJour(date) {
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function libelleCreneau(date) {
  const fin = new Date(date);
  fin.setHours(fin.getHours() + 1);
  return `${libelleJour(date)}, de ${date.getHours()} h à ${fin.getHours()} h`;
}

function afficherMessage(texte) {
  $("message").textContent = texte;
  $("message").hidden = !texte;
}

// Le compte

async function afficherCompte() {
  try {
    moi = await CRENEAU.compte();
  } catch (erreur) {
    moi = null;
  }
  $("sans-compte").hidden = Boolean(moi);
  $("form-compte").hidden = Boolean(moi);
  $("connecte").hidden = !moi;
  $("connecte-email").textContent = moi ? `Connecté : ${moi.email}` : "";
  $("mes-rdv").hidden = !moi;
  if (moi) await afficherMesRendezVous();
}

$("form-compte").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await CRENEAU.connecter($("email").value.trim(), $("mot-de-passe").value);
    e.target.reset();
    afficherMessage("");
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
  await afficherCompte();
});

$("creer-compte").addEventListener("click", async () => {
  try {
    const utilisable = await CRENEAU.creerCompte($("email").value.trim(), $("mot-de-passe").value);
    $("form-compte").reset();
    afficherMessage(
      utilisable
        ? "Compte créé : vous êtes connecté."
        : "Compte créé. Confirmez votre adresse depuis l'e-mail reçu, puis connectez-vous."
    );
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
  await afficherCompte();
});

$("deconnecter").addEventListener("click", async () => {
  await CRENEAU.deconnecter();
  afficherMessage("");
  await revenirAuChoix();
  await afficherCompte();
});

// Le planning

async function afficherJours() {
  const conteneur = $("jours");
  conteneur.innerHTML = "";
  let jours;
  try {
    jours = await CRENEAU.planning();
  } catch (erreur) {
    afficherMessage(`Impossible de lire les créneaux pris. ${erreur.message}`);
    return;
  }
  for (const { jour, creneaux } of jours) {
    const bloc = document.createElement("div");
    bloc.className = "jour";
    const titre = document.createElement("h3");
    titre.textContent = libelleJour(jour);
    bloc.append(titre);
    for (const creneau of creneaux) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "creneau";
      bouton.textContent = `${creneau.debut.getHours()} h`;
      bouton.disabled = creneau.pris || creneau.passe;
      bouton.addEventListener("click", () => choisir(creneau));
      bloc.append(bouton);
    }
    conteneur.append(bloc);
  }
}

function choisir(creneau) {
  if (!moi) {
    afficherMessage("Connectez-vous ou créez un compte pour réserver ce créneau.");
    $("email").focus();
    return;
  }
  creneauChoisi = creneau;
  afficherMessage("");
  $("creneau-choisi").textContent = libelleCreneau(creneau.debut);
  $("choix").hidden = true;
  $("formulaire").hidden = false;
  $("nom").focus();
}

async function revenirAuChoix() {
  creneauChoisi = null;
  $("formulaire").hidden = true;
  $("choix").hidden = false;
  await afficherJours();
}

$("form-reservation").addEventListener("submit", async (e) => {
  e.preventDefault();
  const donnees = Object.fromEntries(new FormData(e.target));
  try {
    const rdv = await CRENEAU.reserver({ ...donnees, debut: creneauChoisi.debut });
    e.target.reset();
    await revenirAuChoix();
    afficherMessage(`Rendez-vous confirmé : ${libelleCreneau(rdv.debut)}.`);
    await afficherMesRendezVous();
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
});

$("changer").addEventListener("click", revenirAuChoix);

// Mes rendez-vous : la liste que la base rend à la personne connectée.

async function afficherMesRendezVous() {
  const liste = $("liste-mes-rdv");
  liste.innerHTML = "";
  let rdv;
  try {
    rdv = await CRENEAU.mesRendezVous();
  } catch (erreur) {
    const ligne = document.createElement("li");
    ligne.textContent = `Impossible de lire les rendez-vous. ${erreur.message}`;
    liste.append(ligne);
    return;
  }
  if (rdv.length === 0) {
    const vide = document.createElement("li");
    vide.textContent = "Aucun rendez-vous à venir.";
    liste.append(vide);
    return;
  }
  for (const r of rdv) {
    const ligne = document.createElement("li");
    const precision = r.precision ? ` (${r.precision})` : "";
    ligne.textContent = `${libelleCreneau(r.debut)} - ${r.motif} - ${r.nom}, ${r.telephone}${precision} `;
    if (r.mien) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.textContent = "Annuler";
      bouton.addEventListener("click", async () => {
        try {
          await CRENEAU.annuler(r);
          afficherMessage("Rendez-vous annulé.");
        } catch (erreur) {
          afficherMessage(erreur.message);
        }
        await afficherJours();
        await afficherMesRendezVous();
      });
      ligne.append(bouton);
    }
    liste.append(ligne);
  }
}

$("salon-nom").textContent = CRENEAU.SALON.nom;
$("salon-metier").textContent = `${CRENEAU.SALON.metier} - ${CRENEAU.SALON.ville}`;
for (const motif of CRENEAU.MOTIFS) {
  const option = document.createElement("option");
  option.textContent = motif;
  $("motif").append(option);
}
afficherCompte().then(afficherJours);
