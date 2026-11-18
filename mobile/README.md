# Holiday Dialysis — mobile app (Expo / React Native)

A phone app for clinic staff to **view and respond to requests**, get **push notifications**, and **photograph
documents** with the camera. It talks to the same portal API as the website, signing in with a token.

This is version 1, focused on those three jobs. Creating a brand-new request, reports and admin stay on the web portal;
the app points there for the less common actions (propose other dates, provider replies, etc.).

## What you need
- Node 18+ and a phone with the free **Expo Go** app (for quick testing), or an Apple/Google developer account (to
  build a real installable app with EAS).
- The portal reachable from the phone. For testing that's your Vercel test URL; inside a hospital it's the portal's
  address on the same network/VPN.

## Point it at your server
Edit `app.json` → `expo.extra.apiUrl` to your portal address, e.g.
```
"apiUrl": "https://holiday-dialysis.dev"          // test site
"apiUrl": "https://holiday-dialysis.hospital.local"  // on-prem
```

## Run it for testing
```
cd mobile
npm install
npx expo install        # aligns the native module versions to your installed Expo SDK
npx expo start
```
Scan the QR code with Expo Go (Android) or the Camera app (iOS). Sign in with a portal account that has a password.

> Push notifications and the camera need a **real device** — they don't work in a simulator or in a web preview.

## Build an installable app (for the app stores or internal distribution)
Uses Expo's build service (EAS). Needs internet and developer accounts.
```
npm install -g eas-cli
eas login
eas build:configure      # fills in expo.extra.eas.projectId
eas build -p android      # or -p ios
```
For push on a built app you also run `eas credentials` once so Expo can talk to Apple (APNs) and Google (FCM).

## Important notes
- **Push needs internet to the push service.** Expo delivers through Apple's and Google's push servers. On a fully
  offline on-prem network the phone can't reach them, so pushes won't arrive — the app still works with the badge and
  pull-to-refresh. If you need push on a closed network, that requires an internal push gateway (a larger piece of work).
- **Sign-in** uses a token stored in the phone's secure storage (Keychain / Keystore), sent as `Authorization: Bearer`.
  It carries the same clinic scope and expiry as the website session. Signing out removes the token and the device's
  push registration.
- The app only shows what the signed-in user is allowed to see and do — every action is checked by the server, exactly
  like the website.

## The app needs the backend update
The folder `backend-update/` adds the token sign-in, device registration and push sending to the portal. Apply it
(migration `019_device_token.sql` + the code) before the app can sign in or receive push. See `backend-update/INSTALL.md`.
