# Survey Flow Engine — POC Recettes du Cœur

Ce démonstrateur valide deux usages avec le même runtime générique :

1. un sondage express à choix unique avec affichage des résultats après vote ;
2. un questionnaire multi-étapes avec embranchements selon les réponses.

## Architecture

- `../../modules/survey-flow.json` : contrat générique du moteur ;
- `../../modules/survey-flow-runtime.js` : runtime navigateur ;
- `recettes-du-coeur-surveys.json` : définitions métier du POC ;
- `demo.html` : vue de démonstration ;
- `google-apps-script-endpoint.gs` : adaptateur serveur optionnel pour écrire les réponses dans Google Sheets.

Le stockage par défaut du démonstrateur est `localStorage`. Il sert uniquement à valider le parcours, la logique et la vue. Il ne constitue pas un stockage centralisé.

## Backend Google Sheets — MVP optionnel

Le classeur doit contenir un onglet `responses` avec les colonnes suivantes, dans cet ordre :

`response_id`, `survey_id`, `survey_version`, `submitted_at`, `context_json`, `answers_json`, `path_json`, `duration_ms`.

Pour tester l'adaptateur Google Apps Script :

1. créer un projet Apps Script associé au classeur ou autonome ;
2. copier le contenu de `google-apps-script-endpoint.gs` ;
3. créer une Script Property `SPREADSHEET_ID` contenant l'identifiant du classeur ;
4. déployer comme Web App ;
5. choisir l'identité d'exécution et le niveau d'accès adaptés au test ;
6. reporter l'URL `/exec` dans `submission.endpoint` de la définition de questionnaire et utiliser l'adaptateur HTTP approprié.

L'accès anonyme éventuel doit être décidé au niveau du déploiement Google et peut dépendre des règles du compte ou de l'organisation. Ne jamais placer de secret ou de jeton dans le HTML public.

## Suite recommandée

Après validation du POC : ajouter un adaptateur de stockage centralisé officiel, des tests unitaires du moteur de décision, un rendu de résultats agrégés, puis seulement un éditeur visuel de questionnaires de type `nLab Forms Studio`.
