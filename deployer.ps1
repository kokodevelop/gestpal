#Requires -Version 5.1
<#
.SYNOPSIS
    GESTPAL — Script d'installation / mise à jour
.DESCRIPTION
    Installe GESTPAL depuis GitHub sur un nouveau PC client ou met à jour
    une installation existante. À lancer en tant qu'Administrateur.
#>

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

# ── Couleurs helpers ────────────────────────────────────────────────────────
function Write-Ok   ($msg) { Write-Host "  [OK] $msg"      -ForegroundColor Green  }
function Write-Info ($msg) { Write-Host "  [..] $msg"      -ForegroundColor Cyan   }
function Write-Warn ($msg) { Write-Host "  [!!] $msg"      -ForegroundColor Yellow }
function Write-Err  ($msg) { Write-Host "  [XX] $msg"      -ForegroundColor Red    }
function Pause-Exit ($msg) { Write-Err $msg; Write-Host "`nAppuyez sur une touche pour quitter…"; $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown'); exit 1 }

Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║       GESTPAL — Installateur v1.0            ║" -ForegroundColor Blue
Write-Host "  ║  Gestion des pesées palette — RS232          ║" -ForegroundColor Blue
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# ── Droits administrateur ───────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "Ce script doit être lancé en tant qu'Administrateur."
    Write-Host "  Relancez PowerShell en Administrateur puis réessayez." -ForegroundColor Yellow
    Pause-Exit "Droits insuffisants."
}

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 0 — Mode : installation neuve ou mise à jour ?
# ═══════════════════════════════════════════════════════════════════════════
$INSTALL_DIR = "C:\GESTPAL"
$modeMAJ = Test-Path (Join-Path $INSTALL_DIR ".git")

if ($modeMAJ) {
    Write-Host "  Installation existante détectée dans $INSTALL_DIR" -ForegroundColor Cyan
    Write-Host ""
    $rep = Read-Host "  [M] Mise à jour  /  [R] Réinstallation complète  (M/R)"
    if ($rep -eq 'R') { $modeMAJ = $false }
}

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 1 — Vérification des prérequis
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Vérification des prérequis ──────────────────" -ForegroundColor White

# Node.js
try {
    $nodeVer = node --version 2>$null
    Write-Ok "Node.js $nodeVer"
} catch {
    Pause-Exit "Node.js n'est pas installé. Téléchargez le MSI sur https://nodejs.org (LTS) puis relancez."
}

# npm
try {
    $npmVer = npm --version 2>$null
    Write-Ok "npm $npmVer"
} catch {
    Pause-Exit "npm introuvable. Réinstallez Node.js."
}

# Git
try {
    $gitVer = git --version 2>$null
    Write-Ok "Git $gitVer"
} catch {
    Pause-Exit "Git n'est pas installé. Téléchargez-le sur https://git-scm.com puis relancez."
}

# PM2
$pm2Installed = $null -ne (Get-Command pm2 -ErrorAction SilentlyContinue)
if (-not $pm2Installed) {
    Write-Info "Installation de PM2 (gestionnaire de processus)…"
    npm install -g pm2 2>&1 | Out-Null
    Write-Ok "PM2 installé"
} else {
    $pm2Ver = pm2 --version 2>$null
    Write-Ok "PM2 $pm2Ver"
}

# MySQL client (mysqladmin pour tester la connexion)
$mysqlOk = $null -ne (Get-Command mysqladmin -ErrorAction SilentlyContinue)
if (-not $mysqlOk) {
    Write-Warn "mysqladmin non trouvé dans PATH — MySQL doit être installé et dans le PATH."
    Write-Warn "Si MySQL est installé, ajoutez C:\Program Files\MySQL\MySQL Server 8.0\bin au PATH."
    Write-Host "  Continuez quand même ? (O/N)" -NoNewline
    $c = Read-Host " "
    if ($c -ne 'O' -and $c -ne 'o') { exit 0 }
}

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 2 — Paramètres de configuration
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Configuration ───────────────────────────────" -ForegroundColor White

if ($modeMAJ) {
    # Lire .env existant
    $envPath = Join-Path $INSTALL_DIR ".env"
    $envContent = Get-Content $envPath -Raw -ErrorAction SilentlyContinue
    function Get-EnvVal ($key) {
        if ($envContent -match "(?m)^$key=(.+)$") { return $Matches[1].Trim() }
        return ""
    }
    $DB_HOST   = Get-EnvVal "DB_HOST"
    $DB_PORT   = Get-EnvVal "DB_PORT"
    $DB_USER   = Get-EnvVal "DB_USER"
    $DB_PASS   = Get-EnvVal "DB_PASS"
    $DB_NAME   = Get-EnvVal "DB_NAME"
    $APP_PORT  = Get-EnvVal "PORT"
    $BRIDGE_TOK = Get-EnvVal "BRIDGE_TOKEN"
    Write-Ok "Configuration existante chargée depuis .env"
} else {
    Write-Host ""
    Write-Host "  Base de données MySQL" -ForegroundColor Cyan
    $DB_HOST  = Read-Host "  Hôte MySQL           [localhost]"
    if ([string]::IsNullOrWhiteSpace($DB_HOST)) { $DB_HOST = "localhost" }

    $DB_PORT  = Read-Host "  Port MySQL           [3306]"
    if ([string]::IsNullOrWhiteSpace($DB_PORT)) { $DB_PORT = "3306" }

    $DB_USER  = Read-Host "  Utilisateur MySQL    [root]"
    if ([string]::IsNullOrWhiteSpace($DB_USER)) { $DB_USER = "root" }

    $DB_PASS_SEC = Read-Host "  Mot de passe MySQL" -AsSecureString
    $DB_PASS  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($DB_PASS_SEC))

    $DB_NAME  = Read-Host "  Nom de la base       [gestpal]"
    if ([string]::IsNullOrWhiteSpace($DB_NAME)) { $DB_NAME = "gestpal" }

    Write-Host ""
    Write-Host "  Serveur GESTPAL" -ForegroundColor Cyan
    $APP_PORT = Read-Host "  Port HTTP            [3000]"
    if ([string]::IsNullOrWhiteSpace($APP_PORT)) { $APP_PORT = "3000" }

    # Jeton interne bridge → serveur (généré aléatoirement)
    $BRIDGE_TOK = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
}

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 3 — Cloner ou mettre à jour depuis GitHub
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Téléchargement de l'application ─────────────" -ForegroundColor White

$GITHUB_URL = "https://github.com/kokodevelop/gestpal.git"

if ($modeMAJ) {
    Write-Info "Mise à jour depuis GitHub…"
    Set-Location $INSTALL_DIR
    git pull origin master
    if ($LASTEXITCODE -ne 0) { Pause-Exit "Échec du git pull. Vérifiez la connexion internet." }
    Write-Ok "Code mis à jour"
} else {
    if (Test-Path $INSTALL_DIR) {
        Write-Warn "Le dossier $INSTALL_DIR existe déjà. Suppression…"
        Remove-Item $INSTALL_DIR -Recurse -Force
    }
    Write-Info "Clonage depuis $GITHUB_URL…"
    git clone $GITHUB_URL $INSTALL_DIR
    if ($LASTEXITCODE -ne 0) { Pause-Exit "Échec du clonage. Vérifiez la connexion internet." }
    Write-Ok "Code téléchargé dans $INSTALL_DIR"
    Set-Location $INSTALL_DIR
}

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 4 — Dépendances npm
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Installation des dépendances ────────────────" -ForegroundColor White
Write-Info "npm install (serveur)…"
Set-Location $INSTALL_DIR
npm install --omit=dev 2>&1 | Out-Null
Write-Ok "Dépendances serveur OK"

Write-Info "npm install (pont RS232)…"
Set-Location (Join-Path $INSTALL_DIR "scale-bridge")
npm install --omit=dev 2>&1 | Out-Null
Write-Ok "Dépendances pont RS232 OK"
Set-Location $INSTALL_DIR

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 5 — Fichier .env
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Création du fichier de configuration .env ───" -ForegroundColor White

$SESSION_SECRET = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

$envText = @"
# GESTPAL — Configuration
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_NAME=$DB_NAME
PORT=$APP_PORT
SESSION_SECRET=$SESSION_SECRET
BRIDGE_TOKEN=$BRIDGE_TOK
NODE_ENV=production
"@

$envText | Set-Content (Join-Path $INSTALL_DIR ".env") -Encoding UTF8
Write-Ok ".env créé"

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 6 — Initialisation de la base de données
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Base de données ─────────────────────────────" -ForegroundColor White

if (-not $modeMAJ) {
    Write-Info "Test de la connexion MySQL…"
    try {
        $testConn = mysqladmin -h $DB_HOST -P $DB_PORT -u $DB_USER "-p$DB_PASS" ping 2>&1
        if ($testConn -notmatch "alive") { throw "Connexion échouée" }
        Write-Ok "Connexion MySQL OK"
    } catch {
        Write-Warn "Impossible de se connecter à MySQL. Vérifiez les paramètres."
        Write-Warn "Erreur : $_"
    }

    Write-Info "Initialisation du schéma GESTPAL…"
    Set-Location $INSTALL_DIR
    node src/db/init.js
    if ($LASTEXITCODE -ne 0) { Pause-Exit "Erreur d'initialisation de la base MySQL. Vérifiez les paramètres." }
    Write-Ok "Base de données initialisée"
} else {
    Write-Info "Mise à jour du schéma (migrations)…"
    Set-Location $INSTALL_DIR
    node src/db/init.js
    Write-Ok "Schéma à jour"
}

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 7 — PM2 : démarrage et démarrage automatique Windows
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Démarrage des services PM2 ──────────────────" -ForegroundColor White

Set-Location $INSTALL_DIR

# Arrêter les instances existantes si mise à jour
pm2 delete gestpal-server 2>$null | Out-Null
pm2 delete gestpal-bridge 2>$null | Out-Null

Write-Info "Démarrage de GESTPAL…"
pm2 start ecosystem.config.js 2>&1 | Out-Null
Start-Sleep -Seconds 3

$pm2Status = pm2 jlist 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
$serverOk = $pm2Status | Where-Object { $_.name -eq 'gestpal-server' -and $_.pm2_env.status -eq 'online' }
$bridgeOk  = $pm2Status | Where-Object { $_.name -eq 'gestpal-bridge' }

if ($serverOk) { Write-Ok "gestpal-server : en ligne" } else { Write-Warn "gestpal-server : vérifiez avec 'pm2 logs gestpal-server'" }
if ($bridgeOk)  { Write-Ok "gestpal-bridge : démarré (port RS232 à configurer)" } else { Write-Warn "gestpal-bridge : non démarré" }

Write-Info "Sauvegarde de la configuration PM2…"
pm2 save 2>&1 | Out-Null
Write-Ok "Configuration PM2 sauvegardée"

# Démarrage automatique au boot Windows (service)
Write-Info "Configuration du démarrage automatique au boot Windows…"
pm2 startup windows 2>&1 | Out-Null
Write-Ok "GESTPAL démarrera automatiquement avec Windows"

# ═══════════════════════════════════════════════════════════════════════════
# ÉTAPE 8 — Règle pare-feu
# ═══════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ── Pare-feu Windows ────────────────────────────" -ForegroundColor White
$ruleName = "GESTPAL-HTTP-$APP_PORT"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existingRule) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $APP_PORT -Action Allow | Out-Null
    Write-Ok "Règle pare-feu créée (port $APP_PORT ouvert sur le réseau local)"
} else {
    Write-Ok "Règle pare-feu existante ($ruleName)"
}

# ═══════════════════════════════════════════════════════════════════════════
# RÉSUMÉ FINAL
# ═══════════════════════════════════════════════════════════════════════════
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║         GESTPAL installé avec succès !       ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Accès local    : http://localhost:$APP_PORT" -ForegroundColor White
Write-Host "  Accès réseau   : http://${ip}:$APP_PORT" -ForegroundColor White
Write-Host ""
Write-Host "  Compte admin   : admin / admin123" -ForegroundColor Yellow
Write-Host "  !! Changez ce mot de passe à la première connexion !!" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Prochaines étapes :" -ForegroundColor Cyan
Write-Host "   1. Ouvrez http://localhost:$APP_PORT dans Chrome ou Edge"
Write-Host "   2. Entrez la clé de licence fournie par votre revendeur"
Write-Host "   3. Configurez le port RS232 de la bascule (menu Bascule)"
Write-Host "   4. Changez le mot de passe administrateur"
Write-Host ""

$ouvrir = Read-Host "  Ouvrir GESTPAL dans le navigateur maintenant ? (O/N)"
if ($ouvrir -eq 'O' -or $ouvrir -eq 'o') {
    Start-Process "http://localhost:$APP_PORT"
}

Write-Host ""
Write-Host "  Commandes utiles :" -ForegroundColor Cyan
Write-Host "   pm2 status              — état des services"
Write-Host "   pm2 logs gestpal-server — journaux serveur"
Write-Host "   pm2 logs gestpal-bridge — journaux bascule RS232"
Write-Host "   pm2 restart all         — redémarrer tout"
Write-Host ""
