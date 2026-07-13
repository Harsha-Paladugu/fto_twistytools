/* fto.twistytools.com — shared site config.
   This single block is loaded by every page so login + per-user data work
   site-wide. firebase points at the shared TwistyTools project used by all
   three puzzle sites; this site's data is namespaced under its puzzle key.
   The apiKey is a public client identifier, not a secret. Access is
   controlled by Firestore rules. */
window.OO_CONFIG = {
  puzzle: 'fto',   // namespaces this site's Firestore paths in the shared project

  firebase: {
    apiKey: "AIzaSyC5b82XjgZ26GsVvgTO0nCK_KiltQhRozM",
    authDomain: "twistytools-3bf66.firebaseapp.com",
    projectId: "twistytools-3bf66",
    appId: "1:446558622358:web:b99303e5695392108e68b7"
  },

  adminEmails: [],   // gates admin UI client-side only; rules are the boundary

  moderatorFormUrl: ""
};
