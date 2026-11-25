# Wild Duck Flight Simulator

A browser-based duck-hunting practice scene: wild ducks (mallard, pintail, gadwall, wigeon, teal, shoveler) cross, come in, go away and quarter past you at real-world range and speed, with wing whistles, calls, gun mount, swing and shot feedback.

## Run

Plain HTML/CSS/JS, no build step. Serve the folder and open it:

```
python -m http.server 8765
```

then visit http://localhost:8765.

## Controls

- Hold the right mouse button (or press M) to mount the gun, swing through the bird, left-click to fire. Three shells; lower the gun to reload.
- With the gun down, click anywhere (or press F) to send ducks in from a random direction. P pauses.
- The side panel sets duck frequency (up to 60/min), speed range, environment, species and sound.
