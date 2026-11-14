import { minutesToDocx, minutesToHtml, safeFileName } from '../utils/exportDoc';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Download a Blob (the browser's « Save » / « Open in… » sheet on a phone). */
function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Share a file with the system share sheet when the browser offers it, else download it. */
async function shareOrDownload(blob, fileName, title) {
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return; // the user closed the sheet
    }
  }
  download(blob, fileName);
}

/** Web version: Word is built by hand and shared / downloaded; PDF goes through the browser's print dialog (« Save as PDF »). */
export async function exportMinutes(kind, doc) {
  const name = safeFileName(doc.title);
  if (kind === 'pdf') {
    const html = minutesToHtml(doc);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument.open();
    frame.contentDocument.write(html);
    frame.contentDocument.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
    return;
  }
  await shareOrDownload(new Blob([minutesToDocx(doc)], { type: DOCX_MIME }), `${name}.docx`, doc.title);
}

/** The journal as a text file: shared / downloaded. */
export async function shareTextFile(name, title, text) {
  await shareOrDownload(new Blob([text], { type: 'text/plain' }), `${safeFileName(name)}.txt`, title);
}
