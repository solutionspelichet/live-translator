# DualCast Translate

Traduction simultanée face-à-face sur **un seul smartphone** posé entre deux personnes.
Le micro du téléphone capte la voix ; la traduction est restituée dans des écouteurs Bluetooth partagés :
**langue A → écouteur gauche (pan −1.0)**, **langue B → écouteur droit (pan +1.0)**.

```
 Appui sur la zone A ou B (un appui pour parler, un appui pour finir)
        │  langue source = zone pressée
        ▼
 Micro (PCM16 16 kHz) ─▶ Deepgram Nova-2 (WebSocket) ─▶ DeepL ─▶ ElevenLabs Turbo v2.5 (pcm_24000)
                                                                     │
                       AudioBufferSource ▶ StereoPanner(±1) ▶ sortie Bluetooth A2DP
```

## Arborescence

```
App.js                              écran racine, câblage engine ⇄ UI
app.json                            permissions micro, plugin audio, bundle ids
.env.example                        modèle des clés (copier vers .env)
src/
  config/env.js                     lecture + validation des variables EXPO_PUBLIC_*
  config/languages.js               codes Deepgram / DeepL / ElevenLabs par langue, PAN A/B
  services/
    AudioRoutingService.js          lecture panoramique dur (react-native-audio-api)
    TranslationEngine.js            orchestration STT → NMT → TTS (state machine, annulation)
    createEngine.js                 injection des vrais services
    MicrophoneStreamer.js           micro → chunks PCM16
    stt/DeepgramSession.js          1 énoncé = 1 session WebSocket Nova-2
    translate/DeepLClient.js
    tts/ElevenLabsClient.js
  components/SplitScreen.js         deux zones tactiles (appui simple)
  utils/pcm.js                      conversions PCM (pures, testées)
tests/                              node --test (pipeline avec faux services)
```

## Dépendances

| Paquet | Rôle |
|---|---|
| `expo` ~57, `react-native` 0.86 | base |
| `react-native-audio-api` + `react-native-worklets` | **seule** brique qui donne `StereoPannerNode` + capture micro PCM en RN |
| `expo-dev-client` | requis : modules natifs → **Expo Go ne fonctionne pas** |
| `expo-build-properties`, `expo-haptics`, `expo-keep-awake`, `expo-status-bar` | support |

`expo-av`, `expo-audio` et `react-native-track-player` n'offrent **aucun contrôle de pan** ; ils ne conviennent pas.

## Démarrer

```bash
npm install
cp .env.example .env        # puis renseigner les clés
npx expo run:ios            # ou run:android  (build dev client natif, 1re fois ~ quelques minutes)
npx expo start --dev-client # ensuite, juste Metro
npm test
```

## Tester sur son téléphone, sans ordinateur (Android)

1. GitHub (navigateur du téléphone) → onglet **Actions** → **Build Android APK** → **Run workflow**.
2. Attendre ~10-15 min, ouvrir l'exécution terminée, télécharger l'artefact `dualcast-translate-apk` (un .zip).
3. Dézipper (app Fichiers), ouvrir `app-release.apk`, autoriser « sources inconnues ».
4. Au 1er lancement, coller les 3 clés API et les 2 voice ID (stockés dans le stockage sécurisé du téléphone).
   Le bouton ⚙︎ au centre de l'écran rouvre cette page.

Le build ne contient aucune clé : le dépôt étant public, ses artefacts le sont aussi.
(Alternative avec ordinateur : `npx eas-cli build --profile development --platform android`.)

## Gestion des clés (`.env`)

- `.env` est dans `.gitignore` ; seul `.env.example` (sans valeurs) est versionné.
- Expo n'injecte que les variables préfixées `EXPO_PUBLIC_` et uniquement via `process.env.EXPO_PUBLIC_X` (accès statique).
  Après modification : `npx expo start -c`.
- ⚠️ **Tout `EXPO_PUBLIC_*` est lisible dans le bundle de l'app.** OK pour un prototype perso. Pour une app distribuée :
  mettre un petit proxy (Cloudflare Worker, etc.) qui détient les clés, et pointer
  `EXPO_PUBLIC_DEEPL_BASE_URL`, `EXPO_PUBLIC_DEEPGRAM_WS_URL`, `EXPO_PUBLIC_ELEVENLABS_BASE_URL` dessus
  (idéalement Deepgram via clés temporaires). Pour EAS Build : `eas env:create` plutôt qu'un `.env` committé.

## Langues (32)

Français, English, Español, Deutsch, Italiano, Português (Brasil), Nederlands, Polski, Русский, Українська, Türkçe, Svenska,
Dansk, Norsk, Suomi, Ελληνικά, Čeština, Slovenčina, Magyar, Română, Български, 日本語, 한국어, 中文 (mandarin), हिन्दी,
Bahasa Indonesia, Bahasa Melayu, Tiếng Việt, et l'arabe : العربية (فصحى), المغرب, الجزائر, تونس.
Seules les langues gérées par les **trois** services (Deepgram en streaming, DeepL, ElevenLabs Turbo v2.5) sont proposées ;
croate, filipino et tamoul sont exclus car Deepgram ne les transcrit pas en direct.

**Arabe et dialectes** : Deepgram (modèle Nova-3) transcrit `ar-MA`, `ar-DZ`, `ar-TN`. DeepL et ElevenLabs ne connaissent que
l'arabe standard : un locuteur marocain/algérien/tunisien est compris, mais la traduction *vers* l'arabe est dite en arabe standard,
pas en darija. Le mélange darija/français au sein d'une phrase est mal transcrit.
Hindi, malais et vietnamien sont des ajouts récents chez DeepL : non testés ici.

## Arrière-plan et écran éteint (Android)

Un service de premier plan de type *microphone* (notification permanente « DualCast Translate — Traduction active »)
garde le micro et le réseau vivants quand l'app passe en arrière-plan ou que l'écran s'éteint ; une traduction en cours
n'est plus interrompue. Il démarre au lancement (Android l'interdit depuis l'arrière-plan). Un tour de parole se démarre
par un appui sur l'écran (ou en mode « Mains libres », voir plus bas).

## Réglages mémorisés

⚙︎ → choix des deux langues (A = écouteur gauche, B = écouteur droit) et clés API ; le bouton « Auto » est aussi mémorisé.
Tout est stocké dans le stockage sécurisé du téléphone (`expo-secure-store`).

### Écran éteint

Un service de premier plan ne suffit pas : Android endort le processeur et le Wi-Fi écran éteint. Un petit module natif
(`modules/dualcast-power`) garde un verrou de veille (CPU + Wi-Fi) tant que « Rester actif écran éteint » est activé ; le bouton
« 🔋 Autoriser sans limite de batterie » dans ⚙︎ ouvre la fenêtre Android d'exemption d'optimisation de batterie. Le panneau de
diagnostic (appui long sur ⚙︎) affiche un journal des derniers événements pour comprendre ce qui s'est passé écran éteint.
Le module n'a pas pu être compilé ni testé en local : seul le build GitHub le valide.

Écran éteint, deux choses pouvaient interrompre la traduction « au hasard » : Android qui coupe le micro d'une app en arrière-plan, et la
connexion Deepgram qui tombe (Wi-Fi en veille). Réponses : (1) pendant un tour, si aucun son n'arrive depuis 3 s, la capture est relancée
et rattachée au tour (`armStallMonitor`) ; (2) Deepgram reçoit un `KeepAlive` quand le micro est muet ; (3) la reconnexion ne s'épuise plus :
le compteur d'échecs repart à zéro après chaque reconnexion réussie (30 échecs *consécutifs* max, délai plafonné à 5 s), l'audio est gardé
jusqu'à 30 s pendant la coupure, et une connexion « ouverte mais muette » depuis 15 s est refaite. Tout ce qui se passe est inscrit dans le
journal du panneau de diagnostic (appui long sur ⚙︎) : « micro silencieux… → redémarrage », « Deepgram : reconnexion 2/30 »…

## Sensibilité du micro et choix du micro

Android n'expose pas de réglage de sensibilité aux apps ; l'app amplifie donc elle-même le son avant la reconnaissance
(`src/utils/gain.js`). Réglage dans ⚙︎ (« Micro et voix ») : **Auto** (contrôle automatique du gain, jusqu'à ×40 : relève la voix faible ou lointaine, détectée par rapport au bruit de fond
appris en continu, sans saturer ni amplifier le bruit) ou un gain fixe ×1 à ×32. La barre de volume pendant l'enregistrement et le
« gain micro » du panneau de diagnostic montrent ce qui est réellement envoyé. Le micro utilisé peut être choisi parmi ceux
que le téléphone expose (micro intégré, casque filaire, Bluetooth…) ; un micro Bluetooth fait passer les écouteurs en mono
(profil HFP) : la séparation gauche/droite est alors perdue. Android ne laisse pas choisir entre les micros internes du téléphone.

### Source du micro (Android)

`react-native-audio-api` ouvre toujours le micro avec la source par défaut, qui sur certains téléphones donne un signal très faible
(mesuré : ≈ −64 dBFS en parlant, soit 12 % de la barre de volume même avec un gain ×32). L'app capture donc le micro elle-même
(`modules/dualcast-power`, `AudioRecord`) avec le choix de la **source audio** — c'est ce que « un micro différent » veut dire sur
Android : Reconnaissance vocale (défaut), Standard, Caméscope, Brut, Appel — et peut activer le **gain automatique intégré au
téléphone** quand il existe. Si la capture native échoue, l'ancienne capture est utilisée (panneau de diagnostic : « capture »).
Le gain logiciel passe par un limiteur doux (plus de saturation brutale) ; éviter les gains fixes élevés.

## Volume de la voix traduite

La voix ElevenLabs est ramenée à un niveau sonore confortable (RMS, pas seulement le pic) puis les pics sont écrêtés en douceur
(`boostLoudness`). Réglage dans ⚙︎ : Normal, ×1,5, ×2 (défaut), ×2,5. Le volume « média » du téléphone et des écouteurs
Bluetooth reste le réglage maître : le mettre au maximum.

## Délai de traduction

- `Voix en flux` (⚙︎, expérimental, désactivé par défaut) : ElevenLabs renvoie l'audio par WebSocket (`stream-input`) et la lecture démarre
  après ~0,3 s d'audio, sans attendre la phrase entière (`ElevenLabsClient.stream`, `AudioRoutingService.playStream`). Si le flux échoue
  avant le moindre son, l'app retombe seule sur la requête classique pour le reste de la session.
- Les connexions HTTPS vers DeepL et ElevenLabs sont ouvertes à l'avance (`warm`), ce qui évite la poignée de main TLS à la première phrase.
- Le journal du panneau de diagnostic (appui long sur ⚙︎) affiche pour chaque phrase : `délai: DeepL x ms · voix y ms · prêt en z ms`.

- **Réactivité** (⚙︎ → « Réactivité de la traduction ») : « Rapide » valide un segment après 250 ms de pause (au lieu de 400), libère les
  propositions dès 6 mots (au lieu de 9) et traduit les mots restants après 0,7 s (au lieu de 1,2 s) ; la voix arrive plus tôt avec des morceaux
  de phrase plus courts. Le journal affiche maintenant le délai de reconnaissance (`reco`) et le total `≈ x ms après le dernier mot`.
- Le tampon de départ de la voix en flux est passé de 0,3 s à 0,15 s.

## Réunions : transcription et comptes rendus

Bouton **📝** sur l'écran principal (le traducteur et son micro sont fermés pendant ce temps).

1. **Enregistrer** : titre, langue parlée (ou « Plusieurs langues » : Nova-3 suit les changements de langue), rappel de consentement des
   participants (case à cocher obligatoire). Le micro alimente (a) un fichier WAV 16 kHz sur le téléphone (`Documents/meetings/`, ≈ 115 Mo par
   heure) et (b) une transcription **en direct** avec séparation des intervenants (Deepgram Nova-3, `diarize`). Fonctionne écran éteint. Si le
   direct n'est pas disponible, l'enregistrement continue.
2. **Transcription précise** : le fichier audio est envoyé à Deepgram en mode différé (`PrerecordedTranscriber`, Nova-3 puis Nova-2 si la
   langue le permet) : la reconnaissance voit tout le contexte et sépare mieux les intervenants que le direct. Compter ≈ 1 minute d'envoi
   par heure d'audio en Wi-Fi.
3. **Intervenants** : renommer « Intervenant 1, 2… » ; les noms vont dans la transcription et les comptes rendus.
4. **Compte rendu** : rédigé via **OpenRouter** (clé facultative dans ⚙︎ → Clés API ; modèle au choix, par défaut le Claude Sonnet le plus récent
   du catalogue) **dans la langue demandée à chaque fois** (32 langues). Modèles : réunion pro, décisions et actions, entretien, appel client,
   cours, résumé express, libre. Consignes anti-invention (« (à confirmer) », pas de chiffre ou de nom inventé). Transcriptions très longues :
   notes par tranche de 60 000 caractères puis rédaction finale. Partage par la feuille de partage Android.
5. Le coût OpenRouter réel (renvoyé par l'API) et les minutes Deepgram des réunions s'ajoutent à l'écran 📊.

Limites assumées : la précision dépend du micro du téléphone (posé au centre de la table, propre) ; la séparation des intervenants est
automatique (étiquettes à renommer, erreurs possibles quand deux personnes parlent en même temps) ; pas de lecture audio dans l'app (le
fichier WAV reste sur le téléphone). Le module n'a pas pu être essayé sur un appareil ici.

## Voix personnelle

Une voix créée dans ElevenLabs (la vôtre) apparaît dans ⚙︎ → « Charger mes voix ». L'option **« Voix liée à la personne qui parle »** fait
dire vos traductions avec **votre** voix (au lieu d'attribuer les voix par langue).

## Consommation facturée

Le bouton **📊** (minutes d'écoute du jour) ouvre l'écran « Consommation » : pour cette session, aujourd'hui, ce mois-ci et depuis le début,
les **secondes d'audio envoyées à Deepgram** (comptées deux fois en mains libres : une reconnaissance par langue ; Nova-3 pour l'arabe),
les **caractères envoyés à DeepL** (texte source) et les **caractères synthétisés par ElevenLabs**, avec une estimation en dollars.
Les volumes sont exacts côté app ; les tarifs (modifiables dans l'écran) sont indicatifs : certains n'ont pas pu être confirmés
(tarif Nova-2, formules DeepL actuelles, crédits ElevenLabs). Les quotas réels de DeepL (`/v2/usage`) et d'ElevenLabs
(`/v1/user/subscription`) sont lus en direct quand la clé le permet. Les compteurs sont gardés sur le téléphone (`src/services/UsageTracker.js`,
`src/utils/usage.js`) ; bouton de remise à zéro.

## Fiabilité

- Appels DeepL / ElevenLabs : jusqu'à 2 nouvelles tentatives sur coupure réseau, 429 ou erreur serveur (`src/utils/http.js`).
- Deepgram : si la connexion tombe en cours de parole, reconnexion automatique (3 essais), l'audio est conservé pendant la coupure.
- Messages d'erreur en français : clé refusée, quota épuisé, pas de connexion, voix introuvable…
- ⚙︎ → « ✔︎ Tester mes clés » : vérifie les 3 clés et les 2 voix sans dépenser de crédit, puis contrôle en direct que Deepgram accepte
  les deux langues choisies et que DeepL les propose avec votre clé.

## Confort

- **Voix par langue** : ⚙︎ → « Charger mes voix ElevenLabs » liste les voix du compte ; une pour la langue A, une pour la langue B.
- **Historique** : bouton 🕘 (phrase originale + traduction, 300 dernières), conservé après la fermeture de l'app (`@react-native-async-storage/async-storage`),
  avec un bouton **Partager** (feuille de partage Android : copier, message, e-mail…).
- **Paires de langues** : bouton « ⇄ Inverser A et B » et raccourcis vers les 4 dernières paires utilisées (⚙︎ → Langues).
- **Écho en mains libres** : option « Couper le micro pendant la voix traduite » (⚙︎), en plus du filtre de texte.
- **Mains libres** : bouton « Mains libres ». Un appui démarre l'écoute continue, un second l'arrête ; plus besoin de choisir la zone.
  Le même son est envoyé à deux sessions Deepgram (une par langue) ; la transcription la plus fiable (confiance) indique la langue
  parlée, et la phrase est traduite vers l'autre oreille. Deux fois plus de transcription facturée ; moins fiable que le choix manuel
  sur les phrases très courtes (« ok », « oui ») ou deux langues proches. Non vérifié sur appareil.
  Arrêt automatique : sans aucune parole reconnue pendant 5 minutes, le mode mains libres s'arrête (vibration + message) pour ne pas facturer deux transcriptions
  ni vider la batterie ; un appui relance l'écoute.
  Garde-fous contre les « phrases inventées » : le micro peut réentendre la voix traduite (fuite des écouteurs) et la retranscrire, ce qui
  créerait une boucle entre les deux voix. Une transcription qui reprend mot pour mot (langues alphabétiques : paires de mots ; chinois, japonais, coréen : paires de caractères) une traduction jouée dans les 40 dernières secondes est donc
  ignorée (`src/utils/echo.js`, note « écho ignoré » dans le journal), ainsi que les transcriptions peu fiables (confiance < 0,5, ou < 0,7
  quand l'autre langue n'a rien reconnu) et les textes de moins de 3 caractères.

## Points matériels à connaître

- **Le micro ne doit pas passer par le Bluetooth.** Si le micro BT (profil HFP) est utilisé, la sortie bascule en mono basse qualité
  et la séparation G/D disparaît. iOS : session `playAndRecord` avec A2DP seulement ; Android : entrée forcée sur le micro intégré.
- Les deux écouteurs doivent être une paire TWS connectée **au même téléphone** (un seul lien stéréo).
- Sans écouteurs, la voix sort sur le haut-parleur (pan sans effet) : l'app avertit.

## Livraison

L'APK n'est construit que pour **arm64-v8a** (tous les téléphones Android récents) : environ 40 Mo au lieu de 110 Mo avec les quatre
architectures, donc un téléchargement qui aboutit sur une connexion mobile. Un très ancien téléphone 32 bits afficherait « application non
compatible » : retirer `buildArchs` dans `app.json` rétablit l'APK universel.


Chaque build publie l'APK comme version GitHub **`latest-apk`** (lien direct, pas de zip) en plus de l'artefact :
`https://github.com/solutionspelichet/live-translator/releases/tag/latest-apk`. L'APK ne contient aucune clé (elles se saisissent dans l'app).

## Statut

Vérifié ici : tests unitaires (12), bundle Metro Android, `expo-doctor`, prébuild Android.
**Non vérifié sur appareil** (pas de téléphone dans cet environnement) : latence réelle, comportement Bluetooth iOS/Android,
détection du micro intégré (`AudioManager.getDevicesInfo` renvoie des catégories propres à chaque OS).

## Pistes suivantes

- ~~Traduire les résultats `is_final` au fil de l'eau~~ → fait : chaque phrase validée est traduite et lue pendant que la personne parle encore (`TranslationEngine.enqueue`).
- ~~TTS en streaming, historique, voix par langue, mains libres~~ → fait (voir plus haut), à valider sur appareil.
- Historique persistant (nécessite un stockage fichier), détection de langue plus robuste en mains libres.
