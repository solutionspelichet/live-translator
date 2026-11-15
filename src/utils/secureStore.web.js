// Web version: the browser's localStorage, on this device and for this site only (nothing is sent anywhere).
// It is NOT encrypted: anyone who can open this browser profile can read the keys. Use the app on your own phone, never on a shared computer.
const PREFIX = 'dualcast:';
const store = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export async function getItemAsync(key) {
  return store()?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key, value) {
  store()?.setItem(PREFIX + key, String(value));
}

export async function deleteItemAsync(key) {
  store()?.removeItem(PREFIX + key);
}
