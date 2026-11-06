// 每张幻灯片是一个四边形。圆角、描边、投影都由片元着色器里的 SDF 计算，
// 因此在任意分辨率、任意 3D 角度下边缘都保持锐利。

export const VERT = `#version 300 es
in vec2 aPos;            // 单位四边形 [-0.5, 0.5]
uniform mat4 uMVP;
uniform vec2 uSize;      // 幻灯片宽高（世界单位）
uniform float uPad;      // 四边形外扩，用于抗锯齿和投影
uniform vec2 uOffset;    // 投影偏移（幻灯片局部平面内）
out vec2 vLocal;
void main() {
  vec2 local = aPos * (uSize + 2.0 * uPad);
  vLocal = local;
  gl_Position = uMVP * vec4(local + uOffset, 0.0, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vLocal;
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
out vec4 outColor;

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
    outColor = vec4(uShadowColor.rgb, 1.0) * (uShadowColor.a * a * uOpacity);
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
  outColor = c * (cover * uOpacity);
}`;
