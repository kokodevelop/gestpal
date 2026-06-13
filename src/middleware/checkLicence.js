const { verifierLicence } = require('../licence/verifier');

// Préfixes exemptés du contrôle de licence
const LIBRES = ['/api/licence', '/sw.js', '/manifest.webmanifest', '/icons/', '/css/', '/js/', '/guide'];

function checkLicence(req, res, next) {
  if (req.path === '/' || LIBRES.some(p => req.path.startsWith(p))) return next();
  const r = verifierLicence();
  if (!r.valide) {
    return res.status(402).json({ error: 'LICENCE_INVALIDE', detail: r.raison });
  }
  next();
}

module.exports = checkLicence;
