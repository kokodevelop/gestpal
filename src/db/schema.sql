-- GESTPAL - Schéma de base de données (MySQL 8)
CREATE DATABASE IF NOT EXISTS gestpal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE gestpal;

-- ---------- Utilisateurs ----------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  nom_complet VARCHAR(100) NOT NULL DEFAULT '',
  role ENUM('ADMIN','SUPERVISEUR','OPERATEUR') NOT NULL DEFAULT 'OPERATEUR',
  actif TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- Référentiels ----------
CREATE TABLE IF NOT EXISTS produits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  nature VARCHAR(100) NOT NULL DEFAULT '',
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emballages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  poids_unitaire DECIMAL(8,3) NOT NULL DEFAULT 0, -- kg par sac/emballage
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fournisseurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transporteurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vehicules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,   -- immatriculation / n° véhicule
  libelle VARCHAR(100) NOT NULL DEFAULT '',
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chauffeurs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,      -- nom du chauffeur
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quarts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  actif TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- ---------- Compteur de numérotation des tickets (par site et par année) ----------
CREATE TABLE IF NOT EXISTS compteurs (
  site_id INT NOT NULL,
  annee SMALLINT NOT NULL,
  dernier INT NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, annee)
) ENGINE=InnoDB;

-- ---------- Pesées (en-tête) ----------
CREATE TABLE IF NOT EXISTS pesees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero_ticket VARCHAR(30) NOT NULL UNIQUE,
  numero_lot VARCHAR(30) NOT NULL DEFAULT '',
  numero_bordereau VARCHAR(30) NOT NULL DEFAULT '',
  campagne VARCHAR(20) NOT NULL DEFAULT '',
  mouvement VARCHAR(30) NOT NULL DEFAULT '1 - STOCKAGE',
  statut ENUM('EN_COURS','INTERROMPUE','TERMINEE','ANNULEE') NOT NULL DEFAULT 'EN_COURS',
  produit_id INT NOT NULL,
  emballage_id INT NOT NULL,
  client_id INT NULL,
  fournisseur_id INT NULL,
  transporteur_id INT NULL,
  site_id INT NOT NULL,
  quart_id INT NULL,
  vehicule VARCHAR(30) NOT NULL DEFAULT '',
  remorque VARCHAR(30) NOT NULL DEFAULT '',
  chauffeur VARCHAR(60) NOT NULL DEFAULT '',
  destination VARCHAR(100) NOT NULL DEFAULT '',
  provenance VARCHAR(100) NOT NULL DEFAULT '',
  n_livraison VARCHAR(30) NOT NULL DEFAULT '',
  n_connaissement VARCHAR(30) NOT NULL DEFAULT '',
  n_permis VARCHAR(30) NOT NULL DEFAULT '',
  nature_produit VARCHAR(100) NOT NULL DEFAULT '',
  tare_palettes DECIMAL(10,2) NOT NULL DEFAULT 0,  -- poids total des palettes vides (pesées en une fois)
  nb_palettes INT NOT NULL DEFAULT 0,
  max_sacs INT NOT NULL DEFAULT 0,                  -- 0 = sans limite ; >0 = nombre total de sacs maximum autorisé
  poids_unitaire_emb DECIMAL(8,3) NOT NULL DEFAULT 0, -- copie du poids unitaire emballage au moment de la pesée
  date_debut DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_fin DATETIME NULL,
  observations TEXT NULL,
  cree_par INT NULL,
  CONSTRAINT fk_pesee_produit FOREIGN KEY (produit_id) REFERENCES produits(id),
  CONSTRAINT fk_pesee_emballage FOREIGN KEY (emballage_id) REFERENCES emballages(id),
  CONSTRAINT fk_pesee_client FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_pesee_fournisseur FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id),
  CONSTRAINT fk_pesee_transporteur FOREIGN KEY (transporteur_id) REFERENCES transporteurs(id),
  CONSTRAINT fk_pesee_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_pesee_quart FOREIGN KEY (quart_id) REFERENCES quarts(id),
  CONSTRAINT fk_pesee_user FOREIGN KEY (cree_par) REFERENCES users(id),
  INDEX idx_pesees_statut (statut),
  INDEX idx_pesees_date (date_debut)
) ENGINE=InnoDB;

-- ---------- Lignes de pesée (une ligne = une palette chargée) ----------
CREATE TABLE IF NOT EXISTS pesee_lignes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pesee_id INT NOT NULL,
  ordre INT NOT NULL,
  poids_brut DECIMAL(10,2) NOT NULL,          -- palette + sacs + produit
  nb_emb INT NOT NULL,                         -- nombre de sacs sur la palette
  tare_emb DECIMAL(10,2) NOT NULL,             -- nb_emb x poids unitaire emballage
  poids_net DECIMAL(10,2) NOT NULL,            -- brut - tare_emb (palette incluse, déduite en fin)
  pese_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pese_par INT NULL,
  CONSTRAINT fk_ligne_pesee FOREIGN KEY (pesee_id) REFERENCES pesees(id) ON DELETE CASCADE,
  CONSTRAINT fk_ligne_user FOREIGN KEY (pese_par) REFERENCES users(id),
  UNIQUE KEY uq_ligne_ordre (pesee_id, ordre)
) ENGINE=InnoDB;
