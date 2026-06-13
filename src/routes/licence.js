const express = require('express');
const fs      = require('fs');
const { verifierLicence, invaliderCache, LICENCE_PATH } = require('../licence/verifier');
const { getMachineCode } = require('../licence/machine');

const router = express.Router();

// GET /api/licence/info — état de la licence (public, pas d'auth requise)
router.get('/info', (req, res) => {
  const r = verifierLicence();
  res.json({ ...r, machineCode: getMachineCode() });
});

// POST /api/licence/activer — active une licence en écrivant licence.key
router.post('/activer', (req, res) => {
  const { cle } = req.body;
  if (!cle || typeof cle !== 'string' || !cle.trim()) {
    return res.status(400).json({ error: 'Clé de licence manquante' });
  }

  try {
    fs.writeFileSync(LICENCE_PATH, cle.trim(), 'utf8');
  } catch (err) {
    return res.status(500).json({ error: 'Impossible d\'écrire le fichier de licence : ' + err.message });
  }

  invaliderCache();
  const r = verifierLicence(true);

  if (!r.valide) {
    try { fs.unlinkSync(LICENCE_PATH); } catch {}
    invaliderCache();
    return res.status(400).json({ error: r.raison });
  }

  res.json({ ok: true, ...r });
});

module.exports = router;
