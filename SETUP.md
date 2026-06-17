# Setup (Firebase + admin)

The site runs fully static. Firebase is optional and only powers sign-in, cloud
sync of per-user data (trainer progress, solver prefs), and the OO census's
shared solutions/moderation. Without it, everything falls back to localStorage
("demo mode").

## 1. Firebase config

Put your Firebase web config in [`js/config.js`](js/config.js):

```js
window.OO_CONFIG = {
  firebase: { apiKey: "…", authDomain: "…", projectId: "…", appId: "…" },
  adminEmails: ["you@example.com"],   // your Google account email
};
```

The `apiKey` is a public client identifier, not a secret — access is enforced by
the Firestore security rules below. Leave `firebase: null` to run in demo mode.

## 2. Become the admin

The OO page shows your account's **user id** when you're signed in. Paste it into
`isAdmin()` in the Firestore rules so your account is the admin. `adminEmails` in
`config.js` gates the admin UI client-side; the rules are what actually enforce
write access.

## 3. Firestore security rules

The rules are version-controlled in [`firestore.rules`](firestore.rules) (wired up
by [`firebase.json`](firebase.json)) — they are the real authorization boundary
(`adminEmails` in `config.js` only gates the admin UI). Set the admin uid in
`firestore.rules` (the OO page shows your user id when signed in), then deploy:

```
firebase deploy --only firestore:rules
```

You can also paste the file's contents into the Firebase console (Firestore →
Rules) if you'd rather not use the CLI. See the header comment in
`firestore.rules` for a recommended hardening (drive admin from an `admins/{uid}`
collection instead of a hardcoded uid).

> Note: the algorithm sheet no longer uses Firestore. Editing happens in
> `data/pyraminx_algs.json` (directly or via the Algorithms page's Export), so
> there is no `algsheet` collection or rule — see [README.md](README.md).
