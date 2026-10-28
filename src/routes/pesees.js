const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// ---------- Numérotation : ticket = <code site>S<seq 3 chiffres>, par site et par année ----------
async function prochainNumero(conn, siteId) {
  const annee = new Date().getFullYear();
  const [rows] = await conn.query('SELECT dernier FROM compteurs WHERE site_id = ? AND annee = ? FOR UPDATE', [siteId, annee]);
  let seq;
  if (rows.length === 0) {
    seq = 1;
    await conn.query('INSERT INTO compteurs (site_id, annee, dernier) VALUES (?, ?, 1)', [siteId, annee]);
  } else {
    seq = rows[0].dernier + 1;
    await conn.query('UPDATE compteurs SET dernier = ? WHERE site_id = ? AND annee = ?', [seq, siteId, annee]);
  }
  const [[site]] = await conn.query('SELECT code FROM sites WHERE id = ?', [siteId]);
  return { seq, numero_ticket: `${site.code}S${String(seq).padStart(3, '0')}`, site_code: site.code };
}

// Totaux d'une pesée (mêmes règles que le ticket SIMAT)
const SQL_TOTAUX = `
  SELECT
    COUNT(l.id)                    AS nb_lignes,
    COALESCE(SUM(l.nb_emb), 0)     AS nb_total_emb,
    COALESCE(SUM(l.poids_brut), 0) AS cumul_brut,
    COALESCE(SUM(l.tare_emb), 0)   AS cumul_tare_emb
  FROM pesee_lignes l WHERE l.pesee_id = ?`;

async function chargerPesee(id) {
  const [[pesee]] = await pool.query(
    `SELECT p.*,
            pr.code AS produit_code, pr.libelle AS produit_libelle, pr.nature AS produit_nature,
            e.code AS emballage_code, e.libelle AS emballage_libelle,
            c.code AS client_code, c.libelle AS client_libelle,
            f.code AS fournisseur_code, f.libelle AS fournisseur_libelle,
            t.code AS transporteur_code, t.libelle AS transporteur_libelle,
            s.code AS site_code, s.libelle AS site_libelle,
            q.code AS quart_code, q.libelle AS quart_libelle,
            u.nom_complet AS cree_par_nom
     FROM pesees p
     JOIN produits pr ON pr.id = p.produit_id
     JOIN emballages e ON e.id = p.emballage_id
     LEFT JOIN clients c ON c.id = p.client_id
     LEFT JOIN fournisseurs f ON f.id = p.fournisseur_id
     LEFT JOIN transporteurs t ON t.id = p.transporteur_id
     JOIN sites s ON s.id = p.site_id
     LEFT JOIN quarts q ON q.id = p.quart_id
     LEFT JOIN users u ON u.id = p.cree_par
     WHERE p.id = ?`,
    [id]
  );
  if (!pesee) return null;
  const [lignes] = await pool.query('SELECT * FROM pesee_lignes WHERE pesee_id = ? ORDER BY ordre', [id]);
  const [[totaux]] = await pool.query(SQL_TOTAUX, [id]);
  // Poids net sans emballage = brut - tare sacs - tare palettes
  totaux.cumul_tare_totale = Number(totaux.cumul_tare_emb) + Number(pesee.tare_palettes);
  totaux.poids_net_sans_emb = Number(totaux.cumul_brut) - totaux.cumul_tare_totale;
  return { ...pesee, lignes, totaux };
}

// ---------- Liste ----------
router.get('/', async (req, res, next) => {
  try {
    const filtres = [];
    const params = [];
    if (req.query.statut) { filtres.push('p.statut = ?'); params.push(req.query.statut); }
    if (req.query.q) {
      filtres.push('(p.numero_ticket LIKE ? OR p.numero_lot LIKE ? OR p.numero_bordereau LIKE ?)');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }
    const where = filtres.length ? 'WHERE ' + filtres.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT p.id, p.numero_ticket, p.numero_lot, p.statut, p.date_debut, p.date_fin,
              pr.libelle AS produit, s.libelle AS site, p.tare_palettes,
              (SELECT COUNT(*) FROM pesee_lignes l WHERE l.pesee_id = p.id) AS nb_lignes,
              (SELECT COALESCE(SUM(l.poids_brut),0) FROM pesee_lignes l WHERE l.pesee_id = p.id) AS cumul_brut
       FROM pesees p
       JOIN produits pr ON pr.id = p.produit_id
       JOIN sites s ON s.id = p.site_id
       ${where}
       ORDER BY p.date_debut DESC
       LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ---------- Détail ----------
router.get('/:id', async (req, res, next) => {
  try {
    const pesee = await chargerPesee(req.params.id);
    if (!pesee) return res.status(404).json({ error: 'Pesée introuvable' });
    res.json(pesee);
  } catch (err) { next(err); }
});

// ---------- Création (initialisation avec la tare palettes) ----------
router.post('/', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const b = req.body;
    if (!b.produit_id || !b.emballage_id || !b.site_id) {
      return res.status(400).json({ error: 'Produit, emballage et site sont obligatoires' });
    }
    // Certaines pesées (ex. cacao brousse) se font sans palette : les sacs sont posés
    // directement sur la bascule. Dans ce cas la tare palettes est explicitement 0.
    const sansPalette = !!b.sans_palette;
    const tareSaisie = Number(b.tare_palettes);
    if (sansPalette) {
      if (!Number.isFinite(tareSaisie) || tareSaisie < 0) {
        return res.status(400).json({ error: 'Tare palettes invalide' });
      }
    } else if (!Number.isFinite(tareSaisie) || tareSaisie <= 0) {
      return res.status(400).json({
        error: 'La tare palettes doit être un poids positif (pesez d\'abord les palettes vides), ou cochez "Pesée sans palette"'
      });
    }
    const tare = sansPalette ? 0 : tareSaisie;
    await conn.beginTransaction();
    const { numero_ticket, seq, site_code } = await prochainNumero(conn, b.site_id);

    // N° de lot : manuel si fourni, sinon auto L-AAMMJJ-SEQ
    const now = new Date();
    const aammjj = now.toISOString().slice(2, 10).replace(/-/g, '');
    const numero_lot = (b.numero_lot && b.numero_lot.trim()) || `L${aammjj}-${String(seq).padStart(3, '0')}`;
    // N° bordereau : manuel si fourni, sinon auto <site><AAMM><seq 5 chiffres>
    const numero_bordereau = (b.numero_bordereau && b.numero_bordereau.trim())
      || `${site_code}${aammjj.slice(0, 4)}${String(seq).padStart(5, '0')}`;

    const [[emb]] = await conn.query('SELECT poids_unitaire FROM emballages WHERE id = ?', [b.emballage_id]);

    const [r] = await conn.query(
      `INSERT INTO pesees
        (numero_ticket, numero_lot, numero_bordereau, campagne, mouvement,
         produit_id, emballage_id, client_id, fournisseur_id, transporteur_id, site_id, quart_id,
         vehicule, remorque, chauffeur, destination, provenance,
         n_livraison, n_connaissement, n_permis, nature_produit,
         tare_palettes, nb_palettes, max_sacs, poids_unitaire_emb, observations, cree_par)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        numero_ticket, numero_lot, numero_bordereau, b.campagne || '', b.mouvement || '1 - STOCKAGE',
        b.produit_id, b.emballage_id, b.client_id || null, b.fournisseur_id || null, b.transporteur_id || null,
        b.site_id, b.quart_id || null,
        b.vehicule || '', b.remorque || '', b.chauffeur || '', b.destination || '', b.provenance || '',
        b.n_livraison || '', b.n_connaissement || '', b.n_permis || '', b.nature_produit || '',
        tare, Number(b.nb_palettes) || 0, Number(b.max_sacs) || 0, emb.poids_unitaire, b.observations || null, req.session.user.id
      ]
    );
    await conn.commit();
    res.json({ id: r.insertId, numero_ticket, numero_lot, numero_bordereau });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ---------- Modification de l'en-tête (tant que non terminée) ----------
router.put('/:id', async (req, res, next) => {
  try {
    const [[p]] = await pool.query('SELECT statut FROM pesees WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Pesée introuvable' });
    if (p.statut === 'TERMINEE' || p.statut === 'ANNULEE') {
      return res.status(400).json({ error: 'Pesée clôturée : modification impossible' });
    }
    const b = req.body;
    await pool.query(
      `UPDATE pesees SET numero_lot=?, numero_bordereau=?, campagne=?, mouvement=?,
         client_id=?, fournisseur_id=?, transporteur_id=?, quart_id=?,
         vehicule=?, remorque=?, chauffeur=?, destination=?, provenance=?,
         n_livraison=?, n_connaissement=?, n_permis=?, nature_produit=?,
         tare_palettes=?, nb_palettes=?, max_sacs=?, observations=?
       WHERE id=?`,
      [
        b.numero_lot || '', b.numero_bordereau || '', b.campagne || '', b.mouvement || '1 - STOCKAGE',
        b.client_id || null, b.fournisseur_id || null, b.transporteur_id || null, b.quart_id || null,
        b.vehicule || '', b.remorque || '', b.chauffeur || '', b.destination || '', b.provenance || '',
        b.n_livraison || '', b.n_connaissement || '', b.n_permis || '', b.nature_produit || '',
        Number(b.tare_palettes) || 0, Number(b.nb_palettes) || 0, Number(b.max_sacs) || 0, b.observations || null,
        req.params.id
      ]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Ajout d'une ligne (une palette chargée) ----------
router.post('/:id/lignes', async (req, res, next) => {
  try {
    const [[p]] = await pool.query('SELECT statut, poids_unitaire_emb, nb_palettes, max_sacs FROM pesees WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Pesée introuvable' });
    if (p.statut !== 'EN_COURS') return res.status(400).json({ error: `Pesée ${p.statut} : reprenez-la avant d'ajouter une ligne` });

    const poidsBrut = Number(req.body.poids_brut);
    const nbEmb = Number(req.body.nb_emb);
    if (!Number.isFinite(poidsBrut) || poidsBrut <= 0) return res.status(400).json({ error: 'Poids brut invalide' });
    if (!Number.isInteger(nbEmb) || nbEmb <= 0) return res.status(400).json({ error: 'Nombre de sacs invalide' });

    // Règles métier : limites palettes et sacs
    const [[totauxActuels]] = await pool.query(SQL_TOTAUX, [req.params.id]);
    const nbLignesActuelles = Number(totauxActuels.nb_lignes);
    const nbSacsActuels = Number(totauxActuels.nb_total_emb);

    if (p.nb_palettes > 0 && nbLignesActuelles >= p.nb_palettes) {
      return res.status(400).json({ error: `Nombre maximum de palettes atteint (${p.nb_palettes} palette(s) prévue(s))` });
    }
    if (p.max_sacs > 0) {
      const sacsRestants = p.max_sacs - nbSacsActuels;
      if (nbEmb > sacsRestants) {
        return res.status(400).json({
          error: `Dépassement du quota : il reste ${sacsRestants} sac(s) à enregistrer sur ${p.max_sacs} maximum${sacsRestants > 0 ? ` — saisissez ${sacsRestants} sac(s)` : ' — quota atteint'}`
        });
      }
    }

    const tareEmb = Math.round(nbEmb * p.poids_unitaire_emb * 100) / 100;
    const poidsNet = Math.round((poidsBrut - tareEmb) * 100) / 100;
    if (poidsNet <= 0) return res.status(400).json({ error: 'Poids net négatif : vérifiez le poids ou le nombre de sacs' });

    const queueLot = req.body.queue_lot ? 1 : 0;
    const [[m]] = await pool.query('SELECT COALESCE(MAX(ordre),0)+1 AS ordre FROM pesee_lignes WHERE pesee_id = ?', [req.params.id]);
    const [r] = await pool.query(
      'INSERT INTO pesee_lignes (pesee_id, ordre, poids_brut, nb_emb, queue_lot, tare_emb, poids_net, pese_par) VALUES (?,?,?,?,?,?,?,?)',
      [req.params.id, m.ordre, poidsBrut, nbEmb, queueLot, tareEmb, poidsNet, req.session.user.id]
    );
    const [[totaux]] = await pool.query(SQL_TOTAUX, [req.params.id]);
    res.json({ id: r.insertId, ordre: m.ordre, tare_emb: tareEmb, poids_net: poidsNet, totaux });
  } catch (err) { next(err); }
});

// ---------- Suppression d'une ligne (correction, tant que non terminée) ----------
router.delete('/:id/lignes/:ligneId', async (req, res, next) => {
  try {
    const [[p]] = await pool.query('SELECT statut FROM pesees WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Pesée introuvable' });
    if (p.statut === 'TERMINEE' || p.statut === 'ANNULEE') {
      return res.status(400).json({ error: 'Pesée clôturée : correction impossible' });
    }
    await pool.query('DELETE FROM pesee_lignes WHERE id = ? AND pesee_id = ?', [req.params.ligneId, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Changements de statut ----------
async function changerStatut(req, res, next, attendu, nouveau, dateFin = false) {
  try {
    const [[p]] = await pool.query('SELECT statut FROM pesees WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Pesée introuvable' });
    if (!attendu.includes(p.statut)) {
      return res.status(400).json({ error: `Statut actuel ${p.statut} : opération impossible` });
    }
    await pool.query(`UPDATE pesees SET statut = ?${dateFin ? ', date_fin = NOW()' : ''} WHERE id = ?`, [nouveau, req.params.id]);
    res.json({ ok: true, statut: nouveau });
  } catch (err) { next(err); }
}

router.post('/:id/interrompre', (req, res, next) => changerStatut(req, res, next, ['EN_COURS'], 'INTERROMPUE'));
router.post('/:id/reprendre', (req, res, next) => changerStatut(req, res, next, ['INTERROMPUE'], 'EN_COURS'));
router.post('/:id/annuler', (req, res, next) => changerStatut(req, res, next, ['EN_COURS', 'INTERROMPUE'], 'ANNULEE', true));

// Clôture : exige au moins une ligne
router.post('/:id/cloturer', async (req, res, next) => {
  try {
    const [[n]] = await pool.query('SELECT COUNT(*) AS nb FROM pesee_lignes WHERE pesee_id = ?', [req.params.id]);
    if (n.nb === 0) return res.status(400).json({ error: 'Aucune palette pesée : impossible de clôturer' });
    await changerStatut(req, res, next, ['EN_COURS', 'INTERROMPUE'], 'TERMINEE', true);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.chargerPesee = chargerPesee;
