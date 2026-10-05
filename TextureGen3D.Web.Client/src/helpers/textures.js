import { zipSync } from 'fflate';

// ImageData → PNG bytes via a canvas round-trip. putImageData writes the
// straight-alpha RGBA as-is; toBlob encodes to non-premultiplied PNG, so
// orm.png coverage channels survive identically to the API save path.
export const imgDataToPngBytes = async (imgData) => {
  const c = document.createElement('canvas');
  c.width = imgData.width;
  c.height = imgData.height;
  c.getContext('2d').putImageData(imgData, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
};

// { 'uvmap.png': Uint8Array, ... } → deflate → download `fileName`.
export const downloadZip = (files, fileName) => {
  if (!Object.keys(files).length) return;
  const zipped = zipSync(files);
  const url = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
