# AppNotes

Notes libres (titres, listes, checklists) à gauche, matrice d'Eisenhower à droite.
Glisse un élément avec sa poignée ⋮⋮ pour le déplacer. Un simple clic sur la poignée ouvre un menu (déplacer, changer de type, supprimer).

## Raccourcis

| Tape en début de ligne | Résultat |
|---|---|
| `# ` | Titre |
| `## ` | Sous-titre |
| `- ` | Liste à puces |
| `[] ` | Case à cocher |
| Entrée sur une ligne de liste vide | Sortir de la liste |
| Effacement arrière en début de ligne | Revenir en texte simple, puis fusionner avec la ligne du dessus |
| ⌘/Ctrl + Entrée | Cocher / décocher |
| ⌘/Ctrl + B / I | Gras / italique |
| ⌘/Ctrl + K | Ajouter ou modifier un lien |

## Espaces de travail
Clique sur le nom en haut à gauche (« Perso ▾ ») pour changer d'espace : École, Perso, Travail…
Chaque espace a ses propres notes et sa propre matrice. Dans ce menu, tu peux créer un espace (＋), le renommer (crayon) ou le supprimer (poubelle).
Pour envoyer une tâche dans un autre espace : clique sur sa poignée ⋮⋮, puis « Autre espace ».

## Tâches réalisées
Une tâche cochée descend dans la section « Tâches réalisées », en bas des **Notes**, y compris quand tu la coches dans la matrice.
Tu peux replier cette section, supprimer une tâche avec ×, ou tout vider avec « Tout supprimer ».
Si tu la décoches, elle retourne d'où elle venait : sa case de la matrice, ou la liste des notes.

## Annuler / Refaire
Le bouton ↩️ en haut (ou ⌘/Ctrl + Z hors d'un texte) annule la dernière action : suppression, tâche cochée, déplacement, espace supprimé ou renommé…
Le bouton ↪️ (ou ⌘/Ctrl + Maj + Z, ou Ctrl + Y) refait ce que tu viens d'annuler.
Après chaque suppression, une notification propose aussi « Annuler ».
Pendant que tu écris dans une ligne, ⌘/Ctrl + Z annule ta frappe, comme d'habitude.
L'historique d'annulation ne dure que tant que l'app est ouverte. Pour remonter plus loin, toutes les versions restent dans l'historique du dépôt `appnotes-data` sur GitHub.

## Images
Colle une image (⌘V), glisse-la depuis le Finder, ou utilise le bouton 🖼 Image (sur iPhone, il ouvre tes photos).
Les grosses photos sont réduites automatiquement. Les images sont stockées dans le dossier `images/` du dépôt `appnotes-data` et restent disponibles hors ligne.

## Liens
Sélectionne du texte, puis clique sur 🔗 Lien (ou ⌘K). Coller une adresse web crée un lien automatiquement.
Un lien s'ouvre au premier toucher. Si tu es en train d'écrire dans la ligne, utilise ⌘/Ctrl + clic.

## Thème
Le bouton lune / soleil à côté des réglages bascule entre le thème clair et le thème sombre en un clic. Au premier lancement, l'app suit le réglage de ton appareil.

## Mise en ligne (à faire une fois)

Il faut **deux dépôts** :
- `AppNotes` (**public**) : le code de l'app, servi par GitHub Pages. Il ne contient aucune note.
- `appnotes-data` (**privé**) : tes notes, dans un fichier `data.json`.

### 1. Publier l'app
1. Sur github.com, crée un dépôt **public** `AppNotes` (sans README).
2. Dans ce dossier, sur le Mac :
   ```bash
   git init -b main
   git add .
   git commit -m "Première version"
   git remote add origin https://github.com/TON-PSEUDO/AppNotes.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Source : Deploy from a branch → `main` / `(root)`**.
4. Environ une minute plus tard, l'app est en ligne sur `https://TON-PSEUDO.github.io/AppNotes/`.

### 2. Créer le dépôt des données
Crée un dépôt **privé** `appnotes-data`, en cochant « Add a README » pour qu'il ne soit pas vide.

### 3. Créer un jeton d'accès
GitHub → photo de profil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** :
- Expiration : la durée de ton choix (il faudra le renouveler à l'échéance)
- Repository access : **Only select repositories → `appnotes-data`**
- Permissions → Repository permissions → **Contents : Read and write**

Copie le jeton (`github_pat_…`). Il ne donne accès qu'au dépôt de tes notes.

### 4. Sur chaque appareil
Ouvre l'app, clique sur ⚙️, remplis ton pseudo, `appnotes-data` et le jeton, puis clique sur **Tester** et **Enregistrer**.
Pour l'installer comme une app :
- **iPhone** : Safari → Partager → « Sur l'écran d'accueil »
- **Mac** : Chrome → menu → « Installer la page en tant qu'application », ou Safari → Fichier → « Ajouter au Dock »
- **Windows** : Edge ou Chrome → icône « Installer » dans la barre d'adresse

## Modifier l'app ensuite
```bash
git add . && git commit -m "Ma modif" && git push
```
Les appareils récupèrent la nouvelle version au prochain chargement.

## Fonctionnement de la synchro
- Chaque modification est gardée sur l'appareil, puis envoyée à GitHub environ 3 secondes plus tard.
- L'app vérifie les nouveautés à l'ouverture, au retour sur l'onglet et toutes les minutes.
- Hors ligne, les modifications attendent le retour du réseau.
- Si deux appareils ont modifié les notes sans s'être synchronisés, **la version modifiée en dernier gagne**. L'historique Git de `appnotes-data` garde toutes les anciennes versions.

## Tester en local
```bash
python3 -m http.server 8765
```
puis ouvre http://localhost:8765
