// auth.js — global session guard; include after supabase SDK and config.js
(function () {
  const onLoginPage = /login\.html$/.test(location.pathname);

  // Synchronously hide the page until we confirm a valid session,
  // preventing any content flash before a redirect fires.
  if (!onLoginPage) {
    document.documentElement.style.visibility = 'hidden';
  }

  const client = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY
  );
  window._supabase = client;

  client.auth.getSession().then(function (result) {
    const session = result.data.session;

    if (onLoginPage) {
      // Already logged in — send to the app
      if (session) location.replace('index.html');
    } else if (!session) {
      // Not logged in — remember where they were headed, then send to login
      sessionStorage.setItem('auth_redirect', location.href);
      location.replace('login.html');
    } else {
      // Authenticated — reveal the page
      document.documentElement.style.visibility = '';
    }
  });

  // Expose sign-out so any page can call signOut()
  window.signOut = function () {
    client.auth.signOut().then(function () {
      location.replace('login.html');
    });
  };
})();
