# GESTPAL — Gestion de pesée par palette

Application web (Node.js/Express + MySQL) de gestion des pesées par palette :
tare palettes → pesées successives des palettes chargées → cumuls → poids net
sans emballage → ticket imprimable. Lecture du poids en temps réel depuis
l'indicateur de pesage (RS232/USB) via un pont série.

## Processus métier

1. **Initialisation** : les palettes vides sont posées sur la bascule et pesées
   en une seule fois → **tare palettes**. Un numéro de lot (auto ou manuel) et
   un numéro de ticket sont créés.
2. **Pesées successives** : chaque palette chargée de sacs est pesée → poids
   brut + nombre de sacs. La tare emballage de la ligne = nb sacs × poids
   unitaire du sac ; le net de ligne = brut − tare emballage.
3. **Clôture** : `POIDS NET SANS EMB. = cumul brut − cumul tare sacs − tare palettes`.
   Le ticket final est imprimé.
4. Une pesée **peut être interrompue puis reprise** à tout moment.

## Installation

```bash
# 1. Dépendances du serveur
npm install

# 2. Configurer .env (mot de passe MySQL notamment)
#    DB_PASSWORD=...

# 3. Créer la base, les tables, l'admin et les données de démarrage
npm run initdb

# 4. Démarrer le serveur
npm start            # http://localhost:3000
```

Connexion initiale : **admin / admin123** (à changer dès la première connexion).

## Pont bascule (poste de pesée)

Sur le PC relié à l'indicateur de pesage :

```bash
cd scale-bridge
npm install
node bridge.js --liste-ports   # repérer le port COM de l'indicateur
# éditer config.json : port, baudRate, regexPoids, marqueurStable, serveur, token
npm start
```

- `regexPoids` : expression régulière dont le 1er groupe capturé est le poids
  en kg (à adapter au protocole de l'indicateur).
- `marqueurStable` : texte présent dans la trame quand le poids est stable
  (souvent `ST`). Vide = toujours considéré stable.
- Le `token` doit être identique au `BRIDGE_TOKEN` du `.env` du serveur.

### Test sans matériel

```bash
cd scale-bridge
node simulateur.js   # envoie un poids fictif au serveur
```

Le poids s'affiche en direct dans l'application (badge en haut + grand
afficheur sur les écrans de pesée). La saisie manuelle du poids reste
toujours possible si la bascule n'est pas connectée.

## Rôles

| Rôle        | Droits                                              |
|-------------|-----------------------------------------------------|
| OPERATEUR   | Pesées, référentiels, rapports                      |
| SUPERVISEUR | Idem opérateur                                      |
| ADMIN       | Idem + gestion des utilisateurs                     |

## Structure

```
src/server.js          serveur Express + Socket.IO + réception poids bascule
src/db/schema.sql      schéma MySQL (base gestpal)
src/db/init.js         initialisation base + admin + données de démarrage
src/routes/auth.js     connexion, utilisateurs
src/routes/referentiels.js  CRUD produits, emballages, clients, etc.
src/routes/pesees.js   cœur métier : pesées, lignes, statuts, numérotation
src/routes/rapports.js historique filtrable + export CSV
src/routes/ticket.js   ticket imprimable (HTML)
public/                frontend (SPA légère sans framework)
scale-bridge/          pont série RS232 → serveur + simulateur
```
