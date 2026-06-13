const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

function construireFiltres(query) {
  const filtres = ["p.statut <> 'ANNULEE'"];
  const params = [];
  if (query.du) { filtres.push('p.date_debut >= ?'); params.push(query.du + ' 00:00:00'); }
  if (query.au) { filtres.push('p.date_debut <= ?'); params.push(query.au + ' 23:59:59'); }
  if (query.produit_id) { filtres.push('p.produit_id = ?'); params.push(query.produit_id); }
  if (query.client_id) { filtres.push('p.client_id = ?'); params.push(query.client_id); }
  if (query.fournisseur_id) { filtres.push('p.fournisseur_id = ?'); params.push(query.fournisseur_id); }
  if (query.site_id) { filtres.push('p.site_id = ?'); params.push(query.site_id); }
  if (query.statut) { filtres.push('p.statut = ?'); params.push(query.statut); }
  return { where: 'WHERE ' + filtres.join(' AND '), params };
}

const SQL_RAPPORT = (where) => `
  SELECT p.id, p.numero_ticket, p.numero_lot, p.numero_bordereau, p.statut,
         p.date_debut, p.date_fin, p.campagne, p.mouvement,
         pr.libelle AS produit, e.libelle AS emballage,
         c.libelle AS client, f.libelle AS fournisseur, s.libelle AS site,
         p.tare_palettes, p.nb_palettes,
         COALESCE(SUM(l.nb_emb), 0)     AS nb_total_emb,
         COALESCE(SUM(l.poids_brut), 0) AS cumul_brut,
         COALESCE(SUM(l.tare_emb), 0)   AS cumul_tare_emb,
         COALESCE(SUM(l.poids_brut), 0) - COALESCE(SUM(l.tare_emb), 0) - p.tare_palettes AS poids_net
  FROM pesees p
  JOIN produits pr ON pr.id = p.produit_id
  JOIN emballages e ON e.id = p.emballage_id
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id
  JOIN sites s ON s.id = p.site_id
  LEFT JOIN pesee_lignes l ON l.pesee_id = p.id
  ${where}
  GROUP BY p.id
  ORDER BY p.date_debut DESC`;

// Rapport JSON
router.get('/pesees', async (req, res, next) => {
  try {
    const { where, params } = construireFiltres(req.query);
    const [rows] = await pool.query(SQL_RAPPORT(where), params);
    const totaux = rows.reduce(
      (t, r) => ({
        nb_pesees: t.nb_pesees + 1,
        nb_total_emb: t.nb_total_emb + Number(r.nb_total_emb),
        cumul_brut: t.cumul_brut + Number(r.cumul_brut),
        poids_net: t.poids_net + Number(r.poids_net)
      }),
      { nb_pesees: 0, nb_total_emb: 0, cumul_brut: 0, poids_net: 0 }
    );
    res.json({ lignes: rows, totaux });
  } catch (err) { next(err); }
});

// Export CSV (ouvrable dans Excel)
router.get('/pesees.csv', async (req, res, next) => {
  try {
    const { where, params } = construireFiltres(req.query);
    const [rows] = await pool.query(SQL_RAPPORT(where), params);
    const entetes = [
      'Ticket', 'Lot', 'Bordereau', 'Statut', 'Début', 'Fin', 'Campagne', 'Mouvement',
      'Produit', 'Emballage', 'Client', 'Fournisseur', 'Site',
      'Nb sacs', 'Cumul brut (kg)', 'Tare emb. (kg)', 'Tare palettes (kg)', 'Poids net (kg)'
    ];
    const fmt = (d) => (d ? new Date(d).toLocaleString('fr-FR') : '');
    const lignes = rows.map((r) =>
      [
        r.numero_ticket, r.numero_lot, r.numero_bordereau, r.statut, fmt(r.date_debut), fmt(r.date_fin),
        r.campagne, r.mouvement, r.produit, r.emballage, r.client || '', r.fournisseur || '', r.site,
        r.nb_total_emb, r.cumul_brut, r.cumul_tare_emb, r.tare_palettes, r.poids_net
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(';')
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rapport_pesees.csv"');
    res.send('﻿' + entetes.join(';') + '\r\n' + lignes.join('\r\n'));
  } catch (err) { next(err); }
});

// Rapport imprimable HTML (même filtres que /pesees)
router.get('/pesees.html', async (req, res, next) => {
  try {
    const { where, params } = construireFiltres(req.query);
    const [rows] = await pool.query(SQL_RAPPORT(where), params);
    const totaux = rows.reduce(
      (t, r) => ({
        nb_pesees: t.nb_pesees + 1,
        nb_total_emb: t.nb_total_emb + Number(r.nb_total_emb),
        cumul_brut: t.cumul_brut + Number(r.cumul_brut),
        poids_net: t.poids_net + Number(r.poids_net)
      }),
      { nb_pesees: 0, nb_total_emb: 0, cumul_brut: 0, poids_net: 0 }
    );

    const fmtKg = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = (n) => Number(n).toLocaleString('fr-FR');
    const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Ligne de description des filtres actifs
    const filtreDesc = [
      req.query.du  ? `Du ${fmtDate(req.query.du)}`  : null,
      req.query.au  ? `au ${fmtDate(req.query.au)}`  : null,
      req.query.statut ? `Statut : ${req.query.statut.replace('_', ' ')}` : null
    ].filter(Boolean).join(' · ') || 'Tous les enregistrements';

    const lignesHtml = rows.map((r) => `
      <tr>
        <td><b>${esc(r.numero_ticket)}</b></td>
        <td>${esc(r.numero_lot)}</td>
        <td>${fmtDate(r.date_debut)}</td>
        <td>${esc(r.produit)}</td>
        <td>${esc(r.client || '')}</td>
        <td>${esc(r.site)}</td>
        <td class="num">${fmtInt(r.nb_total_emb)}</td>
        <td class="num">${fmtKg(r.cumul_brut)}</td>
        <td class="num">${fmtKg(r.poids_net)}</td>
        <td class="statut">${esc(r.statut.replace('_', ' '))}</td>
      </tr>`).join('') || '<tr><td colspan="10" class="vide">Aucun résultat</td></tr>';

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport pesées — GESTPAL</title>
<style>
  body { font-family: 'Courier New', monospace; font-size: 12px; margin: 24px; color: #000; }
  .rapport { max-width: 1000px; margin: auto; }
  h1 { font-size: 16px; text-align: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin: 0; }
  .sous-titre { text-align: center; font-size: 11px; margin: 3px 0 12px; color: #444; }
  .totaux { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .tuile { border: 1px solid #000; padding: 5px 8px; text-align: center; }
  .tuile .lab { font-size: 9px; font-weight: bold; color: #555; }
  .tuile .val { font-size: 18px; font-weight: bold; }
  .tuile.net { background: #e8f5e9; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; }
  th { background: #eee; font-weight: bold; }
  td.num, th.num { text-align: right; }
  tr:nth-child(even) { background: #fafafa; }
  .statut { font-size: 10px; }
  .no-print { text-align: center; margin-bottom: 16px; }
  .no-print button { margin: 0 6px; padding: 7px 18px; font-size: 13px; cursor: pointer; border: 1px solid #999; border-radius: 4px; background: #f0f0f0; }
  .no-print button.primaire { background: #1c4e80; color: #fff; border-color: #1c4e80; }
  .pied { margin-top: 20px; font-size: 10px; color: #666; text-align: right; }
  @media print { .no-print { display: none; } body { margin: 8px; } }
</style>
</head>
<body>
<div class="no-print">
  <button class="primaire" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>
  <button onclick="history.back()">← Retour</button>
</div>
<div class="rapport">
  <h1>GESTPAL — Rapport historique des pesées</h1>
  <div class="sous-titre">Filtre : ${esc(filtreDesc)} — Édité le ${new Date().toLocaleString('fr-FR')}</div>

  <div class="totaux">
    <div class="tuile"><div class="lab">PESÉES</div><div class="val">${fmtInt(totaux.nb_pesees)}</div></div>
    <div class="tuile"><div class="lab">TOTAL SACS</div><div class="val">${fmtInt(totaux.nb_total_emb)}</div></div>
    <div class="tuile"><div class="lab">CUMUL BRUT (KG)</div><div class="val">${fmtKg(totaux.cumul_brut)}</div></div>
    <div class="tuile net"><div class="lab">POIDS NET (KG)</div><div class="val">${fmtKg(totaux.poids_net)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Ticket</th><th>Lot</th><th>Début</th><th>Produit</th><th>Client</th><th>Site</th>
        <th class="num">Sacs</th><th class="num">Brut (kg)</th><th class="num">Net (kg)</th><th>Statut</th>
      </tr>
    </thead>
    <tbody>${lignesHtml}</tbody>
  </table>
  <div class="pied">Total : ${fmtInt(totaux.nb_pesees)} pesée(s)</div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { next(err); }
});

module.exports = router;
