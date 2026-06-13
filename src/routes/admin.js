const express = require('express');
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');

const router = express.Router();

const MOT_CONFIRMATION = 'REINITIALISER';

// POST /api/admin/reinitialiser
// body: { mode: 'pesees' | 'complet', confirmation: 'REINITIALISER' }
router.post('/reinitialiser', async (req, res, next) => {
  const { mode, confirmation } = req.body;
  if (confirmation !== MOT_CONFIRMATION) {
    return res.status(400).json({ error: `Mot de confirmation incorrect — saisissez exactement : ${MOT_CONFIRMATION}` });
  }
  if (!['pesees', 'complet'].includes(mode)) {
    return res.status(400).json({ error: 'Mode invalide' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // Toujours vider les données de pesées
    await conn.query('TRUNCATE TABLE pesee_lignes');
    await conn.query('TRUNCATE TABLE pesees');
    await conn.query('TRUNCATE TABLE compteurs');

    if (mode === 'complet') {
      // Vider aussi les référentiels
      for (const t of ['clients', 'fournisseurs', 'transporteurs', 'vehicules', 'chauffeurs', 'produits', 'emballages', 'sites', 'quarts']) {
        await conn.query(`TRUNCATE TABLE ${t}`);
      }
      // Conserver uniquement l'utilisateur admin courant, supprimer les autres
      const adminId = req.session.user.id;
      await conn.query('DELETE FROM users WHERE id != ?', [adminId]);
      // Réinitialiser le mot de passe admin à admin123
      const hash = await bcrypt.hash('admin123', 10);
      await conn.query('UPDATE users SET password_hash = ?, nom_complet = ?, role = ? WHERE id = ?',
        [hash, 'Administrateur', 'ADMIN', adminId]);

      // Ré-insérer les données de référence de démarrage
      const seeds = [
        ['produits',     '(code, libelle, nature)',          "'004', 'CACAO EXPORT', 'CACAO ORDINAIRE'"],
        ['emballages',   '(code, libelle, poids_unitaire)',  "'SJT', 'SAC JUTE BROUSSE', 0.670"],
        ['clients',      '(code, libelle)',                  "'001ECO', 'ECOOKIM'"],
        ['fournisseurs', '(code, libelle)',                  "'FO000001', 'SIMAT'"],
        ['transporteurs','(code, libelle)',                  "'SIMTP1', 'TRANSPORTEUR INDEPENDANT'"],
        ['sites',        '(code, libelle)',                  "'001', 'PESE PALETTE SIMAT SP'"],
        ['quarts',       '(code, libelle)',                  "'001', 'EQUIPE DU JOUR'"],
      ];
      for (const [table, cols, vals] of seeds) {
        await conn.query(`INSERT IGNORE INTO ${table} ${cols} VALUES (${vals})`);
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    res.json({ ok: true, mode });
  } catch (err) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;
