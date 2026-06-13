/**
 * GESTPAL — Pont bascule (RS232/USB)
 * Lit en continu le port série de l'indicateur de pesage et pousse le poids
 * vers le serveur GESTPAL (POST /api/bascule/poids).
 *
 *   node bridge.js                    démarre le pont (config.json)
 *   node bridge.js --liste-ports      liste les ports COM disponibles
 *   node bridge.js --liste-ports --json   idem, sortie JSON
 *   node bridge.js --debug            affiche les trames brutes reçues (diagnostic)
 */
const fs = require('fs');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const DEBUG = process.argv.includes('--debug');

// Assure que PM2 redémarre le bridge sur tout crash non géré (exit code ≠ 0)
process.on('uncaughtException', (err) => {
  console.error('\n[FATAL] Exception non gérée :', err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('\n[FATAL] Promesse rejetée non gérée :', reason);
  process.exit(1);
});

async function listerPorts() {
  const ports = await SerialPort.list();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(ports.map((p) => ({
      path: p.path,
      description: [p.manufacturer, p.friendlyName].filter(Boolean).join(' — ')
    }))));
    return;
  }
  console.log('Ports série détectés :');
  for (const p of ports) {
    console.log(`  ${p.path}  ${p.manufacturer || ''} ${p.friendlyName || ''}`);
  }
  if (ports.length === 0) console.log('  (aucun)');
}

let dernierEnvoi = 0;
async function envoyer(poids, stable) {
  const maintenant = Date.now();
  if (maintenant - dernierEnvoi < (config.intervalleEnvoiMs || 300)) return;
  dernierEnvoi = maintenant;
  try {
    const res = await fetch(config.serveur + '/api/bascule/poids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-token': config.token || '' },
      body: JSON.stringify({ poids, stable })
    });
    if (!res.ok) {
      const texte = await res.text();
      console.error(`\n[ERREUR] Serveur a refusé le poids (HTTP ${res.status}) : ${texte}`);
    }
  } catch (err) {
    console.error(`\n[ERREUR] Serveur injoignable : ${err.message}`);
  }
}

// Convertit une chaîne d'échappement config en délimiteur réel
// ex: "\\r\\n" → "\r\n",  "\\r" → "\r",  "\\n" → "\n",  "\\x03" → "\x03"
function parseDelimiter(s) {
  if (!s) return '\r\n';
  return s.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Indique que la fermeture est intentionnelle (rechargement config)
// → le handler port.on('close') ne tente pas de reconnecter
let fermetureIntentionnelle = false;

function demarrer() {
  const port = new SerialPort({
    path: config.port,
    baudRate: config.baudRate ?? 9600,
    dataBits: config.dataBits ?? 8,
    parity: config.parity ?? 'none',
    stopBits: config.stopBits ?? 1,
    autoOpen: false
  });

  const delimiteur = parseDelimiter(config.delimiter);
  const parser = port.pipe(new ReadlineParser({ delimiter: delimiteur }));
  const regex = new RegExp(config.regexPoids);

  port.open((err) => {
    if (err) {
      console.error(`\n[ERREUR] Impossible d'ouvrir ${config.port} : ${err.message}`);
      console.error('Nouvel essai dans 5 s… (vérifiez le câble et le n° de port : node bridge.js --liste-ports)');
      setTimeout(demarrer, 5000);
      return;
    }
    const delimAff = config.delimiter || '\\r\\n';
    console.log(`\n=== Pont bascule démarré (PID ${process.pid}) ===`);
    console.log(`    Port    : ${config.port} @ ${config.baudRate} bauds`);
    console.log(`    Délimit : "${delimAff}"  Regex : /${config.regexPoids}/`);
    console.log(`    Serveur : ${config.serveur}`);
    console.log(`    Token   : ${config.token ? '(configuré)' : '(vide — ok si BRIDGE_TOKEN non défini dans .env)'}`);
    if (DEBUG) console.log('[DEBUG] Mode diagnostic actif — affichage des octets bruts');
  });

  // Mode debug : affiche chaque octet reçu avant le parsing
  if (DEBUG) {
    port.on('data', (chunk) => {
      const hex = Buffer.from(chunk).toString('hex').match(/../g).join(' ');
      const ascii = Buffer.from(chunk).toString().replace(/[\x00-\x1f\x7f-\xff]/g, (c) => `<${c.charCodeAt(0).toString(16).padStart(2, '0')}>`);
      process.stdout.write(`[RAW] ${hex}  "${ascii}"\n`);
    });
  }

  parser.on('data', (trame) => {
    const texte = String(trame).trim();
    if (!texte) return;
    if (DEBUG) console.log(`[TRAME] "${texte}"`);
    const m = texte.match(regex);
    if (!m) {
      if (DEBUG) console.log(`[REGEX] aucune correspondance avec /${config.regexPoids}/`);
      return;
    }
    const poids = parseFloat(String(m[1]).replace(',', '.'));
    if (!Number.isFinite(poids)) {
      if (DEBUG) console.log(`[REGEX] groupe capturé "${m[1]}" non numérique`);
      return;
    }
    const stable = config.marqueurStable ? texte.includes(config.marqueurStable) : true;
    process.stdout.write(`\r${texte.padEnd(40)} → ${poids} kg ${stable ? '[STABLE]  ' : '[mouvement]'}`);
    envoyer(poids, stable);
  });

  port.on('close', () => {
    if (fermetureIntentionnelle) return; // sortie propre pour rechargement config
    console.error('\nPort fermé — reconnexion dans 5 s…');
    setTimeout(demarrer, 5000);
  });
  port.on('error', (err) => console.error('\nErreur port série :', err.message));
}

if (process.argv.includes('--liste-ports')) {
  listerPorts();
} else {
  // Recharge automatique quand config.json est modifié depuis l'interface admin.
  // En production (PM2) : process.exit(0) → PM2 redémarre après restart_delay (8 s).
  // Sur Windows, fs.watch peut se déclencher à tort sur une modification récente
  // (lors du redémarrage PM2). On ignore tout événement dans les 5 premières secondes.
  const demarrageBridge = Date.now();
  let rechargeProgramme = false;
  fs.watch(configPath, { persistent: false }, () => {
    if (Date.now() - demarrageBridge < 5000) return; // ignorer reliquats Windows
    if (rechargeProgramme) return;
    rechargeProgramme = true;
    console.log('\nConfiguration modifiée — rechargement dans 2 s…');
    fermetureIntentionnelle = true;
    // Code 42 = rechargement config volontaire (distinct du crash code 1 et du stop code 0)
    // PM2 traite exit(0) comme "arrêt volontaire" sur Windows → ne redémarre pas.
    // Un code non-zéro force le redémarrage sans ambiguïté.
    setTimeout(() => process.exit(42), 2000);
  });
  demarrer();
}
