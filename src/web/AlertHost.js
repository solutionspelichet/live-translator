import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Plain, Text } from '../i18n/Text';
import { themedStyles } from '../theme';
import { dismissAlert, subscribeAlert } from './alertBus';

/** Shows the dialogs that Alert.alert asks for on the web (see alertBus.js). Rendered once, at the root of the app. */
export default function AlertHost() {
  const [alert, setAlert] = useState(null);
  useEffect(() => subscribeAlert(setAlert), []);
  if (!alert) return null;
  const press = (b) => {
    dismissAlert();
    try {
      b.onPress?.();
    } catch {}
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismissAlert}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          {!!alert.title && <Text style={styles.title}>{alert.title}</Text>}
          {!!alert.message && <Plain style={styles.message}>{alert.message}</Plain>}
          <View style={styles.row}>
            {alert.buttons.map((b, i) => (
              <Pressable key={i} style={[styles.btn, b.style === 'destructive' && styles.btnDanger, i === alert.buttons.length - 1 && b.style !== 'cancel' && b.style !== 'destructive' && styles.btnPrimary]} onPress={() => press(b)} accessibilityRole="button">
                <Text style={[styles.btnText, i === alert.buttons.length - 1 && b.style !== 'cancel' && b.style !== 'destructive' && styles.btnTextOn, b.style === 'destructive' && styles.btnTextDanger]}>{b.text ?? 'OK'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles((c) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000A', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { width: '100%', maxWidth: 420, backgroundColor: c.surface, borderRadius: 24, padding: 22, gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
  title: { color: c.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  message: { color: c.textSoft, fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 6 },
  btn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 999, backgroundColor: c.inset },
  btnPrimary: { backgroundColor: c.accent },
  btnDanger: { backgroundColor: c.dangerBg },
  btnText: { color: c.text, fontSize: 15, fontWeight: '600' },
  btnTextOn: { color: c.onAccent },
  btnTextDanger: { color: c.danger },
}));
