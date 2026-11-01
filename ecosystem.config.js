const fs = require('fs');
const path = require('path');

const scaleBridgeDir = path.join(__dirname, 'scale-bridge');

const apps = [
  {
    name: 'gestpal-server',
    script: 'src/server.js',
    cwd: __dirname,
    watch: false,
    restart_delay: 3000,
    max_restarts: 10,
    env: { NODE_ENV: 'production' }
  },
  {
    name: 'gestpal-bridge',
    script: 'bridge.js',
    cwd: scaleBridgeDir,
    watch: false,
    restart_delay: 5000,   // laisse le temps au port série de se libérer
    max_restarts: 50,      // tolérant : le port peut être occupé plusieurs fois de suite
    autorestart: true      // redémarre sur TOUT exit (crash, config reload, etc.)
  }
];

// Entrepôts à DOUBLE bascule (ex. cacao brousse) uniquement : ce 2e pont n'est ajouté QUE si
// scale-bridge/config-bascule2.json existe déjà (écrit par Admin → Configuration bascule →
// section Bascule 2 → Activée → Enregistrer). Détection automatique plutôt qu'un bloc à
// décommenter à la main : ce fichier reste identique à celui du dépôt Git sur tous les postes,
// donc "git pull" (mise à jour) ne peut jamais entrer en conflit avec une modification locale ici.
if (fs.existsSync(path.join(scaleBridgeDir, 'config-bascule2.json'))) {
  apps.push({
    name: 'gestpal-bridge-2',
    script: 'bridge.js',
    args: '--config=config-bascule2.json',
    cwd: scaleBridgeDir,
    watch: false,
    restart_delay: 5000,
    max_restarts: 50,
    autorestart: true
  });
}

module.exports = { apps };
