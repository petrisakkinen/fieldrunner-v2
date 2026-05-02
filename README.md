# Kenttäkiitäjä v2

Three.js endless runner — Repo runs for FC Barcelona vs Real Madrid. Sprite-based characters with AI-generated animations (GPT Image 2 for base portraits, Cinema Studio 3.0 / Kling 3.0 for motion videos), processed into game-ready sprite sheets via a custom Python pipeline.

**Play:** https://petrisakkinen.github.io/fieldrunner-v2/

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Lane left  | ◀ | swipe left  / tap left half  |
| Lane right | ▶ | swipe right / tap right half |
| Pass       | ▲ | swipe up    / tap top third  |
| Rainbow flick | ▼ | swipe down / tap bottom third |

## Local development

```bash
npm install
npm run dev      # http://localhost:5173/fieldrunner-v2/
npm run build    # outputs to dist/
```

## Sprite pipeline

The `tools/` folder contains a Python pipeline that converts a Higgsfield video clip into a clean game-ready sprite sheet (chroma-key removal, despill, frame selection, 256×256 cells). Documented in `Sprite-pipeline-instructions.rtfd/` (not deployed).

## Repo structure

```
src/
├── main.js                   # Three.js scene + game loop
├── SpriteSheetAnimator.js    # UV-driven cell stepping
├── PlayerSpriteController.js # State machine for Repo's animations
└── AudioController.js        # Procedural Web Audio SFX + crowd ambient

public/
├── sprites/{repo,madrid,teammate}/*.png   # 12-cell horizontal strips
├── stadium_panorama.png       # AI-generated stadium backdrop
├── start_screen.png           # Title poster
└── start_transition.mp4       # 4s cinematic intro (Seedance 2.0)
```
