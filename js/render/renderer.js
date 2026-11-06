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

// 每张卡片（含投影外扩）投影到 NDC 后的包围盒：[minX, minY, maxX, maxY] × n；跨过镜头平面的记为 NaN
function cullBoxes(scene) {
  const st = scene.style;
  const n = scene.items.length;
  const boxes = new Float32Array(n * 4);
  const mvp = new Float32Array(16);
  const shadow = st.shadowOpacity > 0.001 ? st.shadowBlur + Math.abs(st.shadowY || 0) : 0;
  const pad = SLIDE_PAD + shadow;
  for (let i = 0; i < n; i++) {
    const it = scene.items[i];
    m4.multiplyInto(mvp, scene.viewProj, it.model);
    const hw = it.w / 2 + pad, hh = it.h / 2 + pad;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let c = 0; c < 4; c++) {
      const x = c & 1 ? hw : -hw, y = c & 2 ? hh : -hh;
      const w = mvp[3] * x + mvp[7] * y + mvp[15];
      if (w <= 1e-6) { x0 = NaN; break; }
      const px = (mvp[0] * x + mvp[4] * y + mvp[12]) / w;
      const py = (mvp[1] * x + mvp[5] * y + mvp[13]) / w;
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    boxes.set([x0, y0, x1, y1], i * 4);
  }
  return boxes;
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
    this.mvp = new Float32Array(16);
    this.boxes = new WeakMap(); // scene → 每张卡片的 NDC 包围盒
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
   * @param tile      可选的裁切矩阵（只含缩放 + 平移，见 math.tileMatrix）：导出分块、工作区局部渲染
   * @param overlays  预览交互用的高亮：[{ item, color: [r,g,b], fill, ring }]，导出时不传
   * @param opts      { viewport: [x, y, w, h]（GL 像素，左下为原点）, clear }
   *                  工作区里多个画板共用一张画布时，每个画板只画在自己的区域
   */
  render(scene, tile = null, overlays = [], { viewport = null, clear = true } = {}) {
    const gl = this.gl, L = this.loc;
    if (viewport) gl.viewport(...viewport);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (clear) this.clear();
    const items = scene.items;
    if (!items.length) return;
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
    const visible = this.visibleItems(scene, tile);
    const mvp = this.mvp;
    let lastTex = null;

    // 每张卡片只设置会变的 uniform；每一遍（投影 / 幻灯片）不变的值在遍开始时设置一次
    const setItem = it => {
      m4.multiplyInto(mvp, vp, it.model);
      gl.uniformMatrix4fv(L.uMVP, false, mvp);
      gl.uniform2f(L.uSize, it.w, it.h);
      gl.uniform1f(L.uOpacity, it.opacity);
    };
    const shadowPass = () => {
      gl.uniform1i(L.uMode, 1);
      gl.uniform1f(L.uPad, st.shadowBlur + SLIDE_PAD);
      gl.uniform2f(L.uOffset, 0, -st.shadowY);
    };
    const slidePass = () => {
      gl.uniform1i(L.uMode, 0);
      gl.uniform1f(L.uPad, SLIDE_PAD);
      gl.uniform2f(L.uOffset, 0, 0);
    };
    const drawSlide = it => {
      const t = this.textures.get(it.slide.id);
      if (!t) return;
      if (t.tex !== lastTex) { gl.bindTexture(gl.TEXTURE_2D, t.tex); lastTex = t.tex; }
      gl.uniform4f(L.uUV, it.uv[0], it.uv[1], it.uv[2], it.uv[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    if (scene.coplanar) {
      // 同一平面：先画全部投影，再画全部幻灯片，避免投影盖住相邻的图
      if (hasShadow) {
        shadowPass();
        for (const it of visible) { setItem(it); gl.drawArrays(gl.TRIANGLES, 0, 6); }
      }
      slidePass();
      for (const it of visible) { setItem(it); drawSlide(it); }
    } else {
      // 有前后关系：画家算法，由远及近（同一张卡片的投影和幻灯片共用矩阵）
      for (const it of visible) {
        setItem(it);
        if (hasShadow) { shadowPass(); gl.drawArrays(gl.TRIANGLES, 0, 6); }
        slidePass();
        drawSlide(it);
      }
    }

    if (!overlays.length) return;
    gl.uniform1i(L.uMode, 2);
    gl.uniform1f(L.uPad, SLIDE_PAD);
    gl.uniform2f(L.uOffset, 0, 0);
    for (const o of overlays) {
      if (!o.item) continue;
      setItem(o.item);
      gl.uniform1f(L.uOpacity, 1);
      gl.uniform3f(L.uHLColor, ...o.color);
      gl.uniform1f(L.uHLFill, o.fill || 0);
      gl.uniform1f(L.uHLRing, o.ring || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  /**
   * 视野裁剪：每张卡片（含投影外扩）在 NDC 中的包围盒按 scene 缓存一次，
   * 之后每帧只需按裁切矩阵（缩放 + 平移）变换包围盒，跳过完全在画面外的卡片。
   */
  visibleItems(scene, tile) {
    let boxes = this.boxes.get(scene);
    if (!boxes) {
      boxes = cullBoxes(scene);
      this.boxes.set(scene, boxes);
    }
    const sx = tile ? tile[0] : 1, sy = tile ? tile[5] : 1, tx = tile ? tile[12] : 0, ty = tile ? tile[13] : 0;
    const out = [];
    const items = scene.items;
    for (let i = 0; i < items.length; i++) {
      const k = i * 4;
      if (Number.isNaN(boxes[k])) { out.push(items[i]); continue; } // 跨过镜头平面：保守地画
      if (boxes[k] * sx + tx > 1 || boxes[k + 2] * sx + tx < -1) continue;
      if (boxes[k + 1] * sy + ty > 1 || boxes[k + 3] * sy + ty < -1) continue;
      out.push(items[i]);
    }
    return out;
  }

  dispose() {
    for (const t of this.textures.values()) this.gl.deleteTexture(t.tex);
    this.textures.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
