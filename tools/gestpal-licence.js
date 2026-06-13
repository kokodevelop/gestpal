/**
 * GESTPAL — Générateur de licences clients
 *
 * Usage :
 *   node tools/gestpal-licence.js --client "ACME CACAO SARL" --expires 2027-12-31
 *   node tools/gestpal-licence.js --client "ACME" --expires 2027-12-31 --machine A3F2B7E1 --site "San Pedro"
 *
 * La clé générée est à transmettre au client pour activation dans GESTPAL.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

const client  = getArg('client');
const expires = getArg('expires');
const machine = getArg('machine');
const site    = getArg('site') || '';

if (!client || !expires) {
  console.error('\nUsage :');
  console.error('  node tools/gestpal-licence.js --client "Nom Client" --expires YYYY-MM-DD [--machine XXXXXXXX] [--site "Site"]\n');
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
  console.error('\nErreur : La date doit être au format YYYY-MM-DD (ex: 2027-12-31)\n');
  process.exit(1);
}

const privateKeyPath = path.join(__dirname, 'gestpal-private.pem');
if (!fs.existsSync(privateKeyPath)) {
  console.error('\nErreur : Clé privée introuvable (tools/gestpal-private.pem).');
  console.error('Contactez le développeur pour obtenir la clé privée.\n');
  process.exit(1);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

const payload = { v: 1, client, site, expires, issued: new Date().toISOString().slice(0, 10) };
if (machine) payload.machine = machine.toUpperCase().replace(/[^A-F0-9]/g, '');

const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

const sign = crypto.createSign('SHA256');
sign.update(payloadB64);
const signature = sign.sign(privateKey, 'base64url');

const licenceKey = `GESTPAL-${payloadB64}.${signature}`;

const outPath = path.join(process.cwd(), `licence-${client.replace(/[^a-zA-Z0-9]/g, '_')}.key`);
fs.writeFileSync(outPath, licenceKey, 'utf8');

console.log('\n✅ Licence générée avec succès !\n');
console.log(`   Client  : ${client}`);
if (site)    console.log(`   Site    : ${site}`);
console.log(`   Expire  : ${expires}`);
if (machine) console.log(`   Machine : ${machine}`);
console.log(`   Émis le : ${payload.issued}`);
console.log('');
console.log('Clé de licence (copier-coller pour le client) :');
console.log('─'.repeat(70));
console.log(licenceKey);
console.log('─'.repeat(70));
console.log('');
console.log(`Fichier sauvegardé : ${outPath}`);
console.log('→ Le client doit copier ce fichier en "licence.key" dans le dossier GESTPAL,');
console.log('  ou saisir la clé directement dans l\'interface d\'activation.\n');
