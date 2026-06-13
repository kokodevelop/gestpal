const { chargerPesee } = require('./pesees');

// Totaux : toujours 2 décimales (1 204,95). Lignes de détail : kg entiers si possible (2 814), comme le ticket modèle.
const fmtKg = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtLigne = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtInt = (n) => Number(n).toLocaleString('fr-FR');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const fmtHeure = (d) => (d ? new Date(d).toLocaleTimeString('fr-FR') : '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function renderTicket(id) {
  const p = await chargerPesee(id);
  if (!p) throw new Error('Pesée introuvable');
  const t = p.totaux;

  const lignesHtml = p.lignes
    .map(
      (l) => `<tr>
        <td class="num">${l.ordre}</td>
        <td class="num">${fmtLigne(l.poids_brut)}</td>
        <td class="num">${fmtInt(l.nb_emb)}</td>
        <td class="num">${fmtLigne(l.tare_emb)}</td>
        <td class="num">${fmtLigne(l.poids_net)}</td>
      </tr>`
    )
    .join('');

  const champ = (lab, val) => `<div class="ligne"><span class="lab">${lab}</span>: ${val}</div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Ticket ${esc(p.numero_ticket)}</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 12px; margin: 24px; color: #000; }
  .ticket { max-width: 760px; margin: auto; padding: 12px 16px; }
  h1 { text-align: center; font-size: 16px; border-bottom: 2px solid #000; padding-bottom: 6px; margin: 0; }
  .sous-titre { text-align: center; font-size: 10px; margin: 2px 0 10px; }
  .bloc { border: 1px solid #000; margin-bottom: 8px; padding: 4px 8px 6px; }
  .bloc .titre { font-size: 9px; font-weight: bold; background: #eee; margin: -4px -8px 5px; padding: 2px 8px; border-bottom: 1px solid #000; }
  .cols { display: grid; grid-template-columns: 1.1fr 1fr; gap: 2px 28px; }
  .cols3 { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 2px 18px; }
  .ligne { display: flex; align-items: baseline; }
  .ligne .lab { min-width: 138px; font-weight: bold; }
  .cols3 .ligne .lab { min-width: 118px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; max-width: 460px; }
  th, td { border: 1px solid #000; padding: 3px 8px; }
  th { background: #eee; font-size: 11px; }
  td.num, th.num { text-align: right; }
  .totaux td { font-weight: bold; background: #f5f5f5; }
  .deux-cases { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #000; margin-bottom: 8px; }
  .deux-cases > div { padding: 4px 8px 8px; }
  .deux-cases > div + div { border-left: 1px solid #000; }
  .deux-cases .titre { font-size: 9px; font-weight: bold; background: #eee; margin: -4px -8px 5px; padding: 2px 8px; border-bottom: 1px solid #000; }
  .signatures { display: flex; justify-content: space-between; margin-top: 32px; }
  .signatures div { width: 28%; border-top: 1px solid #000; text-align: center; padding-top: 4px; font-size: 11px; }
  .no-print { text-align: center; margin: 16px; }
  @media print { .no-print { display: none; } body { margin: 0; } }
</style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()">🖨️ Imprimer</button>
  <button onclick="history.back()">← Retour</button>
</div>
<div class="ticket">
  <h1>TICKET STOCKAGE PRODUIT N° ${esc(p.numero_ticket)}</h1>
  <div class="sous-titre">(Pesée palette ${esc(p.site_libelle)}) — Adresse : &nbsp;·&nbsp; Tél : &nbsp;·&nbsp; Fax :
    ${p.statut !== 'TERMINEE' ? '<br><b>PROVISOIRE (' + p.statut + ')</b>' : ''}</div>

  <div class="bloc">
    <div class="titre">Informations du chargement</div>
    <div class="cols">
      ${champ('Début', `${fmtDate(p.date_debut)} à ${fmtHeure(p.date_debut)}`)}
      ${champ('N° Bordereau', esc(p.numero_bordereau))}
      ${champ('Fin', p.date_fin ? `${fmtDate(p.date_fin)} à ${fmtHeure(p.date_fin)}` : '')}
      ${champ('N° Connaiss.', esc(p.n_connaissement))}
      ${champ('N° Livraison', esc(p.n_livraison))}
      ${champ('N° Lot', esc(p.numero_lot))}
      ${champ('Campagne', esc(p.campagne))}
    </div>
  </div>

  <div class="bloc">
    <div class="titre">Données poids</div>
    <div class="cols3">
      ${champ('NBRE TOTAL EMB.', fmtInt(t.nb_total_emb))}
      ${champ('CUMUL PALETTE (KG)', fmtKg(p.tare_palettes))}
      ${champ('CUMUL TARE EMB. (KG)', fmtKg(t.cumul_tare_totale))}
      ${champ('CUMUL POIDS BRUT (KG)', fmtKg(t.cumul_brut))}
      ${champ('NB PALETTES', fmtInt(p.nb_palettes))}
      ${champ('POIDS NET SANS EMB.', `<b>${fmtKg(t.poids_net_sans_emb)}</b>`)}
    </div>
  </div>

  <div class="bloc">
    <div class="titre">Informations générales</div>
    <div class="cols">
      <div>
        ${champ('Mouvement', esc(p.mouvement))}
        ${champ('Produit', `${esc(p.produit_code)} - ${esc(p.produit_libelle)}`)}
        ${champ('Emballage', `${esc(p.emballage_code)} - ${esc(p.emballage_libelle)}`)}
        ${champ('Transporteur', `${esc(p.transporteur_code || '')}${p.transporteur_libelle ? ' - ' + esc(p.transporteur_libelle) : ''}`)}
        ${champ('Fournisseur', `${esc(p.fournisseur_code || '')}${p.fournisseur_libelle ? ' - ' + esc(p.fournisseur_libelle) : ''}`)}
        ${champ('Client', `${esc(p.client_code || '')}${p.client_libelle ? ' - ' + esc(p.client_libelle) : ''}`)}
        ${champ('Chauffeur', esc(p.chauffeur))}
      </div>
      <div>
        ${champ('Véhicule', `${esc(p.vehicule)} &nbsp;&nbsp;<b>Remorque</b> : ${esc(p.remorque)}`)}
        ${champ('Destination', esc(p.destination))}
        ${champ('Provenance', esc(p.provenance))}
        ${champ('Quart', `${esc(p.quart_code || '')}${p.quart_libelle ? ' - ' + esc(p.quart_libelle) : ''}`)}
        ${champ('Site Pesée', `${esc(p.site_code)} - ${esc(p.site_libelle)}`)}
        ${champ('N° Permis', esc(p.n_permis))}
      </div>
    </div>
  </div>

  <div class="deux-cases">
    <div>
      <div class="titre">Nature produit</div>
      <b>${esc(p.nature_produit || p.produit_nature)}</b>
    </div>
    <div>
      <div class="titre">Peseur</div>
      ${esc(p.cree_par_nom || '')}
    </div>
  </div>

  <div class="bloc">
    <div class="titre">Détails de la pesée</div>
    <table>
      <thead>
        <tr>
          <th class="num">Ordre</th><th class="num">Poids brut</th><th class="num">Nbr emb</th>
          <th class="num">Tare Em</th><th class="num">Poids Net</th>
        </tr>
      </thead>
      <tbody>
        ${lignesHtml}
        <tr class="totaux">
          <td>TOTAL</td>
          <td class="num">${fmtLigne(t.cumul_brut)}</td>
          <td class="num">${fmtInt(t.nb_total_emb)}</td>
          <td class="num">${fmtLigne(t.cumul_tare_emb)}</td>
          <td class="num">${fmtLigne(Number(t.cumul_brut) - Number(t.cumul_tare_emb))}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="signatures">
    <div>Le peseur</div>
    <div>Le chauffeur</div>
    <div>Le superviseur</div>
  </div>
</div>
</body>
</html>`;
}

module.exports = { renderTicket };
