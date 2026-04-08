import { CMCGPlayer } from './player/CMCGPlayer';

const container = document.getElementById('player-container')!;
const player = new CMCGPlayer(container);

try {
  await player.load('/manifest.json', {
    // Example: override the ad image variable
    // '$adImage': 'https://picsum.photos/seed/cmcg-ad/1840/200',
  });
  console.log('[CMCG] Manifest loaded, slots resolved. Ready to play.');
} catch (e) {
  console.error('[CMCG] Failed to load:', e);
}

document.getElementById('play-btn')!.addEventListener('click', () => {
  player.play();
});

document.getElementById('pause-btn')!.addEventListener('click', () => {
  player.pause();
});
