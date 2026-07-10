/* fto.twistytools.com — shared site config.
   This single block is loaded by every page so login + per-user data work
   site-wide. firebase is null: the site runs in demo mode (per-user data stays
   in this browser's localStorage). A Firebase project is an M6 decision; when
   one exists, paste its web-app config here. The apiKey would be a public
   client identifier, not a secret — access is controlled by Firestore rules. */
window.OO_CONFIG = {
  firebase: null,

  adminEmails: [],   // gates admin UI client-side only; rules are the boundary

  moderatorFormUrl: ""
};
