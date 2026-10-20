<img width="1280" height="800" alt="title_4x" src="https://github.com/user-attachments/assets/1b12bdbf-bef5-4753-a592-f6aed2e4b9ce" />
# Giganoid 3D (desktop app)

The Giganoid 3D remake packaged as a Windows app with [Tauri](https://tauri.app): one exe, its own 1300x920 window,
no browser and no local server. It runs on WebView2, the Edge engine built into Windows 10/11.

**Download:** the latest exe is on the [Releases page](../../releases/tag/latest).

** YOU MUST SUPPLY YOUR OWN .ADF AMIGA DISKS - NO GAME DATA IS INCLUDED **
(You can also add Arkanoid, Revenge of Doh, Amegas and Crystal Hammer although the latter two games are not fully tested )

Settings, loaded level disks and custom sounds are saved in a `Giganoid3D-data` folder next to the exe.

Level packs (load your own disks)

Arkanoid and Revenge of Doh rounds load from your own disks and play after Giganoid’s 50.
Amegas rounds play 1:1 on their own 20×20 grid of narrower bricks.
Amegas special stones work as in the original: power, exit, survivor, spreader, jumper and killer.
Spreaders and jumpers can break through gold walls, as in the original.
Crystal Hammer’s 50 rounds load from its disk.
Moving bricks in Revenge of Doh are hit where they are drawn.
A check page shows every Amegas round next to the original.

Bat and ball

Bounce angles can be set from 1 to 7.
An odd number of angles adds a straight-up 90° bounce.
The shallowest angle is the original game’s 21°.
Edge-weighted zones are gentle now, and every angle can be hit.
Both halves of the bat mirror each other exactly.
The Arkanoid bat option copies Arkanoid’s 3 angles and zone widths.
The curved bat option bounces the ball like a mirror off an arched bat.
Holding the fire button auto-fires the laser, 20% slower than tapping.
Mouse acceleration is optional.

Power-ups and controls

Replicant (R) adds a second bat at the top for 15 seconds.
S (slow) appears less often, mainly when the ball is fast.
E toggles the novelty toy bat.
T tilts the board to free a stuck ball.
[ and ] skip to the previous or next round.
Power-up countdowns show as big red numbers above the score.

Music and sound

A procedural soundtrack plays in major, Lydian and Mixolydian scales.
It has a drone, notes, arpeggios, a bass pulse and noise.
Phaser and vowel-filter effects drift in slowly at random.
A stereo convolution reverb has its own slider.
Music volume, pulse level and game sounds each have their own setting.
A low-power audio mode lightens the sound engine.
Two 5-band EQs have gain, frequency and Q per band.
The EQs can be split into separate music and game-sound EQs.
Music fades out slowly when a round is cleared.
You can load your own replacement sound files.

Visuals

New tiled level backgrounds can be turned on or off.
Bricks that take several hits get a small nudge when hit.
Survivor stones flash white, and special stones show their symbols.
Neutrino trails are toned down.
Settings are in a four-column dialog that fits the game area.

Running it

All settings now save and load correctly.
A one-file local version opens in a Chrome app window.
A standalone Windows exe is built on GitHub, and its settings are saved next to the exe.
