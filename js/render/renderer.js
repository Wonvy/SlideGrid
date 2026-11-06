import { VERT, FRAG } from './shaders.js';
import * as m4 from './math.js';
import { hexToRgb } from '../core/utils.js';

const SLIDE_PAD = 4;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Shader 编译失败：' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Shader 链接失败：' + gl.getProgramInfoLog(p));
  }
  return p;
}

/**
 * WebGL2 渲染器：只负责把 scene（见 scene.js）画到 canvas 上。
 * 预览和导出各自持有一个实例，渲染逻辑完全相同，保证所见即所得。
 */
export class Renderer {
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.canvas = canvas;
    this.textures = new Map(); // slideId -> { tex, source }

    this.program = createProgram(gl, VERT, FRAG);
    const names = ['uMVP', 'uSize', 'uPad', 'uOffset', 'uRadius', 'uMode', 'uTex', 'uUV',
      'uBorder', 'uBorderColor', 'uBlur', 'uShadowColor', 'uOpacity', 'uHLColor', 'uHLFill', 'uHLRing'];
    this.loc = Object.fromEntries(names.map(n => [n, gl.getUniformLocation(this.program, n)]));

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxAniso = this.aniso ? gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    this.maxViewport = Math.min(vp[0], vp[1], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  }

  setSize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  // source: ImageBitmap 或 canvas。同一来源不会重复上传。
  setTexture(id, source) {
    const existing = this.textures.get(id);
    if (existing && existing.source === source) return;
    const gl = this.gl;
    const tex = existing?.tex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) {
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.maxAniso));
    }
    this.textures.set(id, { tex, source });
  }

  clear() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  prune(keepIds) {
    for (const [id, t] of this.textures) {
      if (!keepIds.has(id)) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(id);
      }
    }
  }

  /**
   * @param scene     buildScene() 的结果
   * @param tile      可选的裁切矩阵（导出时分块渲染用）
   * @param overlays  预览交互用的高亮：[{ item, color: [r,g,b], fill, ring }]，导出时不传
   * @param opts      { viewport: [x, y, w, h]（GL 像素，左下为原点）, clear }
   *                  工作区里多个画板共用一张画布时，每个画板只画在自己的区域
   */
  render(scene, tile = null, overlays = [], { viewport = null, clear = true } = {}) {
    const gl = this.gl, L = this.loc;
    if (viewport) gl.viewport(...viewport);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (clear) this.clear();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(L.uTex, 0);

    const st = scene.style;
    const vp = tile ? m4.multiply(tile, scene.viewProj) : scene.viewProj;
    gl.uniform1f(L.uRadius, st.radius);
    gl.uniform1f(L.uBorder, st.borderWidth);
    gl.uniform3f(L.uBorderColor, ...hexToRgb(st.borderColor));
    gl.uniform1f(L.uBlur, st.shadowBlur);
    gl.uniform4f(L.uShadowColor, ...hexToRgb(st.shadowColor), st.shadowOpacity);

    const hasShadow = st.shadowOpacity > 0.001;
    const mvps = scene.items.map(it => m4.multiply(vp, it.model));

    const drawShadow = (it, i) => {
      gl.uniform1i(L.uMode, 1);
      gl.uniformMatrix4fv(L.uMVP, false, mvps[i]);
      gl.uniform2f(L.uSize, it.w, it.h);
      gl.uniform1f(L.uPad, st.shadowBlur + SLIDE_PAD);
      gl.uniform2f(L.uOffset, 0, -st.shadowY);
      gl.uniform1f(L.uOpacity, it.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const drawSlide = (it, i) => {
      const t = this.textures.get(it.slide.id);
      if (!t) return;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(L.uMode, 0);
      gl.uniformMatrix4fv(L.uMVP, false, mvps[i]);
      gl.uniform2f(L.uSize, it.w, it.h);
      gl.uniform1f(L.uPad, SLIDE_PAD);
      gl.uniform2f(L.uOffset, 0, 0);
      gl.uniform4f(L.uUV, ...it.uv);
      gl.uniform1f(L.uOpacity, it.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    if (scene.coplanar) {
      // 同一平面：先画全部投影，再画全部幻灯片，避免投影盖住相邻的图
      if (hasShadow) scene.items.forEach(drawShadow);
      scene.items.forEach(drawSlide);
    } else {
      // 有前后关系：画家算法，由远及近
      scene.items.forEach((it, i) => {
        if (hasShadow) drawShadow(it, i);
        drawSlide(it, i);
      });
    }

    for (const o of overlays) {
      const i = scene.items.indexOf(o.item);
      if (i < 0) continue;
      gl.uniform1i(L.uMode, 2);
      gl.uniformMatrix4fv(L.uMVP, false, mvps[i]);
      gl.uniform2f(L.uSize, o.item.w, o.item.h);
      gl.uniform1f(L.uPad, SLIDE_PAD);
      gl.uniform2f(L.uOffset, 0, 0);
      gl.uniform3f(L.uHLColor, ...o.color);
      gl.uniform1f(L.uHLFill, o.fill || 0);
      gl.uniform1f(L.uHLRing, o.ring || 0);
      gl.uniform1f(L.uOpacity, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose() {
    for (const t of this.textures.values()) this.gl.deleteTexture(t.tex);
    this.textures.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
