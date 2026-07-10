# Setup (Firebase)

The site runs fully static, and currently runs entirely in **demo mode**:
`js/config.js` has `firebase: null`, so sign-in is stubbed and per-user data
(trainer progress, solver prefs) stays in the browser's localStorage.

Firebase is an **M6 decision** (see `docs/port-plan.md`). There is no census on
this site, so a Firebase project would only buy account sign-in + cloud sync of
per-user data. If/when M6 happens:

1. Create a Firebase project + web app; paste the web-app config into
   `js/config.js` (the `apiKey` is a public client identifier, not a secret —
   access is enforced by the rules).
2. Create the Firestore database in the console (console-only on the Spark
   plan) and enable the Google sign-in provider.
3. Deploy [`firestore.rules`](firestore.rules) (`firebase deploy --only
   firestore:rules`) — currently just the per-user `users/{uid}` rule.
4. Add the production domain (`fto.twistytools.com`) to the auth provider's
   authorized domains.

The Skewb parent project's full walkthrough (census collections, moderator
system, admin bootstrap, rules emulator tests) lives in git history
(`SETUP.md` and `test/firestore.rules.test.mjs` before the M0 commit) if any
of those patterns are needed again.
