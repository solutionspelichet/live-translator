import { Fragment, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { currentValues, saveKeys, SETUP_FIELDS } from '../config/env';

/** First-launch / settings form: keys are stored in the device's secure storage. */
export default function SetupScreen({ onDone }) {
  const [values, setValues] = useState(currentValues());
  const [saving, setSaving] = useState(false);
  const complete = SETUP_FIELDS.every((f) => values[f.name]?.trim());

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Configuration</Text>
        <Text style={styles.hint}>
          Collez vos clés API. Elles restent dans le stockage sécurisé de ce téléphone, jamais dans le code.
        </Text>
        {SETUP_FIELDS.map((f) => (
          <Fragment key={f.name}>
            <Text style={styles.label}>{f.label}</Text>
            <TextInput
              style={styles.input}
              value={values[f.name] ?? ''}
              onChangeText={(t) => setValues((v) => ({ ...v, [f.name]: t }))}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={f.secret}
              placeholderTextColor="#55607F"
              placeholder={f.secret ? '••••••••' : 'ex. 21m00Tcm4TlvDq8ikWAM'}
            />
          </Fragment>
        ))}
        <Pressable
          style={[styles.button, !complete && styles.disabled]}
          disabled={!complete || saving}
          onPress={async () => {
            setSaving(true);
            await saveKeys(values);
            setSaving(false);
            onDone();
          }}
        >
          <Text style={styles.buttonText}>Enregistrer</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F1A' },
  content: { padding: 24, paddingTop: 48 },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  hint: { color: '#9AA6C4', fontSize: 15, marginVertical: 12 },
  label: { color: '#C9D2EA', fontSize: 14, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: '#16233B', color: '#fff', borderRadius: 10, padding: 14, fontSize: 16 },
  button: { backgroundColor: '#2F6FED', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 28 },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
