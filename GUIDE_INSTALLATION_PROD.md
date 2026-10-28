# GESTPAL — Guide d'installation sur un poste de production

Ce guide couvre l'installation complète de GESTPAL (serveur web + pont bascule
RS232) sur un PC Windows de production, depuis zéro. Pour le détail du
fonctionnement métier, voir [README.md](README.md).

---

## 1. Vue d'ensemble

| Composant | Rôle | Tourne sur |
|---|---|---|
| **gestpal-server** | Serveur web (Express + MySQL + Socket.IO) | Le PC serveur (peut être le poste de pesée ou un PC dédié sur le réseau local) |
| **gestpal-bridge** | Pont RS232 → serveur (lit la bascule, pousse le poids) | Le PC physiquement relié à l'indicateur de pesage |
| **MySQL** | Base de données | En général sur le même PC que `gestpal-server` |

Les deux services (`gestpal-server`, `gestpal-bridge`) sont gérés par **PM2**
(démarrage automatique, redémarrage en cas de plantage, démarrage avec Windows).

Si la bascule est branchée sur le **même PC** que le serveur, les deux
composants s'installent ensemble sur une seule machine (cas le plus courant).
Si la bascule est sur un **poste différent**, installez `gestpal-server` sur le
serveur et uniquement `scale-bridge/` (voir §5) sur le poste de pesée, en le
pointant vers l'adresse réseau du serveur.

---

## 2. Prérequis

À installer **avant** de lancer l'installateur, sur le PC serveur :

1. **Windows 10/11** (ou Windows Server), avec accès Administrateur.
2. **Node.js LTS** (20 ou 22) : https://nodejs.org → installeur `.msi`, cocher
   "Add to PATH" (coché par défaut).
3. **Git** : https://git-scm.com → installeur par défaut.
4. **MySQL Server 8.0** : installé et démarré (service Windows actif), avec un
   compte (souvent `root`) et son mot de passe notés — l'installateur crée la
   base `gestpal` automatiquement, inutile de la créer à la main.
   Ajoutez `C:\Program Files\MySQL\MySQL Server 8.0\bin` au PATH système pour
   que `mysqladmin` soit reconnu (sinon l'installateur affiche juste un
   avertissement, non bloquant).
5. **Pilote du pont USB-série** de l'indicateur de pesage, si l'indicateur se
   connecte en USB (le PC doit voir un port `COMx` dans le Gestionnaire de
   périphériques).

Vérifiez rapidement dans PowerShell :
```powershell
node --version
git --version
mysqladmin --version
```

---

## 3. Installation automatique (recommandée) — `deployer.ps1`

Le script `deployer.ps1` fait tout : vérifie les prérequis, installe PM2,
clone le code depuis GitHub, installe les dépendances npm, génère le `.env`,
initialise la base MySQL, démarre les services PM2, configure le démarrage
automatique au boot et ouvre le port dans le pare-feu Windows.

1. Ouvrez **PowerShell en Administrateur** (clic droit → *Exécuter en tant
   qu'administrateur*).
2. Récupérez `deployer.ps1` (copié depuis une installation existante, une clé
   USB, ou téléchargé) et placez-le n'importe où (ex. `C:\Users\<vous>\Desktop`).
3. Autorisez l'exécution du script pour cette session, puis lancez-le :
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\deployer.ps1
   ```
4. Répondez aux questions posées :
   - **Hôte / Port / Utilisateur / Mot de passe MySQL** — les identifiants du
     compte MySQL créé au §2 (le script teste la connexion automatiquement).
   - **Nom de la base** — `gestpal` par défaut, à garder sauf cas particulier.
   - **Port HTTP du serveur** — `3000` par défaut.
5. Le script installe tout dans `C:\GESTPAL`, démarre les services, et affiche
   un résumé avec les URL d'accès (local et réseau) et le compte admin par
   défaut.

À la fin, GESTPAL tourne et redémarre automatiquement avec Windows. Passez
ensuite au **§5 (pont bascule)**, **§6 (licence)** et **§7 (vérifications)**.

> Relancer `deployer.ps1` sur une installation existante (détectée via le
> dossier `.git` dans `C:\GESTPAL`) propose un **mode mise à jour** (`git pull`
> + migrations de base + redémarrage PM2) — voir §8.

---

## 4. Installation manuelle (si `deployer.ps1` n'est pas utilisable)

Équivalent pas-à-pas de ce que fait le script, pour un environnement où le
script PowerShell ne convient pas (restrictions de sécurité, install hors
GitHub, etc.).

```powershell
# 1. Récupérer le code
git clone https://github.com/kokodevelop/gestpal.git C:\GESTPAL
cd C:\GESTPAL

# 2. Dépendances
npm install --omit=dev
cd scale-bridge
npm install --omit=dev
cd ..

# 3. Fichier .env (créer à la racine de C:\GESTPAL)
```

Contenu de `.env` :
```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=VotreMotDePasseMySQL
DB_NAME=gestpal
PORT=3000
SESSION_SECRET=une-chaine-aleatoire-longue-a-generer
BRIDGE_TOKEN=
NODE_ENV=production
```
`SESSION_SECRET` : n'importe quelle chaîne longue et aléatoire (sert à signer
les cookies de session). `BRIDGE_TOKEN` : voir §5, peut rester vide si la
bascule et le serveur sont sur la même machine en confiance.

```powershell
# 4. Créer le schéma + compte admin + données de démarrage
node src/db/init.js

# 5. Installer PM2 globalement, puis démarrer les services
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2-service-install    # ou : pm2 startup windows   (démarrage auto au boot)

# 6. Ouvrir le port dans le pare-feu Windows (en Administrateur)
New-NetFirewallRule -DisplayName "GESTPAL-HTTP-3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

---

## 5. Pont bascule RS232

Sur le PC **physiquement relié** à l'indicateur de pesage :

1. **Repérer le port COM** :
   ```powershell
   cd C:\GESTPAL\scale-bridge
   node bridge.js --liste-ports
   ```
2. **Configurer** — deux façons, au choix :
   - **Via l'interface web** (recommandé) : se connecter à GESTPAL en admin →
     menu **Bascule** → renseigner port, vitesse, parité, regex poids,
     marqueur de stabilité → *Enregistrer*. Le pont recharge automatiquement
     sa configuration sans redémarrage manuel.
   - **Manuellement** : éditer `scale-bridge/config.json` (voir les
     commentaires `_xxx` dans le fichier pour le sens de chaque champ).
3. **Jeton de sécurité (`token`)** : le champ `token` de `config.json` doit
   être **identique** à `BRIDGE_TOKEN` dans le `.env` du serveur — sinon le
   serveur rejette silencieusement les poids envoyés par le pont (poids
   toujours à 0 dans l'application). Si l'un des deux est vide, l'autre doit
   l'être aussi.
4. **Test sans matériel** (pour valider l'installation avant branchement de
   la bascule) :
   ```powershell
   node simulateur.js
   ```
   Le poids simulé doit apparaître en direct dans l'application (badge en
   haut de l'écran + afficheur sur les écrans de pesée).
5. Si la bascule est sur un **poste différent** du serveur, changez `serveur`
   dans `config.json` pour pointer vers l'IP du serveur
   (`http://<ip-serveur>:3000`), et démarrez uniquement ce composant sur ce
   poste :
   ```powershell
   pm2 start bridge.js --name gestpal-bridge --cwd C:\GESTPAL\scale-bridge
   pm2 save
   ```

---

## 6. Activation de la licence

GESTPAL exige une licence valide pour fonctionner au-delà de la période
d'essai.

1. Récupérer le **code machine** du poste : ouvrir GESTPAL dans le navigateur
   → écran d'activation de licence (s'affiche automatiquement si aucune
   licence valide n'est présente) → le code machine y est affiché.
2. Transmettre ce code machine (et le nom du client/site) à la personne qui
   génère les licences, qui exécute :
   ```powershell
   node tools/gestpal-licence.js --client "Nom du client" --expires 2027-12-31 --machine XXXXXXXX --site "San Pedro"
   ```
   (`--machine` est optionnel — une licence sans code machine fonctionne sur
   n'importe quel poste, à utiliser avec prudence).
3. Deux façons d'activer côté client :
   - Copier-coller directement la clé (`GESTPAL-...`) dans l'écran
     d'activation de l'application.
   - Ou déposer le fichier `licence-<client>.key` généré, renommé
     `licence.key`, à la racine de `C:\GESTPAL`, puis redémarrer le serveur
     (`pm2 restart gestpal-server`).

---

## 7. Vérifications post-installation

- [ ] `http://localhost:3000` (et `http://<ip-du-pc>:3000` depuis un autre
      poste du réseau) ouvre bien l'écran de connexion.
- [ ] Connexion avec `admin` / `admin123` fonctionne.
- [ ] **Mot de passe admin changé immédiatement** (menu utilisateur).
- [ ] Licence activée (plus d'écran de blocage licence).
- [ ] Bascule : le poids s'affiche en direct (réel ou via `simulateur.js`).
- [ ] `pm2 status` affiche `gestpal-server` et `gestpal-bridge` en `online`.
- [ ] Redémarrage du PC testé une fois : GESTPAL doit redémarrer seul.

---

## 8. Mise à jour d'une installation existante

**Avec `deployer.ps1`** : relancez-le sur le même poste, il détecte
l'installation existante dans `C:\GESTPAL` et propose `[M] Mise à jour`
(git pull + migrations de base + redémarrage PM2, en conservant le `.env`
et `config.json` existants).

**Manuellement** :
```powershell
cd C:\GESTPAL
git pull origin master
npm install --omit=dev
cd scale-bridge && npm install --omit=dev && cd ..
node src/db/init.js        # migrations idempotentes, sans danger à rejouer
pm2 restart all
```

---

## 9. Sauvegarde

La seule donnée critique à sauvegarder régulièrement est la **base MySQL**
(`gestpal`). Exemple de sauvegarde quotidienne via tâche planifiée Windows :
```powershell
mysqldump -u root -p gestpal > "C:\Sauvegardes\gestpal_$(Get-Date -Format yyyyMMdd).sql"
```
Pensez aussi à conserver une copie de `.env`, `licence.key` et
`scale-bridge/config.json` (configuration propre à ce poste, pas versionnée).

---

## 10. Dépannage — commandes utiles

| Commande | Effet |
|---|---|
| `pm2 status` | État des deux services |
| `pm2 logs gestpal-server` | Journaux du serveur web |
| `pm2 logs gestpal-bridge` | Journaux du pont bascule (utile pour les problèmes de port COM / trame) |
| `pm2 restart all` | Redémarre les deux services |
| `pm2 restart gestpal-bridge` | Redémarre juste le pont (après changement de bascule, par ex.) |
| `node scale-bridge/bridge.js --liste-ports` | Liste les ports COM disponibles |
| `node scale-bridge/bridge.js --debug` | Affiche les trames brutes reçues de la bascule (hors PM2, à lancer manuellement pour déboguer le regex/délimiteur) |

**Problèmes fréquents :**
- *Le poids n'arrive jamais côté app* → vérifier que `token` (config.json) et
  `BRIDGE_TOKEN` (.env) sont identiques, et que `serveur` dans config.json
  pointe vers la bonne adresse/port.
- *`gestpal-server` redémarre en boucle* → `pm2 logs gestpal-server`, vérifier
  en premier les identifiants MySQL dans `.env`.
- *Port COM introuvable* → vérifier dans le Gestionnaire de périphériques
  Windows que le pilote USB-série est installé et que le port n'est pas déjà
  utilisé par un autre logiciel.
