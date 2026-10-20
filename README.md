<img width="1280" height="800" alt="Giganoid 3D title screen" src="https://github.com/user-attachments/assets/1b12bdbf-bef5-4753-a592-f6aed2e4b9ce" />

# Giganoid 3D

A 3D remake of the Amiga brick-breaker **Giganoid**, built from your own original disk image.
It plays all 50 Giganoid rounds in full 3D, can load the rounds of four other classic Amiga brick-breakers,
and runs as a standalone Windows app.

**[Download the latest Giganoid3D.exe](../../releases/tag/latest)**: one file, its own window, no browser, no install.

> **You must supply your own Amiga `.adf` disk images. No game data is included.**
> You can also add Arkanoid, Revenge of Doh, Amegas and Crystal Hammer, though the last two are not fully tested.

## Features

### Five games in one
- Plays all 50 rounds of Giganoid, read straight from your own disk image.
- Loads the rounds of **Arkanoid** and **Revenge of Doh** from your own disks and plays them after Giganoid.
- Plays all 37 **Amegas** rounds 1:1, on their own wider grid, with Amegas's special stones:
  power, exit, survivor, spreader, jumper and killer.
- Plays all 50 **Crystal Hammer** rounds.
- Includes a level editor for building your own rounds.
- Lets you jump to any round from a level picker, or skip rounds with the `[` and `]` keys.

### Power-ups
- **C** Catch: the ball sticks to the bat.
- **E** Expand: a wider bat; press E to swap in a novelty toy bat.
- **S** Slow: slows the ball down; drops mostly when the ball is fast.
- **D** Disruption: splits the ball into three.
- **L** Laser: a 15-second laser bat with auto-fire.
- **P** Extra life.
- **B** Break: opens an exit to the next round.
- **N** Neutrino: the ball passes straight through bricks for 10 seconds.
- **M** Multi: every ball splits, up to 10 balls.
- **G** Grenade: six orbiting neutrinos burst out in all directions with one click.
- **I** Iceberg: for 10 seconds, every brick hit shatters a 3×3 block.
- **R** Replicant: a second bat guards the top of the screen for 15 seconds.
- Big red countdowns show how long each timed power-up has left.
- **T** Tilt: shakes the board to free a stuck ball.

### Bat and ball control
- Bounce angles can be set from 1 to 7, with a straight-up shot for odd numbers.
- The **Arkanoid bat** option copies Arkanoid's original angles and bat zones.
- The **Curved bat** option bounces the ball like a mirror off an arched bat.
- A **Classic rules** mode uses the original game's speeds, angles and power-ups.
- Mouse speed, mouse acceleration, ball speed and power-up drop speed are all adjustable.

### Procedural soundtrack and sound
- Every round gets its own music, generated live: drones, melodies, arpeggios and a bass pulse.
- Slow phaser and vowel-filter effects drift in and out at random.
- A stereo reverb has its own amount slider.
- Two 5-band equalizers have adjustable gain, frequency and Q, with one for music and one for game sounds.
- Music, pulse and game-sound levels are set separately.
- You can load your own replacement sound effects.

### 3D graphics
- The bricks, bat and ball are fully modelled in 3D, with real-time lighting, shadows and reflections.
- A flat camera view, or a perspective view with adjustable angle.
- Glow, ball light, sparkles, ball trails and edge colour effects can each be tuned or switched off.
- New tiled level backgrounds can be switched on.

### Photo mode
- Pause the game and fly the camera freely around the scene.
- Set the lens, focus, depth of field, motion blur and film grain.
- Save high-resolution stills of the action.

## Running it
- **Windows app:** download `Giganoid3D.exe` from the [Releases page](../../releases/tag/latest) and run it.
  Settings, loaded disks and sounds are saved in a `Giganoid3D-data` folder next to the exe.
- The first time, Windows may show "Windows protected your PC" because the exe isn't signed.
  Click *More info → Run anyway*.

## How it's built
The game is `dist/index.html`. Every push to `main` rebuilds the exe on GitHub Actions
with [Tauri](https://tauri.app), which runs it in the WebView2 engine built into Windows 10 and 11.
