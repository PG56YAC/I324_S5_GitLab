// Missions du vendredi (I324, S5) : lancé par le job « missions » à la fin du pipeline.
// Lit .gitlab-ci.yml, package.json et les artefacts reçus, puis affiche ce qui est fait et la suite.
'use strict';
const fs = require('fs');
const yaml = require(process.env.OUTILS + '/node_modules/js-yaml');

let ci = {};
try { ci = yaml.load(fs.readFileSync('.gitlab-ci.yml', 'utf8')) || {}; } catch (e) { ci = { _erreur: e.message }; }
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); } catch { /* absent */ }

const RESERVES = ['stages', 'include', 'default', 'variables', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script'];
const jobs = Object.entries(ci).filter(([n, j]) => !RESERVES.includes(n) && !n.startsWith('.') && j && typeof j === 'object' && j.script);
const texte = (j) => [].concat(j.script || [], j.before_script || []).join('\n');
const jobQui = (re) => jobs.find(([, j]) => re.test(texte(j)));
const stages = Array.isArray(ci.stages) ? ci.stages : [];

const MISSIONS = [
    {
        titre: 'Un stage par étape',
        besoin: 'Je veux voir d\'un coup d\'œil ce qui casse : le linter, les tests ou la fabrication du paquet.',
        indice: 'Déclarez trois stages, lint, test et build, dans cet ordre. Le job « lint » lance npm run lint dans le stage lint, le job « tests » lance npm test dans le stage test.',
        ok: () => {
            const i = ['lint', 'test', 'build'].map((s) => stages.indexOf(s));
            if (i.includes(-1) || !(i[0] < i[1] && i[1] < i[2])) return 'Il manque la clé stages avec lint, test et build, dans cet ordre.';
            const l = jobQui(/npm run lint/);
            if (!l || l[1].stage !== 'lint') return 'Aucun job du stage lint ne lance npm run lint.';
            const t = jobQui(/npm (run )?test|npx jest/);
            if (!t || t[1].stage !== 'test') return 'Aucun job du stage test ne lance npm test.';
            return null;
        },
    },
    {
        titre: 'Le paquet en artefact',
        besoin: 'Le testeur veut télécharger le paquet de l\'application directement depuis GitLab, sans rien installer.',
        indice: 'Un job « paquet » dans le stage build lance npm pack et garde le fichier .tgz comme artefact (clé artifacts, paths).',
        ok: () => {
            const p = jobQui(/npm pack/);
            if (!p || p[1].stage !== 'build') return 'Aucun job du stage build ne lance npm pack.';
            const chemins = ((p[1].artifacts || {}).paths || []).join(' ');
            if (!/tgz/.test(chemins)) return 'Le job qui lance npm pack ne garde pas le .tgz comme artefact.';
            const surMain = !process.env.CI_COMMIT_BRANCH || process.env.CI_COMMIT_BRANCH === process.env.CI_DEFAULT_BRANCH;
            // Sur une autre branche, le paquet n'est pas fabriqué (mission 5) : on ne cherche pas le fichier
            if (surMain && !fs.readdirSync('.').some((f) => f.endsWith('.tgz'))) return 'Le fichier .tgz n\'est pas arrivé jusqu\'ici. Le job paquet est-il vert ? Tourne-t-il sur cette branche ?';
            return null;
        },
    },
    {
        titre: 'Un cache pour les dépendances',
        besoin: 'Chaque job retélécharge toutes les dépendances. Gardez-les d\'un pipeline à l\'autre, et ne les retéléchargez que si package-lock.json change.',
        indice: 'Clé cache, avec key: files: [package-lock.json] et paths: [.npm/]. Pour que npm range ses fichiers dans .npm/ : npm ci --cache .npm --prefer-offline.',
        ok: () => {
            const avecCache = [ci, ci.default, ...jobs.map(([, j]) => j)].filter((j) => j && j.cache);
            const c = avecCache.map((j) => j.cache).flat().find((x) => x && x.key && Array.isArray(x.key.files) && x.key.files.includes('package-lock.json'));
            if (!c) return 'Aucun cache dont la clé dépend de package-lock.json.';
            if (!(c.paths || []).length) return 'Le cache ne dit pas quel dossier garder (paths).';
            const vers = JSON.stringify(ci);
            if (!/--cache[ =]\.npm|npm_config_cache/.test(vers)) return 'npm ne range pas ses fichiers dans le dossier gardé par le cache (option --cache .npm).';
            return null;
        },
    },
    {
        titre: 'Un secret masqué',
        besoin: 'Le pipeline aura besoin d\'un mot de passe. Il ne doit apparaître ni dans le code, ni dans les journaux.',
        indice: 'Settings > CI/CD > Variables > Add variable. Key : MESSAGE_SECRET, Value : au moins 8 caractères, Visibility : Masked. Puis un job l\'affiche avec echo $MESSAGE_SECRET : le journal montre [MASKED].',
        ok: () => {
            if (!process.env.MESSAGE_SECRET) return 'La variable MESSAGE_SECRET n\'existe pas dans le projet (Settings > CI/CD > Variables).';
            if (/MESSAGE_SECRET\s*:/.test(JSON.stringify(ci.variables || {})) || jobs.some(([, j]) => j.variables && j.variables.MESSAGE_SECRET)) return 'MESSAGE_SECRET est écrite dans .gitlab-ci.yml : tout le monde peut la lire. Retirez-la du fichier.';
            if (!jobs.some(([, j]) => /\$\{?MESSAGE_SECRET/.test(texte(j)))) return 'Aucun job n\'utilise $MESSAGE_SECRET.';
            return null;
        },
    },
    {
        titre: 'Le paquet seulement sur main',
        besoin: 'Seule la branche principale doit fabriquer le paquet. Les autres branches lancent le linter et les tests, c\'est tout.',
        indice: 'Dans le job paquet, la clé rules avec une condition sur $CI_COMMIT_BRANCH et $CI_DEFAULT_BRANCH.',
        ok: () => {
            const p = jobQui(/npm pack/);
            const r = p && p[1].rules;
            if (!Array.isArray(r) || !r.some((x) => x && /CI_COMMIT_BRANCH/.test(String(x.if || '')) && /CI_DEFAULT_BRANCH|main/.test(String(x.if || '')))) return 'Le job paquet n\'a pas de rules sur la branche.';
            return null;
        },
    },
    {
        titre: 'Bonus : les tests dans l\'onglet Tests',
        besoin: 'Je veux voir la liste des tests dans l\'onglet Tests du pipeline, pas seulement leur nombre dans le journal.',
        indice: 'Installez jest-junit (npm install --save-dev jest-junit), lancez les tests avec npx jest --ci --reporters=default --reporters=jest-junit, et déclarez artifacts: reports: junit: junit.xml dans le job tests.',
        ok: () => {
            if (!((pkg.devDependencies || {})['jest-junit'])) return 'jest-junit n\'est pas dans les devDependencies de package.json.';
            if (!jobs.some(([, j]) => j.artifacts && j.artifacts.reports && j.artifacts.reports.junit)) return 'Aucun job ne déclare artifacts: reports: junit.';
            return null;
        },
    },
];

console.log('\n======================= MISSIONS =======================\n');
if (ci._erreur) {
    console.log('Votre .gitlab-ci.yml est illisible : ' + ci._erreur.split('\n')[0]);
    process.exit(1);
}
let suivante = null;
let faites = 0;
for (const [i, m] of MISSIONS.entries()) {
    const pb = m.ok();
    if (!pb) { faites++; console.log(`[ OK ]  Mission ${i + 1} : ${m.titre}`); continue; }
    console.log(`[ À FAIRE ] Mission ${i + 1} : ${m.titre}`);
    if (!suivante) suivante = { i, m, pb };
}
console.log('\n========================================================');
if (!suivante) {
    console.log('TOUTES LES MISSIONS SONT RÉUSSIES, bonus compris.');
    console.log('========================================================\n');
    process.exit(0);
}
const { i, m, pb } = suivante;
console.log(`Mission ${i + 1} : ${m.titre}`);
console.log(`Le besoin : « ${m.besoin} »`);
console.log(`Ce qui manque : ${pb}`);
console.log(`Indice : ${m.indice}`);
console.log(`${faites} sur ${MISSIONS.length} réussies. Corrigez, faites un commit, poussez.`);
console.log('========================================================\n');
process.exit(1);
