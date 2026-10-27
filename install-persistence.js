document.addEventListener('pointerdown', () => {
  navigator.storage?.persist?.().catch(() => {});
}, { once: true });
