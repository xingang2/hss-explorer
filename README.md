# HSS sample browser

A static site for browsing HSS tasks. It links the paper on arXiv (2610.08966) and has the leaderboard and the paper's
worked examples. Each task page shows the media with the video evidence window, the full
prompt each model received, every model's answer and reasoning, and the per-criterion
judge grades.

```bash
python3 -m http.server 8000        # from this folder; then open http://localhost:8000
```

There is no build step. Every file here is served as is (GitHub Pages, S3, any static
host). Media is not copied. Pages load it from the public HF dataset (`ScaleAI/HSS`) and
fall back to the original `media_url`.

## Updating the data

`assets/` and `index.html` are hand-written. `data/`, `figures/` and `logos/`
are generated from the eval repo:

```bash
cd ../Humanity-Sixth-Sense && python3 scripts/build_website.py
```

`--reasoning N` caps each reasoning trace at N characters (default 6000, `0` drops them,
`-1` keeps all of it). `--out DIR` writes the site
somewhere else.
