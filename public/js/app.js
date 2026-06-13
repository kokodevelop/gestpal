/* GESTPAL — application frontend (SPA légère, hash routing) */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const contenu = $('#contenu');
let utilisateur = null;
let poidsBascule = { poids: 0, stable: false, recu_le: null };
const REF_CACHE = {};

// ---------- Utilitaires ----------
const fmtKg = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString('fr-FR');
const fmtDate = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 3500);
}

async function api(url, options = {}) {
  if (options.body && typeof options.body !== 'string') {
    options.body = JSON.stringify(options.body);
    options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  }
  const res = await fetch(url, options);
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Session expirée'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

async function chargerRef(table, force = false) {
  if (!REF_CACHE[table] || force) REF_CACHE[table] = await api('/api/ref/' + table);
  return REF_CACHE[table];
}

function optionsRef(liste, valeur, vide = '— choisir —') {
  return `<option value="">${vide}</option>` + liste
    .filter((r) => r.actif)
    .map((r) => `<option value="${r.id}" ${String(valeur) === String(r.id) ? 'selected' : ''}>${esc(r.code)} - ${esc(r.libelle)}</option>`)
    .join('');
}

// ---------- Bascule temps réel ----------
const socket = io();
socket.on('poids', (p) => {
  poidsBascule = p;
  majAffichagePoids();
});

function majAffichagePoids() {
  const badge = $('#badgePoids');
  if (badge) {
    badge.textContent = fmtKg(poidsBascule.poids) + ' kg';
    badge.style.color = poidsBascule.stable ? '#6cf16c' : '#f1c40f';
  }
  const aff = $('#afficheurValeur');
  if (aff) {
    aff.textContent = fmtKg(poidsBascule.poids);
    aff.classList.toggle('instable', !poidsBascule.stable);
    const etat = $('#afficheurEtat');
    if (etat) {
      etat.textContent = poidsBascule.recu_le
        ? (poidsBascule.stable ? 'STABLE' : 'EN MOUVEMENT') + ' — reçu à ' + new Date(poidsBascule.recu_le).toLocaleTimeString('fr-FR')
        : 'Aucune donnée bascule — saisie manuelle possible';
    }
  }
}

const blocAfficheur = () => `
  <div class="afficheur">
    <div class="valeur" id="afficheurValeur">${fmtKg(poidsBascule.poids)}</div>
    <div class="etat" id="afficheurEtat">kg</div>
  </div>`;

// ---------- Routage ----------
const routes = {
  pesees: vuePesees,
  nouvelle: vueNouvellePesee,
  referentiels: vueReferentiels,
  rapports: vueRapports,
  utilisateurs: vueUtilisateurs,
  bascule: vueConfigBascule,
  parametres: vueParametres
};

async function router() {
  const hash = location.hash.replace('#', '') || 'pesees';
  const [route, param] = hash.split('/');
  document.querySelectorAll('.nav-lien').forEach((a) => a.classList.toggle('actif', a.getAttribute('href') === '#' + route));
  contenu.innerHTML = '<div class="vide">Chargement…</div>';
  try {
    if (route === 'pesee' && param) await vuePeseeDetail(param);
    else if (routes[route]) await routes[route]();
    else await vuePesees();
  } catch (err) {
    contenu.innerHTML = `<div class="carte"><div class="message-erreur">${esc(err.message)}</div></div>`;
  }
}
window.addEventListener('hashchange', router);

// ---------- Vue : liste des pesées ----------
async function vuePesees() {
  const params = new URLSearchParams();
  const statut = sessionStorage.getItem('filtreStatut') || '';
  if (statut) params.set('statut', statut);
  const pesees = await api('/api/pesees?' + params);

  contenu.innerHTML = `
    <div class="carte">
      <h2>Pesées</h2>
      <div class="barre-actions">
        <select id="filtreStatut" style="width:auto">
          <option value="">Tous les statuts</option>
          <option value="EN_COURS">En cours</option>
          <option value="INTERROMPUE">Interrompues</option>
          <option value="TERMINEE">Terminées</option>
          <option value="ANNULEE">Annulées</option>
        </select>
        <a class="btn btn-primaire" href="#nouvelle">➕ Nouvelle pesée</a>
      </div>
      <table class="liste">
        <thead><tr>
          <th>Ticket</th><th>Lot</th><th>Produit</th><th>Site</th><th>Début</th>
          <th class="num">Palettes pesées</th><th class="num">Cumul brut (kg)</th><th>Statut</th><th></th>
        </tr></thead>
        <tbody>
          ${pesees.map((p) => `
            <tr>
              <td><b>${esc(p.numero_ticket)}</b></td>
              <td>${esc(p.numero_lot)}</td>
              <td>${esc(p.produit)}</td>
              <td>${esc(p.site)}</td>
              <td>${fmtDate(p.date_debut)}</td>
              <td class="num">${fmtInt(p.nb_lignes)}</td>
              <td class="num">${fmtKg(p.cumul_brut)}</td>
              <td><span class="statut ${p.statut}">${p.statut.replace('_', ' ')}</span></td>
              <td class="actions-liste">
                ${p.statut === 'EN_COURS' || p.statut === 'INTERROMPUE'
                  ? `<a class="btn btn-petit btn-vert" href="#pesee/${p.id}">${p.statut === 'INTERROMPUE' ? '▶ Reprendre' : '⚖ Continuer'}</a>`
                  : ''}
                <a class="btn btn-petit" href="/ticket/${p.id}" target="_blank" title="Ouvrir le ticket (imprimable / PDF)">🖨 Imprimer</a>
              </td>
            </tr>`).join('') || '<tr><td colspan="9" class="vide">Aucune pesée</td></tr>'}
        </tbody>
      </table>
    </div>`;

  $('#filtreStatut').value = statut;
  $('#filtreStatut').addEventListener('change', (e) => {
    sessionStorage.setItem('filtreStatut', e.target.value);
    vuePesees();
  });
}

// Résout un texte saisi libre en ID de référentiel, ou crée l'entrée si elle n'existe pas encore.
async function resoudreOuCreerRef(table, valeur, refs) {
  if (!valeur || !valeur.trim()) return null;
  const v = valeur.trim();
  // Correspond à "CODE — Libellé" (format datalist), code exact, ou libellé exact (insensible casse)
  const trouve = refs.find(
    (x) => v === `${x.code} — ${x.libelle}` ||
            v.toLowerCase() === x.code.toLowerCase() ||
            v.toLowerCase() === x.libelle.toLowerCase()
  );
  if (trouve) return trouve.id;
  // Nouveau → génère un code et crée automatiquement
  const codeBase = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18) || 'REF';
  for (let i = 0; i <= 9; i++) {
    try {
      const code = i === 0 ? codeBase : `${codeBase}${i}`;
      const res = await api(`/api/ref/${table}`, { method: 'POST', body: { code, libelle: v } });
      REF_CACHE[table] = null;
      return res.id;
    } catch (err) {
      if (err.message && err.message.includes('existe déjà')) continue;
      throw err;
    }
  }
  throw new Error(`Impossible de créer "${v}" automatiquement dans ${table}`);
}

// ---------- Vue : nouvelle pesée (étape 1 : infos + tare palettes) ----------
async function vueNouvellePesee() {
  const [produits, emballages, clients, fournisseurs, transporteurs, vehicules, chauffeurs, sites, quarts] =
    await Promise.all(['produits', 'emballages', 'clients', 'fournisseurs', 'transporteurs', 'vehicules', 'chauffeurs', 'sites', 'quarts'].map((t) => chargerRef(t, true)));

  const annee = new Date().getFullYear();
  contenu.innerHTML = `
    <div class="carte">
      <h2>Nouvelle pesée — initialisation</h2>
      <p>1) Posez <b>toutes les palettes vides</b> sur la bascule, capturez la <b>tare palettes</b>. 2) Renseignez les informations. 3) Créez la pesée.</p>
      <div class="ecran-pesee">
        <div>
          ${blocAfficheur()}
          <div class="totaux-pesee">
            <label class="tuile">Tare palettes (kg) *
              <input type="number" step="0.01" min="0" id="tarePalettes" placeholder="0.00" readonly class="input-bascule">
            </label>
            <label class="tuile">Nombre de palettes
              <input type="number" step="1" min="0" id="nbPalettes" placeholder="0">
            </label>
            <label class="tuile">Maximum de sacs
              <input type="number" step="1" min="0" id="maxSacs" placeholder="0 = illimité">
            </label>
          </div>
          <div class="barre-actions">
            <button class="btn btn-orange btn-large" id="btnCapturerTare">📥 Capturer le poids de la bascule</button>
            <button class="btn" type="button" id="btnPresetCacao" title="11 palettes · 385 sacs max">📦 Preset Export Cacao</button>
          </div>
        </div>
        <form id="formPesee" class="grille-form">
          <label>Produit *<select id="produit_id" required>${optionsRef(produits)}</select></label>
          <label>Emballage *<select id="emballage_id" required>${optionsRef(emballages)}</select></label>
          <label>Site de pesée *<select id="site_id" required>${optionsRef(sites)}</select></label>
          <label>Quart<select id="quart_id">${optionsRef(quarts)}</select></label>
          <label>Client
            <input id="client_txt" list="list-clients" placeholder="Tapez pour chercher ou créer…" autocomplete="off">
            <datalist id="list-clients">${clients.filter((r) => r.actif).map((r) => `<option value="${esc(r.code + ' — ' + r.libelle)}">`).join('')}</datalist>
          </label>
          <label>Fournisseur
            <input id="fournisseur_txt" list="list-fournisseurs" placeholder="Tapez pour chercher ou créer…" autocomplete="off">
            <datalist id="list-fournisseurs">${fournisseurs.filter((r) => r.actif).map((r) => `<option value="${esc(r.code + ' — ' + r.libelle)}">`).join('')}</datalist>
          </label>
          <label>Transporteur
            <input id="transporteur_txt" list="list-transporteurs" placeholder="Tapez pour chercher ou créer…" autocomplete="off">
            <datalist id="list-transporteurs">${transporteurs.filter((r) => r.actif).map((r) => `<option value="${esc(r.code + ' — ' + r.libelle)}">`).join('')}</datalist>
          </label>
          <label>Mouvement
            <select id="mouvement">
              <option>1 - STOCKAGE</option>
              <option>2 - DESTOCKAGE</option>
              <option>3 - TRANSFERT</option>
            </select>
          </label>
          <label>Véhicule
            <input id="vehicule" list="listeVehicules"><datalist id="listeVehicules">${vehicules.map((v) => `<option value="${esc(v.code)}">`).join('')}</datalist>
          </label>
          <label>Remorque<input id="remorque"></label>
          <label>Chauffeur
            <input id="chauffeur" list="listeChauffeurs"><datalist id="listeChauffeurs">${chauffeurs.map((c) => `<option value="${esc(c.libelle)}">`).join('')}</datalist>
          </label>
          <label>Campagne<input id="campagne" value="${annee}-${annee + 1}"></label>
          <label>N° lot (vide = auto)<input id="numero_lot" placeholder="auto"></label>
          <label>N° bordereau (vide = auto)<input id="numero_bordereau" placeholder="auto"></label>
          <label>Provenance<input id="provenance"></label>
          <label>Destination<input id="destination"></label>
          <label>Nature produit<input id="nature_produit"></label>
          <label>N° livraison<input id="n_livraison"></label>
          <div style="grid-column:1/-1">
            <button type="submit" class="btn btn-primaire btn-large">✅ Créer la pesée et commencer</button>
          </div>
        </form>
      </div>
    </div>`;

  majAffichagePoids();
  $('#btnCapturerTare').addEventListener('click', (e) => {
    e.preventDefault();
    $('#tarePalettes').value = Number(poidsBascule.poids).toFixed(2);
  });

  $('#btnPresetCacao').addEventListener('click', () => {
    $('#nbPalettes').value = 10;
    $('#maxSacs').value = 385;
    toast('Preset Export Cacao appliqué : 10 palettes · 385 sacs (9×40 + 1×25)', '');
  });

  // La nature produit suit le produit choisi
  $('#produit_id').addEventListener('change', () => {
    const p = produits.find((x) => String(x.id) === $('#produit_id').value);
    if (p) $('#nature_produit').value = p.nature || '';
  });

  $('#formPesee').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = {};
      ['produit_id','emballage_id','site_id','quart_id','mouvement',
       'vehicule','remorque','chauffeur','campagne','numero_lot','numero_bordereau','provenance','destination',
       'nature_produit','n_livraison'].forEach((id) => (body[id] = $('#' + id).value));
      body.tare_palettes = $('#tarePalettes').value;
      body.nb_palettes = $('#nbPalettes').value;
      body.max_sacs = $('#maxSacs').value;
      // Résoudre ou créer à la volée
      [body.client_id, body.fournisseur_id, body.transporteur_id] = await Promise.all([
        resoudreOuCreerRef('clients',       $('#client_txt').value,       clients),
        resoudreOuCreerRef('fournisseurs',  $('#fournisseur_txt').value,  fournisseurs),
        resoudreOuCreerRef('transporteurs', $('#transporteur_txt').value, transporteurs),
      ]);
      const r = await api('/api/pesees', { method: 'POST', body });
      // Enregistrer chauffeur et véhicule dans les référentiels si nouveaux (arrière-plan)
      const vehVal = body.vehicule.trim();
      if (vehVal && !vehicules.find((v) => v.code.toLowerCase() === vehVal.toLowerCase())) {
        const codeV = vehVal.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || vehVal.slice(0, 20);
        api('/api/ref/vehicules',  { method: 'POST', body: { code: codeV, libelle: vehVal } }).catch(() => {});
      }
      const chfVal = body.chauffeur.trim();
      if (chfVal && !chauffeurs.find((c) => c.libelle.toLowerCase() === chfVal.toLowerCase())) {
        const codeC = chfVal.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18) || 'CHF';
        api('/api/ref/chauffeurs', { method: 'POST', body: { code: codeC, libelle: chfVal } }).catch(() => {});
      }
      toast(`Pesée ${r.numero_ticket} créée (lot ${r.numero_lot})`, 'succes');
      location.hash = '#pesee/' + r.id;
    } catch (err) { toast(err.message, 'erreur'); }
  });
}

// ---------- Vue : pesée en cours (étape 2 : palettes successives) ----------
async function vuePeseeDetail(id) {
  const p = await api('/api/pesees/' + id);
  const enCours = p.statut === 'EN_COURS';
  const modifiable = enCours || p.statut === 'INTERROMPUE';
  const PRESET_CACAO = p.nb_palettes === 10 && p.max_sacs === 385;
  const SACS_STD = 40;
  const SACS_DERNIERE = 25;

  contenu.innerHTML = `
    <div class="carte">
      <h2>Pesée ${esc(p.numero_ticket)} — lot ${esc(p.numero_lot)}
        <span class="statut ${p.statut}">${p.statut.replace('_', ' ')}</span>
      </h2>
      <p>
        <b>${esc(p.produit_code)} - ${esc(p.produit_libelle)}</b> · ${esc(p.emballage_libelle)} (${fmtKg(p.poids_unitaire_emb)} kg/sac)
        · Site : ${esc(p.site_libelle)} · Tare palettes : <b>${fmtKg(p.tare_palettes)} kg</b> (${fmtInt(p.nb_palettes)} palettes)
      </p>

      <div class="ecran-pesee">
        <div>
          ${blocAfficheur()}
          <div class="totaux-pesee" style="grid-template-columns:1fr 1fr">
            <label class="tuile">Poids brut palette (kg) *
              <input type="number" step="0.01" min="0" id="poidsBrut" ${enCours ? 'readonly class="input-bascule"' : 'disabled'}>
            </label>
            ${PRESET_CACAO
              ? `<div class="tuile"><div class="lab">SACS PROPOSÉS</div><div class="val" id="sacsProposes" style="color:var(--bleu)">—</div></div>`
              : `<label class="tuile">Nombre de sacs *
                   <input type="number" step="1" min="1" id="nbEmb" ${enCours ? '' : 'disabled'}>
                 </label>`}
          </div>
          ${enCours && (p.nb_palettes > 0 || p.max_sacs > 0) ? (() => {
            const palRest = p.nb_palettes > 0 ? p.nb_palettes - p.totaux.nb_lignes : null;
            const sacRest = p.max_sacs > 0 ? p.max_sacs - Number(p.totaux.nb_total_emb) : null;
            const items = [];
            if (palRest !== null) items.push(`${palRest} palette(s) restante(s)`);
            if (sacRest !== null) items.push(`${sacRest} sac(s) restant(s) sur ${p.max_sacs}`);
            const cls = (palRest === 0 || sacRest === 0) ? 'quota-info quota-complet' : 'quota-info';
            return `<p class="${cls}">📦 ${items.join(' · ')}</p>`;
          })() : ''}
          <div class="barre-actions">
            <button class="btn btn-orange" id="btnLireBascule" ${enCours ? '' : 'disabled'}>📥 Lire la bascule</button>
            <button class="btn btn-vert btn-large" id="btnAjouterLigne" style="flex:1" ${enCours ? '' : 'disabled'}>✅ Enregistrer la palette</button>
          </div>
          <div class="barre-actions">
            ${enCours ? `<button class="btn" id="btnInterrompre">⏸ Interrompre</button>` : ''}
            ${p.statut === 'INTERROMPUE' ? `<button class="btn btn-vert" id="btnReprendre">▶ Reprendre la pesée</button>` : ''}
            ${modifiable ? `
              <button class="btn btn-primaire" id="btnCloturer">🏁 Clôturer &amp; imprimer</button>
              <button class="btn btn-rouge" id="btnAnnuler">✖ Annuler la pesée</button>` : ''}
            ${p.statut === 'TERMINEE' ? `<a class="btn btn-primaire" href="/ticket/${p.id}" target="_blank">🖨 Imprimer le ticket</a>` : ''}
            <a class="btn" href="/ticket/${p.id}" target="_blank">👁 Aperçu ticket</a>
          </div>
        </div>

        <div>
          <div class="totaux-pesee">
            <div class="tuile${p.nb_palettes > 0 && p.totaux.nb_lignes >= p.nb_palettes ? ' tuile-alerte' : ''}"><div class="lab">PALETTES PESÉES</div><div class="val" id="totLignes">${fmtInt(p.totaux.nb_lignes)}${p.nb_palettes > 0 ? ' / ' + fmtInt(p.nb_palettes) : ''}</div></div>
            <div class="tuile${p.max_sacs > 0 && p.totaux.nb_total_emb >= p.max_sacs ? ' tuile-alerte' : ''}"><div class="lab">NBRE TOTAL SACS</div><div class="val" id="totEmb">${fmtInt(p.totaux.nb_total_emb)}${p.max_sacs > 0 ? ' / ' + fmtInt(p.max_sacs) : ''}</div></div>
            <div class="tuile"><div class="lab">CUMUL BRUT (KG)</div><div class="val" id="totBrut">${fmtKg(p.totaux.cumul_brut)}</div></div>
            <div class="tuile"><div class="lab">CUMUL TARE EMB. (KG)</div><div class="val" id="totTare">${fmtKg(p.totaux.cumul_tare_totale)}</div></div>
            <div class="tuile net" style="grid-column:1/-1"><div class="lab">POIDS NET SANS EMBALLAGE (KG)</div><div class="val" id="totNet">${fmtKg(p.totaux.poids_net_sans_emb)}</div></div>
          </div>
          <table class="liste" style="margin-top:14px">
            <thead><tr><th>Ordre</th><th class="num">Poids brut</th><th class="num">Nb sacs</th><th class="num">Tare emb.</th><th class="num">Poids net</th><th>Heure</th><th></th></tr></thead>
            <tbody id="corpsLignes">${lignesHtml(p)}</tbody>
          </table>
        </div>
      </div>
    </div>

    ${PRESET_CACAO && enCours ? `
    <div id="dlgCacao" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);align-items:center;justify-content:center;z-index:200">
      <div class="modal-boite" style="max-width:440px">
        <h3 id="dlgTitre" style="color:var(--bleu)"></h3>
        <p id="dlgDesc" style="font-size:14px;margin:8px 0 14px"></p>
        <div id="dlgSaisie" style="display:none;margin-bottom:12px">
          <label style="font-size:13px;font-weight:600">Nombre réel de sacs (queue de lot) :
            <input type="number" id="nbSacsReel" min="1" step="1" style="width:100%;margin-top:4px;font-size:18px;font-weight:700">
          </label>
        </div>
        <div class="barre-actions" style="justify-content:flex-end">
          <button class="btn" type="button" id="dlgAnnuler">✖ Annuler</button>
          <button class="btn btn-orange" type="button" id="dlgSaisirReel">✏ Saisir le nombre réel</button>
          <button class="btn btn-vert" type="button" id="dlgConfirmer"></button>
        </div>
      </div>
    </div>` : ''}`;

  majAffichagePoids();

  function lignesHtml(p) {
    const modif = p.statut === 'EN_COURS' || p.statut === 'INTERROMPUE';
    return p.lignes.map((l) => `
      <tr${l.queue_lot ? ' class="ligne-queue-lot"' : ''}>
        <td>${l.ordre}${l.queue_lot ? ' <span class="badge-ql" title="Queue de lot">QL</span>' : ''}</td>
        <td class="num">${fmtKg(l.poids_brut)}</td>
        <td class="num">${fmtInt(l.nb_emb)}</td>
        <td class="num">${fmtKg(l.tare_emb)}</td>
        <td class="num">${fmtKg(l.poids_net)}</td>
        <td>${l.pese_le ? new Date(l.pese_le).toLocaleTimeString('fr-FR') : ''}</td>
        <td>${modif ? `<button class="btn btn-petit btn-rouge" data-suppr="${l.id}" title="Supprimer cette ligne">✖</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="vide">Aucune palette pesée pour l\'instant</td></tr>';
  }

  const recharger = () => vuePeseeDetail(id);

  // Met à jour la tuile "sacs proposés" (mode Cacao uniquement)
  function majSacsProposes() {
    const tuile = $('#sacsProposes');
    if (!tuile) return;
    const numPalette = p.totaux.nb_lignes + 1;
    const sacs = numPalette <= 9 ? SACS_STD : SACS_DERNIERE;
    tuile.textContent = `${sacs} sacs${numPalette === 10 ? ' (dernière)' : ''}`;
  }
  majSacsProposes();

  async function soumettreLigne(poids_brut, nb_emb, queue_lot = 0) {
    const r = await api(`/api/pesees/${id}/lignes`, { method: 'POST', body: { poids_brut, nb_emb, queue_lot } });
    toast(`Palette n°${r.ordre} enregistrée${queue_lot ? ' — Queue de lot' : ''} : net ${fmtKg(r.poids_net)} kg`, 'succes');
    recharger();
  }

  $('#btnLireBascule')?.addEventListener('click', () => {
    $('#poidsBrut').value = Number(poidsBascule.poids).toFixed(2);
    if (!PRESET_CACAO) $('#nbEmb')?.focus();
  });

  $('#btnAjouterLigne')?.addEventListener('click', () => {
    const poids_brut = Number($('#poidsBrut').value);
    if (!poids_brut || poids_brut <= 0) { toast('Capturez le poids de la bascule d\'abord', 'erreur'); return; }

    if (PRESET_CACAO) {
      const numPalette = p.totaux.nb_lignes + 1;
      const sacsProposes = numPalette <= 9 ? SACS_STD : SACS_DERNIERE;
      const dlg = $('#dlgCacao');
      dlg.dataset.poids = poids_brut;
      dlg.dataset.sacs  = sacsProposes;
      $('#dlgTitre').textContent = `Palette N°${numPalette} / 10${numPalette === 10 ? ' — Dernière palette' : ''}`;
      $('#dlgDesc').textContent  = `Confirmez-vous ${sacsProposes} sacs pour cette palette ?`;
      $('#dlgSaisie').style.display = 'none';
      $('#dlgSaisirReel').style.display = '';
      $('#dlgConfirmer').textContent = `✅ Confirmer ${sacsProposes} sacs`;
      $('#dlgConfirmer').dataset.phase = '1';
      $('#nbSacsReel').value = '';
      dlg.style.display = 'flex';
    } else {
      const nb_emb = Number($('#nbEmb').value);
      soumettreLigne(poids_brut, nb_emb).catch((err) => toast(err.message, 'erreur'));
    }
  });

  // Handlers dialogue cacao
  if (PRESET_CACAO && enCours) {
    const dlg = $('#dlgCacao');
    const fermerDlg = () => { dlg.style.display = 'none'; };

    $('#dlgAnnuler').addEventListener('click', fermerDlg);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) fermerDlg(); });

    $('#dlgSaisirReel').addEventListener('click', () => {
      $('#dlgDesc').textContent = 'Saisissez le nombre réel de sacs. Cette palette sera enregistrée comme queue de lot.';
      $('#dlgSaisie').style.display = '';
      $('#dlgSaisirReel').style.display = 'none';
      $('#dlgConfirmer').textContent = '✅ Enregistrer (queue de lot)';
      $('#dlgConfirmer').dataset.phase = '2';
      $('#nbSacsReel').focus();
    });

    $('#dlgConfirmer').addEventListener('click', async () => {
      const poids_brut = Number(dlg.dataset.poids);
      const phase = $('#dlgConfirmer').dataset.phase;
      try {
        if (phase === '1') {
          const nb_emb = Number(dlg.dataset.sacs);
          fermerDlg();
          await soumettreLigne(poids_brut, nb_emb, 0);
        } else {
          const nb_emb = Number($('#nbSacsReel').value);
          if (!Number.isInteger(nb_emb) || nb_emb <= 0) { toast('Nombre de sacs invalide', 'erreur'); return; }
          fermerDlg();
          await soumettreLigne(poids_brut, nb_emb, 1);
        }
      } catch (err) { toast(err.message, 'erreur'); }
    });
  }

  contenu.querySelectorAll('[data-suppr]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Supprimer cette ligne de pesée ?')) return;
      try { await api(`/api/pesees/${id}/lignes/${b.dataset.suppr}`, { method: 'DELETE' }); recharger(); }
      catch (err) { toast(err.message, 'erreur'); }
    })
  );

  $('#btnInterrompre')?.addEventListener('click', async () => {
    try { await api(`/api/pesees/${id}/interrompre`, { method: 'POST' }); toast('Pesée interrompue — vous pourrez la reprendre', 'succes'); location.hash = '#pesees'; }
    catch (err) { toast(err.message, 'erreur'); }
  });

  $('#btnReprendre')?.addEventListener('click', async () => {
    try { await api(`/api/pesees/${id}/reprendre`, { method: 'POST' }); recharger(); }
    catch (err) { toast(err.message, 'erreur'); }
  });

  $('#btnCloturer')?.addEventListener('click', async () => {
    if (!confirm('Clôturer la pesée ? Plus aucune modification ne sera possible.')) return;
    try {
      await api(`/api/pesees/${id}/cloturer`, { method: 'POST' });
      toast('Pesée clôturée', 'succes');
      window.open('/ticket/' + id, '_blank');
      recharger();
    } catch (err) { toast(err.message, 'erreur'); }
  });

  $('#btnAnnuler')?.addEventListener('click', async () => {
    if (!confirm('Annuler définitivement cette pesée ?')) return;
    try { await api(`/api/pesees/${id}/annuler`, { method: 'POST' }); location.hash = '#pesees'; }
    catch (err) { toast(err.message, 'erreur'); }
  });
}

// ---------- Vue : référentiels ----------
const REF_DEFS = {
  produits: { titre: 'Produits', cols: [['code', 'Code'], ['libelle', 'Libellé'], ['nature', 'Nature']] },
  emballages: { titre: 'Emballages', cols: [['code', 'Code'], ['libelle', 'Libellé'], ['poids_unitaire', 'Poids unitaire (kg)']] },
  clients: { titre: 'Clients', cols: [['code', 'Code'], ['libelle', 'Libellé']] },
  fournisseurs: { titre: 'Fournisseurs', cols: [['code', 'Code'], ['libelle', 'Libellé']] },
  transporteurs: { titre: 'Transporteurs', cols: [['code', 'Code'], ['libelle', 'Libellé']] },
  vehicules: { titre: 'Véhicules', cols: [['code', 'Immatriculation'], ['libelle', 'Description']] },
  chauffeurs: { titre: 'Chauffeurs', cols: [['code', 'Code'], ['libelle', 'Nom']] },
  sites: { titre: 'Sites de pesée', cols: [['code', 'Code'], ['libelle', 'Libellé']] },
  quarts: { titre: 'Quarts / équipes', cols: [['code', 'Code'], ['libelle', 'Libellé']] }
};

async function vueReferentiels() {
  const tableActive = sessionStorage.getItem('refTable') || 'produits';
  const def = REF_DEFS[tableActive];
  const rows = await chargerRef(tableActive, true);

  contenu.innerHTML = `
    <div class="carte">
      <h2>Référentiels</h2>
      <div class="onglets">
        ${Object.entries(REF_DEFS).map(([t, d]) => `<button class="onglet ${t === tableActive ? 'actif' : ''}" data-table="${t}">${d.titre}</button>`).join('')}
      </div>
      <form id="formRef" class="barre-actions">
        ${def.cols.map(([c, lab]) => `<input id="ref_${c}" placeholder="${lab}" ${c === 'poids_unitaire' ? 'type="number" step="0.001" min="0"' : ''} style="width:auto;flex:1" ${c === 'code' ? 'required' : ''}>`).join('')}
        <button class="btn btn-primaire" type="submit">➕ Ajouter</button>
      </form>
      <table class="liste">
        <thead><tr>${def.cols.map(([, lab]) => `<th>${lab}</th>`).join('')}<th>Actif</th><th></th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr data-id="${r.id}">
              ${def.cols.map(([c]) => `<td><input value="${esc(r[c])}" data-col="${c}" ${c === 'poids_unitaire' ? 'type="number" step="0.001"' : ''} style="border:none;background:transparent;width:100%"></td>`).join('')}
              <td><input type="checkbox" data-col="actif" ${r.actif ? 'checked' : ''} style="width:auto"></td>
              <td style="white-space:nowrap">
                <button class="btn btn-petit btn-vert" data-action="save" title="Enregistrer">💾</button>
                <button class="btn btn-petit btn-rouge" data-action="del" title="Supprimer">✖</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="${def.cols.length + 2}" class="vide">Aucun élément</td></tr>`}
        </tbody>
      </table>
    </div>`;

  contenu.querySelectorAll('.onglet').forEach((b) =>
    b.addEventListener('click', () => { sessionStorage.setItem('refTable', b.dataset.table); vueReferentiels(); })
  );

  $('#formRef').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = {};
      def.cols.forEach(([c]) => (body[c] = $('#ref_' + c).value));
      await api('/api/ref/' + tableActive, { method: 'POST', body });
      toast('Ajouté', 'succes');
      vueReferentiels();
    } catch (err) { toast(err.message, 'erreur'); }
  });

  contenu.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.querySelector('[data-action="save"]').addEventListener('click', async () => {
      try {
        const body = { actif: tr.querySelector('[data-col="actif"]').checked };
        def.cols.forEach(([c]) => (body[c] = tr.querySelector(`[data-col="${c}"]`).value));
        await api(`/api/ref/${tableActive}/${tr.dataset.id}`, { method: 'PUT', body });
        toast('Enregistré', 'succes');
      } catch (err) { toast(err.message, 'erreur'); }
    });
    tr.querySelector('[data-action="del"]').addEventListener('click', async () => {
      if (!confirm('Supprimer cet élément ?')) return;
      try { await api(`/api/ref/${tableActive}/${tr.dataset.id}`, { method: 'DELETE' }); vueReferentiels(); }
      catch (err) { toast(err.message, 'erreur'); }
    });
  });
}

// ---------- Vue : rapports ----------
async function vueRapports() {
  const [produits, clients, sites] = await Promise.all([chargerRef('produits'), chargerRef('clients'), chargerRef('sites')]);

  contenu.innerHTML = `
    <div class="carte">
      <h2>Rapports — historique des pesées</h2>
      <form id="formFiltres" class="barre-actions">
        <label style="margin:0">Du<input type="date" id="f_du" style="width:auto"></label>
        <label style="margin:0">Au<input type="date" id="f_au" style="width:auto"></label>
        <label style="margin:0">Produit<select id="f_produit" style="width:auto">${optionsRef(produits, '', 'Tous')}</select></label>
        <label style="margin:0">Client<select id="f_client" style="width:auto">${optionsRef(clients, '', 'Tous')}</select></label>
        <label style="margin:0">Site<select id="f_site" style="width:auto">${optionsRef(sites, '', 'Tous')}</select></label>
        <label style="margin:0">Statut
          <select id="f_statut" style="width:auto">
            <option value="">Tous</option><option value="TERMINEE">Terminées</option>
            <option value="EN_COURS">En cours</option><option value="INTERROMPUE">Interrompues</option>
          </select>
        </label>
        <button class="btn btn-primaire" type="submit">🔍 Rechercher</button>
        <button class="btn" type="button" id="btnCsv">⬇ Export CSV</button>
        <button class="btn" type="button" id="btnImprimer">🖨 Imprimer</button>
      </form>
      <div id="zoneResultats"><div class="vide">Choisissez vos filtres puis lancez la recherche</div></div>
    </div>`;

  const paramsFiltres = () => {
    const q = new URLSearchParams();
    if ($('#f_du').value) q.set('du', $('#f_du').value);
    if ($('#f_au').value) q.set('au', $('#f_au').value);
    if ($('#f_produit').value) q.set('produit_id', $('#f_produit').value);
    if ($('#f_client').value) q.set('client_id', $('#f_client').value);
    if ($('#f_site').value) q.set('site_id', $('#f_site').value);
    if ($('#f_statut').value) q.set('statut', $('#f_statut').value);
    return q;
  };

  $('#formFiltres').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = await api('/api/rapports/pesees?' + paramsFiltres());
    $('#zoneResultats').innerHTML = `
      <div class="totaux-pesee" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        <div class="tuile"><div class="lab">PESÉES</div><div class="val">${fmtInt(data.totaux.nb_pesees)}</div></div>
        <div class="tuile"><div class="lab">TOTAL SACS</div><div class="val">${fmtInt(data.totaux.nb_total_emb)}</div></div>
        <div class="tuile"><div class="lab">CUMUL BRUT (KG)</div><div class="val">${fmtKg(data.totaux.cumul_brut)}</div></div>
        <div class="tuile net"><div class="lab">POIDS NET (KG)</div><div class="val">${fmtKg(data.totaux.poids_net)}</div></div>
      </div>
      <table class="liste">
        <thead><tr>
          <th>Ticket</th><th>Lot</th><th>Début</th><th>Produit</th><th>Client</th>
          <th class="num">Sacs</th><th class="num">Brut (kg)</th><th class="num">Net (kg)</th><th>Statut</th><th></th>
        </tr></thead>
        <tbody>
          ${data.lignes.map((r) => `
            <tr>
              <td><b>${esc(r.numero_ticket)}</b></td>
              <td>${esc(r.numero_lot)}</td>
              <td>${fmtDate(r.date_debut)}</td>
              <td>${esc(r.produit)}</td>
              <td>${esc(r.client || '')}</td>
              <td class="num">${fmtInt(r.nb_total_emb)}</td>
              <td class="num">${fmtKg(r.cumul_brut)}</td>
              <td class="num">${fmtKg(r.poids_net)}</td>
              <td><span class="statut ${r.statut}">${r.statut.replace('_', ' ')}</span></td>
              <td><a class="btn btn-petit" href="/ticket/${r.id}" target="_blank">🖨</a></td>
            </tr>`).join('') || '<tr><td colspan="10" class="vide">Aucun résultat</td></tr>'}
        </tbody>
      </table>`;
  });

  $('#btnCsv').addEventListener('click', () => {
    window.open('/api/rapports/pesees.csv?' + paramsFiltres(), '_blank');
  });

  $('#btnImprimer').addEventListener('click', () => {
    window.open('/api/rapports/pesees.html?' + paramsFiltres(), '_blank');
  });
}

// ---------- Vue : utilisateurs (admin) ----------
async function vueUtilisateurs() {
  if (utilisateur.role !== 'ADMIN') {
    contenu.innerHTML = '<div class="carte"><div class="message-erreur">Réservé à l\'administrateur</div></div>';
    return;
  }
  const users = await api('/api/auth/users');
  contenu.innerHTML = `
    <div class="carte">
      <h2>Utilisateurs</h2>
      <form id="formUser" class="barre-actions">
        <input id="u_username" placeholder="Identifiant" required style="width:auto;flex:1">
        <input id="u_nom" placeholder="Nom complet" style="width:auto;flex:1">
        <input id="u_password" type="password" placeholder="Mot de passe" required style="width:auto;flex:1">
        <select id="u_role" style="width:auto">
          <option value="OPERATEUR">Opérateur</option>
          <option value="SUPERVISEUR">Superviseur</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button class="btn btn-primaire" type="submit">➕ Créer</button>
      </form>
      <table class="liste">
        <thead><tr><th>Identifiant</th><th>Nom</th><th>Rôle</th><th>Actif</th><th>Nouveau mot de passe</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr data-id="${u.id}">
              <td><b>${esc(u.username)}</b></td>
              <td><input value="${esc(u.nom_complet)}" data-col="nom_complet" style="border:none;background:transparent;width:100%"></td>
              <td>
                <select data-col="role" style="width:auto">
                  ${['OPERATEUR', 'SUPERVISEUR', 'ADMIN'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </td>
              <td><input type="checkbox" data-col="actif" ${u.actif ? 'checked' : ''} style="width:auto"></td>
              <td><input type="password" data-col="password" placeholder="(inchangé)" style="width:140px"></td>
              <td><button class="btn btn-petit btn-vert" data-action="save">💾</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  $('#formUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/users', {
        method: 'POST',
        body: {
          username: $('#u_username').value,
          nom_complet: $('#u_nom').value,
          password: $('#u_password').value,
          role: $('#u_role').value
        }
      });
      toast('Utilisateur créé', 'succes');
      vueUtilisateurs();
    } catch (err) { toast(err.message, 'erreur'); }
  });

  contenu.querySelectorAll('tr[data-id] [data-action="save"]').forEach((b) =>
    b.addEventListener('click', async () => {
      const tr = b.closest('tr');
      try {
        await api('/api/auth/users/' + tr.dataset.id, {
          method: 'PUT',
          body: {
            nom_complet: tr.querySelector('[data-col="nom_complet"]').value,
            role: tr.querySelector('[data-col="role"]').value,
            actif: tr.querySelector('[data-col="actif"]').checked,
            password: tr.querySelector('[data-col="password"]').value || undefined
          }
        });
        toast('Enregistré', 'succes');
      } catch (err) { toast(err.message, 'erreur'); }
    })
  );
}

// ---------- Vue : configuration bascule (admin) ----------
async function vueConfigBascule() {
  if (utilisateur.role !== 'ADMIN') {
    contenu.innerHTML = '<div class="carte"><div class="message-erreur">Réservé à l\'administrateur</div></div>';
    return;
  }
  const cfg = await api('/api/bascule/config');

  contenu.innerHTML = `
    <div class="carte">
      <h2>⚙ Configuration de la bascule</h2>
      <p>Paramètres de communication avec l'indicateur de pesage. Compatible avec tout indicateur transmettant en continu ou sur demande par port série.</p>

      <h3 style="margin:20px 0 8px">Connexion série</h3>
      <div class="grille-form">
        <label>Port COM *
          <div style="display:flex;gap:8px;align-items:center">
            <input id="cfg_port" value="${esc(cfg.port || '')}" placeholder="COM3" required style="flex:1">
            <button class="btn btn-petit" type="button" id="btnDetecterPorts">🔍 Détecter</button>
          </div>
          <div id="zonePorts" style="margin-top:6px"></div>
        </label>
        <label>Vitesse (bauds)
          <select id="cfg_baudRate">
            ${[300,600,1200,2400,4800,9600,19200,38400,57600,115200].map((b) => `<option ${Number(cfg.baudRate)===b?'selected':''}>${b}</option>`).join('')}
          </select>
        </label>
        <label>Bits de données
          <select id="cfg_dataBits">
            ${[5,6,7,8].map((b) => `<option ${Number(cfg.dataBits)===b?'selected':''}>${b}</option>`).join('')}
          </select>
        </label>
        <label>Parité
          <select id="cfg_parity">
            ${['none','even','odd','mark','space'].map((p) => `<option ${cfg.parity===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </label>
        <label>Bits de stop
          <select id="cfg_stopBits">
            ${[1,1.5,2].map((b) => `<option ${Number(cfg.stopBits)===b?'selected':''}>${b}</option>`).join('')}
          </select>
        </label>
      </div>

      <h3 style="margin:20px 0 8px">Protocole / Trame</h3>
      <p style="margin:0 0 8px;font-size:.9em;color:#aaa">
        L'indicateur envoie une ligne texte par la liaison série (ex&nbsp;: <code>ST +00547.30 kg</code>).
        La regex doit avoir <b>exactement un groupe capturant&nbsp;( )</b> qui retourne le poids en kg.
      </p>
      <div class="grille-form">
        <label>Délimiteur de fin de trame
          <select id="cfg_delimiter_sel">
            <option value="\\r\\n">\\r\\n — CRLF (le plus courant)</option>
            <option value="\\r">\\r — CR seul (fréquent sur anciens indicateurs)</option>
            <option value="\\n">\\n — LF seul</option>
            <option value="\\x03">\\x03 — ETX (caractère de fin de texte)</option>
            <option value="custom">Personnalisé…</option>
          </select>
        </label>
        <label id="labelDelimCustom" style="display:none">Délimiteur personnalisé
          <input id="cfg_delimiter_custom" placeholder="ex: \\x02 ou \\r">
        </label>
        <label style="grid-column:1/-1">Expression régulière (regex) *
          <input id="cfg_regexPoids" value="${esc(cfg.regexPoids || '')}" placeholder="ex: ([+-]?\\d+(?:[.,]\\d+)?)" required>
        </label>
        <label>Marqueur de stabilité
          <input id="cfg_marqueurStable" value="${esc(cfg.marqueurStable || '')}" placeholder="ex: ST  (vide = tout poids considéré stable)">
        </label>
        <label>Intervalle d'envoi (ms)
          <input type="number" id="cfg_intervalleEnvoiMs" value="${Number(cfg.intervalleEnvoiMs)||300}" min="100" max="5000" step="100">
        </label>
      </div>

      <h3 style="margin:20px 0 8px">Testeur de trame</h3>
      <p style="margin:0 0 8px;font-size:.9em;color:#aaa">Collez une trame brute telle qu'envoyée par l'indicateur pour vérifier que la regex extrait correctement le poids.</p>
      <div class="grille-form">
        <label style="grid-column:1/-1">Trame brute à tester
          <input id="cfg_trameTest" placeholder='ex: ST +00547.30 kg  ou  N 0956.4 kg ST'>
        </label>
      </div>
      <div class="barre-actions" style="margin-top:8px">
        <button class="btn" type="button" id="btnTesterRegex">🔬 Tester la regex</button>
      </div>
      <div id="zoneResultatTest" style="margin-top:8px;padding:10px;background:#1a1a2e;border-radius:6px;display:none"></div>

      <h3 style="margin:20px 0 8px">Connexion serveur</h3>
      <div class="grille-form">
        <label>URL du serveur GESTPAL
          <input id="cfg_serveur" value="${esc(cfg.serveur || 'http://localhost:3000')}">
        </label>
        <label>Token d'authentification bascule
          <input id="cfg_token" value="${esc(cfg.token || '')}">
        </label>
      </div>

      <div class="barre-actions" style="margin-top:24px">
        <button class="btn btn-primaire btn-large" type="button" id="btnSauvegarderConfig">💾 Enregistrer la configuration</button>
      </div>
      <p style="margin-top:12px;font-size:.85em;color:#aaa">
        ℹ️ Le pont bascule recharge automatiquement sa configuration après l'enregistrement.<br>
        🔬 Pour voir les trames brutes envoyées par l'indicateur&nbsp;:
        <code>node scale-bridge/bridge.js --debug</code>
      </p>
    </div>`;

  // Initialiser le select délimiteur
  const delimValeur = cfg.delimiter ?? '\\r\\n';
  const selDel = $('#cfg_delimiter_sel');
  const optionsConnues = ['\\r\\n', '\\r', '\\n', '\\x03'];
  if (optionsConnues.includes(delimValeur)) {
    selDel.value = delimValeur;
  } else {
    selDel.value = 'custom';
    $('#cfg_delimiter_custom').value = delimValeur;
    $('#labelDelimCustom').style.display = '';
  }
  selDel.addEventListener('change', () => {
    $('#labelDelimCustom').style.display = selDel.value === 'custom' ? '' : 'none';
  });

  // Détecter les ports COM disponibles
  $('#btnDetecterPorts').addEventListener('click', async () => {
    const zone = $('#zonePorts');
    zone.innerHTML = '<span style="color:#aaa">Détection en cours…</span>';
    try {
      const ports = await api('/api/bascule/ports');
      if (ports.length === 0) {
        zone.innerHTML = '<span style="color:#f1c40f">Aucun port série détecté — vérifiez le câble et les drivers.</span>';
      } else {
        zone.innerHTML = 'Ports détectés&nbsp;: ' + ports
          .map((p) => `<button class="btn btn-petit" type="button" data-port="${esc(p.path)}" style="margin:0 4px 4px 0">${esc(p.path)}${p.description ? ' — ' + esc(p.description) : ''}</button>`)
          .join('');
        zone.querySelectorAll('[data-port]').forEach((b) =>
          b.addEventListener('click', () => { $('#cfg_port').value = b.dataset.port; })
        );
      }
    } catch (err) {
      zone.innerHTML = `<span style="color:#e74c3c">Erreur : ${esc(err.message)}</span>`;
    }
  });

  // Testeur de regex
  $('#btnTesterRegex').addEventListener('click', () => {
    const trame = $('#cfg_trameTest').value.trim();
    const regexStr = $('#cfg_regexPoids').value.trim();
    const marqueur = $('#cfg_marqueurStable').value.trim();
    const zone = $('#zoneResultatTest');
    zone.style.display = 'block';
    if (!trame) { zone.innerHTML = '<span style="color:#f1c40f">Saisissez d\'abord une trame brute à tester.</span>'; return; }
    if (!regexStr) { zone.innerHTML = '<span style="color:#f1c40f">Saisissez d\'abord une regex.</span>'; return; }
    try {
      const regex = new RegExp(regexStr);
      const m = trame.match(regex);
      const stable = marqueur ? trame.includes(marqueur) : true;
      if (!m || !m[1]) {
        zone.innerHTML = `<span style="color:#e74c3c">❌ Aucune correspondance — la regex ne trouve pas de poids dans cette trame.</span>`;
      } else {
        const poids = parseFloat(String(m[1]).replace(',', '.'));
        zone.innerHTML = Number.isFinite(poids)
          ? `<span style="color:#6cf16c">✅ Poids extrait : <b>${poids.toFixed(2)} kg</b> &nbsp;|&nbsp; Stabilité : <b>${stable ? 'STABLE ✔' : 'EN MOUVEMENT'}</b></span>`
          : `<span style="color:#e74c3c">❌ Groupe capturé "${esc(m[1])}" n'est pas un nombre valide.</span>`;
      }
    } catch (e) {
      zone.innerHTML = `<span style="color:#e74c3c">❌ Regex invalide : ${esc(e.message)}</span>`;
    }
  });

  // Enregistrer la configuration
  $('#btnSauvegarderConfig').addEventListener('click', async () => {
    const btn = $('#btnSauvegarderConfig');
    btn.disabled = true;
    btn.textContent = '⏳ Enregistrement…';
    try {
      await api('/api/bascule/config', {
        method: 'PUT',
        body: {
          port: $('#cfg_port').value,
          baudRate: Number($('#cfg_baudRate').value),
          dataBits: Number($('#cfg_dataBits').value),
          parity: $('#cfg_parity').value,
          stopBits: Number($('#cfg_stopBits').value),
          delimiter: $('#cfg_delimiter_sel').value === 'custom' ? $('#cfg_delimiter_custom').value : $('#cfg_delimiter_sel').value,
          regexPoids: $('#cfg_regexPoids').value,
          marqueurStable: $('#cfg_marqueurStable').value,
          intervalleEnvoiMs: Number($('#cfg_intervalleEnvoiMs').value),
          serveur: $('#cfg_serveur').value,
          token: $('#cfg_token').value
        }
      });
      toast('Configuration bascule enregistrée', 'succes');
      // Recharger le formulaire depuis le serveur pour confirmer les valeurs sauvegardées
      await vueConfigBascule();
    } catch (err) {
      toast(err.message, 'erreur');
      btn.disabled = false;
      btn.textContent = '💾 Enregistrer la configuration';
    }
  });
}

// ---------- Vue : paramètres admin (réinitialisation base) ----------
async function vueParametres() {
  if (utilisateur.role !== 'ADMIN') {
    contenu.innerHTML = '<div class="carte"><div class="message-erreur">Réservé à l\'administrateur</div></div>';
    return;
  }

  contenu.innerHTML = `
    <div class="carte">
      <h2>Paramètres — Administration</h2>

      <div class="zone-danger">
        <h3>⚠ Zone dangereuse — Réinitialisation de la base de données</h3>
        <p>Ces opérations sont <strong>irréversibles</strong>. Toutes les données supprimées ne pourront pas être récupérées.</p>

        <div class="options-reinit">

          <div class="carte-reinit">
            <h4>🗑 Vider les pesées</h4>
            <p>Supprime toutes les pesées et leurs lignes. Remet les compteurs de tickets à zéro.<br>
            <em>Les utilisateurs et les référentiels (produits, clients…) sont conservés.</em></p>
            <button class="btn btn-rouge" id="btnReinitPesees">Vider les pesées…</button>
          </div>

          <div class="carte-reinit">
            <h4>💣 Réinitialisation complète</h4>
            <p>Supprime les pesées, les référentiels et tous les utilisateurs sauf votre compte admin.<br>
            <em>Remet la base dans l'état d'installation initiale avec les données de démarrage.</em></p>
            <button class="btn btn-rouge" id="btnReinitComplet">Réinitialisation complète…</button>
          </div>

        </div>
      </div>
    </div>

    <div id="modalReinit" class="modal-fond" style="display:none">
      <div class="modal-boite">
        <h3 id="modalTitre"></h3>
        <p id="modalDesc"></p>
        <p>Pour confirmer, saisissez exactement : <code>REINITIALISER</code></p>
        <input id="inputConfirmation" placeholder="REINITIALISER" autocomplete="off" style="width:100%;margin-bottom:12px">
        <div class="barre-actions" style="justify-content:flex-end">
          <button class="btn" type="button" id="btnAnnulerModal">Annuler</button>
          <button class="btn btn-rouge" type="button" id="btnConfirmerReinit">Confirmer la suppression</button>
        </div>
      </div>
    </div>`;

  const modal = $('#modalReinit');

  function fermerModal() { modal.style.display = 'none'; }

  function ouvrirModal(mode) {
    modal.dataset.mode = mode;
    $('#modalTitre').textContent = mode === 'pesees' ? '🗑 Vider les pesées' : '💣 Réinitialisation complète';
    $('#modalDesc').textContent = mode === 'pesees'
      ? 'Toutes les pesées et leurs lignes seront définitivement supprimées. Les compteurs de tickets seront remis à zéro.'
      : 'Toutes les pesées, tous les référentiels et tous les utilisateurs (sauf votre compte) seront supprimés. La base retrouvera son état initial.';
    $('#inputConfirmation').value = '';
    modal.style.display = 'flex';
    $('#inputConfirmation').focus();
  }

  $('#btnReinitPesees').addEventListener('click', () => ouvrirModal('pesees'));
  $('#btnReinitComplet').addEventListener('click', () => ouvrirModal('complet'));
  $('#btnAnnulerModal').addEventListener('click', fermerModal);
  // Clic sur le fond sombre = annuler
  modal.addEventListener('click', (e) => { if (e.target === modal) fermerModal(); });
  // Touche Échap = annuler
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { fermerModal(); document.removeEventListener('keydown', onEsc); }
  });

  $('#btnConfirmerReinit').addEventListener('click', async () => {
    const mode = modal.dataset.mode;
    const confirmation = $('#inputConfirmation').value.trim();
    try {
      await api('/api/admin/reinitialiser', { method: 'POST', body: { mode, confirmation } });
      fermerModal();
      toast(mode === 'pesees' ? 'Pesées supprimées avec succès' : 'Base réinitialisée avec succès', 'succes');
      if (mode === 'complet') setTimeout(() => location.reload(), 1500);
    } catch (err) {
      toast(err.message, 'erreur');
    }
  });
}

// ---------- Vue : activation licence ----------
async function vueActivationLicence(info) {
  document.querySelector('.entete').style.display = 'none';
  contenu.style.maxWidth = '560px';
  contenu.style.margin = '60px auto';
  contenu.innerHTML = `
    <div class="carte" style="text-align:center">
      <div style="font-size:48px;margin-bottom:8px">🔐</div>
      <h2 style="color:var(--bleu);margin-top:0">Activation GESTPAL</h2>
      ${info.expiree ? `<div class="message-erreur" style="margin-bottom:16px">Licence expirée le ${info.payload?.expires} — contactez votre revendeur.</div>` : ''}
      ${!info.valide && !info.expiree ? `<div class="message-erreur" style="margin-bottom:16px">${esc(info.raison || 'Licence non valide')}</div>` : ''}
      <p style="font-size:14px;color:#5b6b7c;margin-bottom:20px">
        Ce logiciel doit être activé. Communiquez le code machine ci-dessous à votre revendeur pour obtenir une clé de licence.
      </p>
      <div style="background:#f0f4f8;border:1px solid #b0c4de;border-radius:8px;padding:14px;margin-bottom:20px">
        <div style="font-size:12px;color:#5b6b7c;font-weight:600;margin-bottom:4px">CODE MACHINE</div>
        <div style="font-family:Consolas,monospace;font-size:28px;font-weight:700;color:var(--bleu);letter-spacing:4px">${esc(info.machineCode || '--------')}</div>
      </div>
      <label style="text-align:left">
        Clé de licence
        <textarea id="inputLicence" rows="4" placeholder="Collez ici la clé fournie par votre revendeur (commence par GESTPAL-…)" style="margin-top:6px;font-family:Consolas,monospace;font-size:12px;resize:vertical"></textarea>
      </label>
      <button class="btn btn-primaire btn-large" id="btnActiver" style="margin-top:12px">✅ Activer GESTPAL</button>
      <div id="errActivation" class="message-erreur" hidden style="margin-top:12px"></div>
    </div>`;

  $('#btnActiver').addEventListener('click', async () => {
    const cle = $('#inputLicence').value.trim();
    if (!cle) { toast('Collez la clé de licence reçue de votre revendeur', 'erreur'); return; }
    $('#btnActiver').disabled = true;
    try {
      const r = await fetch('/api/licence/activer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cle })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Activation échouée');
      document.querySelector('.entete').style.display = '';
      contenu.style.maxWidth = '';
      contenu.style.margin = '';
      toast(`✅ Activé — ${esc(data.payload?.client)} · expire le ${data.payload?.expires}`, 'succes');
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      $('#errActivation').textContent = err.message;
      $('#errActivation').hidden = false;
      $('#btnActiver').disabled = false;
    }
  });
}

// ---------- Démarrage ----------
(async function init() {
  // Vérifie la licence avant tout
  try {
    const licInfo = await fetch('/api/licence/info').then(r => r.json());
    if (!licInfo.valide) { await vueActivationLicence(licInfo); return; }
    // Avertissement si expiration < 30 jours
    if (licInfo.joursRestants <= 30) {
      setTimeout(() => toast(`⚠ Licence expiration dans ${licInfo.joursRestants} jour(s) — contactez votre revendeur`, 'erreur'), 1500);
    }
  } catch { /* si le serveur est injoignable, on continue */ }

  try {
    const { user } = await api('/api/auth/me');
    if (!user) { location.href = '/login.html'; return; }
    utilisateur = user;
    $('#nomUser').textContent = user.nom_complet || user.username;
    if (user.role === 'ADMIN') document.querySelectorAll('.nav-admin').forEach((el) => (el.hidden = false));
    // Dernier poids connu de la bascule
    try { poidsBascule = await api('/api/bascule/poids'); } catch {}
    majAffichagePoids();
    router();
  } catch {
    location.href = '/login.html';
  }
})();

$('#btnLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});
