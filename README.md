# SkinPin

Privacy-first skin scan prototype built with Expo + React Native that can detect over 23 skin conditions and analyze completely OFFLINE!

LA Hacks 2026 - Ranked Top 10 in Zetic AI Company Challenge

## Status

- Camera opens in app
- User can take a photo
- Mini photo preview appears in the analysis screen
- Symptom input via text
- Voice symptom capture (speech-to-text)
- ZETIC Melange on-device model inference (when token/model key are configured)
- 23 Different Skin Conditions Trained
- Runs FULLY offline with Airplane Mode turned on
- Multi-agent local reasoning pipeline:
  - Vision agent (prototype signal)
  - Symptom agent (keyword + duration extraction)
  - Triage agent (consensus urgency + next-step recommendation)
- Body map history with local tagging, progression, triggers, and insights
- On-device doctor report generation + native share sheet
- Sensitive Mode toggle with session clearing flow
- Retake + full session reset flow

## Important behavior (phone vs computer)

If you take a photo on your phone, it will **not** automatically appear on your computer/simulator.
This is expected because there is no backend or sync yet. Each device runs its own local app state.

## Tech stack

- Expo SDK 54
- React Native
- Expo Router
- `expo-camera`
- `expo-speech-recognition`
- `react-native-zetic-mlange`

## Project structure

- Main active screen: `app/(tabs)/index.tsx`
- Router entry: `package.json` -> `main: expo-router/entry`
- `App.js` has been removed to avoid confusion with Expo Router entrypoints

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npx expo start
```

3. Open targets:
- `i` = iOS simulator
- `a` = Android emulator
- `w` = Web
- Scan QR in Expo Go for physical phone

4. Optional: enable on-device LLM context reasoner (cloudless)

```bash
export EXPO_PUBLIC_ENABLE_ONDEVICE_LLM=true
export EXPO_PUBLIC_ONDEVICE_LLM_MODEL_PATH=/absolute/path/to/your/model.gguf
```

If these are missing, app still works with the local rule-based agent output only.

5. Required for ZETIC Melange model init:

```bash
export EXPO_PUBLIC_ZETIC_PERSONAL_TOKEN=your_token_here
export EXPO_PUBLIC_ZETIC_MODEL_KEY=your_model_key_here
```

Without these, the app runs symptom-only triage.

## Camera testing notes

- Best testing is on a real phone with a dev build (native modules required)
- iOS simulator can be used for UI checks, but camera behavior is limited
- Make sure laptop + phone are on same Wi-Fi
- If connection fails, press `s` in Expo and switch to Tunnel

## Team sync workflow

Push often so teammates can pull and stay in sync.

```bash
git add .
git commit -m "Set up camera capture prototype and docs"
git push origin main
```

Then teammates run:

```bash
git pull
npm install
npx expo start
```

## Current hackathon scope

- Local-only photo flow
- No backend
- No cloud storage
- Privacy-first architecture
- Training pipeline for both datasets in `ml/` (HAM10000 + Derma23)
- Progression/trigger analytics and report export, all on-device

## Native build note for PDF export

`react-native-html-to-pdf` requires a native dev build. It will not run in Expo Go.
