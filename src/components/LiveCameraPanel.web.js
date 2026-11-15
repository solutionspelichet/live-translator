import { Text } from '../i18n/Text';
import { StyleSheet } from 'react-native';

import { themedStyles } from '../theme';

/** The live camera needs the phone's text recogniser: not available in a browser. */
export default function LiveCameraPanel() {
  return <Text style={styles.note}>La caméra en direct est disponible dans l’application Android. Dans le navigateur, utilisez l’onglet Photo.</Text>;
}

const styles = themedStyles((c) => StyleSheet.create({
  note: { color: c.textMuted, fontSize: 15, lineHeight: 22 },
}));
