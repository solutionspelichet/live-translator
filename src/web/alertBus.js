// Web: react-native-web's Alert.alert does nothing, and the app reports every error with it. This replaces it with a dialog that the
// app shows (AlertHost): Alert.alert(title, message, buttons) keeps its meaning, the buttons' onPress run when they are tapped.
const listeners = new Set();
let current = null;

export function installWebAlert(Alert) {
  Alert.alert = (title, message, buttons) => {
    const list = Array.isArray(buttons) && buttons.length ? buttons : [{ text: 'OK' }];
    current = { title: title ?? '', message: message ?? '', buttons: list };
    listeners.forEach((fn) => fn(current));
  };
}

export const subscribeAlert = (fn) => {
  listeners.add(fn);
  if (current) fn(current);
  return () => listeners.delete(fn);
};

export const dismissAlert = () => {
  current = null;
  listeners.forEach((fn) => fn(null));
};
