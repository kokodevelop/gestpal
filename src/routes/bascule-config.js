const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../../scale-bridge/config.json');

// Lecture de la configuration courante
router.get('/config', (req, res, next) => {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const { port, baudRate, dataBits, parity, stopBits, delimiter, regexPoids, marqueurStable, serveur, token, intervalleEnvoiMs } = raw;
    res.json({ port, baudRate, dataBits, parity, stopBits, delimiter: delimiter ?? '\\r\\n', regexPoids, marqueurStable, serveur, token, intervalleEnvoiMs });
  } catch (err) { next(err); }
});

// Sauvegarde de la configuration
router.put('/config', (req, res, next) => {
  try {
    const b = req.body;
    if (!b.port || !String(b.port).trim()) return res.status(400).json({ error: 'Le port COM est obligatoire' });
    if (!b.regexPoids || !String(b.regexPoids).trim()) return res.status(400).json({ error: 'La regex poids est obligatoire' });
    try { new RegExp(b.regexPoids); } catch (e) { return res.status(400).json({ error: 'Regex invalide : ' + e.message }); }

    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

    const config = {
      ...existing,
      port: String(b.port).trim(),
      baudRate: Number(b.baudRate) || 9600,
      dataBits: Number(b.dataBits) || 8,
      parity: String(b.parity || 'none'),
      stopBits: Number(b.stopBits) || 1,
      delimiter: String(b.delimiter ?? '\\r\\n'),
      regexPoids: String(b.regexPoids).trim(),
      marqueurStable: String(b.marqueurStable || ''),
      serveur: String(b.serveur || 'http://localhost:3000').trim(),
      token: String(b.token || '').trim(),
      intervalleEnvoiMs: Number(b.intervalleEnvoiMs) || 300
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
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
