# SWARM Game Project

## Hard Rules

### WebGPU Only — NO WebGL
This project uses Three.js WebGPU renderer exclusively. **Never use `WebGLRenderer`.**

- Use `THREE.WebGPURenderer` (not `THREE.WebGLRenderer`)
- Use `renderer.renderAsync(scene, camera)` (not `renderer.render()`)
- WebGPU init is async: always `await renderer.init()` after construction
- If you see `WebGLRenderer` anywhere in the codebase, it's a bug — fix it

### Package Manager
- Use `bun`, not `npm`
