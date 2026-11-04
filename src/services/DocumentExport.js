import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { minutesToDocx, minutesToHtml, safeFileName } from '../utils/exportDoc';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function exportDir() {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Writes the minutes as PDF or Word in the cache and opens the Android share sheet (Drive, e-mail, WhatsApp, "Enregistrer"…). */
export async function exportMinutes(kind, doc) {
  const name = safeFileName(doc.title);
  let uri;
  if (kind === 'pdf') {
    const printed = await Print.printToFileAsync({ html: minutesToHtml(doc), width: 595, height: 842 });
    uri = printed.uri;
    try {
      const target = new File(exportDir(), `${name}.pdf`);
      if (target.exists) target.delete();
      new File(printed.uri).copy(target);
      uri = target.uri;
    } catch {
      // the file keeps the name chosen by expo-print
    }
  } else {
    const file = new File(exportDir(), `${name}.docx`);
    file.create({ intermediates: true, overwrite: true });
    const handle = file.open(FileMode.ReadWrite);
    handle.writeBytes(minutesToDocx(doc));
    handle.close();
    uri = file.uri;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Le partage de fichiers n’est pas disponible sur cet appareil.');
  await Sharing.shareAsync(uri, kind === 'pdf' ? { mimeType: 'application/pdf', dialogTitle: doc.title, UTI: 'com.adobe.pdf' } : { mimeType: DOCX_MIME, dialogTitle: doc.title, UTI: 'org.openxmlformats.wordprocessingml.document' });
}

/** The journal as a text file (a long journal does not fit in a share message: Android refuses it silently). */
export async function shareTextFile(name, title, text) {
  const file = new File(exportDir(), `${safeFileName(name)}.txt`);
  file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.ReadWrite);
  handle.writeBytes(new TextEncoder().encode(text));
  handle.close();
  if (!(await Sharing.isAvailableAsync())) throw new Error('Le partage de fichiers n’est pas disponible sur cet appareil.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: title });
}
