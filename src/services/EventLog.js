// Tiny in-memory journal shown in the diagnostics panel: lets a tester see, after waking the
// screen, what happened meanwhile (app went to background, mic stalled, an error occurred…).
const MAX = 80;
const lines = [];

export default {
  add(message) {
    const t = new Date();
    const stamp = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    lines.push(`${stamp} ${message}`);
    if (lines.length > MAX) lines.shift();
  },
  last(n = 6) {
    return lines.slice(-n);
  },
};
