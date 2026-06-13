require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('io', io);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'gestpal',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 12 * 60 * 60 * 1000 } // 12 h (un quart de travail)
  })
);

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

// ---------- Bascule : réception du poids depuis le pont série ----------
let dernierPoids = { poids: 0, stable: false, recu_le: null };

app.post('/api/bascule/poids', (req, res) => {
  const token = req.headers['x-bridge-token'];
  if (token !== (process.env.BRIDGE_TOKEN || '')) {
    return res.status(403).json({ error: 'Jeton bascule invalide' });
  }
  const poids = Number(req.body.poids);
  if (!Number.isFinite(poids)) return res.status(400).json({ error: 'Poids invalide' });
  dernierPoids = { poids, stable: Boolean(req.body.stable), recu_le: new Date().toISOString() };
  io.emit('poids', dernierPoids);
  res.json({ ok: true });
});

app.get('/api/bascule/poids', requireAuth, (req, res) => res.json(dernierPoids));

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
