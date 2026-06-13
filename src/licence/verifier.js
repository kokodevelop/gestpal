const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { getMachineCode } = require('./machine');

// Clé publique ECDSA P-256 — NE PAS MODIFIER (invaliderait toutes les licences)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEU+GJoRixyemHNt93ru1Aq8QPCVkC
4ommyoupU6+aj11lVuXJtoa9qdOZ4jCZmppkw+Ab7XgI0zczfLDoy299VQ==
-----END PUBLIC KEY-----`;

const LICENCE_PATH = path.join(process.cwd(), 'licence.key');

let _cache = null;

function verifierLicence(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;

  if (!fs.existsSync(LICENCE_PATH)) {
    return { valide: false, raison: 'Fichier licence.key absent' };
  }

  const contenu = fs.readFileSync(LICENCE_PATH, 'utf8').trim();

  if (!contenu.startsWith('GESTPAL-')) {
    return { valide: false, raison: 'Format de licence invalide' };
  }

  const body     = contenu.slice('GESTPAL-'.length);
  const dotIndex = body.lastIndexOf('.');
  if (dotIndex < 0) return { valide: false, raison: 'Format de licence invalide' };

  const payloadB64   = body.slice(0, dotIndex);
  const signatureB64 = body.slice(dotIndex + 1);

  // Vérifie la signature cryptographique
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(payloadB64);
    if (!verify.verify(PUBLIC_KEY, signatureB64, 'base64url')) {
      return { valide: false, raison: 'Signature invalide — licence falsifiée ou corrompue' };
    }
  } catch {
    return { valide: false, raison: 'Erreur de vérification cryptographique' };
  }

  // Décode le payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valide: false, raison: 'Données de licence corrompues' };
  }

  // Vérifie l'expiration
  const today = new Date().toISOString().slice(0, 10);
  if (payload.expires < today) {
    return { valide: false, expiree: true, raison: `Licence expirée le ${payload.expires}`, payload };
  }

  // Vérifie le verrou machine (si présent dans la licence)
  if (payload.machine) {
    const code = getMachineCode();
    if (payload.machine.toUpperCase() !== code) {
      return { valide: false, raison: `Licence non valide pour cet ordinateur (code machine : ${code})`, payload };
    }
  }

  // Calcule les jours restants
  const msJour    = 1000 * 60 * 60 * 24;
  const joursRestants = Math.ceil((new Date(payload.expires) - new Date(today)) / msJour);

  _cache = { valide: true, payload, joursRestants };
  return _cache;
}

function invaliderCache() { _cache = null; }

module.exports = { verifierLicence, invaliderCache, LICENCE_PATH };
