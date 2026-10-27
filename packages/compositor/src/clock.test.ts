import { describe, expect, it } from 'vitest';
import { TimelineClock } from './clock';

describe('TimelineClock', () => {
  function setup() {
    let wall = 0;
    let audio: number | null = 100;
    const clock = new TimelineClock({
      now: () => wall,
      audioTime: () => audio,
      duration: 10,
    });
    return {
      clock,
      wall: (value: number) => {
        wall = value;
      },
      audio: (value: number | null) => {
        audio = value;
      },
    };
  }
  it('anchors performance clock on play, pause, seek and transport rate', () => {
    const t = setup();
    t.clock.play();
    t.wall(1000);
    expect(t.clock.currentTime).toBe(1);
    t.clock.pause();
    t.wall(9000);
    expect(t.clock.currentTime).toBe(1);
    t.clock.seek(4);
    t.clock.setRate(2);
    t.clock.play();
    t.wall(10000);
    expect(t.clock.currentTime).toBe(6);
    t.clock.setRate(0.5);
    t.wall(12000);
    expect(t.clock.currentTime).toBe(7);
  });
  it('uses running audible AudioContext, not its absolute epoch', () => {
    const t = setup();
    t.clock.setAudioActive(true);
    t.clock.play();
    t.audio(101);
    t.wall(9000);
    expect(t.clock.currentTime).toBe(1);
    t.clock.setAudioActive(false);
    expect(t.clock.currentTime).toBe(1);
    t.wall(10000);
    expect(t.clock.currentTime).toBe(2);
  });
  it('switches suspended/resumed clock domains without jumping to audio epoch', () => {
    const t = setup();
    t.clock.setAudioActive(true);
    t.clock.play();
    t.wall(1000);
    t.audio(101);
    expect(t.clock.currentTime).toBe(1);
    t.wall(1500);
    t.audio(null);
    expect(t.clock.currentTime).toBe(1.5);
    t.wall(2500);
    expect(t.clock.currentTime).toBe(2.5);
    t.wall(3000);
    t.audio(999);
    expect(t.clock.currentTime).toBe(3);
    t.audio(1000);
    t.wall(4000);
    expect(t.clock.currentTime).toBe(4);
  });
  it('wraps I/O overflow, then anchors at the wrapped position', () => {
    const t = setup();
    t.clock.setLoop(true, 2, 4);
    t.clock.play();
    t.wall(2500);
    expect(t.clock.currentTime).toBe(2.5);
    t.wall(3000);
    expect(t.clock.currentTime).toBe(3);
    t.wall(4000);
    expect(t.clock.currentTime).toBe(2);
  });
  it('supports whole-project loop only when both endpoints are absent', () => {
    const t = setup();
    t.clock.setLoop(true);
    t.clock.play();
    t.wall(11000);
    expect(t.clock.currentTime).toBe(1);
    expect(() => t.clock.setLoop(true, 2, null)).toThrow(RangeError);
    expect(() => t.clock.setLoop(true, 4, 3)).toThrow(RangeError);
    expect(() => t.clock.setLoop(true, 0, 11)).toThrow(RangeError);
  });
  it('clamps to duration and stops without moving a paused frame', () => {
    const t = setup();
    t.clock.play();
    t.wall(11000);
    expect(t.clock.currentTime).toBe(10);
    expect(t.clock.playing).toBe(false);
    t.clock.setDuration(3);
    expect(t.clock.currentTime).toBe(3);
    t.clock.seek(-1);
    expect(t.clock.currentTime).toBe(0);
    expect(() => t.clock.setRate(-1)).toThrow();
    expect(() => t.clock.seek(NaN)).toThrow();
  });
  it('applies loop and end bounds even on the exact clock-domain transition tick', () => {
    const t = setup();
    t.clock.setAudioActive(true);
    t.clock.setLoop(true, 2, 4);
    t.clock.play();
    t.wall(1900);
    t.audio(101.9);
    expect(t.clock.currentTime).toBeCloseTo(3.9);
    t.wall(2200);
    t.audio(null);
    expect(t.clock.currentTime).toBeCloseTo(2.2);
    t.clock.seek(8);
    expect(t.clock.currentTime).toBe(2);
    t.clock.setLoop(false);
    t.clock.seek(9.9);
    t.wall(2400);
    t.audio(200);
    expect(t.clock.currentTime).toBe(10);
    expect(t.clock.playing).toBe(false);
  });
});
