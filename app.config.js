// app.json plus what depends on where the web version is hosted: EXPO_BASE_URL = the path of the site (GitHub Pages serves a project at
// /<repo>/, a custom domain or Netlify / Cloudflare Pages at the root: leave it empty there).
const base = require('./app.json');

module.exports = () => {
  const baseUrl = (process.env.EXPO_BASE_URL || '').replace(/\/+$/, '');
  return {
    expo: {
      ...base.expo,
      experiments: { ...(base.expo.experiments ?? {}), ...(baseUrl ? { baseUrl } : {}) },
    },
  };
};
