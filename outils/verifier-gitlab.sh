#!/bin/bash
# Contrôle de la VM « gitlab » (I324, S5). À lancer avec : sudo bash verifier-gitlab.sh
ECHECS=0
ok()  { echo "[ OK ]  $1"; }
ko()  { echo "[ÉCHEC] $1"; echo "         Que faire : $2"; ECHECS=$((ECHECS + 1)); }
info(){ echo "[INFO]  $1"; }

echo
echo "========== Contrôle de la VM gitlab =========="

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo : sudo bash verifier-gitlab.sh"; exit 1; }

. /etc/os-release
info "Système : $PRETTY_NAME, machine : $(hostname), adresse : $(hostname -I | awk '{print $1}')"

MEM=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$MEM" -ge 5500 ]; then ok "Mémoire : $MEM Mo"
else ko "Mémoire : $MEM Mo, il en faut au moins 6 Go" "Éteignez la VM, VM > Settings > Memory : 6 GB, puis redémarrez-la."; fi

CPU=$(nproc)
if [ "$CPU" -ge 2 ]; then ok "Processeurs : $CPU"
else ko "Processeurs : $CPU" "Éteignez la VM, VM > Settings > Processors : 4, puis redémarrez-la."; fi

if dpkg -s gitlab-ce >/dev/null 2>&1; then
    ok "GitLab est installé (version $(dpkg-query -W -f='${Version}' gitlab-ce))"
else
    ko "GitLab n'est pas installé" "Refaites l'étape 3 de la feuille."
    echo; echo "$ECHECS point(s) à corriger."; exit 1
fi

URL=$(grep -E "^external_url" /etc/gitlab/gitlab.rb | sed -E "s/external_url ['\"]([^'\"]+)['\"].*/\1/")
IP=$(hostname -I | awk '{print $1}')
if [ "$URL" = "http://$IP" ]; then ok "Adresse de GitLab : $URL"
else ko "Adresse de GitLab : « $URL », mais l'adresse de la VM est $IP" "Dans /etc/gitlab/gitlab.rb, mettez external_url 'http://$IP', puis sudo gitlab-ctl reconfigure."; fi

ARRETES=$(gitlab-ctl status 2>/dev/null | grep -c "^down:")
if [ "$ARRETES" -eq 0 ]; then ok "Tous les services GitLab tournent"
else ko "$ARRETES service(s) GitLab arrêté(s) : $(gitlab-ctl status | grep '^down:' | cut -d: -f2 | tr -d ' ' | tr '\n' ' ')" "Attendez 2 minutes après un démarrage, puis relancez ce contrôle. Sinon : sudo gitlab-ctl restart."; fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/users/sign_in)
if [ "$CODE" = "200" ]; then ok "La page de connexion répond"
else ko "La page de connexion répond par le code $CODE" "GitLab démarre encore (jusqu'à 5 minutes). Attendez, puis relancez ce contrôle."; fi

if dpkg -s gitlab-runner >/dev/null 2>&1; then
    ko "GitLab Runner est installé sur cette VM" "Le runner doit être sur l'autre VM : sudo apt remove gitlab-runner."
else ok "Pas de runner sur cette VM (il est sur la VM runner)"; fi

echo "=============================================="
if [ "$ECHECS" -eq 0 ]; then echo "VM gitlab : tout est en ordre."; else echo "$ECHECS point(s) à corriger."; fi
echo
