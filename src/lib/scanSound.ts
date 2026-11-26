// Short confirmation beep using the Web Audio API. Ported from the nithiksajjaWeb attendance scanner.
// The audio context must be created after a tap (iPad Safari rule),
// so the scanner calls unlockAudio() when Start is pressed.
let audioContext: AudioContext | null = null;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function unlockAudio() {
  try {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || (window as AudioWindow).webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
  } catch {
    audioContext = null;
  }
}

export function playBeep(frequency = 880, durationSeconds = 0.15) {
  if (!audioContext) return;
  try {
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(0.25, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + durationSeconds);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + durationSeconds);
  } catch {
    // If sound fails, the visual flash still confirms the scan.
  }
}
