# Site Generation Output Handler

## Objet

Le handler `output` assemble les artefacts `pages.rendered`, `assets.prepared` et `routes.manifest` dans un répertoire web déclaré, sans logique métier ni publication.

## Contrat

- `outputRoot` est obligatoire.
- `/` devient `index.html`; une route `/x` devient `x/index.html` sauf `output_file` explicite.
- Les chemins absolus, dot-segments, query strings, fragments et traversals sont refusés.
- Les pages référencées doivent exister et contenir une chaîne `content`.
- Les assets `prepared` sont copiés depuis `assets.prepared.output_root` vers le même chemin relatif sous `outputRoot`.
- Une collision page/asset ou deux sorties identiques échoue explicitement.
- La sortie `web.output` liste les fichiers de façon déterministe et expose les compteurs pages/assets.

## Frontières

Aucune publication, preview, transformation d'asset, logique métier, décision HUMAN ou modification du runtime existant. Le stage prépare uniquement le répertoire web consommé ensuite par `preview`.

## Validation

Test Node ciblé exécuté sur les scénarios : assemblage nominal, route explicite, copie d'asset, collision, traversal, page inconnue, type de stage invalide et artefact pages manquant.
