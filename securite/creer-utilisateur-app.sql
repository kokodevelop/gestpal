-- GESTPAL — Compte MySQL applicatif à privilèges limités.
--
-- Pourquoi : par défaut (deployer.ps1, et .env.example avant ce correctif), l'app peut être
-- configurée avec le compte MySQL root. Si DB_PASSWORD venait à fuiter (.env mal protégé,
-- sauvegarde exposée...), root donne un accès total au serveur MySQL entier — pas seulement à
-- la base gestpal. Un compte dédié, limité à la base gestpal, réduit cet impact. Même script que
-- celui du dépôt GESTPAL-WPF (mêmes deux apps, même base partagée).
--
-- À exécuter UNE FOIS par un administrateur MySQL (avec les droits root), sur le serveur de
-- production. Remplacez 'CHANGEZ-MOI-MOT-DE-PASSE-FORT' par un mot de passe fort et unique, puis
-- reconfigurez l'app (.env : DB_USER/DB_PASSWORD) avec CES identifiants — plus jamais root au
-- quotidien.

CREATE USER IF NOT EXISTS 'gestpal_app'@'%' IDENTIFIED BY 'CHANGEZ-MOI-MOT-DE-PASSE-FORT';

-- Droits standards (lecture/écriture) sur toutes les tables métier de la base gestpal — rien
-- en dehors de cette base, et aucun droit d'administration (CREATE USER, DROP DATABASE, etc.).
GRANT SELECT, INSERT, UPDATE, DELETE ON gestpal.* TO 'gestpal_app'@'%';

-- Le journal d'audit (audit_log, utilisé côté WPF pour l'instant) : lecture + écriture, mais PAS
-- de modification ni de suppression — même avec ces identifiants, personne ne peut se couvrir en
-- effaçant ou en trafiquant une entrée du journal.
REVOKE UPDATE, DELETE ON gestpal.audit_log FROM 'gestpal_app'@'%';

FLUSH PRIVILEGES;

-- Remarques :
-- - 'gestpal_app'@'%' autorise la connexion depuis n'importe quelle adresse IP (nécessaire si le
--   pont bascule ou des postes WPF se connectent directement). Si votre réseau a une plage fixe
--   connue, remplacez '%' par ex. '10.0.0.%' pour restreindre davantage.
-- - Ce compte n'a PAS les droits nécessaires pour exécuter schema.sql/init.js (création de
--   tables, utilisateurs...) : gardez root (ou un compte DBA séparé) pour l'installation/les
--   migrations, et gestpal_app uniquement pour le fonctionnement au quotidien de l'app.
