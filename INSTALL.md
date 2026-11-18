# Holiday Dialysis — mobile app delivery

Two parts:

1. **`backend-update/`** — apply this to the portal first. It adds token sign-in, device registration and push.
   See `backend-update/INSTALL.md` (includes a Cursor merge prompt and the migration).

2. **`mobile/`** — the Expo / React Native phone app (view & respond to requests, push, camera document capture).
   See `mobile/README.md` to point it at your server, run it with Expo, and build it with EAS.

## What's proven vs what needs your device
- **Backend update: tested here end-to-end** — mobile sign-in returns a token, `Authorization: Bearer` is accepted,
  a bad token is rejected, device register/unregister works, and approving a request pushed a notification to the
  registered device. All existing backend tests pass.
- **The app code is complete and syntax-clean, but a React Native UI can only be truly tested on a phone.** Run it with
  Expo Go on a real device (push and camera need a real device), then build with EAS for the stores or internal install.

## Order of operations
1. Apply `backend-update/` to the portal, run the migration, deploy.
2. In `mobile/app.json` set `expo.extra.apiUrl` to your portal URL.
3. `cd mobile && npm install && npx expo install && npx expo start`, open in Expo Go, sign in.
4. When happy, `eas build` for a real installable app.
