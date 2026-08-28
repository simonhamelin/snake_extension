/**
 * Relais entre le raccourci clavier global et le content script de l'onglet actif.
 */

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-snake") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "SNAKE_TOGGLE" });
  } catch {
    // Pas de content script ici : page interne (chrome://, Web Store, PDF…),
    // ou onglet ouvert avant l'installation et jamais rechargé.
  }
});
