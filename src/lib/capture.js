import { toPng } from 'html-to-image';

/**
 * Capture toute la zone d’analyse en PNG haute définition,
 * sans couper le bas de page, en forçant une largeur lisible.
 */
export async function captureAnalysisRoot(root, { filename }) {
  if (!root) throw new Error('Zone de capture introuvable');

  const prevScrollX = window.scrollX;
  const prevScrollY = window.scrollY;
  window.scrollTo(0, 0);

  document.body.classList.add('is-capturing');
  root.classList.add('capture-frame');

  // Laisse le layout / graphiques se redessiner
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 180));

  try {
    const width = Math.max(root.scrollWidth, 1280);
    const height = Math.max(root.scrollHeight, root.offsetHeight);

    const dataUrl = await toPng(root, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#e8ecef',
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: 'none',
        margin: '0',
      },
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        return !node.classList.contains('no-capture');
      },
    });

    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();

    // Presse-papiers si possible (Chrome / Edge)
    try {
      const blob = await (await fetch(dataUrl)).blob();
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
      }
    } catch {
      /* ignore : le téléchargement suffit */
    }

    return dataUrl;
  } finally {
    root.classList.remove('capture-frame');
    document.body.classList.remove('is-capturing');
    window.scrollTo(prevScrollX, prevScrollY);
  }
}
