// 每张幻灯片是一个四边形。圆角、描边、投影都由片元着色器里的 SDF 计算，
// 因此在任意分辨率、任意 3D 角度下边缘都保持锐利。

export const VERT = `#version 300 es
in vec2 aPos;            // 单位四边形 [-0.5, 0.5]
uniform mat4 uMVP;
uniform vec2 uSize;      // 幻灯片宽高（世界单位）
uniform float uPad;      // 四边形外扩，用于抗锯齿和投影
uniform vec2 uOffset;    // 投影偏移（幻灯片局部平面内）
uniform mat4 uTile;      // 分块 / 局部渲染的裁切矩阵（uMVP 是整个画板的投影）
out vec2 vLocal;
out vec3 vClip;          // 画板的裁剪坐标（xy、w），用于按画板位置计算渐隐遮罩
void main() {
  vec2 local = aPos * (uSize + 2.0 * uPad);
  vLocal = local;
  vec4 clip = uMVP * vec4(local + uOffset, 0.0, 1.0);
  vClip = clip.xyw;
  gl_Position = uTile * clip;
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vClip;
uniform vec2 uSize;
uniform float uRadius;
uniform int uMode;           // 0 = 幻灯片, 1 = 投影, 2 = 高亮叠加
uniform vec3 uHLColor;
uniform float uHLFill;       // 高亮填充不透明度
uniform float uHLRing;       // 高亮描边宽度（像素）
uniform sampler2D uTex;
uniform vec4 uUV;            // xy = 缩放, zw = 偏移（cover 裁切）
uniform float uBorder;
uniform vec3 uBorderColor;
uniform float uBlur;
uniform vec4 uShadowColor;
uniform float uOpacity;
uniform int uFade;           // 渐隐遮罩：0 无，1 线性，2 两端，3 径向
uniform vec2 uFadeDir;       // 线性方向（画板坐标，y 向下）
uniform float uFadeAspect;   // 画板宽高比
uniform vec4 uFadeParams;    // 开始位置、结束位置、起点不透明度、终点不透明度
out vec4 outColor;

// 按像素在画板上的位置计算遮罩不透明度（与分块、视图缩放无关，所见即所得）
float fadeAlpha() {
  if (uFade == 0) return 1.0;
  vec2 ndc = vClip.xy / vClip.z;
  vec2 q = vec2(ndc.x * 0.5 * uFadeAspect, -ndc.y * 0.5); // 以画板中心为原点，画板高度为 1
  float t;
  if (uFade == 3) {
    t = length(vec2(q.x / (0.5 * uFadeAspect), q.y / 0.5));
  } else {
    float len = abs(uFadeAspect * uFadeDir.x) + abs(uFadeDir.y); // 与 CSS 渐变线长度一致
    t = dot(q, uFadeDir) / len + 0.5;
    if (uFade == 2) t = abs(t - 0.5) * 2.0;
  }
  float k = smoothstep(uFadeParams.x, max(uFadeParams.y, uFadeParams.x + 1e-4), t);
  return mix(uFadeParams.z, uFadeParams.w, k);
}

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 hs = uSize * 0.5;
  float r = min(uRadius, min(hs.x, hs.y));
  float d = sdRoundRect(vLocal, hs, r);

  if (uMode == 1) {
    float b = max(uBlur, 0.5);
    float a = 1.0 - smoothstep(-b, b, d);
    outColor = vec4(uShadowColor.rgb, 1.0) * (uShadowColor.a * a * uOpacity * fadeAlpha());
    return;
  }

  float aa = max(fwidth(d), 1e-4);
  float cover = 1.0 - smoothstep(-0.5 * aa, 0.5 * aa, d);

  if (uMode == 2) {
    // 描边画在边缘内侧，宽度按屏幕像素计算，任何缩放/透视下粗细一致
    float ring = 0.0;
    if (uHLRing > 0.0) {
      float halfW = uHLRing * 0.5 * aa;
      ring = 1.0 - smoothstep(halfW - 0.5 * aa, halfW + 0.5 * aa, abs(d + halfW));
    }
    float a = max(ring, cover * uHLFill);
    outColor = vec4(uHLColor, 1.0) * (a * uOpacity);
    return;
  }

  vec2 uv = vLocal / uSize + 0.5;
  uv.y = 1.0 - uv.y;
  uv = uv * uUV.xy + uUV.zw;
  vec4 c = texture(uTex, uv);   // 预乘 alpha

  if (uBorder > 0.0) {
    float edge = smoothstep(-uBorder - 0.5 * aa, -uBorder + 0.5 * aa, d);
    c = mix(c, vec4(uBorderColor, 1.0), edge);
  }
  if (!gl_FrontFacing) c.rgb *= 0.45;   // 背面（如环形展台后侧）压暗
  outColor = c * (cover * uOpacity * fadeAlpha());
}`;
