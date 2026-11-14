// Audio recordings on the phone are files (expo-file-system); only the web version keeps them as Blobs (blobStore.web.js).
export const putBlob = async () => {
  throw new Error('blobStore: web only');
};
export const getBlob = async () => null;
export const deleteBlob = async () => {};
