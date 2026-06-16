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

Set these in the Firebase console (Firestore → Rules), replacing the uid:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null && request.auth.uid == 'YOUR_ADMIN_UID';
    }
    function isMod() {
      return isAdmin()
        || (request.auth != null
            && exists(/databases/$(database)/documents/moderators/$(request.auth.uid)));
    }

    // per-user data: solver prefs + trainer progress (own doc only)
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    match /solutions/{id} {
      allow read: if resource.data.status == 'approved'
        || isMod()
        || (request.auth != null && request.auth.uid == resource.data.uid);
      allow create: if request.auth != null
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.status == 'pending'
        && request.resource.data.moves is int
        && request.resource.data.moves >= 1 && request.resource.data.moves <= 15
        && request.resource.data.solution is string
        && request.resource.data.solution.size() > 0
        && request.resource.data.solution.size() < 300
        && request.resource.data.classId is int
        && request.resource.data.partnerId is int
        && request.resource.data.pairId is int;
      allow update: if isMod();
      allow delete: if isAdmin();
    }

    match /meta/{doc} {
      allow read: if true;
      allow write: if isMod();
    }

    match /moderators/{uid} {
      allow read: if isAdmin() || (request.auth != null && request.auth.uid == uid);
      allow create: if isAdmin()
        || (request.auth != null && request.auth.uid == uid
            && exists(/databases/$(database)/documents/moderatorInvites/$(request.auth.token.email)));
      allow delete: if isAdmin();
    }

    match /moderatorInvites/{email} {
      allow read: if isAdmin() || (request.auth != null && request.auth.token.email == email);
      allow create, delete: if isAdmin();
    }
  }
}
```

> Note: the algorithm sheet no longer uses Firestore. Editing happens in
> `data/pyraminx_algs.json` (directly or via the Algorithms page's Export), so
> there is no `algsheet` collection or rule — see [README.md](README.md).
