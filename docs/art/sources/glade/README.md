# Glade map sources

Pictures generated with Google Gemini for the `glade` map (`public/maps/glade`).

- `picture.png` (1024x768): the scene; the terrain is cut out of it.
- `backdrop.png` (1024x491): the background for the whole world.

Rebuild the map:

1. Upscale both 4x with Real-ESRGAN, anime model (`realesrgan-ncnn-vulkan -n realesrgan-x4plus-anime`,
   from github.com/xinntao/Real-ESRGAN releases; a local tool, not a project dependency).
2. `node scripts/art/picture/cut.mjs picture@4x.png 4096 3072 cut@4x.png "" 7`
3. `node scripts/art/picture/gen-glade.mjs picture@4x.png cut@4x.png backdrop@4x.png`
4. `npm run maps`
