import { removeBackground } from '@imgly/background-removal';

export default function removePhotoBackground(image, progress) {
  return removeBackground(image, {
    publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/',
    model: 'isnet_fp16',
    device: 'cpu',
    proxyToWorker: false,
    output: { format: 'image/png', type: 'foreground' },
    progress
  });
}
