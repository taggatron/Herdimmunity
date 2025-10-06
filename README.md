# Herd Immunity Explorer (KS3)

An interactive, classroom-friendly web app to explore how vaccination and R0 affect outbreaks. Designed for Key Stage 3 students and teachers.

## What it shows

- A simple grid world where people can be Susceptible, Vaccinated, Infected, or Recovered.
- Sliders to change R0 (spread) and vaccination percentage.
- Live counts and a small chart of infected over time.
- A rough herd immunity threshold: `1 - 1/R0`.

## How to run

Just open `index.html` in a browser. No server or install needed.

On macOS (Finder):

- Double-click `index.html` in the `Herdimmunity` folder.

From terminal (optional):

- You can launch a quick local server if you prefer:

```sh
# Python 3
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

## Teaching ideas

- Ask students to predict what will happen before running a simulation.
- Try different R0 values (e.g., 2 vs 4) and discuss why higher R0 needs more vaccination.
- Notice that random chance means small outbreaks can still happen even above the threshold.

## Notes

- The model is simplified for clarity: vaccines are 100% effective and recovery grants immunity.
- R0 is approximated through a combination of local and random contacts and a probabilistic recovery.
- Contributions welcome: adapt visuals, add partial vaccine effectiveness, or extend the charts.
