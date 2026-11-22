// Contrôle final (I324, S5) : lancé par le job « verifier » à la fin du pipeline.
// Il vérifie toute la chaîne : runner Docker, projet poussé depuis le PC, tests, application.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const resultats = [];
const ok = (titre, detail) => resultats.push({ ok: true, titre, detail });
const ko = (titre, quoi, faire) => resultats.push({ ok: false, titre, detail: quoi, faire });
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch { return null; } };

async function main() {
    const env = process.env;

    // 1. Le runner
    const version = `${env.CI_SERVER_VERSION || '?'}`;
    if (fs.existsSync('/.dockerenv')) ok('Le runner exécute les jobs dans un conteneur Docker', `GitLab ${version}, runner n° ${env.CI_RUNNER_ID || '?'}`);
    else ko('Le runner exécute les jobs dans un conteneur Docker', 'Ce job ne tourne pas dans un conteneur.', 'Réenregistrez le runner avec l\'exécuteur « docker » (étape 6 de la feuille).');

    // 2. Le projet vient bien du dépôt fourni
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); } catch { /* absent */ }
    if (pkg && pkg.name === 'i324-s5-gitlab') ok('Le projet contient l\'application fournie');
    else ko('Le projet contient l\'application fournie', 'package.json est absent ou ne vient pas du dépôt I324_S5_GitLab.', 'Recommencez l\'étape 7 : clonez le dépôt de GitHub, puis poussez-le dans votre projet GitLab.');

    // 3. Un commit fait sur le PC de l'élève, au format de l'équipe
    const log = sh('git log --format=%ae%x09%s') || '';
    const miens = log.split('\n').filter((l) => l && !l.startsWith('352912750+PG56YAC@'));
    const conv = /^(feat|fix|docs|test|refactor|style|chore|build|ci|perf)(\([^)]+\))?!?: \S/;
    if (!miens.length) ko('Un commit fait sur votre PC', 'Le projet ne contient que les commits du dépôt fourni.', 'Créez .gitlab-ci.yml dans votre IDE, faites un commit, puis poussez vers gitlab (étape 8).');
    else if (!miens.some((l) => conv.test(l.split('\t')[1]))) ko('Un commit fait sur votre PC', `Votre commit « ${miens[0].split('\t')[1]} » ne suit pas le format type: description.`, 'Faites un nouveau commit, par exemple « ci: ajoute le pipeline », puis poussez.');
    else ok('Un commit fait sur votre PC', `« ${miens.find((l) => conv.test(l.split('\t')[1])).split('\t')[1]} »`);

    // 4. Le pipeline contient un job de tests écrit par l'élève
    const ci = fs.existsSync('.gitlab-ci.yml') ? fs.readFileSync('.gitlab-ci.yml', 'utf8') : '';
    if (!/ci\/verifier\.yml/.test(ci)) ko('Le pipeline inclut le contrôle final', '.gitlab-ci.yml n\'inclut pas ci/verifier.yml.', 'Recopiez exactement le fichier de l\'étape 8.');
    else if (!/npm (run )?test|npx jest/.test(ci)) ko('Le pipeline contient un job de tests', 'Aucun job ne lance npm test.', 'Ajoutez le job « tests » de l\'étape 8.');
    else ok('Le pipeline contient un job de tests');

    // 5. Les tests passent
    const install = sh('npm ci --no-audit --no-fund 2>&1');
    if (install === null) ko('Les dépendances s\'installent', 'npm ci a échoué dans le conteneur.', 'Le runner a-t-il accès à Internet ? Testez « docker run --rm node:lts npm view express version » sur la VM runner.');
    else {
        const tests = sh('npx jest --ci 2>&1');
        if (tests === null) ko('Les tests passent', 'Au moins un test échoue.', 'Lancez npm test sur votre PC et corrigez le test indiqué.');
        else ok('Les tests passent', (tests.match(/Tests:.*$/m) || [''])[0]);
    }

    // 6. L'application démarre et répond
    const db = path.join(os.tmpdir(), 'verifier-todo.db');
    const app = spawn(process.execPath, ['src/index.js'], { env: { ...env, SQLITE_DB_LOCATION: db }, stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    app.stdout.on('data', (d) => { sortie += d; });
    app.stderr.on('data', (d) => { sortie += d; });
    for (let i = 0; i < 40 && !/Listening on port 3000/.test(sortie); i++) await new Promise((r) => setTimeout(r, 250));
    try {
        if (!/Listening on port 3000/.test(sortie)) throw new Error('l\'application ne démarre pas : ' + sortie.split('\n').slice(-3).join(' '));
        const nom = `contrôle ${env.CI_PIPELINE_ID || ''}`.trim();
        const r1 = await fetch('http://localhost:3000/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nom }) });
        const liste = await (await fetch('http://localhost:3000/items')).json();
        if (!r1.ok || !liste.some((t) => t.name === nom)) throw new Error('la tâche ajoutée n\'est pas relue');
        ok('L\'application démarre et répond', 'une tâche a été ajoutée puis relue');
    } catch (e) {
        ko('L\'application démarre et répond', e.message, 'Lancez npm run dev sur votre PC : la même erreur doit apparaître.');
    } finally {
        app.kill();
    }

    // Bilan
    console.log('\n==================== CONTRÔLE FINAL ====================\n');
    for (const r of resultats) {
        console.log(`${r.ok ? '[ OK ]' : '[ÉCHEC]'} ${r.titre}${r.detail ? ' : ' + r.detail : ''}`);
        if (!r.ok) console.log(`         Que faire : ${r.faire}`);
    }
    const echecs = resultats.filter((r) => !r.ok).length;
    console.log('\n========================================================');
    if (echecs === 0) {
        console.log('TOUT EST EN ORDRE : votre GitLab, votre runner et votre application fonctionnent.');
        console.log('Notez « OK » à la dernière ligne de votre feuille.');
    } else {
        console.log(`${echecs} point(s) à corriger. Corrigez, faites un commit, poussez : le contrôle recommence.`);
    }
    console.log('========================================================\n');
    process.exit(echecs ? 1 : 0);
}

main();
