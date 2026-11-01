/**
 * GESTPAL — Simulateur de bascule (pour tester sans matériel)
 * Envoie un poids fictif qui varie, avec stabilisation périodique,
 * directement au serveur GESTPAL (sans port série).
 *
 *   node simulateur.js
 *   node simulateur.js --config=config-bascule2.json   simule la 2e bascule (double bascule)
 */
const fs = require('fs');
const path = require('path');

const argConfig = process.argv.find((a) => a.startsWith('--config='));
const configPath = argConfig ? path.join(__dirname, argConfig.slice('--config='.length)) : path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const numeroBascule = Number(config.numeroBascule) === 2 ? 2 : 1;

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
    body: JSON.stringify({ poids, stable, numeroBascule })
  }).catch((e) => console.error('Serveur injoignable :', e.message));

  process.stdout.write(`\rSimulateur bascule ${numeroBascule} : ${poids.toFixed(2).padStart(9)} kg ${stable ? '[STABLE]   ' : '[mouvement]'}`);
}, 400);

console.log(`Simulateur de bascule ${numeroBascule} démarré →`, config.serveur, '(Ctrl+C pour arrêter)');
