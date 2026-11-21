#!/bin/bash
# Contrôle de la VM « runner » (I324, S5). À lancer avec : sudo bash verifier-runner.sh
ECHECS=0
ok()  { echo "[ OK ]  $1"; }
ko()  { echo "[ÉCHEC] $1"; echo "         Que faire : $2"; ECHECS=$((ECHECS + 1)); }
info(){ echo "[INFO]  $1"; }

echo
echo "========== Contrôle de la VM runner =========="

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo : sudo bash verifier-runner.sh"; exit 1; }

. /etc/os-release
IP=$(hostname -I | awk '{print $1}')
info "Système : $PRETTY_NAME, machine : $(hostname), adresse : $IP"

if dpkg -s gitlab-ce >/dev/null 2>&1; then
    ko "GitLab est installé sur cette VM" "GitLab doit rester seul sur la VM gitlab : sudo apt remove gitlab-ce."
else ok "Pas de GitLab sur cette VM (il est sur la VM gitlab)"; fi

MEM=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$MEM" -ge 1800 ]; then ok "Mémoire : $MEM Mo"
else ko "Mémoire : $MEM Mo, il en faut au moins 2 Go" "Éteignez la VM, VM > Settings > Memory : 2 GB, puis redémarrez-la."; fi

if command -v docker >/dev/null 2>&1 && docker run --rm hello-world >/dev/null 2>&1; then
    ok "Docker fonctionne ($(docker --version | cut -d, -f1))"
else ko "Docker ne fonctionne pas" "Refaites l'étape 5 de la feuille, puis testez : sudo docker run --rm hello-world"; fi

if ! command -v gitlab-runner >/dev/null 2>&1; then
    ko "GitLab Runner n'est pas installé" "Refaites l'étape 6 de la feuille."
    echo; echo "$ECHECS point(s) à corriger."; exit 1
fi
ok "GitLab Runner est installé ($(gitlab-runner --version 2>/dev/null | awk '/^Version/ {print $2}'))"

CONF=/etc/gitlab-runner/config.toml
if ! grep -q "^\[\[runners\]\]" "$CONF" 2>/dev/null; then
    ko "Le runner n'est pas enregistré" "Refaites l'étape 6 : sudo gitlab-runner register --url ... --token ..."
    echo; echo "$ECHECS point(s) à corriger."; exit 1
fi
URL=$(grep -E '^\s*url *=' "$CONF" | head -1 | sed -E 's/.*"(.*)".*/\1/')
EXEC=$(grep -E '^\s*executor *=' "$CONF" | head -1 | sed -E 's/.*"(.*)".*/\1/')
IMAGE=$(grep -E '^\s*image *=' "$CONF" | head -1 | sed -E 's/.*"(.*)".*/\1/')
info "Enregistré auprès de $URL"

if [ "$EXEC" = "docker" ]; then ok "Exécuteur : docker, image par défaut : $IMAGE"
else ko "Exécuteur : « $EXEC »" "Il faut l'exécuteur docker. Supprimez ce runner (sudo gitlab-runner unregister --all-runners) et refaites l'étape 6."; fi

HOTE=$(echo "$URL" | sed -E 's#https?://([^/:]+).*#\1#')
if [ "$HOTE" = "$IP" ] || [ "$HOTE" = "localhost" ] || [ "$HOTE" = "127.0.0.1" ]; then
    if [ -z "$MEME_MACHINE_OK" ]; then
        ko "L'adresse de GitLab est celle de cette VM" "Le runner doit utiliser l'adresse de la VM gitlab (voir étape 2 de la feuille)."
    fi
else ok "GitLab est sur une autre machine ($HOTE)"; fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL/users/sign_in")
if [ "$CODE" = "200" ]; then ok "La VM runner joint GitLab"
else ko "La VM runner ne joint pas GitLab ($URL répond $CODE)" "Les deux VM doivent être en réseau NAT. Testez : curl $URL depuis la VM runner."; fi

if gitlab-runner verify 2>&1 | grep -qiE "is (valid|alive)"; then ok "GitLab reconnaît le runner"
else ko "GitLab ne reconnaît pas le runner" "Le jeton est peut-être faux. Dans GitLab, supprimez le runner, créez-en un nouveau et refaites l'enregistrement."; fi

echo "=============================================="
if [ "$ECHECS" -eq 0 ]; then echo "VM runner : tout est en ordre."; else echo "$ECHECS point(s) à corriger."; fi
echo
