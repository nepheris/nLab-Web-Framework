# nLab Site Platform

Socle générique pour les sites nLab de commerçants et prestataires.

## Objectif

Une instance client doit pouvoir être installée ou mise à jour sans dupliquer la logique générique. Le framework fournit les deux surfaces :

- **public-site** : catalogue/offres, contenu, SEO, contact, suivi public ;
- **private-manager** : clients, demandes, commandes, fournisseurs, paiements, livraison/exécution et pilotage.

Les données spécifiques au client ne sont pas stockées ici.

## Sources de vérité

1. `nLab-Web-Framework` : code et contrats génériques.
2. `SITE_DEPLOYMENT` privé du client dans Google Drive : configuration, branding, contenu source, packages, état et données privées.
3. dépôt GitHub public du client : artefact public généré et historique de publication.

Le projet Google Apps Script est un **runtime déployé**, pas une source de vérité.

Un dépôt privé spécifique au client est optionnel et ne doit être créé que si le client possède du code/override qui mérite un versionnage Git distinct. Il est désactivé par défaut.

## Règle public / privé

Le dépôt public ne contient jamais la logique d'autorisation comme frontière de sécurité ni les données privées. Le bouton Connexion redirige vers le Manager privé Apps Script.

Le Manager privé est déployé séparément, s'authentifie avec Google, applique RBAC côté serveur et accède aux données Drive autorisées.

## Mise à jour

Les builds clients doivent enregistrer un lock du framework (version/commit). APP14/BRK107 peuvent ensuite reconstruire les deux surfaces avec une nouvelle version du framework en conservant la configuration et les données du client.
