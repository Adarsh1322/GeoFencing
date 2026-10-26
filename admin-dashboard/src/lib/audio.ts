/**
 * Synthesizes an emergency alarm chime using the Web Audio API.
 * No external sound files or assets required.
 */
class EmergencyAudioAlert {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private intervalId: number | null = null;

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
  }

  public playAlarmBeep() {
    try {
      this.initContext();
      if (!this.ctx) return;

      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      // Dual tone European emergency siren frequency
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.35);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch {
      // Audio playback restrictions fallback
    }
  }

  public startEmergencySiren() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.playAlarmBeep();
    this.intervalId = window.setInterval(() => {
      this.playAlarmBeep();
    }, 700);
  }

  public stopEmergencySiren() {
    this.isPlaying = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const emergencyAudio = new EmergencyAudioAlert();
