# Passerelle web DualCast (facultative)

La version web (PWA) tourne dans un navigateur. Un navigateur ne peut pas :

1. appeler **DeepL** (DeepL refuse les requêtes venant d'une page web) ;
2. envoyer un **en-tête** sur une connexion WebSocket (**BytePlus / Doubao** veut `X-Api-Key`).

Cette petite passerelle, que vous installez sur **votre propre compte Cloudflare** (gratuit), règle ces deux cas. Sans elle, le reste marche (Gemini live, OpenAI live, Mistral live, Deepgram, ElevenLabs, OpenRouter) ; seuls DeepL et Doubao sont indisponibles dans la version web.

## Installer (5 minutes)

1. Créez un compte sur https://dash.cloudflare.com (gratuit).
2. **Workers & Pages → Create → Create Worker**, donnez-lui un nom (par exemple `dualcast-relay`), puis **Deploy**.
3. **Edit code** : remplacez tout le contenu par celui de `proxy/worker.js`, puis **Deploy**.
4. Recommandé : dans le code, mettez l'adresse de votre page dans `ALLOWED_ORIGINS` (par exemple `['https://votre-nom.github.io']`) pour que personne d'autre ne puisse utiliser votre passerelle.
5. Copiez l'adresse du Worker (`https://dualcast-relay.votre-compte.workers.dev`) dans l'application : **Réglages → Clés API → Passerelle web**.

## Sécurité

- Seuls les hôtes de la liste `ALLOWED_HOSTS` sont joignables : ce n'est pas un proxy ouvert.
- Les clés (DeepL, BytePlus) **traversent** votre passerelle pour arriver au service ; elles ne sont ni enregistrées ni journalisées par ce code.
- Vous seul contrôlez ce Worker : vous pouvez le supprimer à tout moment.

## Limites connues

- Ce code n'a pas pu être testé ici contre les vrais services DeepL et BytePlus (pas de clés, pas de compte Cloudflare dans l'environnement de développement). Si DeepL ou Doubao ne répondent pas, envoyez le message d'erreur affiché par l'application.
