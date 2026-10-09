// Is the microphone delivering anything useful? (pure → unit-tested with `node --test`)
//
// Two ways a capture goes bad without any error: it stops delivering chunks (screen off, power saving), or it keeps delivering
// chunks that are all exactly zero (Android silences a recorder it does not trust at that moment). A real microphone always has
// a little noise, so a long run of digital zeros means "muted by the system": reopening the capture usually fixes it.

/** @returns {string | null} a short reason when the capture should be restarted */
export function micProblem(stats, now, { stallMs = 3000, zeroChunks = 40 } = {}) {
  if (!stats) return null;
  const last = stats.lastChunkAt;
  if (last && now - last >= stallMs) return `micro silencieux depuis ${Math.round((now - last) / 1000)} s`;
  if ((stats.zeroRun ?? 0) >= zeroChunks) return `micro muet (aucun signal, que des zéros) depuis ${Math.round(stats.zeroRun / 10)} s`;
  return null;
}
