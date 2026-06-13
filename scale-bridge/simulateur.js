/**
 * GESTPAL — Simulateur de bascule (pour tester sans matériel)
 * Envoie un poids fictif qui varie, avec stabilisation périodique,
 * directement au serveur GESTPAL (sans port série).
 *
 *   node simulateur.js
 */
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

let cible = 947; // poids visé (kg)
let poids = 0;
let stableDepuis = 0;

setInterval(() => {
  // Le poids converge vers la cible avec un peu de bruit
  const ecart = cible - poids;
  poids = Math.round((poids + ecart * 0.3 + (Math.random() - 0.5) * 2) * 100) / 100;
  const stable = Math.abs(ecart) < 1;
  stableDepuis = stable ? stableDepuis + 1 : 0;

  // Toutes les ~15 s, on change de "palette" : nouveau poids cible
  if (stableDepuis > 25) {
    cible = Math.round((1500 + Math.random() * 1500) * 100) / 100;
    stableDepuis = 0;
  }

  fetch(config.serveur + '/api/bascule/poids', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bridge-token': config.token },
    body: JSON.stringify({ poids, stable })
  }).catch((e) => console.error('Serveur injoignable :', e.message));

  process.stdout.write(`\rSimulateur : ${poids.toFixed(2).padStart(9)} kg ${stable ? '[STABLE]   ' : '[mouvement]'}`);
}, 400);

console.log('Simulateur de bascule démarré →', config.serveur, '(Ctrl+C pour arrêter)');
