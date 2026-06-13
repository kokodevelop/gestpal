const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Non authentifié' });
}
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'ADMIN') return next();
  return res.status(403).json({ error: 'Réservé à l\'administrateur' });
}

// Connexion
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ? AND actif = 1', [username]);
    if (rows.length === 0 || !(await bcrypt.compare(password || '', rows[0].password_hash))) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }
    const u = rows[0];
    req.session.user = { id: u.id, username: u.username, nom_complet: u.nom_complet, role: u.role };
    res.json({ user: req.session.user });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// Changement de son propre mot de passe
router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const { ancien, nouveau } = req.body;
    if (!nouveau || nouveau.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min.)' });
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
    if (!(await bcrypt.compare(ancien || '', rows[0].password_hash))) {
      return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    }
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nouveau, 10), req.session.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------- Gestion des utilisateurs (admin) ----------
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, username, nom_complet, role, actif, created_at FROM users ORDER BY username');
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { username, password, nom_complet, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
    const [r] = await pool.query(
      'INSERT INTO users (username, password_hash, nom_complet, role) VALUES (?, ?, ?, ?)',
      [username.trim(), await bcrypt.hash(password, 10), nom_complet || '', role || 'OPERATEUR']
    );
    res.json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Cet identifiant existe déjà' });
    next(err);
  }
});

router.put('/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nom_complet, role, actif, password } = req.body;
    await pool.query('UPDATE users SET nom_complet = ?, role = ?, actif = ? WHERE id = ?', [
      nom_complet || '', role || 'OPERATEUR', actif ? 1 : 0, req.params.id
    ]);
    if (password) {
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
