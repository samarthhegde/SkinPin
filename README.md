# PrivateCare 

Privacy-first skin scan prototype built with Expo + React Native.

## What works right now

- Camera opens in app
- User can take a photo
- Photo preview appears on the same device session
- Retake flow works

## Important behavior (phone vs computer)

If you take a photo on your phone, it will **not** automatically appear on your computer/simulator.
This is expected because there is no backend or sync yet. Each device runs its own local app state.

## Tech stack

- Expo SDK 54
- React Native
- Expo Router
- `expo-camera`

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

## Camera testing notes

- Best testing is on a real phone with Expo Go
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
