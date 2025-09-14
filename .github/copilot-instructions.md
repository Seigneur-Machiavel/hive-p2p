\# Instructions de style JavaScript



\## Préférences de code

\- \*\*Méthodes privées\*\* : Utilise toujours `#` pour les méthodes privées (plus clair)

\- \*\*Pas de forEach\*\* : Préfère `for (const item of items)` plutôt que `forEach`

\- \*\*Pas de Map/Record\*\* : Utilise les objets `{}` et tableaux `\[]` classiques

\- \*\*Early return/continue\*\* : Évite le nesting, utilise `if condition return` ou `if condition continue`



\## Structure du code

\- Évite les variables intermédiaires sauf si elles améliorent la lisibilité

\- Une seule responsabilité par bloc de code

\- Supprime les accolades inutiles quand possible

\- Évite les fonctions "haut niveau" sauf si particulièrement pertinent



\## Style de boucles

\- Condense les boucles simples sur une ligne quand c'est lisible

\- Préfère `if (condition) continue;` à `if (!condition) { ... }`



\## Commentaires

\- Commentaires inline pour les sections courtes (< 3 lignes)

\- Explique le "pourquoi", pas le "quoi"



\## Objectif

\- Code clair et concis

\- Accessible aux développeurs débutants

\- Évite la sur-complexité



\## Exemples de style préféré



```javascript

// ✅ Bon style

class ApiClient {

&nbsp; #baseUrl = 'https://api.example.com';

&nbsp; 

&nbsp; async fetchUsers() {

&nbsp;   const response = await fetch(`${this.#baseUrl}/users`);

&nbsp;   if (!response.ok) return null;

&nbsp;   

&nbsp;   const users = await response.json();

&nbsp;   const validUsers = \[];

&nbsp;   

&nbsp;   for (const user of users) {

&nbsp;     if (!user.email) continue;

&nbsp;     if (user.isActive) validUsers.push(user);

&nbsp;   }

&nbsp;   

&nbsp;   return validUsers;

&nbsp; }

}



// ❌ Style à éviter

class ApiClient {

&nbsp; constructor() {

&nbsp;   this.baseUrl = 'https://api.example.com';

&nbsp; }

&nbsp; 

&nbsp; async fetchUsers() {

&nbsp;   const response = await fetch(`${this.baseUrl}/users`);

&nbsp;   if (response.ok) {

&nbsp;     const users = await response.json();

&nbsp;     const validUsers = users.filter(user => {

&nbsp;       if (user.email) {

&nbsp;         return user.isActive;

&nbsp;       }

&nbsp;       return false;

&nbsp;     });

&nbsp;     return validUsers;

&nbsp;   } else {

&nbsp;     return null;

&nbsp;   }

&nbsp; }

}

```

