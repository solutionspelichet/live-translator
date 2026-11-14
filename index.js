import { registerRootComponent } from 'expo';
import { Alert, Platform } from 'react-native';

import App from './App';
import { installWebAlert } from './src/web/alertBus';

if (Platform.OS === 'web') installWebAlert(Alert); // react-native-web's Alert is a no-op: the app's dialogs are drawn by AlertHost

registerRootComponent(App);
