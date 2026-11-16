# COAL HOUR

A scroll-driven 3D site for a fictional live-fire grill. Built by Jared Casillas as a portfolio and sales piece for restaurants.

**Live:** https://coal-hour-demo.netlify.app

## How it works

- **Stack:** Vite, Three.js, GSAP with ScrollTrigger, and Lenis.
- **Depth:** the stills get depth maps computed locally with Depth Anything V2 Small (ONNX), so the camera moves through them in 3D as you scroll.
- **Content:** everything that changes from one business to another (brand, copy, menu, places) lives in one file, `src/data/site.js`.
- **Assets:** generated with Higgsfield (GPT Image 2.6 stills and Seedance loops), plus a 3D skull from Tripo. The brand, menu, places, and phone number are invented.

## Run it

```bash
npm install
npm run assets
npm run dev
```

`npm run assets` crops the frames and computes the depth maps on your machine.

## Record the reel

Open the page with `?reel` (or `?reel=30` for 30 seconds), or press **R**. Space pauses; Esc or the mouse wheel stops it. In a 9:16 window the text stays clear of Instagram's overlays.

## Credits

Three.js (MIT), GSAP (free standard license, Webflow), Lenis (MIT), Depth Anything V2 Small (Apache-2.0).

© 2026 Jared Casillas. The code and the generated assets are public to show the work; ask before reusing them.
