const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const router = express.Router();

// Bascule 1 = config.json (fichier historique, toujours lu par "node bridge.js" sans argument).
// Bascule 2 = config-bascule2.json (entrepôts à double bascule, ex. cacao brousse) —
// "node bridge.js --config=config-bascule2.json" la lit. Absente par défaut (Activee=false tant
// qu'elle n'a jamais été enregistrée).
function cheminConfig(numero) {
  const fichier = numero === 2 ? 'config-bascule2.json' : 'config.json';
  return path.join(__dirname, '../../scale-bridge', fichier);
}

function numeroValide(req, res) {
  const numero = Number(req.params.numero);
  if (numero !== 1 && numero !== 2) {
    res.status(400).json({ error: 'Numéro de bascule invalide (1 ou 2)' });
    return null;
  }
  return numero;
}

// Lecture de la configuration courante d'une bascule (1 ou 2)
router.get('/config/:numero', (req, res, next) => {
  try {
    const numero = numeroValide(req, res);
    if (numero === null) return;
    const cheminFichier = cheminConfig(numero);
    if (!fs.existsSync(cheminFichier)) {
      return res.json({ activee: false, port: '', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, delimiter: '\\r\\n', regexPoids: '', marqueurStable: '', serveur: 'http://localhost:3000', token: '', intervalleEnvoiMs: 300 });
    }
    const raw = JSON.parse(fs.readFileSync(cheminFichier, 'utf8'));
    const { activee, port, baudRate, dataBits, parity, stopBits, delimiter, regexPoids, marqueurStable, serveur, token, intervalleEnvoiMs } = raw;
    // Un config.json écrit avant l'ajout de ce champ (postes déjà en service) n'a pas "activee" :
    // on considère alors la bascule active dès qu'un port est déjà configuré (comportement d'avant,
    // où la seule présence d'un port suffisait à faire tourner le pont).
    const activeeEffective = activee === undefined ? Boolean(port) : Boolean(activee);
    res.json({ activee: activeeEffective, port, baudRate, dataBits, parity, stopBits, delimiter: delimiter ?? '\\r\\n', regexPoids, marqueurStable, serveur, token, intervalleEnvoiMs });
  } catch (err) { next(err); }
});

// Sauvegarde de la configuration d'une bascule (1 ou 2)
router.put('/config/:numero', (req, res, next) => {
  try {
    const numero = numeroValide(req, res);
    if (numero === null) return;
    const cheminFichier = cheminConfig(numero);
    const b = req.body;
    if (b.activee) {
      if (!b.port || !String(b.port).trim()) return res.status(400).json({ error: 'Le port COM est obligatoire' });
      if (!b.regexPoids || !String(b.regexPoids).trim()) return res.status(400).json({ error: 'La regex poids est obligatoire' });
      try { new RegExp(b.regexPoids); } catch (e) { return res.status(400).json({ error: 'Regex invalide : ' + e.message }); }
    }

    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(cheminFichier, 'utf8')); } catch {}

    const config = {
      ...existing,
      numeroBascule: numero,
      activee: Boolean(b.activee),
      port: String(b.port || '').trim(),
      baudRate: Number(b.baudRate) || 9600,
      dataBits: Number(b.dataBits) || 8,
      parity: String(b.parity || 'none'),
      stopBits: Number(b.stopBits) || 1,
      delimiter: String(b.delimiter ?? '\\r\\n'),
      regexPoids: String(b.regexPoids || '').trim(),
      marqueurStable: String(b.marqueurStable || ''),
      serveur: String(b.serveur || 'http://localhost:3000').trim(),
      token: String(b.token || '').trim(),
      intervalleEnvoiMs: Number(b.intervalleEnvoiMs) || 300
    };
    fs.writeFileSync(cheminFichier, JSON.stringify(config, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Liste des ports COM disponibles (via bridge.js --liste-ports --json)
router.get('/ports', (req, res) => {
  execFile(
    process.execPath,
    [path.join(__dirname, '../../scale-bridge/bridge.js'), '--liste-ports', '--json'],
    { timeout: 6000 },
    (_err, stdout) => {
      try { res.json(JSON.parse(stdout.trim())); }
      catch { res.json([]); }
    }
  );
});

module.exports = router;
