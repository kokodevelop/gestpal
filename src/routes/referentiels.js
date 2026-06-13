const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// Tables de référence autorisées et leurs colonnes éditables
const TABLES = {
  produits: ['code', 'libelle', 'nature'],
  emballages: ['code', 'libelle', 'poids_unitaire'],
  clients: ['code', 'libelle'],
  fournisseurs: ['code', 'libelle'],
  transporteurs: ['code', 'libelle'],
  vehicules: ['code', 'libelle'],
  chauffeurs: ['code', 'libelle'],
  sites: ['code', 'libelle'],
  quarts: ['code', 'libelle']
};

function tableOr404(req, res) {
  const t = req.params.table;
  if (!TABLES[t]) {
    res.status(404).json({ error: 'Référentiel inconnu' });
    return null;
  }
  return t;
}

// Liste
router.get('/:table', async (req, res, next) => {
  const t = tableOr404(req, res);
  if (!t) return;
  try {
    const [rows] = await pool.query(`SELECT * FROM ${t} ORDER BY code`);
    res.json(rows);
  } catch (err) { next(err); }
});

// Création
router.post('/:table', async (req, res, next) => {
  const t = tableOr404(req, res);
  if (!t) return;
  try {
    const cols = TABLES[t];
    const values = cols.map((c) => req.body[c] ?? (c === 'poids_unitaire' ? 0 : ''));
    if (!req.body.code || !String(req.body.code).trim()) return res.status(400).json({ error: 'Le code est obligatoire' });
    const [r] = await pool.query(
      `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      values
    );
    res.json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ce code existe déjà' });
    next(err);
  }
});

// Modification
router.put('/:table/:id', async (req, res, next) => {
  const t = tableOr404(req, res);
  if (!t) return;
  try {
    const cols = TABLES[t];
    const sets = cols.map((c) => `${c} = ?`).join(', ');
    const values = cols.map((c) => req.body[c] ?? (c === 'poids_unitaire' ? 0 : ''));
    await pool.query(`UPDATE ${t} SET ${sets}, actif = ? WHERE id = ?`, [...values, req.body.actif ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Ce code existe déjà' });
    next(err);
  }
});

// Suppression (refusée si utilisé par une pesée)
router.delete('/:table/:id', async (req, res, next) => {
  const t = tableOr404(req, res);
  if (!t) return;
  try {
    await pool.query(`DELETE FROM ${t} WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ error: 'Suppression impossible : utilisé par des pesées. Désactivez-le plutôt.' });
    }
    next(err);
  }
});

module.exports = router;
