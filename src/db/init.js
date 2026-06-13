/**
 * Initialise la base de données GESTPAL :
 *   node src/db/init.js
 * - exécute schema.sql (création base + tables)
 * - crée l'utilisateur admin (admin / admin123) s'il n'existe pas
 * - insère quelques données de référence de démarrage
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('Schéma créé / vérifié.');

  // Migration : ajout de max_sacs (bases déjà créées avant cette version)
  await conn.query(`USE \`${process.env.DB_NAME || 'gestpal'}\``);
  try {
    await conn.query('ALTER TABLE pesees ADD COLUMN max_sacs INT NOT NULL DEFAULT 0 COMMENT "0=sans limite ; >0=nb sacs max" AFTER nb_palettes');
    console.log('Migration : colonne max_sacs ajoutée.');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }
  try {
    await conn.query('ALTER TABLE pesee_lignes ADD COLUMN queue_lot TINYINT NOT NULL DEFAULT 0 COMMENT "1=palette hors standard (queue de lot)" AFTER nb_emb');
    console.log('Migration : colonne queue_lot ajoutée.');
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
  }

  await conn.query(`USE \`${process.env.DB_NAME || 'gestpal'}\``);

  // Utilisateur admin par défaut
  const [admins] = await conn.query("SELECT id FROM users WHERE username = 'admin'");
  if (admins.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await conn.query(
      "INSERT INTO users (username, password_hash, nom_complet, role) VALUES ('admin', ?, 'Administrateur', 'ADMIN')",
      [hash]
    );
    console.log("Utilisateur 'admin' créé (mot de passe : admin123 — à changer).");
  }

  // Données de référence de démarrage (ignorées si déjà présentes)
  const seeds = [
    ["produits (code, libelle, nature)", "('004', 'CACAO EXPORT', 'CACAO ORDINAIRE')"],
    ["emballages (code, libelle, poids_unitaire)", "('SJT', 'SAC JUTE BROUSSE', 0.670)"],
    ["clients (code, libelle)", "('001ECO', 'ECOOKIM')"],
    ["fournisseurs (code, libelle)", "('FO000001', 'SIMAT')"],
    ["transporteurs (code, libelle)", "('SIMTP1', 'TRANSPORTEUR INDEPENDANT')"],
    ["sites (code, libelle)", "('001', 'PESE PALETTE SIMAT SP')"],
    ["quarts (code, libelle)", "('001', 'EQUIPE DU JOUR')"]
  ];
  for (const [cols, vals] of seeds) {
    await conn.query(`INSERT IGNORE INTO ${cols.split(' ')[0]} ${cols.substring(cols.indexOf('('))} VALUES ${vals}`);
  }
  console.log('Données de référence insérées.');

  await conn.end();
  console.log('Initialisation terminée.');
}

main().catch((err) => {
  console.error('Erreur initialisation :', err.message);
  process.exit(1);
});
