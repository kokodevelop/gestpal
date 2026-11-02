require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const refRoutes = require('./routes/referentiels');
const peseeRoutes = require('./routes/pesees');
const rapportRoutes = require('./routes/rapports');
const basculeConfigRoutes = require('./routes/bascule-config');
const adminRoutes = require('./routes/admin');
const licenceRoutes = require('./routes/licence');
const checkLicence = require('./middleware/checkLicence');
const { renderTicket } = require('./routes/ticket');

// Pas de secours codé en dur : un secret de session faible/prévisible permettrait de forger des
// cookies de session. deployer.ps1 en génère toujours un aléatoire à l'installation — si cette
// variable manque, mieux vaut refuser de démarrer que de tourner avec un secret devinable.
if (!process.env.SESSION_SECRET) {
  console.error('[FATAL] SESSION_SECRET manquant dans .env — démarrage refusé (voir .env.example).');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('io', io);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 12 * 60 * 60 * 1000, // 12 h (un quart de travail)
      httpOnly: true, // inaccessible en JS côté navigateur (protection contre le vol de cookie via XSS)
      sameSite: 'strict', // le cookie ne part jamais vers une requête déclenchée depuis un autre site (protection CSRF)
      // secure (cookie envoyé uniquement en HTTPS) intentionnellement pas activé : le déploiement
      // actuel tourne en HTTP sur réseau local. À passer à true dès qu'un reverse proxy HTTPS est
      // mis en place devant le serveur (sinon le cookie ne serait plus jamais envoyé).
      secure: process.env.COOKIE_SECURE === 'true'
    }
  })
);

// Limite les tentatives de connexion (protection brute-force) — 10 essais / 15 min par IP,
// au-delà le serveur répond 429 sans même vérifier le mot de passe.
const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion — réessayez dans quelques minutes.' }
});
app.use('/api/auth/login', limiteurConnexion);

// ---------- Middlewares d'authentification ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Non authentifié' });
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.role)) return next();
    return res.status(403).json({ error: 'Droits insuffisants' });
  };
}
app.set('requireAuth', requireAuth);
app.set('requireRole', requireRole);

// Tant que l'utilisateur est connecté avec le mot de passe par défaut (cf. doitChangerMotDePasse
// dans auth.js), bloque toute route API autre que celles nécessaires pour changer son mot de passe
// ou se déconnecter — défense en profondeur : même si le frontend ne forçait pas l'écran de
// changement (bug, appel direct à l'API...), le serveur refuse quand même d'exécuter quoi que ce
// soit d'autre. Les pages/fichiers statiques restent servis normalement (sinon l'écran de
// changement de mot de passe lui-même ne pourrait plus se charger).
const ROUTES_AUTORISEES_SI_CHANGEMENT_REQUIS = new Set(['/api/auth/password', '/api/auth/logout', '/api/auth/me']);
function requireMotDePasseChange(req, res, next) {
  if (!req.session.user || !req.session.user.doitChangerMotDePasse) return next();
  if (!req.path.startsWith('/api/')) return next();
  if (ROUTES_AUTORISEES_SI_CHANGEMENT_REQUIS.has(req.path)) return next();
  return res.status(403).json({ error: 'Changement de mot de passe obligatoire', doitChangerMotDePasse: true });
}
app.use(requireMotDePasseChange);

// ---------- Bascule : réception du poids depuis le pont série ----------
// Une entrée par bascule (1 et 2) — les entrepôts à une seule bascule (majorité des postes)
// n'alimentent jamais l'entrée 2, qui reste à son état initial.
let dernierPoids = {
  1: { poids: 0, stable: false, recu_le: null },
  2: { poids: 0, stable: false, recu_le: null }
};

app.post('/api/bascule/poids', (req, res) => {
  const token = req.headers['x-bridge-token'];
  if (token !== (process.env.BRIDGE_TOKEN || '')) {
    return res.status(403).json({ error: 'Jeton bascule invalide' });
  }
  const poids = Number(req.body.poids);
  if (!Number.isFinite(poids)) return res.status(400).json({ error: 'Poids invalide' });
  const numeroBascule = Number(req.body.numeroBascule) === 2 ? 2 : 1;
  dernierPoids[numeroBascule] = { poids, stable: Boolean(req.body.stable), recu_le: new Date().toISOString() };
  io.emit('poids', { numeroBascule, ...dernierPoids[numeroBascule] });
  res.json({ ok: true });
});

app.get('/api/bascule/poids', requireAuth, (req, res) => res.json(dernierPoids));

// Accessible à tout utilisateur connecté (pas réservé ADMIN, contrairement à /api/bascule/config) :
// les opérateurs doivent savoir si le sélecteur Bascule 1/2/Cumul doit s'afficher sur les écrans de
// pesée, sans avoir les droits d'admin pour autant.
function basculeEstActivee(numero) {
  const fichier = numero === 2 ? 'config-bascule2.json' : 'config.json';
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../scale-bridge', fichier), 'utf8'));
    return raw.activee === undefined ? Boolean(raw.port) : Boolean(raw.activee);
  } catch {
    return false;
  }
}
app.get('/api/bascule/etat', requireAuth, (req, res) => {
  res.json({ bascule1Active: basculeEstActivee(1), bascule2Active: basculeEstActivee(2) });
});

// ---------- Licence ----------
app.use('/api/licence', licenceRoutes);
app.use(checkLicence);   // bloque toutes les routes API si licence invalide

// ---------- Routes API ----------
app.use('/api/auth', authRoutes);
app.use('/api/ref', requireAuth, refRoutes);
app.use('/api/pesees', requireAuth, peseeRoutes);
app.use('/api/rapports', requireAuth, rapportRoutes);
app.use('/api/bascule', requireAuth, requireRole('ADMIN'), basculeConfigRoutes);
app.use('/api/admin',  requireAuth, requireRole('ADMIN'), adminRoutes);

// ---------- Ticket imprimable ----------
app.get('/ticket/:id', async (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  try {
    res.send(await renderTicket(req.params.id));
  } catch (err) {
    res.status(404).send('Ticket introuvable : ' + err.message);
  }
});

// ---------- Frontend statique ----------
express.static.mime.define({ 'application/manifest+json': ['webmanifest'] });
app.use(express.static(path.join(__dirname, '..', 'public')));

// Page d'accueil : redirige vers login si pas de session
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', req.session.user ? 'index.html' : 'login.html'));
});

// Gestion d'erreurs JSON
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erreur serveur' });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`GESTPAL démarré : http://localhost:${PORT}`);
});
