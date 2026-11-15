import { Platform } from 'react-native';

/** Top padding of a screen: `native` points on the phone; in the web app (iPhone « Add to Home Screen », status bar over the page) at least the notch + a little. */
export const topInset = (native = 44) => Platform.select({ web: `max(${native}px, calc(env(safe-area-inset-top) + 12px))`, default: native });
