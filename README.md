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

## Points matériels à connaître

- **Le micro ne doit pas passer par le Bluetooth.** Si le micro BT (profil HFP) est utilisé, la sortie bascule en mono basse qualité
  et la séparation G/D disparaît. iOS : session `playAndRecord` avec A2DP seulement ; Android : entrée forcée sur le micro intégré.
- Les deux écouteurs doivent être une paire TWS connectée **au même téléphone** (un seul lien stéréo).
- Sans écouteurs, la voix sort sur le haut-parleur (pan sans effet) : l'app avertit.

## Statut

Vérifié ici : tests unitaires (12), bundle Metro Android, `expo-doctor`, prébuild Android.
**Non vérifié sur appareil** (pas de téléphone dans cet environnement) : latence réelle, comportement Bluetooth iOS/Android,
détection du micro intégré (`AudioManager.getDevicesInfo` renvoie des catégories propres à chaque OS).

## Pistes suivantes

- TTS en streaming (WebSocket ElevenLabs `stream-input`) pour démarrer la lecture avant la fin de la synthèse.
- Sélecteur de paire de langues, historique, voix par langue.
- Traduire les résultats `is_final` au fil de l'eau (phrases longues).
